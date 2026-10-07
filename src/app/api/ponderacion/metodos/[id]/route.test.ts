/**
 * FASE A.1 §2 — Inmutabilidad de `MetodoPonderacionProceso` cuando pertenece
 * a un CONJUNTO versionado: solo editable mientras el conjunto es CANDIDATA.
 * ACTIVA / SUPERSEDED / RECHAZADA → inmutable (409). Además: auditoría
 * antes/después campo por campo (§3) en cada edición permitida.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const SESION = { id: 7, usuario: 'ana.revisora', email: 'ana.revisora@grupocolba.com', rol: 'Administrador', estado: 'Activo' };

let metodo: Record<string, unknown>;
let conjunto: Record<string, unknown> | null;
const auditCalls: unknown[] = [];

function resetFixture() {
  metodo = {
    id: 501, estadoRevision: 'pendiente_revision', empresaGrupo: null, razonSocial: null,
    rangoTrmDesde: 0, rangoTrmHasta: 33,
    conjuntoMetodosId: 900,
    tipoFormula: 'mediana', puntajeMaximo: 40, presupuestoOficial: null, formulaTexto: null, notasFormula: null,
    condicionTrmTexto: 'decimal 00 a 33', baseEconomicaEvaluada: null, descripcionBaseEconomica: null,
    baseEconomicaTextoFuente: null, baseEconomicaPaginaReferencia: null,
    formulaReferenciaTexto: 'promedio simple de las ofertas hábiles', reglaPuntuacionTexto: 'la más cercana al valor de referencia obtiene el máximo puntaje',
    formulaKeyMotor: null, equivalenciaMotorEstado: 'NO_EVALUADA', equivalenciaMotorNota: null,
  };
  conjunto = { estadoVersion: 'CANDIDATA' };
  auditCalls.length = 0;
}

const fakeImpl = {
  metodoPonderacionProceso: {
    async findUnique({ where }: { where: { id: number } }) {
      return where.id === metodo.id ? { ...metodo } : null;
    },
    async update({ where, data }: { where: { id: number }; data: Record<string, unknown> }) {
      if (where.id !== metodo.id) throw new Error('no encontrado');
      metodo = { ...metodo, ...data };
      return { ...metodo };
    },
  },
  conjuntoMetodosPonderacionProceso: {
    async findUnique({ where }: { where: { id: number } }) {
      return where.id === metodo.conjuntoMetodosId ? { ...conjunto } : null;
    },
  },
  user: { async findUnique() { return { entidadGrupo: null }; } },
  // Simula la semántica de rollback de `prisma.$transaction`: si el
  // callback lanza (p.ej. porque el AuditLog falló), el estado mutado dentro
  // NO queda aplicado — se restaura el snapshot tomado antes de entrar.
  async $transaction(fn: (tx: unknown) => Promise<unknown>) {
    const snapshotMetodo = { ...metodo };
    try {
      return await fn(fakeImpl);
    } catch (err) {
      metodo = snapshotMetodo;
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
// requireSession / puedeVerConsolidadoSimulaciones reales; damos acceso "consolidado" para no depender de empresaGrupo
vi.mock('@/lib/authz', async (orig) => {
  const real = await orig<typeof import('@/lib/authz')>();
  return { ...real, puedeVerConsolidadoSimulaciones: async () => true };
});

function patchReq(body: unknown) {
  return new NextRequest('http://localhost/api/ponderacion/metodos/501', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '501' }) }; }

beforeEach(() => { vi.resetModules(); resetFixture(); fallarAuditoria = false; });

describe('PATCH /api/ponderacion/metodos/[id] — inmutabilidad §2', () => {
  it('1. editar método de un conjunto CANDIDATA → permitido', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ puntajeMaximo: 45 }), ctx());
    expect(res.status).toBe(200);
    expect(metodo.puntajeMaximo).toBe(45);
  });

  it('2. editar método de un conjunto ACTIVA → rechazado (409)', async () => {
    conjunto = { estadoVersion: 'ACTIVA' };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ puntajeMaximo: 45 }), ctx());
    expect(res.status).toBe(409);
    const d = await res.json();
    expect(d.error).toMatch(/inmutable/i);
    expect(metodo.puntajeMaximo).toBe(40); // no cambió
  });

  it('3. editar método de un conjunto SUPERSEDED → rechazado (409)', async () => {
    conjunto = { estadoVersion: 'SUPERSEDED' };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ tipoFormula: 'media_geometrica' }), ctx());
    expect(res.status).toBe(409);
  });

  it('4. editar método de un conjunto RECHAZADA → rechazado (409)', async () => {
    conjunto = { estadoVersion: 'RECHAZADA' };
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ notasFormula: 'x' }), ctx());
    expect(res.status).toBe(409);
  });

  it('método legacy sin conjuntoMetodosId (flujo anterior a A.1): NO aplica el gate', async () => {
    metodo.conjuntoMetodosId = null;
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ puntajeMaximo: 45 }), ctx());
    expect(res.status).toBe(200);
  });

  it('§6 — formulaKeyMotor inválido (no es una FormulaKey real del motor) se rechaza: sin fuzzy matching', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ formulaKeyMotor: 'media_geometrica_alta_inventada' }), ctx());
    expect(res.status).toBe(422);
  });

  it('§6 — formulaKeyMotor + equivalenciaMotorEstado válidos: se guardan', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ formulaKeyMotor: 'mediana', equivalenciaMotorEstado: 'EQUIVALENTE_CONFIRMADA', equivalenciaMotorNota: 'misma fórmula, mismo redondeo' }), ctx());
    expect(res.status).toBe(200);
    expect(metodo.formulaKeyMotor).toBe('mediana');
    expect(metodo.equivalenciaMotorEstado).toBe('EQUIVALENTE_CONFIRMADA');
  });

  it('§3 — auditoría conserva antes/después campo por campo, no un mensaje genérico', async () => {
    const { PATCH } = await import('./route');
    await PATCH(patchReq({ rangoTrmHasta: 25 }), ctx());
    expect(auditCalls).toHaveLength(1);
    const det = (auditCalls[0] as { detalle: Record<string, unknown> }).detalle as {
      entidad: string; entidadId: number; antes: Record<string, unknown>; despues: Record<string, unknown>;
    };
    expect(det.entidad).toBe('MetodoPonderacionProceso');
    expect(det.entidadId).toBe(501);
    expect(det.antes).toMatchObject({ rangoTrmHasta: 33 });
    expect(det.despues).toMatchObject({ rangoTrmHasta: 25 });
  });

  it('§3 — bloqueado por inmutabilidad: NO se emite ningún AuditLog de edición', async () => {
    conjunto = { estadoVersion: 'ACTIVA' };
    const { PATCH } = await import('./route');
    await PATCH(patchReq({ rangoTrmHasta: 25 }), ctx());
    expect(auditCalls).toHaveLength(0);
  });
});

describe('PATCH .../metodos/[id] — invalidación tras edición (microauditoría §1)', () => {
  it('un método ya aprobado NO conserva la aprobación si cambia su contenido (Grupo A)', async () => {
    metodo.estadoRevision = 'aprobado'; metodo.aprobado = true; metodo.revisadoPorId = 3; metodo.revisadoEn = new Date('2026-01-01');
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ rangoTrmHasta: 25 }), ctx());
    expect(res.status).toBe(200);
    expect(metodo.estadoRevision).toBe('pendiente_revision');
    expect(metodo.aprobado).toBe(false);
    expect(metodo.revisadoPorId).toBeNull();
    expect(metodo.revisadoEn).toBeNull();
  });

  it('reenviar el MISMO valor de un campo de Grupo A no invalida nada (no hubo cambio real)', async () => {
    metodo.estadoRevision = 'aprobado'; metodo.aprobado = true;
    const { PATCH } = await import('./route');
    await PATCH(patchReq({ rangoTrmHasta: 33 }), ctx()); // 33 ya era el valor existente
    expect(metodo.estadoRevision).toBe('aprobado');
  });

  it('cambiar solo notasFormula (no es contenido evaluado) NO invalida una aprobación', async () => {
    metodo.estadoRevision = 'aprobado'; metodo.aprobado = true;
    const { PATCH } = await import('./route');
    await PATCH(patchReq({ notasFormula: 'nota interna' }), ctx());
    expect(metodo.estadoRevision).toBe('aprobado');
  });

  it('si la MISMA edición re-certifica explícitamente (estadoRevision:"aprobado"), se respeta — no la pisa la auto-invalidación', async () => {
    metodo.estadoRevision = 'aprobado'; metodo.aprobado = true;
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ rangoTrmHasta: 25, estadoRevision: 'aprobado' }), ctx());
    expect(res.status).toBe(200);
    expect(metodo.estadoRevision).toBe('aprobado');
  });

  it('ejemplo del pedido: reglaPuntuacionTexto B→C invalida la equivalencia previamente confirmada (Grupo B)', async () => {
    metodo.formulaReferenciaTexto = 'A';
    metodo.reglaPuntuacionTexto = 'B';
    metodo.equivalenciaMotorEstado = 'EQUIVALENTE_CONFIRMADA';
    metodo.formulaKeyMotor = 'mediana';
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ reglaPuntuacionTexto: 'C' }), ctx());
    expect(res.status).toBe(200);
    expect(metodo.equivalenciaMotorEstado).toBe('NO_EVALUADA');
    expect(metodo.formulaKeyMotor).toBeNull();
  });

  it('cambiar formulaReferenciaTexto también invalida la equivalencia (Grupo B)', async () => {
    metodo.equivalenciaMotorEstado = 'EQUIVALENTE_CONFIRMADA';
    metodo.formulaKeyMotor = 'mediana';
    const { PATCH } = await import('./route');
    await PATCH(patchReq({ formulaReferenciaTexto: 'nuevo texto de fórmula' }), ctx());
    expect(metodo.equivalenciaMotorEstado).toBe('NO_EVALUADA');
    expect(metodo.formulaKeyMotor).toBeNull();
  });

  it('cambiar rangoTrmHasta (Grupo A, no Grupo B) NO invalida una equivalencia ya confirmada', async () => {
    metodo.equivalenciaMotorEstado = 'EQUIVALENTE_CONFIRMADA';
    metodo.formulaKeyMotor = 'mediana';
    const { PATCH } = await import('./route');
    await PATCH(patchReq({ rangoTrmHasta: 25 }), ctx());
    expect(metodo.equivalenciaMotorEstado).toBe('EQUIVALENTE_CONFIRMADA');
    expect(metodo.formulaKeyMotor).toBe('mediana');
  });

  it('si la MISMA edición re-declara equivalenciaMotorEstado, se respeta esa nueva declaración (no la auto-resetea)', async () => {
    metodo.equivalenciaMotorEstado = 'EQUIVALENTE_CONFIRMADA';
    metodo.formulaKeyMotor = 'mediana';
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ reglaPuntuacionTexto: 'C', equivalenciaMotorEstado: 'EQUIVALENTE_CONFIRMADA', formulaKeyMotor: 'mediana' }), ctx());
    expect(res.status).toBe(200);
    expect(metodo.equivalenciaMotorEstado).toBe('EQUIVALENTE_CONFIRMADA');
  });

  it('formulaKeyMotor no-nulo sin equivalenciaMotorEstado explícito en la misma edición: 422 (evita huérfanos)', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ formulaKeyMotor: 'mediana' }), ctx());
    expect(res.status).toBe(422);
    expect(metodo.formulaKeyMotor).toBeNull();
  });

  it('ejemplo exacto del pedido (ronda 3, §2): tras cambiar Grupo B, reconfirmar EQUIVALENTE_CONFIRMADA SIN formulaKeyMotor → 422, no hereda el anterior en silencio', async () => {
    metodo.formulaReferenciaTexto = 'A';
    metodo.reglaPuntuacionTexto = 'B';
    metodo.equivalenciaMotorEstado = 'EQUIVALENTE_CONFIRMADA';
    metodo.formulaKeyMotor = 'mediana'; // = X
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ reglaPuntuacionTexto: 'C', equivalenciaMotorEstado: 'EQUIVALENTE_CONFIRMADA' }), ctx());
    expect(res.status).toBe(422);
    // nada se aplicó: ni el cambio de texto ni una herencia silenciosa de formulaKeyMotor
    expect(metodo.reglaPuntuacionTexto).toBe('B');
    expect(metodo.formulaKeyMotor).toBe('mediana');
  });

  it('ejemplo exacto del pedido (ronda 3, §2): tras cambiar Grupo B, reconfirmar EQUIVALENTE_CONFIRMADA + formulaKeyMotor explícito (mismo X) → permitido', async () => {
    metodo.formulaReferenciaTexto = 'A';
    metodo.reglaPuntuacionTexto = 'B';
    metodo.equivalenciaMotorEstado = 'EQUIVALENTE_CONFIRMADA';
    metodo.formulaKeyMotor = 'mediana'; // = X
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ reglaPuntuacionTexto: 'C', equivalenciaMotorEstado: 'EQUIVALENTE_CONFIRMADA', formulaKeyMotor: 'mediana' }), ctx());
    expect(res.status).toBe(200);
    expect(metodo.reglaPuntuacionTexto).toBe('C');
    expect(metodo.equivalenciaMotorEstado).toBe('EQUIVALENTE_CONFIRMADA');
    expect(metodo.formulaKeyMotor).toBe('mediana');
  });

  it('reconfirmar con un formulaKeyMotor DISTINTO (nueva certificación tras cambio de semántica) → permitido si es válido', async () => {
    metodo.reglaPuntuacionTexto = 'B';
    metodo.equivalenciaMotorEstado = 'EQUIVALENTE_CONFIRMADA';
    metodo.formulaKeyMotor = 'mediana';
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ reglaPuntuacionTexto: 'C', equivalenciaMotorEstado: 'EQUIVALENTE_CONFIRMADA', formulaKeyMotor: 'media_geometrica' }), ctx());
    expect(res.status).toBe(200);
    expect(metodo.formulaKeyMotor).toBe('media_geometrica');
  });

  it('cambio de Grupo B + reconfirmar con equivalenciaMotorEstado != EQUIVALENTE_CONFIRMADA no exige formulaKeyMotor', async () => {
    metodo.reglaPuntuacionTexto = 'B';
    metodo.equivalenciaMotorEstado = 'EQUIVALENTE_CONFIRMADA';
    metodo.formulaKeyMotor = 'mediana';
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ reglaPuntuacionTexto: 'C', equivalenciaMotorEstado: 'DESCONOCIDA' }), ctx());
    expect(res.status).toBe(200);
    expect(metodo.equivalenciaMotorEstado).toBe('DESCONOCIDA');
  });
});

describe('PATCH .../metodos/[id] — atomicidad UPDATE + AuditLog (microauditoría §2)', () => {
  it('si el AuditLog falla, el UPDATE se revierte (mismo bloque $transaction) — no queda un cambio "huérfano" sin rastro', async () => {
    fallarAuditoria = true;
    const valorOriginal = metodo.puntajeMaximo;
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ puntajeMaximo: 99 }), ctx());
    expect(res.status).toBe(500);
    expect(metodo.puntajeMaximo).toBe(valorOriginal); // revertido, no quedó a medias
    expect(auditCalls).toHaveLength(0);
  });

  // Límite documentado: este es un test de ESTRUCTURA del código (el fake
  // `$transaction` simula el rollback por convención, restaurando un
  // snapshot si el callback lanza), no una prueba de las garantías ACID
  // reales de PostgreSQL. Verificar el rollback real requeriría una base de
  // datos de pruebas, no disponible en este entorno. La garantía real
  // depende de que UPDATE y AuditLog vivan dentro del MISMO callback de
  // `prisma.$transaction(...)`, que es exactamente lo que el código de
  // producción hace (ver src/app/api/ponderacion/metodos/[id]/route.ts).
  it('en el camino feliz, UPDATE y AuditLog ocurren dentro del mismo $transaction (un solo auditCall, un solo estado final)', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ puntajeMaximo: 55 }), ctx());
    expect(res.status).toBe(200);
    expect(metodo.puntajeMaximo).toBe(55);
    expect(auditCalls).toHaveLength(1);
  });
});
