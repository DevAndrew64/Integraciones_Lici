/**
 * Segunda generación del predictor TRM — momento operativo de predicción.
 *
 * Define EXACTAMENTE cuándo y con qué información se genera una
 * predicción, antes de construir cualquier feature. Toda variable
 * candidata (TRM-only o exógena) se audita contra este contrato: si no
 * está garantizado que estaba disponible en `fechaHoraCorte`, no entra al
 * dataset causal (ver datasetCausal.ts).
 */

export interface ContextoPrediccionTrm {
  /** Instante en que se solicita la predicción, hora local Bogotá, ISO 8601 con hora. */
  fechaHoraCorte: string;
  zonaHoraria: 'America/Bogota';
  /** Fecha calendario para la que se quiere conocer la TRM aplicable. */
  fechaObjetivo: string;
  /** Evento oficial vigente en fechaHoraCorte — el origen E_i del backtest. */
  eventoOrigenId: string;
  /** Evento oficial que se ESPERA que cubra fechaObjetivo (puede no estar certificado aún). */
  eventoObjetivoEsperadoId: string;
  /** Número de eventos oficiales entre el origen y el objetivo esperado. */
  horizonteEventos: number;
}

export type TipoPrediccionTrm = 'NOWCAST_H1' | 'FORECAST_H2_A_H30';

/**
 * A) NOWCAST (h=1): el objetivo es la PRÓXIMA certificación oficial —
 *    variables intradía/de mercado del día de la sesión de origen son
 *    plausibles (se conocen horas antes del cierre que fija la TRM).
 * B) FORECAST (h=2..30): el objetivo está a varias certificaciones de
 *    distancia — las variables intradía del día de origen pierden
 *    relevancia relativa frente a features estructurales (nivel,
 *    volatilidad, régimen).
 */
export function clasificarTipoPrediccion(horizonteEventos: number): TipoPrediccionTrm {
  if (!Number.isInteger(horizonteEventos) || horizonteEventos < 1) {
    throw new Error('horizonteEventos debe ser un entero >= 1');
  }
  return horizonteEventos === 1 ? 'NOWCAST_H1' : 'FORECAST_H2_A_H30';
}

// ─── Auditoría de disponibilidad temporal por variable candidata ────────────

export type RiesgoLeakage = 'NINGUNO' | 'BAJO' | 'ALTO';

export interface AuditoriaVariableCandidata {
  variable: string;
  horaPublicacion: string;
  horaDisponibilidad: string;
  /** Para el caso general — puede depender del tipo de predicción, ver `notas`. */
  disponibleEnCorte: boolean;
  riesgoLeakage: RiesgoLeakage;
  notas: string;
}

/**
 * Auditoría de las variables TRM-only usadas en `datasetCausal.ts`. Todas
 * se derivan exclusivamente de `eventos[0..indiceOrigen]` (certificaciones
 * oficiales ya publicadas en o antes del origen) o de la fecha calendario
 * del propio origen — ninguna requiere una fuente externa con su propio
 * calendario de publicación, por eso el riesgo de leakage estructural es
 * NINGUNO en todos los casos: el riesgo real está en la IMPLEMENTACIÓN
 * (que efectivamente no se lean índices > indiceOrigen), verificado por
 * `datasetCausal.test.ts`, no en la naturaleza de la variable.
 */
export const AUDITORIA_VARIABLES_TRM_ONLY: AuditoriaVariableCandidata[] = [
  {
    variable: 'nivel actual / lags / rolling stats / decimal actual y sus lags',
    horaPublicacion: 'Certificación oficial TRM (Superfinanciera), publicada la noche/madrugada previa al día en que empieza a regir cada evento.',
    horaDisponibilidad: 'Completa desde la publicación oficial del evento origen E_i.',
    disponibleEnCorte: true,
    riesgoLeakage: 'NINGUNO',
    notas: 'Todas derivadas de eventos[0..indiceOrigen] — nunca del evento objetivo.',
  },
  {
    variable: 'pendiente / aceleración / volatilidad (features derivadas de ventanas de eventos)',
    horaPublicacion: 'Se calculan sobre certificaciones ya publicadas.',
    horaDisponibilidad: 'Completa en fechaHoraCorte.',
    disponibleEnCorte: true,
    riesgoLeakage: 'NINGUNO',
    notas: 'Funciones puras sobre eventos[indiceOrigen-19..indiceOrigen] como máximo (ventana 20).',
  },
  {
    variable: 'mes / día de semana de sesión / posición hábil en el mes / inicio-fin de mes',
    horaPublicacion: 'No aplica — se derivan de la fecha calendario del propio evento origen.',
    horaDisponibilidad: 'Conocidas de antemano (calendario), sin dependencia de ningún dato de mercado.',
    disponibleEnCorte: true,
    riesgoLeakage: 'NINGUNO',
    notas: '"esFinMes" se aproxima con día calendario >= 25 (heurística documentada) para evitar mirar el índice del evento siguiente — no usa eventos[indiceOrigen+1].',
  },
  {
    variable: 'horizonte en eventos (h)',
    horaPublicacion: 'No aplica — es un parámetro de la consulta, no un dato observado.',
    horaDisponibilidad: 'Conocido siempre (lo elige quien consulta).',
    disponibleEnCorte: true,
    riesgoLeakage: 'NINGUNO',
    notas: 'Determina cuántos eventos hacia adelante se pronostican, nunca cuál es su valor.',
  },
];
