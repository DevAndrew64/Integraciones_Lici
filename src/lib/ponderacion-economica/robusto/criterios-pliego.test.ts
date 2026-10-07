import { describe, it, expect } from 'vitest';
import { resolverCriteriosPliego, formulaRequierePresupuesto, type MetodoPliegoEntrada } from './criterios-pliego';

const base = (over: Partial<MetodoPliegoEntrada>): MetodoPliegoEntrada => ({
  id: 1,
  nombreMetodo: 'Método',
  tipoFormula: 'media_aritmetica',      // nombre TAL COMO aparece en el pliego — NO define la equivalencia
  rangoTrmDesde: 0,
  rangoTrmHasta: 33,
  puntajeMaximo: 40,
  estadoRevision: 'aprobado',
  aprobado: true,
  formulaTexto: 'PM * (1 - |X - v|/X)',
  textoFuente: 'Cláusula 4.2',
  // §6 — mismo nombre != misma fórmula: la equivalencia se confirma aparte, nunca por el nombre.
  formulaKeyMotor: 'media_aritmetica',
  equivalenciaMotorEstado: 'EQUIVALENTE_CONFIRMADA',
  ...over,
});

describe('resolverCriteriosPliego — feliz', () => {
  it('3 métodos aprobados y EQUIVALENCIA CONFIRMADA cubren 00–99 sin solape → OK con P(c) estructural', () => {
    const r = resolverCriteriosPliego([
      base({ id: 10, rangoTrmDesde: 0, rangoTrmHasta: 33, tipoFormula: 'media_aritmetica', formulaKeyMotor: 'media_aritmetica' }),
      base({ id: 11, rangoTrmDesde: 34, rangoTrmHasta: 66, tipoFormula: 'media_geometrica', formulaKeyMotor: 'media_geometrica' }),
      base({ id: 12, rangoTrmDesde: 67, rangoTrmHasta: 99, tipoFormula: 'media geometrica con presupuesto', formulaKeyMotor: 'media_geometrica_con_presupuesto' }),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.criterios.map(c => c.formulaKey)).toEqual([
        'media_aritmetica',
        'media_geometrica',
        'media_geometrica_con_presupuesto',
      ]);
      expect(r.probabilidadEstructural).toEqual({ M10: 34 / 100, M11: 33 / 100, M12: 33 / 100 });
      const suma = Object.values(r.probabilidadEstructural).reduce((a, b) => a + b, 0);
      expect(suma).toBeCloseTo(1, 12);
      expect(r.criterios[0].formulaTexto).toBe('PM * (1 - |X - v|/X)');
      expect(r.requierePresupuesto).toBe(true); // el criterio M12 usa media_geometrica_con_presupuesto
    }
  });

  it('ninguna fórmula requiere presupuesto → requierePresupuesto = false', () => {
    const r = resolverCriteriosPliego([
      base({ id: 1, rangoTrmDesde: 0, rangoTrmHasta: 49, formulaKeyMotor: 'media_aritmetica' }),
      base({ id: 2, rangoTrmDesde: 50, rangoTrmHasta: 99, formulaKeyMotor: 'menor_valor' }),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.requierePresupuesto).toBe(false);
  });
});

describe('resolverCriteriosPliego — REQUIERE_REVISION', () => {
  it('sin métodos aprobados', () => {
    const r = resolverCriteriosPliego([base({ aprobado: false, estadoRevision: 'pendiente_revision' })]);
    expect(r).toMatchObject({ ok: false, motivo: 'REQUIERE_REVISION' });
    if (!r.ok) expect(r.errores[0]).toMatch(/aprobados/i);
  });

  it('método pendiente_revision aunque aprobado=true (inconsistente) se ignora', () => {
    const r = resolverCriteriosPliego([base({ aprobado: true, estadoRevision: 'revisado' })]);
    expect(r.ok).toBe(false);
  });

  it('hueco de cobertura → REQUIERE_REVISION, sin renormalizar', () => {
    const r = resolverCriteriosPliego([
      base({ id: 1, rangoTrmDesde: 0, rangoTrmHasta: 33 }),
      base({ id: 2, rangoTrmDesde: 40, rangoTrmHasta: 99 }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.some(e => /[Cc]obertura incompleta/.test(e))).toBe(true);
  });

  it('solapamiento → REQUIERE_REVISION', () => {
    const r = resolverCriteriosPliego([
      base({ id: 1, rangoTrmDesde: 0, rangoTrmHasta: 50 }),
      base({ id: 2, rangoTrmDesde: 40, rangoTrmHasta: 99 }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.some(e => /[Ss]olapamiento/.test(e))).toBe(true);
  });

  it('rango fuera de 00–99', () => {
    const r = resolverCriteriosPliego([base({ rangoTrmDesde: -1, rangoTrmHasta: 120 })]);
    expect(r.ok).toBe(false);
  });

  it('rango nulo', () => {
    const r = resolverCriteriosPliego([base({ rangoTrmDesde: null, rangoTrmHasta: null })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.some(e => /ausente/.test(e))).toBe(true);
  });

  it('§6 — MISMO NOMBRE != MISMA FÓRMULA: equivalenciaMotorEstado NO_EVALUADA → REQUIERE_REVISION (sin fuzzy)', () => {
    const r = resolverCriteriosPliego([
      base({ id: 1, rangoTrmDesde: 0, rangoTrmHasta: 66, tipoFormula: 'media aritmetica alta', formulaKeyMotor: null, equivalenciaMotorEstado: 'NO_EVALUADA' }),
      base({ id: 2, rangoTrmDesde: 67, rangoTrmHasta: 99, formulaKeyMotor: 'media_aritmetica', equivalenciaMotorEstado: 'EQUIVALENTE_CONFIRMADA' }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.some(e => /equivalencia con el motor no confirmada/i.test(e))).toBe(true);
  });

  it('§6 — equivalenciaMotorEstado = NO_EQUIVALENTE (mismo nombre, regla de puntuación distinta) → REQUIERE_REVISION', () => {
    const r = resolverCriteriosPliego([
      base({ id: 1, rangoTrmDesde: 0, rangoTrmHasta: 99, tipoFormula: 'media aritmetica alta', formulaKeyMotor: null, equivalenciaMotorEstado: 'NO_EQUIVALENTE' }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.some(e => /equivalencia con el motor no confirmada/i.test(e))).toBe(true);
  });

  it('§6 — DESCONOCIDA (no evaluada aún) tampoco habilita productivo', () => {
    const r = resolverCriteriosPliego([base({ rangoTrmDesde: 0, rangoTrmHasta: 99, equivalenciaMotorEstado: 'DESCONOCIDA', formulaKeyMotor: null })]);
    expect(r.ok).toBe(false);
  });

  it('PM faltante o <= 0', () => {
    const r1 = resolverCriteriosPliego([base({ puntajeMaximo: null, rangoTrmDesde: 0, rangoTrmHasta: 99 })]);
    const r2 = resolverCriteriosPliego([base({ puntajeMaximo: 0, rangoTrmDesde: 0, rangoTrmHasta: 99 })]);
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
  });

  it('reporta TODOS los errores, no solo el primero', () => {
    const r = resolverCriteriosPliego([
      base({ id: 1, rangoTrmDesde: 0, rangoTrmHasta: 20, equivalenciaMotorEstado: 'NO_EVALUADA', formulaKeyMotor: null, puntajeMaximo: null }),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores.length).toBeGreaterThanOrEqual(3); // equivalencia + PM + cobertura
  });
});

describe('formulaRequierePresupuesto', () => {
  it('solo media_geometrica_con_presupuesto la requiere', () => {
    expect(formulaRequierePresupuesto('media_geometrica_con_presupuesto')).toBe(true);
    expect(formulaRequierePresupuesto('media_aritmetica')).toBe(false);
    expect(formulaRequierePresupuesto('menor_valor')).toBe(false);
    expect(formulaRequierePresupuesto(null)).toBe(false);
  });
});
