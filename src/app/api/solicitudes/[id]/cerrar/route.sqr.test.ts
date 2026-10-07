/**
 * Ajuste "SQR DESACOPLADA DEL CIERRE DEL PROCESO" (confirmado
 * explícitamente) — toda transición terminal de este endpoint (RECHAZADO,
 * CERRADO_NO_CUMPLIMIENTO, CANCELADO, CERRADO_ADJUDICADO,
 * CERRADO_NO_ADJUDICADO) intenta cerrar primero la SQR asociada, pero
 * GrupoColba NUNCA bloquea ni condiciona el cierre del proceso — un error
 * externo se persiste solo para diagnóstico interno.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

interface UsuarioFake { id: number; usuario: string; email: string; rol: string; estado: string; }
const OSCAR: UsuarioFake = { id: 101, usuario: 'oscar.pallares', email: 'oscar.pallares@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };

let solicitud: Record<string, unknown>;
let auditLogs: Array<Record<string, unknown>> = [];
let sesionActual: { id: number; email: string; rol: string; usuario: string };
let fetchSpy: ReturnType<typeof vi.fn>;

function fixtureBase(extra: Record<string, unknown> = {}) {
  return {
    id: 900, estadoSolicitud: 'En revisión', resultadoFinal: null, causalCierre: null,
    codigoProceso: 'X-9-2026', entidad: 'Entidad de prueba', fechaCierre: null,
    sqrNumero: 'SQR-99001', sqrCerrada: false, sqrCierreEstado: null, sqrError: null, fechaCierreSqr: null,
    asignaciones: [{ idAsignacion: 'ASG-1', analistaAsignado: 'oscar.pallares' }],
    ...extra,
  };
}

const fakeImpl = {
  user: { async findUnique({ where }: { where: { id?: number; email?: string } }) {
    if (where.id != null) return where.id === OSCAR.id ? OSCAR : null;
    if (where.email != null) return where.email === OSCAR.email ? OSCAR : null;
    return null;
  } },
  solicitud: {
    async findUnique({ where }: { where: { id: number } }) {
      return where.id === solicitud.id ? JSON.parse(JSON.stringify(solicitud)) : null;
    },
    async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      if (where.id !== solicitud.id) return { count: 0 };
      for (const [k, v] of Object.entries(where)) {
        if (k === 'id') continue;
        if (k === 'estadoSolicitud' && v && typeof v === 'object' && 'notIn' in (v as Record<string, unknown>)) {
          if (((v as { notIn: string[] }).notIn).includes(String(solicitud.estadoSolicitud))) return { count: 0 };
          continue;
        }
        if ((solicitud[k] ?? null) !== (v ?? null)) return { count: 0 };
      }
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

function req(body: unknown) {
  return new NextRequest('http://localhost/api/solicitudes/900/cerrar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '900' }) }; }

function cierreRechazado() {
  return { idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada', filaExtra: { estadoRevision: 'RECHAZADO', motivoRechazo: 'no aplica' } };
}
function cierreSinPresentar(causa = 'Otros') {
  return { idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada', filaExtra: { estadoRevision: 'CERRADO_NO_CUMPLIMIENTO', causaNoPresentacion: causa } };
}
function cancelar() {
  return { idAsignacion: 'ASG-1', resultadoEstado: 'Cancelada', filaExtra: { estadoRevision: 'CANCELADO', causaNoPresentacion: 'Cancelación por la entidad' } };
}
function adjudicado() {
  return { idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada', filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado', observacionResultado: 'Justificación de prueba.' } };
}
function noAdjudicado() {
  return { idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada', filaExtra: { estadoRevision: 'CERRADO_NO_ADJUDICADO', resultadoFinal: 'No adjudicado', observacionResultado: 'Justificación de prueba.' } };
}

beforeEach(() => {
  sesionActual = { id: OSCAR.id, email: OSCAR.email, rol: OSCAR.rol, usuario: OSCAR.usuario };
  auditLogs = [];
});

describe('Caso 1 — sin sqrNumero: cierra normal, sin llamar a GrupoColba', () => {
  it('RECHAZADO sin SQR', async () => {
    solicitud = fixtureBase({ sqrNumero: null });
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { POST } = await import('./route');
    const res = await POST(req(cierreRechazado()), ctx());
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Caso 2 — SQR ya cerrada: no se vuelve a cerrar, cierra normal', () => {
  it('RECHAZADO con SQR ya cerrada', async () => {
    solicitud = fixtureBase({ sqrCerrada: true, sqrCierreEstado: 'CERRADA' });
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { POST } = await import('./route');
    const res = await POST(req(cierreRechazado()), ctx());
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Caso 3/5 — SQR abierta + GrupoColba OK: SQR cerrada, proceso cerrado, sqrNumero conservado', () => {
  it.each([
    ['RECHAZADO', cierreRechazado, 'Cerrada'],
    ['CERRADO_NO_CUMPLIMIENTO', cierreSinPresentar, 'Cerrada'],
    ['CANCELADO', cancelar, 'Cancelada'],
  ] as const)('%s', async (_nombre, payload, estadoEsperado) => {
    solicitud = fixtureBase();
    fetchSpy = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'ok' }));
    vi.stubGlobal('fetch', fetchSpy);
    const { POST } = await import('./route');
    const res = await POST(req(payload()), ctx());
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe(estadoEsperado);
    expect(solicitud.sqrNumero).toBe('SQR-99001');
    expect(solicitud.sqrCerrada).toBe(true);
    expect(solicitud.sqrCierreEstado).toBe('CERRADA');
    expect(solicitud.sqrError).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // estadoFinalSqr=false persistido (booleano, nunca string) — este
    // cierre ocurrió SIN presentar.
    expect(solicitud.estadoFinalSqr).toBe(false);
    // El booleano llegó también a GrupoColba (FormData, texto "0" en el
    // body — la API receptora valida boolean estilo Laravel, que exige
    // "1"/"0"; "false" literal es rechazado con un error de validación,
    // confirmado con un intento real).
    const bodyEnviado = fetchSpy.mock.calls[0][1].body as FormData;
    expect(bodyEnviado.get('estadoFinalSqr')).toBe('0');
    expect(bodyEnviado.get('soporte')).toBeNull();
  });

  it('RECHAZADO envía la observación REAL del usuario a GrupoColba, nunca el código interno del estado', async () => {
    solicitud = fixtureBase();
    fetchSpy = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'ok' }));
    vi.stubGlobal('fetch', fetchSpy);
    const { POST } = await import('./route');
    await POST(req({ idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada', filaExtra: { estadoRevision: 'RECHAZADO', motivoRechazo: 'No cumple con los requisitos técnicos.' } }), ctx());
    const bodyEnviado = fetchSpy.mock.calls[0][1].body as FormData;
    expect(bodyEnviado.get('observacion')).toBe('No cumple con los requisitos técnicos.');
    expect(bodyEnviado.get('observacion')).not.toContain('RECHAZADO');
  });

  it('Cerrar sin presentar envía la observación real (detalleCierreDirecto), no el código interno', async () => {
    solicitud = fixtureBase();
    fetchSpy = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'ok' }));
    vi.stubGlobal('fetch', fetchSpy);
    const { POST } = await import('./route');
    await POST(req({ idAsignacion: 'ASG-1', resultadoEstado: 'Cerrada', filaExtra: { estadoRevision: 'CERRADO_NO_CUMPLIMIENTO', causaNoPresentacion: 'Otros', detalleCierreDirecto: 'La entidad suspendió el proceso.' } }), ctx());
    const bodyEnviado = fetchSpy.mock.calls[0][1].body as FormData;
    expect(bodyEnviado.get('observacion')).toBe('La entidad suspendió el proceso.');
    expect(bodyEnviado.get('observacion')).not.toContain('CERRADO_NO_CUMPLIMIENTO');
  });
});

describe('Caso 5 (no sobrescribir) — un proceso ya PRESENTADO (estadoFinalSqr=true) que se adjudica/no-adjudica CONSERVA true', () => {
  it.each([
    ['CERRADO_ADJUDICADO', adjudicado],
    ['CERRADO_NO_ADJUDICADO', noAdjudicado],
  ] as const)('%s no degrada estadoFinalSqr=true a false', async (_nombre, payload) => {
    solicitud = fixtureBase({ estadoSolicitud: 'En evaluación', estadoFinalSqr: true, sqrCerrada: true, sqrCierreEstado: 'CERRADA' });
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { POST } = await import('./route');
    const res = await POST(req(payload()), ctx());
    expect(res.status).toBe(200);
    expect(solicitud.estadoFinalSqr).toBe(true);
  });
});

describe('Caso 4/5 — SQR abierta + GrupoColba ERROR: el proceso IGUAL cierra, SQR queda ERROR/abierta', () => {
  it.each([
    ['RECHAZADO', cierreRechazado, 'Cerrada'],
    ['CERRADO_NO_CUMPLIMIENTO', cierreSinPresentar, 'Cerrada'],
    ['CANCELADO', cancelar, 'Cancelada'],
  ] as const)('%s', async (_nombre, payload, estadoEsperado) => {
    solicitud = fixtureBase();
    fetchSpy = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'GrupoColba no disponible' }));
    vi.stubGlobal('fetch', fetchSpy);
    const { POST } = await import('./route');
    const res = await POST(req(payload()), ctx());
    // El fallo de GrupoColba NUNCA se refleja en la respuesta de este
    // endpoint — el proceso se cierra igual, 200 normal.
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe(estadoEsperado);
    expect(solicitud.sqrCerrada).toBe(false);
    expect(solicitud.sqrCierreEstado).toBe('ERROR');
    expect(solicitud.sqrError).toBe('GrupoColba no disponible');
    expect(solicitud.sqrNumero).toBe('SQR-99001'); // nunca se borra
  });
});

describe('Caso 6 — Adjudicado/No adjudicado: defensivo tanto si la SQR ya estaba cerrada como si quedó abierta (legacy)', () => {
  it('CERRADO_ADJUDICADO con SQR ya cerrada → no-op de SQR, cierra normal', async () => {
    solicitud = fixtureBase({ estadoSolicitud: 'En evaluación', sqrCerrada: true, sqrCierreEstado: 'CERRADA' });
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { POST } = await import('./route');
    const res = await POST(req(adjudicado()), ctx());
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('CERRADO_NO_ADJUDICADO con SQR todavía abierta (registro legacy) → intenta cerrarla también, sin bloquear el cierre', async () => {
    solicitud = fixtureBase({ estadoSolicitud: 'En evaluación' });
    fetchSpy = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'ok' }));
    vi.stubGlobal('fetch', fetchSpy);
    const { POST } = await import('./route');
    const res = await POST(req(noAdjudicado()), ctx());
    expect(res.status).toBe(200);
    expect(solicitud.estadoSolicitud).toBe('Cerrada');
    expect(solicitud.sqrCerrada).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('Caso adicional — doble intento concurrente: una sola llamada externa', () => {
  it('dos POST secuenciales antes de que el primero resuelva su commit final no producen dos cierres de SQR', async () => {
    solicitud = fixtureBase();
    let resolverPrimeraLlamada: () => void = () => {};
    fetchSpy = vi.fn(async () => {
      await new Promise<void>((res) => { resolverPrimeraLlamada = () => res(); });
      return { ok: true, status: 200, text: async () => 'ok' };
    });
    vi.stubGlobal('fetch', fetchSpy);
    const { POST } = await import('./route');
    const p1 = POST(req(cierreRechazado()), ctx());
    // Mientras la primera llamada externa está "en vuelo" (sqrCierreEstado
    // ya quedó en CERRANDO por el claim atómico), un segundo intento debe
    // ver el conflicto y NO disparar una segunda llamada a GrupoColba.
    await new Promise((r) => setTimeout(r, 0));
    const res2 = await POST(req(cierreRechazado()), ctx());
    resolverPrimeraLlamada();
    const res1 = await p1;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect([res1.status, res2.status]).toContain(200);
  });
});
