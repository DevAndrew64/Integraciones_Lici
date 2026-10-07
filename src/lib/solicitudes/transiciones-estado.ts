/**
 * FASE 2 — Autoridad server-side para TRANSICIONES INTERMEDIAS del estado
 * global de una Solicitud (`Solicitud.estadoSolicitud`).
 *
 * Deliberadamente NO cubre cierres/rechazos/cancelaciones/adjudicaciones —
 * esos siguen pasando por `POST /api/solicitudes/[id]/cerrar`, que ya tiene
 * su propia matriz de resultados, `resultadoFinal`/`causalCierre`, CAS y
 * auditoría. Este servicio solo resuelve las 8 transiciones intermedias de
 * Validación/Ejecución (ver `MATRIZ_ACCIONES`).
 *
 * El frontend nunca elige el `estadoNuevo` — solo indica una ACCIÓN de
 * negocio (`accion`) y el estado que cree que es el actual
 * (`estadoEsperadoCrudo`, para detectar concurrencia). El servidor resuelve
 * `accion + estado actual real (en BD) → estado nuevo` a partir de
 * `MATRIZ_ACCIONES` — nunca acepta el estado nuevo como dato.
 */
import type { Prisma } from '@prisma/client';
import {
  type EstadoCanonico, normalizarEstadoSolicitud, normalizarEstadoSolicitudGlobal, obtenerEtapaProceso,
  estadoRevisionLegadoEquivalente,
} from './estados-canonicos';
import {
  type UsuarioActivo, type SolicitudConAsignaciones,
  esAdministradorProcesos, esResponsableActivoDeSolicitud,
} from './autorizacion-asignacion';
import { coordinarCierreSqrParaPresentar } from './cierre-sqr-al-presentar';

export const ACCIONES_TRANSICION = [
  'INICIAR_REVISION', 'ENVIAR_A_OBSERVACION', 'REENVIAR_REVISION', 'FINALIZAR_REVISION',
  'APROBAR_SIN_OBSERVACIONES', 'APROBAR_PARA_ELABORACION', 'INICIAR_ELABORACION', 'PRESENTAR',
] as const;
export type AccionTransicion = typeof ACCIONES_TRANSICION[number];

/** acción → (estado canónico requerido, estado canónico resultante).
 * Única fuente de esta matriz en todo el proyecto — ni `page.tsx` ni ningún
 * endpoint deben volver a codificarla por su cuenta. */
export const MATRIZ_ACCIONES: Record<AccionTransicion, { desde: EstadoCanonico; hasta: EstadoCanonico }> = {
  INICIAR_REVISION:          { desde: 'ASIGNADO_REVISION',   hasta: 'EN_REVISION' },
  ENVIAR_A_OBSERVACION:      { desde: 'EN_REVISION',         hasta: 'EN_OBSERVACION' },
  APROBAR_SIN_OBSERVACIONES: { desde: 'EN_REVISION',         hasta: 'APROBADO_ELABORACION' },
  REENVIAR_REVISION:         { desde: 'EN_OBSERVACION',      hasta: 'EN_REVISION' },
  // Regla funcional aclarada: ya no existe aprobación posterior de
  // Coordinador/Director Comercial entre observación y ejecución — el
  // responsable que termina la revisión envía el proceso directo a
  // ejecución. Se conserva el nombre de la acción (auditoría/permisos
  // sin cambios) pero su efecto ya no deja al proceso esperando una
  // segunda aprobación (REVISION_FINALIZADA); pasa directo a
  // APROBADO_ELABORACION, igual que APROBAR_SIN_OBSERVACIONES.
  FINALIZAR_REVISION:        { desde: 'EN_OBSERVACION',      hasta: 'APROBADO_ELABORACION' },
  // Se conserva únicamente por compatibilidad con los 8 registros
  // históricos que aún puedan resolver a REVISION_FINALIZADA vía el
  // alias legado LISTO_PARA_VALIDAR — ninguna transición nueva vuelve a
  // producir ese estado (ver arriba).
  APROBAR_PARA_ELABORACION:  { desde: 'REVISION_FINALIZADA', hasta: 'APROBADO_ELABORACION' },
  INICIAR_ELABORACION:       { desde: 'APROBADO_ELABORACION',hasta: 'EN_ELABORACION' },
  PRESENTAR:                 { desde: 'EN_ELABORACION',      hasta: 'PRESENTADO' },
};

