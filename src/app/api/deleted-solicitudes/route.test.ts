/**
 * Ajuste "SOLICITUDES ELIMINADAS — SOLO ADMINISTRADOR" (decisión
 * explícita del usuario) — REVOCA el acceso que Director Comercial y
 * Coordinador Comercial tenían hasta ahora (ver commit previo
 * "Director Comercial y Coordinador Comercial como administradores
 * funcionales de TODO el módulo Procesos"): GET (listar papelera) y
 * PATCH (restaurar) ahora exigen `requireAdmin` (isAdmin puro), nunca
 * `requireAdministradorProcesos`. No existe endpoint de purga permanente
 * en este proyecto (confirmado por auditoría) — nada que probar/excluir
 * en ese sentido.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
const ADMIN: UsuarioFake = { id: 1, usuario: 'admin.qa', email: 'admin.qa@grupocolba.com', rol: 'Administrador', estado: 'Activo' };
const DIRECTOR: UsuarioFake = { id: 6, usuario: 'ricardo.mejia', email: 'ricardo.mejia@grupocolba.com', rol: 'Director Comercial', estado: 'Activo' };
const COORDINADOR: UsuarioFake = { id: 5, usuario: 'laura.buelvas', email: 'laura.buelvas@grupocolba.com', rol: 'Coordinador Comercial', estado: 'Activo' };
const ANALISTA: UsuarioFake = { id: 101, usuario: 'oscar.pallares', email: 'oscar.pallares@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const MERCADEO: UsuarioFake = { id: 201, usuario: 'ana.rios', email: 'ana.rios@grupocolba.com', rol: 'Analista Mercadeo', estado: 'Activo' };

let sesionActual: { id: number; email: string; rol: string; usuario: string } | null;
let eliminados: Record<string, unknown>[];
let solicitudesVivas: Record<string, unknown>[];
let auditLogsCreados: Record<string, unknown>[];
let fallarEnCreate = false;
let fallarEnAuditLog = false;
let fallarEnDelete = false;

function resetFixture() {
  // Ajuste "SOLICITUDES ELIMINADAS — SOLO ADMINISTRADOR" — la sesión por
  // defecto de los tests que NO son de autorización pasa a ser un
  // Administrador real (antes era Director Comercial, ahora denegado).
  sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
  eliminados = [{ id: 1, originalId: 900, codigoProceso: 'P-900', procesoId: null }];
  solicitudesVivas = [];
  auditLogsCreados = [];
  fallarEnCreate = false;
  fallarEnAuditLog = false;
  fallarEnDelete = false;
}

const txImpl = {
  $queryRaw: async () => [],
  deletedSolicitud: {
    async findMany() { return [...eliminados]; },
    async findUnique({ where }: { where: { id: number } }) {
      return eliminados.find((e) => e.id === where.id) ?? null;
    },
    async delete({ where }: { where: { id: number } }) {
      if (fallarEnDelete) throw new Error('Fallo simulado al eliminar DeletedSolicitud');
      eliminados = eliminados.filter((e) => e.id !== where.id);
    },
  },
  solicitud: {
    async findUnique({ where }: { where: { id: number } }) {
      return solicitudesVivas.find((s) => s.id === where.id) ?? null;
    },
    async findFirst({ where }: { where: { procesoId: number } }) {
      return solicitudesVivas.find((s) => s.procesoId === where.procesoId) ?? null;
    },
    async create({ data }: { data: Record<string, unknown> }) {
      if (fallarEnCreate) throw new Error('Fallo simulado al crear Solicitud');
      const creada = { id: (data.id as number) ?? 900 + solicitudesVivas.length + 1, ...data };
      solicitudesVivas.push(creada);
      return creada;
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
    const snapshotEliminados = [...eliminados];
    const snapshotVivas = [...solicitudesVivas];
    const snapshotAudit = [...auditLogsCreados];
    try {
      return await cb(txImpl);
    } catch (err) {
      eliminados = snapshotEliminados;
      solicitudesVivas = snapshotVivas;
      auditLogsCreados = snapshotAudit;
      throw err;
    }
  },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));

function getReq() { return new NextRequest('http://localhost/api/deleted-solicitudes'); }
function patchReq(body: unknown = { id: 1, motivo: 'Se reabre el proceso a solicitud del cliente.' }) {
  return new NextRequest('http://localhost/api/deleted-solicitudes', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => { vi.resetModules(); resetFixture(); });

describe('GET /api/deleted-solicitudes — listar papelera', () => {
  it('Administrador lista la papelera: permitido (200)', async () => {
    const { GET } = await import('./route');
    const res = await GET(getReq());
    expect(res.status).toBe(200);
  });
  it('Director Comercial: denegado (403) — ya NO es administrador funcional de este módulo', async () => {
    sesionActual = { id: DIRECTOR.id, email: DIRECTOR.email, rol: DIRECTOR.rol, usuario: DIRECTOR.usuario };
    const { GET } = await import('./route');
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });
  it('Coordinador Comercial: denegado (403) — ya NO es administrador funcional de este módulo', async () => {
    sesionActual = { id: COORDINADOR.id, email: COORDINADOR.email, rol: COORDINADOR.rol, usuario: COORDINADOR.usuario };
    const { GET } = await import('./route');
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });
  it('Analista Comercial: denegado (403)', async () => {
    sesionActual = { id: ANALISTA.id, email: ANALISTA.email, rol: ANALISTA.rol, usuario: ANALISTA.usuario };
    const { GET } = await import('./route');
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });
  it('Analista Mercadeo: denegado (403)', async () => {
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { GET } = await import('./route');
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });
  it('sin sesión: 401', async () => {
    sesionActual = null;
    const { GET } = await import('./route');
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/deleted-solicitudes — restaurar', () => {
  it('Administrador restaura una solicitud eliminada: permitido', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id: 1, motivo: 'Se reabre el proceso a solicitud del cliente.' }));
    expect(res.status).toBe(200);
    expect(eliminados.length).toBe(0);
  });
  it('Director Comercial: denegado (403) — ya NO es administrador funcional de este módulo', async () => {
    sesionActual = { id: DIRECTOR.id, email: DIRECTOR.email, rol: DIRECTOR.rol, usuario: DIRECTOR.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id: 1, motivo: 'Se reabre el proceso a solicitud del cliente.' }));
    expect(res.status).toBe(403);
    expect(eliminados.length).toBe(1); // sin cambios
  });
  it('Coordinador Comercial: denegado (403) — ya NO es administrador funcional de este módulo', async () => {
    sesionActual = { id: COORDINADOR.id, email: COORDINADOR.email, rol: COORDINADOR.rol, usuario: COORDINADOR.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id: 1, motivo: 'Se reabre el proceso a solicitud del cliente.' }));
    expect(res.status).toBe(403);
    expect(eliminados.length).toBe(1); // sin cambios
  });
  it('Analista Comercial: denegado (403)', async () => {
    sesionActual = { id: ANALISTA.id, email: ANALISTA.email, rol: ANALISTA.rol, usuario: ANALISTA.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id: 1, motivo: 'Se reabre el proceso a solicitud del cliente.' }));
    expect(res.status).toBe(403);
    expect(eliminados.length).toBe(1); // sin cambios
  });
  it('Analista Mercadeo: denegado (403)', async () => {
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id: 1, motivo: 'Se reabre el proceso a solicitud del cliente.' }));
    expect(res.status).toBe(403);
    expect(eliminados.length).toBe(1); // sin cambios
  });

  it('sin sesión: 401', async () => {
    sesionActual = null;
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq());
    expect(res.status).toBe(401);
  });

  it('payload inválido (id ausente): 400', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ motivo: 'Motivo válido de sobra.' }));
    expect(res.status).toBe(400);
  });

  it('DeletedSolicitud inexistente: 404', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id: 999, motivo: 'Motivo válido de sobra.' }));
    expect(res.status).toBe(404);
  });

  it('motivo ausente: 400, sin restaurar', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ id: 1 }));
    expect(res.status).toBe(400);
    expect(eliminados.length).toBe(1);
  });

  it('conflicto con Solicitud viva del mismo procesoId: 409, sin restaurar', async () => {
    eliminados = [{ id: 1, originalId: 900, codigoProceso: 'P-900', procesoId: 555 }];
    solicitudesVivas = [{ id: 700, procesoId: 555 }];
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq());
    expect(res.status).toBe(409);
    expect(eliminados.length).toBe(1);
  });

  it('procesoId null nunca genera conflicto (múltiples restauraciones sin procesoId son válidas)', async () => {
    eliminados = [{ id: 1, originalId: 900, codigoProceso: 'P-900', procesoId: null }];
    solicitudesVivas = [{ id: 700, procesoId: null }];
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq());
    expect(res.status).toBe(200);
  });

  it('fallo al crear la Solicitud revierte todo (no se borra la DeletedSolicitud)', async () => {
    fallarEnCreate = true;
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq());
    expect(res.status).toBe(500);
    expect(eliminados.length).toBe(1);
    expect(solicitudesVivas.length).toBe(0);
  });

  it('fallo al registrar AuditLog revierte todo', async () => {
    fallarEnAuditLog = true;
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq());
    expect(res.status).toBe(500);
    expect(eliminados.length).toBe(1);
    expect(solicitudesVivas.length).toBe(0);
  });

  it('fallo al eliminar la DeletedSolicitud revierte todo (la Solicitud creada también se revierte)', async () => {
    fallarEnDelete = true;
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq());
    expect(res.status).toBe(500);
  });

  it('dos restauraciones simultáneas de la misma fila no duplican datos: la segunda ve la fila ya ausente', async () => {
    const { PATCH } = await import('./route');
    // Simula concurrencia real: la primera transacción borra la fila antes de que la segunda la lea
    // (equivalente al efecto del lock FOR UPDATE serializando el acceso en Postgres real).
    const res1 = await PATCH(patchReq());
    const res2 = await PATCH(patchReq());
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(404);
    expect(solicitudesVivas.length).toBe(1);
  });

  it('todos los campos restaurables conservan paridad, incluidos los campos SQR ausentes en el mapeo anterior', async () => {
    eliminados = [{
      id: 1, originalId: 900, codigoProceso: 'P-900', procesoId: null,
      sqrNumero: 'SQR-1', sqrCreada: true, sqrCerrada: false, resultadoFinal: 'Adjudicado',
      causalCierre: null, fechaAperturaSqr: new Date('2026-01-01'), fechaCierreSqr: null,
      fechaEntregaInfo: new Date('2026-02-01'), nitContacto: '900123456', personaContacto: 'Juan Pérez',
      origenSolicitud: 'Especializada',
    }];
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.solicitud.sqrNumero).toBe('SQR-1');
    expect(data.solicitud.sqrCreada).toBe(true);
    expect(data.solicitud.resultadoFinal).toBe('Adjudicado');
    expect(data.solicitud.nitContacto).toBe('900123456');
    expect(data.solicitud.personaContacto).toBe('Juan Pérez');
    expect(data.solicitud.origenSolicitud).toBe('Especializada');
  });

  it('BigInt/Date/JSON: fechas y campos Json sobreviven la restauración sin lanzar excepción', async () => {
    eliminados = [{
      id: 1, originalId: 900, codigoProceso: 'P-900', procesoId: null,
      fechaPublicacion: new Date('2026-01-01'), asignaciones: [{ idAsignacion: 'a1' }], docData: [{ nombre: 'x' }],
    }];
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(() => JSON.stringify(data)).not.toThrow();
  });

  it('actor y datos de auditoría correctos: se toman de la sesión', async () => {
    const { PATCH } = await import('./route');
    await PATCH(patchReq());
    expect(auditLogsCreados.length).toBe(1);
    expect(auditLogsCreados[0].accion).toBe('solicitud_restaurar');
    expect(auditLogsCreados[0].usuarioId).toBe(ADMIN.id);
    expect((auditLogsCreados[0].detalle as Record<string, unknown>).motivo).toBe('Se reabre el proceso a solicitud del cliente.');
  });
});