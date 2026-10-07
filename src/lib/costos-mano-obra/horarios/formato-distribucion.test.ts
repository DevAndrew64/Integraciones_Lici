/**
 * Ajuste "CORREGIR EL PANEL DE 66 HORAS" / "CREAR UN MODO EXPLÍCITO DE
 * CAPTURA" — pruebas de las funciones puras de presentación de una
 * distribución horaria (nunca colapsar bloques independientes, nunca
 * reconstruir un descanso centrado en datos históricos).
 */
import { describe, expect, it } from 'vitest';
import {
  describirDiasDistribucion,
  formatearResumenHorarioDistribucion,
  formatearDescansoAplicadoDistribucion,
  resolverModoCapturaHorario,
  inferirDiaDescansoObligatorio,
} from './formato-distribucion';
import type { DistribucionHorarioConfigurada } from './tipos';

function distribucion(over: Partial<DistribucionHorarioConfigurada> = {}): DistribucionHorarioConfigurada {
  return {
    idCliente: 'd1', empresa: '', codigo: '', horario: '', jornada: '', turno: '',
    diasSemana: ['L', 'M', 'X', 'J'], bloques: [], excepcionesFecha: [], sincronizadoExterno: false,
    ...over,
  };
}

describe('Caso 1 — RANGO_CON_DESCANSO (rango continuo con descanso explícito)', () => {
  const d = distribucion({
    modoCapturaHorario: 'RANGO_CON_DESCANSO',
    rangoOriginal: { inicio: '08:00', fin: '18:00' },
    descansoAplicadoMinutos: 90,
    bloques: [{ inicio: '08:00', fin: '12:15', orden: 1 }, { inicio: '13:45', fin: '18:00', orden: 2 }],
  });

  it('5) resolverModoCapturaHorario conserva el rango original y el descanso exactos', () => {
    const m = resolverModoCapturaHorario(d);
    expect(m.modo).toBe('RANGO_CON_DESCANSO');
    expect(m.rangoOriginal).toEqual({ inicio: '08:00', fin: '18:00' });
    expect(m.descansoAplicadoMinutos).toBe(90);
  });

  it('se muestra como "08:00-18:00", nunca como los bloques partidos internos', () => {
    expect(formatearResumenHorarioDistribucion(d)).toBe('Lunes a Jueves · 08:00-18:00');
  });

  it('el descanso se muestra como "1 h 30 min"', () => {
    expect(formatearDescansoAplicadoDistribucion(d)).toBe('1 h 30 min');
  });
});

describe('FASE 5 — Caso 1b) RANGO_CON_DESCANSO cruzando medianoche (20:00-06:00 + 1h descanso)', () => {
  // `bloques` contiene la materialización interna derivada del descanso
  // (20:00-00:30 / 01:30-06:00, usada solo para cálculo) — la
  // presentación debe seguir mostrando el rango ORIGINAL configurado por
  // el usuario, nunca esos bloques derivados.
  const d = distribucion({
    modoCapturaHorario: 'RANGO_CON_DESCANSO',
    rangoOriginal: { inicio: '20:00', fin: '06:00' },
    descansoAplicadoMinutos: 60,
    bloques: [{ inicio: '20:00', fin: '00:30', orden: 1 }, { inicio: '01:30', fin: '06:00', orden: 2 }],
  });

  it('se muestra como "20:00-06:00", NUNCA como "20:00-00:30 / 01:30-06:00"', () => {
    expect(formatearResumenHorarioDistribucion(d)).toBe('Lunes a Jueves · 20:00-06:00');
    expect(formatearResumenHorarioDistribucion(d)).not.toContain('00:30');
    expect(formatearResumenHorarioDistribucion(d)).not.toContain('01:30');
  });

  it('el descanso se muestra como "1 h"', () => {
    expect(formatearDescansoAplicadoDistribucion(d)).toBe('1 h');
  });

  it('resolverModoCapturaHorario conserva el rango original 20:00-06:00 exacto', () => {
    const m = resolverModoCapturaHorario(d);
    expect(m.modo).toBe('RANGO_CON_DESCANSO');
    expect(m.rangoOriginal).toEqual({ inicio: '20:00', fin: '06:00' });
  });
});

