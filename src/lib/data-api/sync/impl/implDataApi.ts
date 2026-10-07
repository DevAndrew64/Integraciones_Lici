/**
 * Adaptador DATA-API de la fachada de sincronización.
 *
 * Se activa cuando el modo efectivo es `data-api` (feature flag
 * `DATA_API_RUNTIME_ENABLED` ON — ver `../../runtimeFlag.ts`). NUNCA hace
 * fallback al pipeline legacy: cada operación aquí, o se resuelve por la
 * Data API, o falla/no-op de forma explícita.
 *
 * Clasificación de cada operación con el flag ON (D6/D7):
 *
 *  A. `sincronizarProcesos`  → se implementa vía la Data API
 *     (`ejecutarSyncRuntime`: guardrail de destino + advisory lock +
 *     runner canónico). Es la ÚNICA fuente de adquisición de procesos.
 *
 *  B. `obtenerDetallePublico` (`/api/secop/detalle`)  → OPERACIÓN MIGRADA:
 *     lanza `OperacionMigradaDataApiError` (HTTP 410). No hay equivalente
 *     de "scrapear una URL pública arbitraria" en el contrato canónico y
 *     NO se permite bypass directo al proveedor.
 *
 *  A. `actualizarFichaProceso` (`PUT /api/procesos/actualizar-ficha`)  →
 *     REAL vía Data API: resuelve el Proceso local → `sourceKey` (id
 *     canónico) → `DataApiClient.actualizarFicha(sourceKey)` →
 *     `{ bundle }` → `aplicarBundleCanonico`. Pasa por el MISMO guardrail de
 *     identidad de destino que el runner (`resolverDestinoRuntime`). Ya NO
 *     responde 409. Sin fallback legacy: un error del contrato sale como
 *     `estado: 'error' | 'fuente_no_disponible'`.
 *
 *  A. `resolverLinkProceso` (`POST /v1/procesos/:id/resolver-link`)  → REAL
 *     vía Data API desde la corrección de D16/D7: el bundle canónico puede
 *     traer `linkDetalle: null` para un proceso que el servicio de datos
 *     aún no resolvió en esa página en particular, y sin este cableado no
 *     había NINGÚN mecanismo — activo ni de reintento — que lo volviera a
 *     pedir. Resuelve el Proceso local → `sourceKey` → si ya tiene
 *     `linkDetalle` es no-op (no gasta una llamada de balde) → si no,
 *     `DataApiClient.resolverLinkDetalle(sourceKey)` → si resuelve, escritura
 *     MÍNIMA y puntual de solo `linkDetalle` (nunca toca `DataApiSyncState`,
 *     mismo patrón que `actualizarFichaProceso`). Sigue sin fallback legacy:
 *     un error del contrato sale como `ok:false` con el mensaje ya saneado.
 *
 *  B-soft. `revalidarLinkProceso`  → SIGUE siendo no-op: el contrato
 *     canónico no expone un concepto de "revalidación" distinto de
 *     "resolver" (mismo endpoint, misma respuesta `{linkDetalle, resuelto}`
 *     — sin `linkAnterior`/`cambioDetectado`/`fuenteResolucion`, que son
 *     conceptos exclusivamente del pipeline legacy). Para re-chequear un
 *     link ya resuelto, usar `resolverLinkProceso` de nuevo.
 */
import type {
  SyncMetrics,
  SincronizarProcesosParams,
  ResolverResult,
  ResultadoRevalidacionLink,
  InputActualizacionPuntual,
  OpcionesActualizacionPuntual,
  ResultadoActualizacionPuntual,
  ResultadoDetallePublico,
} from './contratosSync';
import { ejecutarSyncRuntime } from '../../runner/ejecutarSyncRuntime';

/**
 * RESERVADO — se mantiene exportado por compatibilidad (imports existentes
 * en rutas y tests). Con B.4.5 el modo data-api SÍ está habilitado, así que
 * esta excepción ya no se lanza en el flujo normal; queda como defensa para
 * cualquier operación futura que no esté cableada.
 */
