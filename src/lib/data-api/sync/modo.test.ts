/**
 * Pruebas del lector de modo de runtime `SYNC_RUNTIME_MODE`.
 * No toca ninguna BD ni red.
 *
 * REPO SHARE-READY (B5): 'legacy' NO es un modo operativo. El env puede
 * traerlo por compatibilidad, pero se coacciona a 'disabled' con warning.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  modoSyncRuntime,
  syncRuntimeEsLegacy,
  SyncRuntimeModeInvalidoError,
  SYNC_RUNTIME_MODE_DEFECTO,
} from './modo.js';

const env = (v?: string) => ({ ...(v === undefined ? {} : { SYNC_RUNTIME_MODE: v }) }) as NodeJS.ProcessEnv;

afterEach(() => vi.restoreAllMocks());

describe('modoSyncRuntime', () => {
  it('env ausente → disabled (default seguro)', () => {
    expect(modoSyncRuntime(env())).toBe('disabled');
    expect(SYNC_RUNTIME_MODE_DEFECTO).toBe('disabled');
  });

  it('cadena vacía / solo espacios → disabled', () => {
    expect(modoSyncRuntime(env(''))).toBe('disabled');
    expect(modoSyncRuntime(env('   '))).toBe('disabled');
  });

  it('reconoce data-api y disabled (case-insensitive, con espacios)', () => {
    expect(modoSyncRuntime(env('data-api'))).toBe('data-api');
    expect(modoSyncRuntime(env('disabled'))).toBe('disabled');
    expect(modoSyncRuntime(env('  DISABLED '))).toBe('disabled');
    expect(modoSyncRuntime(env('Data-Api'))).toBe('data-api');
  });

  it("'legacy' NO es seleccionable → se interpreta como disabled (con warning)", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(modoSyncRuntime(env('legacy'))).toBe('disabled');
    expect(modoSyncRuntime(env('  LEGACY '))).toBe('disabled');
    expect(warn).toHaveBeenCalled();
  });

  it('valor desconocido → lanza SyncRuntimeModeInvalidoError (NUNCA fallback)', () => {
    expect(() => modoSyncRuntime(env('produccion'))).toThrow(SyncRuntimeModeInvalidoError);
    expect(() => modoSyncRuntime(env('on'))).toThrow(SyncRuntimeModeInvalidoError);
    expect(() => modoSyncRuntime(env('true'))).toThrow(/no es un valor válido/);
  });

  it('syncRuntimeEsLegacy: SIEMPRE false (legacy no es modo operativo)', () => {
    expect(syncRuntimeEsLegacy(env())).toBe(false);
    expect(syncRuntimeEsLegacy(env('disabled'))).toBe(false);
    expect(syncRuntimeEsLegacy(env('data-api'))).toBe(false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(syncRuntimeEsLegacy(env('legacy'))).toBe(false);
    warn.mockRestore();
  });
});
