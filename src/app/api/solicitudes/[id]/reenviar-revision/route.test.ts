/**
 * Integración de POST /api/solicitudes/[id]/reenviar-revision — Fase 2B-2.1.
 * Mismo patrón de fake-prisma que `transicion/route.test.ts`/`cerrar/route.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
const JUAN: UsuarioFake = { id: 10, usuario: 'juan.davila', email: 'juan.davila@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const AJENO: UsuarioFake = { id: 11, usuario: 'ajeno', email: 'ajeno@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const COORDINADOR: UsuarioFake = { id: 5, usuario: 'laura.buelvas', email: 'laura.buelvas@grupocolba.com', rol: 'Coordinador Comercial', estado: 'Activo' };
// Ajuste "editar/eliminar observaciones" — desde aquí en adelante,
// `puedeReenviarRevision` (que autoriza ESTA ruta, el mecanismo real de
// "eliminar la última observación") ya NO acepta al dueño de la FILA
// (`analistaAsignado`) por sí solo; autoriza `esAdministradorProcesos` O ser
// quien CREÓ esa observación específica (`observaciones[].usuario`). Fixture
// propio con rol literal 'Administrador' para probar el caso admin sin
// depender de que Coordinador/Director Comercial también califiquen.
const ADMIN: UsuarioFake = { id: 6, usuario: 'admin.proc', email: 'admin.proc@grupocolba.com', rol: 'Administrador', estado: 'Activo' };

let usuarios: UsuarioFake[] = [JUAN, AJENO, COORDINADOR, ADMIN];
let solicitud: Record<string, unknown>;
let auditLogs: Array<Record<string, unknown>> = [];
let fallarAuditLog = false;
let sesionActual: { id: number; email: string; rol: string; usuario: string } | null;

function resetFixture() {
  solicitud = {
    id: 300, estadoSolicitud: 'EN_OBSERVACION', procesoId: 55,
    asignaciones: [
      { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'CON_OBSERVACIONES', observaciones: [{ detalle: 'única observación' }] },
    ],
  };
  auditLogs = [];
  fallarAuditLog = false;
  // Actor por defecto: ADMIN — la mayoría de estos tests verifican
  // comportamiento POSTERIOR a la autorización (CAS, rollback, auditoría),
  // no la autorización en sí; con el ajuste "solo Administrador" JUAN
  // (dueño de la fila, no admin) ya no pasa el gate — ver tests dedicados
  // más abajo que sí prueban JUAN explícitamente.
  sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
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
      return where.id === solicitud.id ? JSON.parse(JSON.stringify(solicitud)) : null;
    },
    async updateMany({ where, data }: { where: { id: number; estadoSolicitud?: string }; data: Record<string, unknown> }) {
      if (where.id !== solicitud.id) return { count: 0 };
      if (where.estadoSolicitud !== undefined && String(solicitud.estadoSolicitud) !== where.estadoSolicitud) return { count: 0 };
      solicitud = { ...solicitud, ...data };
      return { count: 1 };
    },
    async update({ where, data }: { where: { id: number }; data: Record<string, unknown> }) {
      if (where.id !== solicitud.id) throw new Error('No encontrado');
      solicitud = { ...solicitud, ...data };
      return JSON.parse(JSON.stringify(solicitud));
    },
  },
  auditLog: {
    async create({ data }: { data: Record<string, unknown> }) {
      if (fallarAuditLog) throw new Error('Fallo simulado al escribir AuditLog.');
      auditLogs.push(data);
      return { id: auditLogs.length, ...data };
    },
  },
  // El SELECT...FOR UPDATE ahora también devuelve las columnas que la ruta
  // necesita (antes solo se usaba para el lock, y un `findUnique` aparte
  // traía los datos) — el fake refleja el estado ACTUAL de `solicitud` en
  // cada llamada, igual que haría un lock real recién tomado.
  async $queryRaw() { return [{ estadoSolicitud: solicitud.estadoSolicitud, asignaciones: solicitud.asignaciones }]; },
  async $transaction<T>(cb: (tx: any) => Promise<T>): Promise<T> {
    // Simula el rollback real de Prisma: si `cb` lanza, ningún efecto sobre
    // `solicitud`/`auditLogs` producido dentro de `cb` debe sobrevivir.
    const snapshotSolicitud = JSON.parse(JSON.stringify(solicitud));
    const snapshotAuditLen = auditLogs.length;
    try {
      return await cb(fakeImpl);
    } catch (e) {
      solicitud = snapshotSolicitud;
      auditLogs = auditLogs.slice(0, snapshotAuditLen);
      throw e;
    }
  },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));

function req(body: unknown = {}) {
  return new NextRequest('http://localhost/api/solicitudes/300/reenviar-revision', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '300' }) }; }

describe('POST /api/solicitudes/[id]/reenviar-revision', () => {
  beforeEach(resetFixture);

  it('1. caso exitoso: EN_OBSERVACION -> EN_REVISION, observaciones vacías', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.estadoNuevo).toBe('EN_REVISION');
    expect(solicitud.estadoSolicitud).toBe('EN_REVISION');
  });

  it('2. rechaza si el estado real no es EN_OBSERVACION -> 409, sin escribir nada', async () => {
    solicitud.estadoSolicitud = 'ASIGNADO_REVISION';
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(res.status).toBe(409);
    expect(solicitud.estadoSolicitud).toBe('ASIGNADO_REVISION');
    expect(auditLogs).toHaveLength(0);
  });

  it('3. usuario no autorizado (ni dueño de la fila ni admin) -> 403', async () => {
    sesionActual = { id: AJENO.id, email: AJENO.email, rol: AJENO.rol, usuario: AJENO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(res.status).toBe(403);
    expect(solicitud.estadoSolicitud).toBe('EN_OBSERVACION');
  });

  it('3b. JUAN es dueño de la fila (analistaAsignado) pero la observación no registra quién la creó (`usuario` ausente) y él NO es administrador -> 403, sin escribir nada (ser dueño de la FILA por sí solo ya no autoriza eliminar)', async () => {
    sesionActual = { id: JUAN.id, email: JUAN.email, rol: JUAN.rol, usuario: JUAN.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    const data = await res.json();
    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(solicitud.estadoSolicitud).toBe('EN_OBSERVACION');
    const fila = (solicitud.asignaciones as Record<string, unknown>[])[0];
    expect(fila.observaciones).toEqual([{ detalle: 'única observación' }]);
  });

  it('3c. ADMIN (rol literal "Administrador") sí puede eliminar la última observación -> 200', async () => {
    sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(res.status).toBe(200);
  });

  it('3d. JUAN SÍ puede eliminar cuando la observación registra que él mismo la creó (`usuario: "juan.davila"`), sin ser administrador -> 200', async () => {
    (solicitud.asignaciones as Record<string, unknown>[])[0].observaciones = [{ detalle: 'única observación', usuario: JUAN.usuario }];
    sesionActual = { id: JUAN.id, email: JUAN.email, rol: JUAN.rol, usuario: JUAN.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('3e. AJENO NO puede eliminar aunque la observación exista, incluso si fue creada por otro usuario distinto a él -> 403', async () => {
    (solicitud.asignaciones as Record<string, unknown>[])[0].observaciones = [{ detalle: 'única observación', usuario: JUAN.usuario }];
    sesionActual = { id: AJENO.id, email: AJENO.email, rol: AJENO.rol, usuario: AJENO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(res.status).toBe(403);
  });

  it('Coordinador Comercial autorizado aunque no esté asignado a la fila', async () => {
    sesionActual = { id: COORDINADOR.id, email: COORDINADOR.email, rol: COORDINADOR.rol, usuario: COORDINADOR.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(res.status).toBe(200);
  });

  it('4. el actor no puede venir del body — cualquier campo ajeno (actor/usuario/rol) rechaza con 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', actor: 'admin-falso', rol: 'Administrador' }), ctx());
    expect(res.status).toBe(400);
    expect(solicitud.estadoSolicitud).toBe('EN_OBSERVACION');
  });

  it('4b. el AuditLog registra el actor real de sesión, nunca uno enviado por el cliente', async () => {
    const { POST } = await import('./route');
    await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(auditLogs[0].detalle).toMatchObject({ actorUsuario: 'admin.proc', actorRol: 'Administrador' });
  });

  it('5. la transición se resuelve sobre el estado REAL de BD, no sobre nada declarado por el cliente (no existe estadoEsperado en el body)', async () => {
    // El body no tiene forma de "mentir" sobre el estado actual — solo trae
    // idAsignacion. Si el estado real cambia entre la lectura previa y el
    // lock, la relectura fresca dentro de la transacción es la que decide.
    const { POST } = await import('./route');
    solicitud.estadoSolicitud = 'EN_OBSERVACION';
    const res = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(res.status).toBe(200);
  });

  it('6. la fila objetivo queda con estadoRevision=EN_REVISION y observaciones=[]', async () => {
    const { POST } = await import('./route');
    await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    const fila = (solicitud.asignaciones as Record<string, unknown>[])[0];
    expect(fila.estadoRevision).toBe('EN_REVISION');
    expect(fila.observaciones).toEqual([]);
  });

  it('7. el estado global queda en EN_REVISION', async () => {
    const { POST } = await import('./route');
    await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(solicitud.estadoSolicitud).toBe('EN_REVISION');
  });

  it('8. se registra auditoría con el detalle de la transición', async () => {
    const { POST } = await import('./route');
    await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({ accion: 'solicitud_reenviar_revision', recurso: 'solicitud', recursoId: '300' });
    expect(auditLogs[0].detalle).toMatchObject({
      solicitudId: 300, idAsignacion: 'ASG-1', accionFlujo: 'REENVIAR_REVISION',
      estadoAnterior: 'EN_OBSERVACION', estadoNuevo: 'EN_REVISION',
    });
  });

  it('9. ROLLBACK: si falla la escritura de AuditLog, ni el estado ni las observaciones quedan modificados', async () => {
    fallarAuditLog = true;
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(res.status).toBe(500);
    expect(solicitud.estadoSolicitud).toBe('EN_OBSERVACION');
    const fila = (solicitud.asignaciones as Record<string, unknown>[])[0];
    expect(fila.estadoRevision).toBe('CON_OBSERVACIONES');
    expect(fila.observaciones).toEqual([{ detalle: 'única observación' }]);
    expect(auditLogs).toHaveLength(0);
  });

  it('10. regresión del flujo real: eliminar la última observación termina en EN_REVISION con observaciones vacías', async () => {
    // Fixture con exactamente 1 observación (el caso que dispara la
    // transición en page.tsx cuando nuevasObs.length===0 tras eliminar).
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.solicitud.estadoSolicitud).toBe('EN_REVISION');
    expect((data.solicitud.asignaciones as Record<string, unknown>[])[0].observaciones).toEqual([]);
  });

  it('la asignación indicada no existe -> 403 (mismo criterio que /observaciones: la autorización por fila ya lo detecta antes de la transacción)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-INEXISTENTE' }), ctx());
    expect(res.status).toBe(403);
  });

  it('la fila no tiene observaciones para vaciar -> 400 (evita usarse como reset genérico)', async () => {
    (solicitud.asignaciones as Record<string, unknown>[])[0].observaciones = [];
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(res.status).toBe(400);
  });

  it('idAsignacion faltante -> 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({}), ctx());
    expect(res.status).toBe(400);
  });

  it('solicitud inexistente -> 404', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1' }), { params: Promise.resolve({ id: '999999' }) });
    expect(res.status).toBe(404);
  });

  it('sin sesión -> 401', async () => {
    sesionActual = null;
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(res.status).toBe(401);
  });

  it('segunda llamada tras ya haber transicionado -> 409 (ya no está en EN_OBSERVACION)', async () => {
    const { POST } = await import('./route');
    const r1 = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(r1.status).toBe(200);
    const r2 = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(r2.status).toBe(409);
  });

  it('11. no quedan flags residuales del rechazo/decisión de la observación eliminada — la fila conserva sus demás campos intactos y `observaciones` queda realmente vacío, sin rastro de `decision`', async () => {
    (solicitud.asignaciones as Record<string, unknown>[])[0] = {
      idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'CON_OBSERVACIONES',
      entidadPropiaDeLaFila: 'no debe desaparecer',
      observaciones: [{ detalle: 'única observación', usuario: 'admin.proc', decision: 'no_aceptada' }],
    };
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(res.status).toBe(200);
    const fila = (solicitud.asignaciones as Record<string, unknown>[])[0];
    expect(fila.observaciones).toEqual([]);
    expect(fila.entidadPropiaDeLaFila).toBe('no debe desaparecer'); // otros campos de la fila no se pierden
    expect(JSON.stringify(fila)).not.toContain('no_aceptada'); // ninguna decisión residual sobrevive
  });

  it('12. después de refrescar la versión correcta, la eliminación SÍ procede (un primer intento sobre estado obsoleto falla 409; con el estado real actualizado, el mismo idAsignacion sí se elimina)', async () => {
    solicitud.estadoSolicitud = 'EN_REVISION'; // estado real distinto al que asumía la pantalla stale
    const { POST } = await import('./route');
    const intentoStale = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(intentoStale.status).toBe(409);
    expect((solicitud.asignaciones as Record<string, unknown>[])[0].observaciones).toEqual([{ detalle: 'única observación' }]);

    // El usuario "recarga la información" — el estado real vuelve a EN_OBSERVACION
    // (p.ej. otro flujo reabrió observaciones) y la fila sigue teniendo la
    // misma observación pendiente de eliminar.
    solicitud.estadoSolicitud = 'EN_OBSERVACION';
    const intentoConEstadoReal = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(intentoConEstadoReal.status).toBe(200);
    expect((solicitud.asignaciones as Record<string, unknown>[])[0].observaciones).toEqual([]);
  });

  it('13. regresión de rendimiento: la transacción hace SOLO 3 idas-vueltas a la base de datos (1 SELECT...FOR UPDATE + 1 update + 1 auditLog.create) — antes eran 5, la 6ta operación (updateMany+findUnique separados) se eliminó para no acercarse al timeout de la transacción', async () => {
    const llamadas: string[] = [];
    const original$QueryRaw = fakeImpl.$queryRaw.bind(fakeImpl);
    const originalUpdate = fakeImpl.solicitud.update.bind(fakeImpl.solicitud);
    const originalAuditCreate = fakeImpl.auditLog.create.bind(fakeImpl.auditLog);
    fakeImpl.$queryRaw = (async (...args: unknown[]) => { llamadas.push('$queryRaw'); return original$QueryRaw(...(args as [])); }) as typeof fakeImpl.$queryRaw;
    fakeImpl.solicitud.update = (async (...args: Parameters<typeof originalUpdate>) => { llamadas.push('solicitud.update'); return originalUpdate(...args); }) as typeof fakeImpl.solicitud.update;
    fakeImpl.auditLog.create = (async (...args: Parameters<typeof originalAuditCreate>) => { llamadas.push('auditLog.create'); return originalAuditCreate(...args); }) as typeof fakeImpl.auditLog.create;
    try {
      const { POST } = await import('./route');
      const res = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
      expect(res.status).toBe(200);
      expect(llamadas).toEqual(['$queryRaw', 'solicitud.update', 'auditLog.create']);
    } finally {
      fakeImpl.$queryRaw = original$QueryRaw;
      fakeImpl.solicitud.update = originalUpdate;
      fakeImpl.auditLog.create = originalAuditCreate;
    }
  });
});
