/**
 * FASE 1 — Compatibilidad de lectura del estado global de `Solicitud`.
 *
 * Puramente aditivo: no escribe nada, no reemplaza ninguna escritura
 * existente. Da un dominio canónico de `estadoSolicitud` y una función de
 * normalización capaz de interpretar tanto los valores legados (texto libre
 * en español, ej. "Asignado para revisión") como los valores canónicos
 * nuevos (ej. `ASIGNADO_REVISION`) — mientras el backend siga escribiendo
 * solo legado (Fase 1/2 aún no cambia escrituras), esta función siempre
 * debe devolver el mismo resultado que produciría leer el dato tal cual.
 *
 * Diseño aprobado (Alternativa A): `Solicitud.estadoSolicitud` es la única
 * fuente del estado global — `asignaciones[]` nunca determina la etapa.
 * `ultimoEstadoRevision` (parámetro opcional) solo se usa para desambiguar,
 * en modo LECTURA, el caso legado en que `estadoSolicitud='Asignado para
 * revisión'` puede corresponder a 3 subestados distintos según la última
 * fila de `asignaciones[]` — nunca se usa para decidir autorización ni para
 * escribir nada.
 */

export type EstadoCanonico =
  | 'SELECCION_PROCESO' | 'REVISION_COMERCIAL'
  | 'ASIGNADO_REVISION' | 'EN_REVISION' | 'EN_OBSERVACION' | 'REVISION_FINALIZADA'
  | 'APROBADO_ELABORACION' | 'EN_ELABORACION'
  | 'PRESENTADO'
  | 'CERRADA' | 'CANCELADA';

export type EtapaProceso = 'PRESELECCION' | 'VALIDACION' | 'EJECUCION' | 'EVALUACION' | 'CIERRE';

export const ESTADOS_CANONICOS: readonly EstadoCanonico[] = [
  'SELECCION_PROCESO', 'REVISION_COMERCIAL',
  'ASIGNADO_REVISION', 'EN_REVISION', 'EN_OBSERVACION', 'REVISION_FINALIZADA',
  'APROBADO_ELABORACION', 'EN_ELABORACION',
  'PRESENTADO',
  'CERRADA', 'CANCELADA',
];

const SET_ESTADOS_CANONICOS = new Set<string>(ESTADOS_CANONICOS);

export const ETAPA_POR_ESTADO: Record<EstadoCanonico, EtapaProceso> = {
  SELECCION_PROCESO: 'PRESELECCION',
  REVISION_COMERCIAL: 'PRESELECCION',
  ASIGNADO_REVISION: 'VALIDACION',
  EN_REVISION: 'VALIDACION',
  EN_OBSERVACION: 'VALIDACION',
  REVISION_FINALIZADA: 'VALIDACION',
  APROBADO_ELABORACION: 'EJECUCION',
  EN_ELABORACION: 'EJECUCION',
  PRESENTADO: 'EVALUACION',
  CERRADA: 'CIERRE',
  CANCELADA: 'CIERRE',
};

/** Índice de fase del stepper (`FASES_SOL_COMERCIAL`, `page.tsx`) para cada
 * estado canónico. `REVISION_FINALIZADA` ya no tiene paso visual propio
 * (regla funcional aclarada: sin aprobación posterior de Coordinador/
 * Director) — comparte índice con `APROBADO_ELABORACION` ("Asignado para
 * elaboración"), así los 8 registros históricos en ese estado (vía el
 * alias legado `LISTO_PARA_VALIDAR`) se muestran ahí, sin backfill. */
export const FASE_IDX_POR_ESTADO: Record<EstadoCanonico, number> = {
  SELECCION_PROCESO: 0,
  REVISION_COMERCIAL: 1,
  ASIGNADO_REVISION: 2,
  EN_REVISION: 2,
  EN_OBSERVACION: 3,
  REVISION_FINALIZADA: 4,
  APROBADO_ELABORACION: 4,
  EN_ELABORACION: 5,
  PRESENTADO: 6,
  CERRADA: 8,
  CANCELADA: 8,
};

