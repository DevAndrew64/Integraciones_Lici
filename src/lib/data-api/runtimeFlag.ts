/**
 * FEATURE FLAG ÚNICO del cutover de runtime a la Data API.
 *
 * Única fuente de verdad para el interruptor `DATA_API_RUNTIME_ENABLED`
 * (decisión D5). Ningún otro módulo debe volver a leer esa variable de
 * entorno directamente: todos consultan `dataApiRuntimeEnabled()` (o el
 * modo efectivo resuelto en `./sync/modo.ts`, que delega aquí).
 *
 *   DATA_API_RUNTIME_ENABLED ausente / vacío / cualquier cosa que no sea
 *   un "sí" explícito              → OFF  (comportamiento legacy actual)
 *   DATA_API_RUNTIME_ENABLED ∈ {true,1,on,yes,enabled} (case-insensitive,
 *   recortado)                      → ON   (cutover a Data API)
 *
 * Regla dura (seguridad por defecto): un feature flag NUNCA lanza por un
 * valor raro — degrada a OFF. Lo que jamás ocurre es un "ON accidental":
 * solo un token afirmativo explícito enciende el cutover.
 *
 * Con el flag OFF el comportamiento observable del runtime es idéntico al
 * actual. Con el flag ON, ningún camino de escritura/adquisición de
 * procesos puede alcanzar el pipeline legacy (ver `./sync/impl/implLegacy.ts`
 * como único boundary autorizado y `./sync/antibypass.test.ts`).
 */

/** Nombre de la variable de entorno — expuesto para mensajes y tests. */
export const DATA_API_RUNTIME_FLAG = 'DATA_API_RUNTIME_ENABLED' as const;

/** Tokens afirmativos aceptados (case-insensitive, ya recortados). */
const AFIRMATIVOS: ReadonlySet<string> = new Set(['true', '1', 'on', 'yes', 'enabled']);

/**
 * `true` sólo cuando el cutover de runtime a la Data API está encendido
 * de forma EXPLÍCITA. Inyectable para tests (`env`).
 */
export function dataApiRuntimeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const crudo = (env.DATA_API_RUNTIME_ENABLED ?? '').trim().toLowerCase();
  return AFIRMATIVOS.has(crudo);
}

/** `true` cuando el flag está OFF (azúcar de lectura para los call sites legacy). */
export function dataApiRuntimeDisabled(env?: NodeJS.ProcessEnv): boolean {
  return !dataApiRuntimeEnabled(env);
}
