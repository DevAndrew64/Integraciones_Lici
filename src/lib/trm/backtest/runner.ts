/**
 * Runner del backtest walk-forward / rolling-origin.
 *
 * SEMÁNTICA ESTADÍSTICA (fijada tras 2 rondas de auditoría de mapeo temporal):
 *
 *   El backtest evalúa pares de EVENTOS OFICIALES por ÍNDICE, nunca por
 *   resolución de fecha calendario:
 *
 *     eventoOrigen    = eventos[indiceOrigen]
 *     fechaCorte      = eventoOrigen.vigenciaDesde
 *     eventoObjetivo  = eventos[indiceOrigen + horizonteEventos]
 *     decimalReal     = eventoObjetivo.decimal
 *     entrenamiento   = eventos[0 .. indiceOrigen]  (inclusive)
 *
 *   `horizonteEventos` es un número de EVENTOS oficiales hacia adelante,
 *   NO días hábiles de calendario. Resolver una fecha calendario a un
 *   evento TRM (sábado/domingo/lunes → mismo evento, calendario futuro,
 *   excepciones operativas) es una capa EXTERNA al backtest — útil para
 *   la futura UI/API, pero nunca para definir la verdad objetivo aquí.
 *   Por eso este archivo NO importa `resolverTrmVigenteEnFecha` para
 *   decidir decimalReal: el índice del evento objetivo ya es la verdad,
 *   sin ambigüedad de fechas.
 *
 *   Ronda anterior de esta auditoría (ver historial): una versión que sí
 *   resolvía fechaObjetivo por calendario (avanzarDiasHabiles + resolución
 *   de fecha) producía n NO monótono entre horizontes (h=1 con n=449 vs
 *   h=3 con n=580), porque el horizonte de 1 día hábil frecuentemente
 *   caía todavía dentro de la propia vigencia del evento de origen —
 *   evidencia de que se seguía razonando en días calendario, no en
 *   eventos. Con horizonte = número de eventos, `eventoObjetivo` es por
 *   construcción SIEMPRE un evento distinto y posterior al de origen
 *   (índice estrictamente mayor), así que ese caso degenerado desaparece
 *   estructuralmente, no por un chequeo defensivo.
 *
 * Fórmula de conteo (n teórico, antes de fallos de modelo o muestreo):
 *   primerIndiceOrigen = calentamientoEventos - 1
 *   n(h) = N - calentamientoEventos - h + 1   (N = eventos.length)
 *
 * Conjunto común de evaluación: los pares (indiceOrigen, indiceObjetivo)
 * de cada horizonte se calculan UNA SOLA VEZ (`calcularParesEvaluablesPorHorizonte`)
 * y se reutilizan para TODOS los modelos — ningún modelo puede generar
 * silenciosamente una muestra distinta. Si un modelo no puede producir
 * predicción para un par (datos insuficientes), ese par simplemente no
 * aparece en el resultado para ese modelo — la diferencia entre el n
 * teórico del horizonte y el n real de un modelo es exactamente su tasa
 * de fallos (ver `contarParesEvaluablesPorHorizonte`, usable para calcular
 * esa diferencia sin volver a correr el backtest).
 *
 * Regla de no-leakage (obligatoria, ver también backtest.test.ts):
 *   para un origen de índice `indiceOrigen`, SOLO se usan eventos con
 *   índice ≤ indiceOrigen para entrenar los modelos (ARIMA/ensemble y los
 *   baselines de frecuencia/moda) — nunca eventos[indiceOrigen+1 .. indiceObjetivo],
 *   que son futuro desconocido desde ese origen.
 */

import {
  normalizarRegistrosTrmOficiales,
  construirEventosTrmDesdeVigencias,
  type RegistroTrmOficial,
  type EventoTrmOficial,
} from './vigencias';
import { calcularPrediccionModelo } from './modelos';
import {
  obtenerCriterioPorDecimal,
  obtenerDistribucionPorCriterio,
  obtenerCriterioPorMayorMasa,
  validarConfiguracionCriterios,
} from './criterios';
import type { BacktestConfig, PrediccionEvaluada } from './types';
import type { TrmHistorialEntry } from '../types';

