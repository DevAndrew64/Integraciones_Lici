/**
 * Selección de "cuál fila de asignaciones se muestra/acciona" en la ficha —
 * extraída de `VistFichaAsignacion` (page.tsx) para poder probarla sin
 * infraestructura de componentes React. Es puramente de UI: el backend
 * (`@/lib/solicitudes/autorizacion-asignacion`) vuelve a validar todo de
 * forma independiente en cada endpoint, esto nunca es la fuente de verdad
 * de autorización — solo decide qué se muestra.
 */
import { esMercadeo } from '@/lib/roles';

export interface AsignacionSeleccionable {
  idAsignacion?: unknown;
  analistaAsignado?: unknown;
  [key: string]: unknown;
}

export interface IdentidadUsuarioSesion {
  email: string;
  usuario: string;
  rol: string;
}

const ROLES_PRIVILEGIADOS_ASIGNACION = ['Administrador', 'Director Comercial', 'Coordinador Comercial'];

export function esRolPrivilegiadoParaAsignacion(rol: string): boolean {
  return ROLES_PRIVILEGIADOS_ASIGNACION.includes(rol);
}

/** Mismo criterio que `matchesIdentity` del backend: email completo, prefijo de email, o username real. */
export function coincideIdentidad(candidato: string, usuario: IdentidadUsuarioSesion): boolean {
  const val = candidato.trim().toLowerCase();
  if (!val) return false;
  const email = (usuario.email || '').trim().toLowerCase();
  if (val === email) return true;
  const at = email.indexOf('@');
  if (at > 0 && val === email.slice(0, at)) return true;
  const usr = (usuario.usuario || '').trim().toLowerCase();
  if (usr && val === usr) return true;
  return false;
}

/** Ajuste "La implementación presenta un error visible después del cambio
 * de administradores funcionales de Procesos" — una fila "válida" exige
 * como mínimo `idAsignacion` y `analistaAsignado` no vacíos. No existe hoy
 * en el modelo ningún campo explícito de "removida/anulada/inválida"
 * (documentado ya en `autorizacion-asignacion.ts`: "removido se representa
 * por ausencia, nunca por un campo aparte") — si en el futuro se agrega uno,
 * debe filtrarse aquí también. */
export function esAsignacionValida(a: AsignacionSeleccionable): boolean {
  const id = typeof a.idAsignacion === 'string' ? a.idAsignacion.trim() : String(a.idAsignacion ?? '').trim();
  const analista = typeof a.analistaAsignado === 'string' ? a.analistaAsignado.trim() : String(a.analistaAsignado ?? '').trim();
  return !!id && !!analista;
}

/** Deduplica por `idAsignacion` (conserva la primera aparición) — un mismo
 * `idAsignacion` repetido nunca debe contarse dos veces al decidir si hay
 * "una" o "varias" asignaciones. */
function deduplicarPorIdAsignacion<T extends AsignacionSeleccionable>(asignaciones: T[]): T[] {
  const vistos = new Set<string>();
  const resultado: T[] = [];
  for (const a of asignaciones) {
    const id = String(a.idAsignacion ?? '');
    if (vistos.has(id)) continue;
    vistos.add(id);
    resultado.push(a);
  }
  return resultado;
}

export interface ResultadoSeleccionAsignacion<T extends AsignacionSeleccionable> {
  /** Asignaciones crudas ya filtradas (idAsignacion/analistaAsignado no
   * vacíos) y deduplicadas por idAsignacion — única fuente que debe usarse
   * para contar "cuántas asignaciones hay" o para renderizar el selector
   * (nunca el arreglo crudo de `Solicitud.asignaciones`). */
  asignacionesValidas: T[];
  /** La fila del propio usuario autenticado, o null si no tiene ninguna. */
  asignacionPropia: T | null;
  /** La fila que un admin/coordinador SIN fila propia eligió explícitamente en el selector. */
  asignacionSeleccionadaPrivilegiado: T | null;
  /** La fila efectivamente visible/accionable — null si ninguna aplica (nunca cae a la última por defecto). */
  asigActual: T | null;
  /** true cuando lo mostrado es una fila ajena que un privilegiado consulta (elegida explícitamente, o la única fila válida existente) — nunca se le atribuye como si fuera el analista. */
  consultandoComoPrivilegiado: boolean;
  /** true SOLO cuando hay 2+ asignaciones válidas y un privilegiado sin fila propia aún no ha elegido — debe ver el selector. Con 0 o 1 fila válida nunca es true (0: nada que elegir; 1: se autoselecciona). */
  requiereSeleccionPrivilegiado: boolean;
}