describe('Caso 2 — BLOQUES_INDEPENDIENTES (dos turnos genuinamente distintos)', () => {
  const d = distribucion({
    modoCapturaHorario: 'BLOQUES_INDEPENDIENTES',
    bloques: [{ inicio: '08:00', fin: '12:30', orden: 1 }, { inicio: '14:00', fin: '18:00', orden: 2 }],
  });

  it('6) resolverModoCapturaHorario conserva ambos bloques', () => {
    const m = resolverModoCapturaHorario(d);
    expect(m.modo).toBe('BLOQUES_INDEPENDIENTES');
    expect(m.rangoOriginal).toBeNull();
  });

  it('7) los dos bloques se muestran separados por " / "', () => {
    expect(formatearResumenHorarioDistribucion(d)).toBe('Lunes a Jueves · 08:00-12:30 / 14:00-18:00');
  });

  it('8) los dos bloques NUNCA se fusionan en "08:00-18:00"', () => {
    expect(formatearResumenHorarioDistribucion(d)).not.toBe('Lunes a Jueves · 08:00-18:00');
  });

  it('sin descanso aplicado (el hueco entre bloques nunca se etiqueta como descanso)', () => {
    expect(formatearDescansoAplicadoDistribucion(d)).toBeNull();
  });
});

describe('FASE 5 — Caso 2b) BLOQUES_INDEPENDIENTES cruzando medianoche, creados manualmente por el usuario (20:00-23:00 / 01:00-06:00)', () => {
  const d = distribucion({
    modoCapturaHorario: 'BLOQUES_INDEPENDIENTES',
    bloques: [{ inicio: '20:00', fin: '23:00', orden: 1 }, { inicio: '01:00', fin: '06:00', orden: 2, offsetDiaInicio: 1, offsetDiaFin: 1 }],
  });

  it('se muestra "20:00-23:00 / 01:00-06:00" — NUNCA colapsado en "20:00-06:00 + descanso 2h" (el usuario ingresó 2 bloques reales, no un rango con descanso)', () => {
    expect(formatearResumenHorarioDistribucion(d)).toBe('Lunes a Jueves · 20:00-23:00 / 01:00-06:00');
  });

  it('sin descanso aplicado (el hueco 23:00-01:00 nunca se etiqueta como descanso configurado por el usuario)', () => {
    expect(formatearDescansoAplicadoDistribucion(d)).toBeNull();
  });
});

describe('Caso 3 — viernes, bloques independientes (08:00-12:00 / 14:00-18:00)', () => {
  const d = distribucion({
    diasSemana: ['V'],
    modoCapturaHorario: 'BLOQUES_INDEPENDIENTES',
    bloques: [{ inicio: '08:00', fin: '12:00', orden: 1 }, { inicio: '14:00', fin: '18:00', orden: 2 }],
  });

  it('11) 08:00-12:00 / 14:00-18:00 permanece idéntico (bloques exactos)', () => {
    expect(formatearResumenHorarioDistribucion(d)).toBe('Viernes · 08:00-12:00 / 14:00-18:00');
  });
});

describe('§14 — históricos sin modoCapturaHorario (compatibilidad, §F)', () => {
  it('14) un registro con exactamente 2 bloques y sin modoCapturaHorario se muestra como BLOQUES_INDEPENDIENTES — nunca se reconstruye un descanso centrado', () => {
    const d = distribucion({
      bloques: [{ inicio: '08:00', fin: '12:30', orden: 1 }, { inicio: '14:00', fin: '18:00', orden: 2 }],
      // Sin modoCapturaHorario/rangoOriginal — borrador guardado antes de este ajuste.
    });
    const m = resolverModoCapturaHorario(d);
    expect(m.modo).toBe('BLOQUES_INDEPENDIENTES');
    expect(formatearResumenHorarioDistribucion(d)).toBe('Lunes a Jueves · 08:00-12:30 / 14:00-18:00');
    expect(formatearDescansoAplicadoDistribucion(d)).toBeNull();
  });

  it('un registro histórico con rangoOriginal pero SIN modoCapturaHorario también resuelve como BLOQUES_INDEPENDIENTES (el modo debe ser explícito, no inferido de la presencia de otros campos)', () => {
    const d = distribucion({
      rangoOriginal: { inicio: '08:00', fin: '18:00' },
      descansoAplicadoMinutos: 60,
      bloques: [{ inicio: '08:00', fin: '13:00', orden: 1 }, { inicio: '14:00', fin: '18:00', orden: 2 }],
    });
    expect(resolverModoCapturaHorario(d).modo).toBe('BLOQUES_INDEPENDIENTES');
  });
});

