/**
 * Orquestador del servicio TRM.
 * Flujo: caché BD → fetch datos.gov.co → fallback último valor.
 * Solo se importa en contexto servidor (API routes).
 */

import { calcularCentavosTRM } from '@/lib/ponderacion-economica';
import { fetchTrmDatosGov, TRM_DATOS_GOV_URL } from './trmFetchDatosGov';
import {
  buscarEnCache,
  guardarEnCache,
  guardarHistorialEnCache,
  guardarLog,
  hoyISO,
  ultimoValorCache,
} from './trmCache';
import type { TrmResponse, TrmHistorialEntry } from './types';

const FUENTE = 'datos_gov_co';

/**
 * Obtiene el valor TRM para una fecha (default: hoy).
 *
 * Flujo:
 * 1. Caché local → si existe, devolverlo.
 * 2. Fetch externo → guardar en caché + log + devolver.
 * 3. Último valor en caché como fallback → devolver con advertencia.
 * 4. Sin datos → lanzar error.
 */
export async function obtenerTrmActual(fecha?: string): Promise<TrmResponse> {
  const fechaTarget = fecha ?? hoyISO();
  const consultadoEn = new Date().toISOString();

  // ── 1. Caché ──────────────────────────────────────────────────────────────
  const cached = await buscarEnCache(fechaTarget, FUENTE);
  if (cached) {
    return {
      fecha: fechaTarget,
      valor: Number(cached.valor),
      centavos: cached.centavos,
      fuente: 'cache',
      esOficial: cached.esOficial,
      vigenciaDesde: cached.vigenciaDesde?.toISOString().slice(0, 10),
      vigenciaHasta: cached.vigenciaHasta?.toISOString().slice(0, 10),
      consultadoEn,
      desdeCache: true,
    };
  }

  // ── 2. Fetch externo ──────────────────────────────────────────────────────
  // Pedimos 30 días para tener contexto suficiente y poblar el caché
  const fetchResult = await fetchTrmDatosGov(30);

  // Log siempre, independientemente del resultado
  await guardarLog({
    fechaConsultada: fechaTarget,
    fuente: FUENTE,
    fuenteUrl: TRM_DATOS_GOV_URL,
    resultado: fetchResult,
  });

  if (fetchResult.ok && fetchResult.valor != null) {
    const valor = fetchResult.valor;
    const centavos = calcularCentavosTRM(valor);

    // Guardar valor para la fecha solicitada en caché
    await guardarEnCache({
      fecha: fechaTarget,
      valor,
      vigenciaDesde: fetchResult.vigenciaDesde,
      vigenciaHasta: fetchResult.vigenciaHasta,
      fuente: FUENTE,
      fuenteUrl: TRM_DATOS_GOV_URL,
    });

    // Poblar caché con todo el historial recibido (sin bloquear respuesta)
    if (fetchResult.historial?.length) {
      void guardarHistorialEnCache(fetchResult.historial, FUENTE, TRM_DATOS_GOV_URL);
    }

    return {
      fecha: fetchResult.vigenciaHasta ?? fechaTarget,
      valor,
      centavos,
      fuente: FUENTE,
      esOficial: true,
      vigenciaDesde: fetchResult.vigenciaDesde,
      vigenciaHasta: fetchResult.vigenciaHasta,
      consultadoEn,
      desdeCache: false,
    };
  }

  // ── 3. Fallback: último valor en caché ────────────────────────────────────
  const fallback = await ultimoValorCache();
  if (fallback) {
    return {
      fecha: fallback.fecha.toISOString().slice(0, 10),
      valor: Number(fallback.valor),
      centavos: fallback.centavos,
      fuente: 'cache',
      esOficial: fallback.esOficial,
      vigenciaDesde: fallback.vigenciaDesde?.toISOString().slice(0, 10),
      vigenciaHasta: fallback.vigenciaHasta?.toISOString().slice(0, 10),
      consultadoEn,
      desdeCache: true,
      advertencia:
        'Último valor disponible en caché. Verifica el valor antes de presentar oferta.',
    };
  }

  // ── 4. Sin datos ──────────────────────────────────────────────────────────
  throw new Error(
    fetchResult.error ??
      'No hay datos TRM disponibles (sin caché ni conexión al servicio externo)',
  );
}

/**
 * Obtiene historial TRM para los últimos `dias` días.
 * Como efecto secundario, puebla el caché con los valores obtenidos.
 */
export async function obtenerHistorial(dias: number): Promise<TrmHistorialEntry[]> {
  const fetchResult = await fetchTrmDatosGov(dias);

  if (fetchResult.ok && fetchResult.historial?.length) {
    void guardarHistorialEnCache(fetchResult.historial, FUENTE, TRM_DATOS_GOV_URL);
    return fetchResult.historial;
  }

  return [];
}