/**
 * Autorización centralizada por FILA de `Solicitud.asignaciones[]` —
 * corrige el defecto donde el frontend elegía silenciosamente
 * `asignaciones[length-1]` como "el" responsable: todo elemento activo del
 * arreglo tiene igual condición de responsable, el orden nunca otorga ni
 * quita privilegios.
 *
 * Deliberadamente NO es un único `esResponsableDeSolicitud()` que sirva de
 * bypass para todo — cada acción (observar/cerrar/reasignar) tiene su
 * propia función, porque tienen reglas distintas (reasignar es una
 * facultad administrativa separada de la facultad del analista de
 * observar/cerrar su propia fila).
 */
import type { SessionUser } from '@/lib/session';
import { matchesIdentity, isAdmin, esAdministradorProcesos, esMercadeo } from '@/lib/authz';
import { esProcesoPrivadoPorAlias, esEquipoComercial } from '@/lib/roles';
import { puedeConBD } from '@/lib/licycolba/permisos';
import { esEstadoSolicitudTerminal } from './estados-solicitud';
import { normalizarEstadoSolicitudGlobal } from './estados-canonicos';
import type { PrismaDb } from './crear-solicitud';

export { esAdministradorProcesos } from '@/lib/authz';

export interface UsuarioActivo {
  id: number;
  usuario: string;
  email: string;
  rol: string;
  estado: string;
}

export interface AsignacionSolicitud {
  idAsignacion?: string;
  analistaAsignado?: string;
  [key: string]: unknown;
}

export interface SolicitudConAsignaciones {
  estadoSolicitud: string;
  asignaciones: unknown;
  /** Ajuste "PERMISOS DE CIERRE — PRIVADOS PARA MERCADEO" — necesario en
   * `puedeCerrarSolicitud` para bifurcar la regla por tipo de proceso.
   * `Solicitud` NO tiene una columna `tipoProceso` en Prisma (ese campo
   * existe solo en `ProcesoDetalleSecop`, un modelo distinto, y como campo
   * de formulario en `page.tsx` al CREAR una solicitud — nunca se persiste
   * en `Solicitud`). El único dato persistido que distingue Público de
   * Privado es `aliasFuente`, con el mismo criterio que YA usa el resto
   * del backend (`aliasFuentePublico`/`aliasFuentePrivado` en
   * `GET /api/solicitudes`, `dashboard/route.ts`, `colba-stats.ts`,
   * `indicadores-financieros/route.ts`): `aliasFuente IN ('S1','S2')` es
   * Público; cualquier otro valor, incluido `null` (proceso manual/legado
   * sin fuente externa), es Privado — ver `esAliasFuentePublico` abajo.
   * Opcional: las demás funciones de este archivo no lo requieren y un
   * caller legado que no lo incluya no debe romper en compilación. */
  aliasFuente?: string | null;
}

/** `aliasFuente` con las mismas 2 fuentes públicas que ya usa el resto del
 * backend (`S1`/`S2` — SECOP I/II) — nunca una lista paralela que pueda
 * divergir. Cualquier otro valor (incluido `null`/ausente, proceso manual)
 * es Privado. Vive aquí, no exportado, porque hoy es exclusivo de
 * `puedeCerrarSolicitud`; si otro archivo de `solicitudes/*` llega a
 * necesitarlo, exportarlo entonces — no antes. */
/** Ajuste "CIERRE DE PRIVADOS PARA MERCADEO — FILA AJENA" — misma condición
 * "Privado DETERMINADO" que ya decide `puedeCerrarSolicitud` (aliasFuente
 * presente y distinto de S1/S2), exportada para que otros callers (el
 * endpoint `/cerrar`, al decidir si Mercadeo puede tocar la fila de OTRO
 * responsable para materializar un cierre ya autorizado; el endpoint
 * `/seguimiento`) usen la MISMA fuente de verdad. Delega en
 * `esProcesoPrivadoPorAlias` (`@/lib/roles`, sin imports server-only) para
 * que el mismo criterio también pueda usarse desde el cliente (`page.tsx`)
 * sin arrastrar Prisma al bundle del navegador — nunca una copia paralela
 * del Set de alias públicos. */
