/**
 * FASE 2 — INTERVALOS Y RIESGO (investigación, NUNCA producción).
 *
 * Punto CONGELADO: P50 = última TRM certificada (random walk). Esta fase
 * solo busca la mejor forma reproducible de estimar los cuantiles
 * P05/P10/P20/P80/P90/P95 y los intervalos centrales 80 % / 95 % por
 * horizonte (en EVENTOS oficiales de vigencias.ts — nunca días hábiles).
 *
 * Modelos (todos con P50 == v0 exacto):
 *   A. empirico_global   — cuantiles empíricos de TODOS los cambios a h
 *                          eventos observados, centrados (mediana → 0).
 *   B. empirico_rolling   — igual pero sobre los últimos W cambios.
 *   C. rw_vol_ewma         — σ_h = √(σ²_EWMA·h) sobre log-retornos, log-normal.
 *   D. vol_ewma_calibrado  — misma escala EWMA, pero la FORMA y la COBERTURA
 *                          salen de la distribución empírica de residuos
 *                          estandarizados z=(real−v0)/σ_h de TRAIN
 *                          (calibra sesgo + cobertura + asimetría).
 *   E. garch11             — GARCH(1,1) con (α,β) fijados en TRAIN y varianza
 *                          objetivo rolling; multi-paso por suma de varianzas
 *                          condicionales; log-normal.
 *
 * Baseline obligatorio de comparación = A (empirico_global).
 *
 * No incorpora petróleo/DXY/VIX/tasas/FRED/ML. Reutiliza los primitivos ya
 * existentes; no toca proyeccionDecimal.ts ni el motor productivo.
 */

import { normalInversa, percentilInterp } from './modelosNivel';
import type { EventoTrmOficial } from '../vigencias';

export const MODELOS_INTERVALO = [
  'empirico_global',
  'empirico_rolling',
  'rw_vol_ewma',
  'vol_ewma_calibrado',
  'garch11',
] as const;
export type ModeloIntervalo = (typeof MODELOS_INTERVALO)[number];

export interface CuantilesIntervalo {
  p05: number; p10: number; p20: number; p50: number; p80: number; p90: number; p95: number;
  i80: { inferior: number; superior: number };
  i95: { inferior: number; superior: number };
}

export interface ConfigIntervalo {
  /** B — ventana (nº de cambios a h eventos) para los cuantiles rolling. */
  rollingVentana?: number;
  /** C/D — λ de la EWMA de varianza de log-retornos. */
  volLambda?: number;
  /** E — coeficientes GARCH(1,1) ya ajustados en TRAIN. */
  garch?: { alpha: number; beta: number };
  /** D — distribución empírica de z=(real−v0)/σ_h por horizonte, calibrada en
   *  TRAIN. `zPorHorizonte[h]` = arreglo ordenado ascendente de residuos
   *  estandarizados. */
  zPorHorizonte?: Record<number, number[]>;
}

const NIVELES: [keyof Omit<CuantilesIntervalo, 'i80' | 'i95'>, number][] = [
  ['p05', 0.05], ['p10', 0.10], ['p20', 0.20], ['p50', 0.50], ['p80', 0.80], ['p90', 0.90], ['p95', 0.95],
];

function ordenar(xs: number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}
function varianzaMuestral(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1);
}
export function logRetornos(valores: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < valores.length; i++) {
    if (valores[i - 1] > 0 && valores[i] > 0) out.push(Math.log(valores[i] / valores[i - 1]));
  }
  return out;
}
/** Cambios a `h` eventos observados (todos los solapamientos) dentro del entrenamiento. */
function cambiosHEventos(valores: number[], h: number): number[] {
  const out: number[] = [];
  for (let j = 0; j + h < valores.length; j++) out.push(valores[j + h] - valores[j]);
  return out;
}

/** Ensambla la salida a partir de una función cuantil `q ↦ valor` con P50 forzado a v0. */
function empaquetarDesdeCuantil(v0: number, cuantil: (p: number) => number): CuantilesIntervalo {
  const cu = {} as CuantilesIntervalo;
  for (const [k, p] of NIVELES) cu[k] = p === 0.5 ? v0 : cuantil(p);
  cu.i80 = { inferior: cuantil(0.10), superior: cuantil(0.90) };
  cu.i95 = { inferior: cuantil(0.025), superior: cuantil(0.975) };
  return cu;
}

