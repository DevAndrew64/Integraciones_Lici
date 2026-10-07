/**
 * Ajuste "BLOQUE 1A — UNIFICACIÓN DE FECHAS CONTRACTUALES" — módulo puro y
 * compartido, único punto de resolución/formato para la fecha límite
 * contractual mostrada en listados y fichas de Solicitudes/Procesos.
 *
 * Origen del problema (Caso C, Solicitud.id=292, SQR 274379): el listado leía
 * `fechaCierre` (guardada a mediodía UTC) y la ficha leía exclusivamente
 * `fechaVencimiento` (guardada a medianoche UTC) — cada una con al menos 9
 * implementaciones locales distintas de formateo, ninguna con `timeZone`
 * explícito. Medianoche UTC menos 5h (Bogotá) cruza al día anterior;
 * mediodía UTC no. Resultado: la ficha mostraba 13/08/2026 19:00 para el
 * mismo registro que el listado mostraba correctamente como 14/08/2026.
 *
 * Distinción semántica confirmada por lectura de código (no asumida):
 * `Solicitud.fechaCierre` se fija una sola vez al crear la Solicitud
 * (`crearSolicitudConIdentidad`, `crear-solicitud.ts:321`) y nunca se
 * resincroniza — es el snapshot interno de la fecha límite en el momento en
 * que se gestionó el proceso. `Solicitud.fechaVencimiento` sí se
 * resincroniza continuamente desde SECOP (`procesos-sync.ts`,
 * `actualizar-ficha-puntual.ts`) — es el dato externo vigente, que puede
 * cambiar si la entidad aplaza el cierre. El listado ya usa
 * `fechaCierre ?? fechaVencimiento` en sus 10 sitios de renderizado — esa
 * prioridad se adopta aquí como la regla única, documentada, sin haber
 * encontrado ninguna regla de negocio en otro módulo que la contradiga.
 */

const CALENDARIO_FALLBACK = '—';
const ZONA_HORARIA_PRESENTACION = 'America/Bogota';

/** Entrada mínima con los dos campos de fecha límite contractual de una Solicitud. */
export interface FuenteFechaLimiteContractual {
  fechaCierre?: Date | string | null;
  fechaVencimiento?: Date | string | null;
}

/**
 * Fuente de verdad única para "cuál es la fecha límite contractual que se
 * muestra" — nunca resolver esta pregunta de forma distinta en listado vs.
 * ficha. Prioriza `fechaCierre` (snapshot interno); si es null/undefined,
 * cae a `fechaVencimiento` (dato externo sincronizado); si ambos faltan,
 * `null`.
 */
export function resolverFechaLimiteContractual(
  entrada: FuenteFechaLimiteContractual | null | undefined,
): Date | string | null {
  if (!entrada) return null;
  return entrada.fechaCierre ?? entrada.fechaVencimiento ?? null;
}

/**
 * Extrae año/mes/día tal como quedaron almacenados en UTC, sin dejar que el
 * huso horario del navegador/servidor los reinterprete — es la única forma
 * comprobable de garantizar que `2026-08-14T00:00:00.000Z` nunca se muestre
 * como 13/08/2026. Deliberadamente NO usa suma/resta manual de horas.
 */
function componentesCalendarioUTC(valor: Date): { dia: string; mes: string; anio: number } {
  return {
    dia: String(valor.getUTCDate()).padStart(2, '0'),
    mes: String(valor.getUTCMonth() + 1).padStart(2, '0'),
    anio: valor.getUTCFullYear(),
  };
}

/**
 * Formatea un valor cuyo significado de negocio es un DÍA CALENDARIO (no un
 * instante) — fecha límite contractual, fecha de entrega de información, y
 * equivalentes. Nunca incluye hora. Interpreta el día con `timeZone:'UTC'`
 * explícito (vía componentes UTC), por lo que el resultado es idéntico sin
 * importar el huso horario de quien ejecuta el código. No modifica el valor
 * original — es una función pura.
 */
export function formatearFechaSoloCalendario(
  valor: Date | string | null | undefined,
): string {
  if (valor === null || valor === undefined || valor === '') return CALENDARIO_FALLBACK;

  const d = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(d.getTime())) return CALENDARIO_FALLBACK;

  const { dia, mes, anio } = componentesCalendarioUTC(d);
  return `${dia}/${mes}/${anio}`;
}

/**
 * Formatea un valor cuyo significado de negocio SÍ es un instante concreto
 * (timestamp real): `createdAt`, `updatedAt`, fecha de asignación,
 * observaciones, AuditLog, cierres de gestión, acciones de usuario. Conserva
 * la hora y la ancla explícitamente a `America/Bogota` — nunca al huso del
 * navegador/servidor, para que el resultado sea reproducible en cualquier
 * entorno de ejecución.
 */
export function formatearFechaHora(
  valor: Date | string | null | undefined,
  opciones?: { zonaHoraria?: string },
): string {
  if (valor === null || valor === undefined || valor === '') return CALENDARIO_FALLBACK;

  const d = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(d.getTime())) return CALENDARIO_FALLBACK;

  const zonaHoraria = opciones?.zonaHoraria ?? ZONA_HORARIA_PRESENTACION;
  const fecha = d.toLocaleDateString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: zonaHoraria,
  });
  const hora = d.toLocaleTimeString('es-CO', {
    hour: '2-digit', minute: '2-digit', timeZone: zonaHoraria,
  });
  return `${fecha} ${hora}`;
}

/**
 * Conveniencia: resuelve y formatea en un solo paso la fecha límite
 * contractual visible (listado, ficha de Solicitudes, ficha de Búsqueda,
 * ficha de Procesos) — todas deben llamar esta función, nunca reimplementar
 * la prioridad `fechaCierre ?? fechaVencimiento` ni el formateo por su cuenta.
 */
export function formatearFechaLimiteContractual(
  entrada: FuenteFechaLimiteContractual | null | undefined,
): string {
  return formatearFechaSoloCalendario(resolverFechaLimiteContractual(entrada));
}