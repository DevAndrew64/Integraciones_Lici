/**
 * Integración real de POST /api/solicitudes/[id]/cerrar — cierre
 * concurrente-seguro. Nunca invoca la API externa de SQR real (no hay
 * ningún `fetch` a un dominio externo en este endpoint — verificado por
 * diseño, ver comentario en route.ts) — para blindar la prueba de todos
 * modos se stubea `global.fetch` para que reventar en llamar sería visible.
 *
 * Los payloads de `filaExtra` usados aquí reproducen EXACTAMENTE el flujo
 * real de "resultado del proceso: adjudicado" (page.tsx ~17382), que es el
 * único de los 4 flujos de cierre que no requiere adjuntar evidencia u
 * otros campos opcionales — se usa como caso representativo en los tests
 * genéricos de autorización/concurrencia. Los demás flujos (RECHAZADO,
 * CANCELADO/CERRADO_NO_CUMPLIMIENTO) y la validación estricta del payload
 * se cubren en route.seguridad.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
const OSCAR: UsuarioFake = { id: 101, usuario: 'oscar.pallares', email: 'oscar.pallares@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const NICOLE: UsuarioFake = { id: 102, usuario: 'nicole.ortiz', email: 'nicole.ortiz@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const ADMIN: UsuarioFake = { id: 1, usuario: 'admin1', email: 'admin1@grupocolba.com', rol: 'admin', estado: 'Activo' };
const COORDINADOR: UsuarioFake = { id: 5, usuario: 'laura.buelvas', email: 'laura.buelvas@grupocolba.com', rol: 'Coordinador Comercial', estado: 'Activo' };
const DIRECTOR: UsuarioFake = { id: 6, usuario: 'ricardo.mejia', email: 'ricardo.mejia@grupocolba.com', rol: 'Director Comercial', estado: 'Activo' };

let usuarios: UsuarioFake[] = [OSCAR, NICOLE, ADMIN, COORDINADOR, DIRECTOR];
let solicitud: Record<string, unknown>;
let auditLogs: Array<Record<string, unknown>> = [];
let sesionActual: { id: number; email: string; rol: string; usuario: string } = { id: OSCAR.id, email: OSCAR.email, rol: OSCAR.rol, usuario: OSCAR.usuario };

function resetFixture() {
  solicitud = {
    id: 217, estadoSolicitud: 'En evaluación', resultadoFinal: null, causalCierre: null,
    asignaciones: [
      { idAsignacion: 'ASG-1', analistaAsignado: 'oscar.pallares' },
      { idAsignacion: 'ASG-2', analistaAsignado: 'nicole.ortiz' },
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
    async updateMany({ where, data }: { where: { id: number; estadoSolicitud?: { notIn: string[] } }; data: Record<string, unknown> }) {
      if (where.id !== solicitud.id) return { count: 0 };
      const estadoActual = String(solicitud.estadoSolicitud);
      if (where.estadoSolicitud?.notIn?.includes(estadoActual)) {
        return { count: 0 }; // CAS: ya está en un estado excluido — no se escribe nada
      }
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
  return new NextRequest('http://localhost/api/solicitudes/217/cerrar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '217' }) }; }

/** Payload real del flujo "resultado del proceso: adjudicado" (page.tsx ~17382). */
function cierreAdjudicado(idAsignacion: string) {
  return {
    idAsignacion, resultadoEstado: 'Cerrada',
    filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', observacionResultado: 'Justificación de prueba.', cerradoPor: 'valor-cliente-ignorado' },
  };
}

