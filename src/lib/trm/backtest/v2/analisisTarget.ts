/**
 * Análisis de estructura del target (decimal 00-99), Segunda Generación,
 * entregable 3/8. Funciones puras — no entrenan ningún modelo, solo
 * describen si hay estructura explotable en el target ANTES de invertir en
 * modelos. Todos los p-valores usan aproximaciones estándar documentadas
 * (Wilson-Hilferty para chi-cuadrado, Fisher z para Pearson) — no requieren
 * ninguna dependencia nueva (sin scipy/jStat).
 */

const N_DECIMALES = 100;

function media(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ─── Aproximaciones estadísticas sin dependencias externas ───────────────────

/** Función de error (Abramowitz-Stegun 7.1.26), error máximo ~1.5e-7. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
function normalCDF(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// ─── Histograma / chi-cuadrado / entropía ────────────────────────────────────

export function histograma(decimales: number[]): number[] {
  const h = new Array(N_DECIMALES).fill(0);
  for (const d of decimales) h[d]++;
  return h;
}

export interface ResultadoChiCuadrado {
  estadistico: number;
  gradosLibertad: number;
  /** Aproximación Wilson-Hilferty (chi2 → normal) — no exacta, suficiente para cribado. */
  pValor: number;
}

export function chiCuadradoUniforme(decimales: number[]): ResultadoChiCuadrado {
  const n = decimales.length;
  const h = histograma(decimales);
  const esperado = n / N_DECIMALES;
  let chi2 = 0;
  for (const o of h) chi2 += (o - esperado) ** 2 / esperado;
  const gl = N_DECIMALES - 1;
  const z = (Math.pow(chi2 / gl, 1 / 3) - (1 - 2 / (9 * gl))) / Math.sqrt(2 / (9 * gl));
  const pValor = 1 - normalCDF(z);
  return { estadistico: chi2, gradosLibertad: gl, pValor };
}

export interface ResultadoEntropia {
  entropiaBits: number;
  entropiaMaximaBits: number;
  entropiaRelativa: number; // 1 = máxima entropía (uniforme perfecto)
}

export function entropia(decimales: number[]): ResultadoEntropia {
  const n = decimales.length;
  const h = histograma(decimales);
  let ent = 0;
  for (const o of h) if (o > 0) { const p = o / n; ent -= p * Math.log2(p); }
  const entropiaMaximaBits = Math.log2(N_DECIMALES);
  return { entropiaBits: ent, entropiaMaximaBits, entropiaRelativa: ent / entropiaMaximaBits };
}

// ─── Autocorrelación (lineal, referencia) y circular (correcta para 00-99) ──

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = media(xs), my = media(ys);
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); denX += (xs[i] - mx) ** 2; denY += (ys[i] - my) ** 2; }
  return (denX === 0 || denY === 0) ? NaN : num / Math.sqrt(denX * denY);
}

/** Autocorrelación lineal NAIVE del decimal como número — solo de referencia, no es la métrica correcta (ver circular). */
export function autocorrelacionLinealReferencia(decimales: number[], lag: number): number {
  if (lag >= decimales.length) return NaN;
  return pearson(decimales.slice(0, decimales.length - lag), decimales.slice(lag));
}

function mediaCircular(angulos: number[]): number {
  return Math.atan2(media(angulos.map(Math.sin)), media(angulos.map(Math.cos)));
}

/**
 * Correlación circular-circular (Jammalamadaka & SenGupta) entre la serie
 * de decimales (como ángulo 2π·d/100) y su versión desplazada `lag`
 * posiciones — la métrica CORRECTA para un dominio 00-99 donde 99 y 00 son
 * adyacentes.
 */
export function autocorrelacionCircular(decimales: number[], lag: number): number {
  const n = decimales.length;
  if (lag >= n) return NaN;
  const theta = decimales.map(d => (2 * Math.PI * d) / 100);
  const a = theta.slice(0, n - lag);
  const b = theta.slice(lag);
  const mA = mediaCircular(a), mB = mediaCircular(b);
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < a.length; i++) {
    const sa = Math.sin(a[i] - mA), sb = Math.sin(b[i] - mB);
    num += sa * sb; denA += sa * sa; denB += sb * sb;
  }
  return (denA === 0 || denB === 0) ? NaN : num / Math.sqrt(denA * denB);
}

// ─── Información mutua (discreta) entre lag y target ─────────────────────────

export interface ResultadoInformacionMutua {
  miPlugIn: number;
  /** Corrección Miller-Madow: resta el sesgo esperado por sobreajuste de
   *  muestra finita, (Kx-1)(Ky-1)/(2n·ln2) en bits — CRÍTICO con 100x100
   *  celdas conjuntas: con n~1500 (tamaño típico de TRAIN), el sesgo del
   *  estimador plug-in puede superar los 4 bits (más que la entropía
   *  máxima misma, log2(100)≈6.64), volviendo el valor crudo inútil como
   *  evidencia de dependencia. Usar SIEMPRE `miCorregida`, nunca `miPlugIn`,
   *  para interpretar señal — y preferir `informacionMutuaLagBucketed` con
   *  pocos buckets cuando n es pequeño frente a 100x100.
   */
  miCorregida: number;
  sesgoEstimado: number;
  n: number;
}

