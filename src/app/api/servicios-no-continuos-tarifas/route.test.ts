/**
 * Ajuste "SERVICIOS NO CONTINUOS — FASE 2 MVP: TARIFARIO ASEOCOLBA" — la
 * ruta re-sirve el catálogo provisional estático (sin llamada externa).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/session', () => ({ getSession: vi.fn(async () => ({ id: 1, rol: 'admin' })) }));
vi.mock('@/lib/authz', () => ({
  requireSession: vi.fn(() => null),
  hasPermiso: vi.fn(async () => true),
}));

function req() {
  return new Request('http://x') as unknown as import('next/server').NextRequest;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('GET /api/servicios-no-continuos-tarifas', () => {
  it('devuelve {ok:true, fuente:EXCEL_2026_II_PROVISIONAL, vigenteHasta:2026-12-31, tarifas:[36 entradas]}', async () => {
    const { GET } = await import('./route');
    const res = await GET(req());
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.fuente).toBe('EXCEL_2026_II_PROVISIONAL');
    expect(d.vigenteHasta).toBe('2026-12-31');
    expect(Array.isArray(d.tarifas)).toBe(true);
    expect(d.tarifas.length).toBe(36);
  });

  it('sin permiso ver_estructura_costos → 403', async () => {
    const authz = await import('@/lib/authz');
    vi.mocked(authz.hasPermiso).mockResolvedValueOnce(false);
    const { GET } = await import('./route');
    const res = await GET(req());
    expect(res.status).toBe(403);
  });
});
