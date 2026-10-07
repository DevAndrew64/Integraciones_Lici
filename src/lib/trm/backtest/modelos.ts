/**
 * Modelos y baselines evaluables en el backtest.
 *
 * Cada modelo recibe SOLO datos anteriores al origen T (`serieHastaT`, ya
 * recortada por el runner — ver runner.ts §no-leakage) y devuelve una
 * `PrediccionModelo`: distribución de probabilidad sobre los 100 decimales
 * posibles (00–99) + el decimal principal (moda de esa distribución).
 *
 * Los modelos ARIMA/ensemble reutilizan EXACTAMENTE los mismos primitivos
 * que el motor productivo (ajustarArima, simularFinalesBootstrap,
 * construirEventosEfectivos, decimalesDe) — nunca se modifica ni se
 * reimplementa esa lógica, solo se orquesta con nSim reducido y datos
 * recortados. Ningún modelo aquí toca BD, red ni el motor productivo.
 */

import { ajustarArima, simularFinalesBootstrap, hashSemilla, crearRng } from '../arimaBootstrap';
import { construirEventosEfectivos, type EventoTrm } from '../eventosEfectivos';
import { contarDiasHabiles } from '../calendarioHabil';
import { decimalesDe } from '../proyeccionDecimal';
import type { TrmHistorialEntry } from '../types';
import type { NombreModeloBacktest, PrediccionModelo } from './types';

const N_DECIMALES = 100;

function distribucionUniforme(): number[] {
  return new Array(N_DECIMALES).fill(1 / N_DECIMALES);
}

/**
 * Distribución uniforme con una perturbación seudoaleatoria sembrada de
 * magnitud ~1e-9 (muy por debajo de la resolución con la que se reportan
 * Brier/LogLoss — el cambio es numéricamente despreciable para esas
 * métricas). Su único propósito es romper el empate perfecto de forma
 * reproducible: con 'uniforme' plano, `decimalPredichoDeDistribucion`
 * SIEMPRE elige el decimal 0 (desempate determinístico a favor del índice
 * menor, documentado ahí) — eso NO es la exactitud real de un baseline
 * uniforme, es un artefacto del criterio de desempate. Este modelo permite
 * observar la variabilidad empírica genuina de ExactDecimal/Top-K bajo
 * aleatoriedad real, mientras el referente estadístico principal sigue
 * siendo el valor teórico (1% / 3% / 5% — ver auditoría §4).
 */
function distribucionUniformeAleatoriaSembrada(seed: number): number[] {
  const rng = crearRng(seed);
  const perturbada = distribucionUniforme().map(p => p + rng() * 1e-9);
  return normalizarFrecuencias(perturbada);
}

function normalizarFrecuencias(freq: number[]): number[] {
  const total = freq.reduce((a, b) => a + b, 0);
  if (total <= 0) return distribucionUniforme();
  return freq.map(f => f / total);
}

/**
 * Decimal principal de una distribución: el de mayor probabilidad.
 * Desempate determinístico: menor decimal entre los que empatan
 * (mismo criterio que usa el motor productivo, proyeccionDecimal.ts).
 */
export function decimalPredichoDeDistribucion(distribucion00a99: number[]): number {
  let mejorProb = -Infinity;
  let mejorDecimal = 0;
  for (let d = 0; d < N_DECIMALES; d++) {
    if (distribucion00a99[d] > mejorProb) {
      mejorProb = distribucion00a99[d];
      mejorDecimal = d;
    }
  }
  // NOTA (auditoría §4): con una distribución perfectamente plana (modelo
  // 'uniforme'), TODOS los 100 decimales empatan y este desempate elige
  // SIEMPRE el decimal 00 (el de menor índice) — es un artefacto del
  // criterio de desempate, no la exactitud real de un baseline uniforme.
  // El referente estadístico correcto para 'uniforme' es el valor teórico
  // (1% ExactDecimal, 3% Top3, 5% Top5), nunca este punto fijo. Ver
  // 'uniforme_aleatorio_sembrado' para observar la variabilidad empírica
  // bajo un desempate genuinamente aleatorio y reproducible.
  return mejorDecimal;
}

function comoPrediccion(distribucion00a99: number[]): PrediccionModelo {
  return { decimalPredicho: decimalPredichoDeDistribucion(distribucion00a99), distribucion00a99 };
}

/** Frecuencia de decimales sobre los ÚLTIMOS `n` eventos efectivos (o todos si n es null). */
function distribucionPorFrecuenciaEventos(eventos: EventoTrm[], n: number | null): number[] | null {
  const muestra = n === null ? eventos : eventos.slice(-n);
  if (!muestra.length) return null;
  const freq = new Array(N_DECIMALES).fill(0);
  for (const e of muestra) freq[decimalesDe(e.valor)]++;
  return normalizarFrecuencias(freq);
}

/**
 * Moda: masa puntual (100%) sobre el decimal más frecuente en los eventos
 * efectivos disponibles. Desempate determinístico: menor decimal entre
 * los que empatan.
 */
function distribucionModa(eventos: EventoTrm[]): number[] | null {
  if (!eventos.length) return null;
  const freq = new Array(N_DECIMALES).fill(0);
  for (const e of eventos) freq[decimalesDe(e.valor)]++;
  const maxFreq = Math.max(...freq);
  let modaDecimal = 0;
  for (let d = 0; d < N_DECIMALES; d++) {
    if (freq[d] === maxFreq) { modaDecimal = d; break; }
  }
  const out = new Array(N_DECIMALES).fill(0);
  out[modaDecimal] = 1;
  return out;
}

