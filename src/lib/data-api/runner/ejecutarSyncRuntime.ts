/**
 * Orquestador de la sincronización de procesos en RUNTIME vía el servicio de
 * datos. Es el punto que `implDataApi.sincronizarProcesos` invoca cuando el
 * modo efectivo es `data-api` (flag `DATA_API_RUNTIME_ENABLED` ON, ver
 * `../runtimeFlag.ts`).
 *
 * Cadena (sin saltarse ningún eslabón; NUNCA toca el pipeline legacy):
 *   ejecutarSyncRuntime
 *     → verificarDestinoProduccion (guardrail de identidad, ANTES de todo)
 *     → advisory lock de PostgreSQL (exclusión mutua: una sola corrida)
 *     → crearPrismaProduccion  (cliente propio, jamás @/lib/prisma)
 *     → crearDataApiClientDesdeEnv (HTTP al servicio de datos configurado por entorno)
 *     → crearObtenerSiguientePagina
 *     → bucle: obtenerSiguientePagina → aplicarPaginaCanonica  (por página,
 *       transacción atómica; el aplicador ya es idempotente y conserva la
 *       semántica de checkpoint / full resync / reconciliación / MANUAL)
 *
 * El guardrail de destino de este módulo se ejecuta como PRIMER paso y aborta
 * sin abrir ninguna conexión de escritura si algo no cuadra.
 *
 * Devuelve un objeto con forma `SyncMetrics` — el mismo contrato de métricas
 * utilizado por los callsites de runtime (instrumentation, rutas), que así no
 * necesitan cambiar su lectura del resultado.
 */
import type { PaginaSync } from '../tipos';
import type { PrismaLikeAplicador } from '../aplicador/tiposPrisma';
import { aplicarPaginaCanonica, type ResultadoAplicacion } from '../aplicador/aplicarPaginaCanonica';
import {
  verificarDestinoProduccion,
  type ConsultaIdentidadDestino,
  type EntornoDestinoProduccion,
} from './guardrailDestinoProduccion';
import { consultaIdentidadReal, type PoolLock, type ClienteLock } from './resolverDestinoRuntime';
import { crearDataApiClientDesdeEnv, type DataApiClient } from '../cliente';
import { crearObtenerSiguientePagina } from './obtenerSiguientePagina';
import { resolverTimeoutMs } from './resolverTimeoutMs';

export type { PoolLock, ClienteLock };

/** Clave del advisory lock — un único slot para toda la sincronización de procesos de runtime. */
export const LOCK_KEY_SYNC_RUNTIME = 8_440_545;

/** Forma mínima de `SyncMetrics` — el contrato de métricas de sincronización. */
export interface SyncMetricsRuntime {
  ok: boolean;
  totalApi: number;
  paginasConsultadas: number;
  recibidos: number;
  creados: number;
  actualizados: number;
  sinCambios: number;
  ignorados: number;
  nuevosRegistrados: number;
  cambiosEstado: number;
  cambiosFechaCierre: number;
  cambiosValor: number;
  documentosNuevos: number;
  cronogramasActualizados: number;
  ignoradosEstadoTerminal: number;
  errores: string[];
  duracionMs: number;
  /** Marca de procedencia de la corrida. */
  via: 'data-api';
  /** `true` si la corrida no llegó a ejecutarse por no obtener el lock de exclusión mutua. */
  lockNoAdquirido?: boolean;
  /** Procesos omitidos por identidad ambigua (2+ candidatos por codigoProceso+entidad) — ver `aplicarUpsert`. */
  ambiguosOmitidos?: number;
}

export interface DependenciasSyncRuntime {
  env?: NodeJS.ProcessEnv;
  /** Consulta read-only del `system_identifier` del destino (para el guardrail). */
  consultaIdentidad?: ConsultaIdentidadDestino;
  /** Fábrica del destino de escritura — por defecto `crearPrismaProduccion` + adaptador real. */
  crearDestino?: () => {
    aplicador: PrismaLikeAplicador;
    pool: PoolLock;
    cerrar: () => Promise<void>;
  };
  /** Fábrica del cliente HTTP de la Data API — por defecto `crearDataApiClientDesdeEnv`. */
  crearCliente?: () => DataApiClient;
  /** Tamaño de página pedido a la Data API. */
  limite?: number;
  /** Fuerza cursor inicial = null (full resync) — el job de sync profundo lo activa. */
  forzarFullResync?: boolean;
}

