import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/session', () => ({
  getSession: async () => ({ id: 1, email: 'admin@grupocolba.com', rol: 'admin', exp: 9999999999, sv: 1, usuario: 'admin.qa' }),
}));
vi.mock('@/lib/costos-estructura/catalogo-mantenimiento-equipos', () => ({
  resolverMantenimientoSugerido: async (descripcion: string) =>
    descripcion === 'ASPIRADORA INDUSTRIAL' ? { valor: 25000, origen: 'CATALOGO_MTTO_2025', referenciaId: 'catalogo-2025-fila-2' } : null,
}));

function mkReq(body: Record<string, unknown>): NextRequest {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('POST /api/equipos-activos/mantenimiento', () => {
  it('exige descripcionEquipo', async () => {
    const { POST } = await import('./route');
    const res = await POST(mkReq({}));
    expect(res.status).toBe(400);
  });

  it('devuelve la sugerencia cuando hay coincidencia', async () => {
    const { POST } = await import('./route');
    const res = await POST(mkReq({ descripcionEquipo: 'ASPIRADORA INDUSTRIAL' }));
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.sugerencia).toEqual({ valor: 25000, origen: 'CATALOGO_MTTO_2025', referenciaId: 'catalogo-2025-fila-2' });
  });

  it('devuelve sugerencia:null cuando no hay coincidencia (nunca inventa un valor)', async () => {
    const { POST } = await import('./route');
    const res = await POST(mkReq({ descripcionEquipo: 'AVISO PREVENTIVO' }));
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.sugerencia).toBeNull();
  });
});
