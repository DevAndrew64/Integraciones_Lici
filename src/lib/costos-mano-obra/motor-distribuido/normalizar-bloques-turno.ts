/**
 * Normalizador de bloques — capa de entrada del intérprete automático de
 * turnos (interprete-turnos.ts). Nunca decide clasificación ordinaria/
 * extra ni cobertura; solo reescribe la lista de bloques de UN día a una
 * forma canónica que el resto de la capa (interpretación, derivación
 * comercial) puede recorrer sin casos especiales:
 *
 * - Un bloque con inicio === fin ("06:00–06:00") se interpreta SIEMPRE
 *   como cobertura de 24 horas (nunca como cero horas) y se divide en dos
 *   turnos de 12 horas exactas, sin preguntar al usuario.
 * - Cualquier otro bloque se conserva tal cual (incluyendo los que cruzan
 *   medianoche, ej. "18:00–06:00" — el cruce lo interpreta más adelante
 *   quien recorre minuto a minuto, no este módulo).
 */
import type { BloqueHorario } from '../horarios/tipos';

const MINUTOS_DIA = 1440;
const MINUTOS_MEDIO_DIA = 720; // 12 horas — punto de corte de la división 24h → 2×12h.

function minutosDesdeMedianoche(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

function sumarMinutos(hhmm: string, minutos: number): string {
  const total = (minutosDesdeMedianoche(hhmm) + minutos) % MINUTOS_DIA;
  const hh = Math.floor(total / 60).toString().padStart(2, '0');
  const mm = (total % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Duración de un bloque en minutos, resolviendo el cruce de medianoche
 * (fin <= inicio ⇒ el bloque continúa al día siguiente). No aplica a
 * inicio === fin (ver normalizarBloques24Horas, ese caso es 24h explícito). */
export function duracionBloqueMin(b: BloqueHorario): number {
  const inicioMin = minutosDesdeMedianoche(b.inicio);
  const finMin = minutosDesdeMedianoche(b.fin);
  if (finMin === inicioMin) return MINUTOS_DIA;
  return finMin > inicioMin ? finMin - inicioMin : (MINUTOS_DIA - inicioMin) + finMin;
}

/**
 * Divide cualquier bloque "inicio === fin" (ej. 06:00–06:00) en dos
 * turnos complementarios de 12 horas exactas, preservando el orden
 * relativo de los demás bloques. Nunca produce 0 horas para ese bloque.
 */
export function normalizarBloques24Horas(bloques: BloqueHorario[]): BloqueHorario[] {
  const resultado: BloqueHorario[] = [];
  let orden = 1;
  for (const b of [...bloques].sort((a, b2) => a.orden - b2.orden)) {
    if (b.inicio === b.fin) {
      const medio = sumarMinutos(b.inicio, MINUTOS_MEDIO_DIA);
      resultado.push({ inicio: b.inicio, fin: medio, orden: orden++ });
      resultado.push({ inicio: medio, fin: b.inicio, orden: orden++ });
    } else {
      resultado.push({ inicio: b.inicio, fin: b.fin, orden: orden++ });
    }
  }
  return resultado;
}

export interface ResultadoValidacionBloques {
  ok: boolean;
  motivo: string | null;
}

function formatoHHmm(totalMin: number): string {
  const m = ((totalMin % MINUTOS_DIA) + MINUTOS_DIA) % MINUTOS_DIA;
  const hh = Math.floor(m / 60).toString().padStart(2, '0');
  const mm = (m % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Detecta bloques inválidos (duración 0 sin ser el caso 24h explícito, ya
 * resuelto por normalizarBloques24Horas antes de llegar aquí), bloques
 * duplicados, solapamientos entre bloques del mismo día y combinaciones
 * que exceden las 24 horas totales del día. Solo lectura — no modifica ni
 * descarta bloques; produce siempre un mensaje en lenguaje llano, nunca
 * un código interno.
 */
export function validarBloquesTurno(bloques: BloqueHorario[]): ResultadoValidacionBloques {
  if (bloques.length === 0) return { ok: true, motivo: null };
  const intervalos = bloques.map(b => {
    const inicioMin = minutosDesdeMedianoche(b.inicio);
    const duracion = duracionBloqueMin(b);
    return { inicio: b.inicio, fin: b.fin, inicioMin, finMin: inicioMin + duracion }; // finMin puede superar 1440 (cruce de medianoche)
  });
  for (const iv of intervalos) {
    if (iv.finMin - iv.inicioMin <= 0) {
      return { ok: false, motivo: `El bloque ${iv.inicio}–${iv.fin} tiene una duración inválida (el fin no es posterior al inicio).` };
    }
  }
  const ordenados = [...intervalos].sort((a, b) => a.inicioMin - b.inicioMin);
  for (let i = 1; i < ordenados.length; i++) {
    const anterior = ordenados[i - 1];
    const actual = ordenados[i];
    if (actual.inicioMin < anterior.finMin) {
      const inicioSolape = formatoHHmm(actual.inicioMin);
      const finSolape = formatoHHmm(Math.min(anterior.finMin, actual.finMin));
      return {
        ok: false,
        motivo: `Los bloques ${anterior.inicio}–${anterior.fin} y ${actual.inicio}–${actual.fin} se superponen entre las ${inicioSolape} y las ${finSolape}.`,
      };
    }
  }
  // Verificado que no hay solapamientos: una suma > 24h aquí solo puede
  // deberse a bloques que, sin solaparse, exceden la duración de un día
  // (caso residual, no cubierto por el chequeo de solapamiento anterior).
  const totalMinutos = intervalos.reduce((acc, iv) => acc + (iv.finMin - iv.inicioMin), 0);
  if (totalMinutos > MINUTOS_DIA) {
    return { ok: false, motivo: 'Los bloques configurados suman más de 24 horas en un mismo día — revisa la programación.' };
  }
  return { ok: true, motivo: null };
}