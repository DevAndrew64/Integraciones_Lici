/**
 * FASE B.4.5 — pruebas del feature flag único `DATA_API_RUNTIME_ENABLED`.
 * Módulo puro: sin BD, sin red. Env inyectado.
 */
import { describe, it, expect } from 'vitest';
import { dataApiRuntimeEnabled, dataApiRuntimeDisabled, DATA_API_RUNTIME_FLAG } from './runtimeFlag.js';

const env = (v?: string) =>
  ({ ...(v === undefined ? {} : { DATA_API_RUNTIME_ENABLED: v }) }) as NodeJS.ProcessEnv;

describe('dataApiRuntimeEnabled', () => {
  it('ausente / vacío / espacios → OFF (default seguro)', () => {
    expect(dataApiRuntimeEnabled(env())).toBe(false);
    expect(dataApiRuntimeEnabled(env(''))).toBe(false);
    expect(dataApiRuntimeEnabled(env('   '))).toBe(false);
  });

  it('tokens afirmativos explícitos → ON (case-insensitive, con espacios)', () => {
    for (const v of ['true', 'TRUE', ' True ', '1', 'on', 'ON', 'yes', 'enabled']) {
      expect(dataApiRuntimeEnabled(env(v)), v).toBe(true);
    }
  });

  it('cualquier otro valor → OFF (nunca un ON accidental, nunca lanza)', () => {
    for (const v of ['false', '0', 'off', 'no', 'disabled', 'legacy', 'data-api', 'sí', 'x', '2', 'truthy']) {
      expect(dataApiRuntimeEnabled(env(v)), v).toBe(false);
    }
  });

  it('dataApiRuntimeDisabled es el complemento exacto', () => {
    expect(dataApiRuntimeDisabled(env('true'))).toBe(false);
    expect(dataApiRuntimeDisabled(env())).toBe(true);
    expect(dataApiRuntimeDisabled(env('false'))).toBe(true);
  });

  it('el nombre de la variable está expuesto y es estable', () => {
    expect(DATA_API_RUNTIME_FLAG).toBe('DATA_API_RUNTIME_ENABLED');
  });
});