describe('POST /api/solicitudes/[id]/cerrar', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    resetFixture();
    fetchSpy = vi.fn(async () => { throw new Error('No debería llamarse ningún fetch externo desde este endpoint'); });
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('Ajuste "NO EXPONER ERRORES INTERNOS AL USUARIO" — una excepción inesperada (p.ej. de Prisma) nunca se reenvía al cliente, solo un mensaje genérico (500)', async () => {
    const original = fakeImpl.solicitud.updateMany;
    fakeImpl.solicitud.updateMany = async () => {
      throw new Error('Unique constraint failed on the fields: (`detalle_interno_de_prisma`)');
    };
    try {
      const { POST } = await import('./route');
      const res = await POST(req(cierreAdjudicado('ASG-1')), ctx());
      const data = await res.json();
      expect(res.status).toBe(500);
      expect(data.ok).toBe(false);
      expect(data.error).toBe('No fue posible procesar el cierre en este momento. Intenta nuevamente o contacta al administrador.');
      expect(data.error).not.toContain('Prisma');
      expect(data.error).not.toContain('constraint');
      expect(data.error).not.toContain('detalle_interno_de_prisma');
    } finally {
      fakeImpl.solicitud.updateMany = original;
    }
  });

  it('el primer responsable (oscar) puede cerrar', async () => {
    const { POST } = await import('./route');
    const res = await POST(req(cierreAdjudicado('ASG-1')), ctx());
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
  });

  it('el segundo/último responsable (nicole) puede cerrar igual que el primero, mientras siga abierta', async () => {
    sesionActual = { id: NICOLE.id, email: NICOLE.email, rol: NICOLE.rol, usuario: NICOLE.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(cierreAdjudicado('ASG-2')), ctx());
    expect(res.status).toBe(200);
  });

  it('usuario no asignado no puede cerrar (403)', async () => {
    sesionActual = { id: 999, email: 'ajeno@x.com', rol: 'Analista Comercial', usuario: 'ajeno' };
    usuarios = [...usuarios, { id: 999, usuario: 'ajeno', email: 'ajeno@x.com', rol: 'Analista Comercial', estado: 'Activo' }];
    const { POST } = await import('./route');
    const res = await POST(req({}), ctx());
    expect(res.status).toBe(403);
    expect(solicitud.estadoSolicitud).toBe('En evaluación'); // sin cambios
  });

  it('administrador conserva su permiso de cerrar aunque no esté asignado', async () => {
    sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({}), ctx());
    expect(res.status).toBe(200);
  });

  // Ajuste "Director Comercial y Coordinador Comercial como administradores
  // funcionales de TODO el módulo Procesos" — reemplaza la prueba anterior
  // ("coordinador NO cierra"): ahora cierra cualquier solicitud igual que
  // un Administrador, esté o no asignado como responsable.
  it('coordinador SÍ cierra cualquier solicitud aunque no esté asignado (administrador funcional de Procesos)', async () => {
    sesionActual = { id: COORDINADOR.id, email: COORDINADOR.email, rol: COORDINADOR.rol, usuario: COORDINADOR.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({}), ctx());
    expect(res.status).toBe(200);
  });

  it('director SÍ cierra cualquier solicitud aunque no esté asignado (administrador funcional de Procesos)', async () => {
    sesionActual = { id: DIRECTOR.id, email: DIRECTOR.email, rol: DIRECTOR.rol, usuario: DIRECTOR.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({}), ctx());
    expect(res.status).toBe(200);
  });

  it('director cierra apuntando a la fila de otro responsable (filaExtra sobre ASG-1, sin ser el responsable) — permitido', async () => {
    sesionActual = { id: DIRECTOR.id, email: DIRECTOR.email, rol: DIRECTOR.rol, usuario: DIRECTOR.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(cierreAdjudicado('ASG-1')), ctx());
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
  });

  it('dos cierres simultáneos (secuenciales, mismo estado de partida) producen un solo cierre efectivo y un 409', async () => {
    const { POST } = await import('./route');
    const res1 = await POST(req(cierreAdjudicado('ASG-1')), ctx());
    sesionActual = { id: NICOLE.id, email: NICOLE.email, rol: NICOLE.rol, usuario: NICOLE.usuario };
    const res2 = await POST(req(cierreAdjudicado('ASG-2')), ctx());
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(409);
    const data2 = await res2.json();
    expect(data2.error).toBe('La solicitud ya fue cerrada por otro usuario.');
  });

  it('el segundo intento perdedor no genera un segundo AuditLog de cierre', async () => {
    const { POST } = await import('./route');
    await POST(req(cierreAdjudicado('ASG-1')), ctx());
    sesionActual = { id: NICOLE.id, email: NICOLE.email, rol: NICOLE.rol, usuario: NICOLE.usuario };
    await POST(req(cierreAdjudicado('ASG-2')), ctx());
    const cierres = auditLogs.filter((a) => a.accion === 'solicitud_cerrar');
    expect(cierres).toHaveLength(1);
    expect((cierres[0].detalle as any).cerradoPor).toBe('oscar.pallares'); // el ganador, no sobrescrito
  });

  it('no se realiza ninguna llamada a fetch externo (SQR) durante el cierre', async () => {
    const { POST } = await import('./route');
    await POST(req(cierreAdjudicado('ASG-1')), ctx());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rechaza cerrar una solicitud ya cerrada (409) sin duplicar nada', async () => {
    solicitud.estadoSolicitud = 'Cerrada';
    const { POST } = await import('./route');
    const res = await POST(req({}), ctx());
    expect(res.status).toBe(409);
    expect(auditLogs).toHaveLength(0);
  });

  it('actualiza también la fila del responsable que cierra cuando se manda idAsignacion + filaExtra, y el autor real (no el que mandó el cliente) queda registrado', async () => {
    const { POST } = await import('./route');
    const res = await POST(req(cierreAdjudicado('ASG-1')), ctx());
    const data = await res.json();
    const fila = (data.solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-1');
    expect(fila.estadoRevision).toBe('CERRADO_ADJUDICADO');
    expect(fila.resultadoFinal).toBe('Adjudicado');
    expect(fila.cerradoPor).toBe('oscar.pallares'); // NUNCA "valor-cliente-ignorado"
    const otraFila = (data.solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-2');
    expect(otraFila.estadoRevision).toBeUndefined(); // la fila del otro responsable no se tocó
  });
});