/** Alias legados de `estadoRevision` (snake_case) que ya circulan como valor
 * crudo en algunos puntos del código — se mapean 1:1 o a su equivalente
 * canónico más cercano. `LISTO_PRESENTAR` está confirmado como alias sin
 * ninguna escritura viva (solo aparece en diccionarios de etiqueta), se
 * conserva aquí únicamente por si alguna fila legada llegara a tenerlo. */
const ALIAS_ESTADO_REVISION: Record<string, EstadoCanonico> = {
  ASIGNADO_REVISION: 'ASIGNADO_REVISION',
  EN_REVISION: 'EN_REVISION',
  CON_OBSERVACIONES: 'EN_OBSERVACION',
  LISTO_PARA_VALIDAR: 'REVISION_FINALIZADA',
  APROBADO_ELABORACION: 'APROBADO_ELABORACION',
  EN_ELABORACION: 'EN_ELABORACION',
  PRESENTADO: 'PRESENTADO',
  LISTO_PRESENTAR: 'PRESENTADO',
};

function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Texto libre de `Solicitud.estadoSolicitud` tal como existe hoy en BD, normalizado. */
const MAPA_ESTADO_SOLICITUD_LEGADO: Record<string, EstadoCanonico> = {
  '': 'SELECCION_PROCESO',
  'seleccion de proceso': 'SELECCION_PROCESO',
  'revision comercial': 'REVISION_COMERCIAL',
  'asignado para revision': 'ASIGNADO_REVISION', // refinado por ultimoEstadoRevision, ver normalizarEstadoSolicitud
  'en observacion': 'EN_OBSERVACION',
  'asignado para elaboracion': 'APROBADO_ELABORACION',
  'en elaboracion': 'EN_ELABORACION',
  'en evaluacion': 'PRESENTADO',
  'cerrada': 'CERRADA',
  'cancelada': 'CANCELADA',
};

/**
 * Normaliza cualquier valor crudo (legado en español, o canónico nuevo, o un
 * alias de `estadoRevision`) al dominio canónico de 11 valores.
 *
 * `ultimoEstadoRevision` es opcional y solo refina el caso ambiguo
 * `'Asignado para revisión'` (que hoy corresponde a 3 subestados reales
 * distintos según la última fila de `asignaciones[]` — ver diagnóstico
 * aprobado). Sin ese parámetro, el valor por defecto es `ASIGNADO_REVISION`
 * (el subestado inicial, más común).
 */
export function normalizarEstadoSolicitud(
  valorCrudo: string | null | undefined,
  ultimoEstadoRevision?: string | null,
): EstadoCanonico | null {
  const crudo = (valorCrudo ?? '').trim();

  // Ya es un valor canónico (o un alias de estadoRevision con el mismo nombre).
  const mayus = crudo.toUpperCase();
  if (SET_ESTADOS_CANONICOS.has(mayus)) return mayus as EstadoCanonico;
  if (ALIAS_ESTADO_REVISION[mayus]) return ALIAS_ESTADO_REVISION[mayus];

  const key = sinAcentos(crudo.toLowerCase()).replace(/\s+/g, ' ').trim();
  const canonico = MAPA_ESTADO_SOLICITUD_LEGADO[key];
  // Desconocido → `null` explícito, NUNCA se asume PRESELECCION por
  // defecto: un dato corrupto o inesperado debe ser visible como error, no
  // ocultarse detrás de un estado inicial que nunca ocurrió realmente.
  if (!canonico) return null;

  if (canonico === 'ASIGNADO_REVISION' && ultimoEstadoRevision) {
    const er = ultimoEstadoRevision.trim().toUpperCase();
    if (er === 'EN_REVISION') return 'EN_REVISION';
    if (er === 'LISTO_PARA_VALIDAR') return 'REVISION_FINALIZADA';
    if (er === 'ASIGNADO_REVISION') return 'ASIGNADO_REVISION';
  }
  return canonico;
}

/** Determina el submódulo (Validación/Ejecución/Evaluación/Cierre/Preselección)
 * exclusivamente a partir del estado global — nunca de `asignaciones[]`.
 * Devuelve `null` ante un estado no reconocido — PRESELECCION solo se
 * devuelve cuando el valor normalizado es, expresamente,
 * `SELECCION_PROCESO` o `REVISION_COMERCIAL`, nunca como valor por defecto
 * ante un dato desconocido. */
