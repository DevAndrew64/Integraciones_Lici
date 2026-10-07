/**
 * Ajuste "MIGRACIÓN E IMPORTACIÓN CONTROLADA" §7 — decisión pura de qué
 * hacer con cada fila aceptada al ejecutar --apply (todavía no
 * implementado contra una base real — ver script). Sin Prisma, sin
 * `fetch` — reutilizable por el importador y por pruebas.
 *
 *  A. La llave de negocio no existe en la base → INSERTAR.
 *  B. La llave existe y `hashFila` es igual al persistido → SIN_CAMBIOS
 *     (nunca se reescribe un registro idéntico).
 *  C. La llave existe y `hashFila` cambió → ACTUALIZAR (datos
 *     contractuales/económicos; `actualizadoEn` lo mantiene Prisma vía
 *     `@updatedAt`, nunca se fija a mano).
 *  D. Nunca se crea una segunda fila con la misma llave (regla D) — esta
 *     función asume que el caller ya resolvió cualquier conflicto de
 *     llave DENTRO del propio archivo (ver resolverConflictosLlave) antes
 *     de comparar contra lo persistido.
 */

export type AccionFilaTarifa = 'INSERTAR' | 'ACTUALIZAR' | 'SIN_CAMBIOS';

export function resolverAccionFila(
  filaNueva: { hashFila: string },
  filaExistente: { hashFila: string } | null | undefined,
): AccionFilaTarifa {
  if (!filaExistente) return 'INSERTAR';
  if (filaExistente.hashFila === filaNueva.hashFila) return 'SIN_CAMBIOS';
  return 'ACTUALIZAR';
}

export interface ResumenAcciones {
  insertados: number;
  actualizados: number;
  sinCambios: number;
}

export function resumirAcciones(acciones: readonly AccionFilaTarifa[]): ResumenAcciones {
  return {
    insertados: acciones.filter(a => a === 'INSERTAR').length,
    actualizados: acciones.filter(a => a === 'ACTUALIZAR').length,
    sinCambios: acciones.filter(a => a === 'SIN_CAMBIOS').length,
  };
}
