/**
 * Métricas del backtest. Todas son funciones puras sobre arreglos de
 * `PrediccionEvaluada` ya calculados por runner.ts — ningún acceso a red,
 * BD ni motor productivo.
 */

import { distanciaCircularDecimal } from '../proyeccionDecimal';
import type { MatrizConfusionCriterios, PrediccionEvaluada } from './types';

const EPS = 1e-9;

// ─── Métricas de decimal ──────────────────────────────────────────────────────

export function exactDecimal(predicciones: PrediccionEvaluada[]): number {
  if (!predicciones.length) return NaN;
  const aciertos = predicciones.filter(p => p.aciertoDecimal).length;
  return aciertos / predicciones.length;
}

export function topKDecimal(predicciones: PrediccionEvaluada[], k: 3 | 5): number {
  if (!predicciones.length) return NaN;
  const aciertos = predicciones.filter(p => (k === 3 ? p.top3 : p.top5).includes(p.decimalReal)).length;
  return aciertos / predicciones.length;
}

export function distanciaCircularMedia(predicciones: PrediccionEvaluada[]): number {
  if (!predicciones.length) return NaN;
  const suma = predicciones.reduce(
    (s, p) => s + distanciaCircularDecimal(p.decimalPredicho, p.decimalReal),
    0,
  );
  return suma / predicciones.length;
}

/** Brier score multiclase: media de Σ_d (prob_d − 1{d=real})². Rango [0,2], 0 = perfecto. */
export function brierScore(predicciones: PrediccionEvaluada[]): number {
  if (!predicciones.length) return NaN;
  let suma = 0;
  for (const p of predicciones) {
    let s = 0;
    for (let d = 0; d < 100; d++) {
      const prob = p.distribucion00a99[d] ?? 0;
      const indicador = d === p.decimalReal ? 1 : 0;
      s += (prob - indicador) ** 2;
    }
    suma += s;
  }
  return suma / predicciones.length;
}

/** Log loss: media de −log(prob(decimalReal)), con epsilon para evitar −∞. */
export function logLoss(predicciones: PrediccionEvaluada[]): number {
  if (!predicciones.length) return NaN;
  let suma = 0;
  for (const p of predicciones) {
    const prob = Math.max(EPS, p.distribucion00a99[p.decimalReal] ?? 0);
    suma += -Math.log(prob);
  }
  return suma / predicciones.length;
}

// ─── Métricas de criterio/rango ───────────────────────────────────────────────

/**
 * Fracción de aciertos de criterio, excluyendo del denominador los casos
 * donde `criterioReal` es null (decimal real fuera de cobertura parcial).
 * Devuelve también cuántos casos se excluyeron.
 */
export function exactCriterio(
  predicciones: PrediccionEvaluada[],
  estrategia: 'porDecimal' | 'porMasa',
): { valor: number; n: number; excluidos: number } {
  const evaluables = predicciones.filter(p => p.criterioReal !== null);
  const excluidos = predicciones.length - evaluables.length;
  if (!evaluables.length) return { valor: NaN, n: 0, excluidos };
  const campo = estrategia === 'porDecimal' ? 'aciertoCriterioPorDecimal' : 'aciertoCriterioPorMasa';
  const aciertos = evaluables.filter(p => p[campo] === true).length;
  return { valor: aciertos / evaluables.length, n: evaluables.length, excluidos };
}

/**
 * Probabilidad media asignada por el modelo al rango que realmente ocurrió
 * (P(rango real) según `distribucionPorCriterio`), excluyendo criterioReal=null.
 */
export function probabilidadMediaRangoReal(
  predicciones: PrediccionEvaluada[],
): { valor: number; n: number; excluidos: number } {
  const evaluables = predicciones.filter(p => p.criterioReal !== null);
  const excluidos = predicciones.length - evaluables.length;
  if (!evaluables.length) return { valor: NaN, n: 0, excluidos };
  const suma = evaluables.reduce(
    (s, p) => s + (p.distribucionPorCriterio[p.criterioReal as string] ?? 0),
    0,
  );
  return { valor: suma / evaluables.length, n: evaluables.length, excluidos };
}