/**
 * Reglas (todas verificadas también en el backend, esto es solo UI):
 *  - Responsable normal → su propia fila (por identidad), nunca la última del arreglo.
 *  - Admin/Director/Coordinador Comercial CON fila propia → su propia fila
 *    (igual que cualquier responsable).
 *  - Admin/Director/Coordinador Comercial SIN fila propia:
 *    - 0 asignaciones válidas → `asigActual=null`, sin selector (nada que elegir).
 *    - 1 asignación válida → se AUTOSELECCIONA (nunca requiere un clic
 *      adicional para ver al único responsable existente), sin selector.
 *    - 2+ asignaciones válidas → `asigActual=null` hasta que elija
 *      explícitamente vía `idAsignacionElegida`; `requiereSeleccionPrivilegiado=true`
 *      mientras tanto — NUNCA se cae a la primera/última fila por defecto.
 *  - Usuario no privilegiado sin fila propia → `asigActual=null`, ninguna fila accionable.
 *  - Ajuste "CIERRE DE PRIVADOS PARA MERCADEO" — Mercadeo (`esMercadeo`,
 *    `@/lib/roles`) SIN fila propia sigue las MISMAS reglas de conteo que
 *    Admin/Director/Coordinador (autoselección con 1, selector con 2+, null
 *    con 0) pero el universo de filas candidatas es distinto y más
 *    estrecho: SOLO filas con `estadoRevision==='PRESENTADO'` — nunca
 *    cualquier fila válida. Mercadeo no es `esRolPrivilegiadoParaAsignacion`
 *    (eso sigue significando exclusivamente "administrador funcional de
 *    Procesos") — es una categoría aparte, acotada al único momento en que
 *    Mercadeo está autorizado a registrar un resultado sobre la fila de
 *    otro responsable (`puedeCerrarSolicitud`, backend, Privado). Una fila
 *    histórica/inactiva (cualquier `estadoRevision` distinto de
 *    'PRESENTADO') NUNCA es candidata para Mercadeo, aunque sí lo sea para
 *    Admin/Director/Coordinador.
 *  - Filas sin `idAsignacion`/`analistaAsignado`, o con `idAsignacion` duplicado,
 *    se descartan/deduplican ANTES de aplicar cualquiera de las reglas
 *    anteriores — nunca cuentan para decidir "una" vs. "varias".
 */
/**
 * Normaliza la identidad de un responsable para comparar/ordenar/deduplicar
 * — minúsculas + espacios colapsados/recortados. El modelo actual de
 * `asignaciones[]` NO tiene ningún `userId` numérico (auditado: no existe
 * ese campo en ninguna fila) — `analistaAsignado` (usuario) normalizado es
 * la identidad más fuerte disponible sin migrar el esquema. `idAsignacion`
 * es SOLO un dato auxiliar, nunca la clave de identidad: un `idAsignacion`
 * duplicado entre DOS USUARIOS DISTINTOS nunca debe fusionarlos (hallazgo
 * de auditoría: ya se encontró un caso de ID de asignación duplicado).
 */
