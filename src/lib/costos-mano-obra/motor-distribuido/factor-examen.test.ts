import { describe, expect, it } from 'vitest';
import { resolverFactorExamen, normalizarCodigoExamen, resolverFrecuenciaMesesExamen } from './factor-examen';

describe('resolverFrecuenciaMesesExamen — periodicidad en MESES (Ajuste "DE AÑOS A MESES")', () => {
  it('1) frecuenciaMeses=1 explícito se usa tal cual (nunca se multiplica por 12)', () => {
    expect(resolverFrecuenciaMesesExamen({ frecuenciaMeses: 1 })).toBe(1);
  });

  it('2) frecuenciaMeses=6 explícito se usa tal cual', () => {
    expect(resolverFrecuenciaMesesExamen({ frecuenciaMeses: 6 })).toBe(6);
  });

  it('3) frecuenciaMeses=12 explícito se usa tal cual', () => {
    expect(resolverFrecuenciaMesesExamen({ frecuenciaMeses: 12 })).toBe(12);
  });

  it('7) un registro histórico con solo frecAnios=1 (sin frecuenciaMeses) se interpreta como 12 meses — preserva el costo ya calculado', () => {
    expect(resolverFrecuenciaMesesExamen({ frecAnios: 1 })).toBe(12);
  });

  it('un histórico con frecAnios=2 se interpreta como 24 meses', () => {
    expect(resolverFrecuenciaMesesExamen({ frecAnios: 2 })).toBe(24);
  });

  it('sin frecAnios ni frecuenciaMeses, cae a 12 meses (equivalente al 1 año por defecto de siempre)', () => {
    expect(resolverFrecuenciaMesesExamen({})).toBe(12);
  });

  it('frecuenciaMeses tiene prioridad aunque el registro también traiga un frecAnios histórico', () => {
    expect(resolverFrecuenciaMesesExamen({ frecAnios: 5, frecuenciaMeses: 1 })).toBe(1);
  });
});

describe('resolverFactorExamen — regla comercial EX001', () => {
  it('4) EX001 aplica factor 2', () => {
    expect(resolverFactorExamen('EX001')).toBe(2);
  });

  it('5) "ex001" en minúsculas y con espacios laterales aplica factor 2', () => {
    expect(resolverFactorExamen(' ex001 ')).toBe(2);
    expect(resolverFactorExamen('Ex001')).toBe(2);
  });

  it('6) cualquier otro código aplica factor 1', () => {
    expect(resolverFactorExamen('EX002')).toBe(1);
    expect(resolverFactorExamen('EM001')).toBe(1);
  });

  it('7) un registro histórico sin código verificable aplica factor 1 (nunca infiere por descripción)', () => {
    expect(resolverFactorExamen(undefined)).toBe(1);
    expect(resolverFactorExamen(null)).toBe(1);
    expect(resolverFactorExamen('')).toBe(1);
  });

  it('normalizarCodigoExamen colapsa mayúsculas/espacios', () => {
    expect(normalizarCodigoExamen(' ex001 ')).toBe('EX001');
  });
});
