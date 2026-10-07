/**
 * Pruebas de la fachada única de sincronización.
 *
 * REPO SHARE-READY (B5):
 *   - El pipeline legacy fue RETIRADO del árbol. No hay `implLegacy`.
 *   - 'legacy' NO es un modo operativo (env → 'disabled' + warning).
 *   - `implDataApi` se mockea con spies para no tocar guardrail/lock/HTTP.
 * Despacho por modo efectivo (`./modo.ts`):
 *   disabled (default, y 'legacy' coaccionado) → { estado: 'deshabilitado' }
 *   data-api → delega SIEMPRE en `implDataApi.*`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const dataApiSpies = vi.hoisted(() => ({
  sincronizarProcesos: vi.fn(async () => ({ ok: true, via: 'data-api', recibidos: 5, creados: 1, actualizados: 4 })),
  resolverLinkProceso: vi.fn(async () => ({ ok: false, estado: 'MIGRADO_DATA_API', error: 'migrado' })),
  revalidarLinkProceso: vi.fn(async () => ({ ok: false, motivo: 'migrado_data_api', cambioDetectado: false, actualizado: false })),
  actualizarFichaProceso: vi.fn(async () => ({ ok: true, modo: 'actualizacion_puntual', estado: 'sin_cambios' })),
  obtenerDetallePublico: vi.fn(async () => ({ detalle: {}, persisted: {} })),
}));

vi.mock('./impl/implDataApi.js', async (importActual) => {
  const actual = await importActual<typeof import('./impl/implDataApi.js')>();
  return { ...actual, implDataApi: dataApiSpies };
});

import {
  fachadaSync,
  MENSAJE_SYNC_DESHABILITADO,
  SyncModoDataApiNoHabilitadoError,
} from './fachadaSync.js';
import { SyncRuntimeModeInvalidoError } from './modo.js';

const ORIG_MODE = process.env.SYNC_RUNTIME_MODE;
const ORIG_FLAG = process.env.DATA_API_RUNTIME_ENABLED;

function setMode(v?: string) {
  if (v === undefined) delete process.env.SYNC_RUNTIME_MODE;
  else process.env.SYNC_RUNTIME_MODE = v;
}
function setFlag(v?: string) {
  if (v === undefined) delete process.env.DATA_API_RUNTIME_ENABLED;
  else process.env.DATA_API_RUNTIME_ENABLED = v;
}
const legacyNuncaLlamado = () => {/* legacy retirado del árbol: no-op */
};

