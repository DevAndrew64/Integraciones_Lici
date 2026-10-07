/**
 * Adaptador de `PrismaLikeAplicador` sobre un `PrismaClient` dedicado (el
 * destino de escritura del runner, nunca el singleton `@/lib/prisma`).
 *
 * `aplicarPaginaCanonica` depende solo de `PrismaLikeAplicador` — nunca del
 * cliente Prisma concreto. Este archivo es el único punto que traduce esa
 * interfaz mínima a llamadas Prisma reales:
 *
 *  - Delegados directos (`proceso`, `procesoDocumentoSecop`,
 *    `procesoCronogramaSecop`, `notificacion`) → se pasan tal cual.
 *  - `dataApiSyncState` → la interfaz usa `obtenerEstado()` / `upsertEstado()`
 *    (nombres propios del contrato del aplicador); aquí se implementan sobre
 *    `findUnique` / `upsert` con la clave singleton fija `'procesos'`.
 *  - `$transaction(fn)` → `prisma.$transaction` real, envolviendo el cliente
 *    transaccional en este mismo adaptador para que el callback siga viendo
 *    solo `PrismaLikeAplicador`.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import type { PrismaLikeAplicador, SyncStateFilaAplicador } from './tiposPrisma';

/** Clave singleton de `DataApiSyncState` — una sola fila, siempre esta clave. */
export const CLAVE_SYNC_STATE = 'procesos';

type ClienteBase = PrismaClient | Prisma.TransactionClient;

function adaptar(db: ClienteBase): PrismaLikeAplicador {
  return {
    proceso: {
      findUnique: (args) => db.proceso.findUnique(args) as never,
      findMany: (args) => db.proceso.findMany(args as never) as never,
      create: (args) => db.proceso.create(args as never) as never,
      update: (args) => db.proceso.update(args as never) as never,
      updateMany: (args) => db.proceso.updateMany(args as never),
    },
    procesoDocumentoSecop: {
      findMany: (args) => db.procesoDocumentoSecop.findMany(args) as never,
      create: (args) => db.procesoDocumentoSecop.create(args as never) as never,
    },
    procesoCronogramaSecop: {
      findMany: (args) => db.procesoCronogramaSecop.findMany(args) as never,
      deleteMany: (args) => db.procesoCronogramaSecop.deleteMany(args),
      createMany: (args) => db.procesoCronogramaSecop.createMany(args as never),
    },
    notificacion: {
      findUnique: (args) => db.notificacion.findUnique(args) as never,
      create: (args) => db.notificacion.create(args as never) as never,
    },
    solicitud: {
      updateMany: (args) => db.solicitud.updateMany(args as never),
    },
    dataApiSyncState: {
      obtenerEstado: () =>
        db.dataApiSyncState.findUnique({ where: { clave: CLAVE_SYNC_STATE } }) as Promise<SyncStateFilaAplicador | null>,
      upsertEstado: ({ data }) =>
        db.dataApiSyncState.upsert({
          where: { clave: CLAVE_SYNC_STATE },
          create: { clave: CLAVE_SYNC_STATE, ...data },
          update: data,
        }) as Promise<SyncStateFilaAplicador>,
    },
    // El aplicador SIEMPRE abre su propia transacción por página. Aquí se
    // delega en la transacción interactiva real de Prisma; si el callback
    // lanza, Prisma hace ROLLBACK completo (idéntica semántica a la del fake).
    //
    // `timeout` generoso: una página canónica aplica decenas de procesos
    // (cada uno con docs/cronograma/notificaciones) contra una BD remota; el
    // default de 5 s de Prisma no alcanza. Sigue siendo UNA transacción
    // atómica por página — el tamaño de página lo acota el runner.
    $transaction: (fn) =>
      (db as PrismaClient).$transaction((tx) => fn(adaptar(tx)), { timeout: 180_000, maxWait: 30_000 }),
  };
}

export function crearPrismaAplicadorReal(prisma: PrismaClient): PrismaLikeAplicador {
  return adaptar(prisma);
}
