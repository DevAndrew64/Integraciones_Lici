/** Resuelve, para una fecha puntual, qué distribución (si alguna) la cubre —
 * respetando excepcionesFecha (INCLUIR/EXCLUIR) por encima del patrón
 * semanal ordinario. Nunca dos distribuciones cubren la misma fecha
 * simultáneamente (garantizado por validar-solapes-distribuciones.ts en el
 * patrón; las excepciones podrían romper esa garantía en un caso extremo,
 * por eso se toma siempre la primera que aplica, nunca se suman). */
import type { BloqueHorario, DiaSemanaHorario, DistribucionHorarioConfigurada } from '../horarios/tipos';
import { esFechaFestiva } from './festivos';
import { resolverOffsetsBloque, rangoAbsolutoBloque } from '../horarios/tiempo-absoluto';

const DIA_SEMANA_JS: Record<number, DiaSemanaHorario> = {
  0: 'D', 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S',
};

export function parsearFechaUTC(fecha: string): Date {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatearFechaUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function diaSemanaDeFecha(fecha: string): DiaSemanaHorario {
  return DIA_SEMANA_JS[parsearFechaUTC(fecha).getUTCDay()];
}

export function esDomingo(fecha: string): boolean {
  return diaSemanaDeFecha(fecha) === 'D';
}

export function sumarDias(fecha: string, dias: number): string {
  const d = parsearFechaUTC(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return formatearFechaUTC(d);
}

/**
 * Bloques aplicables a una fecha puntual, o [] si es día de descanso
 * (ninguna distribución la cubre). Regla definitiva de festivos (bloque de
 * corrección): una fecha festiva que cae en un día YA cubierto por
 * diasSemana SIEMPRE se trabaja — festivo no es motivo de exclusión por sí
 * solo. La ÚNICA forma de excluir una fecha (festiva u ordinaria) ya
 * cubierta es una excepción explícita por fecha con accion 'EXCLUIR'.
 * Nunca depende de un checkbox ni de una bandera "trabajaFestivos" — ese
 * campo fue eliminado del contrato.
 *
 * `cubreFestivosFueraDePatron` es una EXTENSIÓN de cobertura, no una
 * exclusión: si una distribución la tiene en true, también cubre fechas
 * festivas que caen en un día que NO está en diasSemana (ej. domingo
 * festivo con patrón lunes-sábado). Sin ella, esos festivos "extra"
 * simplemente no tienen distribución — no se excluye nada que ya
 * estuviera programado por diasSemana.
 */
export function bloquesParaFecha(
  fecha: string,
  distribuciones: DistribucionHorarioConfigurada[],
  festivos: readonly string[] = [],
): BloqueHorario[] {
  const diaSemana = diaSemanaDeFecha(fecha);
  for (const dist of distribuciones) {
    const excepcion = dist.excepcionesFecha.find(e => e.fecha === fecha);
    if (excepcion) {
      if (excepcion.accion === 'EXCLUIR') continue;
      return dist.bloques; // INCLUIR explícito
    }
    if (dist.diasSemana.includes(diaSemana)) return dist.bloques;
    if (dist.cubreFestivosFueraDePatron && esFechaFestiva(fecha, festivos)) return dist.bloques;
  }
  return [];
}

// ── Clasificación por fecha calendario real (Fase 5, cruce de medianoche) ──
//
// Corrección "FECHA CALENDARIO REAL" — un bloque que cruza medianoche
// (offsets resueltos vía `tiempo-absoluto.ts`) puede abarcar 2+ fechas
// calendario reales; cada minuto debe atribuirse a SU fecha real, nunca
// heredar la clasificación dominical/festiva del día en que comenzó el
// turno. Esta función es una capacidad de MATERIALIZACIÓN pura y
// autocontenida — NO se conecta al motor de sobretiempos activo
// (`derivar-distribucion-comercial.ts`, fuera del alcance de esta fase):
// ese motor clasifica por DÍA DE LA SEMANA con mensualización estadística
// (24,08/5,92/4,33), nunca por fecha calendario real minuto a minuto: cómo
// (o si) integrar esta capacidad ahí implica decidir si la cuota diaria de
// 7h se reinicia exactamente a medianoche o continúa durante todo el turno
// operativo — una decisión de negocio nueva, explícitamente fuera de esta
// fase (ver reporte de Fase 5).

export interface SegmentoPorFechaCalendario {
  /** Fecha real (YYYY-MM-DD) a la que pertenece este segmento. */
  fecha: string;
  /** Minuto del día calendario (0-1439) en que empieza el segmento. */
  inicioMinDia: number;
  /** Minuto del día calendario (1-1440) en que termina el segmento — 1440
   * cuando el segmento llega exactamente hasta la medianoche siguiente. */
  finMinDia: number;
  /** Duración de este segmento, en minutos — la suma de todos los
   * segmentos de un bloque siempre es exactamente su duración total
   * (nunca se duplican ni se omiten minutos). */
  minutos: number;
  esDomingo: boolean;
  esFestivo: boolean;
}

/**
 * Divide UN bloque (ya con sus offsets resueltos o inferibles — ver
 * `resolverOffsetsBloque`) en segmentos, uno por cada fecha calendario
 * real que toca, a partir de `fechaBase` (la fecha calendario del día
 * operativo en que el bloque tiene offsetDiaInicio=0). Cada minuto queda
 * en EXACTAMENTE un segmento — la clasificación dominical/festiva de cada
 * segmento se resuelve con SU PROPIA fecha real (`diaSemanaDeFecha`/
 * `esFechaFestiva`), nunca heredada del segmento anterior.
 */
export function materializarBloquePorFechaCalendario(
  bloque: Pick<BloqueHorario, 'inicio' | 'fin' | 'offsetDiaInicio' | 'offsetDiaFin'>,
  fechaBase: string,
  festivos: readonly string[] = [],
): SegmentoPorFechaCalendario[] {
  const offsets = resolverOffsetsBloque(bloque);
  const rango = rangoAbsolutoBloque(bloque, offsets);
  const segmentos: SegmentoPorFechaCalendario[] = [];
  let cursorAbs = rango.inicioAbs;
  while (cursorAbs < rango.finAbs) {
    const indiceDia = Math.floor(cursorAbs / 1440);
    const finDiaAbs = (indiceDia + 1) * 1440;
    const finSegmentoAbs = Math.min(rango.finAbs, finDiaAbs);
    const fecha = sumarDias(fechaBase, indiceDia);
    segmentos.push({
      fecha,
      inicioMinDia: cursorAbs - indiceDia * 1440,
      finMinDia: finSegmentoAbs - indiceDia * 1440,
      minutos: finSegmentoAbs - cursorAbs,
      esDomingo: esDomingo(fecha),
      esFestivo: esFechaFestiva(fecha, festivos),
    });
    cursorAbs = finSegmentoAbs;
  }
  return segmentos;
}