/**
 * Matriz de confusión criterio real × criterio predicho, para la estrategia
 * indicada. Excluye predicciones con criterioReal=null (reportado aparte).
 */
export function matrizConfusionCriterios(
  predicciones: PrediccionEvaluada[],
  codigos: string[],
  estrategia: 'porDecimal' | 'porMasa',
): MatrizConfusionCriterios {
  const conteo: Record<string, Record<string, number>> = {};
  for (const real of codigos) {
    conteo[real] = {};
    for (const pred of codigos) conteo[real][pred] = 0;
  }
  let excluidos = 0;
  const campo = estrategia === 'porDecimal' ? 'criterioPorDecimalPrincipal' : 'criterioPorMayorMasa';
  for (const p of predicciones) {
    if (p.criterioReal === null) { excluidos++; continue; }
    const predicho = p[campo];
    if (predicho === null) { excluidos++; continue; }
    if (!(p.criterioReal in conteo) || !(predicho in conteo[p.criterioReal])) { excluidos++; continue; }
    conteo[p.criterioReal][predicho]++;
  }
  return { codigos, conteo, excluidos };
}

// ─── Significancia / estabilidad ──────────────────────────────────────────────

/**
 * Intervalo de confianza bootstrap (percentil) para exactDecimal, remuestreando
 * las PREDICCIONES (no las simulaciones internas del modelo) con reemplazo.
 * `nBootstrap` corridas de remuestreo; determinístico dada `seed`.
 */
export function icBootstrapExactDecimal(
  predicciones: PrediccionEvaluada[],
  nBootstrap: number,
  rng: () => number,
): { inferior: number; superior: number } | null {
  const n = predicciones.length;
  if (n < 5) return null; // muestra insuficiente para un IC con sentido
  const valores: number[] = [];
  for (let b = 0; b < nBootstrap; b++) {
    let aciertos = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rng() * n);
      if (predicciones[idx].aciertoDecimal) aciertos++;
    }
    valores.push(aciertos / n);
  }
  valores.sort((a, b) => a - b);
  const idx025 = Math.floor(0.025 * valores.length);
  const idx975 = Math.min(valores.length - 1, Math.floor(0.975 * valores.length));
  return { inferior: valores[idx025], superior: valores[idx975] };
}

// ─── Block bootstrap (series temporales con targets superpuestos) ────────────

/**
 * Intervalo de confianza por MOVING BLOCK BOOTSTRAP para ExactDecimal.
 * A diferencia de `icBootstrapExactDecimal` (remuestreo iid, puede
 * subestimar la incertidumbre cuando las predicciones son una serie
 * temporal con targets superpuestos entre orígenes consecutivos), este
 * remuestrea BLOQUES CONTIGUOS de `longitudBloque` predicciones — preserva
 * la dependencia serial dentro de cada bloque.
 *
 * `predicciones` debe venir en orden temporal (mismo horizonte, mismo
 * modelo, orden de aparición del runner — que ya es orden de índice de
 * origen creciente).
 */
export function bloqueBootstrapExactDecimal(
  predicciones: PrediccionEvaluada[],
  longitudBloque: number,
  nBootstrap: number,
  rng: () => number,
): { inferior: number; superior: number; media: number } | null {
  const n = predicciones.length;
  if (n < longitudBloque * 2) return null;
  const aciertos: number[] = predicciones.map(p => (p.aciertoDecimal ? 1 : 0));
  const nBloques = Math.ceil(n / longitudBloque);
  const valores: number[] = [];
  for (let b = 0; b < nBootstrap; b++) {
    let suma = 0;
    let total = 0;
    for (let i = 0; i < nBloques; i++) {
      const inicio = Math.floor(rng() * (n - longitudBloque + 1));
      for (let j = 0; j < longitudBloque && total < n; j++) {
        suma += aciertos[inicio + j];
        total++;
      }
    }
    valores.push(suma / total);
  }
  valores.sort((a, b) => a - b);
  const idx025 = Math.floor(0.025 * valores.length);
  const idx975 = Math.min(valores.length - 1, Math.floor(0.975 * valores.length));
  const media = aciertos.reduce((a, c) => a + c, 0) / n;
  return { inferior: valores[idx025], superior: valores[idx975], media };
}

