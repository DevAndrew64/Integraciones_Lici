/**
 * Motor ARIMA + bootstrap Monte Carlo para la serie de eventos efectivos de TRM.
 *
 * Metodología (equivalente a fable::ARIMA + generate(bootstrap = TRUE) de R):
 *   1. Selección de d por autocorrelación lag-1 (serie integrada si ACF1 > 0.95).
 *   2. Grid p ∈ {0,1,2}, q ∈ {0,1,2} estimado por Hannan–Rissanen
 *      (AR largo por OLS → residuos preliminares → OLS con lags AR y MA).
 *   3. Selección del modelo con menor AIC, descartando candidatos
 *      no estacionarios/no invertibles.
 *   4. Simulación bootstrap: remuestreo iid de residuos centrados con
 *      RNG sembrado (mulberry32) → trayectorias reproducibles.
 *
 * REGLA CRÍTICA: sin IA, sin aleatoriedad no sembrada. Mismo input → mismo output.
 */

export interface ModeloArima {
  p: number;
  d: number;
  q: number;
  /** Coeficientes AR (longitud p). */
  phi: number[];
  /** Coeficientes MA (longitud q). */
  theta: number[];
  /** Intercepto de la serie diferenciada (drift si d=1). */
  c: number;
  sigma2: number;
  aic: number;
  /** Observaciones usadas en el ajuste. */
  nObs: number;
  /** Residuos del ajuste (para diagnóstico y bootstrap). */
  residuos: number[];
  /** Últimos valores de la serie diferenciada (lags AR). */
  wTail: number[];
  /** Últimos residuos (lags MA). */
  eTail: number[];
  /** Último nivel de cada etapa de integración: prev[k] = último Δ^k y. */
  prev: number[];
  ultimoValor: number;
}

// ─── RNG determinístico ──────────────────────────────────────────────────────

/** Hash FNV-1a de un string a entero 32 bits (para sembrar el RNG). */
export function hashSemilla(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** RNG mulberry32: rápido, determinístico, uniforme en [0,1). */
export function crearRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Álgebra auxiliar ────────────────────────────────────────────────────────

/**
 * OLS por ecuaciones normales con eliminación gaussiana (pivoteo parcial).
 * X: filas de regresores. Devuelve null si el sistema es singular.
 */
function ols(X: number[][], y: number[]): number[] | null {
  const n = X.length;
  if (!n) return null;
  const k = X[0].length;
  // XtX (k×k) y Xty (k)
  const A: number[][] = Array.from({ length: k }, () => new Array<number>(k + 1).fill(0));
  for (let r = 0; r < n; r++) {
    const row = X[r];
    for (let i = 0; i < k; i++) {
      for (let j = i; j < k; j++) A[i][j] += row[i] * row[j];
      A[i][k] += row[i] * y[r];
    }
  }
  for (let i = 1; i < k; i++) for (let j = 0; j < i; j++) A[i][j] = A[j][i];

  // Eliminación gaussiana con pivoteo parcial
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-10) return null;
    if (piv !== col) [A[piv], A[col]] = [A[col], A[piv]];
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let j = col; j <= k; j++) A[r][j] -= f * A[col][j];
    }
  }
  return A.map((row, i) => row[k] / A[i][i]);
}

function autocorrLag1(y: number[]): number {
  const n = y.length;
  if (n < 3) return 0;
  const mu = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    den += (y[i] - mu) ** 2;
    if (i > 0) num += (y[i] - mu) * (y[i - 1] - mu);
  }
  return den > 0 ? num / den : 0;
}

function diferenciar(y: number[]): number[] {
  const out = new Array<number>(y.length - 1);
  for (let i = 1; i < y.length; i++) out[i - 1] = y[i] - y[i - 1];
  return out;
}

/** Estacionariedad AR / invertibilidad MA para órdenes ≤ 2. */
function polinomioEstable(coef: number[]): boolean {
  if (coef.length === 0) return true;
  if (coef.length === 1) return Math.abs(coef[0]) < 0.999;
  const [c1, c2] = coef;
  return c1 + c2 < 0.999 && c2 - c1 < 0.999 && Math.abs(c2) < 0.999;
}

// ─── Estimación ARMA (Hannan–Rissanen) ───────────────────────────────────────

/** Residuos de un AR(m) largo ajustado por OLS. e[t]=0 para t<m. */
function residuosARLargo(w: number[], m: number): number[] | null {
  const n = w.length;
  const X: number[][] = [];
  const Y: number[] = [];
  for (let t = m; t < n; t++) {
    const row = [1];
    for (let i = 1; i <= m; i++) row.push(w[t - i]);
    X.push(row);
    Y.push(w[t]);
  }
  const beta = ols(X, Y);
  if (!beta) return null;
  const e = new Array<number>(n).fill(0);
  for (let t = m; t < n; t++) {
    let pred = beta[0];
    for (let i = 1; i <= m; i++) pred += beta[i] * w[t - i];
    e[t] = w[t] - pred;
  }
  return e;
}

interface AjusteArma {
  phi: number[];
  theta: number[];
  c: number;
  residuos: number[];
  sigma2: number;
  aic: number;
  nEff: number;
}