export function obtenerEtapaProceso(
  estadoSolicitud: string | null | undefined,
  ultimoEstadoRevision?: string | null,
): EtapaProceso | null {
  const canonico = normalizarEstadoSolicitud(estadoSolicitud, ultimoEstadoRevision);
  if (canonico == null) return null;
  return ETAPA_POR_ESTADO[canonico];
}

/** Equivalente legado de `estadoRevision` para un estado canónico — usado
 * ÚNICAMENTE por la compatibilidad temporal de Fase 2 (espejo en
 * `asignaciones[].estadoRevision` tras una transición server-side), nunca
 * para decidir el estado global. `null` para los estados sin equivalente de
 * fila (PRESELECCION/CIERRE no aplican — el cierre ya tiene su propio
 * mapeo dedicado en `cerrar/route.ts`). */
export function estadoRevisionLegadoEquivalente(estado: EstadoCanonico | string): string | null {
  switch (estado) {
    case 'ASIGNADO_REVISION': return 'ASIGNADO_REVISION';
    case 'EN_REVISION': return 'EN_REVISION';
    case 'EN_OBSERVACION': return 'CON_OBSERVACIONES';
    case 'REVISION_FINALIZADA': return 'LISTO_PARA_VALIDAR';
    case 'APROBADO_ELABORACION': return 'APROBADO_ELABORACION';
    case 'EN_ELABORACION': return 'EN_ELABORACION';
    case 'PRESENTADO': return 'PRESENTADO';
    default: return null;
  }
}

export type ResolucionEstadoLegadoConsistente =
  | { ok: true; estado: EstadoCanonico }
  | { ok: false; motivo: 'SIN_ASIGNACIONES' | 'AMBIGUO' };

/**
 * Resuelve el subestado de "Asignado para revisión" a partir del CONJUNTO
 * COMPLETO de `estadoRevision` de las filas activas — nunca de una fila
 * elegida (propia, seleccionada, primera o última). Todas las filas activas
 * deben coincidir (una vez normalizadas a canónico) para que el resultado
 * sea el mismo para cualquier responsable/rol que lo consulte.
 */
export function resolverEstadoLegadoConsistente(
  estadosRevisionActivos: readonly (string | null | undefined)[],
): ResolucionEstadoLegadoConsistente {
  const canonicos = new Set<EstadoCanonico>();
  for (const raw of estadosRevisionActivos) {
    const v = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (!v) continue;
    const c: EstadoCanonico | null = ALIAS_ESTADO_REVISION[v] ?? (SET_ESTADOS_CANONICOS.has(v) ? (v as EstadoCanonico) : null);
    if (c) canonicos.add(c);
  }
  if (canonicos.size === 0) return { ok: false, motivo: 'SIN_ASIGNACIONES' };
  if (canonicos.size === 1) return { ok: true, estado: [...canonicos][0] };
  return { ok: false, motivo: 'AMBIGUO' };
}

export interface ResolucionEstadoGlobal {
  /** `null` únicamente cuando `estadoSolicitud` es un valor totalmente
   * irreconocible (no es el caso "Asignado para revisión" ambiguo — ese
   * caso devuelve `ASIGNADO_REVISION` con `ambiguo:true`, nunca `null`). */
  estado: EstadoCanonico | null;
  /** true SOLO cuando `estadoSolicitud` normaliza a `ASIGNADO_REVISION` y
   * las filas activas tienen 2+ subestados distintos entre sí — una
   * inconsistencia real de datos que debe alertarse, no resolverse en
   * silencio eligiendo la de un usuario en particular. */
  ambiguo: boolean;
}

/**
 * Fuente única del estado global visible — arranca SIEMPRE desde
 * `estadoSolicitud`. Para los valores legados no ambiguos ("Asignado para
 * elaboración", "En observación", "En evaluación", "Cerrada", "Cancelada",
 * "Selección de proceso", "Revisión comercial") resuelve directo, sin
 * consultar ninguna fila. Solo "Asignado para revisión" requiere consultar
 * el CONJUNTO de filas activas (`resolverEstadoLegadoConsistente`) — nunca
 * una fila específica — para decidir entre ASIGNADO_REVISION/EN_REVISION/
 * REVISION_FINALIZADA (o EN_OBSERVACION, si una fila legada así lo indica).
 */
