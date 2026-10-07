/**
 * Auditoría de seguridad del payload de POST /api/solicitudes/[id]/cerrar —
 * demuestra que `filaExtra` NUNCA se copia verbatim sobre la fila: existe
 * una allowlist estricta por `estadoRevision`, autoría/tiempo siempre
 * server-derivados, ownership de `idAsignacion`, y coherencia entre
 * resultadoEstado/estadoRevision/resultadoFinal/causaNoPresentacion.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
const OSCAR: UsuarioFake = { id: 101, usuario: 'oscar.pallares', email: 'oscar.pallares@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const NICOLE: UsuarioFake = { id: 102, usuario: 'nicole.ortiz', email: 'nicole.ortiz@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const ADMIN: UsuarioFake = { id: 1, usuario: 'admin1', email: 'admin1@grupocolba.com', rol: 'admin', estado: 'Activo' };

let solicitud: Record<string, unknown>;
let auditLogs: Array<Record<string, unknown>> = [];
let sesionActual: { id: number; email: string; rol: string; usuario: string };

function resetFixture() {
  solicitud = {
    id: 700, estadoSolicitud: 'En evaluación', resultadoFinal: null, causalCierre: null,
    fechaCierre: new Date('2026-09-01T00:00:00.000Z'), // fecha de la CONVOCATORIA — nunca debe cambiar
    sqrNumero: 'SQR-90001', sqrCerrada: false, sqrError: null,
    procesoId: 4242,
    asignaciones: [
      {
        idAsignacion: 'ASG-1', analistaAsignado: 'oscar.pallares', asignadoPor: 'laura.buelvas',
        fechaAsignacion: '2026-01-01 08:00:00', observaciones: [{ autor: 'oscar.pallares', detalle: 'obs histórica de oscar' }],
      },
      {
        idAsignacion: 'ASG-2', analistaAsignado: 'nicole.ortiz', asignadoPor: 'laura.buelvas',
        fechaAsignacion: '2026-01-02 08:00:00', observaciones: [{ autor: 'nicole.ortiz', detalle: 'obs histórica de nicole' }],
      },
    ],
  };
  auditLogs = [];
  sesionActual = { id: OSCAR.id, email: OSCAR.email, rol: OSCAR.rol, usuario: OSCAR.usuario };
  // Ajuste "SQR DESACOPLADA DEL CIERRE DEL PROCESO" — este endpoint ahora
  // intenta cerrar la SQR asociada antes de completar el cierre. Se
  // estuba `fetch` con una falla determinística (nunca se llama a la API
  // real de GrupoColba desde una prueba) — el foco de este archivo sigue
  // siendo la seguridad del payload de `filaExtra`, ajena a ese resultado.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: false, status: 500, text: async () => 'SQR no disponible en pruebas',
  })));
}

const fakeImpl = {
  user: {
    async findUnique({ where }: { where: { id?: number; email?: string } }) {
      const usuarios = [OSCAR, NICOLE, ADMIN];
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
  auditLog: { async create({ data }: { data: Record<string, unknown> }) { auditLogs.push(data); return { id: auditLogs.length, ...data }; } },
  async $queryRaw() { return []; },
  async $transaction<T>(cb: (tx: any) => Promise<T>): Promise<T> { return cb(fakeImpl); },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({ getSession: async () => sesionActual }));

function req(body: unknown = {}) {
  return new NextRequest('http://localhost/api/solicitudes/700/cerrar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '700' }) }; }

function filaOscarOriginal() { return (solicitud.asignaciones as any[]).find((a) => a.idAsignacion === 'ASG-1'); }
function filaNicoleOriginal() { return (solicitud.asignaciones as any[]).find((a) => a.idAsignacion === 'ASG-2'); }

describe('POST /api/solicitudes/[id]/cerrar — seguridad del payload (filaExtra)', () => {
  beforeEach(() => resetFixture());

  it('caso legítimo de referencia: cierre por adjudicación con filaExtra válido → 200', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', observacionResultado: 'Justificación de prueba.' },
    }), ctx());
    expect(res.status).toBe(200);
  });

  it('rechaza (403) si oscar intenta cerrar usando el idAsignacion de nicole', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-2', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado' },
    }), ctx());
    expect(res.status).toBe(403);
    expect(solicitud.estadoSolicitud).toBe('En evaluación'); // sin cambios
    expect(filaNicoleOriginal()).toEqual(filaNicoleOriginal()); // fila de nicole intacta (comprobación indirecta abajo)
    expect(filaNicoleOriginal().observaciones).toEqual([{ autor: 'nicole.ortiz', detalle: 'obs histórica de nicole' }]);
  });

  it('un intento de sobreescribir analistaAsignado se rechaza (400, campo no permitido)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', analistaAsignado: 'usuario-intruso' },
    }), ctx());
    expect(res.status).toBe(400);
    expect(filaOscarOriginal().analistaAsignado).toBe('oscar.pallares');
  });

  it('un intento de reemplazar el arreglo de observaciones vía filaExtra se rechaza (400)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', observaciones: [] },
    }), ctx());
    expect(res.status).toBe(400);
    expect(filaOscarOriginal().observaciones).toEqual([{ autor: 'oscar.pallares', detalle: 'obs histórica de oscar' }]);
  });

  it('un intento de mandar sqrCerrada=true en el body TOP-LEVEL se rechaza con 400 (nunca se ignora en silencio)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada', sqrCerrada: true,
      filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado' },
    }), ctx());
    expect(res.status).toBe(400);
    expect(solicitud.sqrCerrada).toBe(false);
    expect(solicitud.estadoSolicitud).toBe('En evaluación'); // nada se procesó
  });

  it('un intento de mandar fechaCierre (top-level, de la convocatoria) en el body se rechaza con 400', async () => {
    const original = (solicitud.fechaCierre as Date).toISOString();
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada', fechaCierre: '1999-01-01T00:00:00.000Z',
      filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado' },
    }), ctx());
    expect(res.status).toBe(400);
    expect((solicitud.fechaCierre as Date).toISOString()).toBe(original);
  });

  it('un intento de mandar sqrNumero top-level se rechaza con 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada', sqrNumero: 'SQR-FALSO', filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado' } }), ctx());
    expect(res.status).toBe(400);
  });

  it('un intento de mandar procesoId top-level se rechaza con 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada', procesoId: 999, filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado' } }), ctx());
    expect(res.status).toBe(400);
  });

  it('un intento de mandar el arreglo completo de asignaciones top-level se rechaza con 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada', asignaciones: [], filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado' } }), ctx());
    expect(res.status).toBe(400);
  });

  it('una propiedad top-level completamente desconocida se rechaza con 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada', propiedadInventada: 'x', filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado' } }), ctx());
    expect(res.status).toBe(400);
  });

  it('un intento de suplantar gestionadoPor/cerradoPor vía filaExtra se descarta — siempre queda el usuario real de sesión', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', observacionResultado: 'Justificación de prueba.', gestionadoPor: 'nicole.ortiz', cerradoPor: 'nicole.ortiz' },
    }), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    const fila = (data.solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-1');
    expect(fila.gestionadoPor).toBe('oscar.pallares');
    expect(fila.cerradoPor).toBe('oscar.pallares');
  });

  it('una propiedad completamente desconocida en filaExtra se rechaza con 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', propiedadInventada: 'x' },
    }), ctx());
    expect(res.status).toBe(400);
  });

  it('un estadoRevision que no es un estado de cierre reconocido se rechaza con 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'ESTADO_INVENTADO' },
    }), ctx());
    expect(res.status).toBe(400);
  });

  it('resultadoFinal inválido/no coherente con el estadoRevision se rechaza con 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Un texto arbitrario cualquiera' },
    }), ctx());
    expect(res.status).toBe(400);
  });

  it('resultadoFinal="No adjudicado" con estadoRevision=CERRADO_ADJUDICADO es incoherente y se rechaza (no debe combinarse)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'No adjudicado' },
    }), ctx());
    expect(res.status).toBe(400);
  });

  it('causaNoPresentacion="Cancelación por la entidad" con estadoRevision=CERRADO_NO_CUMPLIMIENTO es incoherente (esa causa exige CANCELADO) y se rechaza', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_NO_CUMPLIMIENTO', causaNoPresentacion: 'Cancelación por la entidad' },
    }), ctx());
    expect(res.status).toBe(400);
  });

  it('resultadoEstado no coherente con estadoRevision (CERRADO_ADJUDICADO con resultadoEstado=Cancelada) se rechaza con 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cancelada',
      filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado' },
    }), ctx());
    expect(res.status).toBe(400);
  });

  it('estadoSolicitud final fuera de {Cerrada,Cancelada} nunca es aceptado (allowlist ya existente)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ resultadoEstado: 'Publicada' }), ctx());
    // Sin filaExtra, el valor no reconocido cae al default seguro 'Cerrada' — nunca se usa el texto arbitrario.
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
  });

  it('idAsignacion inexistente en el arreglo actual se rechaza con 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-NO-EXISTE', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado' },
    }), ctx());
    expect(res.status).toBe(400);
  });

  it('idAsignacion sin filaExtra (o viceversa) se rechaza con 400 — no tiene sentido enviar uno sin el otro', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ idAsignacion: 'ASG-1' }), ctx());
    expect(res.status).toBe(400);
  });

  it('el flujo de RECHAZADO (motivoRechazo) funciona con su propia allowlist y no acepta resultadoFinal', async () => {
    const { POST } = await import('./route');
    const rechazado = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', motivoRechazo: 'No cumple requisitos habilitantes.' },
    }), ctx());
    expect(rechazado.status).toBe(200);

    resetFixture();
    const mezclado = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', motivoRechazo: 'x', resultadoFinal: 'Adjudicado' },
    }), ctx());
    expect(mezclado.status).toBe(400); // resultadoFinal no pertenece a la allowlist de RECHAZADO
  });

  it('el flujo de CANCELADO (causaNoPresentacion="Cancelación por la entidad") funciona y produce estadoSolicitud=Cancelada', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cancelada',
      filaExtra: { estadoRevision: 'CANCELADO', causaNoPresentacion: 'Cancelación por la entidad' },
    }), ctx());
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cancelada');
  });

  it('motivoRechazo compuesto solo por espacios se rechaza (400)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', motivoRechazo: '   ' },
    }), ctx());
    expect(res.status).toBe(400);
  });

  it('AuditLog registra fechaCierreGestion generado en servidor, no provisto por el body', async () => {
    const { POST } = await import('./route');
    const antes = Date.now();
    await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', observacionResultado: 'Justificación de prueba.' },
    }), ctx());
    const despues = Date.now();
    const cierre = auditLogs.find((a) => a.accion === 'solicitud_cerrar');
    const detalle = cierre!.detalle as any;
    const ts = new Date(detalle.fechaCierreGestion).getTime();
    expect(ts).toBeGreaterThanOrEqual(antes);
    expect(ts).toBeLessThanOrEqual(despues);
  });

  it('admin SÍ puede apuntar filaExtra a una fila que no es la suya (bypass documentado, igual que en /observaciones)', async () => {
    sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-2', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', observacionResultado: 'Justificación de prueba.' },
    }), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    const fila = (data.solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-2');
    expect(fila.cerradoPor).toBe('admin1'); // no "nicole.ortiz"
  });
});

describe('POST /api/solicitudes/[id]/cerrar — flujo RECHAZADO causal (ModalEditarAsignacion.handleRechazar)', () => {
  beforeEach(() => resetFixture());

  it('rechazo causal válido (sin decisión gerencial, sin evidencia requerida) → 200', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', causalRechazo: 'PROCESO_DUPLICADO', observacionRechazo: 'Ya existe otro registro.' },
    }), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    const fila = (data.solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-1');
    expect(fila.causalRechazo).toBe('PROCESO_DUPLICADO');
    expect(fila.estadoAsignacion).toBe('RECHAZADO'); // paridad con handleRechazar original
  });

  it('causalRechazo="DECISION_GERENCIAL" sin urlEvidenciaRechazo se rechaza con 400 (coherente con el frontend, que exige adjunto)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', causalRechazo: 'DECISION_GERENCIAL' },
    }), ctx());
    expect(res.status).toBe(400);
  });

  it('causalRechazo="DECISION_GERENCIAL" CON urlEvidenciaRechazo → 200', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', causalRechazo: 'DECISION_GERENCIAL', urlEvidenciaRechazo: '/uploads/soporte.pdf' },
    }), ctx());
    expect(res.status).toBe(200);
  });

  it('causalRechazo con valor fuera del catálogo de 5 causales se rechaza con 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', causalRechazo: 'CAUSAL_INVENTADA' },
    }), ctx());
    expect(res.status).toBe(400);
  });

  it('mezclar motivoRechazo (simple) con causalRechazo (causal) en la misma petición se rechaza con 400 — son mutuamente excluyentes', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', motivoRechazo: 'x', causalRechazo: 'PROCESO_DUPLICADO' },
    }), ctx());
    expect(res.status).toBe(400);
  });

  it('ni motivoRechazo ni causalRechazo presentes se rechaza con 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO' },
    }), ctx());
    expect(res.status).toBe(400);
  });

  it('intento de suplantar analistaAsignado vía el rechazo causal se rechaza con 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', causalRechazo: 'PROCESO_DUPLICADO', analistaAsignado: 'usuario-intruso' },
    }), ctx());
    expect(res.status).toBe(400);
  });

  // Ajuste "OTRA CAUSA — RECHAZO" — nueva causal 'OTRA_CAUSA' que, a
  // diferencia de las 5 anteriores, exige `observacionRechazo` no vacío
  // (mismo patrón de coherencia que ya exige `urlEvidenciaRechazo` para
  // 'DECISION_GERENCIAL', arriba).
  it('causalRechazo="OTRA_CAUSA" sin observacionRechazo se rechaza con 400 (5)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', causalRechazo: 'OTRA_CAUSA' },
    }), ctx());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Debes indicar el detalle cuando seleccionas Otra causa/);
  });

  it('causalRechazo="OTRA_CAUSA" con observacionRechazo en blanco (solo espacios) se rechaza con 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', causalRechazo: 'OTRA_CAUSA', observacionRechazo: '   ' },
    }), ctx());
    expect(res.status).toBe(400);
  });

  it('causalRechazo="OTRA_CAUSA" CON observacionRechazo → 200, detalle persistido en la fila (6)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', causalRechazo: 'OTRA_CAUSA', observacionRechazo: 'El cliente cambió las condiciones del servicio.' },
    }), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    const fila = (data.solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-1');
    expect(fila.causalRechazo).toBe('OTRA_CAUSA');
    expect(fila.observacionRechazo).toBe('El cliente cambió las condiciones del servicio.');
  });

  it('causalRechazo="PROCESO_DUPLICADO" (una de las 5 causales existentes) sigue sin exigir observacionRechazo → 200 (7)', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'RECHAZADO', causalRechazo: 'PROCESO_DUPLICADO' },
    }), ctx());
    expect(res.status).toBe(200);
  });

  it('las 5 causales anteriores (ESTUDIO_MERCADO, PROCESO_DUPLICADO, NO_OBJETO_SOCIAL, SERVICIOS_ESPECIALIZADOS, DECISION_GERENCIAL) siguen aceptadas por el catálogo — sin regresión (10)', async () => {
    const { POST: P1 } = await import('./route');
    expect((await P1(req({ idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada', filaExtra: { estadoRevision: 'RECHAZADO', causalRechazo: 'ESTUDIO_MERCADO' } }), ctx())).status).toBe(200);
    resetFixture();
    const { POST: P2 } = await import('./route');
    expect((await P2(req({ idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada', filaExtra: { estadoRevision: 'RECHAZADO', causalRechazo: 'NO_OBJETO_SOCIAL' } }), ctx())).status).toBe(200);
    resetFixture();
    const { POST: P3 } = await import('./route');
    expect((await P3(req({ idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada', filaExtra: { estadoRevision: 'RECHAZADO', causalRechazo: 'SERVICIOS_ESPECIALIZADOS' } }), ctx())).status).toBe(200);
    resetFixture();
    const { POST: P4 } = await import('./route');
    expect((await P4(req({ idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada', filaExtra: { estadoRevision: 'RECHAZADO', causalRechazo: 'DECISION_GERENCIAL', urlEvidenciaRechazo: '/uploads/soporte.pdf' } }), ctx())).status).toBe(200);
  });
});

describe('POST /api/solicitudes/[id]/cerrar — flujo CERRADO_NO_ADJUDICADO gerencial (ModuloProcesosEnEjecucion.cerrarGerencial)', () => {
  beforeEach(() => resetFixture());

  it('cierre gerencial válido (tipoCausa fijo + causaEspecifica libre) → 200', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_NO_ADJUDICADO', tipoCausa: 'Determinación gerencial', causaEspecifica: 'Se decide no continuar por criterio gerencial.' },
    }), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    const fila = (data.solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-1');
    expect(fila.tipoCausa).toBe('Determinación gerencial');
    expect(fila.causaEspecifica).toBe('Se decide no continuar por criterio gerencial.');
  });

  it('cierre gerencial sin causaEspecifica usa el texto por defecto ("Cierre por determinación gerencial")', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_NO_ADJUDICADO', tipoCausa: 'Determinación gerencial' },
    }), ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    const fila = (data.solicitud.asignaciones as any[]).find((a: any) => a.idAsignacion === 'ASG-1');
    expect(fila.causaEspecifica).toBe('Cierre por determinación gerencial');
  });

  it('tipoCausa con un valor distinto a "Determinación gerencial" se rechaza con 400 — no se inventan otros valores', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_NO_ADJUDICADO', tipoCausa: 'Otro motivo cualquiera' },
    }), ctx());
    expect(res.status).toBe(400);
  });

  it('mezclar resultadoFinal con tipoCausa en la misma petición se rechaza con 400 — son mutuamente excluyentes', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_NO_ADJUDICADO', resultadoFinal: 'No adjudicado', tipoCausa: 'Determinación gerencial' },
    }), ctx());
    expect(res.status).toBe(400);
  });

  it('causaEspecifica que excede el límite documentado se rechaza con 400', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({
      idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada',
      filaExtra: { estadoRevision: 'CERRADO_NO_ADJUDICADO', tipoCausa: 'Determinación gerencial', causaEspecifica: 'a'.repeat(2001) },
    }), ctx());
    expect(res.status).toBe(400);
  });
});