export function esProcesoPrivado(solicitud: SolicitudConAsignaciones): boolean {
  return esProcesoPrivadoPorAlias(solicitud.aliasFuente);
}

/**
 * Resuelve el usuario REAL en BD para la sesión actual — nunca confía en
 * el username/id que el navegador pudiera mandar en el body. Devuelve
 * `null` si el usuario no existe o no está Activo (nunca lanza).
 */
export async function resolverUsuarioSesionActivo(db: PrismaDb, session: SessionUser): Promise<UsuarioActivo | null> {
  const rawId = Number(session.id);
  let user = null;
  if (Number.isFinite(rawId) && rawId > 0) {
    user = await db.user.findUnique({ where: { id: rawId } });
  }
  if (!user && session.email?.trim()) {
    user = await db.user.findUnique({ where: { email: session.email.trim() } });
  }
  if (!user) return null;
  if (user.estado !== 'Activo') return null;
  return { id: user.id, usuario: user.usuario, email: user.email, rol: user.rol, estado: user.estado };
}

function asAsignaciones(solicitud: SolicitudConAsignaciones): AsignacionSolicitud[] {
  return Array.isArray(solicitud.asignaciones) ? (solicitud.asignaciones as AsignacionSolicitud[]) : [];
}

/**
 * Encuentra, dentro del arreglo ACTUAL de asignaciones, la fila que
 * pertenece al usuario dado — por coincidencia de identidad normalizada
 * (`matchesIdentity`) contra `analistaAsignado`. Si esa fila ya no está en
 * el arreglo (fue removida por un coordinador), esta función simplemente
 * no la encuentra — "removido" se representa por ausencia, nunca por un
 * campo aparte, consistente con cómo ya funciona `removerResponsables`.
 */
export function encontrarAsignacionPropia(
  asignaciones: AsignacionSolicitud[],
  usuario: UsuarioActivo,
): AsignacionSolicitud | null {
  const encontrada = asignaciones.find((a) =>
    matchesIdentity(usuario.email, String(a.analistaAsignado ?? ''), usuario.usuario),
  );
  return encontrada ?? null;
}

/** true si el usuario figura, activo, en el conjunto ACTUAL de responsables
 * de la solicitud — no implica autorización para ninguna acción concreta,
 * es solo el hecho base que las demás funciones combinan con su propia
 * regla adicional. */
export function esResponsableActivoDeSolicitud(usuario: UsuarioActivo, solicitud: SolicitudConAsignaciones): boolean {
  return encontrarAsignacionPropia(asAsignaciones(solicitud), usuario) !== null;
}

export interface ResultadoAutorizacion {
  autorizado: boolean;
  motivo?: string;
  /** La fila de asignación sobre la que debe operar la acción — solo
   * presente cuando `autorizado` es true y la acción es por-fila. */
  asignacion?: AsignacionSolicitud;
}

/**
 * Autoriza "agregar una observación" a una fila concreta
 * (`idAsignacionObjetivo`). Reglas:
 *  - Administrador funcional de Procesos (Administrador global, Director
 *    Comercial o Coordinador Comercial): autorizado sobre CUALQUIER fila
 *    (útil para corregir o completar en nombre de gestión), pero la
 *    observación se atribuye siempre al usuario real que la agrega, nunca
 *    al `analistaAsignado` de la fila.
 *  - Responsable normal: solo autorizado si `idAsignacionObjetivo` es
 *    exactamente SU PROPIA fila (por identidad) y esa fila sigue presente
 *    en el arreglo actual (no fue removida) y el usuario está Activo.
 *  - En ambos casos: la Solicitud no puede estar en un estado terminal.
 */
