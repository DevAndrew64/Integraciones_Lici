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
      async updateMany({ where, data }: { where: { id: number; OR: Record<string, unknown>[] }; data: { nitContacto: string } }) {
        if (!solicitud || where.id !== solicitud.id || (solicitud.nitContacto !== null && solicitud.nitContacto !== '')) return { count: 0 };
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
  solicitud = { id: 7, nitContacto: null, entidad: 'COLEGIO VEINTIUN ANGELES', codigoProceso: 'P.31-2026', aliasFuente: 'S2', linkSecop: null, emailRegistro: 'ana.perez@grupocolba.com', usuarioRegistro: 'ana.perez', asignaciones: [], aprobador: null, revisor: null };
  mocks.auditoria.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ nit_entidad: '830037739' }] })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('POST /api/solicitudes/[id]/nit-entidad', () => {
  it('sin NIT lo trae de SECOP, lo guarda y lo audita', async () => {
    const { res, json } = await llamar();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ ok: true, nit: '830037739', origen: 'secop', fuente: 'SECOP II', criterio: 'proceso' });
    expect(solicitud!.nitContacto).toBe('830037739');
    expect(mocks.auditoria.mock.calls[0][2]).toMatchObject({ accion: 'NIT_ENTIDAD_SECOP', recursoId: '7' });
  });

  it('con NIT no consulta SECOP; si la fuente no lo trae responde no_disponible sin escribir', async () => {
    solicitud!.nitContacto = '900123456';
    expect((await llamar()).json).toMatchObject({ ok: true, nit: '900123456', origen: 'existente' });
    expect(fetch).not.toHaveBeenCalled();

    solicitud = { ...solicitud!, nitContacto: null, aliasFuente: 'NC' };
    expect((await llamar()).json).toMatchObject({ ok: true, nit: null, origen: 'no_disponible' });
    expect(solicitud!.nitContacto).toBeNull();
  });

  it('el NIT digitado se guarda como base (sin puntos ni DV), solo si aún no hay; formato inválido 400', async () => {
    solicitud!.aliasFuente = 'NC';
    expect((await llamar({ nit: '860.026.123-0' })).json).toMatchObject({ ok: true, nit: '860026123', origen: 'digitado' });
    expect(solicitud!.nitContacto).toBe('860026123');
    expect(mocks.auditoria.mock.calls[0][2]).toMatchObject({ accion: 'NIT_ENTIDAD_DIGITADO' });

    const otra = await llamar({ nit: '900111222' });
    expect(otra.res.status).toBe(409);
    expect(solicitud!.nitContacto, 'nunca pisa un NIT existente').toBe('860026123');

    solicitud!.nitContacto = null;
    expect((await llamar({ nit: '12-AB' })).res.status).toBe(400);
  });

  it('acceso: sin sesión 401, ajeno 403, inexistente 404; Mercadeo no digita', async () => {
    sesionActual = null;
    expect((await llamar()).res.status).toBe(401);
    sesionActual = { id: 2, usuario: 'otro', email: 'otro@grupocolba.com', rol: 'Analista Comercial' };
    expect((await llamar()).res.status).toBe(403);
    sesionActual = ANA;
    expect((await llamar(undefined, '99')).res.status).toBe(404);
    sesionActual = { id: 3, usuario: 'ana.perez', email: 'ana.perez@grupocolba.com', rol: 'Analista Mercadeo' };
    expect((await llamar({ nit: '860026123' })).res.status).toBe(403);
  });
});