export function normalizarEstadoSolicitudGlobal(
  estadoSolicitudCrudo: string | null | undefined,
  estadosRevisionDeAsignacionesActivas: readonly (string | null | undefined)[],
): ResolucionEstadoGlobal {
  const crudo = (estadoSolicitudCrudo ?? '').trim();
  const mayus = crudo.toUpperCase();

  // Ya es un valor canónico — inequívoco por definición, no requiere
  // consultar ninguna fila.
  if (SET_ESTADOS_CANONICOS.has(mayus)) return { estado: mayus as EstadoCanonico, ambiguo: false };

  const key = sinAcentos(crudo.toLowerCase()).replace(/\s+/g, ' ').trim();
  const canonico = MAPA_ESTADO_SOLICITUD_LEGADO[key];
  if (!canonico) return { estado: null, ambiguo: false };
  if (canonico !== 'ASIGNADO_REVISION') return { estado: canonico, ambiguo: false };

  const resolucion = resolverEstadoLegadoConsistente(estadosRevisionDeAsignacionesActivas);
  if (resolucion.ok) return { estado: resolucion.estado, ambiguo: false };
  if (resolucion.motivo === 'SIN_ASIGNACIONES') return { estado: 'ASIGNADO_REVISION', ambiguo: false };
  // AMBIGUO: nunca se elige el estado de un usuario en particular — se
  // devuelve una base segura (VALIDACION, vía ASIGNADO_REVISION) marcada
  // como ambigua para que el llamador muestre la alerta administrativa y
  // bloquee acciones que dependan del subestado exacto.
  return { estado: 'ASIGNADO_REVISION', ambiguo: true };
}

/** Índice de fase (0-9) del stepper comercial para un estado canónico o legado.
 * Devuelve `null` si el valor no se reconoce ni como canónico ni como alias
 * conocido — en ese caso el llamador debe conservar su propia heurística de
 * texto libre existente (compatibilidad, no se reemplaza ese fallback aquí). */
export function faseIdxDesdeEstadoCanonico(valorCrudo: string | null | undefined): number | null {
  const crudo = (valorCrudo ?? '').trim().toUpperCase();
  if (SET_ESTADOS_CANONICOS.has(crudo)) return FASE_IDX_POR_ESTADO[crudo as EstadoCanonico];
  if (ALIAS_ESTADO_REVISION[crudo]) return FASE_IDX_POR_ESTADO[ALIAS_ESTADO_REVISION[crudo]];
  return null;
}

/**
 * Predicados de EVIDENCIAS — flujo de elaboración del módulo Procesos.
 *
 * Trabajan sobre el vocabulario que ya usa `GestionAsignacionInline`
 * (`estadoRevision`, resuelto ahí desde `estadoGlobalCanonico` con
 * prioridad sobre la fila legada) — un superset de `EstadoCanonico` que
 * también incluye alias de fila (RECHAZADO, CERRADO_*, CANCELADO,
 * CON_OBSERVACIONES, LISTO_PARA_VALIDAR) y texto libre legado. Se acepta
 * cualquier string para no obligar al llamador a canonizar primero.
 *
 * Regla funcional aprobada — flujo real:
 *   APROBADO_ELABORACION →(Iniciar elaboración)→ EN_ELABORACION
 *   →(cargar evidencias)→ →(Presentar)→ PRESENTADO → evaluación.
 *
 * Antes del fix, el panel bloqueaba la carga precisamente en
 * EN_ELABORACION (la única etapa donde debe estar habilitada) y la
 * habilitaba en APROBADO_ELABORACION (antes de que exista trabajo que
 * evidenciar) — condición invertida. Estos predicados son la ÚNICA fuente
 * de esa regla; `page.tsx` no debe repetir comparaciones sueltas.
 */
