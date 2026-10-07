/**
 * Proyección de los últimos dos decimales de la TRM para una fecha objetivo.
 *
 * Pipeline determinístico (sin IA en ejecución):
 *   serie diaria oficial → eventos efectivos → ARIMA por AIC →
 *   bootstrap Monte Carlo → moda de los dos últimos decimales →
 *   clasificación en rango del pliego + reglas de horizonte.
 *
 * Reglas de horizonte (en días hábiles Colombia):
 *   0     → la fecha ya existe en el histórico: se devuelve el dato REAL.
 *   1–5   → predicción operativa (confianza base alta).
 *   6–15  → predicción con confianza media/baja.
 *   16–30 → solo escenario estadístico, no recomendable para decisión final.
 *   >30   → no se entrega decimal recomendado operativo.
 *
 * Regla de negocio: la fecha aplicable de TRM es el día hábil siguiente
 * al cierre del proceso (parámetro fechaCierre).
 */

import { FORMULA_LABELS, type FormulaKey } from '@/lib/ponderacion-economica';
import { construirEventosEfectivos } from './eventosEfectivos';
import { ajustarArima, simularFinalesBootstrap, hashSemilla } from './arimaBootstrap';
import { contarDiasHabiles, siguienteDiaHabil } from './calendarioHabil';
import type { TrmHistorialEntry } from './types';

// ─── Rangos del pliego (decimales 00–99) ─────────────────────────────────────

export interface RangoPliegoDecimal {
  desde: number;  // decimal 0–99 inclusivo
  hasta: number;  // decimal 0–99 inclusivo
  formula: FormulaKey;
  etiqueta: string;  // "0.00 – 0.33"
}

/**
 * Tabla del pliego para este módulo:
 *   0.00–0.33 media aritmética · 0.34–0.66 media aritmética alta ·
 *   0.67–0.99 media geométrica con presupuesto oficial.
 * Es distinta de la tabla global de 7 rangos (RANGOS_TRM de ponderacion-economica);
 * se recibe como parámetro para poder ajustarla por pliego.
 */
export const RANGOS_PLIEGO_DECIMAL: RangoPliegoDecimal[] = [
  { desde: 0, hasta: 33, formula: 'media_aritmetica', etiqueta: '0.00 – 0.33' },
  { desde: 34, hasta: 66, formula: 'media_aritmetica_alta', etiqueta: '0.34 – 0.66' },
  { desde: 67, hasta: 99, formula: 'media_geometrica_con_presupuesto', etiqueta: '0.67 – 0.99' },
];

function rangoDeDecimal(decimal: number, rangos: RangoPliegoDecimal[]): RangoPliegoDecimal {
  return rangos.find(r => decimal >= r.desde && decimal <= r.hasta) ?? rangos[rangos.length - 1];
}

/** Distancia circular entre dos decimales en el anillo 0–99. */
export function distanciaCircularDecimal(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 100 - diff);
}

// ─── Tipos de entrada/salida ─────────────────────────────────────────────────

export type NivelConfianza = 'alto' | 'medio' | 'bajo';

export interface ProyeccionDecimalInput {
  /** Serie diaria oficial de TRM (histórico cargado en el sistema). */
  serie: TrmHistorialEntry[];
  /** Fecha para la que se necesita la TRM (YYYY-MM-DD). */
  fechaObjetivo?: string;
  /** Fecha de cierre del proceso; la TRM aplicable es el día hábil siguiente. */
  fechaCierre?: string;
  /** "Hoy" de referencia (default: fecha actual). Inyectable para tests. */
  hoy?: string;
  /** Número de simulaciones bootstrap totales (default 50 000). */
  nSimulaciones?: number;
  /**
   * Ventanas de eventos efectivos para calibrar (default [60, 90, 180]).
   * Se ajusta un ARIMA por ventana y las simulaciones se reparten entre
   * ellas; la moda decimal se calcula sobre la mezcla de trayectorias.
   */
  ventanas?: number[];
  /** Tabla de rangos del pliego (default RANGOS_PLIEGO_DECIMAL). */
  rangos?: RangoPliegoDecimal[];
}

export interface ProyeccionDecimalOutput {
  /** "00".."99" — dato final único. null si horizonte > 30 días hábiles. */
  decimalRecomendado: string | null;
  rangoPliego: string | null;
  metodoProbable: string | null;
  metodoProbableKey: FormulaKey | null;
  nivelConfianza: NivelConfianza | null;
  horizonteDiasHabiles: number;
  advertencia: string | null;
  /** true si la fecha objetivo ya existe en el histórico (dato real, sin proyección). */
  esDatoReal: boolean;
  fechaObjetivo: string;
  /** Fecha cuya TRM aplica (== fechaObjetivo, o día hábil siguiente al cierre). */
  fechaTRMAplicable: string;
  /** TRM real (si esDatoReal) o mediana simulada. null si no aplica. */
  trmMedianaSimulada: number | null;
  probabilidadDecimal: number | null;
  probabilidadRango: number | null;
  intervalo95: { inferior: number; superior: number } | null;
  modeloUsado: string;
  variablesUsadas: string[];
}

