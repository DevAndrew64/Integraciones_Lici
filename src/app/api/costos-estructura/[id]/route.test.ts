/**
 * Ajuste "NO_APLICA EN 4 MÓDULOS" — el backend de PUT /api/costos-estructura/[id]
 * debe validar `body.estado` en RUNTIME (nunca solo un cast de TypeScript):
 * acepta NO_INICIADO/EN_PROGRESO/COMPLETADO/NO_APLICA, rechaza con 400
 * cualquier otro valor, y conserva EN_PROGRESO como default cuando el
 * campo viene ausente — sin exponer detalles internos en ningún error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Ajuste "PERMISOS DE COSTOS — EQUIPO COMERCIAL" — PUT ahora exige
// `requireEditarCostos` (Administrador o Equipo Comercial), ya no el
// permiso de BD 'ver_estructura_costos'. Estas pruebas de validación de
// NO_APLICA/estado usan un rol de Equipo Comercial (autorizado) por
// defecto; el gate de permiso en sí se prueba aparte, más abajo, contra la
// implementación REAL de `requireEditarCostos` (importOriginal, nunca una
// reimplementación paralela del criterio de roles).
let sesionActual: { id: number; usuario: string; email: string; rol: string } | null = {
  id: 1, usuario: 'ana.perez', email: 'ana.perez@grupocolba.com', rol: 'Analista Comercial',
};
let permisoConcedido = true;

vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));
vi.mock('@/lib/authz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/authz')>();
  return {
    ...actual,
    requireSession: (session: unknown) => (session ? null : { status: 401 }),
    requireAdmin: (session: unknown) => (session ? null : { status: 401 }),
    hasPermiso: async () => permisoConcedido,
  };
});

let registro: { id: number; datos: Record<string, unknown> };

const fakePrisma = {
  costoEstructura: {
    async findUnique({ where }: { where: { id: number } }) {
      return where.id === registro.id ? { ...registro } : null;
    },
    async update({ where, data }: { where: { id: number }; data: Record<string, unknown> }) {
      if (where.id !== registro.id) throw new Error('no encontrado');
      registro = { ...registro, ...data };
      return { ...registro };
    },
  },
};
vi.mock('@/lib/prisma', () => ({ default: fakePrisma }));

function req(body: unknown) {
  return new NextRequest('http://localhost/api/costos-estructura/1', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '1' }) }; }

beforeEach(() => {
  sesionActual = { id: 1, usuario: 'ana.perez', email: 'ana.perez@grupocolba.com', rol: 'Analista Comercial' };
  permisoConcedido = true;
  registro = { id: 1, datos: { version: 2, modulos: {} } };
});

afterEach(() => {
  vi.resetModules();
});

describe('PUT /api/costos-estructura/[id] — validación runtime de estado (NO_APLICA)', () => {
  it('acepta NO_APLICA y lo persiste sin transformarlo', async () => {
    const { PUT } = await import('./route');
    const res = await PUT(req({ modulo: 'dotacionEpp', estado: 'NO_APLICA', datos: {} }), ctx());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.modulo.estado).toBe('NO_APLICA');
  });

  it.each(['NO_INICIADO', 'EN_PROGRESO'])('acepta el estado real %s con datos vacíos (guardado parcial, nunca exige datos completos)', async (estado) => {
    const { PUT } = await import('./route');
    const res = await PUT(req({ modulo: 'examenesMedicos', estado, datos: {} }), ctx());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.modulo.estado).toBe(estado);
  });

  it('acepta COMPLETADO cuando el módulo SÍ tiene información mínima real', async () => {
    const { PUT } = await import('./route');
    const res = await PUT(req({ modulo: 'examenesMedicos', estado: 'COMPLETADO', datos: { examRows: [{ cant: 1, valor: 50000 }] } }), ctx());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.modulo.estado).toBe('COMPLETADO');
  });

  // Ajuste "IMPEDIR COMPLETADO FALSO" — COMPLETADO exige información
  // mínima real en los 4 módulos con NO_APLICA; NO_APLICA sigue
  // permitiéndose sin datos (decisión explícita, nunca inferida).
  it.each([
    ['dotacionEpp', {}],
    ['dotacionEpp', { dotGroups: [] }],
    ['dotacionEpp', { dotGroups: [{ id: 1, rows: [] }] }],
    ['examenesMedicos', {}],
    ['examenesMedicos', { examRows: [], cursosRows: [], vacunasRows: [] }],
    ['insumos', {}],
    ['insumos', { insumosRows: [] }],
    ['maquinariaEquipos', {}],
    ['maquinariaEquipos', { maqRows: [] }],
  ])('rechaza COMPLETADO sin información real — %s con datos %j', async (modulo, datos) => {
    const { PUT } = await import('./route');
    const res = await PUT(req({ modulo, estado: 'COMPLETADO', datos }), ctx());
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toBe('No es posible marcar el módulo como completado porque no contiene información válida.');
  });

  it.each([
    ['dotacionEpp', { dotGroups: [{ id: 1, rows: [{ id: 1, codigo: 'X' }] }] }],
    ['examenesMedicos', { examRows: [{ cant: 1, valor: 1000 }] }],
    ['examenesMedicos', { cursosRows: [{ cant: 1, valor: 1000 }] }],
    ['examenesMedicos', { vacunasRows: [{ cant: 1, valor: 1000 }] }],
    ['insumos', { insumosRows: [{ id: 1, codigo: 'X' }] }],
    ['maquinariaEquipos', { maqRows: [{ id: 1 }] }],
  ])('acepta COMPLETADO cuando SÍ hay información real — %s', async (modulo, datos) => {
    const { PUT } = await import('./route');
    const res = await PUT(req({ modulo, estado: 'COMPLETADO', datos }), ctx());
    expect(res.status).toBe(200);
  });

  it('NO_APLICA con datos completamente vacíos sigue siendo válido (decisión explícita, nunca exige información)', async () => {
    const { PUT } = await import('./route');
    const res = await PUT(req({ modulo: 'maquinariaEquipos', estado: 'NO_APLICA', datos: {} }), ctx());
    expect(res.status).toBe(200);
  });

  it('la validación de COMPLETADO nunca aplica a manoObra/turnantes/costosAdministrativos (fuera de la regla de los 4 módulos)', async () => {
    const { PUT } = await import('./route');
    const res = await PUT(req({ modulo: 'manoObra', estado: 'COMPLETADO', datos: {} }), ctx());
    expect(res.status).toBe(200);
  });

  it('rechaza con 400 un estado arbitrario — nunca lo persiste', async () => {
    const { PUT } = await import('./route');
    const res = await PUT(req({ modulo: 'insumos', estado: 'CUALQUIER_COSA', datos: {} }), ctx());
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(registro.datos).toEqual({ version: 2, modulos: {} }); // no se escribió nada
  });

  it('rechaza con 400 estados que ya no existen en el dominio (p.ej. valores heredados de otra versión)', async () => {
    const { PUT } = await import('./route');
    const res = await PUT(req({ modulo: 'maquinariaEquipos', estado: 'PENDIENTE', datos: {} }), ctx());
    expect(res.status).toBe(400);
  });

  it('estado ausente conserva el default histórico EN_PROGRESO (compatibilidad, nunca se asume NO_APLICA)', async () => {
    const { PUT } = await import('./route');
    const res = await PUT(req({ modulo: 'dotacionEpp', datos: {} }), ctx());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.modulo.estado).toBe('EN_PROGRESO');
  });

  it('estado null se trata igual que ausente (EN_PROGRESO), nunca se persiste "null" como estado', async () => {
    const { PUT } = await import('./route');
    const res = await PUT(req({ modulo: 'dotacionEpp', estado: null, datos: {} }), ctx());
    const data = await res.json();
    expect(data.modulo.estado).toBe('EN_PROGRESO');
  });

  it('el mensaje de error de estado inválido nunca expone detalles internos (stack, Prisma, etc.) — solo el valor recibido', async () => {
    const { PUT } = await import('./route');
    const res = await PUT(req({ modulo: 'insumos', estado: 'HACKEADO', datos: {} }), ctx());
    const data = await res.json();
    expect(data.error).toBe('Estado inválido: HACKEADO');
    expect(data.error).not.toMatch(/prisma|stack|at Object/i);
  });

  it('marcar NO_APLICA con datos existentes conserva `datos` (fusionarModulo real, nunca se descarta)', async () => {
    registro = { id: 1, datos: { version: 2, modulos: { dotacionEpp: { estado: 'COMPLETADO', datos: { dotGroups: [{ id: 1, rows: [{ id: 1 }] }] }, ultimaActualizacion: 't0', actualizadoPor: 'x' } } } };
    const { PUT } = await import('./route');
    const res = await PUT(req({ modulo: 'dotacionEpp', estado: 'NO_APLICA', datos: { dotGroups: [{ id: 1, rows: [{ id: 1 }] }] } }), ctx());
    const data = await res.json();
    expect(data.modulo.estado).toBe('NO_APLICA');
    expect(data.modulo.datos).toEqual({ dotGroups: [{ id: 1, rows: [{ id: 1 }] }] });
  });
});

// Ajuste "PERMISOS DE COSTOS — EQUIPO COMERCIAL" — reemplaza el gate
// anterior basado en 'ver_estructura_costos' por `requireEditarCostos`
// (Administrador o Equipo Comercial). Contra la implementación REAL
// (importOriginal arriba), nunca un mock que reimplemente el criterio.
describe('PUT /api/costos-estructura/[id] — permiso de edición (requireEditarCostos)', () => {
  it.each(['Administrador', 'Director Comercial', 'Coordinador Comercial', 'Analista Comercial', 'Asistente Comercial'])(
    '%s puede guardar (llega hasta la validación de negocio, no lo bloquea el gate de permiso)',
    async (rol) => {
      sesionActual = { id: 1, usuario: 'u', email: 'u@grupocolba.com', rol };
      const { PUT } = await import('./route');
      const res = await PUT(req({ modulo: 'manoObra', estado: 'EN_PROGRESO', datos: {} }), ctx());
      expect(res.status).toBe(200);
    },
  );

  it.each(['Analista Mercadeo', 'Asistente Mercadeo', 'Consulta'])(
    '%s recibe 403 — no puede guardar/editar Costos',
    async (rol) => {
      sesionActual = { id: 1, usuario: 'u', email: 'u@grupocolba.com', rol };
      const { PUT } = await import('./route');
      const res = await PUT(req({ modulo: 'manoObra', estado: 'EN_PROGRESO', datos: {} }), ctx());
      expect(res.status).toBe(403);
    },
  );

  it('sin sesión → 401 (no 403)', async () => {
    sesionActual = null;
    const { PUT } = await import('./route');
    const res = await PUT(req({ modulo: 'manoObra', estado: 'EN_PROGRESO', datos: {} }), ctx());
    expect(res.status).toBe(401);
  });
});