function esAccionValida(v: unknown): v is AccionTransicion {
  return typeof v === 'string' && (ACCIONES_TRANSICION as readonly string[]).includes(v);
}

/**
 * Resuelve `accion` contra el estado canónico ACTUAL (ya normalizado, sin
 * importar si venía legado o canónico) — nunca contra un `estadoNuevo`
 * enviado por el cliente.
 */
export function resolverTransicion(
  accion: string,
  estadoActualCanonico: EstadoCanonico | null,
): { ok: true; desde: EstadoCanonico; hasta: EstadoCanonico } | { ok: false; error: string } {
  if (!esAccionValida(accion)) {
    return { ok: false, error: `Acción de transición desconocida: "${accion}".` };
  }
  if (estadoActualCanonico == null) {
    return { ok: false, error: 'El estado actual de la solicitud no se pudo interpretar (dato desconocido).' };
  }
  const { desde, hasta } = MATRIZ_ACCIONES[accion];
  if (estadoActualCanonico !== desde) {
    return { ok: false, error: `La acción "${accion}" requiere el estado "${desde}"; el estado actual es "${estadoActualCanonico}".` };
  }
  return { ok: true, desde, hasta };
}

/** Autorización operativa — igual regla que el resto del módulo Procesos:
 * administrador funcional de Procesos, o responsable activo de la propia
 * solicitud. Nunca depende de `idAsignacion` seleccionado. */
export function autorizarTransicion(
  usuario: UsuarioActivo,
  solicitud: SolicitudConAsignaciones,
): { autorizado: boolean; motivo?: string } {
  if (esAdministradorProcesos(usuario.rol)) return { autorizado: true };
  if (esResponsableActivoDeSolicitud(usuario, solicitud)) return { autorizado: true };
  return { autorizado: false, motivo: 'No tienes acceso a esta solicitud: no eres responsable activo ni tienes un rol autorizado (Administrador, Director Comercial, Coordinador Comercial).' };
}

export interface EventoTransicionAudit {
  accion: 'ESTADO_CAMBIADO';
  solicitudId: number;
  procesoId: number | null;
  accionFlujo: AccionTransicion;
  estadoAnterior: string;
  estadoNuevo: EstadoCanonico;
  etapaAnterior: string | null;
  etapaNueva: string | null;
  actorUserId: number;
  actorUsuario: string;
  actorEmail: string;
  actorRol: string;
  fecha: string;
  motivo: string | null;
  requestId: string | null;
}

/** Duck-typed a propósito (no `PrismaClient` estricto) — así se puede probar
 * el servicio con un `fakeImpl` en pruebas unitarias, igual patrón que el
 * resto del módulo Procesos (`cerrar/route.test.ts`). */
