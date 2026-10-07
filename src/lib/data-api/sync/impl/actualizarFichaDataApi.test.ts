/**
 * FASE B.4.5 — `implDataApi.actualizarFichaProceso` REAL vía Data API.
 * Todas las dependencias pesadas mockeadas: nunca abre BD ni HTTP.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  resolverDestinoRuntime: vi.fn(),
  aplicarBundleCanonico: vi.fn(),
  actualizarFicha: vi.fn(),
  resolverProcesoIdParaLinkDetalle: vi.fn(),
  cerrar: vi.fn(async () => {}),
  procesoFindUnique: vi.fn(),
}));

vi.mock('../../runner/resolverDestinoRuntime.js', () => ({
  resolverDestinoRuntime: h.resolverDestinoRuntime,
}));
vi.mock('../../aplicador/aplicarPaginaCanonica.js', () => ({
  aplicarBundleCanonico: h.aplicarBundleCanonico,
}));
vi.mock('../../cliente.js', () => ({
  crearDataApiClientDesdeEnv: () => ({ actualizarFicha: h.actualizarFicha }),
}));
vi.mock('@/lib/proceso-identidad', () => ({
  resolverProcesoIdParaLinkDetalle: h.resolverProcesoIdParaLinkDetalle,
}));

import { implDataApi } from './implDataApi.js';

const bundleOk = {
  tipo: 'UPSERT' as const,
  proceso: { id: 'uuid-1', linkDetalle: 'https://x', fechaCierre: '2026-02-01T00:00:00.000Z', tieneCambioFechaCierre: false },
  documentos: null,
  cronograma: null,
};

beforeEach(() => {
  for (const f of Object.values(h)) (f as { mockReset?: () => void }).mockReset?.();
  h.cerrar.mockResolvedValue(undefined);
  h.resolverDestinoRuntime.mockResolvedValue({
    aplicador: {},
    prisma: { proceso: { findUnique: h.procesoFindUnique } },
    pool: {},
    cerrar: h.cerrar,
  });
  h.resolverProcesoIdParaLinkDetalle.mockResolvedValue({ ok: true, procesoId: 42 });
  h.procesoFindUnique.mockResolvedValue({ sourceKey: 'uuid-1' });
  h.actualizarFicha.mockResolvedValue({ ok: true, datos: { bundle: bundleOk } });
  h.aplicarBundleCanonico.mockResolvedValue({
    procesosCreados: 0, procesosActualizados: 1, tombstonesAplicados: 0, documentosCreados: 2,
    cronogramasReemplazados: 1, notificacionesCreadas: 1, solicitudesPropagadas: 1,
    reconciliacionEjecutada: false, procesosRetiradosPorReconciliacion: 0,
    checkpointDefinitivoPersistido: null, estadoTransitorioActualizado: false,
  });
});

describe('actualizarFichaProceso — flujo completo', () => {
  it('resuelve proceso → sourceKey → actualizarFicha → aplicarBundleCanonico → ResultadoActualizacionPuntual', async () => {
    const r = await implDataApi.actualizarFichaProceso({ procesoId: 42 });

    // 1. Guardrail de destino ANTES que nada
    expect(h.resolverDestinoRuntime).toHaveBeenCalledTimes(1);
    // 2. Resolución de identidad en el MISMO destino
    expect(h.resolverProcesoIdParaLinkDetalle).toHaveBeenCalledWith(
      expect.objectContaining({ proceso: expect.anything() }),
      expect.objectContaining({ id: 42 }),
    );
    expect(h.procesoFindUnique).toHaveBeenCalledWith({ where: { id: 42 }, select: { sourceKey: true } });
    // 3. Cliente HTTP con el id canónico
    expect(h.actualizarFicha).toHaveBeenCalledWith('uuid-1');
    // 4. Aplicación del bundle
    expect(h.aplicarBundleCanonico).toHaveBeenCalledWith(bundleOk, { prisma: {} });
    // 5. Resultado compatible con el frontend
    expect(r).toMatchObject({
      ok: true,
      modo: 'actualizacion_puntual',
      estado: 'completa',
      procesoId: 42,
      operacionesExternas: { detalle: 1, perfiles: 0, apiGeneral: 0 },
      linkDetalle: 'https://x',
      fechaVencimiento: '2026-02-01T00:00:00.000Z',
      cronogramasActualizados: 1,
      documentosNuevos: 2,
      solicitudesPropagadas: 1,
    });
    expect(h.cerrar).toHaveBeenCalledTimes(1); // destino siempre se cierra
  });

  it('sin cambios en el bundle → estado "sin_cambios"', async () => {
    h.aplicarBundleCanonico.mockResolvedValue({
      procesosCreados: 0, procesosActualizados: 1, tombstonesAplicados: 0, documentosCreados: 0,
      cronogramasReemplazados: 0, notificacionesCreadas: 0, solicitudesPropagadas: 0,
      reconciliacionEjecutada: false, procesosRetiradosPorReconciliacion: 0,
      checkpointDefinitivoPersistido: null, estadoTransitorioActualizado: false,
    });
    const r = await implDataApi.actualizarFichaProceso({ procesoId: 42 });
    expect(r.estado).toBe('sin_cambios');
    expect(r.ok).toBe(true);
  });
});

describe('actualizarFichaProceso — errores canónicos SIN fallback legacy', () => {
  it('identidad no resuelta → estado "error", nunca llama a la Data API', async () => {
    h.resolverProcesoIdParaLinkDetalle.mockResolvedValue({ ok: false, motivo: 'ambiguo' });
    const r = await implDataApi.actualizarFichaProceso({ codigoProceso: 'X' });
    expect(r).toMatchObject({ ok: false, estado: 'error' });
    expect(h.actualizarFicha).not.toHaveBeenCalled();
    expect(h.aplicarBundleCanonico).not.toHaveBeenCalled();
    expect(h.cerrar).toHaveBeenCalledTimes(1);
  });

  it('error UPSTREAM transitorio (reintentar:true) → "fuente_no_disponible", sin aplicar bundle', async () => {
    h.actualizarFicha.mockResolvedValue({ ok: false, error: { codigo: 'NO_DISPONIBLE', mensaje: 'temporalmente no disponible', reintentar: true } });
    const r = await implDataApi.actualizarFichaProceso({ procesoId: 42 });
    expect(r).toMatchObject({ ok: false, estado: 'fuente_no_disponible', error: 'temporalmente no disponible' });
    expect(h.aplicarBundleCanonico).not.toHaveBeenCalled();
  });

  it('error UPSTREAM permanente (reintentar:false) → "error"', async () => {
    h.actualizarFicha.mockResolvedValue({ ok: false, error: { codigo: 'ERROR_INTERNO', mensaje: 'no encontrado', reintentar: false } });
    const r = await implDataApi.actualizarFichaProceso({ procesoId: 42 });
    expect(r.estado).toBe('error');
  });

  it('NUNCA cae al pipeline legacy (implLegacy no se importa desde aquí)', async () => {
    // Estático: este módulo solo importa el boundary canónico, jamás procesos-sync / secop / resolver-link.
    const src = (await import('node:fs')).readFileSync(
      (await import('node:path')).resolve(__dirname, 'implDataApi.ts'),
      'utf8',
    );
    expect(/@\/lib\/procesos-sync|@\/lib\/resolver-link|@\/lib\/secop\//.test(src)).toBe(false);
  });
});

describe('actualizarFichaProceso — guardrail obligatorio', () => {
  it('si `resolverDestinoRuntime` lanza (guardrail), NO se consulta identidad ni la Data API', async () => {
    h.resolverDestinoRuntime.mockRejectedValue(new Error('DATA_API_RUNTIME_EXPECTED_SYSTEM_IDENTIFIER ausente'));
    await expect(implDataApi.actualizarFichaProceso({ procesoId: 42 })).rejects.toThrow(/DATA_API_RUNTIME/);
    expect(h.resolverProcesoIdParaLinkDetalle).not.toHaveBeenCalled();
    expect(h.actualizarFicha).not.toHaveBeenCalled();
    expect(h.aplicarBundleCanonico).not.toHaveBeenCalled();
  });
});
