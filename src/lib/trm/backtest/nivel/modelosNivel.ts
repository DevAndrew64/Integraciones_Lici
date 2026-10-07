/**
 * Modelos de NIVEL de la Fase 1 (ver tipos.ts para el encuadre).
 *
 * Contrato: `(eventos, indiceOrigen, hEventos, cfg) → PrediccionNivel | null`.
 * Cada modelo usa EXCLUSIVAMENTE `eventos[0 .. indiceOrigen]` (no-leakage
 * estricto — el runner recorta la serie y además hay verificación mecánica
 * en runnerNivel.ts). `null` = datos insuficientes para ese modelo en ese
 * origen (nunca se cuenta como acierto/fallo).
 *
 * Reutiliza los primitivos productivos SIN modificarlos:
 *   ajustarArima, simularFinalesBootstrap, hashSemilla  (arimaBootstrap.ts)
 *   construirEventosEfectivos                            (eventosEfectivos.ts)
 *   contarDiasHabiles                                    (calendarioHabil.ts)
 */

import { ajustarArima, simularFinalesBootstrap, hashSemilla } from '../../arimaBootstrap';
import { construirEventosEfectivos } from '../../eventosEfectivos';
import { contarDiasHabiles } from '../../calendarioHabil';
import type { EventoTrmOficial } from '../vigencias';
import type { ConfigModeloNivel, CuantilesNivel, ModeloNivel, PrediccionNivel } from './tipos';

const DEFAULT_VENTANAS_ARIMA = [60, 90, 180];
const DEFAULT_NSIM_ARIMA = 4000;

// ─── utilidades ──────────────────────────────────────────────────────────────

