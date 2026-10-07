/**
 * Jobs del módulo de proyección decimal TRM.
 *
 * jobActualizarTrmHistorico:
 *   Consulta la API de TRM (datos.gov.co), hace upsert en trm_historico
 *   (todos los registros, incluso repetidos) y sincroniza
 *   trm_eventos_efectivos (solo cambios reales de TRM).
 *
 * jobRecalibrarPrediccion:
 *   Ajusta ARIMA sobre las ventanas de 60/90/180 eventos efectivos,
 *   corre el bootstrap Monte Carlo y guarda el resultado en trm_predicciones.
 *
 * jobTrmDiario:
 *   Orquestador para el cron: actualiza el histórico y SOLO recalibra
 *   cuando hubo un evento efectivo nuevo (si la TRM se repitió, no recalcula).
 */

import { fetchTrmDatosGov } from './trmFetchDatosGov';
import {
  contarHistorico,
  guardarPrediccion,
  leerHistorico,
  maxEventoId,
  sincronizarEventosEfectivos,
  upsertHistorico,
} from './trmStore';
import { proyectarDecimalTrm } from './proyeccionDecimal';
import { siguienteDiaHabil } from './calendarioHabil';

/** Días a traer en la carga inicial (semilla) del histórico. */
const DIAS_SEED = 1200;
/** Días a traer en la actualización incremental diaria. */
const DIAS_INCREMENTAL = 45;
/** Días de histórico usados para calibrar (cubre 180 eventos con margen). */
export const DIAS_HISTORICO_MODELO = 600;
/** Ventanas de eventos efectivos del modelo. */
export const VENTANAS_MODELO = [60, 90, 180];

export interface ResultadoActualizacion {
  ok: boolean;
  nuevosHistorico: number;
  nuevosEventos: number;
  error?: string;
}

export async function jobActualizarTrmHistorico(): Promise<ResultadoActualizacion> {
  const existentes = await contarHistorico();
  const dias = existentes > 200 ? DIAS_INCREMENTAL : DIAS_SEED;

  const res = await fetchTrmDatosGov(dias);
  if (!res.ok || !res.historial?.length) {
    return {
      ok: false,
      nuevosHistorico: 0,
      nuevosEventos: 0,
      error: res.error ?? 'API TRM sin datos',
    };
  }

  const nuevosHistorico = await upsertHistorico(res.historial);
  const nuevosEventos = await sincronizarEventosEfectivos();
  return { ok: true, nuevosHistorico, nuevosEventos };
}

export interface ResultadoRecalibracion {
  ok: boolean;
  fechaObjetivo?: string;
  decimalRecomendado?: string | null;
  error?: string;
}

export async function jobRecalibrarPrediccion(): Promise<ResultadoRecalibracion> {
  const eventoActual = await maxEventoId();
  if (eventoActual === null) {
    return { ok: false, error: 'Sin eventos efectivos registrados' };
  }

  const serie = await leerHistorico(DIAS_HISTORICO_MODELO);
  if (serie.length < 60) {
    return { ok: false, error: `Histórico insuficiente para recalibrar (${serie.length} días)` };
  }

  // Fecha objetivo operativa: día hábil siguiente al último dato conocido
  // (o a hoy, si el histórico está al día).
  const ultimaFecha = serie[serie.length - 1].fecha;
  const hoy = new Date().toISOString().slice(0, 10);
  const ancla = hoy > ultimaFecha ? hoy : ultimaFecha;
  const fechaObjetivo = siguienteDiaHabil(ancla);

  const resultado = proyectarDecimalTrm({ serie, fechaObjetivo, ventanas: VENTANAS_MODELO });
  await guardarPrediccion(resultado, eventoActual);

  return { ok: true, fechaObjetivo, decimalRecomendado: resultado.decimalRecomendado };
}

export interface ResultadoJobDiario {
  actualizacion: ResultadoActualizacion;
  recalibracion: ResultadoRecalibracion | null;
}

export async function jobTrmDiario(): Promise<ResultadoJobDiario> {
  const actualizacion = await jobActualizarTrmHistorico();

  // Regla: recalibrar SOLO si hubo evento efectivo nuevo
  let recalibracion: ResultadoRecalibracion | null = null;
  if (actualizacion.ok && actualizacion.nuevosEventos > 0) {
    recalibracion = await jobRecalibrarPrediccion();
  }
  return { actualizacion, recalibracion };
}
