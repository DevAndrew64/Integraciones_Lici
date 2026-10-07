/**
 * Selección determinística de fórmula de ponderación según centavos de la TRM.
 * Rangos configurados según práctica SECOP II Colombia.
 *
 * REGLA: Este selector es puro y determinístico. No llama a ninguna IA.
 *
 * NOTA FASE 2: Si los rangos cambian por pliego, este módulo recibirá
 * los rangos como parámetro en lugar de usar los hardcodeados.
 */

import type { FormulaKey } from './types';

export interface RangoTRM {
  desde: number;   // centavos inclusivo
  hasta: number;   // centavos inclusivo
  formula: FormulaKey;
}

/**
 * Rangos hardcodeados que replican exactamente el comportamiento actual del modal.
 * Orden: primero el rango que se evalúa antes.
 */
export const RANGOS_TRM: RangoTRM[] = [
  { desde:  0, hasta: 14, formula: 'mediana' },
  { desde: 15, hasta: 28, formula: 'media_geometrica' },
  { desde: 29, hasta: 42, formula: 'media_geometrica_con_presupuesto' },
  { desde: 43, hasta: 57, formula: 'media_aritmetica' },
  { desde: 58, hasta: 71, formula: 'media_aritmetica_baja' },
  { desde: 72, hasta: 85, formula: 'media_aritmetica_alta' },
  { desde: 86, hasta: 99, formula: 'menor_valor' },
];

/**
 * Calcula los centavos de la TRM con el mismo método que el modal.
 * Replicado de: Math.round((trmValor % 1) * 100)
 *
 * @param trmValor  Valor TRM (e.g. 3443.59)
 * @returns Centavos enteros (0–99)
 */
export function calcularCentavosTRM(trmValor: number): number {
  return Math.round((trmValor % 1) * 100);
}

/**
 * Selecciona la fórmula de ponderación según los centavos de la TRM.
 * Fallback: 'mediana' si los centavos no caen en ningún rango.
 *
 * @param centavos  Centavos de la TRM (0–99)
 */
export function seleccionarMetodoPorCentavosTRM(centavos: number): FormulaKey {
  for (const rango of RANGOS_TRM) {
    if (centavos >= rango.desde && centavos <= rango.hasta) {
      return rango.formula;
    }
  }
  return 'mediana';
}