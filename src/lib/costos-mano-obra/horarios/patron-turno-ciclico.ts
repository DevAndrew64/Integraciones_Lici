/**
 * Semántica funcional confirmada de los turnos de patrón cíclico
 * trabajo/descanso (ej. "7X1" en Grupo Colba): el titular trabaja N días
 * CONSECUTIVOS (sin importar en qué día de la semana caigan), descansa un
 * día (cubierto por una posición TURNANTE separada) y el ciclo completo
 * vuelve a empezar — el día de descanso ROTA de semana a semana porque el
 * ciclo no está anclado a la semana calendario.
 *
 * Nunca se interpreta como un patrón semanal fijo (ej. "lunes a sábado
 * trabaja, domingo descansa") — eso sería asumir que el ciclo coincide con
 * la semana calendario, lo cual solo ocurre por coincidencia en algunas
 * semanas del ciclo, nunca en todas.
 */

export interface PatronTurnoCiclico {
  tipo: 'TRABAJO_DESCANSO_CICLICO';
  codigoTurno: string;
  diasTrabajoConsecutivos: number;
  diasDescansoConsecutivos: number;
  duracionCicloDias: number;
  fechaInicioCiclo: string | null; // "YYYY-MM-DD"
  requiereTurnante: boolean;
  descansoRotativo: boolean;
  confirmado: boolean; // true solo cuando fechaInicioCiclo fue provista
}

const PATRONES_TURNO_CICLICO: Record<string, Omit<PatronTurnoCiclico, 'fechaInicioCiclo' | 'confirmado'>> = {
  '7X1': {
    tipo: 'TRABAJO_DESCANSO_CICLICO',
    codigoTurno: '7X1',
    diasTrabajoConsecutivos: 7,
    diasDescansoConsecutivos: 1,
    duracionCicloDias: 8,
    requiereTurnante: true,
    descansoRotativo: true,
  },
};

/** Reconoce el código de turno (ej. "7X1", con espacios/mayúsculas
 * variables) contra los patrones cíclicos conocidos. Devuelve null si el
 * código no corresponde a ninguno — nunca se adivina un patrón cíclico para
 * un código no reconocido. */
export function resolverPatronTurnoCiclico(
  turnoTexto?: string | null,
  fechaInicioCiclo?: string | null,
): PatronTurnoCiclico | null {
  if (!turnoTexto) return null;
  const clave = turnoTexto.trim().toUpperCase().replace(/\s+/g, '');
  const base = PATRONES_TURNO_CICLICO[clave];
  if (!base) return null;
  return { ...base, fechaInicioCiclo: fechaInicioCiclo ?? null, confirmado: !!fechaInicioCiclo };
}

export interface FechaMaterializadaCiclo {
  fecha: string; // "YYYY-MM-DD"
  posicionCiclo: number;
  trabajaTitular: boolean;
  descansaTitular: boolean;
  cubreTurnante: boolean;
}

function aFechaUTC(f: Date): number {
  return Date.UTC(f.getFullYear(), f.getMonth(), f.getDate());
}

/**
 * Función pura: para cada fecha calendario dentro de [fechaInicioPeriodo,
 * fechaFinPeriodo], determina la posición dentro del ciclo 7X1 (8 días:
 * posiciones 0-6 = trabaja el titular, posición 7 = descansa el titular y
 * lo cubre el turnante) contando desde fechaInicioCiclo. No asume que el
 * ciclo esté alineado con la semana calendario — el día de descanso rota.
 */
export function materializarCiclo7x1(
  fechaInicioCiclo: Date,
  fechaInicioPeriodo: Date,
  fechaFinPeriodo: Date,
): FechaMaterializadaCiclo[] {
  const MS_DIA = 86400000;
  const inicioCicloUTC = aFechaUTC(fechaInicioCiclo);
  const finUTC = aFechaUTC(fechaFinPeriodo);
  const resultado: FechaMaterializadaCiclo[] = [];

  let cursor = aFechaUTC(fechaInicioPeriodo);
  while (cursor <= finUTC) {
    const diffDias = Math.floor((cursor - inicioCicloUTC) / MS_DIA);
    // Módulo que soporta diferencias negativas (fechas anteriores al
    // inicio del ciclo) sin devolver un resto negativo de JS.
    const posicionCiclo = ((diffDias % 8) + 8) % 8;
    const descansaTitular = posicionCiclo === 7;
    resultado.push({
      fecha: new Date(cursor).toISOString().slice(0, 10),
      posicionCiclo,
      trabajaTitular: !descansaTitular,
      descansaTitular,
      cubreTurnante: descansaTitular,
    });
    cursor += MS_DIA;
  }
  return resultado;
}