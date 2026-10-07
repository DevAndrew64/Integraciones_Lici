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

describe('POST /api/cursos/grupos', () => {
  it('exige empresa', async () => {
    const { POST } = await import('./route');
    const res = await POST(mkReq({}));
    expect(res.status).toBe(400);
  });

  it('normaliza cod_grp/descripcion a codigoGrupo/nombreGrupo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ cod_grp: 'GC006', descripcion: 'PERSONA AUTORIZADA TSA-VIGIA ESPACIO CONFINADO' }] })));
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo' }));
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.data[0]).toEqual({ codigoGrupo: 'GC006', nombreGrupo: 'PERSONA AUTORIZADA TSA-VIGIA ESPACIO CONFINADO' });
  });
});
