/**
 * FASE A.1 §1 — el gate `usaPonderacionTrm` también bloquea la activación de
 * un CONJUNTO de métodos (no solo la regla TRM).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const SESION = { id: 7, usuario: 'ana.revisora', email: 'ana.revisora@grupocolba.com', rol: 'Administrador', estado: 'Activo' };

let proceso: Record<string, unknown>;
let conjunto: Record<string, unknown>;

function resetFixture() {
  proceso = { id: 20, usaPonderacionTrm: 'NO_DETERMINADO', estadoRevisionPliego: 'PENDIENTE_REVISION' };
  conjunto = { id: 900, procesoId: 20, version: 1, estadoVersion: 'CANDIDATA' };
}

const fakeImpl = {
  conjuntoMetodosPonderacionProceso: {
    async findFirst({ where }: { where: { id: number; procesoId: number } }) {
      return (conjunto.id === where.id && conjunto.procesoId === where.procesoId) ? { ...conjunto } : null;
    },
    async findMany({ where }: { where: { procesoId: number } }) {
      return where.procesoId === proceso.id ? [{ ...conjunto }] : [];
    },
    async update({ where, data }: { where: { id: number }; data: Record<string, unknown> }) {
      if (where.id !== conjunto.id) throw new Error('no encontrado');
      conjunto = { ...conjunto, ...data };
      return { ...conjunto };
    },
  },
  metodoPonderacionProceso: { async findMany() { return []; }, async updateMany() { return { count: 0 }; } },
  reglaTrmProceso: { async findMany() { return []; } },
  analisisEconomicoProceso: { async count() { return 1; } },
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
  $transaction: async (fn: (tx: unknown) => unknown) => fn(fakeImpl),
  pool: { connect: async () => ({ query: async () => ({}), release: () => {} }) },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl, pool: fakeImpl.pool }));
vi.mock('@/lib/session', () => ({ getSession: async () => SESION }));
vi.mock('@/lib/audit', () => ({ auditLog: async () => {} }));
// El conjunto de este fixture no tiene métodos reales — se aísla el gate §1
// del gate de criterios (§6/§9) fijando resolverCriteriosDeConjunto/estadoRevisionMetodosDeConjunto en OK.
vi.mock('@/lib/ponderacion-economica/robusto/gate-conjunto', async (orig) => {
  const real = await orig<typeof import('@/lib/ponderacion-economica/robusto/gate-conjunto')>();
  return {
    ...real,
    resolverCriteriosDeConjunto: async () => ({ ok: true, criterios: [], probabilidadEstructural: 1, requierePresupuesto: false }),
    estadoRevisionMetodosDeConjunto: async () => ({ total: 3, pendientes: 0, rechazados: 0, todosMetodosTienenPM: true }),
  };
});

function req(body: unknown) {
  return new NextRequest('http://localhost/api/procesos/20/analisis-economico/conjunto/900', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '20', conjuntoId: '900' }) }; }

beforeEach(() => { vi.resetModules(); resetFixture(); });

describe('PATCH .../conjunto/[conjuntoId] { accion: "aprobar" } — gate §1', () => {
  it('bloquea activar el conjunto con usaPonderacionTrm = NO_DETERMINADO', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ accion: 'aprobar' }), ctx());
    expect(res.status).toBe(422);
    const d = await res.json();
    expect(d.error).toMatch(/usaPonderacionTrm/);
    expect(conjunto.estadoVersion).toBe('CANDIDATA');
  });

  it('bloquea activar el conjunto con usaPonderacionTrm = NO', async () => {
    proceso.usaPonderacionTrm = 'NO';
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ accion: 'aprobar' }), ctx());
    expect(res.status).toBe(422);
    expect(conjunto.estadoVersion).toBe('CANDIDATA');
  });

  it('permite activar el conjunto con usaPonderacionTrm = SI', async () => {
    proceso.usaPonderacionTrm = 'SI';
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ accion: 'aprobar' }), ctx());
    expect(res.status).toBe(200);
    expect(conjunto.estadoVersion).toBe('ACTIVA');
  });
});