// ─── Utilidades internas ─────────────────────────────────────────────────────

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Decimales (00–99) de un valor TRM redondeado a 2 decimales. */
export function decimalesDe(valor: number): number {
  return Math.round(valor * 100) % 100;
}

function percentil(ordenado: Float64Array, p: number): number {
  const idx = Math.min(ordenado.length - 1, Math.max(0, Math.floor(p * ordenado.length)));
  return ordenado[idx];
}

const ADVERTENCIA_BASE = 'Resultado probabilístico; no constituye certeza absoluta.';

// ─── Función principal ───────────────────────────────────────────────────────

export function proyectarDecimalTrm(input: ProyeccionDecimalInput): ProyeccionDecimalOutput {
  const {
    serie,
    fechaCierre,
    hoy = hoyISO(),
    nSimulaciones = 50_000,
    ventanas = [60, 90, 180],
    rangos = RANGOS_PLIEGO_DECIMAL,
  } = input;

  // Fecha aplicable: la indicada, o el día hábil siguiente al cierre del proceso
  const fechaObjetivo = input.fechaObjetivo ?? (fechaCierre ? siguienteDiaHabil(fechaCierre) : undefined);
  if (!fechaObjetivo) throw new Error('Se requiere fechaObjetivo o fechaCierre');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaObjetivo)) {
    throw new Error(`Fecha objetivo inválida: ${fechaObjetivo}`);
  }
  if (!serie.length) throw new Error('Serie TRM vacía');

  const ordenada = [...serie].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const ultimaFechaSerie = ordenada[ordenada.length - 1].fecha;

  // ── Caso 1: la fecha ya existe en el histórico → dato real, sin proyección ──
  if (fechaObjetivo <= ultimaFechaSerie) {
    // TRM vigente en la fecha objetivo: última entrada con fecha ≤ objetivo
    let vigente = ordenada[0];
    for (const e of ordenada) {
      if (e.fecha <= fechaObjetivo) vigente = e;
      else break;
    }
    const decimal = decimalesDe(vigente.valor);
    const rango = rangoDeDecimal(decimal, rangos);
    return {
      decimalRecomendado: String(decimal).padStart(2, '0'),
      rangoPliego: rango.etiqueta,
      metodoProbable: FORMULA_LABELS[rango.formula],
      metodoProbableKey: rango.formula,
      nivelConfianza: 'alto',
      horizonteDiasHabiles: 0,
      advertencia: null,
      esDatoReal: true,
      fechaObjetivo,
      fechaTRMAplicable: fechaObjetivo,
      trmMedianaSimulada: vigente.valor,
      probabilidadDecimal: 1,
      probabilidadRango: 1,
      intervalo95: null,
      modeloUsado: 'Dato oficial (sin proyección)',
      variablesUsadas: [],
    };
  }

  // ── Horizonte en días hábiles desde hoy (o desde el último dato si es más viejo) ──
  const anclaHorizonte = hoy < ultimaFechaSerie ? hoy : ultimaFechaSerie;
  const horizonte = Math.max(1, contarDiasHabiles(anclaHorizonte, fechaObjetivo));

  const base = {
    esDatoReal: false,
    fechaObjetivo,
    fechaTRMAplicable: fechaObjetivo,
    horizonteDiasHabiles: horizonte,
    modeloUsado: 'ARIMA sobre eventos efectivos + Bootstrap Monte Carlo',
    variablesUsadas: [] as string[],
  };

  // ── Caso 5: > 30 días hábiles → sin decimal recomendado operativo ──
  if (horizonte > 30) {
    return {
      ...base,
      decimalRecomendado: null,
      rangoPliego: null,
      metodoProbable: null,
      metodoProbableKey: null,
      nivelConfianza: null,
      trmMedianaSimulada: null,
      probabilidadDecimal: null,
      probabilidadRango: null,
      intervalo95: null,
      advertencia:
        `Horizonte de ${horizonte} días hábiles supera el máximo operativo (30). ` +
        'No se entrega decimal recomendado: la incertidumbre estadística hace que ' +
        'cualquier decimal sea prácticamente equiprobable a ese plazo.',
    };
  }

  // ── Modelado: eventos efectivos → ARIMA por ventana → bootstrap mezclado ──
  const eventos = construirEventosEfectivos(ordenada);
  if (eventos.length < 30) {
    throw new Error(`Histórico insuficiente: ${eventos.length} eventos efectivos (mínimo 30)`);
  }
  const ultimoEvento = eventos[eventos.length - 1];

  // Ventanas efectivas: recortadas al histórico disponible, sin duplicados,
  // y con mínimo de 30 eventos para poder ajustar ARIMA.
  const ventanasEfectivas = Array.from(
    new Set(ventanas.map(v => Math.min(Math.max(v, 30), eventos.length))),
  ).sort((a, b) => a - b);

  // Pasos de simulación ≈ eventos efectivos futuros ≈ días hábiles entre
  // el último evento observado y la fecha objetivo
  const hSim = Math.max(1, contarDiasHabiles(ultimoEvento.fecha, fechaObjetivo));

  const simPorVentana = Math.max(1000, Math.floor(nSimulaciones / ventanasEfectivas.length));
  const bloques: Float64Array[] = [];
  for (const ventana of ventanasEfectivas) {
    const valores = eventos.slice(-ventana).map(e => e.valor);
    const modelo = ajustarArima(valores);
    // Semilla determinística: mismos datos + misma fecha + misma ventana → mismo resultado
    const seed = hashSemilla(
      `${ultimoEvento.fecha}|${ultimoEvento.valor}|${fechaObjetivo}|${simPorVentana}|${hSim}|${ventana}`,
    );
    bloques.push(simularFinalesBootstrap(modelo, hSim, simPorVentana, seed));
  }
  const finales = new Float64Array(bloques.reduce((s, b) => s + b.length, 0));
  {
    let off = 0;
    for (const b of bloques) { finales.set(b, off); off += b.length; }
  }
  const modeloUsadoDetalle =
    `ARIMA eventos efectivos (ventanas ${ventanasEfectivas.join('/')}) + Bootstrap Monte Carlo`;

  // ── Moda de los dos últimos decimales ──
  const freq = new Array<number>(100).fill(0);
  for (let i = 0; i < finales.length; i++) freq[decimalesDe(finales[i])]++;

  const maxFreq = Math.max(...freq);
  let candidatos: number[] = [];
  for (let dec = 0; dec < 100; dec++) if (freq[dec] === maxFreq) candidatos.push(dec);

  const ordenadas = finales.slice().sort();
  const mediana = percentil(ordenadas, 0.5);
  const decimalMediana = decimalesDe(mediana);

  // Probabilidad acumulada por rango del pliego
  const probPorRango = rangos.map(r => {
    let acc = 0;
    for (let dec = r.desde; dec <= r.hasta; dec++) acc += freq[dec];
    return acc / finales.length;
  });

  // Desempate 1: decimal del rango con mayor probabilidad acumulada
  if (candidatos.length > 1) {
    const mejorProbRango = Math.max(...candidatos.map(dec =>
      probPorRango[rangos.indexOf(rangoDeDecimal(dec, rangos))]));
    candidatos = candidatos.filter(dec =>
      probPorRango[rangos.indexOf(rangoDeDecimal(dec, rangos))] === mejorProbRango);
  }
  // Desempate 2: decimal más cercano (circular) a la mediana simulada
  if (candidatos.length > 1) {
    const minDist = Math.min(...candidatos.map(dec => distanciaCircularDecimal(dec, decimalMediana)));
    candidatos = candidatos.filter(dec => distanciaCircularDecimal(dec, decimalMediana) === minDist);
  }
  // Desempate 3 (determinístico): menor decimal
  const decimalFinal = Math.min(...candidatos);

  const rango = rangoDeDecimal(decimalFinal, rangos);
  const probabilidadDecimal = freq[decimalFinal] / finales.length;
  const probabilidadRango = probPorRango[rangos.indexOf(rango)];

  // ── Nivel de confianza: banda de horizonte, degradada si la distribución es plana ──
  // Con 3 rangos, el azar puro da ~0.34 por rango; exigimos separación clara.
  let nivel: NivelConfianza = horizonte <= 5 ? 'alto' : horizonte <= 15 ? 'medio' : 'bajo';
  if (nivel !== 'bajo' && probabilidadRango < 0.4) {
    nivel = nivel === 'alto' ? 'medio' : 'bajo';
  }

  // ── Advertencias ──
  const partes: string[] = [ADVERTENCIA_BASE];
  if (horizonte >= 16) {
    partes.push(
      'Horizonte de 16–30 días hábiles: esto es solo un escenario estadístico y ' +
      'NO es recomendable para decisión final.',
    );
  } else if (horizonte >= 6) {
    partes.push('Horizonte de 6–15 días hábiles: confianza reducida.');
  }
  const variacionMediana = Math.abs(mediana - ultimoEvento.valor) / ultimoEvento.valor;
  if (variacionMediana > 0.05) {
    partes.push(
      `Proyección incoherente con la tendencia reciente: la mediana simulada se aparta ` +
      `${(variacionMediana * 100).toFixed(1)}% de la última TRM observada.`,
    );
    nivel = 'bajo';
  }

  return {
    ...base,
    modeloUsado: modeloUsadoDetalle,
    decimalRecomendado: String(decimalFinal).padStart(2, '0'),
    rangoPliego: rango.etiqueta,
    metodoProbable: FORMULA_LABELS[rango.formula],
    metodoProbableKey: rango.formula,
    nivelConfianza: nivel,
    trmMedianaSimulada: Math.round(mediana * 100) / 100,
    probabilidadDecimal: Math.round(probabilidadDecimal * 10000) / 10000,
    probabilidadRango: Math.round(probabilidadRango * 10000) / 10000,
    intervalo95: {
      inferior: Math.round(percentil(ordenadas, 0.025) * 100) / 100,
      superior: Math.round(percentil(ordenadas, 0.975) * 100) / 100,
    },
    advertencia: partes.join(' '),
  };
}
