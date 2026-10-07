/**
 * D16/D7 — pruebas de `implDataApi.resolverLinkProceso` REAL vía Data API.
 * Todas las dependencias pesadas mockeadas: nunca abre BD ni HTTP.
 * Mismo patrón de mocking que `actualizarFichaDataApi.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  resolverDestinoRuntime: vi.fn(),
  resolverLinkDetalle: vi.fn(),
  procesoUpdate: vi.fn(),
  cerrar: vi.fn(async () => {}),
  procesoFindUnique: vi.fn(),
}));

vi.mock('../../runner/resolverDestinoRuntime.js', () => ({
  resolverDestinoRuntime: h.resolverDestinoRuntime,
}));
vi.mock('../../cliente.js', () => ({
  crearDataApiClientDesdeEnv: () => ({ resolverLinkDetalle: h.resolverLinkDetalle }),
}));

import { implDataApi } from './implDataApi.js';

beforeEach(() => {
  for (const f of Object.values(h)) (f as { mockReset?: () => void }).mockReset?.();
  h.cerrar.mockResolvedValue(undefined);
  h.procesoUpdate.mockResolvedValue({ id: 42 });
  h.resolverDestinoRuntime.mockResolvedValue({
    aplicador: { proceso: { update: h.procesoUpdate } },
    prisma: { proceso: { findUnique: h.procesoFindUnique } },
    pool: {},
    cerrar: h.cerrar,
  });
  h.procesoFindUnique.mockResolvedValue({ sourceKey: 'uuid-1', linkDetalle: null });
  h.resolverLinkDetalle.mockResolvedValue({ ok: true, datos: { linkDetalle: 'https://contratos.gov.co/consultas/detalle-1', resuelto: true } });
});

describe('resolverLinkProceso — flujo completo', () => {
  it('resuelve proceso → sourceKey → cliente.resolverLinkDetalle → persiste SOLO linkDetalle', async () => {
    const r = await implDataApi.resolverLinkProceso(42);

    expect(h.resolverDestinoRuntime).toHaveBeenCalledTimes(1);
    expect(h.procesoFindUnique).toHaveBeenCalledWith({ where: { id: 42 }, select: { sourceKey: true, linkDetalle: true } });
    expect(h.resolverLinkDetalle).toHaveBeenCalledWith('uuid-1');
    expect(h.procesoUpdate).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { linkDetalle: 'https://contratos.gov.co/consultas/detalle-1' },
    });
    expect(r).toMatchObject({ ok: true, yaExistia: false, linkDetalle: 'https://contratos.gov.co/consultas/detalle-1' });
    expect(h.cerrar).toHaveBeenCalledTimes(1);
  });

  it('si el proceso YA tiene linkDetalle, no llama a la Data API (no gasta la llamada)', async () => {
    h.procesoFindUnique.mockResolvedValue({ sourceKey: 'uuid-1', linkDetalle: 'https://ya-resuelto.invalid' });

    const r = await implDataApi.resolverLinkProceso(42);

    expect(h.resolverLinkDetalle).not.toHaveBeenCalled();
    expect(h.procesoUpdate).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, yaExistia: true, linkDetalle: 'https://ya-resuelto.invalid' });
  });

  it('proceso sin sourceKey (no gestionable por Data API) → ok:false, nunca llama a la Data API', async () => {
    h.procesoFindUnique.mockResolvedValue(null);

    const r = await implDataApi.resolverLinkProceso(999);

    expect(r.ok).toBe(false);
    expect(h.resolverLinkDetalle).not.toHaveBeenCalled();
    expect(h.cerrar).toHaveBeenCalledTimes(1); // el destino siempre se cierra
  });

  it('la Data API responde ok:false (ErrorCanonico) → se propaga el mensaje ya saneado, no se escribe nada', async () => {
    h.resolverLinkDetalle.mockResolvedValue({ ok: false, error: { codigo: 'NO_DISPONIBLE', mensaje: 'servicio no disponible', reintentar: true } });

    const r = await implDataApi.resolverLinkProceso(42);

    expect(r).toMatchObject({ ok: false, error: 'servicio no disponible' });
    expect(h.procesoUpdate).not.toHaveBeenCalled();
  });

  it('la Data API responde ok:true pero resuelto:false (aún sin link en origen) → ok:false, no escribe nada', async () => {
    h.resolverLinkDetalle.mockResolvedValue({ ok: true, datos: { linkDetalle: null, resuelto: false } });

    const r = await implDataApi.resolverLinkProceso(42);

    expect(r.ok).toBe(false);
    expect(h.procesoUpdate).not.toHaveBeenCalled();
  });

  it('si `resolverDestinoRuntime` lanza (guardrail), NO se consulta identidad ni la Data API', async () => {
    h.resolverDestinoRuntime.mockRejectedValue(new Error('DATA_API_RUNTIME_EXPECTED_SYSTEM_IDENTIFIER ausente'));

    await expect(implDataApi.resolverLinkProceso(42)).rejects.toThrow(/DATA_API_RUNTIME/);
    expect(h.procesoFindUnique).not.toHaveBeenCalled();
    expect(h.resolverLinkDetalle).not.toHaveBeenCalled();
  });

  it('siempre cierra el destino, incluso si la Data API falla', async () => {
    h.resolverLinkDetalle.mockRejectedValue(new Error('timeout'));

    await expect(implDataApi.resolverLinkProceso(42)).rejects.toThrow('timeout');
    expect(h.cerrar).toHaveBeenCalledTimes(1);
  });
});
