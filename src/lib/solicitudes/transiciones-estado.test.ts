import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/prisma', () => ({ default: {} }));
import {
  ACCIONES_TRANSICION, MATRIZ_ACCIONES, resolverTransicion, autorizarTransicion,
  ejecutarTransicionEstado, type DbTransiciones,
} from './transiciones-estado';
import type { UsuarioActivo } from './autorizacion-asignacion';

const ANALISTA: UsuarioActivo = { id: 10, usuario: 'juan.davila', email: 'juan.davila@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const AJENO: UsuarioActivo = { id: 11, usuario: 'ajeno', email: 'ajeno@grupocolba.com', rol: 'Analista Comercial', estado: 'Activo' };
const ADMIN: UsuarioActivo = { id: 1, usuario: 'admin1', email: 'admin1@grupocolba.com', rol: 'Administrador', estado: 'Activo' };
const DIRECTOR: UsuarioActivo = { id: 6, usuario: 'ricardo.mejia', email: 'ricardo.mejia@grupocolba.com', rol: 'Director Comercial', estado: 'Activo' };
const COORDINADOR: UsuarioActivo = { id: 5, usuario: 'laura.buelvas', email: 'laura.buelvas@grupocolba.com', rol: 'Coordinador Comercial', estado: 'Activo' };

describe('resolverTransicion — matriz', () => {
  it('cada transición permitida resuelve correctamente', () => {
    expect(resolverTransicion('INICIAR_REVISION', 'ASIGNADO_REVISION')).toEqual({ ok: true, desde: 'ASIGNADO_REVISION', hasta: 'EN_REVISION' });
    expect(resolverTransicion('ENVIAR_A_OBSERVACION', 'EN_REVISION')).toEqual({ ok: true, desde: 'EN_REVISION', hasta: 'EN_OBSERVACION' });
    expect(resolverTransicion('APROBAR_SIN_OBSERVACIONES', 'EN_REVISION')).toEqual({ ok: true, desde: 'EN_REVISION', hasta: 'APROBADO_ELABORACION' });
    expect(resolverTransicion('REENVIAR_REVISION', 'EN_OBSERVACION')).toEqual({ ok: true, desde: 'EN_OBSERVACION', hasta: 'EN_REVISION' });
    expect(resolverTransicion('FINALIZAR_REVISION', 'EN_OBSERVACION')).toEqual({ ok: true, desde: 'EN_OBSERVACION', hasta: 'APROBADO_ELABORACION' });
    expect(resolverTransicion('APROBAR_PARA_ELABORACION', 'REVISION_FINALIZADA')).toEqual({ ok: true, desde: 'REVISION_FINALIZADA', hasta: 'APROBADO_ELABORACION' });
    expect(resolverTransicion('INICIAR_ELABORACION', 'APROBADO_ELABORACION')).toEqual({ ok: true, desde: 'APROBADO_ELABORACION', hasta: 'EN_ELABORACION' });
    expect(resolverTransicion('PRESENTAR', 'EN_ELABORACION')).toEqual({ ok: true, desde: 'EN_ELABORACION', hasta: 'PRESENTADO' });
  });

  it('cada acción rechaza cualquier estado distinto al que exige', () => {
    for (const accion of ACCIONES_TRANSICION) {
      const { desde } = MATRIZ_ACCIONES[accion];
      for (const otro of ['SELECCION_PROCESO', 'REVISION_COMERCIAL', 'ASIGNADO_REVISION', 'EN_REVISION', 'EN_OBSERVACION', 'REVISION_FINALIZADA', 'APROBADO_ELABORACION', 'EN_ELABORACION', 'PRESENTADO', 'CERRADA', 'CANCELADA'] as const) {
        if (otro === desde) continue;
        const r = resolverTransicion(accion, otro);
        expect(r.ok, `${accion} desde ${otro} debería fallar`).toBe(false);
      }
    }
  });

  it('acción desconocida se rechaza', () => {
    const r = resolverTransicion('ACCION_INVENTADA', 'ASIGNADO_REVISION');
    expect(r.ok).toBe(false);
  });

  it('estado desconocido (null) se rechaza sin adivinar', () => {
    const r = resolverTransicion('INICIAR_REVISION', null);
    expect(r.ok).toBe(false);
  });

  it('estados terminales (CERRADA/CANCELADA) no tienen ninguna acción que parta de ellos — este endpoint nunca cierra', () => {
    for (const accion of ACCIONES_TRANSICION) {
      expect(resolverTransicion(accion, 'CERRADA').ok).toBe(false);
      expect(resolverTransicion(accion, 'CANCELADA').ok).toBe(false);
    }
  });
});

describe('autorizarTransicion', () => {
  const solicitudConJuan = { estadoSolicitud: 'Asignado para revisión', asignaciones: [{ idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila' }] };
  it('Administrador: permitido aunque no esté asignado', () => {
    expect(autorizarTransicion(ADMIN, solicitudConJuan).autorizado).toBe(true);
  });
  it('Director Comercial: permitido aunque no esté asignado', () => {
    expect(autorizarTransicion(DIRECTOR, solicitudConJuan).autorizado).toBe(true);
  });
  it('Coordinador Comercial: permitido aunque no esté asignado', () => {
    expect(autorizarTransicion(COORDINADOR, solicitudConJuan).autorizado).toBe(true);
  });
  it('responsable activo: permitido', () => {
    expect(autorizarTransicion(ANALISTA, solicitudConJuan).autorizado).toBe(true);
  });
  it('analista no asignado y sin rol privilegiado: denegado', () => {
    expect(autorizarTransicion(AJENO, solicitudConJuan).autorizado).toBe(false);
  });
});

// ── ejecutarTransicionEstado — con un fake DB (mismo patrón que cerrar/route.test.ts) ──

let solicitud: Record<string, unknown>;
let auditLogs: Array<Record<string, unknown>> = [];
let fallarAuditLog = false;

function resetFixture() {
  solicitud = {
    id: 300, estadoSolicitud: 'ASIGNADO_REVISION', procesoId: 55,
    asignaciones: [
      { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', observaciones: ['no tocar'], evidencias: [{ nombre: 'x' }] },
      { idAsignacion: 'ASG-2', analistaAsignado: 'laura.buelvas' },
    ],
  };
  auditLogs = [];
  fallarAuditLog = false;
}

function makeDb(): DbTransiciones {
  return {
    solicitud: {
      async findUnique({ where }) {
        return where.id === solicitud.id ? JSON.parse(JSON.stringify(solicitud)) : null;
      },
      async updateMany({ where, data }) {
        const w = where as Record<string, unknown> & { id: number };
        if (w.id !== solicitud.id) return { count: 0 };
        for (const [clave, valor] of Object.entries(w)) {
          if (clave === 'id') continue;
          if ((solicitud[clave] ?? null) !== (valor ?? null)) return { count: 0 };
        }
        solicitud = { ...solicitud, ...data };
        return { count: 1 };
      },
    },
    auditLog: {
      async create({ data }) {
        if (fallarAuditLog) throw new Error('fallo simulado de AuditLog');
        auditLogs.push(data);
        return { id: auditLogs.length, ...data };
      },
    },
    async $queryRaw() { return [] as never; },
    async $transaction(cb) {
      // Simula la atomicidad real de Prisma: si `cb` lanza, revierte los
      // cambios hechos a `solicitud` dentro de esta invocación.
      const snapshot = JSON.parse(JSON.stringify(solicitud));
      try {
        return await cb(this as unknown as DbTransiciones);
      } catch (e) {
        solicitud = snapshot;
        throw e;
      }
    },
  };
}

describe('ejecutarTransicionEstado', () => {
  beforeEach(resetFixture);

  it('transición válida: 200, escribe estado canónico, refleja estadoRevision en TODAS las filas, genera AuditLog', async () => {
    const db = makeDb();
    const r = await ejecutarTransicionEstado({
      db, solicitudId: 300, accion: 'INICIAR_REVISION', estadoEsperadoCrudo: 'ASIGNADO_REVISION',
      actor: ANALISTA, requestId: 'req-1',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.estadoNuevo).toBe('EN_REVISION');
    expect(solicitud.estadoSolicitud).toBe('EN_REVISION');
    const asigs = solicitud.asignaciones as Record<string, unknown>[];
    expect(asigs[0].estadoRevision).toBe('EN_REVISION');
    expect(asigs[1].estadoRevision).toBe('EN_REVISION');
    // no altera observaciones/evidencias de la fila
    expect(asigs[0].observaciones).toEqual(['no tocar']);
    expect(asigs[0].evidencias).toEqual([{ nombre: 'x' }]);
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].accion).toBe('solicitud_transicion_estado');
    const detalle = auditLogs[0].detalle as Record<string, unknown>;
    expect(detalle.accionFlujo).toBe('INICIAR_REVISION');
    expect(detalle.estadoAnterior).toBe('ASIGNADO_REVISION');
    expect(detalle.estadoNuevo).toBe('EN_REVISION');
    expect(detalle.etapaAnterior).toBe('VALIDACION');
    expect(detalle.etapaNueva).toBe('VALIDACION');
    expect(detalle.actorUserId).toBe(ANALISTA.id);
    expect(detalle.actorUsuario).toBe(ANALISTA.usuario);
  });

  it('acepta el estado esperado en formato legado (compatibilidad)', async () => {
    solicitud.estadoSolicitud = 'Asignado para revisión';
    const db = makeDb();
    const r = await ejecutarTransicionEstado({
      db, solicitudId: 300, accion: 'INICIAR_REVISION', estadoEsperadoCrudo: 'ASIGNADO_REVISION', actor: ANALISTA,
    });
    expect(r.ok).toBe(true);
  });

  it('segundo request con estadoEsperado anterior (ya cambiado por otro) → 409, no sobrescribe', async () => {
    const db = makeDb();
    const r1 = await ejecutarTransicionEstado({ db, solicitudId: 300, accion: 'INICIAR_REVISION', estadoEsperadoCrudo: 'ASIGNADO_REVISION', actor: ANALISTA });
    expect(r1.ok).toBe(true);

    // Un segundo request "cree" que sigue en ASIGNADO_REVISION (desactualizado).
    const r2 = await ejecutarTransicionEstado({ db, solicitudId: 300, accion: 'INICIAR_REVISION', estadoEsperadoCrudo: 'ASIGNADO_REVISION', actor: ANALISTA });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.status).toBe(409);
    expect(r2.error).toContain('actualizado por otro usuario');
    expect(solicitud.estadoSolicitud).toBe('EN_REVISION'); // el primero no se pierde
  });

  it('acción inválida para el estado actual → 400', async () => {
    const db = makeDb();
    const r = await ejecutarTransicionEstado({ db, solicitudId: 300, accion: 'PRESENTAR', estadoEsperadoCrudo: 'ASIGNADO_REVISION', actor: ANALISTA });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
  });

  it('solicitud inexistente → 404', async () => {
    const db = makeDb();
    const r = await ejecutarTransicionEstado({ db, solicitudId: 999, accion: 'INICIAR_REVISION', estadoEsperadoCrudo: 'ASIGNADO_REVISION', actor: ANALISTA });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(404);
  });

  it('usuario no autorizado (ajeno, sin rol privilegiado) → 403, no escribe nada', async () => {
    const db = makeDb();
    const r = await ejecutarTransicionEstado({ db, solicitudId: 300, accion: 'INICIAR_REVISION', estadoEsperadoCrudo: 'ASIGNADO_REVISION', actor: AJENO });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(403);
    expect(solicitud.estadoSolicitud).toBe('ASIGNADO_REVISION');
  });

  it('administrador/Director/Coordinador pueden transicionar aunque no estén asignados', async () => {
    for (const actor of [ADMIN, DIRECTOR, COORDINADOR]) {
      resetFixture();
      const db = makeDb();
      const r = await ejecutarTransicionEstado({ db, solicitudId: 300, accion: 'INICIAR_REVISION', estadoEsperadoCrudo: 'ASIGNADO_REVISION', actor });
      expect(r.ok, actor.rol).toBe(true);
    }
  });

  it('transición inválida no genera AuditLog', async () => {
    const db = makeDb();
    await ejecutarTransicionEstado({ db, solicitudId: 300, accion: 'PRESENTAR', estadoEsperadoCrudo: 'ASIGNADO_REVISION', actor: ANALISTA });
    expect(auditLogs).toHaveLength(0);
  });

  it('usuario no autorizado no genera AuditLog', async () => {
    const db = makeDb();
    await ejecutarTransicionEstado({ db, solicitudId: 300, accion: 'INICIAR_REVISION', estadoEsperadoCrudo: 'ASIGNADO_REVISION', actor: AJENO });
    expect(auditLogs).toHaveLength(0);
  });

  it('si falla la escritura de AuditLog, se revierte la transición completa (todo o nada)', async () => {
    fallarAuditLog = true;
    const db = makeDb();
    await expect(ejecutarTransicionEstado({
      db, solicitudId: 300, accion: 'INICIAR_REVISION', estadoEsperadoCrudo: 'ASIGNADO_REVISION', actor: ANALISTA,
    })).rejects.toThrow('fallo simulado de AuditLog');
    // El estado NO debe haber quedado a medio camino.
    expect(solicitud.estadoSolicitud).toBe('ASIGNADO_REVISION');
  });

  it('el actor siempre viene del parámetro `actor` resuelto en servidor — nunca hay forma de inyectarlo desde datos externos', async () => {
    const db = makeDb();
    const r = await ejecutarTransicionEstado({ db, solicitudId: 300, accion: 'INICIAR_REVISION', estadoEsperadoCrudo: 'ASIGNADO_REVISION', actor: ANALISTA });
    expect(r.ok).toBe(true);
    const detalle = auditLogs[0].detalle as Record<string, unknown>;
    expect(detalle.actorUsuario).toBe('juan.davila');
    expect(detalle.actorRol).toBe('Analista Comercial');
  });

  it('resultadoFinal/causalCierre no se tocan en una transición intermedia', async () => {
    solicitud.resultadoFinal = null;
    solicitud.causalCierre = null;
    const db = makeDb();
    await ejecutarTransicionEstado({ db, solicitudId: 300, accion: 'INICIAR_REVISION', estadoEsperadoCrudo: 'ASIGNADO_REVISION', actor: ANALISTA });
    expect(solicitud.resultadoFinal).toBeNull();
    expect(solicitud.causalCierre).toBeNull();
  });

  it('estado histórico ambiguo (filas activas con ASIGNADO_REVISION y EN_REVISION simultáneos) → 422, transición bloqueada, sin AuditLog', async () => {
    solicitud.estadoSolicitud = 'Asignado para revisión';
    solicitud.asignaciones = [
      { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'ASIGNADO_REVISION' },
      { idAsignacion: 'ASG-2', analistaAsignado: 'laura.buelvas', estadoRevision: 'EN_REVISION' },
    ];
    const db = makeDb();
    const r = await ejecutarTransicionEstado({ db, solicitudId: 300, accion: 'INICIAR_REVISION', estadoEsperadoCrudo: 'ASIGNADO_REVISION', actor: ANALISTA });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(422);
    expect(r.error).toMatch(/ambiguo/i);
    expect(solicitud.estadoSolicitud).toBe('Asignado para revisión'); // sin cambios
    expect(auditLogs).toHaveLength(0);
  });

  it('el backend rechaza la ambigüedad incluso si el cliente envía un estadoEsperado que "coincidiría" con una de las dos filas', async () => {
    solicitud.estadoSolicitud = 'Asignado para revisión';
    solicitud.asignaciones = [
      { idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', estadoRevision: 'ASIGNADO_REVISION' },
      { idAsignacion: 'ASG-2', analistaAsignado: 'laura.buelvas', estadoRevision: 'EN_REVISION' },
    ];
    const db = makeDb();
    // Un cliente que "adivina" ASIGNADO_REVISION (coincide con la fila de Juan) tampoco logra transicionar.
    const r = await ejecutarTransicionEstado({ db, solicitudId: 300, accion: 'INICIAR_REVISION', estadoEsperadoCrudo: 'ASIGNADO_REVISION', actor: COORDINADOR });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(422);
  });

  // ── PRESENTAR + SQR (Caso 8 del ajuste "SQR desacoplada del cierre") —
  // confirma que integrar el gate de SQR en esta función no cambió nada
  // del comportamiento de PRESENTAR para las solicitudes SIN SQR, y que el
  // camino feliz CON SQR sigue funcionando exactamente como se diseñó.
  describe('PRESENTAR', () => {
    function resetFixtureEnElaboracion(extra: Record<string, unknown> = {}) {
      solicitud = {
        id: 300, estadoSolicitud: 'EN_ELABORACION', procesoId: 55,
        codigoProceso: 'X-1-2026', entidad: 'Entidad de prueba',
        sqrNumero: null, sqrCerrada: false, sqrCierreEstado: null, sqrError: null,
        asignaciones: [{ idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', evidencias: [] }],
        ...extra,
      };
      auditLogs = [];
    }

    it('sin SQR asociada: Presentar funciona exactamente igual que antes, sin llamar a GrupoColba', async () => {
      resetFixtureEnElaboracion();
      const db = makeDb();
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const r = await ejecutarTransicionEstado({ db, solicitudId: 300, accion: 'PRESENTAR', estadoEsperadoCrudo: 'EN_ELABORACION', actor: ANALISTA });
      expect(r.ok).toBe(true);
      expect(solicitud.estadoSolicitud).toBe('PRESENTADO');
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('con SQR abierta y evidencia de presentación + GrupoColba OK: cierra la SQR y luego PRESENTADO', async () => {
      resetFixtureEnElaboracion({
        sqrNumero: 'SQR-30001',
        asignaciones: [{ idAsignacion: 'ASG-1', analistaAsignado: 'juan.davila', evidencias: [
          { nombre: 'propuesta.pdf', tipo: 'application/pdf', base64: 'QQ==', fechaCarga: '2026-08-01 08:00:00', finalidad: 'PRESENTACION' },
        ] }],
      });
      const db = makeDb();
      const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'ok' }));
      vi.stubGlobal('fetch', fetchSpy);
      const r = await ejecutarTransicionEstado({ db, solicitudId: 300, accion: 'PRESENTAR', estadoEsperadoCrudo: 'EN_ELABORACION', actor: ANALISTA });
      expect(r.ok).toBe(true);
      expect(solicitud.estadoSolicitud).toBe('PRESENTADO');
      expect(solicitud.sqrCerrada).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      // estadoFinalSqr=true persistido (booleano real) y enviado también
      // a GrupoColba en el mismo payload — como "1" (boolean estilo
      // Laravel; "true" literal es rechazado, confirmado con un intento
      // real de cierre).
      expect(solicitud.estadoFinalSqr).toBe(true);
      const bodyEnviado = (fetchSpy.mock.calls[0] as unknown as [string, { body: FormData }])[1].body;
      expect(bodyEnviado.get('estadoFinalSqr')).toBe('1');
      expect(bodyEnviado.get('soporte')).not.toBeNull();
      vi.unstubAllGlobals();
    });

    it('con SQR abierta SIN evidencia de presentación: bloquea, nunca llega a PRESENTADO', async () => {
      resetFixtureEnElaboracion({ sqrNumero: 'SQR-30002' });
      const db = makeDb();
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const r = await ejecutarTransicionEstado({ db, solicitudId: 300, accion: 'PRESENTAR', estadoEsperadoCrudo: 'EN_ELABORACION', actor: ANALISTA });
      expect(r.ok).toBe(false);
      expect(solicitud.estadoSolicitud).toBe('EN_ELABORACION');
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });
});