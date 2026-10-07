/**
 * Bloque 0 de contención — PATCH /api/solicitudes/[id].
 * Integración real del handler exportado, con `@/lib/prisma`/`@/lib/session`
 * mockeados. Cubre el caso de regresión del Caso A (estadoSolicitud
 * "Asignado para revisión" con asignaciones:[] producido por este endpoint)
 * y los dos contratos legítimos que sobreviven: guardar fechaEntregaInfo y
 * eliminar una entrada del historial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
const DUENO: UsuarioFake = { id: 101, usuario: 'andrea.calderin', email: 'andrea.calderin@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const AJENO: UsuarioFake = { id: 102, usuario: 'usuario.ajeno', email: 'usuario.ajeno@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const ADMIN: UsuarioFake = { id: 1, usuario: 'admin1', email: 'admin1@grupocolba.com', rol: 'Administrador', estado: 'Activo' };

let usuarios: UsuarioFake[] = [];
let solicitud: Record<string, unknown>;
let auditLogs: Array<Record<string, unknown>> = [];
let sesionActual: { id: number; email: string; rol: string; usuario: string } | null = null;

function resetFixture() {
  usuarios = [DUENO, AJENO, ADMIN];
  solicitud = {
    id: 258,
    estadoSolicitud: 'Asignado para revisión',
    asignaciones: [{ idAsignacion: 'ASG-1', analistaAsignado: 'andrea.calderin' }],
    usuarioRegistro: 'andrea.calderin',
    emailRegistro: 'andrea.calderin@grupocolba.com',
    aprobador: null,
    revisor: null,
    fechaEntregaInfo: new Date('2026-07-01T12:00:00.000Z'),
    procData: {
      fechaEntregaHistorial: [
        { fecha: '2026-07-01', por: 'andrea.calderin@grupocolba.com', en: '2026-07-01T10:00:00.000Z' },
        { fecha: '2026-06-20', por: 'andrea.calderin@grupocolba.com', en: '2026-06-20T10:00:00.000Z' },
      ],
    },
  };
  auditLogs = [];
  sesionActual = { id: DUENO.id, email: DUENO.email, rol: DUENO.rol, usuario: DUENO.usuario };
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
      if (where.id !== solicitud.id) return null;
      return {
        ...solicitud,
        asignaciones: JSON.parse(JSON.stringify(solicitud.asignaciones)),
        procData: JSON.parse(JSON.stringify(solicitud.procData)),
      };
    },
    async update({ where, data }: { where: { id: number }; data: Record<string, unknown> }) {
      if (where.id !== solicitud.id) throw new Error('no encontrada');
      solicitud = { ...solicitud, ...data };
      return {
        ...solicitud,
        asignaciones: JSON.parse(JSON.stringify(solicitud.asignaciones)),
        procData: JSON.parse(JSON.stringify(solicitud.procData)),
      };
    },
  },
  auditLog: {
    async create({ data }: { data: Record<string, unknown> }) {
      auditLogs.push(data);
      return { id: auditLogs.length, ...data };
    },
  },
  async $transaction<T>(cb: (tx: unknown) => Promise<T>): Promise<T> {
    return cb(fakeImpl);
  },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({
  getSession: async () => sesionActual,
}));

function req(body: unknown) {
  return new NextRequest('http://localhost/api/solicitudes/258', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx(id = '258') {
  return { params: Promise.resolve({ id }) };
}

describe('PATCH /api/solicitudes/[id] — Bloque 0 de contención', () => {
  beforeEach(() => resetFixture());

  it('Caso 1 — regresión del Caso A: estadoSolicitud + asignaciones:[] se rechaza con 400, sin mutar nada', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ estadoSolicitud: 'Asignado para revisión', asignaciones: [] }), ctx());
    expect(res.status).toBe(400);
    expect(solicitud.estadoSolicitud).toBe('Asignado para revisión');
    expect((solicitud.asignaciones as unknown[]).length).toBe(1);
    expect(auditLogs.filter((a) => a.detalle && (a.detalle as any).resultado === 'ok')).toHaveLength(0);
  });

  it('Caso 2 — solo estadoSolicitud: 400, sin mutación', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ estadoSolicitud: 'Asignado para revisión' }), ctx());
    expect(res.status).toBe(400);
    expect(solicitud.estadoSolicitud).toBe('Asignado para revisión');
  });

  it('Caso 3 — solo asignaciones: 400, sin mutación', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ asignaciones: [] }), ctx());
    expect(res.status).toBe(400);
    expect((solicitud.asignaciones as unknown[]).length).toBe(1);
  });

  it('Caso 4 — campo permitido (fechaEntregaInfo): 200, solo cambia ese campo, AuditLog, respuesta sin JSON pesado', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ fechaEntregaInfo: '2026-08-01', registradoPor: 'andrea.calderin@grupocolba.com' }), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.fechaEntregaInfo).toContain('2026-08-01');
    expect(data.solicitud).toBeUndefined();
    expect(data.docData).toBeUndefined();
    expect(data.procData).toBeUndefined();
    expect(data.obsData).toBeUndefined();
    // el resto de la fila no cambia
    expect(solicitud.estadoSolicitud).toBe('Asignado para revisión');
    expect((solicitud.asignaciones as unknown[]).length).toBe(1);
    // el historial creció con la nueva entrada al frente
    const hist = (solicitud.procData as any).fechaEntregaHistorial;
    expect(hist[0].fecha).toBe('2026-08-01');
    expect(hist).toHaveLength(3);
    const log = auditLogs.find((a) => a.accion === 'solicitud_fecha_entrega_info_update');
    expect(log).toBeTruthy();
    expect((log!.detalle as any).valorAnterior).toBe('2026-07-01');
    expect((log!.detalle as any).valorNuevo).toBe('2026-08-01');
  });

  it('Caso 5 — campo permitido + campo no autorizado: 400, no aplica parcialmente', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ fechaEntregaInfo: '2026-08-01', estadoSolicitud: 'Cerrada' }), ctx());
    expect(res.status).toBe(400);
    expect(solicitud.fechaEntregaInfo).toBeInstanceOf(Date);
    expect((solicitud.fechaEntregaInfo as Date).toISOString()).toContain('2026-07-01');
    expect(solicitud.estadoSolicitud).toBe('Asignado para revisión');
  });

  it('Caso 6 — sin sesión: 401', async () => {
    sesionActual = null;
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ fechaEntregaInfo: '2026-08-01' }), ctx());
    expect(res.status).toBe(401);
  });

  it('Caso 7 — usuario autenticado sin acceso a esta solicitud: 403', async () => {
    sesionActual = { id: AJENO.id, email: AJENO.email, rol: AJENO.rol, usuario: AJENO.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ fechaEntregaInfo: '2026-08-01' }), ctx());
    expect(res.status).toBe(403);
  });

  it('Caso 8 — solicitud inexistente: 404', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ fechaEntregaInfo: '2026-08-01' }), ctx('999999'));
    expect(res.status).toBe(404);
  });

  it('Caso 9 — payload vacío: 400', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(req({}), ctx());
    expect(res.status).toBe(400);
  });

  it('Caso 10 — valor inválido (tipo incorrecto): 400, sin mutación', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ fechaEntregaInfo: 12345 }), ctx());
    expect(res.status).toBe(400);
    expect((solicitud.fechaEntregaInfo as Date).toISOString()).toContain('2026-07-01');
  });

  it('Caso 10b — valor inválido (formato de fecha incorrecto): 400', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ fechaEntregaInfo: '01/08/2026' }), ctx());
    expect(res.status).toBe(400);
  });

  it('admin también puede usar el camino legítimo (isAdmin bypassa canAccessSolicitud, no las validaciones de payload)', async () => {
    sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ estadoSolicitud: 'Cerrada' }), ctx());
    expect(res.status).toBe(400); // sigue rechazando estadoSolicitud aunque sea admin
  });

  describe('eliminarEntradaHistorial', () => {
    it('elimina la entrada correcta cuando valorEsperado coincide, recalcula fechaEntregaInfo desde la entrada restante más reciente', async () => {
      const { PATCH } = await import('./route');
      const res = await PATCH(req({ eliminarEntradaHistorial: { indice: 0, valorEsperado: '2026-07-01' } }), ctx());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.fechaEntregaHistorial).toHaveLength(1);
      expect(data.fechaEntregaHistorial[0].fecha).toBe('2026-06-20');
      expect(data.fechaEntregaInfo).toContain('2026-06-20');
      const log = auditLogs.find((a) => a.accion === 'solicitud_fecha_entrega_info_historial_delete');
      expect(log).toBeTruthy();
      expect((log!.detalle as any).indiceEliminado).toBe(0);
      expect((log!.detalle as any).valorEliminado).toBe('2026-07-01');
      // no se registró el procData completo, solo el valor puntual
      expect((log!.detalle as any).procData).toBeUndefined();
    });

    it('fechaEntregaInfo queda null si se elimina la última entrada del historial', async () => {
      solicitud.procData = { fechaEntregaHistorial: [{ fecha: '2026-07-01', por: 'x', en: 'y' }] };
      const { PATCH } = await import('./route');
      const res = await PATCH(req({ eliminarEntradaHistorial: { indice: 0, valorEsperado: '2026-07-01' } }), ctx());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.fechaEntregaHistorial).toHaveLength(0);
      expect(data.fechaEntregaInfo).toBeNull();
    });

    it('CAS: valorEsperado desactualizado → 409, no modifica nada', async () => {
      const { PATCH } = await import('./route');
      const res = await PATCH(req({ eliminarEntradaHistorial: { indice: 0, valorEsperado: '2020-01-01' } }), ctx());
      expect(res.status).toBe(409);
      expect((solicitud.procData as any).fechaEntregaHistorial).toHaveLength(2);
    });

    it('índice fuera de rango: 400, no modifica nada', async () => {
      const { PATCH } = await import('./route');
      const res = await PATCH(req({ eliminarEntradaHistorial: { indice: 99, valorEsperado: null } }), ctx());
      expect(res.status).toBe(400);
      expect((solicitud.procData as any).fechaEntregaHistorial).toHaveLength(2);
    });

    it('rechaza procData crudo enviado por el cliente', async () => {
      const { PATCH } = await import('./route');
      const res = await PATCH(req({ eliminarEntradaHistorial: { indice: 0, valorEsperado: '2026-07-01' }, procData: { inventado: true } }), ctx());
      expect(res.status).toBe(400);
    });

    it('no permite mezclar fechaEntregaInfo y eliminarEntradaHistorial en el mismo request', async () => {
      const { PATCH } = await import('./route');
      const res = await PATCH(req({ fechaEntregaInfo: '2026-08-01', eliminarEntradaHistorial: { indice: 0, valorEsperado: '2026-07-01' } }), ctx());
      expect(res.status).toBe(400);
    });
  });
});