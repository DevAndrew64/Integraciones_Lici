/**
 * Validación de `DATA_API_TIMEOUT_MS`. Importa ÚNICAMENTE el módulo puro
 * `resolverTimeoutMs.ts` — sin side effects ni conexiones al importarse.
 */
import { describe, it, expect } from 'vitest';
import { resolverTimeoutMs, TIMEOUT_MS_POR_DEFECTO } from './resolverTimeoutMs';

describe('resolverTimeoutMs — DATA_API_TIMEOUT_MS', () => {
  it('variable ausente → 30000', () => {
    expect(resolverTimeoutMs({})).toBe(30_000);
    expect(TIMEOUT_MS_POR_DEFECTO).toBe(30_000);
  });

  it('cadena vacía o sólo espacios → 30000', () => {
    expect(resolverTimeoutMs({ DATA_API_TIMEOUT_MS: '' })).toBe(30_000);
    expect(resolverTimeoutMs({ DATA_API_TIMEOUT_MS: '   ' })).toBe(30_000);
  });

  it('180000 → 180000 (valor de esta recuperación)', () => {
    expect(resolverTimeoutMs({ DATA_API_TIMEOUT_MS: '180000' })).toBe(180_000);
  });

  it('tolera espacios externos: " 120000 " → 120000', () => {
    expect(resolverTimeoutMs({ DATA_API_TIMEOUT_MS: ' 120000 ' })).toBe(120_000);
  });

  it('valor no numérico ("abc") → error explícito', () => {
    expect(() => resolverTimeoutMs({ DATA_API_TIMEOUT_MS: 'abc' })).toThrow(/DATA_API_TIMEOUT_MS inválido/);
  });

  it('"NaN" literal → error explícito', () => {
    expect(() => resolverTimeoutMs({ DATA_API_TIMEOUT_MS: 'NaN' })).toThrow(/DATA_API_TIMEOUT_MS inválido/);
  });

  it('0 → error explícito', () => {
    expect(() => resolverTimeoutMs({ DATA_API_TIMEOUT_MS: '0' })).toThrow(/DATA_API_TIMEOUT_MS inválido/);
  });

  it('negativo ("-5000") → error explícito', () => {
    expect(() => resolverTimeoutMs({ DATA_API_TIMEOUT_MS: '-5000' })).toThrow(/DATA_API_TIMEOUT_MS inválido/);
  });

  it('decimal → error explícito (se exige entero)', () => {
    expect(() => resolverTimeoutMs({ DATA_API_TIMEOUT_MS: '1500.5' })).toThrow(/DATA_API_TIMEOUT_MS inválido/);
    expect(() => resolverTimeoutMs({ DATA_API_TIMEOUT_MS: '180000.0' })).toThrow(/DATA_API_TIMEOUT_MS inválido/);
  });

  it('notación exponencial ("1e5") → error explícito', () => {
    expect(() => resolverTimeoutMs({ DATA_API_TIMEOUT_MS: '1e5' })).toThrow(/DATA_API_TIMEOUT_MS inválido/);
  });

  it('espacios internos ("12 000") → error explícito', () => {
    expect(() => resolverTimeoutMs({ DATA_API_TIMEOUT_MS: '12 000' })).toThrow(/DATA_API_TIMEOUT_MS inválido/);
  });

  it('fuera de Number.isSafeInteger → error explícito', () => {
    // 2^53 = 9007199254740992 → Number.isSafeInteger(2^53) === false
    expect(() => resolverTimeoutMs({ DATA_API_TIMEOUT_MS: '9007199254740992' })).toThrow(/DATA_API_TIMEOUT_MS inválido/);
  });

  it('el mensaje de error nunca incluye el valor crudo recibido', () => {
    try {
      resolverTimeoutMs({ DATA_API_TIMEOUT_MS: 'secret_like_value' });
      throw new Error('debió lanzar');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('DATA_API_TIMEOUT_MS inválido');
      expect(msg).not.toContain('secret_like_value');
    }
  });
});