export function puedeAgregarObservacion(
  usuario: UsuarioActivo,
  solicitud: SolicitudConAsignaciones,
  idAsignacionObjetivo: string,
): ResultadoAutorizacion {
  if (esEstadoSolicitudTerminal(solicitud.estadoSolicitud)) {
    return { autorizado: false, motivo: 'La solicitud ya está cerrada — no admite nuevas observaciones.' };
  }
  const asignaciones = asAsignaciones(solicitud);
  const fila = asignaciones.find((a) => String(a.idAsignacion ?? '') === idAsignacionObjetivo);
  if (!fila) {
    return { autorizado: false, motivo: 'La asignación indicada no existe o fue removida.' };
  }
  if (esAdministradorProcesos(usuario.rol)) {
    return { autorizado: true, asignacion: fila };
  }
  const propia = encontrarAsignacionPropia(asignaciones, usuario);
  if (!propia || String(propia.idAsignacion ?? '') !== idAsignacionObjetivo) {
    return { autorizado: false, motivo: 'No puedes agregar observaciones a la asignación de otro responsable.' };
  }
  return { autorizado: true, asignacion: propia };
}

/**
 * Autoriza "reenviar a revisión al vaciar la última observación" (Fase
 * 2B-2.1 — `POST /api/solicitudes/[id]/reenviar-revision`). En la práctica
 * esta ruta ES el mecanismo real de "eliminar la última observación restante
 * de una fila" (único caller en `page.tsx`: el botón Eliminar cuando el
 * arreglo queda en `[]`) — por eso, ajuste "editar/eliminar observaciones":
 * autoriza `esAdministradorProcesos` O ser quien CREÓ esa observación
 * (`observaciones[0].usuario` === actor — ser dueño de la FILA/`analistaAsignado`
 * ya NO basta por sí solo, a diferencia de `puedeAgregarObservacion`, que sí
 * lo permite porque agregar no es lo mismo que eliminar una ya existente).
 * Nunca sobre una Solicitud terminal.
 */
export function puedeReenviarRevision(
  usuario: UsuarioActivo,
  solicitud: SolicitudConAsignaciones,
  idAsignacionObjetivo: string,
): ResultadoAutorizacion {
  if (esEstadoSolicitudTerminal(solicitud.estadoSolicitud)) {
    return { autorizado: false, motivo: 'La solicitud ya está cerrada — no admite esta acción.' };
  }
  const asignaciones = asAsignaciones(solicitud);
  const fila = asignaciones.find((a) => String(a.idAsignacion ?? '') === idAsignacionObjetivo);
  if (!fila) {
    return { autorizado: false, motivo: 'La asignación indicada no existe o fue removida.' };
  }
  if (esAdministradorProcesos(usuario.rol)) {
    return { autorizado: true, asignacion: fila };
  }
  const observacionesFila = Array.isArray((fila as Record<string, unknown>).observaciones)
    ? (fila as Record<string, unknown>).observaciones as Array<Record<string, unknown>>
    : [];
  const todasCreadasPorElActor = observacionesFila.length > 0 && observacionesFila.every((obs) =>
    matchesIdentity(usuario.email, String(obs.usuario ?? ''), usuario.usuario),
  );
  if (todasCreadasPorElActor) {
    return { autorizado: true, asignacion: fila };
  }
  return { autorizado: false, motivo: 'Solo un Administrador de Procesos o quien creó la observación puede eliminarla.' };
}

/**
 * Autoriza "finalizar revisión aprobando una observación" (Fase 2B-2.2.1 —
 * `POST /api/solicitudes/[id]/finalizar-revision`, acción `FINALIZAR_REVISION`
 * de `MATRIZ_ACCIONES`: `EN_OBSERVACION → APROBADO_ELABORACION`). Misma
 * regla que `puedeAgregarObservacion`/`puedeReenviarRevision`
 * (administrador funcional de Procesos sobre cualquier fila; responsable
 * normal solo sobre su propia fila; nunca sobre una Solicitud terminal) —
 * función propia, no una llamada a ninguna de esas otras, siguiendo el
 * mismo criterio del resto de este archivo: cada acción tiene su propia
 * función. Deliberadamente NO es `autorizarTransicion` (que autoriza a
 * CUALQUIER responsable activo de la Solicitud, no solo el de la fila
 * objetivo) — esta acción decide sobre la observación de UNA fila
 * concreta, nunca en nombre de otro responsable.
 */