/**
 * Intervalo de confianza por block bootstrap para la DIFERENCIA PAREADA de
 * ExactDecimal entre 2 modelos, sobre los MISMOS pares origen-target
 * (`prediccionesA[i]` y `prediccionesB[i]` deben corresponder al mismo par,
 * responsabilidad del llamador). Es la comparación correcta entre modelos:
 * un IC individual que se solapa con el de otro modelo NO implica que no
 * haya diferencia significativa — la diferencia pareada sí lo determina.
 */
export function diferenciaParEadaBloqueBootstrap(
  prediccionesA: PrediccionEvaluada[],
  prediccionesB: PrediccionEvaluada[],
  longitudBloque: number,
  nBootstrap: number,
  rng: () => number,
): { diferenciaObservada: number; inferior: number; superior: number; contieneCero: boolean; n: number } | null {
  const n = prediccionesA.length;
  if (n !== prediccionesB.length || n < longitudBloque * 2) return null;
  const diffs = prediccionesA.map((p, i) => (p.aciertoDecimal ? 1 : 0) - (prediccionesB[i].aciertoDecimal ? 1 : 0));
  const nBloques = Math.ceil(n / longitudBloque);
  const valores: number[] = [];
  for (let b = 0; b < nBootstrap; b++) {
    let suma = 0;
    let total = 0;
    for (let i = 0; i < nBloques; i++) {
      const inicio = Math.floor(rng() * (n - longitudBloque + 1));
      for (let j = 0; j < longitudBloque && total < n; j++) {
        suma += diffs[inicio + j];
        total++;
      }
    }
    valores.push(suma / total);
  }
  valores.sort((a, b) => a - b);
  const idx025 = Math.floor(0.025 * valores.length);
  const idx975 = Math.min(valores.length - 1, Math.floor(0.975 * valores.length));
  const diferenciaObservada = diffs.reduce((a, c) => a + c, 0) / n;
  const inferior = valores[idx025];
  const superior = valores[idx975];
  return { diferenciaObservada, inferior, superior, contieneCero: inferior <= 0 && superior >= 0, n };
}

/** Fracción de predicciones donde el modelo asignó probabilidad 0 (o < EPS) al decimal que realmente ocurrió. */
export function porcentajeProbabilidadCeroEnReal(predicciones: PrediccionEvaluada[]): number {
  if (!predicciones.length) return NaN;
  const ceros = predicciones.filter(p => (p.distribucion00a99[p.decimalReal] ?? 0) < EPS).length;
  return ceros / predicciones.length;
}

// ─── Calibración (diagnóstico adicional, no forma parte de la tabla principal) ──

export interface BucketCalibracion {
  rango: string;
  probabilidadMedia: number;
  tasaAciertoObservada: number;
  n: number;
}

/**
 * Agrupa predicciones por bucket de `probabilidadDecimalPredicho` y compara
 * la probabilidad media del bucket contra la tasa de acierto observada.
 * Un modelo bien calibrado: probabilidadMedia ≈ tasaAciertoObservada por bucket.
 */
export function calibracionPorBucket(
  predicciones: PrediccionEvaluada[],
  bordes: number[] = [0, 0.02, 0.05, 0.1, 0.15, 0.2, 1],
): BucketCalibracion[] {
  const buckets: BucketCalibracion[] = [];
  for (let i = 0; i < bordes.length - 1; i++) {
    const lo = bordes[i];
    const hi = bordes[i + 1];
    const enBucket = predicciones.filter(
      p => p.probabilidadDecimalPredicho >= lo && p.probabilidadDecimalPredicho < hi,
    );
    if (!enBucket.length) continue;
    const probabilidadMedia =
      enBucket.reduce((s, p) => s + p.probabilidadDecimalPredicho, 0) / enBucket.length;
    const tasaAciertoObservada = enBucket.filter(p => p.aciertoDecimal).length / enBucket.length;
    buckets.push({
      rango: `${(lo * 100).toFixed(0)}%–${(hi * 100).toFixed(0)}%`,
      probabilidadMedia,
      tasaAciertoObservada,
      n: enBucket.length,
    });
  }
  return buckets;
}
