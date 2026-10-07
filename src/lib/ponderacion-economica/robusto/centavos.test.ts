import { describe, it, expect } from 'vitest';
import { centavos, centavosDeTrm, compararConHeredadas } from './centavos';

describe('centavosDeTrm — casos límite pedidos', () => {
  it.each([
    ['4000.00', 0],
    ['4000.01', 1],
    ['4000.09', 9],
    ['4000.10', 10],
    ['4000.99', 99],
  ])('%s → %i', (v, esperado) => {
    expect(centavos(v)).toBe(esperado);
  });

  it('acepta number además de string', () => {
    expect(centavos(4000.1)).toBe(10);
    expect(centavos(4000.99)).toBe(99);
  });
});

describe('centavosDeTrm — representación Decimal(12,4) de Prisma', () => {
  it('4 decimales, redondeo half-up del centavo', () => {
    expect(centavos('3443.5949')).toBe(59);
    expect(centavos('3443.5950')).toBe(60); // half-up
    expect(centavos('3443.5951')).toBe(60);
  });

  it('acarreo: .995+ redondea a la unidad → centavos 00', () => {
    const r = centavosDeTrm('4000.9960');
    expect(r.centavos).toBe(0);
    expect(r.acarreo).toBe(true);
  });

  it('.9949 NO acarrea', () => {
    expect(centavosDeTrm('4000.9949').centavos).toBe(99);
    expect(centavosDeTrm('4000.9949').acarreo).toBe(false);
  });

  it('modo truncado toma los dos primeros decimales sin redondear', () => {
    expect(centavos('3443.5999', 'truncado')).toBe(59);
    expect(centavos('4000.9960', 'truncado')).toBe(99);
    expect(centavos('4000.108', 'truncado')).toBe(10);
  });

  it('nunca devuelve 100 ni negativos', () => {
    for (const frac of ['00', '99', '995', '9999', '005', '50', '499', '500']) {
      const c = centavos(`4000.${frac}`);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(99);
    }
  });

  it('rechaza formatos inválidos', () => {
    expect(() => centavos('abc')).toThrow();
    expect(() => centavos('3443,59')).toThrow();
    expect(() => centavos(Number.NaN)).toThrow();
  });
});

describe('discrepancia documentada vs implementaciones heredadas', () => {
  it('trmSelector legacy PUEDE devolver 100 donde el canónico devuelve 00', () => {
    const d = compararConHeredadas(4000.996);
    expect(d.canonico).toBe(0);
    expect(d.legacy_trmSelector).toBe(100); // Math.round((0.996)*100) — fuera de rango
    expect(d.coincideTodo).toBe(false);
  });

  it('en el rango normal (2 decimales exactos) las 3 coinciden', () => {
    for (const v of [3443.59, 4000.0, 5210.1, 4875.42, 3999.99]) {
      const d = compararConHeredadas(v);
      expect(d.coincideTodo).toBe(true);
    }
  });
});
