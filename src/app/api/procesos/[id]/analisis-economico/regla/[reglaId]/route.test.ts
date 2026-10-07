/**
 * FASE A.1 — §1 (gate NO_DETERMINADO/ANALIZAR) y §2 (inmutabilidad de
 * ReglaTrmProceso) sobre PATCH .../regla/[reglaId].
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const SESION = { id: 7, usuario: 'ana.revisora', email: 'ana.revisora@grupocolba.com', rol: 'Administrador', estado: 'Activo' };

let proceso: Record<string, unknown>;
let regla: Record<string, unknown>;
const auditCalls: unknown[] = [];

function resetFixture() {
  proceso = { id: 20, usaPonderacionTrm: 'NO_DETERMINADO', estadoRevisionPliego: 'PENDIENTE_REVISION' };
  regla = {
    id: 300, procesoId: 20, version: 1, estadoVersion: 'CANDIDATA',
    tipoReglaTrm: 'RELATIVA_A_EVENTO', eventoBaseTrm: 'FECHA_CIERRE', fuenteEventoBase: 'resolución de apertura',
    offsetDiasHabiles: 1, politicaActualizacionFecha: 'SIGUE_CRONOGRAMA', fechaBaseCongelada: null, fechaFijaTrm: null,
    reglaCentavos: 'REDONDEO', textoReglaTrm: 'TRM del día hábil siguiente al cierre',
  };
  auditCalls.length = 0;
}

const fakeImpl = {
  reglaTrmProceso: {
    async findFirst({ where }: { where: { id: number; procesoId: number } }) {
      return (regla.id === where.id && regla.procesoId === where.procesoId) ? { ...regla } : null;
    },
    async findMany({ where }: { where: { procesoId: number } }) {
      return where.procesoId === proceso.id ? [{ ...regla }] : [];
    },
    async update({ where, data }: { where: { id: number }; data: Record<string, unknown> }) {
      if (where.id !== regla.id) throw new Error('no encontrado');
      regla = { ...regla, ...data };
      return { ...regla };
    },
  },
  conjuntoMetodosPonderacionProceso: { async findMany() { return []; } },
  analisisEconomicoProceso: { async count() { return 1; } },
  decisionExcepcionCandidata: { async updateMany() { return { count: 0 }; } },
  proceso: {
    async findUnique({ where }: { where: { id: number } }) {
      return where.id === proceso.id ? { ...proceso } : null;
    },
    async update({ where, data }: { where: { id: number }; data: Record<string, unknown> }) {
      if (where.id !== proceso.id) throw new Error('no encontrado');
      proceso = { ...proceso, ...data };
      return { ...proceso };
    },
  },
  // Simula el rollback de `prisma.$transaction`: si el callback lanza, se
  // restaura el snapshot de `regla` tomado antes de entrar (ver límite
  // documentado en el describe de atomicidad más abajo).
  async $transaction(fn: (tx: unknown) => Promise<unknown>) {
    const snapshotRegla = { ...regla };
    try {
      return await fn(fakeImpl);
    } catch (err) {
      regla = snapshotRegla;
      throw err;
    }
  },
  pool: { connect: async () => ({ query: async () => ({}), release: () => {} }) },
};

let fallarAuditoria = false;

vi.mock('@/lib/prisma', () => ({ default: fakeImpl, pool: fakeImpl.pool }));
vi.mock('@/lib/session', () => ({ getSession: async () => SESION }));
vi.mock('@/lib/audit', () => ({
  auditLog: async (p: unknown) => {
    if (fallarAuditoria) throw new Error('AuditLog caído (simulado)');
    auditCalls.push(p);
  },
}));

function req(body: unknown) {
  return new NextRequest('http://localhost/api/procesos/20/analisis-economico/regla/300', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '20', reglaId: '300' }) }; }

beforeEach(() => { vi.resetModules(); resetFixture(); fallarAuditoria = false; });

describe('PATCH .../regla/[reglaId] — inmutabilidad §2', () => {
  it('5. editar regla CANDIDATA → permitido', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ accion: 'editar', campos: { reglaCentavos: 'TRUNCADO' } }), ctx());
    expect(res.status).toBe(200);
    expect(regla.reglaCentavos).toBe('TRUNCADO');
  });

  it('6. editar regla ACTIVA → rechazado (409)', async () => {
    regla.estadoVersion = 'ACTIVA';
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ accion: 'editar', campos: { reglaCentavos: 'TRUNCADO' } }), ctx());
    expect(res.status).toBe(409);
    const d = await res.json();
    expect(d.error).toMatch(/inmutable/i);
    expect(regla.reglaCentavos).toBe('REDONDEO'); // no cambió
  });

  it('7. corrección de una regla ACTIVA requiere nueva CANDIDATA: no hay ruta que edite in situ una ACTIVA', async () => {
    regla.estadoVersion = 'ACTIVA';
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ accion: 'editar', campos: { offsetDiasHabiles: 2 } }), ctx());
    expect(res.status).toBe(409);
    // el único camino de "aprobar" también exige una CANDIDATA vigente — no existe transición ACTIVA→ACTIVA
    const res2 = await PATCH(req({ accion: 'aprobar' }), ctx());
    expect(res2.status).not.toBe(200);
  });

  it('§3 — auditoría de edición conserva antes/después', async () => {
    const { PATCH } = await import('./route');
    await PATCH(req({ accion: 'editar', campos: { offsetDiasHabiles: 2 } }), ctx());
    expect(auditCalls).toHaveLength(1);
    const det = (auditCalls[0] as { detalle: Record<string, unknown> }).detalle as { antes: Record<string, unknown>; despues: Record<string, unknown> };
    expect(det.antes).toMatchObject({ offsetDiasHabiles: 1 });
    expect(det.despues).toMatchObject({ offsetDiasHabiles: 2 });
  });
});

describe('PATCH .../regla/[reglaId] { accion: "aprobar" } — gate §1 NO_DETERMINADO/SI', () => {
  it('bloquea activar con usaPonderacionTrm = NO_DETERMINADO', async () => {
    proceso.usaPonderacionTrm = 'NO_DETERMINADO';
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ accion: 'aprobar' }), ctx());
    expect(res.status).toBe(409);
    const d = await res.json();
    expect(d.error).toMatch(/usaPonderacionTrm/);
    expect(regla.estadoVersion).toBe('CANDIDATA'); // no se activó
  });

  it('bloquea activar con usaPonderacionTrm = NO', async () => {
    proceso.usaPonderacionTrm = 'NO';
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ accion: 'aprobar' }), ctx());
    expect(res.status).toBe(409);
    expect(regla.estadoVersion).toBe('CANDIDATA');
  });

  it('permite activar con usaPonderacionTrm = SI', async () => {
    proceso.usaPonderacionTrm = 'SI';
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ accion: 'aprobar' }), ctx());
    expect(res.status).toBe(200);
    expect(regla.estadoVersion).toBe('ACTIVA');
  });
});

describe('PATCH .../regla/[reglaId] { accion: "editar" } — atomicidad §2', () => {
  it('si el AuditLog falla, el UPDATE de la regla se revierte (mismo $transaction)', async () => {
    fallarAuditoria = true;
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ accion: 'editar', campos: { reglaCentavos: 'TRUNCADO' } }), ctx());
    expect(res.status).toBe(500);
    expect(regla.reglaCentavos).toBe('REDONDEO'); // revertido
    expect(auditCalls).toHaveLength(0);
  });
});
