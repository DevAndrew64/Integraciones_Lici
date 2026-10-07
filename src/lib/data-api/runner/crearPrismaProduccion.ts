/**
 * PrismaClient EXCLUSIVO del writer de RUNTIME de la sincronización
 * (sync incremental/full + actualización puntual de ficha).
 *
 * Regla dura: NUNCA importa `@/lib/prisma` (el singleton ligado a
 * `DATABASE_URL`). Construye su PROPIO `PrismaClient` y su PROPIO `pg.Pool` a
 * partir de `DATA_API_RUNTIME_DATABASE_URL`.
 *
 * Cliente: **`@prisma/client`** (el mismo schema completo que usa toda la
 * app). El destino de runtime satisface `prisma/schema.prisma`, así que hay
 * UN solo schema productivo. El adaptador de escritura es
 * `crearPrismaAplicadorReal` (también
 * `@prisma/client`).
 *
 * El guardrail `verificarDestinoProduccion` DEBE pasar ANTES de invocar
 * esto — ver `ejecutarSyncRuntime.ts` y `resolverDestinoRuntime.ts`.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

export interface PrismaProduccion {
  prisma: PrismaClient;
  /**
   * Pool subyacente — expuesto para el advisory lock de exclusión mutua,
   * que requiere que `pg_advisory_lock` y `pg_advisory_unlock` corran sobre
   * la MISMA sesión (ver `ejecutarSyncRuntime.ts`).
   */
  pool: Pool;
  /** Cierra Prisma y el pool — llamar SIEMPRE al terminar. */
  cerrar: () => Promise<void>;
}

export function crearPrismaProduccion(
  url: string | undefined = process.env.DATA_API_RUNTIME_DATABASE_URL,
): PrismaProduccion {
  if (!url) {
    throw new Error(
      'DATA_API_RUNTIME_DATABASE_URL no está definida — el writer de runtime no puede construir su PrismaClient.',
    );
  }
  const pool = new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool), log: ['error'] });
  return {
    prisma,
    pool,
    cerrar: async () => {
      await prisma.$disconnect();
      await pool.end();
    },
  };
}
