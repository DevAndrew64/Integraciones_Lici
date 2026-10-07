import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/session', () => ({
  getSession: async () => ({ id: 1, email: 'admin@grupocolba.com', rol: 'admin', exp: 9999999999, sv: 1, usuario: 'admin.qa' }),
}));

function mkReq(body: Record<string, unknown>): NextRequest {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('POST /api/equipos-activos/subtipos', () => {
  it('exige empresa', async () => {
    const { POST } = await import('./route');
    const res = await POST(mkReq({ codigoGrupo: '004' }));
    expect(res.status).toBe(400);
  });

  it('exige codigoGrupo', async () => {
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo' }));
    expect(res.status).toBe(400);
  });

  it('llama a subtipo_activo con empresa y cod_grupo', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [{ cod_subtipo: '017', descripcion: 'BRILLADORA A GAS 28 CON TANQUE' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { POST } = await import('./route');
    await POST(mkReq({ empresa: 'aseo', codigoGrupo: '004' }));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://grupocolba.com/service/public/api/subtipo_activo',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ empresa: 'aseo', cod_grupo: '004' }) }),
    );
  });

  it('normaliza cod_subtipo/descripcion a codigoSubtipo/descripcionSubtipo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ cod_subtipo: '017', descripcion: 'BRILLADORA A GAS 28 CON TANQUE' }] })));
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', codigoGrupo: '004' }));
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.data[0]).toEqual({ codigoSubtipo: '017', descripcionSubtipo: 'BRILLADORA A GAS 28 CON TANQUE' });
  });

  it('deduplica cod_subtipo repetido (ej. una fila por UEN de la fuente), nunca devuelve códigos duplicados', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [
        { cod_subtipo: '001', descripcion: 'BRILLADORA' },
        { cod_subtipo: '001', descripcion: 'BRILLADORA' },
        { cod_subtipo: '002', descripcion: 'ASPIRADORA' },
      ],
    })));
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', codigoGrupo: '004' }));
    const d = await res.json();
    expect(d.data).toEqual([
      { codigoSubtipo: '001', descripcionSubtipo: 'BRILLADORA' },
      { codigoSubtipo: '002', descripcionSubtipo: 'ASPIRADORA' },
    ]);
  });
});