/**
 * Destino real de escritura. El `PrismaClient` de `@prisma/client` es pesado:
 * se importa de forma DIFERIDA para que el árbol de imports de `fachadaSync`
 * no lo cargue en cada test que solo lo mockea. El guardrail de identidad ya
 * lo ejecutó `ejecutarSyncRuntime` como PRIMER paso.
 */
async function crearDestinoRealAsync(): Promise<{
  aplicador: PrismaLikeAplicador;
  pool: PoolLock;
  cerrar: () => Promise<void>;
}> {
  const [{ crearPrismaProduccion }, { crearPrismaAplicadorReal }] = await Promise.all([
    import('./crearPrismaProduccion'),
    import('../aplicador/prismaAplicadorReal'),
  ]);
  const { prisma, pool, cerrar } = crearPrismaProduccion();
  return { aplicador: crearPrismaAplicadorReal(prisma), pool: pool as unknown as PoolLock, cerrar };
}

async function leerCursorInicial(prisma: PrismaLikeAplicador): Promise<string | null> {
  const estado = await prisma.dataApiSyncState.obtenerEstado();
  if (!estado) return null;
  if (estado.fullResyncSnapshotId) return estado.fullResyncNextPageCursor;
  return estado.checkpointCursor;
}

function acumular(resultados: ResultadoAplicacion[], duracionMs: number, ok: boolean): SyncMetricsRuntime {
  const sum = (f: (r: ResultadoAplicacion) => number) => resultados.reduce((a, r) => a + f(r), 0);
  const creados = sum((r) => r.procesosCreados);
  const actualizados = sum((r) => r.procesosActualizados);
  const tombstones = sum((r) => r.tombstonesAplicados);
  return {
    ok,
    totalApi: creados + actualizados + tombstones,
    paginasConsultadas: resultados.length,
    recibidos: creados + actualizados + tombstones,
    creados,
    actualizados,
    sinCambios: 0,
    ignorados: 0,
    nuevosRegistrados: creados,
    cambiosEstado: 0,
    cambiosFechaCierre: 0,
    cambiosValor: 0,
    documentosNuevos: sum((r) => r.documentosCreados),
    cronogramasActualizados: sum((r) => r.cronogramasReemplazados),
    ignoradosEstadoTerminal: 0,
    errores: [],
    duracionMs,
    via: 'data-api',
    ambiguosOmitidos: sum((r) => r.procesosAmbiguosOmitidos),
  };
}

/**
 * Cola de revisión manual para procesos con identidad ambigua (ver
 * `aplicarUpsert`). Best-effort: nunca lanza — si el path no es escribible
 * en este despliegue (p.ej. filesystem read-only), solo se pierde el
 * registro en archivo; el `console.log` de abajo sigue siendo la fuente de
 * verdad garantizada (visible en logs de Railway/servidor).
 */
const RUTA_COLA_AMBIGUOS = 'ops/output/procesos-ambiguos-pendientes.json';

