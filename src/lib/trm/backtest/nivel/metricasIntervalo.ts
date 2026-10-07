/**
 * Métricas de INTERVALOS (Fase 2). Evalúa CALIBRACIÓN + SHARPNESS a la vez
 * para descartar el caso trivial "intervalo perfecto porque es absurdamente
 * ancho": un modelo bien calibrado con menor ancho / mejor interval score gana.
 *
 * Funciones puras — sin red/BD/motor productivo.
 */

export interface IntervaloEvaluado {
  fechaCorte: string;
  fechaObjetivo: string;
  anioObjetivo: number;
  horizonteEventos: number;
  modelo: string;
  configId: string;
  valorOrigen: number;
  valorReal: number;
  /** cuantiles predictivos (p50 == valorOrigen por construcción). */
  p05: number; p10: number; p20: number; p50: number; p80: number; p90: number; p95: number;
  i80: { inferior: number; superior: number };
  i95: { inferior: number; superior: number };
  /** régimen de volatilidad ex-post (solo para particionar el reporte). */
  regimenVol?: 'alta' | 'baja';
}

const EPS = 1e-12;

/** Pérdida pinball media para el cuantil `tau`. */
export function pinball(preds: IntervaloEvaluado[], tau: number, selector: (p: IntervaloEvaluado) => number): number {
  if (!preds.length) return NaN;
  let s = 0;
  for (const p of preds) {
    const e = p.valorReal - selector(p);
    s += e >= 0 ? tau * e : (tau - 1) * e;
  }
  return s / preds.length;
}

/** Interval score (Winkler) medio para un intervalo central de nivel `1−alpha`. */
export function intervalScore(preds: IntervaloEvaluado[], alpha: number, sel: (p: IntervaloEvaluado) => { l: number; u: number }): number {
  if (!preds.length) return NaN;
  let s = 0;
  for (const p of preds) {
    const { l, u } = sel(p);
    const y = p.valorReal;
    let is = u - l;
    if (y < l) is += (2 / alpha) * (l - y);
    else if (y > u) is += (2 / alpha) * (y - u);
    s += is;
  }
  return s / preds.length;
}

export interface MetricasIntervalo {
  n: number;
  cobertura80: number;
  cobertura95: number;
  anchoMedio80: number;
  anchoMedio95: number;
  intervalScore80: number;
  intervalScore95: number;
  pinballP05: number;
  pinballP10: number;
  pinballP20: number;
  pinballP50: number;
  pinballP80: number;
  pinballP90: number;
  pinballP95: number;
  pinballMedio: number;

  /** cobertura empírica de cada cola (nominal 2.5 % / 5 % / 10 % por lado). */
  colaInferior025: number;  // frac real < p2.5   (nominal 0.025)
  colaSuperior975: number;  // frac real > p97.5  (nominal 0.025)
  colaInferior05: number;   // frac real < p05    (nominal 0.05)
  colaSuperior95: number;   // frac real > p95    (nominal 0.05)
  colaInferior10: number;   // frac real < p10    (nominal 0.10)
  colaSuperior90: number;   // frac real > p90    (nominal 0.10)

  /** riesgo de negocio: casos donde la TRM real quedó por ENCIMA de un
   *  cuantil "de estrés" (el modelo subestimó el riesgo alcista). */
  realSobreP80: number;
  realSobreP90: number;
  realSobreP95: number;

  /** ¿el intervalo está calibrado? 80 % ∈ [0.78,0.82] y 95 % ∈ [0.93,0.97]. */
  calibrado80: boolean;
  calibrado95: boolean;
}

export function metricasIntervalo(preds: IntervaloEvaluado[]): MetricasIntervalo {
  const n = preds.length;
  const nan: MetricasIntervalo = {
    n: 0, cobertura80: NaN, cobertura95: NaN, anchoMedio80: NaN, anchoMedio95: NaN,
    intervalScore80: NaN, intervalScore95: NaN,
    pinballP05: NaN, pinballP10: NaN, pinballP20: NaN, pinballP50: NaN, pinballP80: NaN, pinballP90: NaN, pinballP95: NaN, pinballMedio: NaN,
    colaInferior025: NaN, colaSuperior975: NaN, colaInferior05: NaN, colaSuperior95: NaN, colaInferior10: NaN, colaSuperior90: NaN,
    realSobreP80: NaN, realSobreP90: NaN, realSobreP95: NaN, calibrado80: false, calibrado95: false,
  };
  if (!n) return nan;

  const frac = (f: (p: IntervaloEvaluado) => boolean) => preds.filter(f).length / n;
  const cobertura80 = frac(p => p.valorReal >= p.i80.inferior && p.valorReal <= p.i80.superior);
  const cobertura95 = frac(p => p.valorReal >= p.i95.inferior && p.valorReal <= p.i95.superior);
  const anchoMedio80 = preds.reduce((a, p) => a + (p.i80.superior - p.i80.inferior), 0) / n;
  const anchoMedio95 = preds.reduce((a, p) => a + (p.i95.superior - p.i95.inferior), 0) / n;

  const pinballP05 = pinball(preds, 0.05, p => p.p05);
  const pinballP10 = pinball(preds, 0.10, p => p.p10);
  const pinballP20 = pinball(preds, 0.20, p => p.p20);
  const pinballP50 = pinball(preds, 0.50, p => p.p50);
  const pinballP80 = pinball(preds, 0.80, p => p.p80);
  const pinballP90 = pinball(preds, 0.90, p => p.p90);
  const pinballP95 = pinball(preds, 0.95, p => p.p95);

  return {
    n, cobertura80, cobertura95, anchoMedio80, anchoMedio95,
    intervalScore80: intervalScore(preds, 0.20, p => ({ l: p.i80.inferior, u: p.i80.superior })),
    intervalScore95: intervalScore(preds, 0.05, p => ({ l: p.i95.inferior, u: p.i95.superior })),
    pinballP05, pinballP10, pinballP20, pinballP50, pinballP80, pinballP90, pinballP95,
    pinballMedio: (pinballP05 + pinballP10 + pinballP20 + pinballP50 + pinballP80 + pinballP90 + pinballP95) / 7,
    colaInferior025: frac(p => p.valorReal < p.i95.inferior),
    colaSuperior975: frac(p => p.valorReal > p.i95.superior),
    colaInferior05: frac(p => p.valorReal < p.p05),
    colaSuperior95: frac(p => p.valorReal > p.p95),
    colaInferior10: frac(p => p.valorReal < p.p10),
    colaSuperior90: frac(p => p.valorReal > p.p90),
    realSobreP80: frac(p => p.valorReal > p.p80),
    realSobreP90: frac(p => p.valorReal > p.p90),
    realSobreP95: frac(p => p.valorReal > p.p95),
    calibrado80: cobertura80 >= 0.78 && cobertura80 <= 0.82,
    calibrado95: cobertura95 >= 0.93 && cobertura95 <= 0.97,
  };
}

