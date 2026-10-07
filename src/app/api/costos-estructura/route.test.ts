/**
 * Ajuste "PERMISOS DE COSTOS — EQUIPO COMERCIAL" — POST /api/costos-estructura
 * (crear una estructura de costos) exige `requireEditarCostos`
 * (Administrador o Equipo Comercial), ya no el permiso de BD
 * 'ver_estructura_costos'. GET sigue abierto a cualquier sesión válida
 * (sin cambios, no tenía gate de rol/permiso antes de este ajuste).
 * Prueba contra la implementación REAL de `requireEditarCostos`
 * (importOriginal), nunca una reimplementación paralela del criterio de
 * roles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

let sesionActual: { id: number; usuario: string; email: string; rol: string } | null = {
  id: 1, usuario: 'ana.perez', email: 'ana.perez@grupocolba.com', rol: 'Administrador',
};

vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));
vi.mock('@/lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/authz')>();
  return { ...actual };
});

const createSpy = vi.fn();
const fakePrisma = {
  costoEstructura: {
    async findMany() { return []; },
    async create(args: unknown) { createSpy(args); return { id: 1, ...(args as { data: Record<string, unknown> }).data }; },
  },
};
vi.mock('@/lib/prisma', () => ({ default: fakePrisma }));

function reqPost(body: unknown) {
  return new NextRequest('http://localhost/api/costos-estructura', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function reqGet() {
  return new NextRequest('http://localhost/api/costos-estructura', { method: 'GET' });
}

beforeEach(() => {
  sesionActual = { id: 1, usuario: 'ana.perez', email: 'ana.perez@grupocolba.com', rol: 'Administrador' };
  createSpy.mockReset();
});
afterEach(() => { vi.resetModules(); });

describe('GET /api/costos-estructura — sin gate de rol/permiso (solo sesión)', () => {
  it('cualquier sesión válida (p.ej. Analista Mercadeo) puede listar', async () => {
    sesionActual = { id: 2, usuario: 'm.gomez', email: 'm.gomez@grupocolba.com', rol: 'Analista Mercadeo' };
    const { GET } = await import('./route');
    const res = await GET(reqGet());
    expect(res.status).toBe(200);
  });

  it('sin sesión → 401', async () => {
    sesionActual = null;
    const { GET } = await import('./route');
    const res = await GET(reqGet());
    expect(res.status).toBe(401);
  });
});

describe('POST /api/costos-estructura — requireEditarCostos (Administrador o Equipo Comercial)', () => {
  it.each(['Administrador', 'Director Comercial', 'Coordinador Comercial', 'Analista Comercial', 'Asistente Comercial'])(
    '%s puede crear (200, se llama a create)',
    async (rol) => {
      sesionActual = { id: 1, usuario: 'u', email: 'u@grupocolba.com', rol };
      const { POST } = await import('./route');
      const res = await POST(reqPost({ procesoCodigo: 'P1', cargo: 'ASEADOR' }));
      expect(res.status).toBe(200);
      expect(createSpy).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['Analista Mercadeo', 'Asistente Mercadeo', 'Consulta'])(
    '%s recibe 403 — no puede crear, nunca se llama a create',
    async (rol) => {
      sesionActual = { id: 2, usuario: 'u', email: 'u@grupocolba.com', rol };
      const { POST } = await import('./route');
      const res = await POST(reqPost({ procesoCodigo: 'P1', cargo: 'ASEADOR' }));
      expect(res.status).toBe(403);
      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  it('sin sesión → 401 (no 403), nunca se llama a create', async () => {
    sesionActual = null;
    const { POST } = await import('./route');
    const res = await POST(reqPost({ procesoCodigo: 'P1', cargo: 'ASEADOR' }));
    expect(res.status).toBe(401);
    expect(createSpy).not.toHaveBeenCalled();
  });
});
