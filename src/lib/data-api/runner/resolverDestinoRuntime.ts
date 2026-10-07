/**
 * Resolución del DESTINO DE ESCRITURA de runtime de la sincronización,
 * compartida por:
 *   - el runner de sync (`ejecutarSyncRuntime`), y
 *   - la actualización puntual de ficha (`implDataApi.actualizarFichaProceso`).
 *
 * GARANTÍA: NINGÚN camino de escritura canónica en runtime puede saltarse el
 * guardrail de identidad del destino. Cualquiera que quiera escribir vía Data
 * API llama primero a `resolverDestinoRuntime()`, que:
 *   1. ejecuta `verificarDestinoProduccion` (exige
 *      `DATA_API_RUNTIME_EXPECTED_SYSTEM_IDENTIFIER` + `_DATABASE_URL` +
 *      `_WRITE_ENABLED=true`, y compara el `system_identifier` real);
 *   2. construye un `PrismaClient`/pool PROPIOS ligados a
 *      `DATA_API_RUNTIME_DATABASE_URL` (nunca el singleton `@/lib/prisma`);
 *   3. devuelve el adaptador `PrismaLikeAplicador` real (`@prisma/client`) y
 *      el `pool` (para el advisory lock del runner).
 *
 * El `PrismaClient` de `@prisma/client` es pesado — se importa de forma
 * DIFERIDA aquí para no cargarlo en cada test que solo mockea la fachada.
 */
import type { PrismaLikeAplicador } from '../aplicador/tiposPrisma';
import {
  verificarDestinoProduccion,
  type ConsultaIdentidadDestino,
  type EntornoDestinoProduccion,
} from './guardrailDestinoProduccion';

/** Conexión mínima que necesita el advisory lock: `pg_advisory_lock`/`unlock` sobre la MISMA sesión. */
export interface ClienteLock {
  query(sql: string, params?: unknown[]): Promise<unknown>;
  release(): void;
}
export interface PoolLock {
  connect(): Promise<ClienteLock>;
}

export interface DestinoRuntime {
  aplicador: PrismaLikeAplicador;
  pool: PoolLock;
  /**
   * Cliente Prisma crudo del destino de runtime (`@prisma/client`) — para
   * lecturas de identidad que el `PrismaLikeAplicador` mínimo no cubre
   * (resolver un Proceso por id/externalId/codigo). Es el MISMO destino
   * guardrailado; nunca el singleton `@/lib/prisma`.
   */
  prisma: unknown;
  cerrar: () => Promise<void>;
}

/**
 * Nombre de la tabla marcadora OPCIONAL de identidad de destino (fallback,
 * ver más abajo). Solo lectura; el propio guard nunca la crea ni la escribe.
 */
const TABLA_MARCADOR_IDENTIDAD = 'runtime_destino_identidad';

/** `true` si el error de Postgres es un "permission denied" (SQLSTATE 42501). */
function esErrorPermisoDenegado(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === '42501') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /permission denied/i.test(msg);
}

/**
 * Implementación real de la consulta de identidad: `pg` en transacción READ
 * ONLY, sin escribir.
 *
 * Mecanismo principal: `SELECT system_identifier FROM pg_control_system()`.
 * Desde PostgreSQL 10, la ejecución de esta función NO está concedida a
 * PUBLIC por defecto (solo superusuario / rol `pg_monitor`) — en un rol de
 * aplicación de mínimo privilegio (el tipo de rol que este proyecto usa
 * deliberadamente en producción) esto falla con "permission denied", que es
 * exactamente el síntoma reportado.
 *
 * FALLBACK opcional, sin requerir NINGÚN privilegio elevado: si la consulta
 * anterior falla específicamente por falta de permiso, se intenta leer el
 * mismo identificador desde una tabla marcadora ordinaria
 * (`runtime_destino_identidad(clave text primary key, valor text)`) que el
 * administrador puede crear una sola vez en el destino, con un `INSERT`
 * manual de `('system_identifier', '<valor real de pg_control_system() en
 * esa instancia>')`. Leer una tabla propia requiere el mismo nivel de
 * privilegio (SELECT) que cualquier tabla de negocio que la app ya consulta
 * — nunca EXECUTE sobre una función restringida ni rol `pg_monitor`.
 *
 * Si el fallback no está disponible (tabla inexistente u otro motivo), se
 * relanza el error ORIGINAL de `pg_control_system()` sin modificarlo —
 * nunca se inventa ni se oculta el motivo real, y el guard sigue abortando
 * exactamente igual que antes si ningún mecanismo puede confirmar la
 * identidad del destino.
 */
