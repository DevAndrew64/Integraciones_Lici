/**
 * Ajuste "TRM — NO VISIBLE NI ACCESIBLE PARA MERCADEO" (Parte A — backend)
 * — `GET /api/trm` ahora exige `requireNoMercadeo` (`@/lib/authz`) en vez
 * de `requireSession`: 401 sin sesión (sin cambios), 403 para Mercadeo
 * (nuevo), comportamiento actual sin cambios para cualquier otro rol
 * autenticado. Fuente única reutilizada (`esMercadeo`, `@/lib/roles`), sin
 * array de roles nuevo.
 *
 * `@/lib/trm` se mockea para no depender de red/BD real — el foco de este
 * archivo es la autorización, no el cálculo de TRM (sin cambios).
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

let sesionActual: { id: number; email: string; rol: string; usuario: string } | null;

const TRM_ACTUAL_FAKE = {
  valor: 4200.5, centavos: 50, fuente: 'trm_historico', esOficial: true,
  vigenciaDesde: '2026-08-25', vigenciaHasta: '2026-08-25', desdeCache: false,
  consultadoEn: '2026-08-25T00:00:00.000Z', advertencia: null, fecha: '2026-08-25',
};

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));
vi.mock('@/lib/trm', () => ({
  obtenerTrmActual: async () => TRM_ACTUAL_FAKE,
  obtenerHistorial: async () => [],
}));

function req() {
  return new NextRequest('http://localhost/api/trm?dias=30');
}

describe('GET /api/trm — autorización (Parte A: TRM bloqueado para Mercadeo)', () => {
  it('1) Mercadeo → 403', async () => {
    sesionActual = { id: 201, email: 'ana.rios@grupocolba.com', rol: 'Analista Mercadeo', usuario: 'ana.rios' };
    const { GET } = await import('./route');
    const res = await GET(req());
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it('3) Administrador → comportamiento actual (200)', async () => {
    sesionActual = { id: 1, email: 'admin.qa@grupocolba.com', rol: 'Administrador', usuario: 'admin.qa' };
    const { GET } = await import('./route');
    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.actual.valor).toBe(TRM_ACTUAL_FAKE.valor);
  });

  it('4) Comercial (Analista Comercial) → comportamiento actual (200)', async () => {
    sesionActual = { id: 101, email: 'oscar.pallares@grupocolba.com', rol: 'Analista Comercial', usuario: 'oscar.pallares' };
    const { GET } = await import('./route');
    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('5) Sin sesión → 401', async () => {
    sesionActual = null;
    const { GET } = await import('./route');
    const res = await GET(req());
    expect(res.status).toBe(401);
  });
});
