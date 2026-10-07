/** Duración y minutos nocturnos de un día, en minutos enteros — nunca
 * receso plano (los bloques ya excluyen el descanso por construcción) ni
 * fracciones/proporciones aproximadas por hora completa. */
import type { BloqueHorario } from '../horarios/tipos';
import { NOCTURNO_FIN_HORA, NOCTURNO_INICIO_HORA } from './tipos';

function minutosDesdeMedianoche(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

function duracionBloqueMin(inicio: string, fin: string): number {
  const i = minutosDesdeMedianoche(inicio);
  const f = minutosDesdeMedianoche(fin);
  return f > i ? f - i : (1440 - i) + f; // cruce de medianoche
}

function minutosNocturnosBloque(inicio: string, fin: string): number {
  const i = minutosDesdeMedianoche(inicio);
  const dur = duracionBloqueMin(inicio, fin);
  const nocIni = NOCTURNO_INICIO_HORA * 60;
  const nocFin = NOCTURNO_FIN_HORA * 60;
  let noc = 0;
  for (let k = 0; k < dur; k++) {
    const minutoDelDia = (i + k) % 1440;
    const esNocturno = minutoDelDia >= nocIni || minutoDelDia < nocFin;
    if (esNocturno) noc++;
  }
  return noc;
}

export interface MinutosDia {
  minutosTotales: number;
  minutosNocturnos: number;
}

export function segmentarDia(bloques: BloqueHorario[]): MinutosDia {
  let minutosTotales = 0;
  let minutosNocturnos = 0;
  for (const b of bloques) {
    minutosTotales += duracionBloqueMin(b.inicio, b.fin);
    minutosNocturnos += minutosNocturnosBloque(b.inicio, b.fin);
  }
  return { minutosTotales, minutosNocturnos };
}
