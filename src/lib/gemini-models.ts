/**
 * Configuración centralizada de modelos Gemini.
 * El modelo principal se lee de GEMINI_MODEL (variable de entorno).
 * Si no existe o falla con 404, se usan los fallbacks en orden.
 */

const ENV_MODEL = process.env.GEMINI_MODEL?.trim();

/** Lista ordenada de modelos vigentes. Ninguno es gemini-2.0 ni gemini-1.5. */
export const GEMINI_MODELS: readonly string[] = Array.from(
  new Set([
    ENV_MODEL || 'gemini-3.5-flash',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash',
  ].filter(Boolean))
);

/** Modelo principal (primero de la lista). */
export const GEMINI_MODEL_DEFAULT = GEMINI_MODELS[0];

/**
 * Decide si un error de Gemini es transitorio (reintentar con otro modelo)
 * o terminal (abortar inmediatamente).
 *
 * SKIP (pasar al siguiente):   404, modelo inexistente, respuesta vacía, JSON inválido, SAFETY
 * RETRY (esperar y reintentar): 429, 503, RESOURCE_EXHAUSTED, overloaded
 * BREAK (abortar):             403, Forbidden, API key inválida
 */
export function clasificarErrorGemini(err: unknown): 'skip' | 'retry' | 'break' | 'unknown' {
  const msg = String(err).toLowerCase();

  if (
    msg.includes('403') ||
    msg.includes('forbidden') ||
    msg.includes('denied access') ||
    msg.includes('api_key_invalid') ||
    msg.includes('invalid api key')
  ) return 'break';

  if (
    msg.includes('404') ||
    msg.includes('not found') ||
    msg.includes('model not found') ||
    msg.includes('safety') ||
    msg.includes('blocked') ||
    msg.includes('finish_reason: safety')
  ) return 'skip';

  if (
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('503') ||
    msg.includes('overloaded') ||
    msg.includes('unavailable')
  ) return 'retry';

  return 'unknown';
}

/** Mensaje de error seguro para el usuario (sin URLs, keys ni stack traces). */
export const GEMINI_USER_ERROR =
  'No fue posible completar la respuesta con el modelo de IA configurado. Revisá la configuración de Gemini o intentá nuevamente.';