import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auditoria: vi.fn() }));
let sesionActual: { id: number; usuario: string; email: string; rol: string } | null = null;
let solicitud: Record<string, unknown> | null = null;

vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));
vi.mock('@/lib/audit', () => ({ auditFromRequest: (...a: unknown[]) => { mocks.auditoria(...a); return Promise.resolve(); } }));
vi.mock('@/lib/prisma', () => ({
  default: {
    solicitud: {
      async findUnique({ where }: { where: { id: number } }) { return solicitud && where.id === solicitud.id ? { ...solicitud } : null; },
      async updateMany({ where, data }: { where: { id: number; nitContacto: unknown }; data: { nitContacto: string } }) {
        if (!solicitud || where.id !== solicitud.id || solicitud.nitContacto !== where.nitContacto) return { count: 0 };
        solicitud = { ...solicitud, ...data };
        return { count: 1 };
      },
    },
  },
}));

const ANA = { id: 1, usuario: 'ana.perez', email: 'ana.perez@grupocolba.com', rol: 'Analista Comercial' };
const req = (body?: unknown) => new NextRequest('http://localhost/api/solicitudes/7/nit-entidad', { method: 'POST', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
const ctx = (id = '7') => ({ params: Promise.resolve({ id }) });
async function llamar(body?: unknown, id?: string) {
  const { POST } = await import('./route');
  const res = await POST(req(body), ctx(id));
  return { res, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  sesionActual = ANA;
  solicitud = { id: 7, nitContacto: null, resultadoFinal: 'Adjudicado', emailRegistro: 'ana.perez@grupocolba.com', usuarioRegistro: 'ana.perez', asignaciones: [], aprobador: null, revisor: null };
  mocks.auditoria.mockReset();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('POST /api/solicitudes/[id]/nit-entidad', () => {
  it('guarda el NIT digitado con DV correcto como «base-DV» y lo audita; nunca consulta fuentes externas', async () => {
    const { res, json } = await llamar({ nit: '900.123.456-8' });
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, nit: '900123456-8' });
    expect(solicitud!.nitContacto).toBe('900123456-8');
    expect(mocks.auditoria.mock.calls[0][2]).toMatchObject({ accion: 'NIT_ENTIDAD_DIGITADO', recursoId: '7', detalle: { nit: '900123456-8', anterior: null } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reemplaza un NIT de antes (sin DV), pero no uno ya verificado', async () => {
    solicitud!.nitContacto = '900087223';
    expect((await llamar({ nit: '900123456-8' })).json).toEqual({ ok: true, nit: '900123456-8' });
    expect(mocks.auditoria.mock.calls[0][2]).toMatchObject({ detalle: { anterior: '900087223' } });

    const otra = await llamar({ nit: '890399010-6' });
    expect(otra.res.status).toBe(409);
    expect(solicitud!.nitContacto).toBe('900123456-8');
  });

  it('rechaza un DV incorrecto o un NIT sin DV, sin escribir', async () => {
    const malo = await llamar({ nit: '900123456-1' });
    expect(malo.res.status).toBe(400);
    expect(malo.json.error).toMatch(/no corresponde/);
    expect((await llamar({ nit: '900123456' })).res.status).toBe(400);
    expect(solicitud!.nitContacto).toBeNull();
  });

  it('solo en procesos adjudicados', async () => {
    solicitud!.resultadoFinal = null;
    expect((await llamar({ nit: '900123456-8' })).res.status).toBe(409);
    expect(solicitud!.nitContacto).toBeNull();
  });

  it('acceso: sin sesión 401, ajeno 403, inexistente 404; Mercadeo no digita', async () => {
    sesionActual = null;
    expect((await llamar({ nit: '900123456-8' })).res.status).toBe(401);
    sesionActual = { id: 2, usuario: 'otro', email: 'otro@grupocolba.com', rol: 'Analista Comercial' };
    expect((await llamar({ nit: '900123456-8' })).res.status).toBe(403);
    sesionActual = ANA;
    expect((await llamar({ nit: '900123456-8' }, '99')).res.status).toBe(404);
    sesionActual = { id: 3, usuario: 'ana.perez', email: 'ana.perez@grupocolba.com', rol: 'Analista Mercadeo' };
    expect((await llamar({ nit: '900123456-8' })).res.status).toBe(403);
  });
});
