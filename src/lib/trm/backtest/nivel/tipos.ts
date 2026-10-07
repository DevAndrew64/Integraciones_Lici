/**
 * FASE 1 — BACKTEST DE NIVEL DE TRM (investigación, NUNCA producción).
 *
 * Pregunta única de esta fase: ¿algún modelo TRM-only predice el NIVEL de la
 * próxima certificación oficial de TRM mejor que `TRM futura = última TRM`
 * (random walk)?
 *
 * Este módulo NO toca `src/lib/trm/proyeccionDecimal.ts`, ninguna API de
 * producción, la UI, el cron ni la persistencia. Reutiliza EXCLUSIVAMENTE
 * primitivos ya existentes (arimaBootstrap, calendarioHabil, eventosEfectivos,
 * vigencias, runner.calcularParesEvaluablesPorHorizonte).
 *
 * Semántica temporal canónica: EVENTO OFICIAL (una certificación =
 * `EventoTrmOficial` de vigencias.ts). El horizonte `h` es SIEMPRE número de
 * eventos oficiales hacia adelante. Los dos modelos ARIMA existen justamente
 * para medir el costo de la semántica de días hábiles que usa producción:
 *   - `arima_prod_actual`      → replica `proyectarDecimalTrm` (colapso por
 *     valor + `hSim = contarDiasHabiles(...)`).
 *   - `arima_eventos_corregido`→ `h` pasos = `h` eventos, sin colapso por valor.
 * NUNCA se colapsan certificaciones distintas solo porque tengan el mismo
 * valor (esa es la razón de usar `vigencias.ts` como fuente).
 *
 * El decimal 00–99 se mantiene SOLO como métrica diagnóstica; ningún modelo
 * se optimiza ni se declara candidato por el decimal.
 */

export const MODELOS_NIVEL = [
  'random_walk',
  'random_walk_drift',
  'ewma',
  'random_walk_vol_ewma',
  'arima_prod_actual',
  'arima_eventos_corregido',
] as const;

export type ModeloNivel = (typeof MODELOS_NIVEL)[number];

/** Cuantiles predictivos que necesita un escenario presupuestal conservador. */
export interface CuantilesNivel {
  p10: number;
  p20: number;
  p50: number;
  p80: number;
  p90: number;
}

export interface PrediccionNivel {
  /** Predicción puntual (== p50). */
  valorPredicho: number;
  cuantiles: CuantilesNivel;
  /** Intervalo central 80 % (p10–p90). */
  intervalo80: { inferior: number; superior: number };
  /** Intervalo central 95 % (p2.5–p97.5). */
  intervalo95: { inferior: number; superior: number };
}

/** Una predicción de nivel ya comparada contra el valor real del evento objetivo. */
export interface PrediccionNivelEvaluada {
  fechaCorte: string;      // vigenciaDesde del evento origen
  fechaObjetivo: string;   // vigenciaDesde del evento objetivo
  anioObjetivo: number;
  horizonteEventos: number;
  modelo: ModeloNivel;
  /** Identificador del hiperparámetro usado (p. ej. "ewma:lambda=0.94"). */
  configId: string;

  valorOrigen: number;
  valorReal: number;
  valorPredicho: number;

  /** valorReal − valorPredicho. > 0 ⇒ el modelo SUBESTIMÓ la TRM. */
  errorSigned: number;
  errorAbs: number;

  cambioReal: number;      // valorReal − valorOrigen
  cambioPredicho: number;  // valorPredicho − valorOrigen

  cuantiles: CuantilesNivel;
  intervalo80: { inferior: number; superior: number };
  intervalo95: { inferior: number; superior: number };
  dentro80: boolean;
  dentro95: boolean;

  /** Diagnóstico secundario — NUNCA criterio de candidato. */
  decimalReal: number;
  decimalPredicho: number;
  aciertoDecimal: boolean;
}

export interface ConfigModeloNivel {
  /** ventana en eventos para el drift de `random_walk_drift`. */
  driftVentana?: number;
  /** λ de la EWMA de niveles (`ewma`). */
  ewmaLambda?: number;
  /** λ de la EWMA de varianza de log-retornos (`random_walk_vol_ewma`). */
  volLambda?: number;
  /** simulaciones bootstrap totales para los modelos ARIMA (reducido). */
  nSimArima?: number;
  /** ventanas ARIMA (por defecto las de producción: 60/90/180). */
  ventanasArima?: number[];
}

export interface MetricasNivel {
  n: number;
  mae: number;
  rmse: number;
  mdae: number;
  mape: number;
  /** MAE(modelo) / MAE(random_walk) sobre los MISMOS targets. < 1 ⇒ mejor que RW. */
  maseVsRw: number | null;
  /** Error medio con signo (real − predicho). > 0 ⇒ sesgo a SUBESTIMAR. */
  biasMedio: number;
  precisionDireccional: number;
  pinballP50: number;
  pinballP80: number;
  pinballP90: number;
  cobertura80: number;
  cobertura95: number;

  /** Casos real > predicho (el modelo se quedó corto). */
  subestimacion: { n: number; fraccion: number; maeCondicional: number; errorMedio: number };
  /** Casos real < predicho (el modelo se pasó). */
  sobreestimacion: { n: number; fraccion: number; maeCondicional: number; errorMedio: number };
}
