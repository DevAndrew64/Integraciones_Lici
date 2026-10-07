/**
 * Búsqueda determinística de la oferta óptima (grid search).
 * Gemini no participa: este módulo es puro TypeScript.
 *
 * Redondeos:
 * - Paso del grid: Math.round((p + 0.1) * 10) / 10  → evita acumulación de error flotante
 * - pct resultado: Math.round(bPct * 10) / 10        → 1 decimal
 * - puntaje:       Math.round(bPunt * 100) / 100     → 2 decimales
 */

import { calcularPuntajes } from './formulas';
import type { FormulaKey, OfertaOptima } from './types';

/**
 * Busca el porcentaje del presupuesto que maximiza el puntaje económico.
 * Grid search de 50% a 100% en pasos de 0.1% (500 iteraciones).
 *
 * @param formula          Fórmula a evaluar.
 * @param competidores     Valores COP de los competidores (sin mi oferta).
 * @param puntajeMaximo    PM del pliego.
 * @param presupuesto      Presupuesto oficial en COP.
 * @returns { pct, puntaje } — porcentaje óptimo y puntaje máximo alcanzable.
 */
export function buscarOfertaOptima(
  formula: FormulaKey,
  competidores: number[],
  puntajeMaximo: number,
  presupuesto: number,
): OfertaOptima {
  let mejorPct = 99;   // Fallback igual que el original
  let mejorPuntaje = -1;

  for (let p = 50; p <= 100.01; p = Math.round((p + 0.1) * 10) / 10) {
    const miOfertaValor = (p / 100) * presupuesto;
    const puntajes = calcularPuntajes(
      formula,
      [...competidores, miOfertaValor],
      puntajeMaximo,
      presupuesto,
    );
    const miPuntaje = puntajes[puntajes.length - 1];
    if (miPuntaje > mejorPuntaje) {
      mejorPuntaje = miPuntaje;
      mejorPct = p;
    }
  }

  return {
    pct: Math.round(mejorPct * 10) / 10,
    puntaje: Math.round(mejorPuntaje * 100) / 100,
  };
}