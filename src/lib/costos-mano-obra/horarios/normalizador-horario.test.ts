import { describe, it, expect } from 'vitest';
import { parsearBloquesHorario } from './parser-horario';
import { calcularHorario, contarDiasSemana, formatearMinutosComoHoras, construirResumenPresentable } from './normalizador-horario';
import type { DiasJornada } from './tipos';

function dias(overrides: Partial<DiasJornada> = {}): DiasJornada {
  return { lun: false, mar: false, mie: false, jue: false, vie: false, sab: false, dom: false, fes: false, ...overrides };
}

const LUNES_A_SABADO = dias({ lun: true, mar: true, mie: true, jue: true, vie: true, sab: true });

describe('calcularHorario — caso de referencia 08:00-12:00 Y 14:00-17:20, lunes a sábado', () => {
  const parseo = parsearBloquesHorario('08:00-12:00 Y 14:00-17:20');
  if (!parseo.ok) throw new Error('fixture inválido');
  const calculo = calcularHorario(parseo.bloques, LUNES_A_SABADO);

  it('440 minutos diarios (240 + 200)', () => {
    expect(calculo.minutosPorBloque).toEqual([240, 200]);
    expect(calculo.minutosDiarios).toBe(440);
  });

  it('lunes a sábado = 6 días, 2640 minutos semanales', () => {
    expect(calculo.cantidadDiasSemana).toBe(6);
    expect(calculo.minutosSemanales).toBe(2640);
  });

  it('horasJornada = 440/60', () => {
    expect(calculo.horasDiariasDecimal).toBeCloseTo(440 / 60, 10);
  });

  it('horasSemana = 2640/60 = 44', () => {
    expect(calculo.horasSemanalesDecimal).toBe(44);
  });

  it('horaInicial y horaFinal', () => {
    expect(calculo.horaInicial).toBe('08:00');
    expect(calculo.horaFinal).toBe('17:20');
  });

  it('descanso entre bloques = 120 minutos (12:00-14:00)', () => {
    expect(calculo.descansoMinutos).toBe(120);
  });
});

describe('sn_jorn_fes no agrega un día ordinario', () => {
  it('festivo marcado no incrementa cantidadDiasSemana', () => {
    const conFestivo = dias({ lun: true, mar: true, mie: true, jue: true, vie: true, sab: true, fes: true });
    const sinFestivo = dias({ lun: true, mar: true, mie: true, jue: true, vie: true, sab: true, fes: false });
    expect(contarDiasSemana(conFestivo)).toBe(contarDiasSemana(sinFestivo));
    expect(contarDiasSemana(conFestivo)).toBe(6);
  });

  it('festivo solo, sin ningún día de lunes a domingo, cuenta 0 días', () => {
    expect(contarDiasSemana(dias({ fes: true }))).toBe(0);
  });
});

describe('formatearMinutosComoHoras', () => {
  it('440 minutos → "7 h 20 min"', () => {
    expect(formatearMinutosComoHoras(440)).toBe('7 h 20 min');
  });
  it('2640 minutos (múltiplo exacto de 60) → "44 h", sin decimales', () => {
    expect(formatearMinutosComoHoras(2640)).toBe('44 h');
  });
  it('nunca produce una cadena con punto decimal', () => {
    expect(formatearMinutosComoHoras(440)).not.toContain('.');
    expect(formatearMinutosComoHoras(2640)).not.toContain('.');
  });
});

describe('construirResumenPresentable', () => {
  it('resumen del caso de referencia, sin JSON ni decimales largos', () => {
    const parseo = parsearBloquesHorario('08:00-12:00 Y 14:00-17:20');
    if (!parseo.ok) throw new Error('fixture inválido');
    const calculo = calcularHorario(parseo.bloques, LUNES_A_SABADO);
    const resumen = construirResumenPresentable(parseo.bloques, calculo, LUNES_A_SABADO);
    expect(resumen).toEqual({
      horarioTexto: '08:00-12:00 / 14:00-17:20',
      horasPorDiaTexto: '7 h 20 min',
      horasPorSemanaTexto: '44 h',
      cantidadBloques: 2,
      descansoTexto: '2 h',
      diasTexto: 'Lunes a sábado',
    });
  });
});

