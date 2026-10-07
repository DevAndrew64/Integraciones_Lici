/**
 * Advisory lock de PostgreSQL por proceso para TODA la configuración del
 * pliego (regla TRM + conjunto de métodos) — FASE A.1.
 *
 * Un único namespace para regla y conjunto → todas las transiciones de un
 * mismo proceso quedan serializadas, y `sincronizarEstadoRevisionPliego`
 * nunca ve un estado a medio construir. Mismo patrón que
 * `src/lib/procesos/actualizar-ficha-puntual.ts`.
 */

import { pool } from '@/lib/prisma';

const LOCK_NS_PLIEGO = 517_231;

export async function conLockDePliego<T>(procesoId: number, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [LOCK_NS_PLIEGO, procesoId]);
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [LOCK_NS_PLIEGO, procesoId]).catch(() => {});
    }
  } finally {
    client.release();
  }
}
