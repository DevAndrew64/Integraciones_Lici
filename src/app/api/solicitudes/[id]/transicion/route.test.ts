/**
 * Integración de POST /api/solicitudes/[id]/transicion — mismo patrón de
 * fake-prisma que `cerrar/route.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Fase 2B-2.2.4 — espía sobre la implementación REAL de `ejecutarTransicionEstado`
// (nunca se sustituye su comportamiento) para poder demostrar que el guard
// de "FINALIZAR_REVISION" la rechaza ANTES de invocarla, sin alterar el
// comportamiento de las 8 acciones existentes.
const ejecutarTransicionEstadoSpy = vi.fn();
vi.mock('@/lib/solicitudes/transiciones-estado', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/solicitudes/transiciones-estado')>();
  return {
    ...original,
    ejecutarTransicionEstado: (...args: Parameters<typeof original.ejecutarTransicionEstado>) => {
      ejecutarTransicionEstadoSpy(...args);
      return original.ejecutarTransicionEstado(...args);
    },
  };
});

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
const JUAN: UsuarioFake = { id: 10, usuario: 'juan.davila', email: 'juan.davila@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const AJENO: UsuarioFake = { id: 11, usuario: 'ajeno', email: 'ajeno@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const INACTIVO: UsuarioFake = { id: 12, usuario: 'inactivo', email: 'inactivo@grupocolba.com', rol: 'Analista Comercial', estado: 'Inactivo' };
const COORDINADOR: UsuarioFake = { id: 5, usuario: 'laura.buelvas', email: 'laura.buelvas@grupocolba.com', rol: 'Coordinador Comercial', estado: 'Activo' };

let usuarios: UsuarioFake[] = [JUAN, AJENO, INACTIVO, COORDINADOR];
let solicitud: Record<string, unknown>;
let auditLogs: Array<Record<string, unknown>> = [];
let sesionActual: { id: number; email: string; rol: string; usuario: string } | null = { id: JUAN.id, email: JUAN.email, rol: JUAN.rol, usuario: JUAN.usuario };

function resetFixture() {
  solicitud = {
    id: 300, estadoSolicitud: 'ASIGNADO_REVISION', procesoId: 55,
    asignaciones: [{ idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila' }],
  };
  auditLogs = [];
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
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));

function req(body: unknown = {}) {
  return new NextRequest('http://localhost/api/solicitudes/300/transicion', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '300' }) }; }

describe('POST /api/solicitudes/[id]/transicion', () => {
  beforeEach(resetFixture);
  beforeEach(() => { ejecutarTransicionEstadoSpy.mockClear(); });

  it('transición válida devuelve 200 y el estado nuevo', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ accion: 'INICIAR_REVISION', estadoEsperado: 'ASIGNADO_REVISION' }), ctx());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.estadoNuevo).toBe('EN_REVISION');
    expect(solicitud.estadoSolicitud).toBe('EN_REVISION');
    expect(auditLogs).toHaveLength(1);
  });

  it('sin sesión → 401', async () => {
    sesionActual = null;
    const { POST } = await import('./route');
    const res = await POST(req({ accion: 'INICIAR_REVISION', estadoEsperado: 'ASIGNADO_REVISION' }), ctx());
    expect(res.status).toBe(401);
  });

  it('usuario inactivo → 403', async () => {
    sesionActual = { id: INACTIVO.id, email: INACTIVO.email, rol: INACTIVO.rol, usuario: INACTIVO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ accion: 'INICIAR_REVISION', estadoEsperado: 'ASIGNADO_REVISION' }), ctx());
    expect(res.status).toBe(403);
  });

  it('usuario activo, no asignado, sin rol privilegiado → 403', async () => {
    sesionActual = { id: AJENO.id, email: AJENO.email, rol: AJENO.rol, usuario: AJENO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ accion: 'INICIAR_REVISION', estadoEsperado: 'ASIGNADO_REVISION' }), ctx());
    expect(res.status).toBe(403);
    expect(solicitud.estadoSolicitud).toBe('ASIGNADO_REVISION');
  });

  it('Coordinador Comercial autorizado aunque no esté asignado', async () => {
    sesionActual = { id: COORDINADOR.id, email: COORDINADOR.email, rol: COORDINADOR.rol, usuario: COORDINADOR.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ accion: 'INICIAR_REVISION', estadoEsperado: 'ASIGNADO_REVISION' }), ctx());
    expect(res.status).toBe(200);
  });

  it('acción desconocida → 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ accion: 'ACCION_INVENTADA', estadoEsperado: 'ASIGNADO_REVISION' }), ctx());
    expect(res.status).toBe(400);
  });

  it('segunda transición con estadoEsperado desactualizado → 409, no sobrescribe', async () => {
    const { POST } = await import('./route');
    const r1 = await POST(req({ accion: 'INICIAR_REVISION', estadoEsperado: 'ASIGNADO_REVISION' }), ctx());
    expect(r1.status).toBe(200);
    const r2 = await POST(req({ accion: 'INICIAR_REVISION', estadoEsperado: 'ASIGNADO_REVISION' }), ctx());
    expect(r2.status).toBe(409);
    const data2 = await r2.json();
    expect(data2.error).toContain('actualizado por otro usuario');
    expect(solicitud.estadoSolicitud).toBe('EN_REVISION');
  });

  it('estado histórico ambiguo (asignaciones activas con estadoRevision contradictorios) → 422', async () => {
    solicitud.estadoSolicitud = 'Asignado para revisión'; // legado — dispara la desambiguación por filas
    solicitud.asignaciones = [
      { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'ASIGNADO_REVISION' },
      { idAsignacion: 'ASG-2', analistaAsignado: 'otro.usuario', estadoRevision: 'EN_REVISION' },
    ];
    const { POST } = await import('./route');
    const res = await POST(req({ accion: 'INICIAR_REVISION', estadoEsperado: 'ASIGNADO_REVISION' }), ctx());
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toMatch(/ambiguo/i);
    expect(solicitud.estadoSolicitud).toBe('Asignado para revisión');
    expect(auditLogs).toHaveLength(0);
  });

  it('rechaza estadoNuevo arbitrario en el body (campo no permitido)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ accion: 'INICIAR_REVISION', estadoEsperado: 'ASIGNADO_REVISION', estadoNuevo: 'CERRADA' }), ctx());
    expect(res.status).toBe(400);
    expect(solicitud.estadoSolicitud).toBe('ASIGNADO_REVISION');
  });

  it('ignora actor/usuario/rol falsos enviados por el cliente (campo no permitido → 400, nunca se usan)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ accion: 'INICIAR_REVISION', estadoEsperado: 'ASIGNADO_REVISION', actor: 'admin-falso', rol: 'Administrador' }), ctx());
    expect(res.status).toBe(400);
  });

  it('rechaza asignaciones[] completo en el body (campo no permitido)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ accion: 'INICIAR_REVISION', estadoEsperado: 'ASIGNADO_REVISION', asignaciones: [] }), ctx());
    expect(res.status).toBe(400);
  });

  it('transición inválida no genera AuditLog', async () => {
    const { POST } = await import('./route');
    await POST(req({ accion: 'PRESENTAR', estadoEsperado: 'ASIGNADO_REVISION' }), ctx());
    expect(auditLogs).toHaveLength(0);
  });

  it('el AuditLog registra el actor real de sesión, no ninguno enviado por el cliente', async () => {
    const { POST } = await import('./route');
    await POST(req({ accion: 'INICIAR_REVISION', estadoEsperado: 'ASIGNADO_REVISION' }), ctx());
    expect(auditLogs[0].detalle).toMatchObject({ actorUsuario: 'juan.davila', actorRol: 'Analista Comercial' });
  });

  // Fase 2B-2.2.4 — cierre del bypass de FINALIZAR_REVISION vía este
  // endpoint genérico. La única autoridad para esta transición pasa a ser
  // POST /api/solicitudes/[id]/finalizar-revision (Fase 2B-2.2.1).
  describe('FINALIZAR_REVISION — rechazo estructural (Fase 2B-2.2.4)', () => {
    it('1. FINALIZAR_REVISION -> 400, indicando el endpoint dedicado', async () => {
      const { POST } = await import('./route');
      const res = await POST(req({ accion: 'FINALIZAR_REVISION', estadoEsperado: 'EN_OBSERVACION' }), ctx());
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('/api/solicitudes/[id]/finalizar-revision');
    });

    it('2. el rechazo ocurre incluso cuando la Solicitud SÍ está en EN_OBSERVACION y el actor SÍ está autorizado', async () => {
      solicitud.estadoSolicitud = 'EN_OBSERVACION'; // estado real correcto para la transición
      sesionActual = { id: JUAN.id, email: JUAN.email, rol: JUAN.rol, usuario: JUAN.usuario }; // dueño de la única fila, autorizado
      const { POST } = await import('./route');
      const res = await POST(req({ accion: 'FINALIZAR_REVISION', estadoEsperado: 'EN_OBSERVACION' }), ctx());
      expect(res.status).toBe(400);
      // Ni el estado real coincidente ni la autorización real cambian el resultado.
      expect(solicitud.estadoSolicitud).toBe('EN_OBSERVACION');
    });

    it('3. con 2 asignaciones, ninguna fila cambia (nunca se espeja APROBADO_ELABORACION)', async () => {
      solicitud.estadoSolicitud = 'EN_OBSERVACION';
      solicitud.asignaciones = [
        { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'CON_OBSERVACIONES' },
        { idAsignacion: 'ASG-2', analistaAsignado: 'otro.usuario', estadoRevision: 'CON_OBSERVACIONES' },
      ];
      const antesAsignaciones = JSON.parse(JSON.stringify(solicitud.asignaciones));
      const { POST } = await import('./route');
      const res = await POST(req({ accion: 'FINALIZAR_REVISION', estadoEsperado: 'EN_OBSERVACION' }), ctx());
      expect(res.status).toBe(400);
      expect(solicitud.asignaciones).toEqual(antesAsignaciones);
    });

    it('4. no se genera ningún AuditLog', async () => {
      solicitud.estadoSolicitud = 'EN_OBSERVACION';
      const { POST } = await import('./route');
      await POST(req({ accion: 'FINALIZAR_REVISION', estadoEsperado: 'EN_OBSERVACION' }), ctx());
      expect(auditLogs).toHaveLength(0);
    });

    it('5. regresión: INICIAR_REVISION (otra acción válida) sigue funcionando exactamente igual — el bloqueo es exclusivo de FINALIZAR_REVISION', async () => {
      const { POST } = await import('./route');
      const res = await POST(req({ accion: 'INICIAR_REVISION', estadoEsperado: 'ASIGNADO_REVISION' }), ctx());
      expect(res.status).toBe(200);
      expect(solicitud.estadoSolicitud).toBe('EN_REVISION');
      expect(auditLogs).toHaveLength(1);
    });

    it('6. ejecutarTransicionEstado NUNCA se invoca para FINALIZAR_REVISION, pero SÍ se invoca normalmente para otras acciones', async () => {
      const { POST } = await import('./route');

      await POST(req({ accion: 'FINALIZAR_REVISION', estadoEsperado: 'EN_OBSERVACION' }), ctx());
      expect(ejecutarTransicionEstadoSpy).not.toHaveBeenCalled();

      await POST(req({ accion: 'INICIAR_REVISION', estadoEsperado: 'ASIGNADO_REVISION' }), ctx());
      expect(ejecutarTransicionEstadoSpy).toHaveBeenCalledTimes(1);
      expect(ejecutarTransicionEstadoSpy).toHaveBeenCalledWith(expect.objectContaining({ accion: 'INICIAR_REVISION' }));
    });
  });

  // Fase 2B-2.2.6 — cierre del bypass de ENVIAR_A_OBSERVACION vía este
  // endpoint genérico. La única autoridad para esta transición pasa a ser
  // POST /api/solicitudes/[id]/observaciones.
  describe('ENVIAR_A_OBSERVACION — rechazo estructural (Fase 2B-2.2.6)', () => {
    it('1. ENVIAR_A_OBSERVACION -> 400, indicando el endpoint dedicado', async () => {
      const { POST } = await import('./route');
      const res = await POST(req({ accion: 'ENVIAR_A_OBSERVACION', estadoEsperado: 'EN_REVISION' }), ctx());
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('/api/solicitudes/[id]/observaciones');
    });

    it('2. el rechazo ocurre incluso cuando la Solicitud SÍ está en EN_REVISION y el actor SÍ está autorizado', async () => {
      solicitud.estadoSolicitud = 'EN_REVISION';
      sesionActual = { id: JUAN.id, email: JUAN.email, rol: JUAN.rol, usuario: JUAN.usuario };
      const { POST } = await import('./route');
      const res = await POST(req({ accion: 'ENVIAR_A_OBSERVACION', estadoEsperado: 'EN_REVISION' }), ctx());
      expect(res.status).toBe(400);
      expect(solicitud.estadoSolicitud).toBe('EN_REVISION');
    });

    it('3. ejecutarTransicionEstado NUNCA se invoca para ENVIAR_A_OBSERVACION', async () => {
      const { POST } = await import('./route');
      await POST(req({ accion: 'ENVIAR_A_OBSERVACION', estadoEsperado: 'EN_REVISION' }), ctx());
      expect(ejecutarTransicionEstadoSpy).not.toHaveBeenCalled();
    });

    it('4. no se modifica la Solicitud en BD', async () => {
      solicitud.estadoSolicitud = 'EN_REVISION';
      const antes = JSON.parse(JSON.stringify(solicitud));
      const { POST } = await import('./route');
      await POST(req({ accion: 'ENVIAR_A_OBSERVACION', estadoEsperado: 'EN_REVISION' }), ctx());
      expect(solicitud).toEqual(antes);
    });

    it('5. no se genera ningún AuditLog', async () => {
      solicitud.estadoSolicitud = 'EN_REVISION';
      const { POST } = await import('./route');
      await POST(req({ accion: 'ENVIAR_A_OBSERVACION', estadoEsperado: 'EN_REVISION' }), ctx());
      expect(auditLogs).toHaveLength(0);
    });

    it('6. regresión: una acción distinta (INICIAR_REVISION) sigue funcionando exactamente igual — el bloqueo es exclusivo de ENVIAR_A_OBSERVACION', async () => {
      const { POST } = await import('./route');
      const res = await POST(req({ accion: 'INICIAR_REVISION', estadoEsperado: 'ASIGNADO_REVISION' }), ctx());
      expect(res.status).toBe(200);
      expect(solicitud.estadoSolicitud).toBe('EN_REVISION');
      expect(auditLogs).toHaveLength(1);
    });
  });

  // Fase 2B-2.2.7 — cierre del bypass de REENVIAR_REVISION vía este
  // endpoint genérico. La única autoridad para esta transición pasa a ser
  // POST /api/solicitudes/[id]/reenviar-revision.
  describe('REENVIAR_REVISION — rechazo estructural (Fase 2B-2.2.7)', () => {
    it('1. REENVIAR_REVISION -> 400, indicando el endpoint dedicado', async () => {
      const { POST } = await import('./route');
      const res = await POST(req({ accion: 'REENVIAR_REVISION', estadoEsperado: 'EN_OBSERVACION' }), ctx());
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('/api/solicitudes/[id]/reenviar-revision');
    });

    it('2. el rechazo ocurre incluso cuando la Solicitud SÍ está en EN_OBSERVACION y el actor SÍ está autorizado', async () => {
      solicitud.estadoSolicitud = 'EN_OBSERVACION';
      sesionActual = { id: JUAN.id, email: JUAN.email, rol: JUAN.rol, usuario: JUAN.usuario };
      const { POST } = await import('./route');
      const res = await POST(req({ accion: 'REENVIAR_REVISION', estadoEsperado: 'EN_OBSERVACION' }), ctx());
      expect(res.status).toBe(400);
      expect(solicitud.estadoSolicitud).toBe('EN_OBSERVACION');
    });

    it('3. ejecutarTransicionEstado NUNCA se invoca para REENVIAR_REVISION', async () => {
      const { POST } = await import('./route');
      await POST(req({ accion: 'REENVIAR_REVISION', estadoEsperado: 'EN_OBSERVACION' }), ctx());
      expect(ejecutarTransicionEstadoSpy).not.toHaveBeenCalled();
    });

    it('4. no se modifica la Solicitud en BD', async () => {
      solicitud.estadoSolicitud = 'EN_OBSERVACION';
      const antes = JSON.parse(JSON.stringify(solicitud));
      const { POST } = await import('./route');
      await POST(req({ accion: 'REENVIAR_REVISION', estadoEsperado: 'EN_OBSERVACION' }), ctx());
      expect(solicitud).toEqual(antes);
    });

    it('5. no se genera ningún AuditLog', async () => {
      solicitud.estadoSolicitud = 'EN_OBSERVACION';
      const { POST } = await import('./route');
      await POST(req({ accion: 'REENVIAR_REVISION', estadoEsperado: 'EN_OBSERVACION' }), ctx());
      expect(auditLogs).toHaveLength(0);
    });

    it('6. regresión: una acción distinta (INICIAR_REVISION) sigue funcionando exactamente igual — el bloqueo es exclusivo de REENVIAR_REVISION', async () => {
      const { POST } = await import('./route');
      const res = await POST(req({ accion: 'INICIAR_REVISION', estadoEsperado: 'ASIGNADO_REVISION' }), ctx());
      expect(res.status).toBe(200);
      expect(solicitud.estadoSolicitud).toBe('EN_REVISION');
      expect(auditLogs).toHaveLength(1);
    });
  });
});