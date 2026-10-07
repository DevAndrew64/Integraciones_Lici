/**
 * Ajuste "RECHAZO PRIVADO — DIRECTOR/COORDINADOR COMERCIAL" — verifica que
 * `POST /api/solicitudes/[id]/cerrar` (la autoridad REAL, no la UI) amplía
 * el permiso de RECHAZAR (únicamente esa rama, `estadoRevision:'RECHAZADO'`)
 * a Director/Coordinador Comercial sobre procesos Privados, sin tocar
 * ningún otro resultado terminal (Adjudicado/No adjudicado/Cancelado/
 * Cerrar sin presentar) ni el comportamiento en procesos Públicos.
 *
 * Mismo patrón de fixture/mock que `route.permisos-alias-fuente.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
const ANALISTA_COMERCIAL: UsuarioFake = { id: 101, usuario: 'oscar.pallares', email: 'oscar.pallares@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const DIRECTOR_COMERCIAL: UsuarioFake = { id: 6, usuario: 'ricardo.mejia', email: 'ricardo.mejia@grupocolba.com', rol: 'Director Comercial', estado: 'Activo' };
const COORDINADOR_COMERCIAL: UsuarioFake = { id: 5, usuario: 'laura.buelvas', email: 'laura.buelvas@grupocolba.com', rol: 'Coordinador Comercial', estado: 'Activo' };
const MERCADEO: UsuarioFake = { id: 201, usuario: 'ana.rios', email: 'ana.rios@grupocolba.com', rol: 'Analista Mercadeo', estado: 'Activo' };

const PRIVADO = 'aseo'; // aliasFuente distinto de S1/S2 → Privado

let solicitud: Record<string, unknown>;
let sesionActual: { id: number; email: string; rol: string; usuario: string } | null;

function resetFixture(asignaciones: Record<string, unknown>[] = []) {
  solicitud = {
    id: 900, estadoSolicitud: 'En evaluación', resultadoFinal: null, causalCierre: null,
    aliasFuente: PRIVADO,
    fechaCierre: new Date('2026-09-01T00:00:00.000Z'),
    sqrNumero: null, sqrCerrada: false, sqrError: null,
    procesoId: 5151,
    asignaciones,
  };
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: false, status: 500, text: async () => 'SQR no disponible en pruebas',
  })));
}

const fakeImpl = {
  user: {
    async findUnique({ where }: { where: { id?: number; email?: string } }) {
      const usuarios = [ANALISTA_COMERCIAL, DIRECTOR_COMERCIAL, COORDINADOR_COMERCIAL, MERCADEO];
      if (where.id != null) return usuarios.find((u) => u.id === where.id) ?? null;
      if (where.email != null) return usuarios.find((u) => u.email === where.email) ?? null;
      return null;
    },
  },
  solicitud: {
    async findUnique({ where }: { where: { id: number } }) {
      return where.id === solicitud.id ? JSON.parse(JSON.stringify(solicitud)) : null;
    },
    async updateMany({ where, data }: { where: { id: number; estadoSolicitud?: { notIn: string[] } }; data: Record<string, unknown> }) {
      if (where.id !== solicitud.id) return { count: 0 };
      const estadoActual = String(solicitud.estadoSolicitud);
      if (where.estadoSolicitud?.notIn?.includes(estadoActual)) return { count: 0 };
      solicitud = { ...solicitud, ...data };
      return { count: 1 };
    },
  },
  auditLog: { async create({ data }: { data: Record<string, unknown> }) { return { id: 1, ...data }; } },
  async $queryRaw() { return []; },
  async $transaction<T>(cb: (tx: any) => Promise<T>): Promise<T> { return cb(fakeImpl); },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));

function req(body: unknown = {}) {
  return new NextRequest('http://localhost/api/solicitudes/900/cerrar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '900' }) }; }

function comoSesion(u: UsuarioFake) { return { id: u.id, email: u.email, rol: u.rol, usuario: u.usuario }; }

const filaDirector = { idAsignacion: 'ASG-D1', analistaAsignado: 'ricardo.mejia' };
const filaCoordinador = { idAsignacion: 'ASG-C1', analistaAsignado: 'laura.buelvas' };
const filaAnalista = { idAsignacion: 'ASG-A1', analistaAsignado: 'oscar.pallares' };

describe('POST /api/solicitudes/[id]/cerrar — RECHAZO de Privado para Director/Coordinador Comercial', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('8) Director Comercial + Privado + RECHAZADO (motivo simple) → 200', async () => {
    resetFixture([filaDirector]);
    sesionActual = comoSesion(DIRECTOR_COMERCIAL);
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-D1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', motivoRechazo: 'No cumple requisitos habilitantes.' },
    }), ctx());
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
  });

  it('9) Coordinador Comercial + Privado + RECHAZADO (motivo simple) → 200', async () => {
    resetFixture([filaCoordinador]);
    sesionActual = comoSesion(COORDINADOR_COMERCIAL);
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-C1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', motivoRechazo: 'Proceso duplicado.' },
    }), ctx());
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
  });

  it('10) rechazo simple persiste motivoRechazo en la fila', async () => {
    resetFixture([filaDirector]);
    sesionActual = comoSesion(DIRECTOR_COMERCIAL);
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-D1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', motivoRechazo: 'No cumple requisitos habilitantes.' },
    }), ctx());
    const data = await res.json();
    const fila = (data.solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-D1');
    expect(fila.motivoRechazo).toBe('No cumple requisitos habilitantes.');
    expect(fila.estadoRevision).toBe('RECHAZADO');
  });

  it('11) rechazo con causal persiste causalRechazo/observacionRechazo/urlEvidenciaRechazo', async () => {
    resetFixture([filaCoordinador]);
    sesionActual = comoSesion(COORDINADOR_COMERCIAL);
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-C1', resultadoEstado: 'Cerrada',
      filaExtra: {
        estadoRevision: 'RECHAZADO',
        causalRechazo: 'PROCESO_DUPLICADO',
        observacionRechazo: 'Ya existe un proceso equivalente en curso.',
        urlEvidenciaRechazo: null,
      },
    }), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    const fila = (data.solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-C1');
    expect(fila.causalRechazo).toBe('PROCESO_DUPLICADO');
    expect(fila.observacionRechazo).toBe('Ya existe un proceso equivalente en curso.');
    expect(fila.estadoRevision).toBe('RECHAZADO');
  });

  it('12) Analista Comercial + Privado + RECHAZADO → 403', async () => {
    resetFixture([filaAnalista]);
    sesionActual = comoSesion(ANALISTA_COMERCIAL);
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-A1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', motivoRechazo: 'x' },
    }), ctx());
    expect(res.status).toBe(403);
    expect(solicitud.estadoSolicitud).toBe('En evaluación');
  });

  it('12b) Analista Comercial RESPONSABLE + Privado + En observación + "no aceptada" → 200', async () => {
    resetFixture([filaAnalista]);
    solicitud.estadoSolicitud = 'En observación';
    sesionActual = comoSesion(ANALISTA_COMERCIAL);
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-A1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', decisionObservaciones: 'no_aceptada', motivoRechazo: 'La entidad no acogió la observación.' },
    }), ctx());
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
    const fila = (solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-A1');
    expect(fila.decisionObservaciones).toBe('no_aceptada');
  });

  it('12c) Analista Comercial NO responsable + Privado + "no aceptada" → 403', async () => {
    resetFixture([filaDirector]);
    solicitud.estadoSolicitud = 'En observación';
    sesionActual = comoSesion(ANALISTA_COMERCIAL);
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-D1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', decisionObservaciones: 'no_aceptada', motivoRechazo: 'x' },
    }), ctx());
    expect(res.status).toBe(403);
    expect(solicitud.estadoSolicitud).toBe('En observación');
  });

  it('12d) Analista Comercial responsable + Privado + "no aceptada" fuera de observación → 403 (no abre el rechazo general)', async () => {
    resetFixture([filaAnalista]);
    sesionActual = comoSesion(ANALISTA_COMERCIAL);
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-A1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', decisionObservaciones: 'no_aceptada', motivoRechazo: 'x' },
    }), ctx());
    expect(res.status).toBe(403);
    expect(solicitud.estadoSolicitud).toBe('En evaluación');
  });

  it('13) llamada sin sesión → 401', async () => {
    resetFixture([filaDirector]);
    sesionActual = null;
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-D1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', motivoRechazo: 'x' },
    }), ctx());
    expect(res.status).toBe(401);
  });

  it('14) solicitud ya terminal → mantiene la respuesta actual (409, mismo comportamiento previo)', async () => {
    resetFixture([filaDirector]);
    solicitud.estadoSolicitud = 'Cerrada';
    sesionActual = comoSesion(DIRECTOR_COMERCIAL);
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-D1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', motivoRechazo: 'x' },
    }), ctx());
    expect(res.status).toBe(409);
  });

  it('15) causalRechazo="OTRA_CAUSA" sin observacionRechazo (detalle) → 400', async () => {
    resetFixture([filaDirector]);
    sesionActual = comoSesion(DIRECTOR_COMERCIAL);
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-D1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', causalRechazo: 'OTRA_CAUSA' },
    }), ctx());
    expect(res.status).toBe(400);
  });

  it('16) Director Comercial + Privado + CERRADO_ADJUDICADO → 403 (NO gana permiso por este cambio)', async () => {
    resetFixture([filaDirector]);
    sesionActual = comoSesion(DIRECTOR_COMERCIAL);
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-D1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', observacionResultado: 'Adjudicado a X.' },
    }), ctx());
    expect(res.status).toBe(403);
    expect(solicitud.estadoSolicitud).toBe('En evaluación');
  });

  it('17) Coordinador Comercial + Privado + CERRADO_NO_ADJUDICADO → 403 (NO gana permiso por este cambio)', async () => {
    resetFixture([filaCoordinador]);
    sesionActual = comoSesion(COORDINADOR_COMERCIAL);
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-C1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_NO_ADJUDICADO', resultadoFinal: 'No adjudicado', observacionResultado: 'No fue adjudicado.' },
    }), ctx());
    expect(res.status).toBe(403);
    expect(solicitud.estadoSolicitud).toBe('En evaluación');
  });

  it('control: Mercadeo + Privado + RECHAZADO sigue funcionando (200) — el permiso nuevo no le quita nada', async () => {
    resetFixture([]);
    sesionActual = comoSesion(MERCADEO);
    const { POST } = await import('./route');
    const res = await POST(req({ resultadoEstado: 'Cerrada', filaExtra: undefined }), ctx());
    // Sin idAsignacion/filaExtra (cierre administrativo directo) — Mercadeo
    // sigue autorizado a cerrar un Privado por la vía general.
    expect(res.status).toBe(200);
  });
});
