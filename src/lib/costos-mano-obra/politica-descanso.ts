/**
 * Política de descanso por defecto — Fase 2.1.
 * Puro: no toca BD, no llama al motor directamente.
 * Se aplica en la capa de ruta (API), antes de llamar a procesarCargo().
 */

import { calcularHorasBrutas } from './motor-mano-obra';
import type { TurnoEntrada, ModoDescanso } from './motor-mano-obra';

export interface PoliticaDescanso {
  politicaDescansoDefault:   boolean;  // true = aplicar si corresponde
  minHorasTurnoParaDescanso: number;   // umbral en horas brutas (e.g. 6)
  descansoDefaultMinutos:    number;   // duración (e.g. 60)
  descansoComputableDefault: boolean;  // false = no computable
}

export interface ResultadoPolitica {
  turnos:            TurnoEntrada[];
  politicaAplicada:  boolean;
  turnosMarcados:    number;
}

/**
 * Para cada turno sin descanso explícito cuya duración bruta supere el
 * umbral, aplica el descanso por defecto.
 * Si el turno resultante tiene metodoDistribucionDescanso no definido,
 * lo marca como 'no_informado' para que el motor genere la alerta de
 * turno mixto si corresponde.
 */
export function aplicarPoliticaDescanso(
  turnos: TurnoEntrada[],
  politica: PoliticaDescanso,
): ResultadoPolitica {
  if (!politica.politicaDescansoDefault) {
    return { turnos, politicaAplicada: false, turnosMarcados: 0 };
  }

  let marcados = 0;
  const resultado: TurnoEntrada[] = turnos.map(turno => {
    // Solo aplica cuando no hay descanso declarado explícitamente
    if (turno.descansoMinutos !== 0) return turno;

    const brutas = calcularHorasBrutas(turno.horaInicio, turno.horaFin);
    if (brutas <= politica.minHorasTurnoParaDescanso) return turno;

    marcados++;
    return {
      ...turno,
      descansoMinutos:              politica.descansoDefaultMinutos,
      descansoComputable:           politica.descansoComputableDefault,
      // Marcamos como 'no_informado' para que el motor genere
      // DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO si el turno es mixto.
      metodoDistribucionDescanso:   (turno.metodoDistribucionDescanso ?? 'no_informado') as ModoDescanso,
    };
  });

  return { turnos: resultado, politicaAplicada: marcados > 0, turnosMarcados: marcados };
}