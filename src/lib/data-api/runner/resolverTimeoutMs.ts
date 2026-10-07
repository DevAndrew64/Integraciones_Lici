/**
 * Resolución/validación del timeout HTTP del cliente del servicio de datos.
 *
 * Módulo PURO: sin side effects, sin BD, sin fetch, sin `main()`. Sólo
 * exporta `resolverTimeoutMs`.
 *
 * Reglas:
 *   - `DATA_API_TIMEOUT_MS` ausente, vacía o sólo espacios → 30000 (valor
 *     histórico).
 *   - definida → debe ser un entero decimal POSITIVO: sólo dígitos (tras
 *     recortar espacios externos), sin signo, sin punto decimal, sin
 *     notación exponencial, sin espacios internos, `> 0` y dentro de
 *     `Number.isSafeInteger`.
 *   - cualquier otro valor ("abc", "0", "-5", "1.5", "1e5", "NaN",
 *     "12 000", …) → lanza un error EXPLÍCITO, invocado ANTES de crear el
 *     cliente, de modo que un valor inválido aborta sin abrir ninguna conexión.
 *   - los mensajes de error NUNCA incluyen el valor crudo recibido.
 */

export const TIMEOUT_MS_POR_DEFECTO = 30_000;

export function resolverTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const crudo = env.DATA_API_TIMEOUT_MS;
  if (crudo === undefined || crudo.trim() === '') return TIMEOUT_MS_POR_DEFECTO;

  const s = crudo.trim();
  if (!/^\d+$/.test(s)) {
    throw new Error(
      'DATA_API_TIMEOUT_MS inválido: se esperaba un entero positivo de milisegundos ' +
        '(solo dígitos: sin signo, sin punto decimal, sin notación exponencial, sin espacios internos).',
    );
  }

  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error('DATA_API_TIMEOUT_MS inválido: debe ser un entero finito mayor que 0 (milisegundos).');
  }
  return n;
}