async function registrarAmbiguos(resultados: ResultadoAplicacion[]): Promise<void> {
  const nuevos = resultados.flatMap((r) => r.detalleAmbiguos);
  if (nuevos.length === 0) return;

  for (const a of nuevos) {
    console.log(`[data-api-sync] AMBIGUO omitido (no se escribió nada): codigoProceso="${a.codigoProceso}" entidad="${a.entidad}" candidatos=${a.candidatos}`);
  }

  try {
    const fs = await import('node:fs/promises');
    type EntradaCola = { codigoProceso: string; entidad: string; candidatos: number; detectadoEn: string; ultimaVezVisto: string };
    let existentes: EntradaCola[] = [];
    try {
      existentes = JSON.parse(await fs.readFile(RUTA_COLA_AMBIGUOS, 'utf8'));
    } catch {
      // archivo no existe todavía o no es legible — se parte de vacío
    }
    const porClave = new Map(existentes.map((e) => [`${e.codigoProceso}||${e.entidad}`, e]));
    const ahora = new Date().toISOString();
    for (const a of nuevos) {
      const clave = `${a.codigoProceso}||${a.entidad}`;
      const previa = porClave.get(clave);
      porClave.set(clave, {
        codigoProceso: a.codigoProceso,
        entidad: a.entidad,
        candidatos: a.candidatos,
        detectadoEn: previa?.detectadoEn ?? ahora,
        ultimaVezVisto: ahora,
      });
    }
    await fs.mkdir('ops/output', { recursive: true });
    await fs.writeFile(RUTA_COLA_AMBIGUOS, JSON.stringify([...porClave.values()], null, 2));
  } catch (e) {
    console.log(`[data-api-sync] no se pudo escribir la cola de ambiguos en archivo (no crítico): ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function ejecutarSyncRuntime(deps: DependenciasSyncRuntime = {}): Promise<SyncMetricsRuntime> {
  const env = deps.env ?? process.env;
  const t0 = Date.now();

  // 1. Guardrail de identidad del destino — ANTES de abrir nada de escritura.
  await verificarDestinoProduccion(env as EntornoDestinoProduccion, deps.consultaIdentidad ?? consultaIdentidadReal());

  // 2. Destino real + cliente HTTP.
  const destino = deps.crearDestino ? deps.crearDestino() : await crearDestinoRealAsync();
  // DATA_API_DEBUG_LOG=true (exacto) — logging temporal de diagnóstico sin
  // secretos (URL, status, código de error). Se lee aquí, no en cliente.ts,
  // que solo puede leer DATA_API_BASE_URL/DATA_API_KEY/DATA_API_TIMEOUT_MS.
  const cliente = deps.crearCliente?.() ?? crearDataApiClientDesdeEnv({ debug: env.DATA_API_DEBUG_LOG === 'true' });
  const limite = deps.limite ?? (env.DATA_API_SYNC_LIMITE ? Number(env.DATA_API_SYNC_LIMITE) : 30);
  // `resolverTimeoutMs` valida DATA_API_TIMEOUT_MS de forma estricta y aborta
  // aquí (antes de escribir) si el valor es inválido — el cliente ya lo lee
  // internamente, pero forzamos la validación temprana.
  resolverTimeoutMs(env as Record<string, string | undefined>);

  const obtenerSiguientePagina = crearObtenerSiguientePagina(cliente, { limite });

  // 3. Advisory lock de exclusión mutua sobre UNA sesión dedicada.
  const lockCliente = await destino.pool.connect();
  let lockAdquirido = false;
  try {
    const r = (await lockCliente.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY_SYNC_RUNTIME])) as {
      rows: Array<{ locked: boolean }>;
    };
    lockAdquirido = r.rows[0]?.locked === true;

    if (!lockAdquirido) {
      // Otra corrida ya tiene el lock — NO se escribe nada.
      const m = acumular([], Date.now() - t0, true);
      m.lockNoAdquirido = true;
      return m;
    }

    // 4. Bucle de aplicación por página.
    const resultados: ResultadoAplicacion[] = [];
    let cursor: string | null = deps.forzarFullResync ? null : await leerCursorInicial(destino.aplicador);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const pagina: PaginaSync | null = await obtenerSiguientePagina(cursor);
      if (!pagina) break;
      const res = await aplicarPaginaCanonica(pagina, { prisma: destino.aplicador });
      resultados.push(res);
      console.log(`[data-api-sync] pagina procesada items=${pagina.items.length}`);
      if (res.checkpointDefinitivoPersistido !== null) {
        console.log('[data-api-sync] checkpoint actualizado');
      }
      if (!pagina.hayMas) break;
      cursor = pagina.nextPageCursor;
    }

    await registrarAmbiguos(resultados);

    return acumular(resultados, Date.now() - t0, true);
  } finally {
    if (lockAdquirido) {
      await lockCliente.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY_SYNC_RUNTIME]).catch(() => {});
    }
    lockCliente.release();
    await destino.cerrar().catch(() => {});
  }
}
