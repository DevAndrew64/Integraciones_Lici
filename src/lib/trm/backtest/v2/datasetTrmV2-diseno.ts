/**
 * DISEÑO (no implementación) del dataset exógeno de Segunda Generación —
 * entregables §3/§5/§6/§10. Solo tipos e interfaces — deliberadamente SIN
 * ninguna función que descargue, procese o entrene con datos reales. No se
 * construye este dataset hasta tener una fuente USD/COP aprobada
 * (`fuentesUsdCop.ts`) y el `ContextoPrediccionTrm` correspondiente
 * verificado contra `momentoCorte.ts`.
 */

// ─── Contrato de datos USD/COP — independiente del proveedor (Fase B.1 §7) ──

/**
 * Contrato genérico de una sesión/observación USD/COP — el modelo NUNCA
 * depende directamente de la estructura de un proveedor (SET-ICAP DAPI,
 * TwelveData, u otro); cada adaptador de proveedor deberá mapear a esta
 * interfaz, nunca al revés. FIX != cierre != promedio ponderado != TRM
 * (ver auditoría §2 de esta ronda) — por eso son campos independientes,
 * nunca se asume que uno sustituye a otro.
 */
export interface SesionUsdCop {
  fechaSesion: string;
  timezone: 'America/Bogota';

  apertura?: number;
  cierre?: number;
  minimo?: number;
  maximo?: number;
  promedioPonderado?: number;
  precioFix?: number;

  volumen?: number;
  montoFix?: number;
  numeroOperaciones?: number;

  timestampApertura?: string;
  timestampCierre?: string;
  timestampFix?: string;

  proveedor: string;
  tipoFuente: 'SETFX_DAPI' | 'SETFX_ANALYTICS' | 'SETFX_EXPORT' | 'PROXY_GLOBAL';

  /** Debe evaluarse contra el `fechaHoraCorte` real de cada predicción — nunca asumido true a nivel de sesión completa (ver momentoCorte.ts, escenario B). */
  disponibleEnCorte: boolean;
}

// ─── Productos estadísticos distintos por momento de corte (Fase B.1 §3) ───
// Nunca se mezclan las métricas de estos 4 modos — cada uno es una
// evaluación independiente, con su propio conjunto de features disponibles.

export type ProductoEstadisticoTrm = 'PRE_SESION' | 'INTRASESION' | 'POST_SESION' | 'FORECAST_MULTIHORIZONTE';

/**
 * Selección automática de producto (Fase B.1 §4): si la fecha objetivo es
 * el PRÓXIMO evento oficial (h=1) y la sesión de origen ya cerró →
 * POST_SESION; si aún no cerró → PRE_SESION o INTRASESION (según si la
 * ventana de sesión ya abrió); si la fecha objetivo está a 2+ eventos →
 * FORECAST_MULTIHORIZONTE. Diseño únicamente — no implementado.
 */
export function seleccionarProductoEstadistico(
  _horizonteEventos: number,
  _sesionOrigenYaCerro: boolean,
  _sesionOrigenYaAbrio: boolean,
): ProductoEstadisticoTrm {
  throw new Error('No implementado — solo diseño. Ver Fase B.1 §4.');
}

// ─── §3 Features USD/COP candidatas (solo si demostrablemente disponibles en el corte) ──

export interface UsdCopFeaturesDiseno {
  /** usdCopSpotDisponibleEnCorte − trmVigente (evento origen E_i). La
   *  variable más importante a investigar — mide la brecha entre el
   *  mercado spot y la última TRM oficial certificada. */
  spreadMercadoVsTrm: number;
  retornoUSD1: number;
  retornoUSD2: number;
  retornoUSD3: number;
  retornoUSD5: number;
  volatilidadUSD5: number;
  volatilidadUSD10: number;
  volatilidadUSD20: number;
  /** (high - low) de la sesión relevante, únicamente si esa sesión ya cerró en el corte (ver momentoCorte.ts, escenarios C/D). */
  highLowRange: number;
  /** apertura de la sesión relevante − trmVigente. */
  gapAperturaVsTrm: number;
  /** cierre de la sesión relevante − trmVigente — solo disponible en escenarios C/D (ver momentoCorte.ts). */
  closeVsTrm: number;
  momentum: number;
  pendiente: number;
  aceleracion: number;
}

