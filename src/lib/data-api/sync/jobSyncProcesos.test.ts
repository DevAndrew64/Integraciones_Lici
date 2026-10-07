/**
 * Pruebas del job de sincronización automática (`ejecutarJobSyncProcesos`).
 *
 * `fachadaSync` se mockea: NO se toca guardrail / advisory lock / HTTP / BD.
 * Se verifica: despacho principal vs profundo, guardia in-process de
 * solapamiento, manejo de "lock no adquirido", modo desactivado, y que un
 * error NO se relanza ni deja la bandera pegada.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fachadaSpy = vi.hoisted(() => ({ sincronizarProcesos: vi.fn() }));

vi.mock('./fachadaSync.js', async (importActual) => {
  const actual = await importActual<typeof import('./fachadaSync.js')>();
  return { ...actual, fachadaSync: fachadaSpy };
});

import { ejecutarJobSyncProcesos, jobSyncEnEjecucion } from './jobSyncProcesos.js';

const ejecutado = (over: Record<string, unknown> = {}) => ({
  estado: 'ejecutado' as const,
  modo: 'data-api' as const,
  datos: { ok: true, paginasConsultadas: 2, creados: 1, actualizados: 3, duracionMs: 4, ...over },
});
const deshabilitado = { estado: 'deshabilitado' as const, modo: 'disabled' as const, mensaje: 'off' };

let logs: string[] = [];
let errs: string[] = [];

beforeEach(() => {
  fachadaSpy.sincronizarProcesos.mockReset();
  logs = [];
  errs = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => void errs.push(a.join(' ')));
});
afterEach(() => vi.restoreAllMocks());

describe('ejecutarJobSyncProcesos — despacho', () => {
  it('principal: llama fachada sin fullResync y reporta métricas', async () => {
    fachadaSpy.sincronizarProcesos.mockResolvedValueOnce(ejecutado());
    const r = await ejecutarJobSyncProcesos({ profundo: false });
    expect(fachadaSpy.sincronizarProcesos).toHaveBeenCalledWith();
    expect(r).toMatchObject({ estado: 'ejecutado', profundo: false, paginas: 2, creados: 1, actualizados: 3 });
    expect(logs.some((l) => l.includes('[data-api-sync] inicio principal'))).toBe(true);
    expect(logs.some((l) => l.startsWith('[data-api-sync] finalizado durationMs='))).toBe(true);
  });

  it('profundo: propaga { fullResync: true } y un cutoffCreacion Date', async () => {
    fachadaSpy.sincronizarProcesos.mockResolvedValueOnce(ejecutado());
    await ejecutarJobSyncProcesos({ profundo: true });
    const [params, opts] = fachadaSpy.sincronizarProcesos.mock.calls[0];
    expect(params.cutoffCreacion).toBeInstanceOf(Date);
    expect(opts).toEqual({ fullResync: true });
  });
});

describe('ejecutarJobSyncProcesos — configuración / lock', () => {
  it('modo deshabilitado → estado desactivado + log neutral', async () => {
    fachadaSpy.sincronizarProcesos.mockResolvedValueOnce(deshabilitado);
    const r = await ejecutarJobSyncProcesos();
    expect(r).toEqual({ estado: 'desactivado' });
    expect(logs).toContain('[data-api-sync] desactivado por configuración');
  });

  it('advisory lock no adquirido aguas abajo → estado omitido-lock', async () => {
    fachadaSpy.sincronizarProcesos.mockResolvedValueOnce(ejecutado({ lockNoAdquirido: true }));
    const r = await ejecutarJobSyncProcesos();
    expect(r).toEqual({ estado: 'omitido-lock' });
    expect(logs.some((l) => l.includes('advisory lock'))).toBe(true);
  });
});

describe('ejecutarJobSyncProcesos — anti-solapamiento in-process', () => {
  it('una segunda corrida mientras la primera sigue viva NO ejecuta la fachada otra vez', async () => {
    let resolver!: (v: unknown) => void;
    fachadaSpy.sincronizarProcesos.mockImplementationOnce(
      () => new Promise((res) => { resolver = res; }),
    );

    const p1 = ejecutarJobSyncProcesos();
    await Promise.resolve();
    expect(jobSyncEnEjecucion()).toBe(true);

    const r2 = await ejecutarJobSyncProcesos();
    expect(r2).toEqual({ estado: 'omitido-en-proceso' });
    expect(logs.some((l) => l.includes('[data-api-sync] omitido: otra ejecución activa'))).toBe(true);
    expect(fachadaSpy.sincronizarProcesos).toHaveBeenCalledTimes(1);

    resolver(ejecutado());
    await p1;
    expect(jobSyncEnEjecucion()).toBe(false);
  });

  it('tras un error la bandera se libera y la siguiente corrida sí ejecuta', async () => {
    fachadaSpy.sincronizarProcesos.mockRejectedValueOnce(new Error('detalle interno   con   espacios'));
    const r1 = await ejecutarJobSyncProcesos();
    expect(r1.estado).toBe('error');
    expect(errs.some((l) => l.startsWith('[data-api-sync] error'))).toBe(true);
    expect(jobSyncEnEjecucion()).toBe(false);

    fachadaSpy.sincronizarProcesos.mockResolvedValueOnce(ejecutado());
    const r2 = await ejecutarJobSyncProcesos();
    expect(r2.estado).toBe('ejecutado');
    expect(fachadaSpy.sincronizarProcesos).toHaveBeenCalledTimes(2);
  });

  it('un error NO se relanza (el scheduler no debe caerse)', async () => {
    fachadaSpy.sincronizarProcesos.mockRejectedValueOnce(new Error('boom'));
    await expect(ejecutarJobSyncProcesos()).resolves.toMatchObject({ estado: 'error' });
  });
});
