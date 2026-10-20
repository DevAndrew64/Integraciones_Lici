/**
 * ¿La solicitud quedó Adjudicada? Es el mismo criterio de las listas «Cerrados → Adjudicados» y del informe de
 * adjudicados: la última fila de `asignaciones` en `CERRADO_ADJUDICADO`. `resultadoFinal` solo lo llena el cierre nuevo
 * (los procesos cerrados antes, sobre todo privados, lo tienen vacío); si viene lleno, manda.
 */
export function esAdjudicada(s: { resultadoFinal?: string | null; asignaciones?: unknown } | null | undefined): boolean {
  if (!s) return false;
  const resultado = typeof s.resultadoFinal === 'string' ? s.resultadoFinal.trim() : '';
  if (resultado) return resultado === 'Adjudicado';
  const filas = Array.isArray(s.asignaciones) ? s.asignaciones : [];
  const ultima = filas[filas.length - 1] as { estadoRevision?: unknown } | null | undefined;
  return typeof ultima === 'object' && ultima !== null && ultima.estadoRevision === 'CERRADO_ADJUDICADO';
}