export class SyncModoDataApiNoHabilitadoError extends Error {
  readonly code = 'SYNC_MODO_DATA_API_NO_HABILITADO';
  constructor(operacion: string) {
    super(
      `Operación de sincronización "${operacion}" solicitada con modo data-api, ` +
        `pero no está cableada en este adaptador. El runtime NO sincroniza y NO hay fallback a legacy.`,
    );
    this.name = 'SyncModoDataApiNoHabilitadoError';
  }
}

/** Operación de adquisición legacy que ya NO aplica con el cutover activo. HTTP 409 o 410. */
export class OperacionMigradaDataApiError extends Error {
  readonly code = 'OPERACION_MIGRADA_DATA_API';
  readonly httpStatus: 409 | 410;
  readonly operacion: string;
  constructor(operacion: string, httpStatus: 409 | 410) {
    super(
      `La operación "${operacion}" está migrada a la Data API y ya no se ejecuta en runtime. ` +
        `La adquisición de procesos, documentos, cronogramas y enlaces llega exclusivamente por el ` +
        `bundle canónico de la sincronización. No hay fallback al pipeline legacy.`,
    );
    this.name = 'OperacionMigradaDataApiError';
    this.httpStatus = httpStatus;
    this.operacion = operacion;
  }
}

/** Marcador de resultado neutro para las operaciones no-op (B-soft). */
export const ESTADO_MIGRADO_DATA_API = 'MIGRADO_DATA_API' as const;

export interface OpcionesSincronizarDataApi {
  /** Sync profundo / full resync (lo activa el job de `SYNC_PROFUNDO_CRON`). */
  fullResync?: boolean;
}

function resultadoRevalidarNoOp(): ResultadoRevalidacionLink {
  return {
    ok: false,
    linkAnterior: null,
    linkPrincipalActual: null,
    cambioDetectado: false,
    actualizado: false,
    fuenteResolucion: null,
    noticeAnterior: null,
    noticeActual: null,
    motivo: 'migrado_data_api',
  };
}

/**
 * A — resolución REAL de `linkDetalle` vía Data API (corrección D16/D7).
 *   1. resolver el Proceso local por `id` → `sourceKey`
 *   2. si YA tiene `linkDetalle`, no-op (`ok:true, yaExistia:true`) — no
 *      gasta una llamada a la Data API en vano
 *   3. `DataApiClient.resolverLinkDetalle(sourceKey)`
 *   4. si resuelve, persiste SOLO `linkDetalle` — escritura mínima y
 *      puntual, NUNCA toca `DataApiSyncState` (mismo patrón que
 *      `actualizarFichaProcesoReal`)
 * Mismo guardrail de destino (`resolverDestinoRuntime`) que el resto de las
 * operaciones puntuales. Sin fallback legacy.
 */
