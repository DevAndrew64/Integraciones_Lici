/**
 * Integración de POST /api/solicitudes/[id]/finalizar-revision — Fase 2B-2.2.1.
 * Mismo patrón de fake-prisma que `reenviar-revision/route.test.ts`/`transicion/route.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
const JUAN: UsuarioFake = { id: 10, usuario: 'juan.davila', email: 'juan.davila@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const AJENO: UsuarioFake = { id: 11, usuario: 'ajeno', email: 'ajeno@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const COORDINADOR: UsuarioFake = { id: 5, usuario: 'laura.buelvas', email: 'laura.buelvas@grupocolba.com', rol: 'Coordinador Comercial', estado: 'Activo' };
// Responsable REAL de la fila B (coincide con FILA_B_ORIGINAL.analistaAsignado)
// — a diferencia de AJENO (sin ninguna fila propia), este usuario SÍ tiene
// `propia !== null`, así el intento sobre la fila A ejercita la rama
// `String(propia.idAsignacion) !== idAsignacionObjetivo`, no `!propia`.
const RESPONSABLE_B: UsuarioFake = { id: 12, usuario: 'otro.usuario', email: 'otro.usuario@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };

let usuarios: UsuarioFake[] = [JUAN, AJENO, COORDINADOR, RESPONSABLE_B];
let solicitud: Record<string, unknown>;
let auditLogs: Array<Record<string, unknown>> = [];
let fallarAuditLog = false;
let sesionActual: { id: number; email: string; rol: string; usuario: string } | null;

const FILA_B_ORIGINAL = {
  idAsignacion: 'ASG-2', analistaAsignado: 'otro.usuario', estadoRevision: 'CON_OBSERVACIONES',
  observaciones: [{ detalle: 'observación de B' }], gestionadoPor: 'otro.usuario', ultimaActualizacion: '2026-01-01T00:00:00.000Z',
};

function resetFixture() {
  solicitud = {
    id: 300, estadoSolicitud: 'EN_OBSERVACION', procesoId: 55,
    asignaciones: [
      { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'CON_OBSERVACIONES', observaciones: [{ detalle: 'observación de A' }] },
      { ...FILA_B_ORIGINAL },
    ],
  };
  auditLogs = [];
  fallarAuditLog = false;
  sesionActual = { id: JUAN.id, email: JUAN.email, rol: JUAN.rol, usuario: JUAN.usuario };
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
  },
  auditLog: {
    async create({ data }: { data: Record<string, unknown> }) {
      if (fallarAuditLog) throw new Error('Fallo simulado al escribir AuditLog.');
      auditLogs.push(data);
      return { id: auditLogs.length, ...data };
    },
  },
  async $queryRaw() { return []; },
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
  return new NextRequest('http://localhost/api/solicitudes/300/finalizar-revision', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '300' }) }; }
function filaA() { return (solicitud.asignaciones as Record<string, unknown>[])[0]; }
function filaB() { return (solicitud.asignaciones as Record<string, unknown>[])[1]; }

describe('POST /api/solicitudes/[id]/finalizar-revision', () => {
  beforeEach(resetFixture);

  it('1. caso exitoso: EN_OBSERVACION -> APROBADO_ELABORACION, con estado final completo verificado', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.estadoNuevo).toBe('APROBADO_ELABORACION');
    expect(solicitud.estadoSolicitud).toBe('APROBADO_ELABORACION');
    expect(filaA().estadoRevision).toBe('APROBADO_ELABORACION');
    expect(filaA().decisionObservaciones).toBe('aceptada');
    expect(filaA().validadoPor).toBe('juan.davila');
    expect(typeof filaA().fechaValidacion).toBe('string');
  });

  it('2. body válido (idAsignacion + decisionObservaciones:"aceptada") es aceptado', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(res.status).toBe(200);
  });

  it('3. campo adicional en el body -> 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada', motivo: 'x' }), ctx());
    expect(res.status).toBe(400);
    expect(solicitud.estadoSolicitud).toBe('EN_OBSERVACION');
  });

  it('4. decisionObservaciones distinta de "aceptada" -> 400 (incluye "no_aceptada", que pertenece a /cerrar)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'no_aceptada' }), ctx());
    expect(res.status).toBe(400);
    expect(solicitud.estadoSolicitud).toBe('EN_OBSERVACION');
  });

  it('5. idAsignacion faltante -> 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ decisionObservaciones: 'aceptada' }), ctx());
    expect(res.status).toBe(400);
  });

  it('6. sin sesión -> 401', async () => {
    sesionActual = null;
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(res.status).toBe(401);
  });

  it('7. usuario no autorizado (ni dueño de la fila ni admin) -> 403', async () => {
    sesionActual = { id: AJENO.id, email: AJENO.email, rol: AJENO.rol, usuario: AJENO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(res.status).toBe(403);
    expect(solicitud.estadoSolicitud).toBe('EN_OBSERVACION');
  });

  it('7b. usuario que ES responsable de la fila B intenta ejecutar FINALIZAR_REVISION sobre la fila A -> 403, sin ningún efecto (rama "propia !== objetivo", no "!propia")', async () => {
    const antesSolicitud = JSON.parse(JSON.stringify(solicitud));
    sesionActual = { id: RESPONSABLE_B.id, email: RESPONSABLE_B.email, rol: RESPONSABLE_B.rol, usuario: RESPONSABLE_B.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(res.status).toBe(403);
    // Nada cambia: ni A, ni B, ni el estado global, ni auditoría.
    expect(solicitud).toEqual(antesSolicitud);
    expect(solicitud.estadoSolicitud).toBe('EN_OBSERVACION');
    expect(filaA().estadoRevision).toBe('CON_OBSERVACIONES');
    expect(filaA()).not.toHaveProperty('decisionObservaciones');
    expect(filaA()).not.toHaveProperty('validadoPor');
    expect(filaA()).not.toHaveProperty('fechaValidacion');
    expect(filaB()).toEqual(FILA_B_ORIGINAL);
    expect(auditLogs).toHaveLength(0);
  });

  it('8. usuario responsable de su propia fila -> éxito', async () => {
    sesionActual = { id: JUAN.id, email: JUAN.email, rol: JUAN.rol, usuario: JUAN.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(res.status).toBe(200);
  });

  it('9. administrador funcional (Coordinador Comercial) autorizado aunque no esté asignado a la fila -> éxito', async () => {
    sesionActual = { id: COORDINADOR.id, email: COORDINADOR.email, rol: COORDINADOR.rol, usuario: COORDINADOR.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(res.status).toBe(200);
    expect(filaA().validadoPor).toBe('laura.buelvas');
  });

  it('10. solicitud inexistente -> 404', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), { params: Promise.resolve({ id: '999999' }) });
    expect(res.status).toBe(404);
  });

  it('11. fila inexistente -> 403 (mismo patrón que /reenviar-revision: la autorización por fila ya lo detecta antes de la transacción)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-INEXISTENTE', decisionObservaciones: 'aceptada' }), ctx());
    expect(res.status).toBe(403);
  });

  it('12. estado real distinto de EN_OBSERVACION -> 409, sin escribir nada', async () => {
    solicitud.estadoSolicitud = 'ASIGNADO_REVISION';
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(res.status).toBe(409);
    expect(solicitud.estadoSolicitud).toBe('ASIGNADO_REVISION');
    expect(auditLogs).toHaveLength(0);
  });

  it('13. estado global ambiguo -> 422', async () => {
    solicitud.estadoSolicitud = 'Asignado para revisión';
    solicitud.asignaciones = [
      { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'ASIGNADO_REVISION' },
      { idAsignacion: 'ASG-2', analistaAsignado: 'otro.usuario', estadoRevision: 'EN_REVISION' },
    ];
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(res.status).toBe(422);
    expect(auditLogs).toHaveLength(0);
  });

  it('14. validadoPor enviado por el cliente -> 400 (campo no permitido)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada', validadoPor: 'otro_usuario' }), ctx());
    expect(res.status).toBe(400);
    expect(solicitud.estadoSolicitud).toBe('EN_OBSERVACION');
  });

  it('15. fechaValidacion enviada por el cliente -> 400 (campo no permitido)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada', fechaValidacion: '2020-01-01T00:00:00.000Z' }), ctx());
    expect(res.status).toBe(400);
  });

  it('16. el AuditLog registra el actor real de sesión, nunca uno enviado por el cliente', async () => {
    const { POST } = await import('./route');
    await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(auditLogs[0].detalle).toMatchObject({ actorUsuario: 'juan.davila', actorRol: 'Analista Comercial' });
  });

  it('17. validadoPor queda reconstruido por el servidor (el usuario real de sesión), no por ningún valor del cliente', async () => {
    const { POST } = await import('./route');
    await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(filaA().validadoPor).toBe('juan.davila');
  });

  it('18. fechaValidacion queda generada por el servidor (string ISO válido, no vacío)', async () => {
    const { POST } = await import('./route');
    await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(filaA().fechaValidacion).toBeTruthy();
    expect(() => new Date(filaA().fechaValidacion as string).toISOString()).not.toThrow();
  });

  it('19. solo la fila objetivo cambia — decisionObservaciones/validadoPor/fechaValidacion/estadoRevision', async () => {
    const { POST } = await import('./route');
    await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(filaA()).toMatchObject({
      idAsignacion: 'ASG-1', estadoRevision: 'APROBADO_ELABORACION', decisionObservaciones: 'aceptada', validadoPor: 'juan.davila',
    });
  });

  it('20. una segunda asignación (B) permanece exactamente intacta tras aprobar A', async () => {
    const antesB = JSON.parse(JSON.stringify(filaB()));
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(res.status).toBe(200);
    expect(filaB()).toEqual(antesB);
    expect(filaB().estadoRevision).toBe('CON_OBSERVACIONES');
    expect(filaB().observaciones).toEqual([{ detalle: 'observación de B' }]);
    expect(filaB()).not.toHaveProperty('decisionObservaciones');
    expect(filaB()).not.toHaveProperty('validadoPor');
    expect(filaB()).not.toHaveProperty('fechaValidacion');
  });

  it('21. se registra AuditLog con el detalle mínimo requerido', async () => {
    const { POST } = await import('./route');
    await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({ accion: 'solicitud_finalizar_revision', recurso: 'solicitud', recursoId: '300' });
    expect(auditLogs[0].detalle).toMatchObject({
      solicitudId: 300, idAsignacion: 'ASG-1', accionFlujo: 'FINALIZAR_REVISION',
      estadoAnterior: 'EN_OBSERVACION', estadoNuevo: 'APROBADO_ELABORACION', decisionObservaciones: 'aceptada',
      actorUsuario: 'juan.davila', actorRol: 'Analista Comercial',
    });
  });

  it('22. ROLLBACK: si falla AuditLog.create, ni estadoSolicitud ni la fila ni las observaciones de B quedan modificados, y no queda AuditLog parcial', async () => {
    const antesSolicitud = JSON.parse(JSON.stringify(solicitud));
    fallarAuditLog = true;
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(res.status).toBe(500);
    expect(solicitud.estadoSolicitud).toBe('EN_OBSERVACION');
    expect(filaA().estadoRevision).toBe('CON_OBSERVACIONES');
    expect(filaA()).not.toHaveProperty('decisionObservaciones');
    expect(filaA()).not.toHaveProperty('validadoPor');
    expect(filaA()).not.toHaveProperty('fechaValidacion');
    expect(solicitud).toEqual(antesSolicitud);
    expect(auditLogs).toHaveLength(0);
  });

  it('23. segunda llamada tras una transición exitosa -> 409 (ya no está en EN_OBSERVACION)', async () => {
    const { POST } = await import('./route');
    const r1 = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(r1.status).toBe(200);
    const r2 = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(r2.status).toBe(409);
  });

  it('24. el CAS evita una doble transición: tras la primera, el estado real ya no coincide y la segunda no escribe nada adicional', async () => {
    const { POST } = await import('./route');
    await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    const estadoTrasR1 = solicitud.estadoSolicitud;
    const auditLenTrasR1 = auditLogs.length;
    await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    expect(solicitud.estadoSolicitud).toBe(estadoTrasR1);
    expect(auditLogs).toHaveLength(auditLenTrasR1);
  });

  it('25. regresión del flujo real: aprobar la observación de A termina en APROBADO_ELABORACION con los 3 datos de negocio persistidos y B sin tocar', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', decisionObservaciones: 'aceptada' }), ctx());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.solicitud.estadoSolicitud).toBe('APROBADO_ELABORACION');
    const filaAResp = (data.solicitud.asignaciones as Record<string, unknown>[])[0];
    const filaBResp = (data.solicitud.asignaciones as Record<string, unknown>[])[1];
    expect(filaAResp).toMatchObject({ decisionObservaciones: 'aceptada', validadoPor: 'juan.davila' });
    expect(filaBResp).toMatchObject(FILA_B_ORIGINAL);
  });
});
