/**
 * Ajuste "CORREGIR AGRUPACIÓN DE CARGOS EN MANO DE OBRA — SEPARAR POR
 * CARGO + HORARIO" — hoy la ficha visual de un cargo se agrupa
 * ÚNICAMENTE por `nombreCargo` (ver `gruposCargoManoObra`, page.tsx): dos
 * líneas escritas por el usuario con el mismo nombre ("VIGILANTE") pero
 * horarios opuestos (18:00-06:00 vs. 06:00-18:00) terminaban fusionadas
 * en UNA sola ficha, mezclando subtotales/turnante de dos posiciones que
 * son operativamente distintas.
 *
 * Este módulo es la ÚNICA fuente de la firma canónica de una
 * programación y de la llave de ficha (cargo + programación) — funciones
 * puras, sin React/fetch, para que page.tsx nunca reimplemente esta
 * lógica ni construya la llave a partir del texto ya formateado para
 * mostrar en pantalla (ese texto puede cambiar de redacción sin que la
 * programación real cambie, y viceversa).
 */
import type { BloqueHorario, DistribucionHorarioConfigurada } from './tipos';

function normalizarTextoClave(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, ' ') || 'SIN_NOMBRE';
}

/** Un bloque cruza medianoche cuando su fin es menor o igual a su
 * inicio (ej. 18:00→06:00) — mismo criterio ya usado en
 * derivar-distribucion-comercial.ts (`duracion = finMin>inicioMin ? ... : cruce`),
 * nunca una heurística nueva y distinta. */
function bloqueCruzaMedianoche(b: BloqueHorario): boolean {
  return b.fin <= b.inicio;
}

function claveBloque(b: BloqueHorario): string {
  return `${b.inicio}-${b.fin}${bloqueCruzaMedianoche(b) ? '~M' : ''}`;
}

/**
 * Firma canónica de UNA distribución horaria — determinística: mismo
 * conjunto de días/bloques/excepciones produce siempre la misma firma,
 * sin importar el orden en que el usuario los capturó.
 */
function firmaUnaDistribucion(d: DistribucionHorarioConfigurada): string {
  const dias = [...d.diasSemana].sort().join(',');
  const bloques = [...d.bloques].sort((a, b) => a.orden - b.orden).map(claveBloque).join('+');
  const excepciones = [...d.excepcionesFecha]
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map(e => `${e.fecha}:${e.accion}`)
    .join(',');
  // `tipoCapturaHorario`/`horasSemanalesManual` (captura "TOTAL_SEMANAL",
  // ej. turnantes automáticos y coberturas por horas) — cuando no hay
  // bloques reales, la firma debe distinguir igualmente 21h de 42h; se
  // incluye como componente aparte, nunca mezclado con `bloques` (que
  // queda vacío en ese modo).
  const totalSemanal = d.tipoCapturaHorario === 'TOTAL_SEMANAL'
    ? `TS${d.horasSemanalesManual ?? 0}`
    : '';
  return `${dias}|${bloques}|EXC(${excepciones})|${totalSemanal}`;
}

/**
 * Firma canónica de la programación COMPLETA de un cargo (puede tener
 * varias distribuciones — ej. L-V un horario, S-D otro) — ordenada
 * determinísticamente (nunca depende del orden de captura del usuario),
 * e incluye `incluyeFestivos`/`diaDescansoObligatorio` como componentes
 * propios: dos programaciones con los mismos bloques pero festivos
 * distintos deben producir fichas distintas (mismo criterio que pide el
 * ajuste — "incluye festivos" es parte de la identidad de la ficha, no
 * un detalle secundario). `jornadaFlexible` también: el mismo horario con
 * y sin jornada flexible pactada liquida horas extras distintas, así que
 * nunca debe fusionarse en una sola ficha. El componente solo se agrega
 * cuando es `true`, para que la firma de todo cargo sin jornada flexible
 * (el histórico completo) quede exactamente igual que antes.
 */
export function construirFirmaProgramacion(
  distribuciones: readonly DistribucionHorarioConfigurada[],
  incluyeFestivos: boolean,
  diaDescansoObligatorio?: string,
  jornadaFlexible?: boolean,
): string {
  const partes = distribuciones.map(firmaUnaDistribucion).sort();
  return [
    partes.length > 0 ? partes.join(';') : 'SIN_PROGRAMACION',
    `FEST_${incluyeFestivos ? 'SI' : 'NO'}`,
    `DESC_${diaDescansoObligatorio ?? 'D'}`,
    ...(jornadaFlexible ? ['FLEX_SI'] : []),
  ].join('|');
}

/**
 * Llave de ficha de Mano de Obra — Cargo + Programación (nunca solo el
 * nombre del cargo, nunca valores económicos). Distinta, deliberadamente,
 * de `claveGrupoTurnante`/`claveGrupo` (calculo-turnantes.ts,
 * `construirClaveCompatibilidadTurnante`): esa clave determina cómo se
 * COMPARTE la cobertura de un turnante (salario/ARL/bonos/horario/cargo
 * compatibles), esta clave determina qué FICHA VISUAL de Mano de Obra
 * corresponde a cada registro — dos fichas pueden compartir turnante sin
 * fusionarse visualmente, y viceversa.
 */
export function construirClaveFichaManoObra(cargoNombre: string, firmaProgramacion: string): string {
  return `${normalizarTextoClave(cargoNombre)}|${firmaProgramacion}`;
}
