/**
 * Construcción de "eventos efectivos" de TRM.
 *
 * La serie diaria oficial repite el mismo valor en fines de semana, festivos
 * y días sin cambio. Para modelar (ARIMA sobre índice de evento) solo interesan
 * las fechas donde la TRM efectivamente cambió:
 *   1. Se ordena la serie por fecha ascendente.
 *   2. Se conserva el primer registro.
 *   3. Se conserva cualquier fecha cuya TRM difiera de la inmediatamente anterior
 *      (incluye sábados si traen valor distinto).
 *   4. Se eliminan repeticiones consecutivas (domingos/festivos que arrastran
 *      el valor del día anterior).
 *   5. Cada evento recibe un eventoId consecutivo (0, 1, 2, …).
 */

import type { TrmHistorialEntry } from './types';

export interface EventoTrm {
  eventoId: number;
  fecha: string;  // YYYY-MM-DD
  valor: number;
}

/**
 * Convierte la serie diaria en eventos efectivos.
 * Descarta entradas con valor no numérico o no positivo y fechas duplicadas
 * (se queda con la última aparición de cada fecha).
 */
export function construirEventosEfectivos(serie: TrmHistorialEntry[]): EventoTrm[] {
  // Deduplicar por fecha (última gana) y sanear
  const porFecha = new Map<string, number>();
  for (const { fecha, valor } of serie) {
    const v = Number(valor);
    if (!fecha || !isFinite(v) || v <= 0) continue;
    porFecha.set(fecha.slice(0, 10), v);
  }

  const ordenada = Array.from(porFecha.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const eventos: EventoTrm[] = [];
  let anterior: number | null = null;
  for (const [fecha, valor] of ordenada) {
    if (anterior === null || valor !== anterior) {
      eventos.push({ eventoId: eventos.length, fecha, valor });
      anterior = valor;
    }
  }
  return eventos;
}
