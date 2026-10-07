/**
 * FASE A.1 — microauditoría §3/§4: bucle completo SI → NO → SI usando la
 * `sincronizarEstadoRevisionPliego` REAL (sin mockear), para demostrar
 * extremo a extremo que:
 *  - SI + config ACTIVA válida → PLIEGO_VERIFICADO;
 *  - NO (con la MISMA config histórica) → estadoRevisionPliego deja de decir
 *    PLIEGO_VERIFICADO, aunque la regla/el conjunto sigan existiendo tal cual;
 *  - NO_DETERMINADO con candidatas pendientes → PENDIENTE_REVISION, nunca
 *    PLIEGO_VERIFICADO;
 *  - NO → SI de nuevo → vuelve a PLIEGO_VERIFICADO (reversible);
 *  - las filas de ReglaTrmProceso/ConjuntoMetodosPonderacionProceso/
 *    MetodoPonderacionProceso NUNCA se tocan en ninguno de estos pasos (§4).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const SESION = { id: 7, usuario: 'ana.revisora', email: 'ana.revisora@grupocolba.com', rol: 'Administrador', estado: 'Activo' };

let proceso: Record<string, unknown>;
let reglas: Record<string, unknown>[];
let conjuntos: Record<string, unknown>[];
let metodos: Record<string, unknown>[];
let analisisCount: number;
const updatesProceso: unknown[] = [];

function resetFixture() {
  proceso = { id: 30, usaPonderacionTrm: 'SI', estadoRevisionPliego: 'PLIEGO_VERIFICADO' };
  reglas = [{ id: 1, procesoId: 30, estadoVersion: 'ACTIVA', reglaCentavos: 'REDONDEO' }];
  conjuntos = [{ id: 2, procesoId: 30, estadoVersion: 'ACTIVA', presupuestoOficialAprobado: 500_000_000, puntajeMaximoEconomicoAprobado: 40 }];
  metodos = [{
    id: 900, conjuntoMetodosId: 2, nombreMetodo: 'Media aritmética', tipoFormula: 'media_aritmetica',
    rangoTrmDesde: 0, rangoTrmHasta: 99, puntajeMaximo: 40, estadoRevision: 'aprobado', aprobado: true,
    formulaTexto: null, textoFuente: null, formulaKeyMotor: 'mediana', equivalenciaMotorEstado: 'EQUIVALENTE_CONFIRMADA',
  }];
  analisisCount = 1;
  updatesProceso.length = 0;
}

const fakeImpl = {
  proceso: {
    async findUnique({ where }: { where: { id: number } }) {
      return where.id === proceso.id ? { ...proceso } : null;
    },
    async update({ where, data }: { where: { id: number }; data: Record<string, unknown> }) {
      if (where.id !== proceso.id) throw new Error('no encontrado');
      proceso = { ...proceso, ...data };
      updatesProceso.push({ ...data });
      return { ...proceso };
    },
  },
  reglaTrmProceso: {
    async findMany({ where }: { where: { procesoId: number; estadoVersion: { in: string[] } } }) {
      return reglas.filter(r => r.procesoId === where.procesoId && where.estadoVersion.in.includes(r.estadoVersion as string));
    },
  },
  conjuntoMetodosPonderacionProceso: {
    async findMany({ where }: { where: { procesoId: number; estadoVersion: { in: string[] } } }) {
      return conjuntos.filter(c => c.procesoId === where.procesoId && where.estadoVersion.in.includes(c.estadoVersion as string));
    },
  },
  metodoPonderacionProceso: {
    async findMany({ where }: { where: { conjuntoMetodosId: number } }) {
      return metodos.filter(m => m.conjuntoMetodosId === where.conjuntoMetodosId);
    },
  },
  analisisEconomicoProceso: { async count() { return analisisCount; } },
  async $transaction(fn: (tx: unknown) => Promise<unknown>) { return fn(fakeImpl); },
};

vi.mock('@/lib/prisma', () => ({ default: fakeImpl }));
vi.mock('@/lib/session', () => ({ getSession: async () => SESION }));
vi.mock('@/lib/audit', () => ({ auditLog: async () => {} }));
// Deliberadamente SIN mockear sincronizar-estado-pliego/estado-pliego/gate-conjunto: se usa la lógica real.

function req(body: unknown) {
  return new NextRequest('http://localhost/api/procesos/30/analisis-economico', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function ctx() { return { params: Promise.resolve({ id: '30' }) }; }

beforeEach(() => { vi.resetModules(); resetFixture(); });

describe('Bucle real SI → NO → SI (usaPonderacionTrm × estadoRevisionPliego, sin mocks)', () => {
  it('SI inicial + regla/conjunto ACTIVA válidos → estadoRevisionPliego = PLIEGO_VERIFICADO', async () => {
    // confirmarUsoTrm(SI) redundante (ya estaba en SI) solo para forzar el recálculo real
    const { PATCH } = await import('./route');
    const res = await PATCH(req({ accion: 'confirmarUsoTrm', valor: 'SI' }), ctx());
    expect(res.status).toBe(200);
    expect(proceso.estadoRevisionPliego).toBe('PLIEGO_VERIFICADO');
  });

  it('SI → NO: estadoRevisionPliego deja de ser PLIEGO_VERIFICADO, pero regla/conjunto/métodos NO se tocan (siguen existiendo tal cual)', async () => {
    const reglasAntes = JSON.stringify(reglas);
    const conjuntosAntes = JSON.stringify(conjuntos);
    const metodosAntes = JSON.stringify(metodos);

    const { PATCH } = await import('./route');
    const res = await PATCH(req({ accion: 'confirmarUsoTrm', valor: 'NO' }), ctx());
    expect(res.status).toBe(200);

    expect(proceso.usaPonderacionTrm).toBe('NO');
    expect(proceso.estadoRevisionPliego).not.toBe('PLIEGO_VERIFICADO');
    expect(proceso.estadoRevisionPliego).toBe('NO_APLICA_TRM'); // no "requiere revisión": simplemente no pertenece al workflow TRM

    // §4 — nada de esto se borró ni mutó: sigue siendo evidencia histórica intacta.
    expect(JSON.stringify(reglas)).toBe(reglasAntes);
    expect(JSON.stringify(conjuntos)).toBe(conjuntosAntes);
    expect(JSON.stringify(metodos)).toBe(metodosAntes);
    expect(reglas[0].estadoVersion).toBe('ACTIVA'); // sigue ACTIVA en la BD — solo el estado global deja de reportarla como "verificada"
  });

  it('NO_DETERMINADO con una CANDIDATA pendiente de revisión → PENDIENTE_REVISION, nunca PLIEGO_VERIFICADO', async () => {
    // NO_DETERMINADO es el estado "nunca decidido" — no existe (ni debe
    // existir) una acción de la ruta para "confirmar NO_DETERMINADO" (solo
    // SI/NO son confirmaciones humanas válidas). Se prueba la sincronización
    // real invocándola directamente, como la llamaría cualquier otro
    // disparador (p.ej. crearCandidataRegla tras un nuevo análisis).
    reglas.push({ id: 5, procesoId: 30, estadoVersion: 'CANDIDATA', reglaCentavos: 'NO_DEFINIDA' });
    proceso.usaPonderacionTrm = 'NO_DETERMINADO';

    const { sincronizarEstadoRevisionPliego } = await import('@/lib/ponderacion-economica/sincronizar-estado-pliego');
    const estado = await sincronizarEstadoRevisionPliego(30);
    expect(estado).toBe('PENDIENTE_REVISION');
    expect(proceso.estadoRevisionPliego).toBe('PENDIENTE_REVISION');
    expect(proceso.estadoRevisionPliego).not.toBe('PLIEGO_VERIFICADO');
  });

  it('NO → SI de nuevo: se recalcula correctamente y vuelve a PLIEGO_VERIFICADO (reversible, sin estado atascado)', async () => {
    const { PATCH } = await import('./route');
    await PATCH(req({ accion: 'confirmarUsoTrm', valor: 'NO' }), ctx());
    expect(proceso.estadoRevisionPliego).toBe('NO_APLICA_TRM');

    const res2 = await PATCH(req({ accion: 'confirmarUsoTrm', valor: 'SI' }), ctx());
    expect(res2.status).toBe(200);
    expect(proceso.usaPonderacionTrm).toBe('SI');
    expect(proceso.estadoRevisionPliego).toBe('PLIEGO_VERIFICADO');
  });

  it('ciclo real: NO_DETERMINADO (tras un análisis negativo de Gemini, sin candidatas) → confirmar NO → NO_APLICA_TRM', async () => {
    // Simula el resultado de /analizar cuando Gemini detecta que la TRM NO
    // gobierna la evaluación (ej.: TRM solo para conversión de moneda): hubo
    // un AnalisisEconomicoProceso, pero NUNCA se crearon regla/conjunto
    // candidatos (ver route.ts: analizar/route.ts no llama a
    // crearCandidataRegla/crearConjuntoCandidato cuando trmGobierna !== true).
    proceso.usaPonderacionTrm = 'NO_DETERMINADO';
    reglas = [];
    conjuntos = [];
    metodos = [];
    analisisCount = 1; // el análisis SÍ se guardó, aunque no generó candidatas

    const { PATCH } = await import('./route');
    const res = await PATCH(req({ accion: 'confirmarUsoTrm', valor: 'NO' }), ctx());
    expect(res.status).toBe(200);
    expect(proceso.usaPonderacionTrm).toBe('NO');
    expect(proceso.estadoRevisionPliego).toBe('NO_APLICA_TRM');
  });
});