export function normalizarUsuarioIdentidad(u: unknown): string {
  return (typeof u === 'string' ? u : String(u ?? '')).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Ajuste "eliminar el selector de asignaciones del flujo operativo" — fuente
 * ÚNICA para contar/listar responsables ACTIVOS: filtra filas inválidas
 * (`esAsignacionValida`), excluye las marcadas `activo:false` (ausente =
 * activa, compatibilidad histórica), y deduplica por USUARIO NORMALIZADO
 * (nunca por `idAsignacion`) — dos filas del mismo usuario (aunque tengan
 * `idAsignacion` distintos, por una inconsistencia histórica) cuentan como
 * UN responsable; dos usuarios distintos que accidentalmente compartan el
 * mismo `idAsignacion` NUNCA se fusionan. Orden determinístico: usuario
 * normalizado, con `idAsignacion` como desempate — el mismo conjunto de
 * filas produce exactamente el mismo resultado sin importar el orden de
 * entrada (`[Laura,Juan]` y `[Juan,Laura]` dan la misma lista). Nunca usar
 * `asignaciones.length` ni `asignaciones[0]`/`[length-1]` para esto.
 */
export function obtenerResponsablesActivos<T extends AsignacionSeleccionable>(asignacionesCrudas: T[]): T[] {
  const validas = asignacionesCrudas.filter(esAsignacionValida).filter((a) => a.activo !== false);
  const vistos = new Set<string>();
  const resultado: T[] = [];
  for (const a of validas) {
    const key = normalizarUsuarioIdentidad(a.analistaAsignado);
    if (vistos.has(key)) continue; // mismo usuario ya visto (por identidad, no por idAsignacion) — no se duplica
    vistos.add(key);
    resultado.push(a);
  }
  return resultado.sort((a, b) => {
    const u = normalizarUsuarioIdentidad(a.analistaAsignado).localeCompare(normalizarUsuarioIdentidad(b.analistaAsignado));
    if (u !== 0) return u;
    return String(a.idAsignacion ?? '').localeCompare(String(b.idAsignacion ?? ''));
  });
}

export function seleccionarAsignacionVisible<T extends AsignacionSeleccionable>(
  asignacionesCrudas: T[],
  usuario: IdentidadUsuarioSesion,
  idAsignacionElegida: string | null,
): ResultadoSeleccionAsignacion<T> {
  const asignaciones = deduplicarPorIdAsignacion(asignacionesCrudas.filter(esAsignacionValida));
  const asignacionPropia = asignaciones.find((a) => coincideIdentidad(String(a.analistaAsignado ?? ''), usuario)) ?? null;
  const privilegiado = esRolPrivilegiadoParaAsignacion(usuario.rol);

  // Ajuste "CIERRE DE PRIVADOS PARA MERCADEO" — Mercadeo sin fila propia
  // entra al mismo mecanismo de selección/autoselección que Admin/Director/
  // Coordinador, pero SOLO puede elegir entre filas PRESENTADAS (nunca
  // cualquier fila válida) — es el único estado sobre el que Mercadeo está
  // autorizado a registrar un resultado (`puedeCerrarSolicitud`, backend).
  // `esRolPrivilegiadoParaAsignacion` NO se toca ni se reutiliza para esto:
  // sigue significando exclusivamente "administrador funcional de
  // Procesos" — Mercadeo es una categoría de selección aparte, nunca se
  // convierte en "privilegiado" general (no aplica a la vista de rechazo ni
  // a ningún otro camino que dependa de ese concepto).
  const mercadeoSinFilaPropia = esMercadeo(usuario.rol) && !asignacionPropia;
  const candidatasMercadeo = mercadeoSinFilaPropia
    ? asignaciones.filter((a) => String(a.estadoRevision ?? '') === 'PRESENTADO')
    : [];

  const universoSeleccion = mercadeoSinFilaPropia ? candidatasMercadeo : asignaciones;
  const puedeSeleccionar = privilegiado || mercadeoSinFilaPropia;

  const asignacionSeleccionadaPrivilegiado = (puedeSeleccionar && !asignacionPropia && idAsignacionElegida)
    ? (universoSeleccion.find((a) => String(a.idAsignacion ?? '') === idAsignacionElegida) ?? null)
    : null;

  // Único caso nuevo — privilegiado (o Mercadeo, sobre su universo
  // restringido a PRESENTADO) sin fila propia y EXACTAMENTE una fila
  // candidata: se autoselecciona (nunca cuando hay 0 ni cuando hay 2+).
  const unicaAsignacionAutoseleccionable = (puedeSeleccionar && !asignacionPropia && universoSeleccion.length === 1)
    ? universoSeleccion[0]
    : null;

  const asigActual = asignacionPropia ?? asignacionSeleccionadaPrivilegiado ?? unicaAsignacionAutoseleccionable ?? null;
  const consultandoComoPrivilegiado = !asignacionPropia && (!!asignacionSeleccionadaPrivilegiado || !!unicaAsignacionAutoseleccionable);
  const requiereSeleccionPrivilegiado = puedeSeleccionar && !asignacionPropia && !idAsignacionElegida && universoSeleccion.length > 1;

  return { asignacionesValidas: asignaciones, asignacionPropia, asignacionSeleccionadaPrivilegiado, asigActual, consultandoComoPrivilegiado, requiereSeleccionPrivilegiado };
}