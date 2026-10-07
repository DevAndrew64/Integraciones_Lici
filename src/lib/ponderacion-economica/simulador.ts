/**
 * Orquestador del motor de ponderación económica.
 * Dado un SimulacionInput, produce SimulacionOutput con resultados
 * para las 7 fórmulas.
 */

import { calcularPuntajes, FORMULA_KEYS } from './formulas';
import { calcularCentavosTRM, seleccionarMetodoPorCentavosTRM } from './trmSelector';
import { buscarOfertaOptima } from './optimizador';
import type { FormulaKey, SimulacionInput, SimulacionOutput, ResultadoPorFormula } from './types';

export function simularPonderacion(input: SimulacionInput): SimulacionOutput {
  const {
    presupuesto,
    puntajeMaximo,
    competidoresPct,
    miOfertaPct,
    trmValor,
  } = input;

  const centavosTRM = calcularCentavosTRM(trmValor);
  const formulaActiva = seleccionarMetodoPorCentavosTRM(centavosTRM);

  const competidoresValores = competidoresPct.map(pct => (pct / 100) * presupuesto);
  const miOfertaValor =
    miOfertaPct != null && !isNaN(miOfertaPct) && miOfertaPct > 0
      ? (miOfertaPct / 100) * presupuesto
      : null;

  const resultados: ResultadoPorFormula[] = FORMULA_KEYS.map((formula: FormulaKey) => {
    const ofertaOptima = buscarOfertaOptima(formula, competidoresValores, puntajeMaximo, presupuesto);

    let miPuntaje: number | null = null;
    if (miOfertaValor !== null) {
      const puntajes = calcularPuntajes(
        formula,
        [...competidoresValores, miOfertaValor],
        puntajeMaximo,
        presupuesto,
      );
      miPuntaje = Math.round(puntajes[puntajes.length - 1] * 100) / 100;
    }

    return { formula, ofertaOptima, miPuntaje };
  });

  return {
    formulaActiva,
    centavosTRM,
    competidoresValores,
    miOfertaValor,
    resultados,
  };
}