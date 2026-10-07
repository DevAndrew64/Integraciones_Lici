/**
 * Integración real de POST /api/solicitudes/[id]/observaciones — llama al
 * handler exportado tal cual, con `@/lib/prisma`/`@/lib/session` mockeados.
 * Caso base: reproduce, con datos ficticios equivalentes, la Solicitud 217
 * real (oscar.pallares primero, nicole.ortiz segunda) sin tocar la BD real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
const OSCAR: UsuarioFake = { id: 101, usuario: 'oscar.pallares', email: 'oscar.pallares@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const NICOLE: UsuarioFake = { id: 102, usuario: 'nicole.ortiz', email: 'nicole.ortiz@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const NICOLE_INACTIVA: UsuarioFake = { ...NICOLE, estado: 'Inactivo' };
const ADMIN: UsuarioFake = { id: 1, usuario: 'admin1', email: 'admin1@grupocolba.com', rol: 'admin', estado: 'Activo' };
const DIRECTOR: UsuarioFake = { id: 6, usuario: 'ricardo.mejia', email: 'ricardo.mejia@grupocolba.com', rol: 'Director Comercial', estado: 'Activo' };
const COORDINADOR: UsuarioFake = { id: 5, usuario: 'laura.buelvas', email: 'laura.buelvas@grupocolba.com', rol: 'Coordinador Comercial', estado: 'Activo' };

let usuarios: UsuarioFake[] = [OSCAR, NICOLE];
let solicitud: Record<string, unknown>;
let auditLogs: Array<Record<string, unknown>> = [];
let sesionActual: { id: number; email: string; rol: string; usuario: string } = { id: OSCAR.id, email: OSCAR.email, rol: OSCAR.rol, usuario: OSCAR.usuario };

function resetFixture() {
  usuarios = [OSCAR, NICOLE];
  solicitud = {
    id: 217, estadoSolicitud: 'En evaluación',
    asignaciones: [
      { idAsignacion: 'ASG-1', analistaAsignado: 'oscar.pallares', asignadoPor: 'laura.buelvas', observaciones: [] },
      { idAsignacion: 'ASG-2', analistaAsignado: 'nicole.ortiz', asignadoPor: 'laura.buelvas', observaciones: [] },
    ],
  };
  auditLogs = [];
  sesionActual = { id: OSCAR.id, email: OSCAR.email, rol: OSCAR.rol, usuario: OSCAR.usuario };
}

const fakeImpl = {
  user: {
    async findUnique({ where }: { where: { id?: number; email?: string } }) {
      if (where.id != null) return usuarios.find((u) => u.id === where.id) ?? null;
      if (where.email != null) return usuarios.find((u) => u.email === where.email) ?? null;
      return null;
    },
  },
  solicitud: {
    async findUnique({ where }: { where: { id: number } }) {
      return where.id === solicitud.id ? { ...solicitud, asignaciones: JSON.parse(JSON.stringify(solicitud.asignaciones)) } : null;
    },
    async update({ where, data }: { where: { id: number }; data: Record<string, unknown> }) {
      if (where.id !== solicitud.id) throw new Error('no encontrada');
      solicitud = { ...solicitud, ...data };
      return { ...solicitud };
    },
  },
  auditLog: {
    async create({ data }: { data: Record<string, unknown> }) {
      auditLogs.push(data);
      return { id: auditLogs.length, ...data };
    },
  },
  async $queryRaw() { return []; },
  async $transaction<T>(cb: (tx: any) => Promise<T>): Promise<T> {
    return cb(fakeImpl);
  },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({
  getSession: async () => sesionActual,
}));

function req(body: unknown) {
  return new NextRequest('http://localhost/api/solicitudes/217/observaciones', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() {
  return { params: Promise.resolve({ id: '217' }) };
}

describe('POST /api/solicitudes/[id]/observaciones', () => {
  beforeEach(() => resetFixture());

  it('el primer responsable (oscar, fila 0) puede agregar su observación', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'obs de oscar' }), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    const fila = (data.solicitud.asignaciones as any[]).find((a) => a.idAsignacion === 'ASG-1');
    expect(fila.observaciones).toHaveLength(1);
    expect(fila.observaciones[0].autor).toBe('oscar.pallares');
  });

  it('el segundo/último responsable (nicole, fila 1) puede agregar su observación igual que el primero', async () => {
    sesionActual = { id: NICOLE.id, email: NICOLE.email, rol: NICOLE.rol, usuario: NICOLE.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-2', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'obs de nicole' }), ctx());
    expect(res.status).toBe(200);
  });

  it('el autor se toma SIEMPRE de la sesión, nunca del body (intento de suplantación se ignora)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'x', autor: 'nicole.ortiz', usuario: 'nicole.ortiz' }), ctx());
    const data = await res.json();
    const fila = (data.solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-1');
    expect(fila.observaciones[0].autor).toBe('oscar.pallares'); // sesión real, no lo que mandó el body
  });

  it('oscar NO puede agregar una observación a la fila de nicole (403)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-2', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'x' }), ctx());
    expect(res.status).toBe(403);
    const fila = (solicitud.asignaciones as any[]).find((a) => a.idAsignacion === 'ASG-2');
    expect(fila.observaciones).toHaveLength(0); // sin cambios parciales
  });

  it('usuario no asignado a la solicitud no puede observar (403)', async () => {
    sesionActual = { id: 999, email: 'ajeno@x.com', rol: 'Analista Comercial', usuario: 'ajeno' };
    usuarios = [...usuarios, { id: 999, usuario: 'ajeno', email: 'ajeno@x.com', rol: 'Analista Comercial', estado: 'Activo' }];
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'x' }), ctx());
    expect(res.status).toBe(403);
  });

  it('responsable removido (idAsignacion ya no existe en el arreglo actual) recibe 404/403, no se inventa la fila', async () => {
    solicitud.asignaciones = [(solicitud.asignaciones as any[])[1]]; // solo queda nicole
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'x' }), ctx());
    expect([403, 404]).toContain(res.status);
  });

  it('responsable inactivo recibe 403', async () => {
    usuarios = [{ ...OSCAR }, NICOLE_INACTIVA];
    sesionActual = { id: NICOLE.id, email: NICOLE.email, rol: NICOLE.rol, usuario: NICOLE.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-2', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'x' }), ctx());
    expect(res.status).toBe(403);
  });

  it('administrador consultando la fila de otro: la observación queda a nombre del administrador, no del analista', async () => {
    usuarios = [...usuarios, ADMIN];
    sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-2', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'x' }), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    const fila = (data.solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-2');
    expect(fila.observaciones[0].autor).toBe('admin1'); // no "nicole.ortiz"
  });

  // Ajuste "Director Comercial y Coordinador Comercial como administradores
  // funcionales de TODO el módulo Procesos" — igual que un administrador,
  // pueden observar una fila ajena sin figurar en asignaciones[].
  it('Director Comercial agrega observación en fila ajena (ASG-2, no es suya): permitido', async () => {
    usuarios = [...usuarios, DIRECTOR];
    sesionActual = { id: DIRECTOR.id, email: DIRECTOR.email, rol: DIRECTOR.rol, usuario: DIRECTOR.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-2', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'x' }), ctx());
    expect(res.status).toBe(200);
  });

  it('Coordinador Comercial agrega observación en fila ajena (ASG-1, no es suya): permitido', async () => {
    usuarios = [...usuarios, COORDINADOR];
    sesionActual = { id: COORDINADOR.id, email: COORDINADOR.email, rol: COORDINADOR.rol, usuario: COORDINADOR.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'x' }), ctx());
    expect(res.status).toBe(200);
  });

  it('dos responsables agregando observaciones (secuencialmente, simulando casi-simultáneo) conservan ambas', async () => {
    const { POST } = await import('./route');
    await POST(req({ idAsignacion: 'ASG-1', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'de oscar' }), ctx());
    sesionActual = { id: NICOLE.id, email: NICOLE.email, rol: NICOLE.rol, usuario: NICOLE.usuario };
    const res2 = await POST(req({ idAsignacion: 'ASG-2', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'de nicole' }), ctx());
    const data2 = await res2.json();
    const filaOscar = (data2.solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-1');
    const filaNicole = (data2.solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-2');
    expect(filaOscar.observaciones).toHaveLength(1); // la de oscar NO se perdió
    expect(filaNicole.observaciones).toHaveLength(1);
  });

  it('no acepta manipular el arreglo completo: solo cambia la fila autorizada, las demás quedan intactas', async () => {
    const { POST } = await import('./route');
    await POST(req({
      idAsignacion: 'ASG-1', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'x',
      // Un intento de mandar un arreglo completo manipulado (ej. eliminando
      // a nicole) — el endpoint ni siquiera lee este campo.
      asignaciones: [{ idAsignacion: 'ASG-1', analistaAsignado: 'oscar.pallares' }],
    }), ctx());
    expect(solicitud.asignaciones as any[]).toHaveLength(2); // nicole sigue ahí
  });

  it('rechaza si la solicitud ya está cerrada', async () => {
    solicitud.estadoSolicitud = 'Cerrada';
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'x' }), ctx());
    expect(res.status).toBe(403);
  });
});