describe('9/10 — reglas explícitas de fusión', () => {
  it('9) no fusiona el inicio del primer bloque con el fin del segundo cuando el modo es BLOQUES_INDEPENDIENTES', () => {
    const d = distribucion({
      modoCapturaHorario: 'BLOQUES_INDEPENDIENTES',
      bloques: [{ inicio: '06:00', fin: '12:00', orden: 1 }, { inicio: '13:00', fin: '18:00', orden: 2 }],
    });
    const texto = formatearResumenHorarioDistribucion(d);
    expect(texto).toContain('06:00-12:00');
    expect(texto).toContain('13:00-18:00');
    expect(texto).not.toContain('06:00-18:00');
  });
});

describe('describirDiasDistribucion — nombres de días', () => {
  it('días consecutivos: "Lunes a viernes"', () => {
    expect(describirDiasDistribucion(['L', 'M', 'X', 'J', 'V'])).toBe('Lunes a Viernes');
  });
  it('un solo día: "Sábado"', () => {
    expect(describirDiasDistribucion(['S'])).toBe('Sábado');
  });
  it('días no consecutivos: listados', () => {
    expect(describirDiasDistribucion(['L', 'V'])).toBe('Lunes, Viernes');
  });
});

describe('inferirDiaDescansoObligatorio — ajuste "OCULTAR COMPLETAMENTE EL DÍA DE DESCANSO"', () => {
  it('7) L-V normal: domingo por defecto (AUTOMATICO_POR_DEFECTO)', () => {
    const d = distribucion({ diasSemana: ['L', 'M', 'X', 'J', 'V'] });
    expect(inferirDiaDescansoObligatorio([d])).toEqual({ dia: 'D', origen: 'AUTOMATICO_POR_DEFECTO' });
  });

  it('8) L-S normal: domingo (único día no programado, se infiere igual que cualquier otro caso de un solo hueco)', () => {
    const d = distribucion({ diasSemana: ['L', 'M', 'X', 'J', 'V', 'S'] });
    expect(inferirDiaDescansoObligatorio([d]).dia).toBe('D');
  });

  it('9) martes a domingo programados (falta solo lunes): lunes inferido (INFERIDO_POR_PROGRAMACION)', () => {
    const d = distribucion({ diasSemana: ['M', 'X', 'J', 'V', 'S', 'D'] });
    expect(inferirDiaDescansoObligatorio([d])).toEqual({ dia: 'L', origen: 'INFERIDO_POR_PROGRAMACION' });
  });

  it('10) los 7 días programados: nunca asume — domingo por defecto (la señal correcta es advertenciaProgramacion, no este campo)', () => {
    const d = distribucion({ diasSemana: ['L', 'M', 'X', 'J', 'V', 'S', 'D'] });
    expect(inferirDiaDescansoObligatorio([d])).toEqual({ dia: 'D', origen: 'AUTOMATICO_POR_DEFECTO' });
  });

  it('varias distribuciones se combinan para determinar los días programados', () => {
    const d1 = distribucion({ diasSemana: ['M', 'X', 'J', 'V'] });
    const d2 = distribucion({ diasSemana: ['S', 'D'] });
    expect(inferirDiaDescansoObligatorio([d1, d2])).toEqual({ dia: 'L', origen: 'INFERIDO_POR_PROGRAMACION' });
  });

  it('faltan 2+ días (ej. solo L-J): domingo por defecto, nunca infiere uno de los varios días faltantes', () => {
    const d = distribucion({ diasSemana: ['L', 'M', 'X', 'J'] });
    expect(inferirDiaDescansoObligatorio([d])).toEqual({ dia: 'D', origen: 'AUTOMATICO_POR_DEFECTO' });
  });
});