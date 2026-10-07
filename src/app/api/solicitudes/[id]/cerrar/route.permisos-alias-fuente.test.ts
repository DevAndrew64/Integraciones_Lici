/**
 * Ajuste "PERMISOS DE CIERRE — PRIVADOS PARA MERCADEO" — verifica que
 * `POST /api/solicitudes/[id]/cerrar` (la autoridad REAL, no la UI) rechaza
 * con 403 una llamada directa que viole la nueva regla por `aliasFuente`,
 * y la acepta cuando corresponde. El backend es la fuente de verdad: un
 * cliente manipulado que llame al endpoint sin pasar por el frontend debe
 * recibir el mismo resultado que la UI refleja.
 *
 * Mismo patrón de fixture/mock que `route.seguridad.test.ts` — fake Prisma
 * en memoria, `fetch` global estubado (la SQR no es relevante aquí).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
const COMERCIAL: UsuarioFake = { id: 101, usuario: 'oscar.pallares', email: 'oscar.pallares@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const DIRECTOR_COMERCIAL: UsuarioFake = { id: 6, usuario: 'ricardo.mejia', email: 'ricardo.mejia@grupocolba.com', rol: 'Director Comercial', estado: 'Activo' };
const MERCADEO: UsuarioFake = { id: 201, usuario: 'ana.rios', email: 'ana.rios@grupocolba.com', rol: 'Analista Mercadeo', estado: 'Activo' };
const ADMIN: UsuarioFake = { id: 1, usuario: 'admin1', email: 'admin1@grupocolba.com', rol: 'admin', estado: 'Activo' };

// `Solicitud` no tiene columna `tipoProceso` — el dato real persistido es
// `aliasFuente` ('S1'/'S2' = Público; cualquier otro valor, incluido
// `null`, = Privado), mismo criterio que `GET /api/solicitudes`
// (`aliasFuentePublico`/`aliasFuentePrivado`).
const PUBLICO = 'S1';
const PRIVADO = 'aseo';

let solicitud: Record<string, unknown>;
let sesionActual: { id: number; email: string; rol: string; usuario: string };

function resetFixture(aliasFuente: string | null, asignaciones: Record<string, unknown>[] = []) {
  solicitud = {
    id: 800, estadoSolicitud: 'En evaluación', resultadoFinal: null, causalCierre: null,
    aliasFuente,
    fechaCierre: new Date('2026-09-01T00:00:00.000Z'),
    sqrNumero: null, sqrCerrada: false, sqrError: null,
    procesoId: 4343,
    asignaciones,
  };
  sesionActual = { id: COMERCIAL.id, email: COMERCIAL.email, rol: COMERCIAL.rol, usuario: COMERCIAL.usuario };
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: false, status: 500, text: async () => 'SQR no disponible en pruebas',
  })));
}

const fakeImpl = {
  user: {
    async findUnique({ where }: { where: { id?: number; email?: string } }) {
      const usuarios = [COMERCIAL, DIRECTOR_COMERCIAL, MERCADEO, ADMIN];
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
  return new NextRequest('http://localhost/api/solicitudes/800/cerrar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '800' }) }; }

// Cierre administrativo directo (sin idAsignacion/filaExtra) — el payload
// mínimo válido que ejercita SOLO la autorización (`puedeCerrarSolicitud`),
// sin acoplar estos tests a las reglas de `validarFilaExtra`/allowlist por
// estadoRevision, que ya tienen su propia cobertura en `route.seguridad.test.ts`.
const cierreBase = { resultadoEstado: 'Cerrada' };

describe('POST /api/solicitudes/[id]/cerrar — permisos por aliasFuente (Público/Privado)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('Comercial (Analista) intenta cerrar un proceso Privado → 403, sin cambiar el estado', async () => {
    resetFixture(PRIVADO);
    sesionActual = { id: COMERCIAL.id, email: COMERCIAL.email, rol: COMERCIAL.rol, usuario: COMERCIAL.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(cierreBase), ctx());
    expect(res.status).toBe(403);
    expect(solicitud.estadoSolicitud).toBe('En evaluación');
  });

  it('Director Comercial (administrador funcional de Procesos) intenta cerrar un Privado → 403 — pierde ese privilegio solo para Privados', async () => {
    resetFixture(PRIVADO);
    sesionActual = { id: DIRECTOR_COMERCIAL.id, email: DIRECTOR_COMERCIAL.email, rol: DIRECTOR_COMERCIAL.rol, usuario: DIRECTOR_COMERCIAL.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(cierreBase), ctx());
    expect(res.status).toBe(403);
  });

  it('Mercadeo (Analista Mercadeo) cierra un proceso Privado → 200, permitido', async () => {
    resetFixture(PRIVADO);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(cierreBase), ctx());
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
  });

  it('Mercadeo intenta cerrar un proceso Público SIN ser responsable ni administrador funcional → 403', async () => {
    resetFixture(PUBLICO);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(cierreBase), ctx());
    expect(res.status).toBe(403);
  });

  it('Mercadeo intenta cerrar un proceso Público SIENDO responsable asignado → 403 — no obtiene permiso de cierre de un Público solo por ser responsable', async () => {
    resetFixture(PUBLICO, [{ idAsignacion: 'ASG-1', analistaAsignado: 'ana.rios', asignadoPor: 'laura.buelvas', fechaAsignacion: '2026-01-01 08:00:00', observaciones: [] }]);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(cierreBase), ctx());
    expect(res.status).toBe(403);
  });

  it('Comercial (Analista, responsable asignado) cierra un proceso Público → 200, comportamiento sin cambios', async () => {
    resetFixture(PUBLICO, [{ idAsignacion: 'ASG-1', analistaAsignado: 'oscar.pallares', asignadoPor: 'laura.buelvas', fechaAsignacion: '2026-01-01 08:00:00', observaciones: [] }]);
    sesionActual = { id: COMERCIAL.id, email: COMERCIAL.email, rol: COMERCIAL.rol, usuario: COMERCIAL.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(cierreBase), ctx());
    expect(res.status).toBe(200);
  });

  it('Director Comercial (administrador funcional) cierra un proceso Público sin estar asignado → 200, comportamiento sin cambios', async () => {
    resetFixture(PUBLICO);
    sesionActual = { id: DIRECTOR_COMERCIAL.id, email: DIRECTOR_COMERCIAL.email, rol: DIRECTOR_COMERCIAL.rol, usuario: DIRECTOR_COMERCIAL.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(cierreBase), ctx());
    expect(res.status).toBe(200);
  });

  it('Administrador global cierra tanto Público como Privado → 200 en ambos', async () => {
    resetFixture(PRIVADO);
    sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
    const { POST: POST_PRIV } = await import('./route');
    expect((await POST_PRIV(req(cierreBase), ctx())).status).toBe(200);

    resetFixture(PUBLICO);
    sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
    const { POST: POST_PUB } = await import('./route');
    expect((await POST_PUB(req(cierreBase), ctx())).status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ajuste "CIERRE DE PRIVADOS PARA MERCADEO — FILA AJENA" — el diagnóstico
// confirmó que Mercadeo, ya autorizado por `puedeCerrarSolicitud` a cerrar
// un Privado, no tenía forma de escribir el resultado (Adjudicado/No
// adjudicado + observación) porque esa escritura vive siempre dentro de
// `asignaciones[]`, y el ownership check de este endpoint solo dejaba
// tocar una fila ajena a `esAdministradorProcesos` (Admin/Director/
// Coordinador Comercial — Mercadeo nunca fue ni debe ser parte de ese
// concepto). Estos tests ejercitan el endpoint DIRECTAMENTE (nunca la UI)
// con el payload completo `idAsignacion`+`filaExtra`, igual que ya hace
// `route.seguridad.test.ts` para los demás flujos de cierre.
// ═══════════════════════════════════════════════════════════════════════
describe('POST /api/solicitudes/[id]/cerrar — Mercadeo usando la fila PRESENTADA de otro responsable', () => {
  beforeEach(() => vi.restoreAllMocks());

  const filaPresentadaOscar = { idAsignacion: 'ASG-1', analistaAsignado: 'oscar.pallares', asignadoPor: 'laura.buelvas', fechaAsignacion: '2026-01-01 08:00:00', estadoRevision: 'PRESENTADO', observaciones: [] };

  function payloadAdjudicado(idAsignacion: string, observacion = 'Se adjudicó al oferente único habilitado.') {
    return {
      resultadoEstado: 'Cerrada',
      idAsignacion,
      filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', observacionResultado: observacion },
    };
  }
  function payloadNoAdjudicado(idAsignacion: string, observacion = 'Ningún oferente cumplió los requisitos habilitantes.') {
    return {
      resultadoEstado: 'Cerrada',
      idAsignacion,
      filaExtra: { estadoRevision: 'CERRADO_NO_ADJUDICADO', resultadoFinal: 'No adjudicado', observacionResultado: observacion },
    };
  }

  it('(4) Mercadeo + Privado + fila PRESENTADA ajena → permitido, sin 400 ni 403', async () => {
    resetFixture(PRIVADO, [filaPresentadaOscar]);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(payloadAdjudicado('ASG-1')), ctx());
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
  });

  it('(5) Mercadeo + Público + fila ajena → 403 (la excepción de fila ajena solo aplica a Privados)', async () => {
    resetFixture(PUBLICO, [filaPresentadaOscar]);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(payloadAdjudicado('ASG-1')), ctx());
    expect(res.status).toBe(403);
    expect(solicitud.estadoSolicitud).toBe('En evaluación');
  });

  it('(6) Comercial (Analista, no dueño de la fila) + Privado + fila ajena → 403 — Mercadeo no se convierte en un permiso general de fila ajena para otros roles', async () => {
    const filaAjenaDeNicole = { idAsignacion: 'ASG-2', analistaAsignado: 'nicole.ortiz', asignadoPor: 'laura.buelvas', fechaAsignacion: '2026-01-01 08:00:00', estadoRevision: 'PRESENTADO', observaciones: [] };
    resetFixture(PRIVADO, [filaAjenaDeNicole]);
    // Analista Comercial normal no cierra un Privado en absoluto
    // (`puedeCerrarSolicitud`) — confirma que ni siquiera llega a evaluarse
    // el ownership de la fila.
    sesionActual = { id: COMERCIAL.id, email: COMERCIAL.email, rol: COMERCIAL.rol, usuario: COMERCIAL.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(payloadAdjudicado('ASG-2')), ctx());
    expect(res.status).toBe(403);
  });

  it('(7) Mercadeo intentando reutilizar una fila ajena fuera del flujo permitido (solicitud ya cerrada) → denegado, nunca 200', async () => {
    resetFixture(PRIVADO, [{ ...filaPresentadaOscar, estadoRevision: 'CERRADO_ADJUDICADO' }]);
    solicitud.estadoSolicitud = 'Cerrada'; // ya terminal — el cierre ya no está autorizado en absoluto
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(payloadAdjudicado('ASG-1')), ctx());
    expect([403, 409]).toContain(res.status);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
  });

  it('(8) idAsignacion sin filaExtra → sigue 400 (validación intacta)', async () => {
    resetFixture(PRIVADO, [filaPresentadaOscar]);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ resultadoEstado: 'Cerrada', idAsignacion: 'ASG-1' }), ctx());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/idAsignacion y filaExtra deben enviarse juntos/);
  });

  it('(9) filaExtra sin idAsignacion (idAsignacion vacío) → sigue 400 — el bug original reportado, ahora imposible de reproducir vía el flujo correcto pero la validación sigue viva', async () => {
    resetFixture(PRIVADO, [filaPresentadaOscar]);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({ resultadoEstado: 'Cerrada', idAsignacion: '', filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', observacionResultado: 'x' } }), ctx());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/idAsignacion y filaExtra deben enviarse juntos/);
  });

  it('(10) Director Comercial + Público + fila ajena → 200, comportamiento existente sin regresión', async () => {
    resetFixture(PUBLICO, [filaPresentadaOscar]);
    sesionActual = { id: DIRECTOR_COMERCIAL.id, email: DIRECTOR_COMERCIAL.email, rol: DIRECTOR_COMERCIAL.rol, usuario: DIRECTOR_COMERCIAL.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(payloadAdjudicado('ASG-1')), ctx());
    expect(res.status).toBe(200);
  });

  it('(11a) Mercadeo + Privado: cierre Adjudicado persiste resultado y observación en la fila correcta', async () => {
    resetFixture(PRIVADO, [filaPresentadaOscar]);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(payloadAdjudicado('ASG-1', 'Único oferente, cumplió todos los requisitos.')), ctx());
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
    expect(solicitud.resultadoFinal).toBe('Adjudicado');
    const asigs = solicitud.asignaciones as Record<string, unknown>[];
    const filaActualizada = asigs.find((a) => a.idAsignacion === 'ASG-1')!;
    expect(filaActualizada.estadoRevision).toBe('CERRADO_ADJUDICADO');
    expect(filaActualizada.resultadoFinal).toBe('Adjudicado');
    expect(filaActualizada.observacionResultado).toBe('Único oferente, cumplió todos los requisitos.');
    // La identidad de quien cierra se reconstruye en servidor — nunca del cliente.
    expect(filaActualizada.cerradoPor).toBe(MERCADEO.usuario);
    // El resto de la fila (dueño real, asignadoPor, fecha) permanece intacto.
    expect(filaActualizada.analistaAsignado).toBe('oscar.pallares');
  });

  it('(11b) Mercadeo + Privado: cierre No adjudicado persiste resultado y observación en la fila correcta', async () => {
    resetFixture(PRIVADO, [filaPresentadaOscar]);
    sesionActual = { id: MERCADEO.id, email: MERCADEO.email, rol: MERCADEO.rol, usuario: MERCADEO.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(payloadNoAdjudicado('ASG-1', 'Ningún proponente cumplió los requisitos técnicos.')), ctx());
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
    expect(solicitud.resultadoFinal).toBe('No adjudicado');
    const asigs = solicitud.asignaciones as Record<string, unknown>[];
    const filaActualizada = asigs.find((a) => a.idAsignacion === 'ASG-1')!;
    expect(filaActualizada.estadoRevision).toBe('CERRADO_NO_ADJUDICADO');
    expect(filaActualizada.observacionResultado).toBe('Ningún proponente cumplió los requisitos técnicos.');
  });
});