/** Información mutua (bits) entre decimales[i-lag] y decimales[i], discreta sobre 00-99, con corrección Miller-Madow. */
export function informacionMutuaLag(decimales: number[], lag: number): ResultadoInformacionMutua {
  const n = decimales.length;
  if (lag >= n) return { miPlugIn: NaN, miCorregida: NaN, sesgoEstimado: NaN, n: 0 };
  const x = decimales.slice(0, n - lag);
  const y = decimales.slice(lag);
  const conjunta = new Map<string, number>();
  const margX = new Array(N_DECIMALES).fill(0);
  const margY = new Array(N_DECIMALES).fill(0);
  for (let i = 0; i < x.length; i++) {
    const clave = `${x[i]}|${y[i]}`;
    conjunta.set(clave, (conjunta.get(clave) ?? 0) + 1);
    margX[x[i]]++; margY[y[i]]++;
  }
  const total = x.length;
  let mi = 0;
  for (const [clave, c] of conjunta) {
    const [xi, yi] = clave.split('|').map(Number);
    const pxy = c / total, px = margX[xi] / total, py = margY[yi] / total;
    mi += pxy * Math.log2(pxy / (px * py));
  }
  const kx = margX.filter(c => c > 0).length;
  const ky = margY.filter(c => c > 0).length;
  const sesgoEstimado = ((kx - 1) * (ky - 1)) / (2 * total * Math.LN2);
  return { miPlugIn: mi, miCorregida: Math.max(0, mi - sesgoEstimado), sesgoEstimado, n: total };
}

/**
 * Variante en buckets (por defecto 10x10 en vez de 100x100) — reduce
 * drásticamente el sesgo de muestra finita, preferible a
 * `informacionMutuaLag` cuando n no es mucho mayor que 100xN_bins.
 */
export function informacionMutuaLagBucketed(decimales: number[], lag: number, tamanoBucket = 10): ResultadoInformacionMutua {
  const bucketizado = decimales.map(d => Math.floor(d / tamanoBucket));
  return informacionMutuaLag(bucketizado, lag);
}

// ─── Matriz de transición (bucketed — 100x100 es demasiado sparse) ──────────

export function matrizTransicionBucket(decimalesOrigen: number[], decimalesTarget: number[], tamanoBucket = 10): number[][] {
  const nBuckets = N_DECIMALES / tamanoBucket;
  const matriz: number[][] = Array.from({ length: nBuckets }, () => new Array(nBuckets).fill(0));
  for (let i = 0; i < decimalesOrigen.length; i++) {
    matriz[Math.floor(decimalesOrigen[i] / tamanoBucket)][Math.floor(decimalesTarget[i] / tamanoBucket)]++;
  }
  return matriz.map(fila => {
    const s = fila.reduce((a, b) => a + b, 0);
    return s ? fila.map(v => v / s) : fila;
  });
}

// ─── Análisis por grupo (mes / día de semana) con corrección múltiple ───────

export interface ResultadoGrupo {
  grupo: string | number;
  n: number;
  chiCuadrado: ResultadoChiCuadrado;
}

export function chiCuadradoPorGrupo(valores: number[], grupos: number[], decimales: number[]): ResultadoGrupo[] {
  const unicos = Array.from(new Set(grupos)).sort((a, b) => a - b);
  return unicos.map(g => {
    const sub = decimales.filter((_, i) => grupos[i] === g);
    return { grupo: g, n: sub.length, chiCuadrado: chiCuadradoUniforme(sub) };
  });
}

/** Corrección de Bonferroni: p-valor ajustado = min(1, p * nComparaciones). */
export function bonferroni(pValores: number[]): number[] {
  const n = pValores.length;
  return pValores.map(p => Math.min(1, p * n));
}

// ─── Relación con variables continuas (nivel/retornos/volatilidad) ─────────

export interface ResultadoCorrelacionCircularLineal {
  variable: string;
  rConSeno: number;
  rConCoseno: number;
  pValorSeno: number;
  pValorCoseno: number;
}

/** Correlación de Fisher-z (aproximación normal, válida para n grande) entre `r` y 0, con n observaciones. */
function pValorFisherZ(r: number, n: number): number {
  if (Math.abs(r) >= 1 || n < 4) return NaN;
  const z = Math.atanh(r) * Math.sqrt(n - 3);
  return 2 * (1 - normalCDF(Math.abs(z)));
}

/**
 * Relación entre una variable continua y el decimal (circular): correlaciones
 * de Pearson por separado contra sin(θ) y cos(θ), con significancia
 * aproximada por Fisher-z. Enfoque simple y defendible — evita requerir la
 * función beta incompleta (distribución F exacta) sin nueva dependencia.
 */
export function correlacionConDecimalCircular(variable: string, valores: number[], decimales: number[]): ResultadoCorrelacionCircularLineal {
  const sen = decimales.map(d => Math.sin((2 * Math.PI * d) / 100));
  const cos = decimales.map(d => Math.cos((2 * Math.PI * d) / 100));
  const rSeno = pearson(valores, sen);
  const rCoseno = pearson(valores, cos);
  return {
    variable,
    rConSeno: rSeno,
    rConCoseno: rCoseno,
    pValorSeno: pValorFisherZ(rSeno, valores.length),
    pValorCoseno: pValorFisherZ(rCoseno, valores.length),
  };
}