// ─── A. empírico global (baseline) ──────────────────────────────────────────

function empiricoGlobal(valores: number[], h: number): CuantilesIntervalo | null {
  const v0 = valores[valores.length - 1];
  const cambios = cambiosHEventos(valores, h);
  if (cambios.length < 40) return null;
  const orden = ordenar(cambios);
  const mediana = percentilInterp(orden, 0.5);
  // centrado: la mediana del cambio se lleva a 0 → P50 = v0 exacto.
  const centrado = ordenar(cambios.map(c => c - mediana));
  return empaquetarDesdeCuantil(v0, p => v0 + percentilInterp(centrado, p));
}

// ─── B. empírico rolling ─────────────────────────────────────────────────────

function empiricoRolling(valores: number[], h: number, ventana: number): CuantilesIntervalo | null {
  const v0 = valores[valores.length - 1];
  const cambios = cambiosHEventos(valores, h);
  if (cambios.length < Math.max(40, Math.floor(ventana * 0.6))) return null;
  const muestra = cambios.slice(-ventana);
  const orden = ordenar(muestra);
  const mediana = percentilInterp(orden, 0.5);
  const centrado = ordenar(muestra.map(c => c - mediana));
  return empaquetarDesdeCuantil(v0, p => v0 + percentilInterp(centrado, p));
}

// ─── volatilidad EWMA (compartida por C y D) ────────────────────────────────

/** Varianza EWMA de log-retornos a 1 paso (evento) en el ÚLTIMO instante de
 *  `valores`. Usa solo datos ≤ ese instante — apto para clasificar el
 *  régimen de volatilidad prospectivamente. `null` si no hay datos. */
export function varEwmaActual(valores: number[], lambda: number): number | null {
  const r = logRetornos(valores);
  if (r.length < 40) return null;
  let v = r[0] * r[0];
  for (let t = 1; t < r.length; t++) v = lambda * v + (1 - lambda) * r[t] * r[t];
  return v > 0 ? v : null;
}

function sigmaHEwma(valores: number[], h: number, lambda: number): number | null {
  const v = varEwmaActual(valores, lambda);
  return v === null ? null : Math.sqrt(v * h);
}

// ─── C. random walk + volatilidad EWMA (log-normal) ─────────────────────────

function rwVolEwma(valores: number[], h: number, lambda: number): CuantilesIntervalo | null {
  const v0 = valores[valores.length - 1];
  const sh = sigmaHEwma(valores, h, lambda);
  if (sh === null) return null;
  return empaquetarDesdeCuantil(v0, p => (p === 0.5 ? v0 : v0 * Math.exp(normalInversa(p) * sh)));
}

// ─── D. EWMA de vol + calibración empírica de residuos estandarizados ───────

function volEwmaCalibrado(
  valores: number[], h: number, lambda: number, zOrden: number[] | undefined,
): CuantilesIntervalo | null {
  const v0 = valores[valores.length - 1];
  const sh = sigmaHEwma(valores, h, lambda);
  if (sh === null) return null;
  if (!zOrden || zOrden.length < 40) {
    // sin distribución z calibrada aún → cae al comportamiento log-normal (C)
    return empaquetarDesdeCuantil(v0, p => (p === 0.5 ? v0 : v0 * Math.exp(normalInversa(p) * sh)));
  }
  // z = (real − v0) / (v0 · σ_h)  →  real = v0 · (1 + z · σ_h)   (aprox. lineal
  // consistente con σ_h en escala de retorno). Cuantil q de z (empírico TRAIN)
  // se traslada a nivel; centrado para que P50 = v0.
  const zMediana = percentilInterp(zOrden, 0.5);
  return empaquetarDesdeCuantil(v0, p => v0 * (1 + (percentilInterp(zOrden, p) - zMediana) * sh));
}

// ─── E. GARCH(1,1) ──────────────────────────────────────────────────────────

/**
 * Ajusta GARCH(1,1) por VARIANZA OBJETIVO + grilla gruesa de (α,β) que
 * maximiza la log-verosimilitud gaussiana sobre `retornos` (SOLO TRAIN).
 * ω se deriva: ω = σ̄²·(1 − α − β). Simple y reproducible — NO es una
 * búsqueda masiva (12 combinaciones, un único ajuste).
 */