// ─── §10 Fila del dataset exógeno futuro (diseño, NO implementado) ──────────

export interface FilaDatasetTrmV2 {
  indiceOrigen: number;
  indiceTarget: number;
  fechaHoraCorte: string;
  horizonte: number;

  /** Features TRM-only ya implementadas y validadas en datasetCausal.ts (v1) — se reutilizan sin cambios. */
  trmFeatures: Record<string, number>;
  /** Features USD/COP — NO se llenan hasta tener una fuente aprobada; cada campo debe poder demostrar `MetadatoFeature.disponibleEnCorte === true`. */
  usdCopFeatures: Partial<UsdCopFeaturesDiseno>;
  /** DXY/VIX/Brent/tasas — solo tras la auditoría de §8, ninguna integrada todavía. */
  otrasFeatures?: Record<string, number>;

  deltaTrmTarget: number;
  decimalTarget: number;
}

// ─── §9 Metadatos de alineación temporal — obligatorios por feature ─────────

export interface MetadatoFeature {
  nombre: string;
  timestampFuente: string;
  disponibleEnCorte: boolean;
  timezone: string;
  proveedor: string;
}

/**
 * Regla de exclusión (§9): si `disponibleEnCorte` no puede demostrarse con
 * un `timestampFuente <= fechaHoraCorte` verificable, la feature queda
 * EXCLUIDA del dataset — nunca se incluye "por si acaso" ni se imputa.
 */
export function excluirPorNoDisponibilidad(metadato: MetadatoFeature, fechaHoraCorte: string): boolean {
  return !metadato.disponibleEnCorte || metadato.timestampFuente > fechaHoraCorte;
}

// ─── §6 Reconstrucción de distribución a partir de cuantiles de ΔTRM ────────

export const CUANTILES_OBJETIVO = [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95] as const;
export type ProbabilidadCuantil = (typeof CUANTILES_OBJETIVO)[number];

export interface PrediccionCuantilesDeltaTrm {
  q05: number; q10: number; q25: number; q50: number; q75: number; q90: number; q95: number;
}

/**
 * DISEÑO del algoritmo de reconstrucción (documentado, NO implementado
 * todavía — ningún modelo se entrena en esta ronda):
 *
 *  1. El quantile Gradient Boosting entrena 7 modelos independientes (uno
 *     por cuantil, pinball loss) sobre `features → ΔTRM_h`, para cada
 *     horizonte h por separado (nunca un modelo universal — ver §5).
 *  2. En inferencia, los 7 cuantiles de ΔTRM_h se interpolan (monótona,
 *     ej. PCHIP o lineal por tramos, forzando no-decrecimiento — si un
 *     cuantil sale menor que el anterior, se corrige con "rearrangement"
 *     de Chernozhukov et al. antes de continuar) para construir una
 *     aproximación continua de la CDF de ΔTRM_h.
 *  3. Se muestrea esa CDF (ej. inversión de la CDF interpolada con N
 *     escenarios, o Monte Carlo directo sobre la interpolación) para
 *     generar un conjunto de escenarios de ΔTRM_h.
 *  4. Cada escenario: TRM_futura = TRM_i (evento origen) + escenario_ΔTRM.
 *  5. decimal = decimalesDe(TRM_futura) (reutilizando `proyeccionDecimal.ts`,
 *     producción, sin modificar — mismo criterio que el harness v1).
 *  6. La distribución P(00..99) se arma agregando la frecuencia de cada
 *     decimal entre todos los escenarios — mismo patrón que
 *     `distribucionArimaVentana`/`distribucionEnsemble` en modelos.ts (v1),
 *     reutilizable sin cambios en la mecánica de agregación.
 *
 * Esta función NO se implementa en esta ronda — es la especificación para
 * la siguiente fase de entrenamiento, una vez aprobada la fuente USD/COP.
 */
export function disenoReconstruccionDistribucion(
  _cuantiles: PrediccionCuantilesDeltaTrm,
  _trmOrigen: number,
  _nEscenarios: number,
): never {
  throw new Error('No implementado — solo diseño (ver comentario de esta función). No entrenar todavía.');
}
