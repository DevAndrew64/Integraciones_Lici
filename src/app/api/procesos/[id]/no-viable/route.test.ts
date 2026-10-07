/**
 * Ajuste "Director Comercial y Coordinador Comercial como administradores
 * funcionales de TODO el módulo Procesos" — PATCH /api/procesos/[id]/no-viable
 * debe autorizar a ambos roles directamente (esAdministradorProcesos),
 * independientemente de la configuración de PerfilRol en BD, y seguir
 * exigiendo el permiso funcional para cualquier otro rol.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
const ANALISTA: UsuarioFake = { id: 101, usuario: 'oscar.pallares', email: 'oscar.pallares@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const DIRECTOR: UsuarioFake = { id: 6, usuario: 'ricardo.mejia', email: 'ricardo.mejia@grupocolba.com', rol: 'Director Comercial', estado: 'Activo' };
const COORDINADOR: UsuarioFake = { id: 5, usuario: 'laura.buelvas', email: 'laura.buelvas@grupocolba.com', rol: 'Coordinador Comercial', estado: 'Activo' };
const ANALISTA_INACTIVO: UsuarioFake = { ...ANALISTA, estado: 'Inactivo' };

let usuarios: UsuarioFake[] = [ANALISTA, DIRECTOR, COORDINADOR];
let proceso: Record<string, unknown>;
let sesionActual: { id: number; email: string; rol: string; usuario: string } | null;

function resetFixture() {
  usuarios = [ANALISTA, DIRECTOR, COORDINADOR];
  proceso = { id: 55, codigoProceso: 'P-055', noViable: false, observacionNoViable: null };
  sesionActual = { id: DIRECTOR.id, email: DIRECTOR.email, rol: DIRECTOR.rol, usuario: DIRECTOR.usuario };
}

const fakeImpl = {
  user: {
    async findUnique({ where }: { where: { id?: number; email?: string } }) {
      if (where.id != null) return usuarios.find((u) => u.id === where.id) ?? null;
      if (where.email != null) return usuarios.find((u) => u.email === where.email) ?? null;
      return null;
    },
  },
  perfilRol: {
    // Ningún PerfilRol configurado en BD para este fixture — solo se llega
    // aquí para roles que NO son esAdministradorProcesos.
    async findFirst() { return null; },
  },
  proceso: {
    async findUnique({ where }: { where: { id: number } }) {
      return where.id === proceso.id ? { ...proceso } : null;
    },
    async update({ where, data }: { where: { id: number }; data: Record<string, unknown> }) {
      if (where.id !== proceso.id) throw new Error('no encontrado');
      proceso = { ...proceso, ...data };
      return { ...proceso };
    },
  },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));
vi.mock('@/lib/audit', () => ({ auditFromRequest: () => {} }));

function req(body: unknown) {
  return new NextRequest('http://localhost/api/procesos/55/no-viable', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '55' }) }; }

beforeEach(() => { vi.resetModules(); resetFixture(); });

describe('PATCH /api/procesos/[id]/no-viable', () => {
  it('Director Comercial marca cualquier proceso como no viable: permitido', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ noViable: true, observacionNoViable: 'Sin cumplir requisitos' }), ctx());
    expect(res.status).toBe(200);
    expect(proceso.noViable).toBe(true);
  });

  it('Coordinador Comercial marca cualquier proceso como no viable: permitido', async () => {
    sesionActual = { id: COORDINADOR.id, email: COORDINADOR.email, rol: COORDINADOR.rol, usuario: COORDINADOR.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ noViable: true, observacionNoViable: 'Sin cumplir requisitos' }), ctx());
    expect(res.status).toBe(200);
  });

  it('Analista Comercial sin permiso funcional en BD: denegado (403)', async () => {
    sesionActual = { id: ANALISTA.id, email: ANALISTA.email, rol: ANALISTA.rol, usuario: ANALISTA.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ noViable: true, observacionNoViable: 'x' }), ctx());
    expect(res.status).toBe(403);
    expect(proceso.noViable).toBe(false);
  });

  it('usuario inactivo: 403 aunque conserve una cookie válida', async () => {
    usuarios = [ANALISTA_INACTIVO, DIRECTOR, COORDINADOR];
    sesionActual = { id: ANALISTA_INACTIVO.id, email: ANALISTA_INACTIVO.email, rol: ANALISTA_INACTIVO.rol, usuario: ANALISTA_INACTIVO.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ noViable: true, observacionNoViable: 'x' }), ctx());
    expect(res.status).toBe(403);
  });

  it('usuario sin sesión: 401', async () => {
    sesionActual = null;
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ noViable: true, observacionNoViable: 'x' }), ctx());
    expect(res.status).toBe(401);
  });

  it('Director Comercial revierte "no viable": permitido', async () => {
    proceso.noViable = true;
    proceso.observacionNoViable = 'Antes';
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ noViable: false }), ctx());
    expect(res.status).toBe(200);
    expect(proceso.noViable).toBe(false);
  });
});