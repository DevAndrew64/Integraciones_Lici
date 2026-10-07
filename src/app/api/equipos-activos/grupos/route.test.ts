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

describe('POST /api/equipos-activos/grupos', () => {
  it('exige empresa', async () => {
    const { POST } = await import('./route');
    const res = await POST(mkReq({}));
    expect(res.status).toBe(400);
  });

  it('llama a grupo_activo, nunca al catálogo plano de equipos', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [{ cod_grupo: '004', descripcion: 'MAQUINARIA Y EQUIPO' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { POST } = await import('./route');
    await POST(mkReq({ empresa: 'aseo' }));
    expect(fetchMock).toHaveBeenCalledWith('https://grupocolba.com/service/public/api/grupo_activo', expect.objectContaining({ method: 'POST' }));
  });

  it('normaliza cod_grupo/descripcion a codigoGrupo/descripcionGrupo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ cod_grupo: '004', descripcion: 'MAQUINARIA Y EQUIPO' }] })));
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo' }));
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.data[0]).toEqual({ codigoGrupo: '004', descripcionGrupo: 'MAQUINARIA Y EQUIPO' });
  });

  it('deduplica cod_grupo repetido (ej. una fila por UEN de la fuente), nunca devuelve códigos duplicados', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [
        { cod_grupo: '004', descripcion: 'MAQUINARIA Y EQUIPO' },
        { cod_grupo: '004', descripcion: 'MAQUINARIA Y EQUIPO' },
        { cod_grupo: '005', descripcion: 'VEHÍCULOS' },
      ],
    })));
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo' }));
    const d = await res.json();
    expect(d.data).toEqual([
      { codigoGrupo: '004', descripcionGrupo: 'MAQUINARIA Y EQUIPO' },
      { codigoGrupo: '005', descripcionGrupo: 'VEHÍCULOS' },
    ]);
  });
});
