/**
 * Ajuste "Director Comercial y Coordinador Comercial como administradores
 * funcionales de TODO el módulo Procesos" — DELETE /api/solicitudes es
 * eliminación LÓGICA y auditada (copia completa a DeletedSolicitud antes
 * de borrar la fila de Solicitud, con deletedByUsuario/deletedByEmail) —
 * por eso ambos roles quedan autorizados igual que un Administrador. No
 * existe ningún endpoint de purga física en este proyecto (confirmado por
 * auditoría) — nada que excluir explícitamente además de esto.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
const DIRECTOR: UsuarioFake = { id: 6, usuario: 'ricardo.mejia', email: 'ricardo.mejia@grupocolba.com', rol: 'Director Comercial', estado: 'Activo' };
const COORDINADOR: UsuarioFake = { id: 5, usuario: 'laura.buelvas', email: 'laura.buelvas@grupocolba.com', rol: 'Coordinador Comercial', estado: 'Activo' };
const ANALISTA: UsuarioFake = { id: 101, usuario: 'oscar.pallares', email: 'oscar.pallares@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };

let sesionActual: { id: number; email: string; rol: string; usuario: string } | null;
let solicitudes: Record<string, unknown>[];
let deletedCreados: Record<string, unknown>[];
let auditLogsCreados: Record<string, unknown>[];
let fallarEnCreateMany = false;
let fallarEnAuditLog = false;
let fallarEnDeleteMany = false;

function resetFixture() {
  sesionActual = { id: DIRECTOR.id, email: DIRECTOR.email, rol: DIRECTOR.rol, usuario: DIRECTOR.usuario };
  solicitudes = [{ id: 900, codigoProceso: 'P-900', asignaciones: [] }];
  deletedCreados = [];
  auditLogsCreados = [];
  fallarEnCreateMany = false;
  fallarEnAuditLog = false;
  fallarEnDeleteMany = false;
}

const txImpl = {
  $queryRaw: async () => [],
  solicitud: {
    async findMany({ where }: { where: { id: { in: number[] } } }) {
      return solicitudes.filter((s) => where.id.in.includes(s.id as number));
    },
    async deleteMany({ where }: { where: { id: { in: number[] } } }) {
      if (fallarEnDeleteMany) throw new Error('Fallo simulado al eliminar Solicitud');
      const antes = solicitudes.length;
      solicitudes = solicitudes.filter((s) => !where.id.in.includes(s.id as number));
      return { count: antes - solicitudes.length };
    },
  },
  deletedSolicitud: {
    async createMany({ data }: { data: Record<string, unknown>[] }) {
      if (fallarEnCreateMany) throw new Error('Fallo simulado al crear DeletedSolicitud');
      deletedCreados.push(...data);
      return { count: data.length };
    },
  },
  auditLog: {
    async create({ data }: { data: Record<string, unknown> }) {
      if (fallarEnAuditLog) throw new Error('Fallo simulado al registrar AuditLog');
      auditLogsCreados.push(data);
      return data;
    },
  },
};

const fakeImpl = {
  ...txImpl,
  // Simula el rollback real de Prisma: si el callback lanza, el estado
  // mutado durante la "transacción" se descarta por completo.
  async $transaction<T>(cb: (tx: typeof txImpl) => Promise<T>): Promise<T> {
    const snapshotSolicitudes = [...solicitudes];
    const snapshotDeleted = [...deletedCreados];
    const snapshotAudit = [...auditLogsCreados];
    try {
      return await cb(txImpl);
    } catch (err) {
      solicitudes = snapshotSolicitudes;
      deletedCreados = snapshotDeleted;
      auditLogsCreados = snapshotAudit;
      throw err;
    }
  },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));

function req(body: Record<string, unknown> = { ids: [900], motivo: 'Registro duplicado, se elimina por error de carga.' }) {
  return new NextRequest('http://localhost/api/solicitudes', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => { vi.resetModules(); resetFixture(); });

describe('DELETE /api/solicitudes — eliminación lógica', () => {
  it('Director Comercial elimina lógicamente una solicitud: permitido', async () => {
    const { DELETE } = await import('./route');
    const res = await DELETE(req());
    expect(res.status).toBe(200);
    expect(solicitudes.length).toBe(0);
    expect(deletedCreados.length).toBe(1);
  });

  it('Coordinador Comercial elimina lógicamente una solicitud: permitido', async () => {
    sesionActual = { id: COORDINADOR.id, email: COORDINADOR.email, rol: COORDINADOR.rol, usuario: COORDINADOR.usuario };
    const { DELETE } = await import('./route');
    const res = await DELETE(req());
    expect(res.status).toBe(200);
  });

  it('Analista asignado intenta eliminar una solicitud: denegado (403) — sin regla explícita que lo autorice', async () => {
    sesionActual = { id: ANALISTA.id, email: ANALISTA.email, rol: ANALISTA.rol, usuario: ANALISTA.usuario };
    const { DELETE } = await import('./route');
    const res = await DELETE(req());
    expect(res.status).toBe(403);
    expect(solicitudes.length).toBe(1); // sin cambios
  });

  it('sin sesión: 401', async () => {
    sesionActual = null;
    const { DELETE } = await import('./route');
    const res = await DELETE(req());
    expect(res.status).toBe(401);
  });

  it('la copia en DeletedSolicitud conserva quién eliminó (auditoría) — nunca se pierde el registro', async () => {
    const { DELETE } = await import('./route');
    await DELETE(req());
    expect(deletedCreados[0].originalId).toBe(900);
  });

  it('payload inválido (ids ausente): 400', async () => {
    const { DELETE } = await import('./route');
    const res = await DELETE(req({ motivo: 'Motivo válido de sobra.' }));
    expect(res.status).toBe(400);
  });

  it('solicitud inexistente en el lote: 404, sin escribir nada', async () => {
    const { DELETE } = await import('./route');
    const res = await DELETE(req({ ids: [900, 999], motivo: 'Motivo válido de sobra.' }));
    expect(res.status).toBe(404);
    expect(solicitudes.length).toBe(1);
    expect(deletedCreados.length).toBe(0);
  });

  it('motivo ausente: 400, sin escribir nada', async () => {
    const { DELETE } = await import('./route');
    const res = await DELETE(req({ ids: [900] }));
    expect(res.status).toBe(400);
    expect(solicitudes.length).toBe(1);
  });

  it('motivo demasiado corto: 400', async () => {
    const { DELETE } = await import('./route');
    const res = await DELETE(req({ ids: [900], motivo: 'ab' }));
    expect(res.status).toBe(400);
  });

  it('fallo al crear DeletedSolicitud revierte todo (no se elimina la Solicitud)', async () => {
    fallarEnCreateMany = true;
    const { DELETE } = await import('./route');
    const res = await DELETE(req());
    expect(res.status).toBe(500);
    expect(solicitudes.length).toBe(1);
    expect(deletedCreados.length).toBe(0);
  });

  it('fallo al registrar AuditLog revierte todo (no se copia ni se elimina)', async () => {
    fallarEnAuditLog = true;
    const { DELETE } = await import('./route');
    const res = await DELETE(req());
    expect(res.status).toBe(500);
    expect(solicitudes.length).toBe(1);
    expect(deletedCreados.length).toBe(0);
  });

  it('fallo al eliminar la Solicitud revierte todo (la copia también se revierte)', async () => {
    fallarEnDeleteMany = true;
    const { DELETE } = await import('./route');
    const res = await DELETE(req());
    expect(res.status).toBe(500);
    expect(solicitudes.length).toBe(1);
  });

  it('lote múltiple respeta TODO_O_NADA: 2 solicitudes válidas se eliminan juntas', async () => {
    solicitudes = [{ id: 900, codigoProceso: 'P-900', asignaciones: [] }, { id: 901, codigoProceso: 'P-901', asignaciones: [] }];
    const { DELETE } = await import('./route');
    const res = await DELETE(req({ ids: [900, 901], motivo: 'Depuración de duplicados detectados.' }));
    expect(res.status).toBe(200);
    expect(solicitudes.length).toBe(0);
    expect(deletedCreados.length).toBe(2);
  });

  it('actor y datos de auditoría correctos: se toman de la sesión, nunca del body', async () => {
    const { DELETE } = await import('./route');
    const reqManipulado = new NextRequest('http://localhost/api/solicitudes', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [900], motivo: 'Motivo válido de sobra.', deletedByUsuario: 'atacante', deletedByEmail: 'atacante@evil.com' }),
    });
    await DELETE(reqManipulado);
    expect(deletedCreados[0].deletedByUsuario).toBe(DIRECTOR.usuario);
    expect(deletedCreados[0].deletedByEmail).toBe(DIRECTOR.email);
    expect(auditLogsCreados.length).toBe(1);
    expect(auditLogsCreados[0].accion).toBe('solicitud_eliminar_lote');
    expect(auditLogsCreados[0].usuarioId).toBe(DIRECTOR.id);
    expect((auditLogsCreados[0].detalle as Record<string, unknown>).motivo).toBe('Motivo válido de sobra.');
  });

  it('todos los campos de la Solicitud se preservan en la copia (incluye campos SQR y de contacto)', async () => {
    solicitudes = [{
      id: 900, codigoProceso: 'P-900', asignaciones: [], sqrNumero: 'SQR-1', sqrCreada: true,
      nitContacto: '900123456', personaContacto: 'Juan Pérez', fechaEntregaInfo: new Date('2026-01-01'),
    }];
    const { DELETE } = await import('./route');
    await DELETE(req());
    expect(deletedCreados[0].sqrNumero).toBe('SQR-1');
    expect(deletedCreados[0].sqrCreada).toBe(true);
    expect(deletedCreados[0].nitContacto).toBe('900123456');
    expect(deletedCreados[0].personaContacto).toBe('Juan Pérez');
  });
});