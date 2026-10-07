/**
 * Métricas de NIVEL (Fase 1). Funciones puras sobre arreglos de
 * `PrediccionNivelEvaluada` — sin red, BD ni motor productivo.
 *
 * Criterio de "candidato" (ver tipos.ts): mejora de MAE/MASE vs random_walk
 * CON evidencia estadística (diferencia pareada block bootstrap), estabilidad
 * razonable por subperiodo, intervalos calibrados, reproducibilidad.
 * Directional accuracy es informativa, NUNCA gate absoluto.
 */

import type { MetricasNivel, PrediccionNivelEvaluada } from './tipos';

// ─── básicas ─────────────────────────────────────────────────────────────────

function mediana(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Pérdida pinball (quantile loss) media para el cuantil `tau`. */
export function pinball(preds: PrediccionNivelEvaluada[], tau: number, selector: (p: PrediccionNivelEvaluada) => number): number {
  if (!preds.length) return NaN;
  let s = 0;
  for (const p of preds) {
    const q = selector(p);
    const e = p.valorReal - q;
    s += e >= 0 ? tau * e : (tau - 1) * e;
  }
  return s / preds.length;
}

/**
 * Métricas de un conjunto homogéneo (mismo modelo × horizonte, o un
 * subperiodo). `erroresRwPorTarget` (opcional): |error| de random_walk sobre
 * EXACTAMENTE los mismos targets, en el mismo orden — para MASE.
 */
export function metricasNivel(
  preds: PrediccionNivelEvaluada[],
  erroresRwPorTarget?: number[],
): MetricasNivel {
  const n = preds.length;
  const vacio: MetricasNivel = {
    n: 0, mae: NaN, rmse: NaN, mdae: NaN, mape: NaN, maseVsRw: null, biasMedio: NaN,
    precisionDireccional: NaN, pinballP50: NaN, pinballP80: NaN, pinballP90: NaN,
    cobertura80: NaN, cobertura95: NaN,
    subestimacion: { n: 0, fraccion: NaN, maeCondicional: NaN, errorMedio: NaN },
    sobreestimacion: { n: 0, fraccion: NaN, maeCondicional: NaN, errorMedio: NaN },
  };
  if (!n) return vacio;

  const abs = preds.map(p => p.errorAbs);
  const sq = preds.map(p => p.errorAbs ** 2);
  const signed = preds.map(p => p.errorSigned);
  const mae = abs.reduce((a, b) => a + b, 0) / n;
  const rmse = Math.sqrt(sq.reduce((a, b) => a + b, 0) / n);
  const mdae = mediana(abs);
  const mape = preds.reduce((a, p) => a + Math.abs(p.errorSigned) / Math.abs(p.valorReal), 0) / n;
  const biasMedio = signed.reduce((a, b) => a + b, 0) / n;

  // dirección: comparamos SIGNO del cambio; los "sin cambio real" (cambioReal==0)
  // se excluyen del denominador (no hay dirección que acertar).
  const conDireccion = preds.filter(p => p.cambioReal !== 0);
  const dirAcierto = conDireccion.filter(p => Math.sign(p.cambioPredicho) === Math.sign(p.cambioReal)).length;
  const precisionDireccional = conDireccion.length ? dirAcierto / conDireccion.length : NaN;

  const cobertura80 = preds.filter(p => p.dentro80).length / n;
  const cobertura95 = preds.filter(p => p.dentro95).length / n;

  const sub = preds.filter(p => p.errorSigned > 0);   // real > predicho → subestimó
  const sob = preds.filter(p => p.errorSigned < 0);   // real < predicho → sobreestimó
  const cond = (grupo: PrediccionNivelEvaluada[]) => ({
    n: grupo.length,
    fraccion: grupo.length / n,
    maeCondicional: grupo.length ? grupo.reduce((a, p) => a + p.errorAbs, 0) / grupo.length : NaN,
    errorMedio: grupo.length ? grupo.reduce((a, p) => a + p.errorSigned, 0) / grupo.length : NaN,
  });

  let maseVsRw: number | null = null;
  if (erroresRwPorTarget && erroresRwPorTarget.length === n) {
    const maeRw = erroresRwPorTarget.reduce((a, b) => a + b, 0) / n;
    maseVsRw = maeRw > 0 ? mae / maeRw : null;
  }

  return {
    n, mae, rmse, mdae, mape, maseVsRw, biasMedio, precisionDireccional,
    pinballP50: pinball(preds, 0.50, p => p.cuantiles.p50),
    pinballP80: pinball(preds, 0.80, p => p.cuantiles.p80),
    pinballP90: pinball(preds, 0.90, p => p.cuantiles.p90),
    cobertura80, cobertura95,
    subestimacion: cond(sub),
    sobreestimacion: cond(sob),
  };
}

// ─── significancia: diferencia pareada por block bootstrap ───────────────────

/**
 * IC95 por MOVING BLOCK BOOTSTRAP de la diferencia pareada de una pérdida
 * entre dos modelos sobre los MISMOS targets (mismo orden temporal).
 *   perdida = 'abs'  → diferencia de MAE
 *   perdida = 'sq'   → diferencia de MSE (se reporta también la raíz)
 * `diff = perdida(A) − perdida(B)`. Negativo ⇒ A mejor que B.
 */
export function diferenciaParEadaBlockBootstrap(
  a: PrediccionNivelEvaluada[],
  b: PrediccionNivelEvaluada[],
  perdida: 'abs' | 'sq',
  longitudBloque: number,
  nBootstrap: number,
  rng: () => number,
): { diferenciaObservada: number; inferior: number; superior: number; contieneCero: boolean; n: number } | null {
  const n = a.length;
  if (n !== b.length || n < longitudBloque * 2) return null;
  const la = a.map(p => (perdida === 'abs' ? p.errorAbs : p.errorAbs ** 2));
  const lb = b.map(p => (perdida === 'abs' ? p.errorAbs : p.errorAbs ** 2));
  const diffs = la.map((x, i) => x - lb[i]);
  const nBloques = Math.ceil(n / longitudBloque);
  const muestras: number[] = [];
  for (let s = 0; s < nBootstrap; s++) {
    let suma = 0, total = 0;
    for (let k = 0; k < nBloques; k++) {
      const inicio = Math.floor(rng() * (n - longitudBloque + 1));
      for (let j = 0; j < longitudBloque && total < n; j++) { suma += diffs[inicio + j]; total++; }
    }
    muestras.push(suma / total);
  }
  muestras.sort((x, y) => x - y);
  const inf = muestras[Math.floor(0.025 * muestras.length)];
  const sup = muestras[Math.min(muestras.length - 1, Math.floor(0.975 * muestras.length))];
  const diferenciaObservada = diffs.reduce((x, y) => x + y, 0) / n;
  return { diferenciaObservada, inferior: inf, superior: sup, contieneCero: inf <= 0 && sup >= 0, n };
}

/**
 * IC95 por block bootstrap del RATIO de MAE (MASE) entre A y B sobre los
 * mismos targets. ratio < 1 ⇒ A mejor. Complementa la diferencia pareada
 * (el ratio es la métrica que pide el usuario para MASE).
 */
export function ratioMaeBlockBootstrap(
  a: PrediccionNivelEvaluada[],
  b: PrediccionNivelEvaluada[],
  longitudBloque: number,
  nBootstrap: number,
  rng: () => number,
): { ratioObservado: number; inferior: number; superior: number; contieneUno: boolean; n: number } | null {
  const n = a.length;
  if (n !== b.length || n < longitudBloque * 2) return null;
  const la = a.map(p => p.errorAbs);
  const lb = b.map(p => p.errorAbs);
  const nBloques = Math.ceil(n / longitudBloque);
  const muestras: number[] = [];
  for (let s = 0; s < nBootstrap; s++) {
    let sa = 0, sb = 0, total = 0;
    for (let k = 0; k < nBloques; k++) {
      const inicio = Math.floor(rng() * (n - longitudBloque + 1));
      for (let j = 0; j < longitudBloque && total < n; j++) { sa += la[inicio + j]; sb += lb[inicio + j]; total++; }
    }
    muestras.push(sb > 0 ? sa / sb : NaN);
  }
  muestras.sort((x, y) => x - y);
  const inf = muestras[Math.floor(0.025 * muestras.length)];
  const sup = muestras[Math.min(muestras.length - 1, Math.floor(0.975 * muestras.length))];
  const maeA = la.reduce((x, y) => x + y, 0) / n;
  const maeB = lb.reduce((x, y) => x + y, 0) / n;
  const ratioObservado = maeB > 0 ? maeA / maeB : NaN;
  return { ratioObservado, inferior: inf, superior: sup, contieneUno: inf <= 1 && sup >= 1, n };
}

// ─── agregación por subperiodo ───────────────────────────────────────────────

/**
 * Régimen de volatilidad de cada predicción: 'alta' si la |variación real
 * a h eventos| relativa está por encima de la mediana del conjunto, 'baja' si no.
 * Se usa la variación REAL solo para PARTICIONAR el reporte (no entra en
 * ninguna decisión de modelo) — es un diagnóstico ex-post.
 */
export function etiquetarVolatilidad(preds: PrediccionNivelEvaluada[]): Map<PrediccionNivelEvaluada, 'alta' | 'baja'> {
  const rel = preds.map(p => Math.abs(p.cambioReal) / Math.abs(p.valorOrigen));
  const s = [...rel].sort((a, b) => a - b);
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  const m = new Map<PrediccionNivelEvaluada, 'alta' | 'baja'>();
  preds.forEach((p, i) => m.set(p, rel[i] > med ? 'alta' : 'baja'));
  return m;
}

export interface FilaSubperiodo {
  clave: string;
  n: number;
  mae: number;
  rmse: number;
  maseVsRw: number | null;
  bias: number;
  cobertura95: number;
}

export function agregarPorClave(
  preds: PrediccionNivelEvaluada[],
  clave: (p: PrediccionNivelEvaluada) => string,
  erroresRwPorTarget?: Map<PrediccionNivelEvaluada, number>,
): FilaSubperiodo[] {
  const grupos = new Map<string, PrediccionNivelEvaluada[]>();
  for (const p of preds) {
    const k = clave(p);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(p);
  }
  return Array.from(grupos.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, g]) => {
      const rwErr = erroresRwPorTarget ? g.map(p => erroresRwPorTarget.get(p) ?? NaN) : undefined;
      const m = metricasNivel(g, rwErr && rwErr.every(x => Number.isFinite(x)) ? rwErr : undefined);
      return { clave: k, n: m.n, mae: m.mae, rmse: m.rmse, maseVsRw: m.maseVsRw, bias: m.biasMedio, cobertura95: m.cobertura95 };
    });
}
