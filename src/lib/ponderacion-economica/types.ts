/**
 * Tipos del motor determinístico de ponderación económica SECOP II.
 * Gemini no participa en ninguno de estos cálculos.
 */

export type FormulaKey =
  | 'mediana'
  | 'media_geometrica'
  | 'media_geometrica_con_presupuesto'
  | 'media_aritmetica'
  | 'media_aritmetica_baja'
  | 'media_aritmetica_alta'
  | 'menor_valor';

export interface OfertaOptima {
  /** Porcentaje del presupuesto oficial (50–100). */
  pct: number;
  /** Puntaje obtenido en ese porcentaje. */
  puntaje: number;
}

export interface ResultadoPorFormula {
  formula: FormulaKey;
  ofertaOptima: OfertaOptima;
  /** Puntaje de mi oferta (null si no se proporcionó). */
  miPuntaje: number | null;
}

export interface SimulacionInput {
  /** Presupuesto oficial en COP (entero positivo). */
  presupuesto: number;
  /** Puntaje máximo económico del pliego. */
  puntajeMaximo: number;
  /** Competidores como porcentaje del presupuesto (0–120). */
  competidoresPct: number[];
  /** Mi oferta como porcentaje del presupuesto (opcional). */
  miOfertaPct?: number;
  /** Valor TRM vigente (e.g. 3443.59). */
  trmValor: number;
}

export interface SimulacionOutput {
  /** Fórmula activa según centavos TRM. */
  formulaActiva: FormulaKey;
  /** Centavos de la TRM usados para seleccionar la fórmula. */
  centavosTRM: number;
  /** Valores COP de los competidores. */
  competidoresValores: number[];
  /** Valor COP de mi oferta (null si no se proporcionó). */
  miOfertaValor: number | null;
  /** Resultado por cada una de las 7 fórmulas. */
  resultados: ResultadoPorFormula[];
}

/**
 * NOTA FASE 2 — Tipos monetarios:
 * En la capa de persistencia (Prisma), usar `Decimal` en lugar de `Float` para:
 * presupuesto, trmValor, porcentajeOferta, valorOferta, porcentajeOptimo,
 * valorOptimo, puntajeOptimo, miOfertaPuntaje, diferenciaPuntos.
 * En JS/TS en memoria, `number` es suficiente para cálculos intermedios
 * dado que las ofertas son enteros de COP redondeados antes de guardarse.
 */