export function puedeFinalizarRevision(
  usuario: UsuarioActivo,
  solicitud: SolicitudConAsignaciones,
  idAsignacionObjetivo: string,
): ResultadoAutorizacion {
  if (esEstadoSolicitudTerminal(solicitud.estadoSolicitud)) {
    return { autorizado: false, motivo: 'La solicitud ya está cerrada — no admite esta acción.' };
  }
  const asignaciones = asAsignaciones(solicitud);
  const fila = asignaciones.find((a) => String(a.idAsignacion ?? '') === idAsignacionObjetivo);
  if (!fila) {
    return { autorizado: false, motivo: 'La asignación indicada no existe o fue removida.' };
  }
  if (esAdministradorProcesos(usuario.rol)) {
    return { autorizado: true, asignacion: fila };
  }
  const propia = encontrarAsignacionPropia(asignaciones, usuario);
  if (!propia || String(propia.idAsignacion ?? '') !== idAsignacionObjetivo) {
    return { autorizado: false, motivo: 'No puedes decidir sobre la observación de la asignación de otro responsable.' };
  }
  return { autorizado: true, asignacion: propia };
}

/**
 * Autoriza "cerrar la solicitud" con cualquier resultado terminal EXCEPTO
 * rechazo — el rechazo (`estadoRevision: 'RECHAZADO'`) tiene su propio
 * permiso, `puedeRechazarSolicitud` (más abajo en este archivo), que en
 * Privados amplía a Director/Coordinador Comercial sin tocar esta función.
 * Ajuste "PERMISOS DE CIERRE — PRIVADOS PARA MERCADEO": la regla se bifurca por `aliasFuente` — `Solicitud` no
 * tiene columna `tipoProceso`, ver el comentario de `SolicitudConAsignaciones`
 * — porque desde esta ronda el cierre de un proceso Privado deja de ser
 * potestad de Comercial:
 *
 *  - Privado DETERMINADO (`aliasFuente` presente y distinto de S1/S2 —
 *    ej. 'NC' al crear manualmente un proceso Privado, o el alias de un
 *    catálogo propio): SOLO Administrador global (`isAdmin`) o Mercadeo
 *    (`esMercadeo`) — Comercial (Director/Coordinador/Analista) NUNCA
 *    cierra un Privado, ni siquiera si figura como responsable activo de
 *    la solicitud (bloqueo total, decisión explícita del usuario — no es
 *    un descuido). La vía "responsable activo" se retira por completo
 *    para Privados: no existe excepción por asignación.
 *  - Público (`aliasFuente` S1 o S2) O ausente/`null` (Solicitudes legado,
 *    o cualquier caller que no lo incluya — decisión explícita del
 *    usuario: "si tipoProceso... está ausente/legado: mantener la lógica
 *    actual", NUNCA se asume Privado por ausencia de dato, a diferencia
 *    del criterio de `dashboard/route.ts`/`colba-stats.ts`, que es solo
 *    de conteo/visualización, no de autorización): se conserva EXACTAMENTE
 *    la regla previa — administrador funcional de Procesos (Administrador
 *    global, Director o Coordinador Comercial) O cualquier responsable
 *    activo — con una única salvedad nueva: Mercadeo no obtiene permiso de
 *    cierre de un Público solo por figurar como responsable (no tiene
 *    facultad de administrador funcional ahí, y la vía de responsable
 *    queda explícitamente vedada para ese rol en este tipo de proceso).
 *
 * Un administrador global (`isAdmin`) sigue autorizado en ambos tipos,
 * consistente con no quitarle ningún permiso que ya tenía.
 */
