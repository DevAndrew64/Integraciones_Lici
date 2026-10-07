/**
 * Ajuste "CIERRE DE SQR AL PRESENTAR" §2/§3/§4/§5 (confirmado
 * explícitamente) — reemplaza la doctrina anterior (`evidencias[0]`, sin
 * ninguna identidad) por una finalidad EXPLÍCITA por evidencia. Extiende
 * el objeto YA existente (`{nombre,tipo,base64,fechaCarga}`) de forma
 * compatible — nunca una tabla nueva, nunca un campo obligatorio que
 * rompa registros históricos.
 *
 * Documentos guardados ANTES de este ajuste no tienen `finalidad` — se
 * consideran SIEMPRE `GENERAL` (nunca `PRESENTACION`), así que nunca
 * disparan el cierre de una SQR por sí solos (regla de compatibilidad
 * histórica, punto 11 del diagnóstico previo).
 */

export type FinalidadEvidencia = 'GENERAL' | 'PRESENTACION';

export interface EvidenciaAsignacion {
  nombre: string;
  tipo: string;
  base64: string;
  fechaCarga: string;
  finalidad?: FinalidadEvidencia;
}

export function resolverFinalidadEvidencia(ev: { finalidad?: string | null }): FinalidadEvidencia {
  return ev?.finalidad === 'PRESENTACION' ? 'PRESENTACION' : 'GENERAL';
}

/**
 * A lo sumo UNA evidencia de presentación activa (punto 5): la nueva
 * queda marcada `PRESENTACION`; cualquier otra existente se degrada a
 * `GENERAL` — permanece guardada como documento histórico/general, nunca
 * se elimina. Nunca deja dos evidencias `PRESENTACION` simultáneas.
 */
export function marcarComoEvidenciaPresentacion<T extends { finalidad?: FinalidadEvidencia }>(
  evidenciasActuales: T[],
  nueva: T,
): T[] {
  return [
    ...evidenciasActuales.map((e) => ({ ...e, finalidad: 'GENERAL' as const })),
    { ...nueva, finalidad: 'PRESENTACION' as const },
  ];
}

/**
 * Evidencia `PRESENTACION` vigente dentro del arreglo de UNA fila. Si por
 * algún dato histórico existiera más de una marcada (no debería ocurrir,
 * ver `marcarComoEvidenciaPresentacion`), se toma la de carga MÁS
 * RECIENTE — nunca la primera del arreglo (eso es precisamente la
 * doctrina `evidencias[0]` que este ajuste elimina).
 */
export function obtenerEvidenciaPresentacionDeFila(evidencias: unknown): EvidenciaAsignacion | null {
  if (!Array.isArray(evidencias)) return null;
  const candidatas = (evidencias as EvidenciaAsignacion[]).filter(
    (e) => e && typeof e === 'object' && resolverFinalidadEvidencia(e) === 'PRESENTACION',
  );
  if (candidatas.length === 0) return null;
  if (candidatas.length === 1) return candidatas[0];
  return [...candidatas].sort(
    (a, b) => new Date(b.fechaCarga).getTime() - new Date(a.fechaCarga).getTime(),
  )[0];
}

/**
 * `PRESENTAR` es una acción GLOBAL de la solicitud (no de una fila
 * puntual) — busca en TODAS las filas de `asignaciones[]`, porque la
 * evidencia vive dentro de la fila que estaba activa en el momento de la
 * carga (mismo criterio que el resto del módulo Procesos: nunca asume
 * cuál fila es "la actual" desde fuera de la UI).
 */
export function obtenerEvidenciaPresentacion(asignaciones: unknown): EvidenciaAsignacion | null {
  if (!Array.isArray(asignaciones)) return null;
  for (const fila of asignaciones as Record<string, unknown>[]) {
    const ev = obtenerEvidenciaPresentacionDeFila(fila?.evidencias);
    if (ev) return ev;
  }
  return null;
}

/** Reconstruye el archivo real desde el base64 persistido — usado para
 * enviarlo como `soporte` (Blob) al cerrar la SQR en GrupoColba. */
export function evidenciaABlob(ev: { base64: string; tipo?: string }): Blob {
  const buffer = Buffer.from(ev.base64, 'base64');
  return new Blob([buffer], { type: ev.tipo || 'application/octet-stream' });
}

/**
 * Ajuste "UN SOLO TIPO DE EVIDENCIA — SIN SEGUNDA CARGA AL PRESENTAR"
 * (confirmado explícitamente) — la UI eliminó el selector separado
 * "Evidencia para presentar"; ahora "Presentar proceso" reutiliza
 * automáticamente lo ya cargado en "Evidencia de elaboración", sin exigir
 * ninguna designación explícita. Decisión de negocio (confirmada): cuando
 * hay varias evidencias, se usa la de carga MÁS RECIENTE como soporte del
 * cierre de SQR — nunca la primera del arreglo (`evidencias[0]`, que
 * sería arbitraria sin criterio), sino la última por `fechaCarga`, igual
 * de determinista pero sin exigirle al usuario un segundo archivo.
 *
 * `obtenerEvidenciaPresentacion`/`marcarComoEvidenciaPresentacion` (arriba)
 * NO se eliminan — siguen siendo la fuente de verdad para datos
 * históricos ya marcados `finalidad==='PRESENTACION'` (reconciliación,
 * scripts de diagnóstico). Estas nuevas funciones son exclusivamente para
 * el flujo EN VIVO de `PRESENTAR`, que ya no marca nada.
 */
export function obtenerEvidenciaMasRecienteDeFila(evidencias: unknown): EvidenciaAsignacion | null {
  if (!Array.isArray(evidencias) || evidencias.length === 0) return null;
  const validas = (evidencias as EvidenciaAsignacion[]).filter((e) => e && typeof e === 'object');
  if (validas.length === 0) return null;
  return [...validas].sort(
    (a, b) => new Date(b.fechaCarga).getTime() - new Date(a.fechaCarga).getTime(),
  )[0];
}

/** Mismo criterio de búsqueda global que `obtenerEvidenciaPresentacion`
 * (PRESENTAR es una acción de toda la solicitud, no de una fila puntual):
 * recorre todas las filas de `asignaciones[]` y devuelve, de entre TODAS
 * las evidencias encontradas en cualquier fila, la de carga más reciente. */
export function obtenerEvidenciaMasReciente(asignaciones: unknown): EvidenciaAsignacion | null {
  if (!Array.isArray(asignaciones)) return null;
  let mejor: EvidenciaAsignacion | null = null;
  for (const fila of asignaciones as Record<string, unknown>[]) {
    const ev = obtenerEvidenciaMasRecienteDeFila(fila?.evidencias);
    if (ev && (!mejor || new Date(ev.fechaCarga).getTime() > new Date(mejor.fechaCarga).getTime())) {
      mejor = ev;
    }
  }
  return mejor;
}
