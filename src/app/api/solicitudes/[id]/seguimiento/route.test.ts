/**
 * Ajuste "SEGUIMIENTO — MERCADEO" — verifica que `POST /api/solicitudes/[id]/seguimiento`
 * (la autoridad REAL, no la UI) autoriza y persiste correctamente. Mismo
 * patrón de fixture/mock que `route.permisos-alias-fuente.test.ts` — fake
 * Prisma en memoria.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
const COMERCIAL: UsuarioFake = { id: 101, usuario: 'oscar.pallares', email: 'oscar.pallares@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const MERCADEO: UsuarioFake = { id: 201, usuario: 'ana.rios', email: 'ana.rios@grupocolba.com', rol: 'Analista Mercadeo', estado: 'Activo' };
const ASISTENTE_MERCADEO: UsuarioFake = { id: 202, usuario: 'natalia.jimenez', email: 'natalia.jimenez@grupocolba.com', rol: 'Asistente Mercadeo', estado: 'Activo' };
const ADMIN: UsuarioFake = { id: 1, usuario: 'admin1', email: 'admin1@grupocolba.com', rol: 'admin', estado: 'Activo' };

const PUBLICO = 'S1';
const PRIVADO = 'NC';

let solicitud: Record<string, unknown>;
let sesionActual: { id: number; email: string; rol: string; usuario: string };

function resetFixture(aliasFuente: string | null, observacionesSeguimiento: unknown[] = []) {
  solicitud = {
    id: 950, estadoSolicitud: 'En evaluación', resultadoFinal: null, causalCierre: null,
    aliasFuente,
    asignaciones: [],
    observacionesSeguimiento,
  };
  sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
}

const fakeImpl = {
  user: {
    async findUnique({ where }: { where: { id?: number; email?: string } }) {
      const usuarios = [COMERCIAL, MERCADEO, ASISTENTE_MERCADEO, ADMIN];
      if (where.id != null) return usuarios.find((u) => u.id === where.id) ?? null;
      if (where.email != null) return usuarios.find((u) => u.email === where.email) ?? null;
      return null;
    },
  },
  solicitud: {
    async findUnique({ where }: { where: { id: number } }) {
      return where.id === solicitud.id ? JSON.parse(JSON.stringify(solicitud)) : null;
    },
    async update({ where, data }: { where: { id: number }; data: Record<string, unknown> }) {
      if (where.id !== solicitud.id) throw new Error('no encontrada');
      solicitud = { ...solicitud, ...data };
      return JSON.parse(JSON.stringify(solicitud));
    },
  },
  auditLog: { async create({ data }: { data: Record<string, unknown> }) { return { id: 1, ...data }; } },
  async $queryRaw() { return []; },
  async $transaction<T>(cb: (tx: any) => Promise<T>): Promise<T> { return cb(fakeImpl); },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));

function req(body: unknown = {}, method: 'POST' | 'PATCH' | 'DELETE' = 'POST') {
  return new NextRequest('http://localhost/api/solicitudes/950/seguimiento', {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '950' }) }; }

describe('POST /api/solicitudes/[id]/seguimiento — autorización', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('(5) Mercadeo (Analista Mercadeo) + Privado → 200, permitido', async () => {
    resetFixture(PRIVADO);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ texto: 'El cliente informó que la adjudicación se publicará el viernes.' }), ctx());
    expect(res.status).toBe(200);
  });

  it('Asistente Mercadeo + Privado → 200, permitido', async () => {
    resetFixture(PRIVADO);
    sesionActual = { id: ASISTENTE_MERCADEO.id, email: ASISTENTE_MERCADEO.email, rol: ASISTENTE_MERCADEO.rol, usuario: ASISTENTE_MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ texto: 'Se realizó llamada de seguimiento con el cliente.' }), ctx());
    expect(res.status).toBe(200);
  });

  it('Administrador global + Privado → 200, permitido', async () => {
    resetFixture(PRIVADO);
    sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ texto: 'Nota administrativa de seguimiento.' }), ctx());
    expect(res.status).toBe(200);
  });

  it('Administrador global + Público → 200, permitido (conserva privilegios globales)', async () => {
    resetFixture(PUBLICO);
    sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ texto: 'Nota administrativa en un proceso Público.' }), ctx());
    expect(res.status).toBe(200);
  });

  it('(7) Mercadeo + Público → 403, denegado', async () => {
    resetFixture(PUBLICO);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ texto: 'Intento no autorizado.' }), ctx());
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/Público/);
  });

  it('(6) Comercial (no autorizado en absoluto) → 403', async () => {
    resetFixture(PRIVADO);
    sesionActual = { id: COMERCIAL.id, email: COMERCIAL.email, rol: COMERCIAL.rol, usuario: COMERCIAL.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ texto: 'Intento de Comercial.' }), ctx());
    expect(res.status).toBe(403);
  });

  it('Comercial + Público también → 403 (sin excepción)', async () => {
    resetFixture(PUBLICO);
    sesionActual = { id: COMERCIAL.id, email: COMERCIAL.email, rol: COMERCIAL.rol, usuario: COMERCIAL.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ texto: 'Intento de Comercial en Público.' }), ctx());
    expect(res.status).toBe(403);
  });
});

describe('POST /api/solicitudes/[id]/seguimiento — validación del texto (8)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('texto vacío → 400', async () => {
    resetFixture(PRIVADO);
    const { POST } = await import('./route');
    const res = await POST(req({ texto: '' }), ctx());
    expect(res.status).toBe(400);
  });

  it('texto solo espacios → 400', async () => {
    resetFixture(PRIVADO);
    const { POST } = await import('./route');
    const res = await POST(req({ texto: '   ' }), ctx());
    expect(res.status).toBe(400);
  });

  it('texto ausente → 400', async () => {
    resetFixture(PRIVADO);
    const { POST } = await import('./route');
    const res = await POST(req({}), ctx());
    expect(res.status).toBe(400);
  });

  it('texto que excede el máximo (2000) → 400', async () => {
    resetFixture(PRIVADO);
    const { POST } = await import('./route');
    const res = await POST(req({ texto: 'a'.repeat(2001) }), ctx());
    expect(res.status).toBe(400);
  });

  it('campo no permitido en el body → 400', async () => {
    resetFixture(PRIVADO);
    const { POST } = await import('./route');
    const res = await POST(req({ texto: 'válido', rol: 'Administrador' }), ctx());
    expect(res.status).toBe(400);
  });
});

describe('POST /api/solicitudes/[id]/seguimiento — persistencia (7, 9)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('creadoPor/rol/creadoEn se reconstruyen del backend, NUNCA del body', async () => {
    resetFixture(PRIVADO);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ texto: 'Anotación real.' }), ctx());
    const data = await res.json();
    expect(data.anotacion.creadoPor).toBe('ana.rios');
    expect(data.anotacion.rol).toBe('Analista Mercadeo');
    expect(typeof data.anotacion.creadoEn).toBe('string');
    expect(data.anotacion.texto).toBe('Anotación real.');
    expect(typeof data.anotacion.id).toBe('string');
  });

  it('dos anotaciones sucesivas se ACUMULAN, nunca se reemplaza la anterior', async () => {
    resetFixture(PRIVADO);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    await POST(req({ texto: 'Primera anotación.' }), ctx());
    const res2 = await POST(req({ texto: 'Segunda anotación.' }), ctx());
    const data2 = await res2.json();
    expect(data2.observacionesSeguimiento.length).toBe(2);
    const textos = data2.observacionesSeguimiento.map((a: { texto: string }) => a.texto);
    expect(textos).toContain('Primera anotación.');
    expect(textos).toContain('Segunda anotación.');
  });

  it('respuesta ordena MÁS RECIENTE PRIMERO', async () => {
    resetFixture(PRIVADO, [{ id: 'a1', texto: 'vieja', creadoEn: '2026-08-01 08:00:00', creadoPor: 'x', rol: 'Analista Mercadeo' }]);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ texto: 'nueva' }), ctx());
    const data = await res.json();
    expect(data.observacionesSeguimiento[0].texto).toBe('nueva');
    expect(data.observacionesSeguimiento[1].texto).toBe('vieja');
  });

  it('proceso histórico con observacionesSeguimiento=[] no rompe — primera anotación se agrega sin error (11)', async () => {
    resetFixture(PRIVADO, []);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ texto: 'Primera anotación de este proceso.' }), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.observacionesSeguimiento.length).toBe(1);
  });

  it('proceso inexistente → 404', async () => {
    resetFixture(PRIVADO);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ texto: 'x' }), { params: Promise.resolve({ id: '999999' }) });
    expect(res.status).toBe(404);
  });
});

describe('POST — numeración estable (numero)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('primera anotación de un proceso recibe numero=1', async () => {
    resetFixture(PRIVADO, []);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ texto: 'primera' }), ctx());
    const data = await res.json();
    expect(data.anotacion.numero).toBe(1);
  });

  it('anotaciones sucesivas incrementan numero: 1, 2, 3', async () => {
    resetFixture(PRIVADO, []);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const r1 = await (await POST(req({ texto: 'uno' }), ctx())).json();
    const r2 = await (await POST(req({ texto: 'dos' }), ctx())).json();
    const r3 = await (await POST(req({ texto: 'tres' }), ctx())).json();
    expect(r1.anotacion.numero).toBe(1);
    expect(r2.anotacion.numero).toBe(2);
    expect(r3.anotacion.numero).toBe(3);
  });
});

describe('PATCH /api/solicitudes/[id]/seguimiento — editar', () => {
  beforeEach(() => vi.restoreAllMocks());

  function fixtureConTres() {
    resetFixture(PRIVADO, [
      { id: 'a1', numero: 1, texto: 'primera', creadoEn: '2026-08-23 08:00:00', creadoPor: 'ana.rios', rol: 'Analista Mercadeo' },
      { id: 'a2', numero: 2, texto: 'segunda', creadoEn: '2026-08-24 08:00:00', creadoPor: 'ana.rios', rol: 'Analista Mercadeo' },
      { id: 'a3', numero: 3, texto: 'tercera', creadoEn: '2026-08-25 08:00:00', creadoPor: 'natalia.jimenez', rol: 'Asistente Mercadeo' },
    ]);
  }

  it('Mercadeo + Privado → 200, edita el texto, conserva numero/creadoEn/creadoPor', async () => {
    fixtureConTres();
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ id: 'a2', texto: 'segunda editada' }, 'PATCH'), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    const editada = data.observacionesSeguimiento.find((a: Record<string, unknown>) => a.id === 'a2');
    expect(editada.texto).toBe('segunda editada');
    expect(editada.numero).toBe(2);
    expect(editada.creadoEn).toBe('2026-08-24 08:00:00');
    expect(editada.creadoPor).toBe('ana.rios');
  });

  it('agrega actualizadoEn/actualizadoPor desde la sesión real (nunca del body)', async () => {
    fixtureConTres();
    sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ id: 'a1', texto: 'editada por admin' }, 'PATCH'), ctx());
    const data = await res.json();
    const editada = data.observacionesSeguimiento.find((a: Record<string, unknown>) => a.id === 'a1');
    expect(editada.actualizadoPor).toBe('admin1');
    expect(typeof editada.actualizadoEn).toBe('string');
  });

  it('las demás anotaciones no se modifican al editar una', async () => {
    fixtureConTres();
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ id: 'a2', texto: 'segunda editada' }, 'PATCH'), ctx());
    const data = await res.json();
    const a1 = data.observacionesSeguimiento.find((a: Record<string, unknown>) => a.id === 'a1');
    const a3 = data.observacionesSeguimiento.find((a: Record<string, unknown>) => a.id === 'a3');
    expect(a1.texto).toBe('primera');
    expect(a3.texto).toBe('tercera');
  });

  it('Comercial → 403, no edita', async () => {
    fixtureConTres();
    sesionActual = { id: COMERCIAL.id, email: COMERCIAL.email, rol: COMERCIAL.rol, usuario: COMERCIAL.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ id: 'a1', texto: 'intento no autorizado' }, 'PATCH'), ctx());
    expect(res.status).toBe(403);
  });

  it('Mercadeo + Público → 403', async () => {
    resetFixture(PUBLICO, [{ id: 'a1', numero: 1, texto: 'primera', creadoEn: '2026-08-23 08:00:00', creadoPor: 'ana.rios', rol: 'Analista Mercadeo' }]);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ id: 'a1', texto: 'intento' }, 'PATCH'), ctx());
    expect(res.status).toBe(403);
  });

  it('texto vacío → 400', async () => {
    fixtureConTres();
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ id: 'a1', texto: '' }, 'PATCH'), ctx());
    expect(res.status).toBe(400);
  });

  it('id inexistente → 404', async () => {
    fixtureConTres();
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ id: 'no-existe', texto: 'x' }, 'PATCH'), ctx());
    expect(res.status).toBe(404);
  });

  it('campo no permitido en el body → 400', async () => {
    fixtureConTres();
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ id: 'a1', texto: 'x', numero: 99 }, 'PATCH'), ctx());
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/solicitudes/[id]/seguimiento — eliminar (9: no renumera las demás)', () => {
  beforeEach(() => vi.restoreAllMocks());

  function fixtureConTres() {
    resetFixture(PRIVADO, [
      { id: 'a1', numero: 1, texto: 'primera', creadoEn: '2026-08-23 08:00:00', creadoPor: 'ana.rios', rol: 'Analista Mercadeo' },
      { id: 'a2', numero: 2, texto: 'segunda', creadoEn: '2026-08-24 08:00:00', creadoPor: 'ana.rios', rol: 'Analista Mercadeo' },
      { id: 'a3', numero: 3, texto: 'tercera', creadoEn: '2026-08-25 08:00:00', creadoPor: 'natalia.jimenez', rol: 'Asistente Mercadeo' },
    ]);
  }

  it('Mercadeo + Privado → 200, elimina la anotación indicada', async () => {
    fixtureConTres();
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { DELETE } = await import('./route');
    const res = await DELETE(req({ id: 'a2' }, 'DELETE'), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.observacionesSeguimiento.length).toBe(2);
    expect(data.observacionesSeguimiento.find((a: Record<string, unknown>) => a.id === 'a2')).toBeUndefined();
  });

  it('eliminar la anotación 2 de 3 NO renumera: quedan numero 1 y 3 (nunca 1 y 2)', async () => {
    fixtureConTres();
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { DELETE } = await import('./route');
    const res = await DELETE(req({ id: 'a2' }, 'DELETE'), ctx());
    const data = await res.json();
    const numeros = data.observacionesSeguimiento.map((a: Record<string, unknown>) => a.numero).sort();
    expect(numeros).toEqual([1, 3]);
  });

  it('una anotación nueva después de eliminar la 3 (la más alta) recibe numero=4, nunca reutiliza el 3', async () => {
    fixtureConTres();
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { DELETE, } = await import('./route');
    await DELETE(req({ id: 'a3' }, 'DELETE'), ctx());
    const { POST } = await import('./route');
    const res = await POST(req({ texto: 'nueva tras eliminar' }), ctx());
    const data = await res.json();
    expect(data.anotacion.numero).toBe(4);
  });

  it('Comercial → 403, no elimina', async () => {
    fixtureConTres();
    sesionActual = { id: COMERCIAL.id, email: COMERCIAL.email, rol: COMERCIAL.rol, usuario: COMERCIAL.usuario };
    const { DELETE } = await import('./route');
    const res = await DELETE(req({ id: 'a1' }, 'DELETE'), ctx());
    expect(res.status).toBe(403);
  });

  it('Mercadeo + Público → 403', async () => {
    resetFixture(PUBLICO, [{ id: 'a1', numero: 1, texto: 'primera', creadoEn: '2026-08-23 08:00:00', creadoPor: 'ana.rios', rol: 'Analista Mercadeo' }]);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { DELETE } = await import('./route');
    const res = await DELETE(req({ id: 'a1' }, 'DELETE'), ctx());
    expect(res.status).toBe(403);
  });

  it('id inexistente → 404', async () => {
    fixtureConTres();
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { DELETE } = await import('./route');
    const res = await DELETE(req({ id: 'no-existe' }, 'DELETE'), ctx());
    expect(res.status).toBe(404);
  });

  it('Administrador global también puede eliminar', async () => {
    fixtureConTres();
    sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
    const { DELETE } = await import('./route');
    const res = await DELETE(req({ id: 'a1' }, 'DELETE'), ctx());
    expect(res.status).toBe(200);
  });

  it('eliminar la misma anotación dos veces → la segunda vez 404 (ya está activo:false, no un soft-delete duplicado)', async () => {
    fixtureConTres();
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { DELETE } = await import('./route');
    const res1 = await DELETE(req({ id: 'a1' }, 'DELETE'), ctx());
    expect(res1.status).toBe(200);
    const res2 = await DELETE(req({ id: 'a1' }, 'DELETE'), ctx());
    expect(res2.status).toBe(404);
  });

  it('editar una anotación ya eliminada → 404, nunca la "revive"', async () => {
    fixtureConTres();
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { DELETE, PATCH } = await import('./route');
    await DELETE(req({ id: 'a1' }, 'DELETE'), ctx());
    const res = await PATCH(req({ id: 'a1', texto: 'intento de revivir' }, 'PATCH'), ctx());
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ajuste "REVISIÓN FINAL — NUMERACIÓN ESTABLE" — secuencia completa
// end-to-end contra los handlers reales (POST/PATCH/DELETE), reproduciendo
// EXACTAMENTE el escenario de verificación pedido:
//   1º→numero 1, 2º→numero 2, eliminar 2ª (activo:false),
//   crear 3ª→numero 3 (nunca reutiliza 2), eliminar 1ª (no renumera 3ª),
//   listado visible filtra activo:false, orden más reciente primero
//   nunca altera numero, editar eliminada → denegado,
//   eliminar dos veces → denegado.
// ═══════════════════════════════════════════════════════════════════════
describe('Secuencia completa — numeración estable end-to-end', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('reproduce la secuencia completa de verificación, paso a paso', async () => {
    resetFixture(PRIVADO, []);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST, PATCH, DELETE } = await import('./route');

    // 1) primera observación → numero 1
    const r1 = await (await POST(req({ texto: 'primera' }), ctx())).json();
    expect(r1.anotacion.numero).toBe(1);
    const id1 = r1.anotacion.id;

    // 2) segunda → numero 2
    const r2 = await (await POST(req({ texto: 'segunda' }), ctx())).json();
    expect(r2.anotacion.numero).toBe(2);
    const id2 = r2.anotacion.id;
    // en este punto ambas visibles, más reciente (2) primero
    expect(r2.observacionesSeguimiento.map((a: Record<string, unknown>) => a.numero)).toEqual([2, 1]);

    // 3) eliminar la 2ª → queda activo:false (soft delete), 200
    const resDel2 = await DELETE(req({ id: id2 }, 'DELETE'), ctx());
    expect(resDel2.status).toBe(200);
    const dataDel2 = await resDel2.json();
    // el listado visible YA filtra activo:false — solo queda la 1ª
    expect(dataDel2.observacionesSeguimiento.map((a: Record<string, unknown>) => a.numero)).toEqual([1]);

    // 4) crear otra → numero 3, NUNCA reutiliza 2
    const r3 = await (await POST(req({ texto: 'tercera' }), ctx())).json();
    expect(r3.anotacion.numero).toBe(3);
    const id3 = r3.anotacion.id;
    // visibles ahora: 3 y 1 (nunca 2, sigue soft-eliminada)
    expect(r3.observacionesSeguimiento.map((a: Record<string, unknown>) => a.numero).sort()).toEqual([1, 3]);

    // 5) eliminar la 1ª → NO renumera la 3ª (sigue siendo 3, no pasa a 2)
    const resDel1 = await DELETE(req({ id: id1 }, 'DELETE'), ctx());
    const dataDel1 = await resDel1.json();
    expect(dataDel1.observacionesSeguimiento.map((a: Record<string, unknown>) => a.numero)).toEqual([3]);

    // 6) listado visible filtra activo:false — confirmado en cada paso
    // anterior (2 y 1 nunca reaparecen en observacionesSeguimiento tras eliminarse).

    // 7) ordenar más reciente primero no altera numero — ya verificado en
    // el paso 2 (el orden [2,1] refleja los numero reales, no los muta).

    // 8) editar una observación eliminada (la 2ª) → denegado (404)
    const resEditEliminada = await PATCH(req({ id: id2, texto: 'intento de editar eliminada' }, 'PATCH'), ctx());
    expect(resEditEliminada.status).toBe(404);

    // 9) eliminar dos veces la misma (la 1ª, ya eliminada en el paso 5) → denegado (404)
    const resDelDoble = await DELETE(req({ id: id1 }, 'DELETE'), ctx());
    expect(resDelDoble.status).toBe(404);

    // Verificación final: la 3ª (activa) sí se puede editar normalmente.
    const resEditActiva = await PATCH(req({ id: id3, texto: 'tercera editada' }, 'PATCH'), ctx());
    expect(resEditActiva.status).toBe(200);
    const dataEditActiva = await resEditActiva.json();
    const anotFinal = dataEditActiva.observacionesSeguimiento.find((a: Record<string, unknown>) => a.id === id3);
    expect(anotFinal.texto).toBe('tercera editada');
    expect(anotFinal.numero).toBe(3); // numero conservado tras editar
  });
});
