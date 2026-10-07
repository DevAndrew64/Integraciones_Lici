/**
 * Generador del dataset causal TRM-only (Segunda Generación, entregable
 * 2/8). Cada fila: eventoOrigen E_i → features derivadas EXCLUSIVAMENTE de
 * eventos[0..i] → target = decimal/valor de E_(i+h).
 *
 * Reutiliza `calcularParesEvaluablesPorHorizonte` (runner.ts) para la
 * generación de pares origen-target — la MISMA semántica certificada en el
 * baseline (walk-forward puro por índice de evento, sin fallback, sin
 * targets sintéticos). Nunca se crean filas por día calendario repetido:
 * el dataset vive enteramente en espacio de ÍNDICE DE EVENTO, así que
 * varias fechas que comparten vigencia ya colapsan en un único evento
 * antes de llegar aquí (ver vigencias.ts).
 */

import type { EventoTrmOficial } from '../vigencias';
import { calcularParesEvaluablesPorHorizonte } from '../runner';

export interface FilaDatasetCausal {
  indiceOrigen: number;
  indiceTarget: number;
  fechaCorte: string;
  horizonte: number;
  features: Record<string, number>;
  decimalTarget: number;
  trmTarget: number;
}

const VENTANA_MAXIMA = 20; // el lag/ventana más largo requerido por el diseño de features

