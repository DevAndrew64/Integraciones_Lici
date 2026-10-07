/**
 * Motor idempotente único de cierre de SQR — reutilizado por `PRESENTAR`
 * (`coordinarCierreSqrParaPresentar`) y por los cierres terminales de
 * `/[id]/cerrar` (`intentarCerrarSqrSiCorresponde` directo, con su propio
 * `prepararCierre`). Nunca se mockea `fetch` global — se inyecta
 * `cerrarSqrExterno` explícitamente (mismo patrón que el resto del módulo).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  intentarCerrarSqrSiCorresponde, coordinarCierreSqrParaPresentar,
  MENSAJE_CIERRE_SQR_EN_CURSO, MENSAJE_FALTA_EVIDENCIA_PRESENTACION, MENSAJE_ERROR_CIERRE_SQR_EXTERNO,
  type DbCierreSqr,
} from './cierre-sqr-al-presentar';

const ACTOR = { id: 10, usuario: 'juan.davila', email: 'juan.davila@grupocolba.com', rol: 'Analista Comercial' };

let solicitud: Record<string, unknown>;
let auditLogs: Array<Record<string, unknown>> = [];

function resetFixture(extra: Record<string, unknown> = {}) {
  solicitud = {
    id: 400, codigoProceso: 'X-1-2026', entidad: 'Alcaldía de Prueba',
    sqrNumero: 'SQR-1001', sqrCerrada: false, sqrCierreEstado: null, sqrError: null,
    asignaciones: [{ idAsignacion: 'ASG-1', evidencias: [] }],
    ...extra,
  };
  auditLogs = [];
}

function makeDb(): DbCierreSqr {
  return {
    solicitud: {
      async findUnique({ where }) {
        return where.id === solicitud.id ? JSON.parse(JSON.stringify(solicitud)) : null;
      },
      async updateMany({ where, data }) {
        const w = where as { id: number; sqrCierreEstado?: string | null };
        if (w.id !== solicitud.id) return { count: 0 };
        if ('sqrCierreEstado' in w && (solicitud.sqrCierreEstado ?? null) !== (w.sqrCierreEstado ?? null)) {
          return { count: 0 };
        }
        solicitud = { ...solicitud, ...data };
        return { count: 1 };
      },
    },
    auditLog: { async create({ data }) { auditLogs.push(data); return { id: auditLogs.length, ...data }; } },
  };
}

describe('intentarCerrarSqrSiCorresponde — motor idempotente', () => {
  beforeEach(() => resetFixture());

  it('sin sqrNumero → ok, no hay nada que cerrar, nunca llama a GrupoColba', async () => {
    resetFixture({ sqrNumero: null });
    const cerrarSqrExterno = vi.fn();
    const r = await intentarCerrarSqrSiCorresponde({
      db: makeDb(), solicitudId: 400, actor: ACTOR,
      prepararCierre: () => ({ ok: true, estadoFinalSqr: false, observacion: 'x' }),
      cerrarSqrExterno,
    });
    expect(r.ok).toBe(true);
    expect(cerrarSqrExterno).not.toHaveBeenCalled();
  });

  it('sqrCerrada=true → ok, no vuelve a llamar a GrupoColba', async () => {
    resetFixture({ sqrCerrada: true });
    const cerrarSqrExterno = vi.fn();
    const r = await intentarCerrarSqrSiCorresponde({
      db: makeDb(), solicitudId: 400, actor: ACTOR,
      prepararCierre: () => ({ ok: true, estadoFinalSqr: false, observacion: 'x' }),
      cerrarSqrExterno,
    });
    expect(r.ok).toBe(true);
    expect(cerrarSqrExterno).not.toHaveBeenCalled();
  });

  it('sqrCierreEstado="CERRANDO" (otra petición ya reclamó) → 409, no llama a GrupoColba', async () => {
    resetFixture({ sqrCierreEstado: 'CERRANDO' });
    const cerrarSqrExterno = vi.fn();
    const r = await intentarCerrarSqrSiCorresponde({
      db: makeDb(), solicitudId: 400, actor: ACTOR,
      prepararCierre: () => ({ ok: true, estadoFinalSqr: false, observacion: 'x' }),
      cerrarSqrExterno,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.error).toBe(MENSAJE_CIERRE_SQR_EN_CURSO);
    expect(cerrarSqrExterno).not.toHaveBeenCalled();
  });

  it('sqrNumero abierto + GrupoColba OK → cierra SQR, conserva sqrNumero, limpia sqrError', async () => {
    const cerrarSqrExterno = vi.fn(async () => ({ ok: true as const }));
    const r = await intentarCerrarSqrSiCorresponde({
      db: makeDb(), solicitudId: 400, actor: ACTOR,
      prepararCierre: () => ({ ok: true, estadoFinalSqr: false, observacion: 'Se remite respuesta a la SQR...' }),
      cerrarSqrExterno,
    });
    expect(r.ok).toBe(true);
    expect(cerrarSqrExterno).toHaveBeenCalledTimes(1);
    expect(solicitud.sqrNumero).toBe('SQR-1001');
    expect(solicitud.sqrCerrada).toBe(true);
    expect(solicitud.sqrCierreEstado).toBe('CERRADA');
    expect(solicitud.sqrError).toBeNull();
    expect(solicitud.fechaCierreSqr).toBeInstanceOf(Date);
    expect(auditLogs.some((l) => l.accion === 'sqr_cerrado')).toBe(true);
  });

  it('estadoFinalSqr=false llega tal cual (booleano real) a la llamada externa, y el motor descarta cualquier soporte que el llamador incluyera por error', async () => {
    const soporteQueNuncaDeberiaLlegar = { nombre: 'no-deberia-enviarse.pdf', contenido: new Blob(['x']) };
    const cerrarSqrExterno = vi.fn(async (args: { estadoFinalSqr: boolean; soporte?: unknown }) => {
      expect(args.estadoFinalSqr).toBe(false);
      expect(args.soporte).toBeUndefined();
      return { ok: true as const };
    });
    const r = await intentarCerrarSqrSiCorresponde({
      db: makeDb(), solicitudId: 400, actor: ACTOR,
      // `soporte` incluido a propósito para demostrar que el motor lo
      // descarta cuando estadoFinalSqr===false, sin importar qué haya
      // devuelto `prepararCierre`.
      prepararCierre: () => ({ ok: true, estadoFinalSqr: false, observacion: 'No cumple requisitos técnicos.', soporte: soporteQueNuncaDeberiaLlegar }),
      cerrarSqrExterno,
    });
    expect(r.ok).toBe(true);
    expect(cerrarSqrExterno).toHaveBeenCalledTimes(1);
  });

  it('sqrNumero abierto + GrupoColba ERROR → NO marca cerrada, persiste sqrError y sqrCierreEstado=ERROR', async () => {
    const cerrarSqrExterno = vi.fn(async () => ({ ok: false as const, error: 'GrupoColba rechazó la solicitud' }));
    const r = await intentarCerrarSqrSiCorresponde({
      db: makeDb(), solicitudId: 400, actor: ACTOR,
      prepararCierre: () => ({ ok: true, estadoFinalSqr: false, observacion: 'x' }),
      cerrarSqrExterno,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
    expect(r.error).toBe(MENSAJE_ERROR_CIERRE_SQR_EXTERNO);
    expect(solicitud.sqrCerrada).toBe(false);
    expect(solicitud.sqrCierreEstado).toBe('ERROR');
    expect(solicitud.sqrError).toBe('GrupoColba rechazó la solicitud');
    expect(auditLogs.some((l) => l.accion === 'sqr_cierre_error')).toBe(true);
  });

  it('EXTERNAL_NOT_IN_PROCESS: se registra en AuditLog.detalle como diagnóstico, pero NUNCA marca sqrCerrada=true ni sqrCierreEstado=CERRADA', async () => {
    const cerrarSqrExterno = vi.fn(async () => ({
      ok: false as const,
      error: 'Error al cerrar la SQR. Verifique que la SQR esté en estado "En Proceso" e intente nuevamente.',
      status: 400,
      codigo: 'EXTERNAL_NOT_IN_PROCESS' as const,
    }));
    const r = await intentarCerrarSqrSiCorresponde({
      db: makeDb(), solicitudId: 400, actor: ACTOR,
      prepararCierre: () => ({ ok: true, estadoFinalSqr: false, observacion: 'x' }),
      cerrarSqrExterno,
    });
    expect(r.ok).toBe(false);
    // El código de diagnóstico NUNCA decide el resultado de negocio —
    // sigue siendo sqrCerrada=false, sqrCierreEstado=ERROR, exactamente
    // igual que cualquier otro fallo externo.
    expect(solicitud.sqrCerrada).toBe(false);
    expect(solicitud.sqrCierreEstado).toBe('ERROR');
    expect(solicitud.sqrError).toContain('En Proceso');
    const logError = auditLogs.find((l) => l.accion === 'sqr_cierre_error');
    expect(logError).toBeTruthy();
    const detalle = logError!.detalle as Record<string, unknown>;
    expect(detalle.httpStatus).toBe(400);
    expect(detalle.codigoErrorExterno).toBe('EXTERNAL_NOT_IN_PROCESS');
  });

  it('reintento tras ERROR: si ahora GrupoColba responde OK, cierra la SQR una sola vez', async () => {
    resetFixture({ sqrCierreEstado: 'ERROR', sqrError: 'fallo previo' });
    const cerrarSqrExterno = vi.fn(async () => ({ ok: true as const }));
    const r = await intentarCerrarSqrSiCorresponde({
      db: makeDb(), solicitudId: 400, actor: ACTOR,
      prepararCierre: () => ({ ok: true, estadoFinalSqr: false, observacion: 'x' }),
      cerrarSqrExterno,
    });
    expect(r.ok).toBe(true);
    expect(cerrarSqrExterno).toHaveBeenCalledTimes(1);
    expect(solicitud.sqrCerrada).toBe(true);
    expect(solicitud.sqrError).toBeNull();
  });

  it('prepararCierre puede rechazar antes de intentar el cierre (ej. falta un dato de negocio) — nunca llama a GrupoColba', async () => {
    const cerrarSqrExterno = vi.fn();
    const r = await intentarCerrarSqrSiCorresponde({
      db: makeDb(), solicitudId: 400, actor: ACTOR,
      prepararCierre: () => ({ ok: false, status: 400, error: 'falta algo' }),
      cerrarSqrExterno,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('falta algo');
    expect(cerrarSqrExterno).not.toHaveBeenCalled();
  });
});

describe('coordinarCierreSqrParaPresentar — envoltorio específico de PRESENTAR', () => {
  beforeEach(() => resetFixture());

  it('sin ninguna evidencia cargada → bloquea con el mensaje específico, nunca llama a GrupoColba', async () => {
    const cerrarSqrExterno = vi.fn();
    const r = await coordinarCierreSqrParaPresentar({ db: makeDb(), solicitudId: 400, actor: ACTOR, cerrarSqrExterno });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.error).toBe(MENSAJE_FALTA_EVIDENCIA_PRESENTACION);
    expect(cerrarSqrExterno).not.toHaveBeenCalled();
  });

  it('con una sola evidencia de elaboración cargada (sin ninguna designación especial) → la usa automáticamente como soporte', async () => {
    resetFixture({
      asignaciones: [{ idAsignacion: 'ASG-1', evidencias: [
        { nombre: 'elaboracion.pdf', tipo: 'application/pdf', base64: 'AA==', fechaCarga: '2026-08-01 08:00:00' },
      ] }],
    });
    const cerrarSqrExterno = vi.fn(async (args: { estadoFinalSqr: boolean; soporte?: { nombre: string } }) => {
      expect(args.soporte?.nombre).toBe('elaboracion.pdf');
      expect(args.estadoFinalSqr).toBe(true);
      return { ok: true as const };
    });
    const r = await coordinarCierreSqrParaPresentar({ db: makeDb(), solicitudId: 400, actor: ACTOR, cerrarSqrExterno });
    expect(r.ok).toBe(true);
    expect(cerrarSqrExterno).toHaveBeenCalledTimes(1);
    expect(solicitud.sqrCerrada).toBe(true);
  });

  it('con varias evidencias de elaboración cargadas → usa la MÁS RECIENTE por fechaCarga como soporte (nunca evidencias[0])', async () => {
    resetFixture({
      asignaciones: [{ idAsignacion: 'ASG-1', evidencias: [
        { nombre: 'primera.pdf', tipo: 'application/pdf', base64: 'AA==', fechaCarga: '2026-08-01 08:00:00' },
        { nombre: 'segunda.pdf', tipo: 'application/pdf', base64: 'QQ==', fechaCarga: '2026-08-05 09:00:00' },
        { nombre: 'intermedia.pdf', tipo: 'application/pdf', base64: 'Qg==', fechaCarga: '2026-08-03 09:00:00' },
      ] }],
    });
    const cerrarSqrExterno = vi.fn(async (args: { estadoFinalSqr: boolean; soporte?: { nombre: string } }) => {
      expect(args.soporte?.nombre).toBe('segunda.pdf');
      expect(args.estadoFinalSqr).toBe(true);
      return { ok: true as const };
    });
    const r = await coordinarCierreSqrParaPresentar({ db: makeDb(), solicitudId: 400, actor: ACTOR, cerrarSqrExterno });
    expect(r.ok).toBe(true);
    expect(cerrarSqrExterno).toHaveBeenCalledTimes(1);
    expect(solicitud.sqrCerrada).toBe(true);
  });

  it('sin SQR asociada → ok inmediato, nunca exige evidencia ni llama a GrupoColba', async () => {
    resetFixture({ sqrNumero: null });
    const cerrarSqrExterno = vi.fn();
    const r = await coordinarCierreSqrParaPresentar({ db: makeDb(), solicitudId: 400, actor: ACTOR, cerrarSqrExterno });
    expect(r.ok).toBe(true);
    expect(cerrarSqrExterno).not.toHaveBeenCalled();
  });
});
