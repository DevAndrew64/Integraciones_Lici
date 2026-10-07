import { describe, expect, it } from 'vitest';
import { IVA_INSUMOS_PORCENTAJE, calcularValorUnitarioConIva, calcularValorMensualInsumo, normalizarInsumoHistorico } from './calculo-insumos';

describe('calcularValorUnitarioConIva — IVA 19% calculado localmente, nunca dato de la API', () => {
  it('IVA_INSUMOS_PORCENTAJE es 19', () => {
    expect(IVA_INSUMOS_PORCENTAJE).toBe(19);
  });

  it('$100.000 con 19% de IVA da $119.000', () => {
    expect(calcularValorUnitarioConIva(100000, 19)).toBe(119000);
  });

  it('redondea el resultado (moneda sin decimales)', () => {
    expect(calcularValorUnitarioConIva(357, 19)).toBe(Math.round(357 * 1.19));
  });

  it('IVA 0% conserva el valor sin IVA tal cual', () => {
    expect(calcularValorUnitarioConIva(5000, 0)).toBe(5000);
  });
});

describe('calcularValorMensualInsumo — cantidad × valorConIva / frecuenciaMeses (periodicidad, nunca veces/mes)', () => {
  it('cantidad 2, valor con IVA $11.900, frecuencia 1 mes → $23.800', () => {
    expect(calcularValorMensualInsumo({ cantidad: 2, frecuenciaMeses: 1, valorUnitarioConIva: 11900 })).toBe(23800);
  });

  it('cantidad 2, valor con IVA $11.900, frecuencia 3 meses → $7.933,33...', () => {
    expect(calcularValorMensualInsumo({ cantidad: 2, frecuenciaMeses: 3, valorUnitarioConIva: 11900 })).toBeCloseTo(7933.33, 2);
  });

  it('cambiar cantidad recalcula el valor mensual proporcionalmente', () => {
    const base = calcularValorMensualInsumo({ cantidad: 1, frecuenciaMeses: 1, valorUnitarioConIva: 10000 });
    const doble = calcularValorMensualInsumo({ cantidad: 2, frecuenciaMeses: 1, valorUnitarioConIva: 10000 });
    expect(doble).toBe(base * 2);
  });

  it('cambiar frecuencia recalcula el valor mensual (inversamente proporcional)', () => {
    const mensual = calcularValorMensualInsumo({ cantidad: 1, frecuenciaMeses: 1, valorUnitarioConIva: 12000 });
    const trimestral = calcularValorMensualInsumo({ cantidad: 1, frecuenciaMeses: 3, valorUnitarioConIva: 12000 });
    expect(trimestral).toBeCloseTo(mensual / 3, 6);
  });

  it('frecuenciaMeses<=0 se trata como 1 (nunca divide por cero)', () => {
    expect(calcularValorMensualInsumo({ cantidad: 1, frecuenciaMeses: 0, valorUnitarioConIva: 5000 })).toBe(5000);
  });
});

describe('normalizarInsumoHistorico — compatibilidad defensiva (ETAPA 3 §10)', () => {
  it('cantidad y frecuenciaMeses ausentes se completan en 1', () => {
    const r = normalizarInsumoHistorico({ codigo: 'X', nombre: 'Y', valorUnitarioSinIva: 1000 });
    expect(r.cantidad).toBe(1);
    expect(r.frecuenciaMeses).toBe(1);
  });

  it('un registro con valorUnitarioConIva ya calculado NUNCA se vuelve a multiplicar por el IVA', () => {
    const r = normalizarInsumoHistorico({ codigo: 'X', nombre: 'Y', valorUnitarioSinIva: 1000, valorUnitarioConIva: 1500 });
    expect(r.valorUnitarioConIva).toBe(1500);
  });

  it('ivaPorcentaje ausente pero valorUnitarioConIva ya presente → se deja "no informado" (undefined), nunca 19% inventado', () => {
    const r = normalizarInsumoHistorico({ codigo: 'X', nombre: 'Y', valorUnitarioSinIva: 1000, valorUnitarioConIva: 1500 });
    expect(r.ivaPorcentaje).toBeUndefined();
  });

  it('valorUnitarioConIva ausente se calcula UNA vez con IVA_INSUMOS_PORCENTAJE por defecto', () => {
    const r = normalizarInsumoHistorico({ codigo: 'X', nombre: 'Y', valorUnitarioSinIva: 1000 });
    expect(r.valorUnitarioConIva).toBe(calcularValorUnitarioConIva(1000, IVA_INSUMOS_PORCENTAJE));
    expect(r.ivaPorcentaje).toBe(IVA_INSUMOS_PORCENTAJE);
  });

  it('valorMensual ausente se reconstruye con calcularValorMensualInsumo', () => {
    const r = normalizarInsumoHistorico({ codigo: 'X', nombre: 'Y', cantidad: 2, frecuenciaMeses: 1, valorUnitarioConIva: 5000 });
    expect(r.valorMensual).toBe(calcularValorMensualInsumo({ cantidad: 2, frecuenciaMeses: 1, valorUnitarioConIva: 5000 }));
  });

  it('valorMensual ya presente se conserva tal cual (nunca se recalcula)', () => {
    const r = normalizarInsumoHistorico({ codigo: 'X', nombre: 'Y', cantidad: 2, frecuenciaMeses: 1, valorUnitarioConIva: 5000, valorMensual: 999 });
    expect(r.valorMensual).toBe(999);
  });

  it('origen ausente se completa en MANUAL (mismo criterio que CursoRow histórico)', () => {
    const r = normalizarInsumoHistorico({ codigo: 'X', nombre: 'Y', valorUnitarioSinIva: 1000 });
    expect(r.origen).toBe('MANUAL');
  });
});