export interface ParEvaluable {
  indiceOrigen: number;
  indiceObjetivo: number;
  fechaCorte: string;
  fechaObjetivo: string;
}

/**
 * Eventos oficiales del backtest — única fuente de verdad temporal.
 * Construidos siempre a partir de vigencias reales (vigencias.ts), nunca
 * de `construirEventosEfectivos` (producción, colapso por igualdad de
 * valor en días calendario — ver auditoría Fase 1).
 */
function construirEventosBacktest(registrosOficiales: RegistroTrmOficial[]): EventoTrmOficial[] {
  const { registros } = normalizarRegistrosTrmOficiales(registrosOficiales);
  return construirEventosTrmDesdeVigencias(registros);
}

/**
 * Convierte un tramo de eventos oficiales (ya recortado por índice, nunca
 * expandido a calendario) a la forma `TrmHistorialEntry[]` que consumen
 * los modelos (modelos.ts), usando `vigenciaDesde` como fecha — un
 * renglón por evento REAL. Como cada evento aquí ya es único por
 * vigencia, alimentar `construirEventosEfectivos` (producción, dentro de
 * modelos.ts) sobre esta serie solo podría colapsar 2 eventos si existieran
 * 2 certificaciones oficiales consecutivas con el mismo valor — auditado
 * en Fase 1: 0 casos reales en el dataset 2022-2026.
 */
function eventosComoSerieModelo(eventos: EventoTrmOficial[]): TrmHistorialEntry[] {
  return eventos.map(e => ({ fecha: e.vigenciaDesde, valor: e.valor }));
}

/**
 * Pares (indiceOrigen, indiceObjetivo) evaluables para UN horizonte dado
 * (número de eventos hacia adelante), antes de cualquier fallo de modelo.
 * `primerIndiceOrigen = calentamientoEventos - 1` garantiza que
 * `eventos[0..indiceOrigen]` (inclusive) tenga exactamente ≥ `calentamientoEventos`
 * eventos disponibles para entrenar.
 */
export function calcularParesEvaluablesPorHorizonte(
  eventos: EventoTrmOficial[],
  calentamientoEventos: number,
  horizonteEventos: number,
  muestreoOrigenes: number,
): ParEvaluable[] {
  const primerIndiceOrigen = calentamientoEventos - 1;
  const pares: ParEvaluable[] = [];
  for (let i = primerIndiceOrigen; i + horizonteEventos < eventos.length; i++) {
    pares.push({
      indiceOrigen: i,
      indiceObjetivo: i + horizonteEventos,
      fechaCorte: eventos[i].vigenciaDesde,
      fechaObjetivo: eventos[i + horizonteEventos].vigenciaDesde,
    });
  }
  if (muestreoOrigenes <= 1) return pares;
  return pares.filter((_, idx) => idx % muestreoOrigenes === 0);
}

/**
 * n teórico (tamaño del conjunto común de evaluación) para cada horizonte,
 * a partir de `registrosOficiales` — expuesto aparte para estimar costo y
 * para el reporte de auditoría (n teórico vs n real por modelo) sin correr
 * el backtest completo.
 */
export function contarParesEvaluablesPorHorizonte(
  registrosOficiales: RegistroTrmOficial[],
  calentamientoEventos: number,
  horizontes: number[],
  muestreoOrigenes: number,
): Record<number, number> {
  const eventos = construirEventosBacktest(registrosOficiales);
  const salida: Record<number, number> = {};
  for (const h of horizontes) {
    salida[h] = calcularParesEvaluablesPorHorizonte(eventos, calentamientoEventos, h, muestreoOrigenes).length;
  }
  return salida;
}

/** Top-K índices (decimales) de mayor probabilidad. Desempate: menor decimal primero. */
function topKDeDistribucion(distribucion: number[], k: number): number[] {
  return Array.from({ length: 100 }, (_, d) => d)
    .sort((a, b) => distribucion[b] - distribucion[a] || a - b)
    .slice(0, k);
}

