/**
 * Límite del 40% de pagos no salariales para IBC (Ingreso Base de
 * Cotización) — cierre "LÍMITE DEL 40% DE PAGOS NO SALARIALES PARA IBC".
 * Helper NEUTRAL y puro: no decide qué conceptos son "no salariales" (eso
 * lo decide quien lo llama, ver bonificaciones-mano-obra.ts), no conoce
 * salud/pensión/ARL/prestaciones — solo calcula el exceso que debe
 * reincorporarse a una base salarial dada, según la fórmula legal del
 * artículo 30 de la Ley 1393 de 2010.
 *
 * Este módulo NUNCA decide en qué bases se aplica el ajuste (eso lo
 * decide `resultado-financiero-mensual-linea.ts`, exclusivamente para
 * salud y pensión en esta fase — prestaciones/parafiscales/ARL quedan
 * fuera hasta su propia auditoría).
 */

export interface EntradaLimitePagosNoSalarialesIBC {
  /** Base salarial mensual por trabajador (IBC previo al ajuste — ya
   * incluye salario básico, bono prestacional, recargos y demás
   * conceptos salariales ya reconocidos). */
  baseSalarial: number;
  /** Total mensual de pagos NO salariales por trabajador (los 4 bonos no
   * prestacionales — nunca el auxilio legal de transporte, dotación, EPP,
   * exámenes, cursos, vacunas ni otros costos operativos). */
  pagosNoSalariales: number;
}

export interface ResultadoLimitePagosNoSalarialesIBC {
  remuneracionTotal: number;
  limiteNoSalarialExcluible: number;
  excesoNoSalarialIBC: number;
  ibcAjustado: number;
}

/** Redondeo HALF_UP a pesos enteros — misma política ya vigente en el
 * resto del proyecto (resultado-financiero-mensual-linea.ts,
 * motor-comercial-30-dias.ts). Se aplica UNA vez por valor final, nunca
 * antes (remuneracionTotal es suma de valores ya enteros, no requiere
 * redondeo propio). */
function redondearPeso(n: number): number { return Math.round(n); }

const PORCENTAJE_LIMITE_NO_SALARIAL = 0.40;

/**
 * Único cálculo autorizado del límite del 40% de pagos no salariales
 * (Ley 1393 de 2010, art. 30). Fórmula:
 *
 *   remuneracionTotal = baseSalarial + pagosNoSalariales
 *   limiteNoSalarialExcluible = remuneracionTotal × 0,40
 *   excesoNoSalarialIBC = max(0, pagosNoSalariales - limiteNoSalarialExcluible)
 *   ibcAjustado = baseSalarial + excesoNoSalarialIBC
 */
export function calcularLimitePagosNoSalarialesIBC(
  entrada: EntradaLimitePagosNoSalarialesIBC,
): ResultadoLimitePagosNoSalarialesIBC {
  const remuneracionTotal = entrada.baseSalarial + entrada.pagosNoSalariales;
  const limiteNoSalarialExcluible = redondearPeso(remuneracionTotal * PORCENTAJE_LIMITE_NO_SALARIAL);
  const excesoNoSalarialIBC = Math.max(0, redondearPeso(entrada.pagosNoSalariales - limiteNoSalarialExcluible));
  const ibcAjustado = redondearPeso(entrada.baseSalarial + excesoNoSalarialIBC);
  return { remuneracionTotal, limiteNoSalarialExcluible, excesoNoSalarialIBC, ibcAjustado };
}