describe('FASE 5 (cierre) — hueco entre bloques sobre la línea de tiempo ABSOLUTA (nunca resta ingenua de HH:mm)', () => {
  it('[A] 20:00-23:00 / 01:00-06:00 (cruce de medianoche, offsets inferidos automáticamente): hueco 2h (23:00→01:00 del día siguiente), 8h efectivas — nunca negativo', () => {
    const parseo = parsearBloquesHorario('20:00-23:00 Y 01:00-06:00');
    if (!parseo.ok) throw new Error('fixture inválido');
    const calculo = calcularHorario(parseo.bloques, LUNES_A_SABADO);
    expect(calculo.descansoMinutos).toBe(120);
    expect(calculo.minutosDiarios).toBe(480);
  });

  it('[B] 08:00-12:00 / 13:00-17:00: hueco 1h, 8h efectivas', () => {
    const parseo = parsearBloquesHorario('08:00-12:00 Y 13:00-17:00');
    if (!parseo.ok) throw new Error('fixture inválido');
    const calculo = calcularHorario(parseo.bloques, LUNES_A_SABADO);
    expect(calculo.descansoMinutos).toBe(60);
    expect(calculo.minutosDiarios).toBe(480);
  });

  it('[C] 08:00-10:00 / 11:00-13:00 / 14:00-17:00: hueco total 2h (1h+1h), 7h efectivas', () => {
    const parseo = parsearBloquesHorario('08:00-10:00 Y 11:00-13:00 Y 14:00-17:00');
    if (!parseo.ok) throw new Error('fixture inválido');
    const calculo = calcularHorario(parseo.bloques, LUNES_A_SABADO);
    expect(calculo.descansoMinutos).toBe(120);
    expect(calculo.minutosDiarios).toBe(420);
  });

  it('[F] 08:00-12:00 / 12:00-16:00 (bloques consecutivos sin hueco): hueco 0, 8h efectivas', () => {
    const parseo = parsearBloquesHorario('08:00-12:00 Y 12:00-16:00');
    if (!parseo.ok) throw new Error('fixture inválido');
    const calculo = calcularHorario(parseo.bloques, LUNES_A_SABADO);
    expect(calculo.descansoMinutos).toBe(0);
    expect(calculo.minutosDiarios).toBe(480);
  });

  it('[D] 20:00-06:00 + descanso 1h (RANGO_CON_DESCANSO, serializado como sub-bloques 20:00-00:30 Y 01:30-06:00): descanso 1h, 9h efectivas — mismo dato que "Descanso no trabajado" en la UI, nunca "Intervalo"', () => {
    const parseo = parsearBloquesHorario('20:00-00:30 Y 01:30-06:00');
    if (!parseo.ok) throw new Error('fixture inválido');
    const calculo = calcularHorario(parseo.bloques, LUNES_A_SABADO);
    expect(calculo.descansoMinutos).toBe(60);
    expect(calculo.minutosDiarios).toBe(540);
  });

  it('[E] 09:00-18:00 + descanso 1h (RANGO_CON_DESCANSO, serializado como 09:00-13:00 Y 14:00-18:00): descanso 1h, 8h efectivas', () => {
    const parseo = parsearBloquesHorario('09:00-13:00 Y 14:00-18:00');
    if (!parseo.ok) throw new Error('fixture inválido');
    const calculo = calcularHorario(parseo.bloques, LUNES_A_SABADO);
    expect(calculo.descansoMinutos).toBe(60);
    expect(calculo.minutosDiarios).toBe(480);
  });
});
