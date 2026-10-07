/**
 * Guardia del endpoint interno POST /api/ai/anthropic/test:
 * deshabilitado en producción salvo habilitación explícita por variable.
 */
export function endpointPruebaHabilitado(
  env: { NODE_ENV?: string; ANTHROPIC_TEST_ENDPOINT_ENABLED?: string } = process.env,
): boolean {
  return env.NODE_ENV !== 'production' || env.ANTHROPIC_TEST_ENDPOINT_ENABLED === '1';
}
