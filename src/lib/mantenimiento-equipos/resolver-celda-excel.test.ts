import { describe, expect, it } from 'vitest';
import { resolverValorCeldaNumericaExcel } from './resolver-celda-excel';

describe('resolverValorCeldaNumericaExcel', () => {
  it('número plano se usa directamente', () => {
    const r = resolverValorCeldaNumericaExcel(40000);
    expect(r).toEqual({ ok: true, valor: 40000 });
  });

  it('string numérico se convierte', () => {
    const r = resolverValorCeldaNumericaExcel('40000');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor).toBe(40000);
  });

  it('fórmula con resultado cacheado se usa (caso real BAQ fila 125: 2800000/12)', () => {
    const r = resolverValorCeldaNumericaExcel({ formula: '2800000/12', result: 233333.33333333334 });
    expect(r).toEqual({ ok: true, valor: 233333.33333333334, formula: '2800000/12' });
  });

  it('fórmula COMPARTIDA (sharedFormula, sin la clave "formula") también se usa — caso real del catálogo maestro de mantenimiento', () => {
    const r = resolverValorCeldaNumericaExcel({ sharedFormula: 'F3', result: 40000 });
    expect(r).toEqual({ ok: true, valor: 40000, formula: 'F3' });
  });

  it('fórmula SIN resultado cacheado se rechaza con el motivo específico, nunca la evalúa', () => {
    const r = resolverValorCeldaNumericaExcel({ formula: '2800000/12' });
    expect(r).toEqual({ ok: false, vacio: false, motivo: 'Fórmula sin resultado cacheado; el importador no evalúa fórmulas arbitrarias.' });
  });

  it('nunca usa eval() — un objeto fórmula no se convierte por coerción numérica', () => {
    // Antes del ajuste, Number({formula,result}) daba NaN y la celda se
    // trataba como vacía — este test fija que ahora SIEMPRE se lee
    // result explícitamente.
    const r = resolverValorCeldaNumericaExcel({ formula: '1/0', result: 1751562.6666666667 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor).toBe(1751562.6666666667);
  });

  it('celda vacía se distingue de un valor inválido', () => {
    expect(resolverValorCeldaNumericaExcel(null)).toEqual({ ok: false, vacio: true });
    expect(resolverValorCeldaNumericaExcel(undefined)).toEqual({ ok: false, vacio: true });
    expect(resolverValorCeldaNumericaExcel('')).toEqual({ ok: false, vacio: true });
  });

  it('texto no numérico se rechaza con motivo', () => {
    const r = resolverValorCeldaNumericaExcel('N/A');
    expect(r.ok).toBe(false);
    if (!r.ok && !r.vacio) expect(r.motivo).toContain('no numérico');
  });
});