async function resolverLinkProcesoReal(procesoId: number): Promise<ResolverResult> {
  const [{ resolverDestinoRuntime }, { crearDataApiClientDesdeEnv }] = await Promise.all([
    import('../../runner/resolverDestinoRuntime'),
    import('../../cliente'),
  ]);

  const destino = await resolverDestinoRuntime(); // ← guardrail de identidad ANTES de nada

  try {
    const fila = await (destino.prisma as {
      proceso: { findUnique(a: unknown): Promise<{ sourceKey: string; linkDetalle: string | null } | null> };
    }).proceso.findUnique({ where: { id: procesoId }, select: { sourceKey: true, linkDetalle: true } });

    if (!fila?.sourceKey) {
      return { ok: false, error: 'El Proceso no tiene identidad canónica (sourceKey) — no es resoluble por la Data API.' };
    }
    if (fila.linkDetalle && fila.linkDetalle.trim() !== '') {
      // Ya tenía uno — no-op, no gasta una llamada de la Data API en vano.
      return { ok: true, yaExistia: true, linkDetalle: fila.linkDetalle };
    }

    const cliente = crearDataApiClientDesdeEnv();
    const r = await cliente.resolverLinkDetalle(fila.sourceKey);
    if (!r.ok) {
      return { ok: false, error: r.error.mensaje };
    }
    if (!r.datos.resuelto || !r.datos.linkDetalle) {
      return { ok: false, error: 'La Data API todavía no tiene un link resuelto para este proceso.' };
    }

    // Escritura MÍNIMA y puntual — solo linkDetalle. Nunca toca DataApiSyncState.
    await destino.aplicador.proceso.update({
      where: { id: procesoId },
      data: { linkDetalle: r.datos.linkDetalle },
    });

    return { ok: true, yaExistia: false, linkDetalle: r.datos.linkDetalle };
  } finally {
    await destino.cerrar().catch(() => {});
  }
}

function fichaError(estado: 'error' | 'fuente_no_disponible', mensaje: string, t0: number): ResultadoActualizacionPuntual {
  return {
    ok: false,
    modo: 'actualizacion_puntual',
    estado,
    operacionesExternas: { detalle: 0, perfiles: 0, apiGeneral: 0 },
    duracionMs: Date.now() - t0,
    camposActualizados: [],
    error: mensaje,
  };
}

/**
 * A — actualización puntual de ficha REAL vía Data API.
 *   1. resolver Proceso local (id/externalId/codigoProceso/entidad) → `sourceKey`
 *   2. guardrail de destino (`resolverDestinoRuntime`) — MISMA garantía que el runner
 *   3. `DataApiClient.actualizarFicha(sourceKey)` → `{ bundle }`
 *   4. `aplicarBundleCanonico(bundle)` — transacción atómica, NUNCA toca DataApiSyncState
 *   5. mapear a `ResultadoActualizacionPuntual` compatible con el frontend
 * Sin fallback legacy. La lectura de identidad usa el MISMO destino guardrailado
 * (`DATA_API_RUNTIME_DATABASE_URL`), nunca el singleton `@/lib/prisma`.
 */