function ordenar(xs: number[]): number[] {
  return [...xs].sort((a, b) => a - b);
}
/** Percentil por interpolación lineal (tipo 7 / R por defecto). `orden` ya ordenado ascendente. */
export function percentilInterp(orden: number[], p: number): number {
  const n = orden.length;
  if (n === 0) return NaN;
  if (n === 1) return orden[0];
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return orden[lo];
  return orden[lo] + (idx - lo) * (orden[hi] - orden[lo]);
}
function media(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
/** Cuantil de la normal estándar (Acklam, error < 1.15e-9). */
export function normalInversa(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425, phigh = 1 - plow;
  let q: number, r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function cuantilesDesdeMuestra(orden: number[]): CuantilesNivel {
  return {
    p10: percentilInterp(orden, 0.10),
    p20: percentilInterp(orden, 0.20),
    p50: percentilInterp(orden, 0.50),
    p80: percentilInterp(orden, 0.80),
    p90: percentilInterp(orden, 0.90),
  };
}

/**
 * Empaqueta una predicción. `punto` es la predicción PUNTUAL del modelo
 * (para random_walk es EXACTAMENTE la última TRM — nunca la mediana de la
 * distribución empírica); `ordenMuestra` es la muestra de la distribución
 * predictiva ya ordenada ascendente, de la que salen cuantiles e intervalos.
 * Para los modelos ARIMA `punto` == mediana de la muestra (es un modelo
 * genuino, ahí sí la mediana ES la predicción).
 */
function empaquetar(punto: number, ordenMuestra: number[]): PrediccionNivel {
  const cu = cuantilesDesdeMuestra(ordenMuestra);
  return {
    valorPredicho: punto,
    cuantiles: cu,
    intervalo80: { inferior: cu.p10, superior: cu.p90 },
    intervalo95: { inferior: percentilInterp(ordenMuestra, 0.025), superior: percentilInterp(ordenMuestra, 0.975) },
  };
}

/** Cambios a `h` eventos de vista dentro de la serie de entrenamiento (todos los solapamientos). */
function cambiosHEventos(valores: number[], h: number): number[] {
  const out: number[] = [];
  for (let j = 0; j + h < valores.length; j++) out.push(valores[j + h] - valores[j]);
  return out;
}

// ─── modelos ─────────────────────────────────────────────────────────────────

/** RW: punto = último valor. Distribución = valorOrigen + distribución empírica
 *  de cambios a h eventos observados en el entrenamiento (sin supuesto gaussiano). */
function randomWalk(valores: number[], h: number): PrediccionNivel | null {
  const v0 = valores[valores.length - 1];
  const cambios = cambiosHEventos(valores, h);
  if (cambios.length < 30) return null;
  // Punto = ÚLTIMA TRM (el baseline pedido). Distribución = v0 + cambios
  // históricos a h eventos (sin supuesto gaussiano, sin drift).
  const orden = ordenar(cambios.map(c => v0 + c));
  return empaquetar(v0, orden);
}

/** RW + drift: punto = v0 + h·drift, donde drift = (v0 − v_{-w}) / w.
 *  Distribución = punto + residuos empíricos (cambios a h eventos menos h·drift). */
function randomWalkDrift(valores: number[], h: number, ventana: number): PrediccionNivel | null {
  const n = valores.length;
  if (n <= ventana) return null;
  const v0 = valores[n - 1];
  const driftPorEvento = (v0 - valores[n - 1 - ventana]) / ventana;
  const puntoDrift = v0 + h * driftPorEvento;
  const cambios = cambiosHEventos(valores, h);
  if (cambios.length < 30) return null;
  const residuos = cambios.map(c => c - h * driftPorEvento);
  const orden = ordenar(residuos.map(r => puntoDrift + r));
  return empaquetar(puntoDrift, orden);
}

/** EWMA de niveles: el forecast a h eventos es el nivel suavizado actual
 *  (proyección plana). Distribución = nivel suavizado + errores empíricos
 *  (v[j+h] − ewma_j) observados en el entrenamiento. */
function ewma(valores: number[], h: number, lambda: number): PrediccionNivel | null {
  const n = valores.length;
  if (n < 40) return null;
  const suav = new Array<number>(n);
  suav[0] = valores[0];
  for (let t = 1; t < n; t++) suav[t] = lambda * valores[t] + (1 - lambda) * suav[t - 1];
  const nivelActual = suav[n - 1];
  const errores: number[] = [];
  for (let j = 0; j + h < n; j++) errores.push(valores[j + h] - suav[j]);
  if (errores.length < 30) return null;
  const orden = ordenar(errores.map(e => nivelActual + e));
  return empaquetar(nivelActual, orden);
}

/** RW + volatilidad EWMA: punto = v0. Intervalos paramétricos log-normales
 *  con σ_h = sqrt(σ²_EWMA · h) sobre log-retornos. Baseline de intervalos. */
function randomWalkVolEwma(valores: number[], h: number, lambda: number): PrediccionNivel | null {
  const n = valores.length;
  if (n < 40) return null;
  const v0 = valores[n - 1];
  let varRet = 0;
  let inicializada = false;
  for (let t = 1; t < n; t++) {
    if (valores[t - 1] <= 0 || valores[t] <= 0) continue;
    const r = Math.log(valores[t] / valores[t - 1]);
    if (!inicializada) { varRet = r * r; inicializada = true; }
    else varRet = lambda * varRet + (1 - lambda) * r * r;
  }
  if (!inicializada || !(varRet > 0)) return null;
  const sigmaH = Math.sqrt(varRet * h);
  const q = (p: number) => v0 * Math.exp(normalInversa(p) * sigmaH);
  const cu: CuantilesNivel = { p10: q(0.10), p20: q(0.20), p50: v0, p80: q(0.80), p90: q(0.90) };
  return {
    valorPredicho: v0,
    cuantiles: cu,
    intervalo80: { inferior: cu.p10, superior: cu.p90 },
    intervalo95: { inferior: q(0.025), superior: q(0.975) },
  };
}

/**
 * ARIMA "producción actual" — réplica EXACTA del camino de `proyectarDecimalTrm`:
 *   1. serie = eventos[0..i] como {fecha: vigenciaDesde, valor}
 *   2. eventosEf = construirEventosEfectivos(serie)   (COLAPSA por igualdad de valor)
 *   3. ventanas [60,90,180], simPorVentana = max(1000, floor(nSim/nVentanas))
 *   4. hSim = max(1, contarDiasHabiles(ultimoEventoEf.fecha, fechaObjetivo))   ← días hábiles
 *   5. pool de todas las trayectorias → mediana/percentiles
 * `fechaObjetivo` es una FECHA (vigenciaDesde del evento objetivo) — solo se
 * usa como calendario, nunca su valor (sin value-leakage).
 */
function arimaProdActual(
  eventos: EventoTrmOficial[],
  indiceOrigen: number,
  fechaObjetivo: string,
  cfg: ConfigModeloNivel,
): PrediccionNivel | null {
  const ventanas = cfg.ventanasArima ?? DEFAULT_VENTANAS_ARIMA;
  const nSim = cfg.nSimArima ?? DEFAULT_NSIM_ARIMA;
  const serie = eventos.slice(0, indiceOrigen + 1).map(e => ({ fecha: e.vigenciaDesde, valor: e.valor }));
  const eventosEf = construirEventosEfectivos(serie);
  if (eventosEf.length < 30) return null;

  const ventanasEf = Array.from(new Set(ventanas.map(v => Math.min(Math.max(v, 30), eventosEf.length)))).sort((a, b) => a - b);
  const ultimo = eventosEf[eventosEf.length - 1];
  const hSim = Math.max(1, contarDiasHabiles(ultimo.fecha, fechaObjetivo));
  const simPorVentana = Math.max(1000, Math.floor(nSim / ventanasEf.length));

  const finales: number[] = [];
  for (const ventana of ventanasEf) {
    const valores = eventosEf.slice(-ventana).map(e => e.valor);
    let modelo;
    try { modelo = ajustarArima(valores); } catch { continue; }
    const seed = hashSemilla(`nivel|prod|${ultimo.fecha}|${ultimo.valor}|${fechaObjetivo}|${simPorVentana}|${hSim}|${ventana}`);
    try {
      const bloque = simularFinalesBootstrap(modelo, hSim, simPorVentana, seed);
      for (let k = 0; k < bloque.length; k++) finales.push(bloque[k]);
    } catch { /* ventana descartada */ }
  }
  if (finales.length < 100) return null;
  const orden = ordenar(finales);
  return empaquetar(percentilInterp(orden, 0.50), orden);
}

/**
 * ARIMA "eventos corregido" — misma mecánica ARIMA/bootstrap, pero:
 *   - serie = eventos oficiales tal cual (NUNCA construirEventosEfectivos:
 *     no se colapsan certificaciones distintas con igual valor)
 *   - h pasos de simulación = h EVENTOS (no días hábiles)
 */
function arimaEventosCorregido(
  eventos: EventoTrmOficial[],
  indiceOrigen: number,
  hEventos: number,
  cfg: ConfigModeloNivel,
): PrediccionNivel | null {
  const ventanas = cfg.ventanasArima ?? DEFAULT_VENTANAS_ARIMA;
  const nSim = cfg.nSimArima ?? DEFAULT_NSIM_ARIMA;
  const disponibles = indiceOrigen + 1;
  if (disponibles < 30) return null;

  const ventanasEf = Array.from(new Set(ventanas.map(v => Math.min(Math.max(v, 30), disponibles)))).sort((a, b) => a - b);
  const origen = eventos[indiceOrigen];
  const simPorVentana = Math.max(1000, Math.floor(nSim / ventanasEf.length));

  const finales: number[] = [];
  for (const ventana of ventanasEf) {
    const valores = eventos.slice(indiceOrigen + 1 - ventana, indiceOrigen + 1).map(e => e.valor);
    let modelo;
    try { modelo = ajustarArima(valores); } catch { continue; }
    const seed = hashSemilla(`nivel|eventos|${origen.vigenciaDesde}|${origen.valor}|${hEventos}|${simPorVentana}|${ventana}`);
    try {
      const bloque = simularFinalesBootstrap(modelo, hEventos, simPorVentana, seed);
      for (let k = 0; k < bloque.length; k++) finales.push(bloque[k]);
    } catch { /* ventana descartada */ }
  }
  if (finales.length < 100) return null;
  const orden = ordenar(finales);
  return empaquetar(percentilInterp(orden, 0.50), orden);
}

// ─── despachador ─────────────────────────────────────────────────────────────

export function calcularPrediccionNivel(
  modelo: ModeloNivel,
  eventos: EventoTrmOficial[],
  indiceOrigen: number,
  hEventos: number,
  fechaObjetivo: string,
  cfg: ConfigModeloNivel = {},
): PrediccionNivel | null {
  const valores = eventos.slice(0, indiceOrigen + 1).map(e => e.valor);
  switch (modelo) {
    case 'random_walk':
      return randomWalk(valores, hEventos);
    case 'random_walk_drift':
      return randomWalkDrift(valores, hEventos, cfg.driftVentana ?? 60);
    case 'ewma':
      return ewma(valores, hEventos, cfg.ewmaLambda ?? 0.94);
    case 'random_walk_vol_ewma':
      return randomWalkVolEwma(valores, hEventos, cfg.volLambda ?? 0.94);
    case 'arima_prod_actual':
      return arimaProdActual(eventos, indiceOrigen, fechaObjetivo, cfg);
    case 'arima_eventos_corregido':
      return arimaEventosCorregido(eventos, indiceOrigen, hEventos, cfg);
    default:
      return null;
  }
}

/** Identificador reproducible del hiperparámetro efectivo de un modelo. */
export function configId(modelo: ModeloNivel, cfg: ConfigModeloNivel): string {
  switch (modelo) {
    case 'random_walk_drift': return `drift:ventana=${cfg.driftVentana ?? 60}`;
    case 'ewma': return `ewma:lambda=${cfg.ewmaLambda ?? 0.94}`;
    case 'random_walk_vol_ewma': return `vol:lambda=${cfg.volLambda ?? 0.94}`;
    case 'arima_prod_actual':
    case 'arima_eventos_corregido':
      return `arima:ventanas=${(cfg.ventanasArima ?? DEFAULT_VENTANAS_ARIMA).join('/')};nSim=${cfg.nSimArima ?? DEFAULT_NSIM_ARIMA}`;
    default: return 'sin-parametros';
  }
}

export { media };