beforeEach(() => {
  for (const s of Object.values(dataApiSpies)) s.mockClear();
  setMode(undefined);
  setFlag(undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  if (ORIG_MODE === undefined) delete process.env.SYNC_RUNTIME_MODE;
  else process.env.SYNC_RUNTIME_MODE = ORIG_MODE;
  if (ORIG_FLAG === undefined) delete process.env.DATA_API_RUNTIME_ENABLED;
  else process.env.DATA_API_RUNTIME_ENABLED = ORIG_FLAG;
});

describe('fachadaSync — default / "legacy" → deshabilitado (legacy inalcanzable)', () => {
  for (const valor of [undefined, 'legacy', '  LEGACY '] as const) {
    it(`SYNC_RUNTIME_MODE=${JSON.stringify(valor)} → { estado: 'deshabilitado' }, ningún impl ejecutado`, async () => {
      setMode(valor);
      const r = await fachadaSync.sincronizarProcesos({ maxResultados: 10 } as never);
      expect(r).toEqual({ estado: 'deshabilitado', modo: 'disabled', mensaje: MENSAJE_SYNC_DESHABILITADO });
      expect(dataApiSpies.sincronizarProcesos).not.toHaveBeenCalled();
      legacyNuncaLlamado();
    });
  }

  it("'legacy' emite console.warn (ignorado, no seleccionable)", async () => {
    setMode('legacy');
    await fachadaSync.sincronizarProcesos();
    expect(console.warn).toHaveBeenCalled();
  });

  it('todas las operaciones quedan deshabilitadas', async () => {
    setMode('legacy');
    for (const op of [
      () => fachadaSync.resolverLinkProceso(5),
      () => fachadaSync.revalidarLinkProceso(7, { persistir: true }),
      () => fachadaSync.actualizarFichaProceso({ procesoId: 1 } as never),
      () => fachadaSync.obtenerDetallePublico('https://community.secop.gov.co/x'),
    ]) {
      expect((await op()).estado).toBe('deshabilitado');
    }
    for (const s of Object.values(dataApiSpies)) expect(s).not.toHaveBeenCalled();
    legacyNuncaLlamado();
  });
});

describe('fachadaSync — modo disabled explícito', () => {
  it("{ estado: 'deshabilitado' } con mensaje de solo-lectura", async () => {
    setMode('disabled');
    const r = await fachadaSync.sincronizarProcesos();
    expect(r.estado).toBe('deshabilitado');
    if (r.estado === 'deshabilitado') expect(r.mensaje).toMatch(/deshabilitada/i);
    expect(dataApiSpies.sincronizarProcesos).not.toHaveBeenCalled();
    legacyNuncaLlamado();
  });
});

describe('fachadaSync — modo data-api (cutover activo)', () => {
  it('sincronizarProcesos delega en implDataApi', async () => {
    setMode('data-api');
    const r = await fachadaSync.sincronizarProcesos({ maxResultados: 10 } as never);
    expect(r).toMatchObject({ estado: 'ejecutado', modo: 'data-api' });
    if (r.estado === 'ejecutado') expect(r.datos).toMatchObject({ via: 'data-api' });
    expect(dataApiSpies.sincronizarProcesos).toHaveBeenCalledTimes(1);
    legacyNuncaLlamado();
  });

  it('sync profundo propaga opts.fullResync a implDataApi', async () => {
    setMode('data-api');
    await fachadaSync.sincronizarProcesos({ cutoffCreacion: null } as never, { fullResync: true });
    expect(dataApiSpies.sincronizarProcesos).toHaveBeenCalledWith({ cutoffCreacion: null }, { fullResync: true });
  });

  it('las 5 operaciones delegan en implDataApi', async () => {
    setMode('data-api');
    await fachadaSync.sincronizarProcesos();
    await fachadaSync.resolverLinkProceso(1);
    await fachadaSync.revalidarLinkProceso(1, { persistir: true });
    await fachadaSync.actualizarFichaProceso({ procesoId: 1 } as never);
    await fachadaSync.obtenerDetallePublico('u');
    for (const s of Object.values(dataApiSpies)) expect(s).toHaveBeenCalledTimes(1);
    legacyNuncaLlamado();
  });

  it('un rechazo de implDataApi se propaga tal cual (sin fallback legacy)', async () => {
    setMode('data-api');
    dataApiSpies.obtenerDetallePublico.mockRejectedValueOnce(
      Object.assign(new Error('migrada'), { name: 'OperacionMigradaDataApiError', httpStatus: 410 }),
    );
    await expect(fachadaSync.obtenerDetallePublico('u')).rejects.toMatchObject({
      name: 'OperacionMigradaDataApiError',
      httpStatus: 410,
    });
    legacyNuncaLlamado();
  });
});

describe('fachadaSync — feature flag DATA_API_RUNTIME_ENABLED', () => {
  it('flag ON fuerza data-api aunque SYNC_RUNTIME_MODE sea inválido', async () => {
    setMode('produccion');
    setFlag('true');
    const r = await fachadaSync.sincronizarProcesos();
    expect(r).toMatchObject({ estado: 'ejecutado', modo: 'data-api' });
    expect(dataApiSpies.sincronizarProcesos).toHaveBeenCalledTimes(1);
    legacyNuncaLlamado();
  });

  it('flag ausente / valor no afirmativo → deshabilitado', async () => {
    setMode(undefined);
    for (const v of [undefined, 'false', '0', 'off', 'no', '']) {
      setFlag(v);
      const r = await fachadaSync.sincronizarProcesos();
      expect(r.estado).toBe('deshabilitado');
    }
    legacyNuncaLlamado();
  });
});

describe('fachadaSync — SYNC_RUNTIME_MODE inválido (flag OFF)', () => {
  it('propaga SyncRuntimeModeInvalidoError sin ejecutar nada', async () => {
    setMode('produccion');
    await expect(fachadaSync.sincronizarProcesos()).rejects.toBeInstanceOf(SyncRuntimeModeInvalidoError);
    expect(dataApiSpies.sincronizarProcesos).not.toHaveBeenCalled();
    legacyNuncaLlamado();
  });
});

describe('fachadaSync — compat de exports', () => {
  it('SyncModoDataApiNoHabilitadoError sigue exportado con code estable', () => {
    const e = new SyncModoDataApiNoHabilitadoError('x');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('SYNC_MODO_DATA_API_NO_HABILITADO');
  });
});
