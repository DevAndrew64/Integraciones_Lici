/**
 * Ajuste "CIERRE DE SQR AL PRESENTAR" — estado explícito del intento de
 * cierre externo de la SQR en GrupoColba. Módulo puro, sin fetch ni
 * Prisma — única fuente de la regla de compatibilidad hacia atrás (punto
 * 13 del ajuste): registros anteriores a este cambio nunca tuvieron
 * `sqrCierreEstado`, así que el valor EFECTIVO se deriva siempre de
 * `sqrCerrada` cuando ese campo es `null`.
 */
export type EstadoCierreSqr = 'PENDIENTE' | 'CERRANDO' | 'CERRADA' | 'ERROR';

const ESTADOS_VALIDOS = new Set<EstadoCierreSqr>(['PENDIENTE', 'CERRANDO', 'CERRADA', 'ERROR']);

/**
 * Compatibilidad: `sqrCierreEstado` explícito manda siempre. Si es `null`
 * (registro histórico o SQR nunca tocada por este flujo), `sqrCerrada`
 * decide: `true` → CERRADA (equivalente funcional), cualquier otro caso →
 * PENDIENTE. Nunca se infiere CERRANDO/ERROR de la nada.
 */
export function resolverEstadoCierreSqrEfectivo(params: {
  sqrCerrada: boolean;
  sqrCierreEstado: string | null | undefined;
}): EstadoCierreSqr {
  const explicito = params.sqrCierreEstado;
  if (typeof explicito === 'string' && ESTADOS_VALIDOS.has(explicito as EstadoCierreSqr)) {
    return explicito as EstadoCierreSqr;
  }
  return params.sqrCerrada ? 'CERRADA' : 'PENDIENTE';
}
