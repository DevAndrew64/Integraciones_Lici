import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var _prisma: PrismaClient | undefined;
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('Falta DATABASE_URL en las variables de entorno.');
}

// Se limita el pool para permitir paralelismo sin saturar la base de datos.
const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const adapter = new PrismaPg(pool);

// Exportado para operaciones que requieren UNA conexión dedicada garantizada
// (p.ej. advisory locks de PostgreSQL, donde lock y unlock deben ejecutarse
// sobre la misma sesión — Prisma no garantiza qué conexión del pool usa cada
// query individual).
export { pool };

const prisma =
  globalThis._prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis._prisma = prisma;
}

export default prisma;