/**
 * ARIMA + bootstrap sobre una única ventana de eventos efectivos.
 * Replica la mecánica interna de proyectarDecimalTrm() (mismos primitivos,
 * mismo criterio de semilla) sin importar ese archivo — así el motor
 * productivo queda intacto.
 */
function distribucionArimaVentana(
  eventos: EventoTrm[],
  ventana: number,
  fechaObjetivo: string,
  nSim: number,
  seedBase: string,
): number[] | null {
  const efectivos = eventos.length;
  if (efectivos < 30) return null;
  const ventanaEfectiva = Math.min(Math.max(ventana, 30), efectivos);

  const ultimoEvento = eventos[eventos.length - 1];
  const valores = eventos.slice(-ventanaEfectiva).map(e => e.valor);

  let modelo;
  try {
    modelo = ajustarArima(valores);
  } catch {
    return null;
  }

  const hSim = Math.max(1, contarDiasHabiles(ultimoEvento.fecha, fechaObjetivo));
  const seed = hashSemilla(
    `${seedBase}|${ultimoEvento.fecha}|${ultimoEvento.valor}|${fechaObjetivo}|${nSim}|${hSim}|${ventanaEfectiva}`,
  );

  let finales;
  try {
    finales = simularFinalesBootstrap(modelo, hSim, nSim, seed);
  } catch {
    return null;
  }

  const freq = new Array(N_DECIMALES).fill(0);
  for (let i = 0; i < finales.length; i++) freq[decimalesDe(finales[i])]++;
  return normalizarFrecuencias(freq);
}

/**
 * Ensemble productivo: mezcla las simulaciones de varias ventanas en un
 * solo pool antes de calcular la distribución (igual que proyectarDecimalTrm:
 * `simPorVentana = max(N, floor(nSimTotal / nVentanas))`).
 */
function distribucionEnsemble(
  eventos: EventoTrm[],
  ventanas: number[],
  fechaObjetivo: string,
  nSimTotal: number,
  seedBase: string,
): number[] | null {
  const efectivos = eventos.length;
  if (efectivos < 30) return null;

  const ventanasEfectivas = Array.from(
    new Set(ventanas.map(v => Math.min(Math.max(v, 30), efectivos))),
  ).sort((a, b) => a - b);

  const simPorVentana = Math.max(100, Math.floor(nSimTotal / ventanasEfectivas.length));
  const freq = new Array(N_DECIMALES).fill(0);
  let total = 0;

  const ultimoEvento = eventos[eventos.length - 1];
  const hSim = Math.max(1, contarDiasHabiles(ultimoEvento.fecha, fechaObjetivo));

  for (const ventana of ventanasEfectivas) {
    const valores = eventos.slice(-ventana).map(e => e.valor);
    let modelo;
    try {
      modelo = ajustarArima(valores);
    } catch {
      continue;
    }
    const seed = hashSemilla(
      `${seedBase}|ensemble|${ultimoEvento.fecha}|${ultimoEvento.valor}|${fechaObjetivo}|${simPorVentana}|${hSim}|${ventana}`,
    );
    let finales;
    try {
      finales = simularFinalesBootstrap(modelo, hSim, simPorVentana, seed);
    } catch {
      continue;
    }
    for (let i = 0; i < finales.length; i++) freq[decimalesDe(finales[i])]++;
    total += finales.length;
  }

  if (total === 0) return null;
  return normalizarFrecuencias(freq);
}

/**
 * Calcula la predicción de `modelo` sobre `serieHastaT` (ya recortada al
 * origen T por el runner) para pronosticar `fechaObjetivo`.
 * Devuelve null si no hay datos suficientes para ese modelo en ese origen
 * (el runner debe registrar esos casos como "sin evaluar", nunca como acierto/fallo).
 */
export function calcularPrediccionModelo(
  modelo: NombreModeloBacktest,
  serieHastaT: TrmHistorialEntry[],
  fechaObjetivo: string,
  nSimulaciones: number,
  seedBase: string,
): PrediccionModelo | null {
  if (modelo === 'uniforme') return comoPrediccion(distribucionUniforme());
  if (modelo === 'uniforme_aleatorio_sembrado') {
    const seed = hashSemilla(`${seedBase}|uniforme-aleatorio|${fechaObjetivo}`);
    return comoPrediccion(distribucionUniformeAleatoriaSembrada(seed));
  }

  const eventos = construirEventosEfectivos(serieHastaT);
  let distribucion: number[] | null;

  switch (modelo) {
    case 'frecuencia_global':
      distribucion = distribucionPorFrecuenciaEventos(eventos, null);
      break;
    case 'frecuencia_30':
      distribucion = distribucionPorFrecuenciaEventos(eventos, 30);
      break;
    case 'frecuencia_60':
      distribucion = distribucionPorFrecuenciaEventos(eventos, 60);
      break;
    case 'frecuencia_90':
      distribucion = distribucionPorFrecuenciaEventos(eventos, 90);
      break;
    case 'moda':
      distribucion = distribucionModa(eventos);
      break;
    case 'arima_60':
      distribucion = distribucionArimaVentana(eventos, 60, fechaObjetivo, nSimulaciones, seedBase);
      break;
    case 'arima_90':
      distribucion = distribucionArimaVentana(eventos, 90, fechaObjetivo, nSimulaciones, seedBase);
      break;
    case 'arima_180':
      distribucion = distribucionArimaVentana(eventos, 180, fechaObjetivo, nSimulaciones, seedBase);
      break;
    case 'ensemble_60_90_180':
      distribucion = distribucionEnsemble(eventos, [60, 90, 180], fechaObjetivo, nSimulaciones, seedBase);
      break;
    default:
      distribucion = null;
  }

  return distribucion === null ? null : comoPrediccion(distribucion);
}