export function consultaIdentidadReal(): ConsultaIdentidadDestino {
  return {
    async obtenerSystemIdentifier(runtimeUrl: string): Promise<string> {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: runtimeUrl, max: 1, connectionTimeoutMillis: 8_000 });
      try {
        const cliente = await pool.connect();
        try {
          await cliente.query('BEGIN TRANSACTION READ ONLY');
          try {
            const res = (await cliente.query('SELECT system_identifier FROM pg_control_system()')) as {
              rows: Array<{ system_identifier: string | number | bigint }>;
            };
            await cliente.query('COMMIT');
            return String(res.rows[0]?.system_identifier ?? '');
          } catch (errPrincipal) {
            if (!esErrorPermisoDenegado(errPrincipal)) {
              await cliente.query('ROLLBACK').catch(() => {});
              throw errPrincipal;
            }
            // Permiso denegado sobre pg_control_system() — intentar el
            // marcador opcional, SIN elevar privilegios, dentro de la MISMA
            // transacción read-only.
            try {
              const resFallback = (await cliente.query(
                `SELECT valor FROM ${TABLA_MARCADOR_IDENTIDAD} WHERE clave = 'system_identifier' LIMIT 1`,
              )) as { rows: Array<{ valor: string | null }> };
              await cliente.query('COMMIT');
              const valor = resFallback.rows[0]?.valor;
              if (requeridoNoVacio(valor)) return valor;
              // Tabla presente pero sin el marcador cargado: no hay forma
              // segura de confirmar identidad — se conserva el error original.
              throw errPrincipal;
            } catch {
              await cliente.query('ROLLBACK').catch(() => {});
              // Fallback no disponible (tabla inexistente u otro motivo):
              // se conserva el error ORIGINAL de pg_control_system(), sin
              // sustituirlo por el de la tabla marcadora.
              throw errPrincipal;
            }
          }
        } finally {
          cliente.release();
        }
      } finally {
        await pool.end();
      }
    },
  };
}

function requeridoNoVacio(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export interface OpcionesResolverDestino {
  env?: NodeJS.ProcessEnv;
  /** Inyectable para tests: consulta read-only del `system_identifier`. */
  consultaIdentidad?: ConsultaIdentidadDestino;
}

/**
 * Verifica el guardrail y devuelve un destino de escritura listo. Lanza
 * `IdentidadDestinoProduccionNoConfirmadaError` (de `guardrailDestinoProduccion`)
 * ANTES de abrir ninguna conexión de escritura si algo no cuadra.
 */
export async function resolverDestinoRuntime(opciones: OpcionesResolverDestino = {}): Promise<DestinoRuntime> {
  const env = opciones.env ?? process.env;

  await verificarDestinoProduccion(
    env as EntornoDestinoProduccion,
    opciones.consultaIdentidad ?? consultaIdentidadReal(),
  );

  const [{ crearPrismaProduccion }, { crearPrismaAplicadorReal }] = await Promise.all([
    import('./crearPrismaProduccion'),
    import('../aplicador/prismaAplicadorReal'),
  ]);
  const { prisma, pool, cerrar } = crearPrismaProduccion();
  return {
    aplicador: crearPrismaAplicadorReal(prisma),
    pool: pool as unknown as PoolLock,
    prisma,
    cerrar,
  };
}
