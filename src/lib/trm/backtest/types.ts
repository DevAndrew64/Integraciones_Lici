/**
 * Tipos del harness de backtest del motor TRM (FASE 0 — solo diagnóstico).
 *
 * Este módulo es completamente independiente del runtime productivo:
 * no lo importa ninguna API route, job ni page.tsx. Vive aislado en
 * src/lib/trm/backtest/ exclusivamente para medir con evidencia si el
 * motor actual (ARIMA + bootstrap, ventanas 60/90/180) predice mejor
 * que baselines simples — nunca para servir predicciones reales.
 *
 * `ConfiguracionCriterioTrm` es una abstracción GENÉRICA, deliberadamente
 * desacoplada de `MetodoPonderacionProceso` (Prisma) y de `RANGOS_TRM`
 * (@/lib/ponderacion-economica). En una fase posterior, un adaptador
 * `MetodoPonderacionProceso[] → ConfiguracionCriterioTrm[]` permitiría
 * reutilizar este mismo harness sin tocarlo — hoy no existe ese adaptador
 * ni se lee/escribe esa tabla.
 */

import type { RegistroTrmOficial } from './vigencias';

// ─── Configuración de criterios económicos (rangos parametrizables) ─────────

/**
 * Un criterio de evaluación económica, definido como un rango de decimales
 * 00–99 inclusivo. NO asume los 7 criterios estándar ni ninguna tabla fija:
 * el pliego de cada proceso puede definir 2, 3, 4... o los 7, con rangos
 * propios, y puede dejar decimales sin cubrir (cobertura parcial).
 */
export interface ConfiguracionCriterioTrm {
  codigo: string;
  nombre?: string;
  /** Decimal 0–99 inclusivo. */
  desde: number;
  /** Decimal 0–99 inclusivo. */
  hasta: number;
}

export interface ValidacionConfiguracionCriterios {
  valida: boolean;
  errores: string[];
  /** true si la unión de todos los rangos cubre exactamente 00–99 sin huecos. */
  coberturaCompleta: boolean;
  /** Decimales 0–99 que ningún criterio cubre (vacío si coberturaCompleta=true). */
  decimalesSinCubrir: number[];
}

// ─── Modelos evaluables ──────────────────────────────────────────────────────

export const NOMBRES_MODELO_BACKTEST = [
  'uniforme',
  'uniforme_aleatorio_sembrado',
  'frecuencia_global',
  'frecuencia_30',
  'frecuencia_60',
  'frecuencia_90',
  'moda',
  'arima_60',
  'arima_90',
  'arima_180',
  'ensemble_60_90_180',
] as const;

export type NombreModeloBacktest = (typeof NOMBRES_MODELO_BACKTEST)[number];

/** Salida uniforme de cualquier modelo/baseline del backtest. */
export interface PrediccionModelo {
  decimalPredicho: number;
  /** 100 posiciones (índice = decimal), sin negativos, suma 1 ± tolerancia. */
  distribucion00a99: number[];
}

// ─── Resultado de una predicción evaluada ────────────────────────────────────

/**
 * Una predicción del backtest, ya comparada contra el decimal real y
 * (si se proveyó `ConfiguracionCriterioTrm[]`) contra el criterio real.
 */
export interface PrediccionEvaluada {
  fechaObjetivo: string;
  horizonteEventos: number;
  modelo: NombreModeloBacktest;

  decimalPredicho: number;
  decimalReal: number;

  probabilidadDecimalPredicho: number;

  top3: number[];
  top5: number[];

  distribucion00a99: number[];

  /** null si no se proveyó configuración de criterios, o si el decimal real
   *  cae fuera de todos los rangos (cobertura parcial) — nunca se inventa. */
  criterioReal: string | null;
  /** Estrategia A: rango que contiene decimalPredicho. */
  criterioPorDecimalPrincipal: string | null;
  /** Estrategia B: criterio con mayor masa de probabilidad acumulada. */
  criterioPorMayorMasa: string | null;

  /** Suma de probabilidades por código de criterio (vacío si no hay config). */
  distribucionPorCriterio: Record<string, number>;

  aciertoDecimal: boolean;
  /** null si criterioReal es null (no evaluable, no es "fallo"). */
  aciertoCriterioPorDecimal: boolean | null;
  aciertoCriterioPorMasa: boolean | null;
}

// ─── Configuración de una corrida de backtest ────────────────────────────────

export interface BacktestConfig {
  /**
   * Registros oficiales CRUDOS (valor + vigenciaDesde + vigenciaHasta) —
   * única fuente de verdad temporal del backtest (Auditoría de mapeo
   * temporal, ver runner.ts). NUNCA una serie ya aplanada a un valor por
   * día calendario (eso pierde la vigencia real — ver vigencias.ts) ni
   * un snapshot que reutilice `construirEventosEfectivos` de producción.
   */
  registrosOficiales: RegistroTrmOficial[];
  /**
   * Horizontes a evaluar, en NÚMERO DE EVENTOS oficiales hacia adelante
   * (no días hábiles de calendario). Para el origen de índice i y
   * horizonte h, el evento objetivo es exactamente eventos[i+h] — ver
   * runner.ts para la semántica completa y por qué se abandonó el
   * horizonte en días hábiles dentro del backtest base.
   */
  horizontes: number[];
  /** Eventos oficiales mínimos reservados solo para entrenamiento antes del primer origen. */
  calentamientoEventos: number;
  /** Simulaciones bootstrap por ajuste ARIMA (reducido respecto a producción para diagnóstico). */
  nSimulaciones: number;
  /** Tamaños de ventana individuales a evaluar (además del ensemble que las combina). */
  ventanasIndividuales: number[];
  /** Evaluar 1 de cada N orígenes candidatos (reduce costo de la primera pasada). */
  muestreoOrigenes: number;
  modelos: NombreModeloBacktest[];
  /** Si se provee, cada predicción se enriquece con métricas de rango/criterio. */
  criterios?: ConfiguracionCriterioTrm[];
  /** Semilla base para determinismo (mismos datos + misma config → mismo resultado). */
  seedBase: string;
}

// ─── Resultado agregado por (modelo, horizonte) ──────────────────────────────

export interface IntervaloConfianza {
  inferior: number;
  superior: number;
}

export interface ResultadoModeloHorizonte {
  modelo: NombreModeloBacktest;
  horizonteEventos: number;
  n: number;

  exactDecimal: number;
  exactDecimalIC95: IntervaloConfianza | null;
  top3Decimal: number;
  top5Decimal: number;
  distCircularMedia: number;
  brier: number;
  logLoss: number;

  /** Solo presentes si el backtest se corrió con `criterios`. */
  exactCriterioPorDecimal: number | null;
  exactCriterioPorMasa: number | null;
  probabilidadMediaRangoReal: number | null;
  /** Predicciones excluidas del denominador de las métricas de criterio
   *  porque criterioReal era null (decimal real fuera de cobertura parcial). */
  excluidosPorCriterioRealNulo: number;
}

/** Matriz de confusión de criterios: conteo[real][predicho]. */
export interface MatrizConfusionCriterios {
  codigos: string[];
  conteo: Record<string, Record<string, number>>;
  /** Predicciones excluidas (criterioReal null). */
  excluidos: number;
}