async function actualizarFichaProcesoReal(
  input: InputActualizacionPuntual,
): Promise<ResultadoActualizacionPuntual> {
  const t0 = Date.now();
  const [{ resolverDestinoRuntime }, { aplicarBundleCanonico }, { crearDataApiClientDesdeEnv }, { resolverProcesoIdParaLinkDetalle }] =
    await Promise.all([
      import('../../runner/resolverDestinoRuntime'),
      import('../../aplicador/aplicarPaginaCanonica'),
      import('../../cliente'),
      import('@/lib/proceso-identidad'),
    ]);

  const destino = await resolverDestinoRuntime(); // ← guardrail de identidad ANTES de nada

  try {
    // 1 ─ resolver Proceso local en el MISMO destino guardrailado
    const prismaTx = destino.prisma as Parameters<typeof resolverProcesoIdParaLinkDetalle>[0];
    const resol = await resolverProcesoIdParaLinkDetalle(prismaTx, {
      id: input.procesoId ?? undefined,
      externalId: input.externalId ?? undefined,
      codigoProceso: input.codigoProceso ?? undefined,
      entidad: input.entidad ?? undefined,
    });
    if (!resol.ok) {
      return fichaError('error', `No se pudo resolver el Proceso de forma inequívoca (${resol.motivo}).`, t0);
    }
    const fila = await (destino.prisma as {
      proceso: { findUnique(a: unknown): Promise<{ sourceKey: string } | null> };
    }).proceso.findUnique({ where: { id: resol.procesoId }, select: { sourceKey: true } });
    if (!fila?.sourceKey) {
      return fichaError('error', 'El Proceso no tiene identidad canónica (sourceKey) — no es actualizable por la Data API.', t0);
    }

    // 2 ─ pedir el bundle fresco a la Data API
    const cliente = crearDataApiClientDesdeEnv();
    const r = await cliente.actualizarFicha(fila.sourceKey);
    if (!r.ok) {
      // Sin fallback legacy: transitorio → fuente_no_disponible; permanente → error.
      return fichaError(r.error.reintentar ? 'fuente_no_disponible' : 'error', r.error.mensaje, t0);
    }

    // 3 ─ aplicar el bundle (transacción atómica, sin tocar DataApiSyncState)
    const res = await aplicarBundleCanonico(r.datos.bundle, { prisma: destino.aplicador });

    const huboCambios =
      res.procesosCreados + res.documentosCreados + res.cronogramasReemplazados + res.notificacionesCreadas > 0;
    const bundle = r.datos.bundle;
    const proc = bundle.tipo === 'UPSERT' ? bundle.proceso : null;

    return {
      ok: true,
      modo: 'actualizacion_puntual',
      estado: res.procesosCreados > 0 || huboCambios ? 'completa' : 'sin_cambios',
      procesoId: resol.procesoId,
      externalId: input.externalId ?? null,
      operacionesExternas: { detalle: 1, perfiles: 0, apiGeneral: 0 },
      paginasConsultadas: 0,
      duracionMs: Date.now() - t0,
      camposActualizados: [],
      linkDetalle: proc?.linkDetalle ?? null,
      fechaVencimiento: proc?.fechaCierre ?? null,
      cambioDetectado: proc?.tieneCambioFechaCierre ?? false,
      cronogramasActualizados: res.cronogramasReemplazados,
      documentosNuevos: res.documentosCreados,
      solicitudesPropagadas: res.solicitudesPropagadas,
    };
  } finally {
    await destino.cerrar().catch(() => {});
  }
}

export const implDataApi = {
  /**
   * A — sincronización real vía Data API. Una llamada DIRIGIDA a un único
   * proceso (`params.soloEste`, que hoy solo emite `PUT /api/procesos/sync`)
   * es OPERACIÓN MIGRADA (HTTP 409): el contrato canónico no expone un
   * "tirar de este proceso" y el refresco por proceso lo cubre el sync
   * periódico. La sincronización masiva/incremental sí se ejecuta.
   */
  sincronizarProcesos: (
    params?: SincronizarProcesosParams,
    opts?: OpcionesSincronizarDataApi,
  ): Promise<SyncMetrics> => {
    if (typeof params?.soloEste === 'string' && params.soloEste.trim() !== '') {
      throw new OperacionMigradaDataApiError('sincronizarProcesos(soloEste)', 409);
    }
    return ejecutarSyncRuntime({ forzarFullResync: opts?.fullResync === true }) as unknown as Promise<SyncMetrics>;
  },

  /** A — resolución REAL de linkDetalle vía Data API (corrección D16/D7, ver docblock arriba). */
  resolverLinkProceso: (procesoId: number): Promise<ResolverResult> => resolverLinkProcesoReal(procesoId),

  /** B-soft — sigue siendo no-op: sin equivalente en el contrato canónico (ver docblock arriba). */
  revalidarLinkProceso: async (
    _procesoId: number,
    _opciones?: { persistir?: boolean },
  ): Promise<ResultadoRevalidacionLink> => resultadoRevalidarNoOp(),

  /** A — actualización puntual REAL vía Data API (ya NO responde 409). */
  actualizarFichaProceso: (
    input: InputActualizacionPuntual,
    _opciones?: OpcionesActualizacionPuntual,
  ): Promise<ResultadoActualizacionPuntual> => actualizarFichaProcesoReal(input),

  /** B — operación migrada (HTTP 410). */
  obtenerDetallePublico: (_url: string): Promise<ResultadoDetallePublico> => {
    throw new OperacionMigradaDataApiError('obtenerDetallePublico', 410);
  },
};