export function ajustarGarch11(retornos: number[]): { alpha: number; beta: number; logLik: number } {
  const sigma2Barra = varianzaMuestral(retornos);
  const GRID_ALPHA = [0.03, 0.05, 0.08, 0.12];
  const GRID_BETA = [0.85, 0.90, 0.93];
  let mejor = { alpha: 0.05, beta: 0.90, logLik: -Infinity };
  for (const alpha of GRID_ALPHA) {
    for (const beta of GRID_BETA) {
      if (alpha + beta >= 0.999) continue;
      const omega = sigma2Barra * (1 - alpha - beta);
      let s2 = sigma2Barra;
      let ll = 0;
      for (let t = 0; t < retornos.length; t++) {
        if (t > 0) s2 = omega + alpha * retornos[t - 1] * retornos[t - 1] + beta * s2;
        if (s2 <= 0) { ll = -Infinity; break; }
        ll += -0.5 * (Math.log(2 * Math.PI * s2) + (retornos[t] * retornos[t]) / s2);
      }
      if (ll > mejor.logLik) mejor = { alpha, beta, logLik: ll };
    }
  }
  return mejor;
}

function garch11(valores: number[], h: number, coef: { alpha: number; beta: number } | undefined): CuantilesIntervalo | null {
  if (!coef) return null;
  const v0 = valores[valores.length - 1];
  const r = logRetornos(valores);
  if (r.length < 60) return null;
  const { alpha, beta } = coef;
  const sigma2Barra = varianzaMuestral(r);          // varianza objetivo rolling (solo datos ≤ origen)
  const omega = sigma2Barra * (1 - alpha - beta);
  // recursión hasta el origen
  let s2 = sigma2Barra;
  for (let t = 1; t < r.length; t++) s2 = omega + alpha * r[t - 1] * r[t - 1] + beta * s2;
  // varianza condicional 1..h pasos adelante y su suma (Var del cambio acumulado)
  const s2Uno = omega + alpha * r[r.length - 1] * r[r.length - 1] + beta * s2;
  let sumaVar = 0;
  const phi = alpha + beta;
  for (let k = 1; k <= h; k++) {
    const s2k = sigma2Barra + Math.pow(phi, k - 1) * (s2Uno - sigma2Barra);
    sumaVar += Math.max(s2k, 1e-12);
  }
  const sh = Math.sqrt(sumaVar);
  return empaquetarDesdeCuantil(v0, p => (p === 0.5 ? v0 : v0 * Math.exp(normalInversa(p) * sh)));
}

// ─── despachador ─────────────────────────────────────────────────────────────

export function calcularIntervalo(
  modelo: ModeloIntervalo,
  eventos: EventoTrmOficial[],
  indiceOrigen: number,
  hEventos: number,
  cfg: ConfigIntervalo = {},
): CuantilesIntervalo | null {
  const valores = eventos.slice(0, indiceOrigen + 1).map(e => e.valor);
  switch (modelo) {
    case 'empirico_global':
      return empiricoGlobal(valores, hEventos);
    case 'empirico_rolling':
      return empiricoRolling(valores, hEventos, cfg.rollingVentana ?? 250);
    case 'rw_vol_ewma':
      return rwVolEwma(valores, hEventos, cfg.volLambda ?? 0.94);
    case 'vol_ewma_calibrado':
      return volEwmaCalibrado(valores, hEventos, cfg.volLambda ?? 0.94, cfg.zPorHorizonte?.[hEventos]);
    case 'garch11':
      return garch11(valores, hEventos, cfg.garch);
    default:
      return null;
  }
}

export function configIdIntervalo(modelo: ModeloIntervalo, cfg: ConfigIntervalo): string {
  switch (modelo) {
    case 'empirico_rolling': return `rolling:ventana=${cfg.rollingVentana ?? 250}`;
    case 'rw_vol_ewma': return `vol:lambda=${cfg.volLambda ?? 0.94}`;
    case 'vol_ewma_calibrado': return `volcal:lambda=${cfg.volLambda ?? 0.94};z=${cfg.zPorHorizonte ? 'train' : 'lognormal'}`;
    case 'garch11': return `garch:alpha=${cfg.garch?.alpha ?? '?'};beta=${cfg.garch?.beta ?? '?'}`;
    default: return 'empirico_global';
  }
}
