/**
 * FACHADA ÚNICA de sincronización de procesos.
 *
 * Todos los disparadores de runtime (instrumentation/cron, rutas admin de
 * sincronización, y — por HTTP — n8n) pasan por aquí. La fachada decide,
 * según el modo efectivo (`./modo.ts` → que a su vez respeta el feature flag
 * `DATA_API_RUNTIME_ENABLED`, ver `../runtimeFlag.ts`), qué hacer:
 *
 *   'disabled' → { estado: 'deshabilitado' } — NO ejecuta nada
 *   'data-api' → `implDataApi` (B.4.5): `sincronizarProcesos` real vía Data
 *                API; `resolver/revalidar link` no-op neutro (D7);
 *                `actualizar ficha` / `detalle público` → operación migrada
 *                (409/410).
 *
 * REPO SHARE-READY (B5): la Data API es la ÚNICA implementación operativa.
 * Esta fachada NO importa ningún adaptador ni pipeline legacy — los contratos
 * de tipos viven en el módulo neutral `./impl/contratosSync.ts`. Nunca hay
 * fallback a legacy ante error / timeout / 4xx de la Data API.
 */
import { modoSyncRuntime } from './modo';
import type {
  SyncMetrics,
  SincronizarProcesosParams,
  ResolverResult,
  ResultadoRevalidacionLink,
  InputActualizacionPuntual,
  OpcionesActualizacionPuntual,
  ResultadoActualizacionPuntual,
  ResultadoDetallePublico,
} from './impl/contratosSync';
import {
  implDataApi,
  SyncModoDataApiNoHabilitadoError,
  OperacionMigradaDataApiError,
  ESTADO_MIGRADO_DATA_API,
  type OpcionesSincronizarDataApi,
} from './impl/implDataApi';

export { SyncModoDataApiNoHabilitadoError, OperacionMigradaDataApiError, ESTADO_MIGRADO_DATA_API };
export type {
  SyncMetrics,
  SincronizarProcesosParams,
  ResolverResult,
  ResultadoRevalidacionLink,
  InputActualizacionPuntual,
  OpcionesActualizacionPuntual,
  ResultadoActualizacionPuntual,
  ResultadoDetallePublico,
  OpcionesSincronizarDataApi,
};

export const MENSAJE_SYNC_DESHABILITADO =
  'La sincronización de procesos está deshabilitada (SYNC_RUNTIME_MODE=disabled). ' +
  'La aplicación sigue disponible en modo lectura.';

/** Resultado de toda operación de la fachada. */
export type ResultadoFachadaSync<T> =
  | { estado: 'ejecutado'; modo: 'data-api'; datos: T }
  | { estado: 'deshabilitado'; modo: 'disabled'; mensaje: string };

async function ejecutar<T>(correrDataApi: () => Promise<T>): Promise<ResultadoFachadaSync<T>> {
  const modo = modoSyncRuntime();

  if (modo === 'data-api') {
    return { estado: 'ejecutado', modo: 'data-api', datos: await correrDataApi() };
  }
  // 'disabled' (o cualquier valor de env coaccionado a 'disabled' — incl. 'legacy').
  return { estado: 'deshabilitado', modo: 'disabled', mensaje: MENSAJE_SYNC_DESHABILITADO };
}

export const fachadaSync = {
  /** Sincronización masiva/incremental de procesos. `opts.fullResync` solo lo honra el modo data-api. */
  sincronizarProcesos: (params?: SincronizarProcesosParams, opts?: OpcionesSincronizarDataApi) =>
    ejecutar<SyncMetrics>(() => implDataApi.sincronizarProcesos(params, opts)),

  /** Resolver el `linkDetalle` de un proceso (completar el que falta). */
  resolverLinkProceso: (procesoId: number) =>
    ejecutar<ResolverResult>(() => implDataApi.resolverLinkProceso(procesoId)),

  /** Revalidar el `linkDetalle` existente de un proceso (solo fuentes que lo admiten). */
  revalidarLinkProceso: (procesoId: number, opciones: { persistir?: boolean } = {}) =>
    ejecutar<ResultadoRevalidacionLink>(() => implDataApi.revalidarLinkProceso(procesoId, opciones)),

  /** Actualización puntual de la ficha de un proceso. */
  actualizarFichaProceso: (input: InputActualizacionPuntual, opciones?: OpcionesActualizacionPuntual) =>
    ejecutar<ResultadoActualizacionPuntual>(() => implDataApi.actualizarFichaProceso(input, opciones)),

  /** Adquisición del detalle público de un proceso a partir de su URL pública. */
  obtenerDetallePublico: (url: string) =>
    ejecutar<ResultadoDetallePublico>(() => implDataApi.obtenerDetallePublico(url)),
};

/** Helper para entrypoints: `true` si el resultado indica sincronización deshabilitada. */
export function esResultadoDeshabilitado<T>(
  r: ResultadoFachadaSync<T>,
): r is { estado: 'deshabilitado'; modo: 'disabled'; mensaje: string } {
  return r.estado === 'deshabilitado';
}
