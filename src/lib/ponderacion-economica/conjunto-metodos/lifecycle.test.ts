import { describe, it, expect } from 'vitest';
import {
  validarInvarianteConjunto, planearCrearConjuntoCandidato, planearAprobarConjunto,
  planearRechazarConjunto, validarPreAprobacionConjunto, type EstadoConjunto, type PreAprobacionConjunto,
} from './lifecycle';

const C = (over: any): any => ({ id: 1, procesoId: 10, version: 1, estadoVersion: 'CANDIDATA', ...over });
const estado = (over: Partial<EstadoConjunto>): EstadoConjunto => ({ versionMaxima: 0, ...over });

const preOk: PreAprobacionConjunto = {
  totalMetodos: 3, metodosPendientes: 0, metodosRechazados: 0, gateCriteriosOk: true,
  requierePresupuestoPorFormula: false, todosMetodosTienenPM: false,
  presupuestoOficialAprobado: 500_000_000, puntajeMaximoEconomicoAprobado: 40,
};

describe('validarInvarianteConjunto', () => {
  it('rechaza 2 ACTIVA / 2 CANDIDATA', () => {
    expect(() => validarInvarianteConjunto([{ estadoVersion: 'ACTIVA' }, { estadoVersion: 'ACTIVA' }])).toThrow();
    expect(() => validarInvarianteConjunto([{ estadoVersion: 'CANDIDATA' }, { estadoVersion: 'CANDIDATA' }])).toThrow();
    expect(() => validarInvarianteConjunto([{ estadoVersion: 'ACTIVA' }, { estadoVersion: 'CANDIDATA' }, { estadoVersion: 'SUPERSEDED' }])).not.toThrow();
  });
});

describe('planearCrearConjuntoCandidato (T1) — no mezcla generaciones', () => {
  it('con ACTIVO existente: NO lo toca; nueva version = max+1', () => {
    const plan = planearCrearConjuntoCandidato(estado({ activa: C({ id: 5, version: 2, estadoVersion: 'ACTIVA' }), versionMaxima: 2 }));
    expect(plan.nuevaVersion).toBe(3);
    expect(plan.autoRechazar).toBeUndefined();
  });
  it('con CANDIDATO previo: auto-rechazo SISTEMA sin actor', () => {
    const plan = planearCrearConjuntoCandidato(estado({ candidata: C({ id: 7, version: 3 }), versionMaxima: 3 }));
    expect(plan.autoRechazar).toMatchObject({ id: 7, origenTransicion: 'SISTEMA', rechazadoPorId: null });
    expect(plan.autoRechazar!.motivoRechazo).toMatch(/SISTEMA/);
  });
});

describe('validarPreAprobacionConjunto', () => {
  it('OK cuando todo está listo', () => {
    expect(validarPreAprobacionConjunto(preOk)).toEqual({ ok: true });
  });
  it('bloquea si hay métodos sin revisar', () => {
    const r = validarPreAprobacionConjunto({ ...preOk, metodosPendientes: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.join(' ')).toMatch(/sin revisar/);
  });
  it('bloquea si hay métodos rechazados en el conjunto', () => {
    expect(validarPreAprobacionConjunto({ ...preOk, metodosRechazados: 1 }).ok).toBe(false);
  });
  it('bloquea si el gate de criterios falla (huecos/solapes/fórmula/PM)', () => {
    expect(validarPreAprobacionConjunto({ ...preOk, gateCriteriosOk: false }).ok).toBe(false);
  });
  it('§3 — presupuesto NO es requisito universal: si ninguna fórmula lo requiere, se puede aprobar sin él', () => {
    expect(validarPreAprobacionConjunto({ ...preOk, presupuestoOficialAprobado: null }).ok).toBe(true);
  });
  it('§3 — si ALGUNA fórmula requiere presupuesto (p.ej. geométrica c/presupuesto), sí se exige', () => {
    const r = validarPreAprobacionConjunto({ ...preOk, requierePresupuestoPorFormula: true, presupuestoOficialAprobado: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.join(' ')).toMatch(/presupuesto oficial/i);
  });
  it('§3 — PM a nivel de conjunto NO se exige si cada método ya trae su propio PM', () => {
    expect(validarPreAprobacionConjunto({ ...preOk, todosMetodosTienenPM: true, puntajeMaximoEconomicoAprobado: null }).ok).toBe(true);
  });
  it('§3 — PM a nivel de conjunto SÍ se exige si algún método no trae PM propio', () => {
    const r = validarPreAprobacionConjunto({ ...preOk, todosMetodosTienenPM: false, puntajeMaximoEconomicoAprobado: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.join(' ')).toMatch(/puntaje máximo/i);
  });
  it('reporta TODOS los errores a la vez', () => {
    const r = validarPreAprobacionConjunto({
      totalMetodos: 0, metodosPendientes: 0, metodosRechazados: 0, gateCriteriosOk: false,
      requierePresupuestoPorFormula: true, todosMetodosTienenPM: false,
      presupuestoOficialAprobado: null, puntajeMaximoEconomicoAprobado: null,
    });
    if (!r.ok) expect(r.errores.length).toBeGreaterThanOrEqual(4);
  });
});

describe('planearAprobarConjunto (T3)', () => {
  it('lanza con la lista de errores si el conjunto no es aprobable', () => {
    expect(() => planearAprobarConjunto(estado({ candidata: C({ id: 9 }), versionMaxima: 1 }), { ...preOk, metodosPendientes: 1 }))
      .toThrow(/no aprobable/i);
  });
  it('con ACTIVO previo: supersede la anterior', () => {
    const plan = planearAprobarConjunto(estado({ candidata: C({ id: 9, version: 2 }), activa: C({ id: 4, version: 1, estadoVersion: 'ACTIVA' }), versionMaxima: 2 }), preOk);
    expect(plan).toEqual({ candidataId: 9, supersederActivaId: 4 });
  });
});

describe('planearRechazarConjunto (T2)', () => {
  it('marca hayActivaPrevia y no toca el ACTIVO', () => {
    const plan = planearRechazarConjunto(estado({ candidata: C({ id: 9 }), activa: C({ id: 4, estadoVersion: 'ACTIVA' }), versionMaxima: 2 }));
    expect(plan).toMatchObject({ candidataId: 9, origenTransicion: 'HUMANO', hayActivaPrevia: true });
  });
});