function ajustarArma(w: number[], p: number, q: number): AjusteArma | null {
  const n = w.length;
  const maxLag = Math.max(p, q, 1);
  if (n < maxLag + 10) return null;

  let ehat: number[] | null = null;
  let t0 = p;
  if (q > 0) {
    const m = Math.min(Math.max(8, p + q + 4), Math.floor(n / 3));
    ehat = residuosARLargo(w, m);
    if (!ehat) return null;
    t0 = Math.max(p, m + q);
  }
  if (n - t0 < 10) return null;

  // Regresión: w_t ~ 1 + w_{t-1..t-p} + e_{t-1..t-q}
  const X: number[][] = [];
  const Y: number[] = [];
  for (let t = t0; t < n; t++) {
    const row = [1];
    for (let i = 1; i <= p; i++) row.push(w[t - i]);
    for (let j = 1; j <= q; j++) row.push(ehat![t - j]);
    X.push(row);
    Y.push(w[t]);
  }
  const beta = ols(X, Y);
  if (!beta) return null;

  const c = beta[0];
  const phi = beta.slice(1, 1 + p);
  const theta = beta.slice(1 + p, 1 + p + q);
  if (!polinomioEstable(phi) || !polinomioEstable(theta)) return null;

  // Residuos recursivos sobre toda la serie diferenciada
  const e = new Array<number>(n).fill(0);
  const inicio = Math.max(p, q);
  let sse = 0;
  for (let t = inicio; t < n; t++) {
    let pred = c;
    for (let i = 1; i <= p; i++) pred += phi[i - 1] * w[t - i];
    for (let j = 1; j <= q; j++) pred += theta[j - 1] * e[t - j];
    e[t] = w[t] - pred;
    sse += e[t] * e[t];
  }
  const nEff = n - inicio;
  const sigma2 = sse / nEff;
  if (!isFinite(sigma2) || sigma2 <= 0) return null;
  const k = p + q + 1;
  const aic = nEff * Math.log(sigma2) + 2 * k;

  return { phi, theta, c, residuos: e.slice(inicio), sigma2, aic, nEff };
}

// ─── Ajuste ARIMA completo ───────────────────────────────────────────────────

/**
 * Ajusta ARIMA(p,d,q) a la serie de niveles `y` (eventos efectivos de TRM).
 * d se elige por autocorrelación (máx. 2); (p,q) por menor AIC en grid 0..2.
 * Lanza si la serie es demasiado corta o ningún candidato converge.
 */
export function ajustarArima(y: number[], maxOrden = 2): ModeloArima {
  if (y.length < 30) {
    throw new Error(`Serie insuficiente para ARIMA: ${y.length} eventos (mínimo 30)`);
  }

  // Selección de d
  let w = y.slice();
  let d = 0;
  const prev: number[] = [];
  while (d < 2 && autocorrLag1(w) > 0.95) {
    prev.push(w[w.length - 1]);
    w = diferenciar(w);
    d++;
  }

  // Grid (p,q) por AIC
  let mejor: (AjusteArma & { p: number; q: number }) | null = null;
  for (let p = 0; p <= maxOrden; p++) {
    for (let q = 0; q <= maxOrden; q++) {
      const fit = ajustarArma(w, p, q);
      if (fit && (!mejor || fit.aic < mejor.aic)) mejor = { ...fit, p, q };
    }
  }
  if (!mejor) throw new Error('Ningún modelo ARIMA convergió sobre la serie de eventos');

  const { p, q, phi, theta, c, residuos, sigma2, aic } = mejor;
  return {
    p, d, q, phi, theta, c, sigma2, aic,
    nObs: y.length,
    residuos,
    wTail: w.slice(-Math.max(p, 1)),
    eTail: residuos.slice(-Math.max(q, 1)),
    prev,
    ultimoValor: y[y.length - 1],
  };
}

// ─── Simulación bootstrap ────────────────────────────────────────────────────

/**
 * Simula `nSim` trayectorias bootstrap de `h` eventos hacia adelante y
 * devuelve el valor final (TRM en el horizonte) de cada trayectoria.
 *
 * Los residuos se remuestrean iid del ajuste (centrados en 0). El RNG es
 * sembrado: misma semilla → mismas trayectorias.
 */
export function simularFinalesBootstrap(
  modelo: ModeloArima,
  h: number,
  nSim: number,
  seed: number,
): Float64Array {
  const { p, d, q, phi, theta, c, residuos, wTail, eTail, prev } = modelo;
  if (h < 1) throw new Error('Horizonte de simulación debe ser ≥ 1');
  if (!residuos.length) throw new Error('Modelo sin residuos para bootstrap');

  const mu = residuos.reduce((a, b) => a + b, 0) / residuos.length;
  const pool = residuos.map(r => r - mu);
  const nPool = pool.length;
  const rng = crearRng(seed);

  const finales = new Float64Array(nSim);
  for (let s = 0; s < nSim; s++) {
    // Copias locales del estado del modelo
    const wHist = wTail.slice();
    const eHist = eTail.slice();
    const niveles = prev.slice();
    let valor = modelo.ultimoValor;

    for (let step = 0; step < h; step++) {
      let wNew = c;
      for (let i = 0; i < p; i++) wNew += phi[i] * wHist[wHist.length - 1 - i];
      const eNew = pool[Math.floor(rng() * nPool)];
      for (let j = 0; j < q; j++) wNew += theta[j] * eHist[eHist.length - 1 - j];
      wNew += eNew;

      // Invertir diferenciación: Δ^k y_t = Δ^k y_{t-1} + Δ^{k+1} y_t
      let x = wNew;
      for (let k2 = d - 1; k2 >= 0; k2--) {
        x = niveles[k2] + x;
        niveles[k2] = x;
      }
      valor = d > 0 ? niveles[0] : wNew;

      wHist.push(wNew);
      eHist.push(eNew);
      if (wHist.length > Math.max(p, 1)) wHist.shift();
      if (eHist.length > Math.max(q, 1)) eHist.shift();
    }
    finales[s] = valor;
  }
  return finales;
}
