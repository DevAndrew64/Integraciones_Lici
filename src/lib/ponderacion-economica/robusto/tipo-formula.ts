/**
 * Adaptador EXPLÍCITO `tipoFormula` (extracción / MetodoPonderacionProceso) →
 * `FormulaKey` (motor determinístico `formulas.ts`).
 *
 * FASE 0.1 — investigación. NO se usa en producción todavía.
 *
 * Regla: mapeo 1:1 por valor exacto. Sin fuzzy matching, sin normalización
 * de mayúsculas/espacios (la extracción ya normaliza a snake_case en
 * `extraccionSchema.ts`; ediciones manuales pasan por el enum
 * `TIPOS_FORMULA_VALIDOS`). Cualquier valor no listado, y explícitamente
 * `desconocida` / `personalizada`, exige revisión humana → no se optimiza.
 *
 * La aprobación humana del método (`estadoRevision='aprobado'`) sigue siendo
 * obligatoria aguas arriba; este adaptador NO la sustituye.
 *
 * FASE A.1 §6 — IMPORTANTE: esta función es solo una SUGERENCIA por nombre
 * para prellenar la revisión humana (p. ej. proponer un `formulaKeyMotor`).
 * NUNCA se usa para decidir si un método es productivo — `criterios-pliego.ts`
 * exige `equivalenciaMotorEstado = 'EQUIVALENTE_CONFIRMADA'`, que solo un
 * humano (o el motor, tras comparar la semántica) puede otorgar. Mismo
 * nombre de fórmula puede tener una regla de puntuación distinta en pliegos
 * distintos — el nombre nunca es prueba de equivalencia.
 */

import type { FormulaKey } from '../types';

/** Valores de `tipoFormula` observados en el schema de extracción + variantes
 *  de deletreo que pueden existir en BD por edición manual. */
export const MAPA_TIPO_FORMULA: Readonly<Record<string, FormulaKey | null>> = {
  // extracción (extraccionSchema.ts · TIPOS_FORMULA_VALIDOS)
  mediana: 'mediana',
  media_geometrica: 'media_geometrica',
  media_geometrica_presupuesto: 'media_geometrica_con_presupuesto', // deletreo de la extracción
  media_aritmetica: 'media_aritmetica',
  media_aritmetica_baja: 'media_aritmetica_baja',
  media_aritmetica_alta: 'media_aritmetica_alta',
  menor_valor: 'menor_valor',
  desconocida: null,
  personalizada: null,
  // deletreo del motor (por si un método fue guardado ya normalizado)
  media_geometrica_con_presupuesto: 'media_geometrica_con_presupuesto',
};

export type ResultadoMapeoFormula =
  | { ok: true; formulaKey: FormulaKey; entrada: string }
  | { ok: false; motivo: 'NO_MAPEABLE' | 'REQUIERE_REVISION'; entrada: string; detalle: string };

/**
 * Mapea un `tipoFormula` a su `FormulaKey`. Match EXACTO por clave.
 * `desconocida` / `personalizada` → REQUIERE_REVISION. Valor no listado →
 * NO_MAPEABLE.
 */
export function mapearTipoFormula(tipoFormula: string | null | undefined): ResultadoMapeoFormula {
  const entrada = String(tipoFormula ?? '');
  if (!(entrada in MAPA_TIPO_FORMULA)) {
    return { ok: false, motivo: 'NO_MAPEABLE', entrada, detalle: `tipoFormula desconocido para el motor: "${entrada}"` };
  }
  const destino = MAPA_TIPO_FORMULA[entrada];
  if (destino === null) {
    return { ok: false, motivo: 'REQUIERE_REVISION', entrada, detalle: `"${entrada}" no tiene fórmula determinística; requiere revisión del pliego` };
  }
  return { ok: true, formulaKey: destino, entrada };
}

/** Lista de valores de entrada que SÍ producen una FormulaKey (para diagnóstico). */
export const TIPOS_FORMULA_MAPEABLES: readonly string[] = Object.keys(MAPA_TIPO_FORMULA).filter(
  k => MAPA_TIPO_FORMULA[k] !== null,
);