export interface DbTransiciones {
  solicitud: {
    findUnique(args: { where: { id: number } }): Promise<Record<string, unknown> | null>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  auditLog: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $transaction<T>(cb: (tx: DbTransiciones) => Promise<T>): Promise<T>;
}

export type ResultadoTransicion =
  | { ok: true; estadoAnterior: string; estadoNuevo: EstadoCanonico; solicitud: Record<string, unknown> }
  | { ok: false; status: 400 | 403 | 404 | 409 | 422 | 500 | 502; error: string };

const MENSAJE_ESTADO_AMBIGUO = 'Los datos históricos de este proceso son ambiguos (las asignaciones activas tienen subestados contradictorios) — no se puede determinar el subestado exacto. Corrige la inconsistencia antes de continuar.';

/**
 * Ejecuta una transición intermedia de forma transaccional:
 *  1. Lock de fila (`SELECT ... FOR UPDATE`) + relectura fresca.
 *  2. Re-valida autorización y matriz contra el estado REAL en BD (nunca el
 *     leído antes de entrar a la transacción, que pudo quedar obsoleto).
 *  3. CAS: `updateMany` con `estadoSolicitud` igual al valor exacto recién
 *     leído — si otra transacción ganó la carrera entre la lectura y el
 *     lock, `count===0` y se responde 409 sin escribir nada.
 *  4. Escribe `estadoSolicitud` con el valor CANÓNICO nuevo (nunca legado) —
 *     ver diseño aprobado "Fase 2: el servidor escribe únicamente valores
 *     canónicos".
 *  5. AuditLog dentro de la MISMA transacción — si falla, Prisma revierte
 *     automáticamente el `updateMany` anterior (todo o nada).
 */
export async function ejecutarTransicionEstado(params: {
  db: DbTransiciones;
  solicitudId: number;
  accion: string;
  estadoEsperadoCrudo: string;
  actor: UsuarioActivo;
  motivo?: string | null;
  requestId?: string | null;
}): Promise<ResultadoTransicion> {
  const { db, solicitudId, accion, estadoEsperadoCrudo, actor, motivo, requestId } = params;

  const solicitudPrevia = await db.solicitud.findUnique({ where: { id: solicitudId } });
  if (!solicitudPrevia) return { ok: false, status: 404, error: 'Solicitud no encontrada.' };

  const auth = autorizarTransicion(actor, solicitudPrevia as unknown as SolicitudConAsignaciones);
  if (!auth.autorizado) return { ok: false, status: 403, error: auth.motivo ?? 'No autorizado.' };

  // Pre-chequeo (fuera de la transacción, barato). La resolución del estado
  // canónico usa SIEMPRE el conjunto completo de `estadoRevision` de las
  // filas activas (`normalizarEstadoSolicitudGlobal`) — nunca una sola fila
  // — para que el backend rechace la MISMA ambigüedad que ya bloquea el
  // frontend, y no solo confíe en que el cliente no la envíe.
  const resolucionPrevia = normalizarEstadoSolicitudGlobal(
    String(solicitudPrevia.estadoSolicitud ?? ''),
    todasLasFilasEstadoRevision(solicitudPrevia.asignaciones),
  );
  if (resolucionPrevia.ambiguo) {
    return { ok: false, status: 422, error: MENSAJE_ESTADO_AMBIGUO };
  }
  const estadoCanonicoPrevio = resolucionPrevia.estado;
  if (normalizarEstadoSolicitud(estadoEsperadoCrudo) !== estadoCanonicoPrevio) {
    return {
      ok: false, status: 409,
      error: 'El proceso fue actualizado por otro usuario. Recarga la información antes de continuar.',
    };
  }
  const resolPrevia = resolverTransicion(accion, estadoCanonicoPrevio);
  if (!resolPrevia.ok) return { ok: false, status: 400, error: resolPrevia.error };

  // Ajuste "CIERRE DE SQR AL PRESENTAR" §1/§10/§11 (confirmado
  // explícitamente) — orden crítico: si la solicitud tiene una SQR
  // abierta, se cierra PRIMERO en GrupoColba (con evidencia + respuesta
  // automática); solo si eso confirma éxito (o no aplica: sin SQR, o ya
  // cerrada) se continúa con la transición EN_ELABORACION→PRESENTADO más
  // abajo. Nunca al revés — nunca se presenta el proceso y se intenta
  // cerrar la SQR después. Exclusivo de `PRESENTAR`: las otras 7
  // transiciones intermedias no tocan nada de SQR.
  if (accion === 'PRESENTAR') {
    const gate = await coordinarCierreSqrParaPresentar({ db, solicitudId, actor, requestId });
    if (!gate.ok) return { ok: false, status: gate.status, error: gate.error };
  }

  const resultado = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Solicitud" WHERE id = ${solicitudId} FOR UPDATE`;
    const fresh = await tx.solicitud.findUnique({ where: { id: solicitudId } });
    if (!fresh) return { tipo: 'no_encontrada' as const };

    const resolucionFresh = normalizarEstadoSolicitudGlobal(
      String(fresh.estadoSolicitud ?? ''),
      todasLasFilasEstadoRevision(fresh.asignaciones),
    );
    if (resolucionFresh.ambiguo) return { tipo: 'ambiguo' as const };
    const estadoCanonicoFresh = resolucionFresh.estado;
    const resol = resolverTransicion(accion, estadoCanonicoFresh);
    if (!resol.ok) return { tipo: 'conflicto' as const };

    const estadoAnteriorCrudo = String(fresh.estadoSolicitud ?? '');

    // Compatibilidad temporal (punto 7, autorizada): refleja el estado
    // legado equivalente en TODAS las filas de `asignaciones[]` — nunca
    // solo la primera/última, nunca según `idAsignacion` seleccionado — sin
    // tocar observaciones/evidencias/datos de responsables de cada fila.
    const legadoEquivalente = estadoRevisionLegadoEquivalente(resol.hasta);
    const asignacionesActuales = Array.isArray(fresh.asignaciones) ? (fresh.asignaciones as Record<string, unknown>[]) : [];
    const ahoraIso = new Date().toISOString();
    const asignacionesEspejadas = legadoEquivalente
      ? asignacionesActuales.map((a) => ({ ...a, estadoRevision: legadoEquivalente, ultimaActualizacion: ahoraIso, gestionadoPor: actor.usuario }))
      : asignacionesActuales;

    const cas = await tx.solicitud.updateMany({
      where: { id: solicitudId, estadoSolicitud: estadoAnteriorCrudo },
      data: {
        estadoSolicitud: resol.hasta,
        ...(legadoEquivalente ? { asignaciones: asignacionesEspejadas as unknown as Prisma.InputJsonValue } : {}),
        // Ajuste "ESTADO FINAL SQR (booleano)" — la ÚNICA fuente de `true`
        // es esta transición real (nunca se infiere de haber llegado
        // después a otro estado). Cierres posteriores (CERRADO_ADJUDICADO/
        // CERRADO_NO_ADJUDICADO) nunca vuelven a tocar este campo — ver
        // `/[id]/cerrar/route.ts`.
        ...(accion === 'PRESENTAR' ? { estadoFinalSqr: true } : {}),
        updatedAt: new Date(),
      },
    });
    if (cas.count === 0) return { tipo: 'conflicto' as const };

    const actualizada = await tx.solicitud.findUnique({ where: { id: solicitudId } });

    const evento: EventoTransicionAudit = {
      accion: 'ESTADO_CAMBIADO',
      solicitudId,
      procesoId: (fresh.procesoId as number | null) ?? null,
      accionFlujo: accion as AccionTransicion,
      estadoAnterior: estadoAnteriorCrudo,
      estadoNuevo: resol.hasta,
      etapaAnterior: obtenerEtapaProceso(estadoCanonicoFresh),
      etapaNueva: obtenerEtapaProceso(resol.hasta),
      actorUserId: actor.id,
      actorUsuario: actor.usuario,
      actorEmail: actor.email,
      actorRol: actor.rol,
      fecha: ahoraIso,
      motivo: motivo ?? null,
      requestId: requestId ?? null,
    };
    // Si esto falla, Prisma revierte toda la transacción (incluido el
    // `updateMany` de arriba) — nunca queda un cambio de estado sin auditar.
    await tx.auditLog.create({
      data: {
        usuarioId: actor.id, email: actor.email, rol: actor.rol,
        accion: 'solicitud_transicion_estado', recurso: 'solicitud', recursoId: String(solicitudId),
        metodo: 'POST', detalle: evento as unknown as Record<string, unknown>,
      },
    });

    return { tipo: 'ok' as const, solicitud: actualizada as Record<string, unknown>, estadoAnterior: estadoAnteriorCrudo, estadoNuevo: resol.hasta };
  });

  if (resultado.tipo === 'no_encontrada') return { ok: false, status: 404, error: 'Solicitud no encontrada.' };
  if (resultado.tipo === 'ambiguo') return { ok: false, status: 422, error: MENSAJE_ESTADO_AMBIGUO };
  if (resultado.tipo === 'conflicto') {
    return { ok: false, status: 409, error: 'El proceso fue actualizado por otro usuario. Recarga la información antes de continuar.' };
  }
  return { ok: true, estadoAnterior: resultado.estadoAnterior, estadoNuevo: resultado.estadoNuevo, solicitud: resultado.solicitud };
}

function todasLasFilasEstadoRevision(asignaciones: unknown): string[] {
  if (!Array.isArray(asignaciones)) return [];
  return asignaciones.map((a) => {
    const v = (a as Record<string, unknown>)?.estadoRevision;
    return typeof v === 'string' ? v : '';
  });
}