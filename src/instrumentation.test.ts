/**
 * Pruebas del scheduler in-process (`register()` de instrumentation).
 *
 * `node-cron` y el resolvedor de modo se mockean: no se programa nada real
 * ni se abre BD/HTTP. Se verifica:
 *   - modo disabled  → NO se registra ningún cron de adquisición de procesos
 *   - modo data-api  → se registran sync principal (*​/5) + sync profundo
 *   - guardia de registro único (una sola vez por proceso)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const cronSpy = vi.hoisted(() => ({ schedule: vi.fn() }));
const modoSpy = vi.hoisted(() => ({ modoSyncRuntime: vi.fn() }));

vi.mock('node-cron', () => ({ default: { schedule: cronSpy.schedule } }));
vi.mock('@/lib/data-api/sync/modo', () => ({ modoSyncRuntime: modoSpy.modoSyncRuntime }));

const ORIG_RUNTIME = process.env.NEXT_RUNTIME;
const ORIG_SYNC_CRON = process.env.SYNC_CRON;

beforeEach(() => {
  vi.resetModules();
  cronSpy.schedule.mockReset();
  modoSpy.modoSyncRuntime.mockReset();
  process.env.NEXT_RUNTIME = 'nodejs';
  delete process.env.SYNC_CRON;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  if (ORIG_RUNTIME === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = ORIG_RUNTIME;
  if (ORIG_SYNC_CRON === undefined) delete process.env.SYNC_CRON;
  else process.env.SYNC_CRON = ORIG_SYNC_CRON;
});

/** Expresiones cron efectivamente programadas, en orden. */
function cronsRegistrados(): string[] {
  return cronSpy.schedule.mock.calls.map((c) => c[0] as string);
}

describe('instrumentation.register — modo disabled', () => {
  it('NO registra cron de adquisición; sí los jobs ajenos (limpieza, TRM)', async () => {
    modoSpy.modoSyncRuntime.mockReturnValue('disabled');
    const { register } = await import('./instrumentation.js');
    await register();

    const crons = cronsRegistrados();
    // Solo limpieza de notificaciones (0 3 * * *) y TRM (30 7,18 * * *).
    expect(crons).toEqual(['0 3 * * *', '30 7,18 * * *']);
    expect(crons).not.toContain('*/5 * * * *');
    expect(crons).not.toContain('0 4 * * *');
  });
});

describe('instrumentation.register — modo data-api', () => {
  it('registra sync principal cada 5 min + sync profundo diario', async () => {
    modoSpy.modoSyncRuntime.mockReturnValue('data-api');
    const { register } = await import('./instrumentation.js');
    await register();

    const crons = cronsRegistrados();
    expect(crons).toContain('*/5 * * * *'); // sync principal, default
    expect(crons).toContain('0 4 * * *'); // sync profundo, sin cambios
    expect(crons).toContain('0 3 * * *'); // limpieza
    expect(crons).toContain('30 7,18 * * *'); // TRM
  });

  it('SYNC_CRON override respeta el valor configurado', async () => {
    process.env.SYNC_CRON = '*/10 * * * *';
    modoSpy.modoSyncRuntime.mockReturnValue('data-api');
    const { register } = await import('./instrumentation.js');
    await register();
    expect(cronsRegistrados()).toContain('*/10 * * * *');
    expect(cronsRegistrados()).not.toContain('*/5 * * * *');
  });
});

describe('instrumentation.register — registro único', () => {
  it('una segunda llamada NO vuelve a programar cron', async () => {
    modoSpy.modoSyncRuntime.mockReturnValue('data-api');
    const { register } = await import('./instrumentation.js');
    await register();
    const nPrimera = cronSpy.schedule.mock.calls.length;
    await register();
    expect(cronSpy.schedule.mock.calls.length).toBe(nPrimera);
  });

  it('no hace nada fuera del runtime nodejs', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    modoSpy.modoSyncRuntime.mockReturnValue('data-api');
    const { register } = await import('./instrumentation.js');
    await register();
    expect(cronSpy.schedule).not.toHaveBeenCalled();
  });
});
