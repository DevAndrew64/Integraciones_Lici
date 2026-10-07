/**
 * Prueba de PARIDAD FUNCIONAL — auditoría solicitada explícitamente:
 * demuestra que el cierre nuevo (POST .../cerrar) conserva los mismos
 * efectos internos válidos que producía el cierre anterior (guardar() +
 * PATCH genérico /api/solicitudes), EXCEPTO el cierre externo de SQR
 * (fuera de alcance, documentado aparte — nunca se invoca desde aquí).
 *
 * Efectos verificados explícitamente:
 *  - estadoSolicitud pasa a terminal (igual que antes).
 *  - docData / obsData / procData NO se tocan (el cierre anterior tampoco
 *    los tocaba — guardar() nunca los enviaba en el PATCH).
 *  - sqrNumero se conserva intacto; sqrCerrada permanece false; sqrError
 *    no se inventa — la SQR sigue "localizable" por su número real.
 *  - AuditLog se escribe UNA sola vez por cierre efectivo, nunca duplicado
 *    en el intento perdedor de un cierre simultáneo.
 *  - Observaciones y filas de otros responsables permanecen intactas.
 *  - `Solicitud.fechaCierre` (fecha límite/cierre de la CONVOCATORIA
 *    externa, NO el cierre de gestión interna) permanece exactamente igual
 *    a su valor previo en TODOS los escenarios — incluido `null` — bajo
 *    ningún caso el endpoint la escribe. Corregido tras hallazgo de
 *    auditoría (antes se sobreescribía con `new Date()`).
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

function fixtureUnResponsable() {
  return {
    id: 500, estadoSolicitud: 'En evaluación',
    resultadoFinal: null, causalCierre: null,
    // "fechaCierre" real de la Solicitud = fecha de cierre de la CONVOCATORIA
    // (deadline de presentación de ofertas, sincronizada desde el cronograma
    // externo) — NUNCA la fecha de cierre de nuestra gestión interna. Se
    // fija con un valor realista y DISTINTO de "hoy" para poder detectar si
    // el endpoint la sobreescribe indebidamente (ver hallazgo de auditoría).
    fechaCierre: new Date('2026-08-15T00:00:00.000Z'),
    sqrNumero: 'SQR-77001', sqrCerrada: false, sqrError: null,
    docData: [{ id: 'doc-1', nombre: 'propuesta.pdf' }],
    obsData: [{ nota: 'histórico previo, no debe tocarse' }],
    asignaciones: [
      { idAsignacion: 'ASG-1', analistaAsignado: 'oscar.pallares', observaciones: [{ autor: 'oscar.pallares', detalle: 'obs previa' }] },
    ],
  };
}

function fixtureDosResponsables() {
  return {
    ...fixtureUnResponsable(),
    id: 501,
    asignaciones: [
      { idAsignacion: 'ASG-1', analistaAsignado: 'oscar.pallares', observaciones: [{ autor: 'oscar.pallares', detalle: 'obs de oscar' }] },
      { idAsignacion: 'ASG-2', analistaAsignado: 'nicole.ortiz', observaciones: [{ autor: 'nicole.ortiz', detalle: 'obs de nicole' }] },
    ],
  };
}

function fixtureFechaCierreNull() {
  return { ...fixtureUnResponsable(), id: 502, fechaCierre: null };
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
  return new NextRequest('http://localhost/api/solicitudes/x/cerrar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx(id: number) { return { params: Promise.resolve({ id: String(id) }) }; }

/** Payload real del flujo "resultado del proceso: adjudicado" (page.tsx ~17382). */
function cierreAdjudicado(idAsignacion: string) {
  return { idAsignacion, resultadoEstado: 'Cerrada', filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', observacionResultado: 'Justificación de prueba.' } };
}

describe('Paridad funcional — cierre nuevo vs. efectos internos del cierre anterior', () => {
  // Ajuste "SQR DESACOPLADA DEL CIERRE DEL PROCESO" — este endpoint ahora
  // intenta cerrar la SQR asociada antes de completar el cierre. Se
  // estuba `fetch` con una falla determinística (nunca se llama a la API
  // real de GrupoColba desde una prueba) — el objetivo de este archivo
  // sigue siendo verificar que docData/obsData/fechaCierre/sqrNumero se
  // conservan, independientemente del resultado de esa llamada externa.
  beforeEach(() => {
    auditLogs = [];
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 500, text: async () => 'SQR no disponible en pruebas',
    })));
  });

  it('solicitud con UN responsable: el propio responsable puede cerrar, docData/obsData/sqrNumero/fechaCierre se conservan intactos', async () => {
    solicitud = fixtureUnResponsable();
    const fechaConvocatoriaOriginal = (solicitud.fechaCierre as Date).toISOString();
    sesionActual = { id: OSCAR.id, email: OSCAR.email, rol: OSCAR.rol, usuario: OSCAR.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(cierreAdjudicado('ASG-1')), ctx(500));
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
    expect(solicitud.docData).toEqual([{ id: 'doc-1', nombre: 'propuesta.pdf' }]); // intacto
    expect(solicitud.obsData).toEqual([{ nota: 'histórico previo, no debe tocarse' }]); // intacto
    expect(solicitud.sqrNumero).toBe('SQR-77001'); // conservado, nunca borrado
    // La SQR seguía abierta y GrupoColba falló (fetch estubado arriba) —
    // el proceso se cierra IGUAL (núcleo de la regla "SQR desacoplada del
    // cierre"); el error queda persistido solo para diagnóstico interno,
    // nunca bloquea ni se inventa un cierre falso de la SQR.
    expect(solicitud.sqrCerrada).toBe(false);
    expect(solicitud.sqrError).toBe('SQR no disponible en pruebas');
    expect(solicitud.sqrCierreEstado).toBe('ERROR');
    // fechaCierre = fecha límite/cierre de la CONVOCATORIA externa, NUNCA el
    // cierre de gestión interna — debe permanecer EXACTAMENTE igual.
    expect((solicitud.fechaCierre as Date).toISOString()).toBe(fechaConvocatoriaOriginal);
  });

  it('solicitud con fechaCierre=null (convocatoria sin fecha límite conocida): permanece null tras el cierre de gestión', async () => {
    solicitud = fixtureFechaCierreNull();
    sesionActual = { id: OSCAR.id, email: OSCAR.email, rol: OSCAR.rol, usuario: OSCAR.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(cierreAdjudicado('ASG-1')), ctx(502));
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
    expect(solicitud.fechaCierre).toBeNull(); // nunca se inventa una fecha
  });

  it('solicitud con DOS responsables: cierre por el PRIMERO conserva la observación del segundo intacta y no toca fechaCierre', async () => {
    solicitud = fixtureDosResponsables();
    const fechaConvocatoriaOriginal = (solicitud.fechaCierre as Date).toISOString();
    sesionActual = { id: OSCAR.id, email: OSCAR.email, rol: OSCAR.rol, usuario: OSCAR.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(cierreAdjudicado('ASG-1')), ctx(501));
    expect(res.status).toBe(200);
    const filaNicole = (solicitud.asignaciones as any[]).find((a) => a.idAsignacion === 'ASG-2');
    expect(filaNicole.observaciones).toEqual([{ autor: 'nicole.ortiz', detalle: 'obs de nicole' }]);
    expect((solicitud.fechaCierre as Date).toISOString()).toBe(fechaConvocatoriaOriginal);
  });

  it('solicitud con DOS responsables: cierre por el SEGUNDO produce el mismo efecto que por el primero, tampoco toca fechaCierre', async () => {
    solicitud = fixtureDosResponsables();
    const fechaConvocatoriaOriginal = (solicitud.fechaCierre as Date).toISOString();
    sesionActual = { id: NICOLE.id, email: NICOLE.email, rol: NICOLE.rol, usuario: NICOLE.usuario };
    const { POST } = await import('./route');
    const res = await POST(req(cierreAdjudicado('ASG-2')), ctx(501));
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
    const filaOscar = (solicitud.asignaciones as any[]).find((a) => a.idAsignacion === 'ASG-1');
    expect(filaOscar.observaciones).toEqual([{ autor: 'oscar.pallares', detalle: 'obs de oscar' }]); // intacta
    expect((solicitud.fechaCierre as Date).toISOString()).toBe(fechaConvocatoriaOriginal);
  });

  it('cierre administrativo: mismo efecto, AuditLog registra al admin real, no a un responsable suplantado, y no toca fechaCierre', async () => {
    solicitud = fixtureDosResponsables();
    const fechaConvocatoriaOriginal = (solicitud.fechaCierre as Date).toISOString();
    sesionActual = { id: ADMIN.id, email: ADMIN.email, rol: ADMIN.rol, usuario: ADMIN.usuario };
    const { POST } = await import('./route');
    const res = await POST(req({}), ctx(501));
    expect(res.status).toBe(200);
    const cierre = auditLogs.find((a) => a.accion === 'solicitud_cerrar');
    expect((cierre!.detalle as any).cerradoPor).toBe('admin1');
    expect((solicitud.fechaCierre as Date).toISOString()).toBe(fechaConvocatoriaOriginal);
  });

  it('cierre simultáneo (dos responsables, secuencial): un solo AuditLog de cierre, un solo ganador, SQR sigue localizable, fechaCierre intacta incluso en el ganador', async () => {
    solicitud = fixtureDosResponsables();
    const fechaConvocatoriaOriginal = (solicitud.fechaCierre as Date).toISOString();
    sesionActual = { id: OSCAR.id, email: OSCAR.email, rol: OSCAR.rol, usuario: OSCAR.usuario };
    const { POST } = await import('./route');
    const res1 = await POST(req(cierreAdjudicado('ASG-1')), ctx(501));
    sesionActual = { id: NICOLE.id, email: NICOLE.email, rol: NICOLE.rol, usuario: NICOLE.usuario };
    const res2 = await POST(req(cierreAdjudicado('ASG-2')), ctx(501));
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(409);
    expect(auditLogs.filter((a) => a.accion === 'solicitud_cerrar')).toHaveLength(1);
    // La SQR sigue identificable por su número real tras el cierre interno —
    // ningún dato de SQR se pierde ni se marca falsamente como cerrada.
    expect(solicitud.sqrNumero).toBe('SQR-77001');
    expect(solicitud.sqrCerrada).toBe(false);
    // El intento GANADOR tampoco debe haber tocado fechaCierre.
    expect((solicitud.fechaCierre as Date).toISOString()).toBe(fechaConvocatoriaOriginal);
  });

  it('REGRESIÓN — el endpoint NUNCA debe volver a escribir Solicitud.fechaCierre con la fecha de hoy (bug corregido en esta ronda)', async () => {
    solicitud = fixtureUnResponsable();
    const fechaConvocatoriaOriginal = (solicitud.fechaCierre as Date).toISOString();
    const hoyISO = new Date().toISOString().slice(0, 10);
    sesionActual = { id: OSCAR.id, email: OSCAR.email, rol: OSCAR.rol, usuario: OSCAR.usuario };
    const { POST } = await import('./route');
    await POST(req(cierreAdjudicado('ASG-1')), ctx(500));
    const fechaResultante = (solicitud.fechaCierre as Date).toISOString();
    expect(fechaResultante).toBe(fechaConvocatoriaOriginal); // debe seguir siendo la fecha original de la convocatoria...
    expect(fechaResultante.slice(0, 10)).not.toBe(hoyISO); // ...y en ningún caso "hoy" (evidencia de reintroducir el bug)
  });
});