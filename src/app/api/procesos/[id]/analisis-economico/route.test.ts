/**
 * FASE A.1 §4 — `Proceso.usaPonderacionTrm` es una decisión humana auditable:
 * PATCH { accion: "confirmarUsoTrm" } debe registrar antes/después y
 * resincronizar `estadoRevisionPliego`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const SESION = { id: 7, usuario: 'ana.revisora', email: 'ana.revisora@grupocolba.com', rol: 'Administrador', estado: 'Activo' };

let proceso: Record<string, unknown>;
const auditCalls: unknown[] = [];
let sincronizarLlamado = 0;

function resetFixture() {
  proceso = { id: 20, usaPonderacionTrm: 'NO_DETERMINADO', estadoRevisionPliego: 'PENDIENTE_REVISION' };
  auditCalls.length = 0;
  sincronizarLlamado = 0;
}

const fakeImpl = {
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
  // restaura el snapshot de `proceso` tomado antes de entrar.
  async $transaction(fn: (tx: unknown) => Promise<unknown>) {
    const snapshotProceso = { ...proceso };
    try {
      return await fn(fakeImpl);
    } catch (err) {
      proceso = snapshotProceso;
      throw err;
    }
  },
};

let fallarAuditoria = false;

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({ getSession: async () => SESION }));
vi.mock('@/lib/audit', () => ({
  auditLog: async (p: unknown) => {
    if (fallarAuditoria) throw new Error('AuditLog caído (simulado)');
    auditCalls.push(p);
  },
}));
vi.mock('@/lib/ponderacion-economica/sincronizar-estado-pliego', () => ({
  sincronizarEstadoRevisionPliego: async () => { sincronizarLlamado++; return proceso.estadoRevisionPliego; },
}));

function req(body: unknown) {
  return new NextRequest('http://localhost/api/procesos/20/analisis-economico', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '20' }) }; }

beforeEach(() => { vi.resetModules(); resetFixture(); fallarAuditoria = false; });

describe('PATCH .../analisis-economico { accion: "confirmarUsoTrm" }', () => {
  it('NO_DETERMINADO → SI: audita antes/después y resincroniza estadoRevisionPliego', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ accion: 'confirmarUsoTrm', valor: 'SI' }), ctx());
    expect(res.status).toBe(200);
    expect(proceso.usaPonderacionTrm).toBe('SI');
    expect(sincronizarLlamado).toBe(1);
    expect(auditCalls).toHaveLength(1);
    const det = (auditCalls[0] as { detalle: Record<string, unknown> }).detalle as { antes: string; despues: string };
    expect(det.antes).toBe('NO_DETERMINADO');
    expect(det.despues).toBe('SI');
  });

  it('SI → NO: se audita el cambio; NO se borra nada del historial (esta ruta no toca reglas/conjuntos)', async () => {
    proceso.usaPonderacionTrm = 'SI';
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ accion: 'confirmarUsoTrm', valor: 'NO' }), ctx());
    expect(res.status).toBe(200);
    expect(proceso.usaPonderacionTrm).toBe('NO');
    const det = (auditCalls[0] as { detalle: Record<string, unknown> }).detalle as { antes: string; despues: string };
    expect(det.antes).toBe('SI');
    expect(det.despues).toBe('NO');
    expect(sincronizarLlamado).toBe(1);
  });

});

describe('PATCH .../analisis-economico { accion: "confirmarUsoTrm" } — atomicidad §2', () => {
  it('si el AuditLog falla, el UPDATE de usaPonderacionTrm se revierte (mismo $transaction que la sincronización)', async () => {
    fallarAuditoria = true;
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ accion: 'confirmarUsoTrm', valor: 'SI' }), ctx());
    expect(res.status).toBe(500);
    expect(proceso.usaPonderacionTrm).toBe('NO_DETERMINADO'); // revertido
    expect(sincronizarLlamado).toBe(0); // nunca se llegó a sincronizar: el audit falló antes, dentro del mismo bloque
  });
});

// Este test reasigna @/lib/session dinámicamente (vi.doMock/doUnmock) — se
// deja AL FINAL del archivo porque esa sustitución puede filtrarse al
// siguiente test si vitest reordenara ejecución; con beforeEach + resetModules
// no ocurre, pero se aísla por prudencia.
describe('PATCH .../analisis-economico — requiere sesión humana', () => {
  it('Gemini nunca llega a esta ruta como actor: siempre requiere sesión humana', async () => {
    vi.resetModules();
    vi.doMock('@/lib/session', () => ({ getSession: async () => null }));
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ accion: 'confirmarUsoTrm', valor: 'SI' }), ctx());
    expect(res.status).toBe(401);
    vi.doUnmock('@/lib/session');
  });
});