export function puedeCerrarSolicitud(usuario: UsuarioActivo, solicitud: SolicitudConAsignaciones): ResultadoAutorizacion {
  if (esEstadoSolicitudTerminal(solicitud.estadoSolicitud)) {
    return { autorizado: false, motivo: 'La solicitud ya fue cerrada por otro usuario.' };
  }
  const esPrivadoDeterminado = esProcesoPrivado(solicitud);
  if (esPrivadoDeterminado) {
    if (isAdmin(usuario.rol) || esMercadeo(usuario.rol)) return { autorizado: true };
    return { autorizado: false, motivo: 'Solo Mercadeo o un Administrador pueden cerrar un proceso Privado.' };
  }
  if (esAdministradorProcesos(usuario.rol)) return { autorizado: true };
  if (!esMercadeo(usuario.rol) && esResponsableActivoDeSolicitud(usuario, solicitud)) return { autorizado: true };
  return { autorizado: false, motivo: 'Solo un responsable activo de la solicitud puede cerrarla.' };
}

/**
 * Autoriza específicamente "rechazar la solicitud" (`estadoRevision:
 * 'RECHAZADO'` — rechazo simple con `motivoRechazo` o rechazo con
 * `causalRechazo`/`observacionRechazo`/`urlEvidenciaRechazo`, ambos flujos
 * comparten exactamente este permiso).
 *
 * Ajuste "RECHAZO PRIVADO — DIRECTOR/COORDINADOR COMERCIAL": para un
 * proceso Privado, además de Administrador global y Mercadeo (que ya
 * podían rechazar vía `puedeCerrarSolicitud`), ahora también pueden
 * Director Comercial y Coordinador Comercial — reutilizando
 * `esAdministradorProcesos` (ya definido exactamente como Administrador +
 * Director Comercial + Coordinador Comercial, ver `roles.ts`), nunca una
 * lista de roles nueva. Este permiso queda ACOTADO a la acción de
 * RECHAZAR: no se toca `puedeCerrarSolicitud`, así que Director/Coordinador
 * NO ganan acceso a Adjudicado/No adjudicado/Cancelado/Cerrar sin
 * presentar sobre un Privado — esos siguen exclusivamente para
 * Administrador/Mercadeo, sin cambios.
 *
 * Para proceso Público: se delega íntegramente en `puedeCerrarSolicitud`
 * (mismo motivo, mismo resultado) — el ajuste de esta ronda es
 * exclusivamente para Privados, Público no cambia en absoluto.
 */
export function puedeRechazarSolicitud(usuario: UsuarioActivo, solicitud: SolicitudConAsignaciones): ResultadoAutorizacion {
  if (esEstadoSolicitudTerminal(solicitud.estadoSolicitud)) {
    return { autorizado: false, motivo: 'La solicitud ya fue cerrada por otro usuario.' };
  }
  if (esProcesoPrivado(solicitud)) {
    if (esAdministradorProcesos(usuario.rol) || esMercadeo(usuario.rol)) return { autorizado: true };
    return {
      autorizado: false,
      motivo: 'Solo Mercadeo, un Administrador, el Director Comercial o el Coordinador Comercial pueden rechazar un proceso Privado.',
    };
  }
  return puedeCerrarSolicitud(usuario, solicitud);
}

/** Estados globales en los que se decide la observación (mismo gate visual
 * de `GestionAsignacionInline`: EN_REVISION/CON_OBSERVACIONES). */
const ESTADOS_DECISION_OBSERVACION = new Set(['EN_REVISION', 'EN_OBSERVACION']);

/**
 * Ajuste "DECISIÓN DE OBSERVACIONES — COMERCIAL RESPONSABLE EN PRIVADOS" —
 * autoriza "Observación no aceptada" (rechazo con
 * `decisionObservaciones:'no_aceptada'`). Parte de `puedeRechazarSolicitud`
 * sin quitarle nada y agrega un único caso: en un Privado, el Equipo
 * Comercial (`esEquipoComercial`) puede no aceptar la observación SOLO si es
 * responsable activo de la solicitud y el proceso está en revisión/
 * observación. No amplía el "Rechazar" general ni ningún otro cierre de
 * Privados (Adjudicado/No adjudicado/Cancelado/Cerrar sin presentar).
 */