// ─── significancia: interval score pareado por block bootstrap ───────────────

/**
 * IC95 por moving block bootstrap de la diferencia pareada de INTERVAL SCORE
 * (nivel `1−alpha`) entre dos modelos sobre los MISMOS targets (mismo orden
 * temporal). diff = IS(A) − IS(B). Negativo ⇒ A mejor (score más bajo).
 */
export function diferenciaIntervalScoreBlockBootstrap(
  a: IntervaloEvaluado[],
  b: IntervaloEvaluado[],
  alpha: number,
  longitudBloque: number,
  nBootstrap: number,
  rng: () => number,
): { diferenciaObservada: number; inferior: number; superior: number; contieneCero: boolean; n: number } | null {
  const n = a.length;
  if (n !== b.length || n < longitudBloque * 2) return null;
  const isFila = (p: IntervaloEvaluado, lvl: 'i80' | 'i95', al: number) => {
    const { inferior: l, superior: u } = p[lvl];
    const y = p.valorReal;
    let is = u - l;
    if (y < l) is += (2 / al) * (l - y);
    else if (y > u) is += (2 / al) * (y - u);
    return is;
  };
  const lvl = alpha === 0.20 ? 'i80' : 'i95';
  const diffs = a.map((p, i) => isFila(p, lvl, alpha) - isFila(b[i], lvl, alpha));
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
  const diferenciaObservada = diffs.reduce((x, y) => x + y, 0) / n + EPS - EPS;
  return { diferenciaObservada, inferior: inf, superior: sup, contieneCero: inf <= 0 && sup >= 0, n };
}

// ─── agregación por subperiodo ───────────────────────────────────────────────

export interface FilaCoberturaSubperiodo {
  clave: string;
  n: number;
  cobertura80: number;
  cobertura95: number;
  anchoMedio95: number;
  intervalScore95: number;
  colaSuperior975: number;
}

export function coberturaPorClave(
  preds: IntervaloEvaluado[],
  clave: (p: IntervaloEvaluado) => string,
): FilaCoberturaSubperiodo[] {
  const grupos = new Map<string, IntervaloEvaluado[]>();
  for (const p of preds) {
    const k = clave(p);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(p);
  }
  return Array.from(grupos.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, g]) => {
      const m = metricasIntervalo(g);
      return { clave: k, n: m.n, cobertura80: m.cobertura80, cobertura95: m.cobertura95, anchoMedio95: m.anchoMedio95, intervalScore95: m.intervalScore95, colaSuperior975: m.colaSuperior975 };
    });
}

/**
 * Intervalo de confianza de Wilson (score) al `nivel` para una proporción
 * binomial `aciertos/n`. Robusto con n moderado y proporciones extremas
 * (a diferencia del IC normal). z por defecto = 1.959964 (95 %).
 */
export function wilson(aciertos: number, n: number, z = 1.959963984540054): { inferior: number; superior: number; centro: number } {
  if (n <= 0) return { inferior: NaN, superior: NaN, centro: NaN };
  const p = aciertos / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centro = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return { inferior: Math.max(0, centro - half), superior: Math.min(1, centro + half), centro };
}

/** Etiqueta de volatilidad ex-post: |cambio real relativo| por encima/por
 *  debajo de la mediana del conjunto. Solo para PARTICIONAR el reporte. */
export function etiquetarRegimenVol(preds: IntervaloEvaluado[]): Map<IntervaloEvaluado, 'alta' | 'baja'> {
  const rel = preds.map(p => Math.abs(p.valorReal - p.valorOrigen) / Math.abs(p.valorOrigen));
  const s = [...rel].sort((a, b) => a - b);
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  const m = new Map<IntervaloEvaluado, 'alta' | 'baja'>();
  preds.forEach((p, i) => m.set(p, rel[i] > med ? 'alta' : 'baja'));
  return m;
}