/**
 * Ejecuta el backtest walk-forward completo según `config`.
 * Devuelve el arreglo plano de todas las predicciones evaluadas
 * (combinaciones origen × horizonte × modelo con datos suficientes para
 * ese modelo — el evento objetivo SIEMPRE existe para todo par que
 * aparece aquí, por construcción de `calcularParesEvaluablesPorHorizonte`).
 */
export function ejecutarBacktest(config: BacktestConfig): PrediccionEvaluada[] {
  const {
    registrosOficiales,
    horizontes,
    calentamientoEventos,
    nSimulaciones,
    muestreoOrigenes,
    modelos,
    criterios,
    seedBase,
  } = config;

  if (criterios && criterios.length) {
    const validacion = validarConfiguracionCriterios(criterios);
    if (!validacion.valida) {
      throw new Error(
        `Configuración de criterios inválida: ${validacion.errores.join(' | ')}`,
      );
    }
  }

  const eventos = construirEventosBacktest(registrosOficiales);
  const resultado: PrediccionEvaluada[] = [];

  for (const horizonteEventos of horizontes) {
    // ── Conjunto común de evaluación: se calcula UNA VEZ por horizonte y
    //    se reutiliza para todos los modelos. ──
    const pares = calcularParesEvaluablesPorHorizonte(eventos, calentamientoEventos, horizonteEventos, muestreoOrigenes);

    for (const { indiceOrigen, indiceObjetivo, fechaObjetivo } of pares) {
      const eventoObjetivo = eventos[indiceObjetivo];
      const decimalReal = eventoObjetivo.decimal;

      // ── No-leakage estricto por índice: SOLO eventos[0..indiceOrigen] ──
      const serieHastaT = eventosComoSerieModelo(eventos.slice(0, indiceOrigen + 1));

      for (const modelo of modelos) {
        const prediccion = calcularPrediccionModelo(
          modelo,
          serieHastaT,
          fechaObjetivo,
          nSimulaciones,
          seedBase,
        );
        if (prediccion === null) continue; // datos insuficientes para este modelo en este origen (falloModelo)

        const { decimalPredicho, distribucion00a99 } = prediccion;
        const top3 = topKDeDistribucion(distribucion00a99, 3);
        const top5 = topKDeDistribucion(distribucion00a99, 5);
        const aciertoDecimal = decimalPredicho === decimalReal;

        let criterioReal: string | null = null;
        let criterioPorDecimalPrincipal: string | null = null;
        let criterioPorMayorMasa: string | null = null;
        let distribucionPorCriterio: Record<string, number> = {};
        let aciertoCriterioPorDecimal: boolean | null = null;
        let aciertoCriterioPorMasa: boolean | null = null;

        if (criterios && criterios.length) {
          criterioReal = obtenerCriterioPorDecimal(decimalReal, criterios);
          criterioPorDecimalPrincipal = obtenerCriterioPorDecimal(decimalPredicho, criterios);
          distribucionPorCriterio = obtenerDistribucionPorCriterio(distribucion00a99, criterios);
          criterioPorMayorMasa = obtenerCriterioPorMayorMasa(distribucionPorCriterio, criterios);
          // Cobertura parcial y decimal real fuera de todos los rangos → no se inventa criterio.
          if (criterioReal !== null) {
            aciertoCriterioPorDecimal = criterioPorDecimalPrincipal === criterioReal;
            aciertoCriterioPorMasa = criterioPorMayorMasa === criterioReal;
          }
        }

        resultado.push({
          fechaObjetivo,
          horizonteEventos,
          modelo,
          decimalPredicho,
          decimalReal,
          probabilidadDecimalPredicho: distribucion00a99[decimalPredicho] ?? 0,
          top3,
          top5,
          distribucion00a99,
          criterioReal,
          criterioPorDecimalPrincipal,
          criterioPorMayorMasa,
          distribucionPorCriterio,
          aciertoDecimal,
          aciertoCriterioPorDecimal,
          aciertoCriterioPorMasa,
        });
      }
    }
  }

  return resultado;
}
