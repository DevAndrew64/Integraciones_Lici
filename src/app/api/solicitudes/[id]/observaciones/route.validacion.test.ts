/**
 * Pruebas dedicadas a la validación de entrada de
 * POST /api/solicitudes/[id]/observaciones — auditoría solicitada
 * explícitamente. No repite los casos de autorización/concurrencia ya
 * cubiertos en route.test.ts; se enfoca en la forma y contenido del body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
const OSCAR: UsuarioFake = { id: 101, usuario: 'oscar.pallares', email: 'oscar.pallares@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const NICOLE: UsuarioFake = { id: 102, usuario: 'nicole.ortiz', email: 'nicole.ortiz@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };

let solicitud: Record<string, unknown>;
let auditLogs: Array<Record<string, unknown>> = [];
let sesionActual: { id: number; email: string; rol: string; usuario: string };

function resetFixture() {
  solicitud = {
    id: 900, estadoSolicitud: 'En evaluación',
    asignaciones: [
      { idAsignacion: 'ASG-1', analistaAsignado: 'oscar.pallares', observaciones: [] },
      { idAsignacion: 'ASG-2', analistaAsignado: 'nicole.ortiz', observaciones: [] },
    ],
  };
  auditLogs = [];
  sesionActual = { id: OSCAR.id, email: OSCAR.email, rol: OSCAR.rol, usuario: OSCAR.usuario };
}

const fakeImpl = {
  user: {
    async findUnique({ where }: { where: { id?: number; email?: string } }) {
      const usuarios = [OSCAR, NICOLE];
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
      return { ...solicitud };
    },
  },
  auditLog: { async create({ data }: { data: Record<string, unknown> }) { auditLogs.push(data); return { id: auditLogs.length, ...data }; } },
  async $queryRaw() { return []; },
  async $transaction<T>(cb: (tx: any) => Promise<T>): Promise<T> { return cb(fakeImpl); },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));

function req(body: unknown) {
  return new NextRequest('http://localhost/api/solicitudes/900/observaciones', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '900' }) }; }

describe('POST /api/solicitudes/[id]/observaciones — validación de entrada', () => {
  beforeEach(() => resetFixture());

  it('observación válida (caso general, no-indicador): 200 y se persiste con los campos esperados', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', tipoCausa: 'Condición del proceso', causaEspecifica: 'Presupuesto insuficiente', detalle: 'Detalle real de la observación.' }), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    const fila = (data.solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-1');
    expect(fila.observaciones[0]).toMatchObject({
      autor: 'oscar.pallares', tipoCausa: 'Condición del proceso',
      causaEspecifica: 'Presupuesto insuficiente', detalle: 'Detalle real de la observación.',
    });
  });

  it('observación válida de tipo Indicador (con al menos un indicador, detalle puede ir vacío)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', tipoCausa: 'Indicador',
      indicadores: [{ subcausa: 'Liquidez', valorRequerido: '1.2', valorEvidenciado: '0.9', cumple: 'No', obs: '' }],
    }), ctx());
    expect(res.status).toBe(200);
  });

  it('detalle vacío (caso general, sin indicadores): 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: '' }), ctx());
    expect(res.status).toBe(400);
  });

  it('detalle compuesto solo por espacios: 400 (rechazado tras trim)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: '    \n\t  ' }), ctx());
    expect(res.status).toBe(400);
  });

  it('detalle que excede el límite máximo documentado (4000 caracteres): 400', async () => {
    const { POST } = await import('./route');
    const detalleLargo = 'a'.repeat(4001);
    const res = await POST(req({ idAsignacion: 'ASG-1', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: detalleLargo }), ctx());
    expect(res.status).toBe(400);
  });

  it('detalle justo en el límite (4000 caracteres) sí se acepta', async () => {
    const { POST } = await import('./route');
    const detalleLimite = 'a'.repeat(4000);
    const res = await POST(req({ idAsignacion: 'ASG-1', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: detalleLimite }), ctx());
    expect(res.status).toBe(200);
  });

  it('tipo incorrecto: detalle como número en vez de texto → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 12345 }), ctx());
    expect(res.status).toBe(400);
  });

  it('tipo incorrecto: idAsignacion como número en vez de texto → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 1, tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'x' }), ctx());
    expect(res.status).toBe(400);
  });

  it('tipo incorrecto: indicadores como string en vez de arreglo → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', tipoCausa: 'Indicador', indicadores: 'no es un arreglo' }), ctx());
    expect(res.status).toBe(400);
  });

  it('indicador con campo de tipo inesperado (cumple como booleano en vez de string) → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', tipoCausa: 'Indicador',
      indicadores: [{ subcausa: 'Liquidez', valorRequerido: '1.2', valorEvidenciado: '0.9', cumple: true, obs: '' }],
    }), ctx());
    expect(res.status).toBe(400);
  });

  it('tipoCausa==="Indicador" sin ningún indicador → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', tipoCausa: 'Indicador', detalle: 'x', indicadores: [] }), ctx());
    expect(res.status).toBe(400);
  });

  it('causaEspecifica ausente cuando tipoCausa no es Indicador → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', tipoCausa: 'Otro', detalle: 'x' }), ctx());
    expect(res.status).toBe(400);
  });

  it('body no es un objeto (arreglo en la raíz) → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req([1, 2, 3]), ctx());
    expect(res.status).toBe(400);
  });

  it('intento de suplantar autor/usuario/fecha vía el body: se ignoran, el autor y la fecha son siempre del servidor', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'x',
      autor: 'usuario-falso', usuario: 'usuario-falso', autorId: 999999, fecha: '1999-01-01 00:00:00',
    }), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    const fila = (data.solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-1');
    const obs = fila.observaciones[0];
    expect(obs.autor).toBe('oscar.pallares');
    expect(obs.autorId).toBe(OSCAR.id);
    expect(obs.fecha).not.toBe('1999-01-01 00:00:00');
  });

  it('intento de modificar la fila de otro responsable enviando su idAsignacion directamente: 403, sin cambios parciales', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-2', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'intento de oscar sobre la fila de nicole' }), ctx());
    expect(res.status).toBe(403);
    const filaNicole = (solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-2');
    expect(filaNicole.observaciones).toHaveLength(0);
  });

  it('no altera el contenido histórico ya guardado en otras observaciones de la misma fila', async () => {
    (solicitud.asignaciones as any[])[0].observaciones = [{ autor: 'oscar.pallares', detalle: 'observación histórica previa', fecha: '2026-01-01 08:00:00' }];
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', tipoCausa: 'Otro', causaEspecifica: 'Otro concepto', detalle: 'observación nueva' }), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    const fila = (data.solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-1');
    expect(fila.observaciones).toHaveLength(2);
    expect(fila.observaciones[0]).toEqual({ autor: 'oscar.pallares', detalle: 'observación histórica previa', fecha: '2026-01-01 08:00:00' });
  });
});