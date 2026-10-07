import { describe, expect, it } from 'vitest';
import { calcularLimitePagosNoSalarialesIBC } from './limite-no-salarial-ibc';

describe('§9.1 — base $2.000.000, bonos $1.000.000: sin exceso', () => {
  it('remuneración total $3.000.000, límite $1.200.000, exceso $0, IBC $2.000.000', () => {
    const r = calcularLimitePagosNoSalarialesIBC({ baseSalarial: 2000000, pagosNoSalariales: 1000000 });
    expect(r.remuneracionTotal).toBe(3000000);
    expect(r.limiteNoSalarialExcluible).toBe(1200000);
    expect(r.excesoNoSalarialIBC).toBe(0);
    expect(r.ibcAjustado).toBe(2000000);
  });
});

describe('§9.2 — base $2.000.000, bonos $1.500.000: con exceso', () => {
  it('remuneración total $3.500.000, límite $1.400.000, exceso $100.000, IBC $2.100.000', () => {
    const r = calcularLimitePagosNoSalarialesIBC({ baseSalarial: 2000000, pagosNoSalariales: 1500000 });
    expect(r.remuneracionTotal).toBe(3500000);
    expect(r.limiteNoSalarialExcluible).toBe(1400000);
    expect(r.excesoNoSalarialIBC).toBe(100000);
    expect(r.ibcAjustado).toBe(2100000);
  });
});

describe('§9.3 — bonos en cero: cero ajuste', () => {
  it('IBC ajustado = base salarial exacta', () => {
    const r = calcularLimitePagosNoSalarialesIBC({ baseSalarial: 1750905, pagosNoSalariales: 0 });
    expect(r.excesoNoSalarialIBC).toBe(0);
    expect(r.ibcAjustado).toBe(1750905);
  });
});

describe('§9.4 — exactamente en el límite: cero exceso', () => {
  it('pagosNoSalariales === limiteNoSalarialExcluible → exceso 0', () => {
    // base=3.000.000 → remuneración con bonos=X: 3.000.000+X, límite=0.4×(3.000.000+X).
    // Buscamos X = 0.4×(3.000.000+X) → X = 1.200.000 + 0.4X → 0.6X=1.200.000 → X=2.000.000
    const r = calcularLimitePagosNoSalarialesIBC({ baseSalarial: 3000000, pagosNoSalariales: 2000000 });
    expect(r.limiteNoSalarialExcluible).toBe(2000000); // límite coincide exactamente con los pagos no salariales
    expect(r.excesoNoSalarialIBC).toBe(0);
    expect(r.ibcAjustado).toBe(3000000);
  });
});

describe('propiedades generales', () => {
  it('nunca produce exceso negativo', () => {
    const r = calcularLimitePagosNoSalarialesIBC({ baseSalarial: 5000000, pagosNoSalariales: 10000 });
    expect(r.excesoNoSalarialIBC).toBeGreaterThanOrEqual(0);
  });
  it('ibcAjustado nunca es menor que baseSalarial', () => {
    const r = calcularLimitePagosNoSalarialesIBC({ baseSalarial: 2000000, pagosNoSalariales: 5000000 });
    expect(r.ibcAjustado).toBeGreaterThanOrEqual(2000000);
  });
});