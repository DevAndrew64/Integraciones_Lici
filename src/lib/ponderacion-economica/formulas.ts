/**
 * Motor determinístico de ponderación económica SECOP II.
 * Implementa las 7 fórmulas del Decreto 1082/2015 y variantes.
 *
 * REGLA CRÍTICA: Gemini/Claude no participan en estos cálculos.
 * Toda la matemática es determinística y testeable.
 *
 * Redondeos documentados:
 * - clampP:       Math.round(v * 100) / 100  → 2 decimales, mínimo 0
 * - pct óptima:   Math.round(pct * 10) / 10  → 1 decimal
 * - puntaje final: Math.round(p * 100) / 100 → 2 decimales
 * Estos redondeos replican exactamente el comportamiento del modal actual.
 */

import type { FormulaKey } from './types';

/** Etiquetas visibles para cada fórmula. */
export const FORMULA_LABELS: Record<FormulaKey, string> = {
  mediana:                         'Mediana',
  media_geometrica:                'Media geométrica',
  media_geometrica_con_presupuesto:'M. geom. c/presupuesto',
  media_aritmetica:                'Media aritmética',
  media_aritmetica_baja:           'M. aritmética baja',
  media_aritmetica_alta:           'M. aritmética alta',
  menor_valor:                     'Menor valor',
};

/** Orden canónico de presentación (igual que el modal). */
export const FORMULA_KEYS: FormulaKey[] = [
  'mediana',
  'media_geometrica',
  'media_geometrica_con_presupuesto',
  'media_aritmetica',
  'media_aritmetica_baja',
  'media_aritmetica_alta',
  'menor_valor',
];

/**
 * Redondeo interno: 2 decimales, mínimo 0.
 * Replicado del original: Math.max(0, Math.round(v*100)/100)
 */
function clampP(v: number): number {
  return Math.max(0, Math.round(v * 100) / 100);
}

/**
 * Calcula el puntaje económico de cada oferta según la fórmula indicada.
 *
 * @param formula  Clave de la fórmula a aplicar.
 * @param valores  Valores en COP de todas las ofertas (competidores + mi oferta).
 *                 El último elemento se considera "mi oferta" en buscarOfertaOptima.
 * @param puntajeMaximo  PM del pliego (e.g. 39.5).
 * @param presupuesto    Presupuesto oficial en COP.
 * @returns Array de puntajes en el mismo orden que `valores`. Array vacío si no hay valores.
 */
export function calcularPuntajes(
  formula: FormulaKey,
  valores: number[],
  puntajeMaximo: number,
  presupuesto: number,
): number[] {
  const n = valores.length;
  if (!n) return [];

  switch (formula) {
    case 'mediana': {
      // Referencia = mediana (elemento central del arreglo ordenado descendente)
      const sorted = [...valores].sort((a, b) => b - a);
      const ref = sorted[Math.floor(n / 2)];
      return valores.map(v =>
        v === ref ? puntajeMaximo : clampP(puntajeMaximo * (1 - Math.abs(ref - v) / ref)),
      );
    }

    case 'media_geometrica': {
      // MG = (∏ valores)^(1/n)
      const MG = Math.pow(valores.reduce((p, v) => p * v, 1), 1 / n);
      if (!isFinite(MG) || MG <= 0) return valores.map(() => 0);
      return valores.map(v => clampP(puntajeMaximo * (1 - Math.abs(MG - v) / MG)));
    }

    case 'media_geometrica_con_presupuesto': {
      // GPO incluye nv copias del presupuesto en el producto
      // nv = ceil(n/3) según práctica SECOP II
      const nv = Math.ceil(n / 3);
      const prod = valores.reduce((p, v) => p * v, Math.pow(presupuesto, nv));
      const GPO = Math.pow(prod, 1 / (nv + n));
      if (!isFinite(GPO) || GPO <= 0) return valores.map(() => 0);
      return valores.map(v =>
        v <= GPO
          ? clampP(puntajeMaximo * (1 - (GPO - v) / GPO))
          : clampP(puntajeMaximo * (1 - 2 * Math.abs(GPO - v) / GPO)),
      );
    }

    case 'media_aritmetica': {
      // X = promedio aritmético
      const X = valores.reduce((s, v) => s + v, 0) / n;
      if (!X) return valores.map(() => 0);
      return valores.map(v =>
        v <= X
          ? clampP(puntajeMaximo * (1 - (X - v) / X))
          : clampP(puntajeMaximo * (1 - 2 * Math.abs(X - v) / X)),
      );
    }

    case 'media_aritmetica_baja': {
      // XB = (Vmin + X) / 2
      const X = valores.reduce((s, v) => s + v, 0) / n;
      const Vmin = Math.min(...valores);
      const XB = (Vmin + X) / 2;
      if (!XB) return valores.map(() => 0);
      return valores.map(v => clampP(puntajeMaximo * (1 - Math.abs(XB - v) / XB)));
    }

    case 'media_aritmetica_alta': {
      // XA = (Vmax + X) / 2
      const X = valores.reduce((s, v) => s + v, 0) / n;
      const Vmax = Math.max(...valores);
      const XA = (Vmax + X) / 2;
      if (!XA) return valores.map(() => 0);
      return valores.map(v =>
        v <= XA
          ? clampP(puntajeMaximo * (1 - (XA - v) / XA))
          : clampP(puntajeMaximo * (1 - 2 * Math.abs(XA - v) / XA)),
      );
    }

    case 'menor_valor': {
      // Puntaje proporcional al menor valor
      const Vmin = Math.min(...valores);
      if (!Vmin) return valores.map(() => 0);
      return valores.map(v => clampP(puntajeMaximo * Vmin / v));
    }

    default:
      return valores.map(() => 0);
  }
}