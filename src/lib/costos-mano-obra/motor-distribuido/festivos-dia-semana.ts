/**
 * Festivos reales de Colombia, agregados por día de la semana — helper
 * NEUTRAL para la corrección "FESTIVOS SEGÚN LOS DÍAS REALMENTE
 * PROGRAMADOS". Reutiliza `generarFestivosColombia` (calendario-festivos-
 * colombia.ts, ya existente, sin acoplamiento al motor legado, sin listas
 * hardcodeadas ni año fijo) — nunca duplica el calendario.
 *
 * No decide clasificación ordinaria/festiva por sí solo: solo responde
 * "en promedio, ¿cuántas veces al mes cae un festivo real en cada día de
 * la semana, para el año de cálculo?" — quien reclasifica horas
 * (derivar-distribucion-comercial.ts) usa este promedio para mover, de
 * cada día ordinario SELECCIONADO, la fracción correspondiente de sus
 * horas hacia el concepto festivo equivalente, sin crear horas nuevas.
 */
import { generarFestivosColombia } from './calendario-festivos-colombia';
import type { DiaSemanaHorario } from '../horarios/tipos';

/** getUTCDay(): 0=domingo … 6=sábado. */
const DIA_SEMANA_POR_INDICE_JS: readonly DiaSemanaHorario[] = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

const MESES_POR_ANIO = 12;

/**
 * Resuelve el año de cálculo de forma determinística, SIN preguntar al
 * usuario (§5 del cierre): usa `anioSugerido` si es un año válido ya
 * conocido (vigencia guardada / fecha del proceso / fecha de la
 * estructura, resueltas aguas arriba por el llamador); si no hay ninguno
 * disponible todavía, cae al año actual del servidor — documentado aquí
 * como fallback, nunca bloquea el cálculo.
 */
export function resolverAnioCalculo(anioSugerido?: number | null): number {
  if (typeof anioSugerido === 'number' && Number.isInteger(anioSugerido) && anioSugerido >= 2000 && anioSugerido <= 2100) {
    return anioSugerido;
  }
  // Fallback determinístico — año del servidor. Ver §5 del cierre: no hay
  // todavía un campo de vigencia/fecha de proceso confiable conectado a
  // este cálculo; cuando exista, se resolverá antes de llegar aquí.
  return new Date().getUTCFullYear();
}

/**
 * Promedio mensual de festivos reales del año que caen en cada día de la
 * semana (L-D). Ej.: si en el año hay 3 festivos que caen en lunes,
 * `resultado.L === 3/12 === 0.25`. Nunca usa 5,83/24,29/10,995/1,005 ni
 * ningún parámetro legacy — solo fechas reales de `generarFestivosColombia`.
 */
export function calcularFestivosPromedioMesPorDiaSemana(anio: number): Record<DiaSemanaHorario, number> {
  const conteo: Record<DiaSemanaHorario, number> = { L: 0, M: 0, X: 0, J: 0, V: 0, S: 0, D: 0 };
  for (const festivo of generarFestivosColombia(anio)) {
    const [y, m, d] = festivo.fecha.split('-').map(Number);
    const fecha = new Date(Date.UTC(y, m - 1, d));
    const dia = DIA_SEMANA_POR_INDICE_JS[fecha.getUTCDay()];
    conteo[dia] += 1;
  }
  const promedio = {} as Record<DiaSemanaHorario, number>;
  (Object.keys(conteo) as DiaSemanaHorario[]).forEach(dia => {
    promedio[dia] = conteo[dia] / MESES_POR_ANIO;
  });
  return promedio;
}