function media(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function mediana(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function desviacionEstandar(xs: number[]): number {
  const m = media(xs);
  return Math.sqrt(media(xs.map(x => (x - m) ** 2)));
}
/** Pendiente de regresión lineal simple de `xs` (orden temporal ascendente) contra el índice 0..n-1. */
function pendienteRegresionLineal(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mediaX = (n - 1) / 2;
  const mediaY = media(xs);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mediaX) * (xs[i] - mediaY);
    den += (i - mediaX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}
function ventanaValores(valores: number[], indiceOrigen: number, n: number): number[] {
  return valores.slice(Math.max(0, indiceOrigen - n + 1), indiceOrigen + 1);
}

/**
 * Calcula todas las features en el origen de índice `indiceOrigen`, usando
 * EXCLUSIVAMENTE `eventos[0..indiceOrigen]` (nunca eventos[indiceOrigen+1..]).
 * Requiere al menos `VENTANA_MAXIMA` eventos previos (lags/ventanas hasta 20);
 * el generador de dataset (`generarDatasetCausal`) ya garantiza esto vía
 * `calentamientoEventos >= 20` — en la práctica se usa 180, igual que el
 * baseline v1.
 */
export function calcularFeaturesEnOrigen(eventos: EventoTrmOficial[], indiceOrigen: number): Record<string, number> {
  if (indiceOrigen < VENTANA_MAXIMA) {
    throw new Error(`indiceOrigen=${indiceOrigen} insuficiente: se requieren >= ${VENTANA_MAXIMA} eventos previos.`);
  }
  const valores = eventos.map(e => e.valor);
  const decimales = eventos.map(e => e.decimal);
  const actual = valores[indiceOrigen];
  const anterior = valores[indiceOrigen - 1];

  const features: Record<string, number> = {};
  features.nivelActual = actual;
  features.diferenciaPesos = actual - anterior;
  features.retornoPorcentual = (actual - anterior) / anterior;

  for (const k of [1, 2, 3, 5, 10, 20]) features[`lag${k}`] = valores[indiceOrigen - k];
  for (const k of [1, 2, 3, 5, 10, 20]) features[`lagDecimal${k}`] = decimales[indiceOrigen - k];

  for (const n of [5, 10, 20]) {
    const v = ventanaValores(valores, indiceOrigen, n);
    features[`rollingMean${n}`] = media(v);
    features[`rollingMedian${n}`] = mediana(v);
    features[`rollingStd${n}`] = desviacionEstandar(v);
    features[`rollingMin${n}`] = Math.min(...v);
    features[`rollingMax${n}`] = Math.max(...v);
    features[`rollingRango${n}`] = Math.max(...v) - Math.min(...v);
  }

  features.pendiente = pendienteRegresionLineal(ventanaValores(valores, indiceOrigen, 20));
  const pendienteReciente = pendienteRegresionLineal(ventanaValores(valores, indiceOrigen, 10));
  const pendientePrevia = pendienteRegresionLineal(ventanaValores(valores, indiceOrigen - 10, 10));
  features.aceleracion = pendienteReciente - pendientePrevia;

  const retornos20: number[] = [];
  for (let i = indiceOrigen - 19; i <= indiceOrigen; i++) retornos20.push((valores[i] - valores[i - 1]) / valores[i - 1]);
  features.volatilidad = desviacionEstandar(retornos20);

  features.decimalActual = decimales[indiceOrigen];
  features.senDecimal = Math.sin((2 * Math.PI * decimales[indiceOrigen]) / 100);
  features.cosDecimal = Math.cos((2 * Math.PI * decimales[indiceOrigen]) / 100);

  const fechaCorte = eventos[indiceOrigen].vigenciaDesde;
  const d = new Date(fechaCorte + 'T12:00:00Z');
  features.mes = d.getUTCMonth() + 1;
  features.diaSemanaSesion = d.getUTCDay();

  const mesActual = fechaCorte.slice(0, 7);
  let posicion = 0;
  for (let i = indiceOrigen; i >= 0 && eventos[i].vigenciaDesde.slice(0, 7) === mesActual; i--) posicion++;
  features.posicionHabilMes = posicion;
  features.esInicioMes = posicion <= 3 ? 1 : 0;
  // Heurística de fin de mes basada en el día calendario del propio origen
  // (nunca en eventos[indiceOrigen+1], que sería mirar hacia adelante).
  features.esFinMes = Number(fechaCorte.slice(8, 10)) >= 25 ? 1 : 0;

  return features;
}

/**
 * Genera el dataset causal completo para los horizontes/calentamiento dados.
 * `calentamientoEventos` debe ser >= VENTANA_MAXIMA (180 en la práctica,
 * igual que el baseline v1, así que la restricción nunca se activa salvo
 * en pruebas deliberadamente pequeñas).
 */
export function generarDatasetCausal(
  eventos: EventoTrmOficial[],
  horizontes: number[],
  calentamientoEventos: number,
): FilaDatasetCausal[] {
  if (calentamientoEventos < VENTANA_MAXIMA) {
    throw new Error(`calentamientoEventos=${calentamientoEventos} debe ser >= ${VENTANA_MAXIMA}.`);
  }
  const filas: FilaDatasetCausal[] = [];
  for (const h of horizontes) {
    const pares = calcularParesEvaluablesPorHorizonte(eventos, calentamientoEventos, h, 1);
    for (const par of pares) {
      const features = calcularFeaturesEnOrigen(eventos, par.indiceOrigen);
      features.horizonteEventos = h;
      filas.push({
        indiceOrigen: par.indiceOrigen,
        indiceTarget: par.indiceObjetivo,
        fechaCorte: par.fechaCorte,
        horizonte: h,
        features,
        decimalTarget: eventos[par.indiceObjetivo].decimal,
        trmTarget: eventos[par.indiceObjetivo].valor,
      });
    }
  }
  return filas;
}

/**
 * Verificación mecánica de no-leakage para una fila: recalcula sus features
 * usando SOLO `eventos[0..indiceOrigen]` (recortando el resto de la serie
 * antes de calcular) y compara byte a byte con las features originales.
 * Si coinciden, ninguna feature pudo haber leído información posterior al
 * origen — es la misma técnica de prueba que `backtest.test.ts` usa para
 * el runner v1, aplicada aquí al dataset causal.
 */
export function verificarNoLeakageFila(eventosCompletos: EventoTrmOficial[], fila: FilaDatasetCausal): boolean {
  const eventosRecortados = eventosCompletos.slice(0, fila.indiceOrigen + 1);
  const featuresRecalculadas = calcularFeaturesEnOrigen(eventosRecortados, fila.indiceOrigen);
  featuresRecalculadas.horizonteEventos = fila.horizonte; // ver generarDatasetCausal: se agrega tras el cálculo puro
  return JSON.stringify(featuresRecalculadas) === JSON.stringify(fila.features);
}
