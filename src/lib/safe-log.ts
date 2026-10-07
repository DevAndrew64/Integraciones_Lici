import { createHash } from 'crypto';

/**
 * Devuelve los primeros 12 chars del SHA-256 de un string.
 * Útil para identificar una respuesta concreta en logs sin exponer su contenido.
 */
export function safeHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/**
 * Loguea un error con metadatos seguros (nunca contenido de documentos, prompts ni datos personales).
 * Solo acepta valores primitivos o numéricos en `meta`; trunca strings largos a 80 chars.
 */
export function safeErrorLog(context: string, meta: Record<string, string | number | boolean | null | undefined>): void {
  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === 'string' && v.length > 80) {
      sanitized[k] = v.slice(0, 80) + '…';
    } else {
      sanitized[k] = v;
    }
  }
  console.error(`[${context}]`, sanitized);
}