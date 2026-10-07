import { describe, expect, it } from 'vitest';
import {
  validarHorasSemanalesTotalSemanal,
  calcularPromedioDiarioInformativo,
  calcularHorasServicioMes,
  calcularSalarioProporcionalServicio,
  interpretarTextoTotalSemanal,
  FACTOR_SEMANAS_MES,
  LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL,
  MENSAJE_LIMITE_HORAS_SEMANALES,
  DIAS_LUNES_A_VIERNES,
  DIAS_LUNES_A_SABADO,
} from './captura-total-semanal';

describe('validarHorasSemanalesTotalSemanal — 0 < horas <= 42 (§3)', () => {
  it('rechaza 0 y negativos', () => {
    expect(validarHorasSemanalesTotalSemanal(0).ok).toBe(false);
    expect(validarHorasSemanalesTotalSemanal(-5).ok).toBe(false);
  });
  it('acepta 19, 21, 25, 30, 41.5 y 42 (prueba 11 — límite superior)', () => {
    for (const h of [19, 21, 25, 30, 41.5, 42]) {
      expect(validarHorasSemanalesTotalSemanal(h)).toEqual({ ok: true });
    }
  });
  it('rechaza más de 42 con el mensaje exacto exigido — obliga a usar horario detallado (prueba 11)', () => {
    const r = validarHorasSemanalesTotalSemanal(42.5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toBe(MENSAJE_LIMITE_HORAS_SEMANALES);
    expect(validarHorasSemanalesTotalSemanal(50).ok).toBe(false);
  });
  it('LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL es 42', () => {
    expect(LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL).toBe(42);
  });
});

describe('calcularPromedioDiarioInformativo — distribución promedio informativa (§4)', () => {
  it('prueba 2 — 19 horas L-V (5 días) → 3 h 48 min diarios', () => {
    const r = calcularPromedioDiarioInformativo(19, 5);
    expect(r.horas).toBe(3);
    expect(r.minutos).toBe(48);
    expect(r.texto).toBe('3 h 48 min diarios');
  });
  it('prueba 3 — 19 horas L-S (6 días) → 3 h 10 min diarios', () => {
    const r = calcularPromedioDiarioInformativo(19, 6);
    expect(r.horas).toBe(3);
    expect(r.minutos).toBe(10);
    expect(r.texto).toBe('3 h 10 min diarios');
  });
  it('prueba 6 — 21 horas L-S (6 días) → 3 h 30 min diarios', () => {
    const r = calcularPromedioDiarioInformativo(21, 6);
    expect(r.horas).toBe(3);
    expect(r.minutos).toBe(30);
    expect(r.texto).toBe('3 h 30 min diarios');
  });
  it('el promedio conserva precisión completa en horasDecimal (nunca redondeada) — el texto es solo para mostrar, no para recalcular', () => {
    const r = calcularPromedioDiarioInformativo(10, 7);
    expect(r.horasDecimal).toBeCloseTo(10 / 7, 10);
    // El campo mostrado (horas/minutos redondeados a minuto entero) pierde
    // precisión frente al decimal exacto — confirma que horasDecimal es la
    // fuente real, nunca el redondeo a minutos.
    expect(r.horas + r.minutos / 60).not.toBe(r.horasDecimal);
  });
  it('sin días seleccionados retorna texto neutro, nunca divide por cero', () => {
    expect(calcularPromedioDiarioInformativo(19, 0).texto).toBe('—');
  });
});

describe('calcularHorasServicioMes — horasServicioMes = horasSemanales × FACTOR_SEMANAS_MES (§6)', () => {
  it('FACTOR_SEMANAS_MES reutilizado es 4,33 (nunca duplicado)', () => {
    expect(FACTOR_SEMANAS_MES).toBe(4.33);
  });
  it('prueba 4 y 17 — 19 × 4,33 = 82,27 horas mensuales', () => {
    expect(calcularHorasServicioMes(19)).toBeCloseTo(82.27, 2);
  });
  it('prueba 7 — 21 × 4,33 = 90,93 horas mensuales', () => {
    expect(calcularHorasServicioMes(21)).toBeCloseTo(90.93, 2);
  });
  it('prueba 16 — nunca usa 24,08', () => {
    // 19 horas × 24,08 (mensualización legada, prohibida) daría 457,52 —
    // muy distinto del resultado real con 4,33.
    expect(calcularHorasServicioMes(19)).not.toBeCloseTo(19 * 24.08, 2);
  });
});

describe('calcularSalarioProporcionalServicio — HALF_UP, precisión completa (§7)', () => {
  it('prueba 5 — 19 horas → $792.076', () => {
    expect(calcularSalarioProporcionalServicio(1750905, 19)).toBe(792076);
  });
  it('prueba 8 — 21 horas → $875.453', () => {
    expect(calcularSalarioProporcionalServicio(1750905, 21)).toBe(875453);
  });
  it('prueba 9 — 41,5 horas → salario proporcional correspondiente', () => {
    const esperado = Math.round((1750905 * 41.5) / 42);
    expect(calcularSalarioProporcionalServicio(1750905, 41.5)).toBe(esperado);
    expect(calcularSalarioProporcionalServicio(1750905, 41.5)).toBe(1730061);
  });
  it('prueba 10 — 42 horas → salario base completo (factor 1)', () => {
    expect(calcularSalarioProporcionalServicio(1750905, 42)).toBe(1750905);
  });
  it('prueba 18 — el salario base original nunca se sobrescribe (la función es pura, no muta el argumento)', () => {
    const base = 1750905;
    calcularSalarioProporcionalServicio(base, 19);
    expect(base).toBe(1750905);
  });
});

describe('interpretarTextoTotalSemanal — interpretación automática (§11)', () => {
  it('"servicio de 19 horas semanales" → 19h, sin días (pendiente de confirmación)', () => {
    const r = interpretarTextoTotalSemanal('servicio de 19 horas semanales');
    expect(r).not.toBeNull();
    expect(r!.horasSemanales).toBe(19);
    expect(r!.dias).toBeNull();
  });
  it('"jornada parcial de 21 horas" — sin la palabra "semanales" no es una expresión reconocida de este tipo', () => {
    // El texto no contiene ninguna marca semanal explícita ("semanal",
    // "a la semana", "por semana") — se exige explícita para no inventar.
    expect(interpretarTextoTotalSemanal('jornada parcial de 21 horas')).toBeNull();
  });
  it('"jornada parcial de 21 horas semanales" → 21h, sin días', () => {
    const r = interpretarTextoTotalSemanal('jornada parcial de 21 horas semanales');
    expect(r).not.toBeNull();
    expect(r!.horasSemanales).toBe(21);
    expect(r!.dias).toBeNull();
  });
  it('"25 h a la semana" → 25h, sin días', () => {
    const r = interpretarTextoTotalSemanal('25 h a la semana');
    expect(r).not.toBeNull();
    expect(r!.horasSemanales).toBe(25);
    expect(r!.dias).toBeNull();
  });
  it('"30 horas semanales de lunes a sábado" → 30h, días L-S', () => {
    const r = interpretarTextoTotalSemanal('30 horas semanales de lunes a sábado');
    expect(r).not.toBeNull();
    expect(r!.horasSemanales).toBe(30);
    expect(r!.dias).toEqual(DIAS_LUNES_A_SABADO);
  });
  it('reconoce "de lunes a viernes"', () => {
    const r = interpretarTextoTotalSemanal('19 horas semanales de lunes a viernes');
    expect(r!.dias).toEqual(DIAS_LUNES_A_VIERNES);
  });
  it('prueba 13 — nunca inventa horas de inicio/fin (el resultado no tiene esos campos)', () => {
    const r = interpretarTextoTotalSemanal('servicio de 19 horas semanales');
    expect(r).not.toHaveProperty('horaInicio');
    expect(r).not.toHaveProperty('horaFin');
    expect(r).not.toHaveProperty('bloques');
  });
  it('texto sin ninguna cantidad de horas retorna null', () => {
    expect(interpretarTextoTotalSemanal('turno de la mañana')).toBeNull();
    expect(interpretarTextoTotalSemanal('')).toBeNull();
  });
});