export function puedeNoAceptarObservacion(usuario: UsuarioActivo, solicitud: SolicitudConAsignaciones): ResultadoAutorizacion {
  const base = puedeRechazarSolicitud(usuario, solicitud);
  if (base.autorizado || esEstadoSolicitudTerminal(solicitud.estadoSolicitud)) return base;
  if (!esProcesoPrivado(solicitud) || !esEquipoComercial(usuario.rol)) return base;
  const estadosFilas = asAsignaciones(solicitud).map((a) => (typeof a.estadoRevision === 'string' ? a.estadoRevision : ''));
  const global = normalizarEstadoSolicitudGlobal(solicitud.estadoSolicitud, estadosFilas);
  if (global.ambiguo || !global.estado || !ESTADOS_DECISION_OBSERVACION.has(global.estado)) {
    return { autorizado: false, motivo: 'La observación solo puede decidirse mientras el proceso está en revisión u observación.' };
  }
  if (!esResponsableActivoDeSolicitud(usuario, solicitud)) {
    return { autorizado: false, motivo: 'Solo el responsable del proceso puede decidir sobre la observación.' };
  }
  return { autorizado: true };
}

/**
 * Facultad ADMINISTRATIVA de reasignar (agregar/quitar responsables) —
 * misma regla que ya existía en el frontend (`puedeAsignar`), centralizada
 * acá para que el backend la use también.
 */
export function puedeReasignarSolicitud(rol: string, permisosRol?: Record<string, boolean>): boolean {
  return esAdministradorProcesos(rol)
    || puedeConBD(rol, 'asignaciones', 'asignar', permisosRol);
}
/** Resultado explicativo de `puedeRevisarProceso` — nunca solo un booleano,
 * para que la UI (y las pruebas) puedan distinguir POR QUÉ se autorizó. */
export interface ResultadoAutorizacionRevision extends ResultadoAutorizacion {
  esResponsable: boolean;
  esSupervisorComercial: boolean;
  esAdministrador: boolean;
}

/**
 * Autoriza "abrir/consultar el panel de revisión" de una solicitud —
 * núcleo de "Revisar proceso" (VistFichaAsignacion). Autorizado cuando:
 *  - el usuario es administrador funcional de Procesos (Administrador
 *    global, Director Comercial o Coordinador Comercial), sobre CUALQUIER
 *    solicitud, tenga o no una fila propia; o
 *  - el usuario figura, activo, como responsable de esta solicitud
 *    (`esResponsableActivoDeSolicitud`), sin importar su rol.
 *
 * `esResponsable`/`esSupervisorComercial`/`esAdministrador` en el resultado
 * son campos informativos (para trazabilidad/tests), no implican por sí
 * solos autorización para ninguna acción interna del panel — cada acción
 * (`puedeAgregarObservacion`/`puedeCerrarSolicitud`/`puedeReasignarSolicitud`)
 * se sigue evaluando por separado.
 */
export function puedeRevisarProceso(
  usuario: UsuarioActivo,
  solicitud: SolicitudConAsignaciones,
): ResultadoAutorizacionRevision {
  const esAdministrador = isAdmin(usuario.rol);
  const esSupervisorComercial = !esAdministrador && esAdministradorProcesos(usuario.rol);
  const esResponsable = esResponsableActivoDeSolicitud(usuario, solicitud);
  const autorizado = esAdministrador || esSupervisorComercial || esResponsable;
  return {
    autorizado,
    esResponsable,
    esSupervisorComercial,
    esAdministrador,
    motivo: autorizado
      ? undefined
      : 'No tienes acceso a esta solicitud: no eres responsable activo ni tienes un rol autorizado (Administrador, Director Comercial, Coordinador Comercial).',
  };
}

/** true si el usuario puede gestionar CUALQUIER fila de `asignaciones[]`
 * de esta solicitud (no solo la propia) — administrador funcional de
 * Procesos. Útil para el frontend (selector de asignaciones, botones de
 * acción sobre filas ajenas) y para pruebas; el backend de cada acción
 * concreta (`puedeAgregarObservacion`/`puedeCerrarSolicitud`) sigue siendo
 * la autoridad real. */
export function puedeGestionarCualquierAsignacion(usuario: UsuarioActivo): boolean {
  return esAdministradorProcesos(usuario.rol);
}
