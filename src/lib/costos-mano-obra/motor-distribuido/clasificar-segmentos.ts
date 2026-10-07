/** Clasifica minutos en ordinaria/extra recorriendo la semana en orden
 * CRONOLÓGICO, minuto a minuto — nunca por reparto proporcional dentro
 * de un día. El acumulado semanal se reinicia cada lunes y cambia de
 * ordinario a extra exactamente al alcanzar el minuto de la jornada
 * semanal configurada (ej. 2520). Los días de contexto (fuera del
 * período) avanzan el acumulado pero nunca aportan minutos a los buckets. */
import type { HorasBucketsDistribuido } from './tipos';
import { NOCTURNO_FIN_HORA, NOCTURNO_INICIO_HORA } from './tipos';
import type { DiaConContexto } from './construir-semana';
import { diaSemanaDeFecha, bloquesParaFecha, esDomingo } from './materializar-programacion';
import { esFechaFestiva } from './festivos';
import type { DistribucionHorarioConfigurada } from '../horarios/tipos';

export interface ResultadoClasificacion {
  buckets: HorasBucketsDistribuido;
  minutosPeriodo: number;
  cantidadDias: number;
}

function minutosDesdeMedianoche(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

function duracionBloqueMin(inicio: string, fin: string): number {
  const i = minutosDesdeMedianoche(inicio);
  const f = minutosDesdeMedianoche(fin);
  return f > i ? f - i : (1440 - i) + f;
}

const NOC_INI_MIN = NOCTURNO_INICIO_HORA * 60;
const NOC_FIN_MIN = NOCTURNO_FIN_HORA * 60;

export function clasificarSemanas(
  dias: DiaConContexto[],
  distribuciones: DistribucionHorarioConfigurada[],
  jornadaSemanalMinutos: number,
  festivos: readonly string[] = [],
): ResultadoClasificacion {
  const buckets: HorasBucketsDistribuido = {
    ordinariaHabil: 0, recargoNocturno: 0, extraDiurna: 0, extraNocturna: 0,
    ordinariaDominical: 0, recargoNocturnoDominical: 0, extraDiurnaFestiva: 0, extraNocturnaFestiva: 0,
  };
  let minutosPeriodo = 0;
  let cantidadDias = 0;
  let acumuladoSemana = 0;

  for (const dia of dias) {
    if (diaSemanaDeFecha(dia.fecha) === 'L') acumuladoSemana = 0; // reinicio semanal

    const bloques = bloquesParaFecha(dia.fecha, distribuciones, festivos);
    if (bloques.length === 0) continue; // día de descanso, o excluido por excepción explícita

    // Domingo o festivo comparten el mismo tratamiento económico (buckets
    // "dominical/festiva") — la fuente es la fecha concreta + CalendarioFestivos,
    // nunca solo el nombre del día de la semana.
    const domingo = esDomingo(dia.fecha) || esFechaFestiva(dia.fecha, festivos);
    let minutosDelDia = 0;

    // Recorrido CRONOLÓGICO minuto a minuto de cada bloque, en el orden en
    // que aparecen — el corte ordinario/extra ocurre exactamente en el
    // minuto en que acumuladoSemana alcanza jornadaSemanalMinutos, nunca
    // por proporción del total del día.
    for (const b of bloques) {
      const inicioMin = minutosDesdeMedianoche(b.inicio);
      const dur = duracionBloqueMin(b.inicio, b.fin);
      for (let k = 0; k < dur; k++) {
        const minutoDelDia = (inicioMin + k) % 1440;
        const esNocturno = minutoDelDia >= NOC_INI_MIN || minutoDelDia < NOC_FIN_MIN;
        const esOrdinario = acumuladoSemana < jornadaSemanalMinutos;
        acumuladoSemana++;
        minutosDelDia++;

        if (!dia.dentroDelPeriodo) continue; // contexto: ya afectó el acumulado, nunca se costea

        if (domingo) {
          if (esOrdinario) { if (esNocturno) buckets.recargoNocturnoDominical++; else buckets.ordinariaDominical++; }
          else { if (esNocturno) buckets.extraNocturnaFestiva++; else buckets.extraDiurnaFestiva++; }
        } else {
          if (esOrdinario) { if (esNocturno) buckets.recargoNocturno++; else buckets.ordinariaHabil++; }
          else { if (esNocturno) buckets.extraNocturna++; else buckets.extraDiurna++; }
        }
      }
    }

    if (dia.dentroDelPeriodo) { minutosPeriodo += minutosDelDia; cantidadDias++; }
  }

  return { buckets, minutosPeriodo, cantidadDias };
}