function sinAcentosEstado(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** true SOLO durante EN_ELABORACION (canónico) o su equivalente legado en
 * texto libre ("En elaboración...") — nunca en APROBADO_ELABORACION (ese
 * momento es "por iniciar", no "en curso"), nunca en PRESENTADO/EN_EVALUACION
 * ni en estados terminales. */
export function permiteCargarEvidencias(estado: string | null | undefined): boolean {
  const crudo = (estado ?? '').trim();
  if (!crudo) return false;
  if (crudo.toUpperCase() === 'EN_ELABORACION') return true;
  const normalizado = sinAcentosEstado(crudo.toLowerCase());
  // "asignado para elaboracion"/"aprobado para elaboracion" NO deben
  // matchear aquí — solo el texto libre "en elaboración" propiamente dicho.
  return normalizado.includes('en elaboraci');
}

/** true SOLO en APROBADO_ELABORACION (canónico) o su equivalente legado
 * "Asignado para elaboración" — el único estado desde el que la acción
 * real "Iniciar elaboración" es válida según `MATRIZ_ACCIONES`
 * (`transiciones-estado.ts`: APROBADO_ELABORACION → EN_ELABORACION). */
export function puedeIniciarElaboracion(estado: string | null | undefined): boolean {
  const crudo = (estado ?? '').trim();
  if (!crudo) return false;
  if (crudo.toUpperCase() === 'APROBADO_ELABORACION') return true;
  const normalizado = sinAcentosEstado(crudo.toLowerCase());
  return normalizado.includes('asignado para elaboraci');
}

export type MotivoBloqueoEvidencias = 'PRESENTADO' | 'EN_EVALUACION' | 'TERMINAL' | null;

const ESTADOS_TERMINALES_REVISION = new Set([
  'RECHAZADO', 'CERRADO_ADJUDICADO', 'CERRADO_NO_ADJUDICADO', 'CERRADO_NO_CUMPLIMIENTO', 'CANCELADO',
  'CERRADA', 'CANCELADA',
]);

/**
 * Motivo exacto por el que ya no se pueden agregar evidencias — nunca un
 * booleano ambiguo, para que el mensaje mostrado corresponda al estado
 * real (nunca "Enviado a evaluación" cuando el proceso solo llegó a
 * EN_ELABORACION, un defecto ya identificado y corregido).
 * `null` = no bloqueado (incluye APROBADO_ELABORACION: ahí simplemente
 * "todavía no toca" cargar evidencias, no es un bloqueo con mensaje).
 */
export function motivoBloqueoEvidencias(estado: string | null | undefined): MotivoBloqueoEvidencias {
  const crudo = (estado ?? '').trim();
  if (!crudo) return null;
  const mayus = crudo.toUpperCase();
  const normalizado = sinAcentosEstado(crudo.toLowerCase());
  if (mayus === 'PRESENTADO' || normalizado.includes('listo para presentar') || normalizado.includes('presentad')) return 'PRESENTADO';
  if (normalizado.includes('en evaluaci')) return 'EN_EVALUACION';
  if (ESTADOS_TERMINALES_REVISION.has(mayus) || normalizado.includes('cerrad') || normalizado.includes('cancelad') || normalizado.includes('rechazad')) return 'TERMINAL';
  return null;
}

/** true cuando `motivoBloqueoEvidencias` no es null — helper de conveniencia
 * para el caso en que el llamador no necesita el motivo exacto. */
export function evidenciasBloqueadas(estado: string | null | undefined): boolean {
  return motivoBloqueoEvidencias(estado) !== null;
}

/**
 * Ajuste "COSTOS SOLO DESDE 'EN EJECUCIÓN' EN ADELANTE" — fuente ÚNICA de
 * la regla de visibilidad de la pestaña "Costos" en la ficha del proceso.
 * Nunca aparece en PRESELECCION/VALIDACION (Por validar/En observación);
 * aparece por primera vez en EJECUCION (En ejecución) y permanece visible
 * en EVALUACION (En evaluación) y CIERRE (Cerrado) — el costeo iniciado en
 * ejecución acompaña al mismo proceso hasta el cierre, sin volver a
 * ocultarse. Reutiliza `obtenerEtapaProceso` (nunca reimplementa la
 * clasificación de estados); un estado irreconocible → `false` (nunca se
 * asume visible ante un dato inesperado).
 */
export function puedeMostrarCostosEnFicha(
  estadoSolicitud: string | null | undefined,
  ultimoEstadoRevision?: string | null,
): boolean {
  const etapa = obtenerEtapaProceso(estadoSolicitud, ultimoEstadoRevision);
  return etapa === 'EJECUCION' || etapa === 'EVALUACION' || etapa === 'CIERRE';
}