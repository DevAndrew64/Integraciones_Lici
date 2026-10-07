import { describe, it, expect } from 'vitest';
import { parsearBloquesHorario } from './parser-horario';

describe('parsearBloquesHorario', () => {
  it('un bloque', () => {
    const r = parsearBloquesHorario('08:00-17:00');
    expect(r.ok).toBe(true);
    expect(r.ok && r.bloques).toEqual([{ inicio: '08:00', fin: '17:00', orden: 1 }]);
  });

  it('dos bloques', () => {
    const r = parsearBloquesHorario('08:00-12:00 Y 14:00-17:20');
    expect(r.ok).toBe(true);
    expect(r.ok && r.bloques).toEqual([
      { inicio: '08:00', fin: '12:00', orden: 1 },
      { inicio: '14:00', fin: '17:20', orden: 2 },
    ]);
  });

  it('tres bloques', () => {
    const r = parsearBloquesHorario('05:00-09:00 Y 10:00-14:00 Y 15:00-17:00');
    expect(r.ok).toBe(true);
    expect(r.ok && r.bloques).toHaveLength(3);
    expect(r.ok && r.bloques.map(b => b.orden)).toEqual([1, 2, 3]);
  });

  it('espacios variables alrededor de guiones y del separador', () => {
    const r = parsearBloquesHorario('08:00 - 12:00 y 14:00 - 17:20');
    expect(r.ok).toBe(true);
    expect(r.ok && r.bloques).toEqual([
      { inicio: '08:00', fin: '12:00', orden: 1 },
      { inicio: '14:00', fin: '17:20', orden: 2 },
    ]);
  });

  it('"Y" mayúscula', () => {
    const r = parsearBloquesHorario('08:00-12:00 Y 14:00-17:20');
    expect(r.ok).toBe(true);
  });

  it('"y" minúscula', () => {
    const r = parsearBloquesHorario('08:00-12:00 y 14:00-17:20');
    expect(r.ok).toBe(true);
  });

  it('24:00 es rechazado, no normalizado a 00:00', () => {
    const r = parsearBloquesHorario('08:00-24:00');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errores[0].codigo).toBe('BLOQUE_HORA_FIN_INVALIDA');
  });

  it('inicio igual a fin', () => {
    const r = parsearBloquesHorario('10:00-10:00');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errores[0].codigo).toBe('BLOQUE_INICIO_IGUAL_FIN');
  });

  it('bloques superpuestos', () => {
    const r = parsearBloquesHorario('08:00-12:00 Y 11:00-14:00');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errores[0].codigo).toBe('BLOQUES_SUPERPUESTOS');
  });

  it('[Fase 5, reapertura UX] bloques cuya hora de inicio retrocede se aceptan por inferencia automática de secuencia, con advertencia informativa (nunca un error de "fuera de orden")', () => {
    const r = parsearBloquesHorario('14:00-17:20 Y 08:00-12:00');
    expect(r.ok).toBe(true);
    expect(r.ok && r.bloques).toEqual([
      { inicio: '14:00', fin: '17:20', orden: 1 },
      { inicio: '08:00', fin: '12:00', orden: 2, offsetDiaInicio: 1, offsetDiaFin: 1 },
    ]);
    expect(r.ok && r.advertencias?.length).toBe(1);
  });

  it('bloque de 20 minutos', () => {
    const r = parsearBloquesHorario('14:00-14:20');
    expect(r.ok).toBe(true);
    expect(r.ok && r.bloques).toEqual([{ inicio: '14:00', fin: '14:20', orden: 1 }]);
  });

  it('descanso entre bloques no se interpreta como bloque trabajado', () => {
    const r = parsearBloquesHorario('08:00-12:00 Y 14:00-17:20');
    expect(r.ok).toBe(true);
    // El hueco 12:00-14:00 nunca aparece como bloque — solo hay 2 bloques.
    expect(r.ok && r.bloques.some(b => b.inicio === '12:00' || b.fin === '14:00' && b.inicio === '12:00')).toBe(false);
    expect(r.ok && r.bloques).toHaveLength(2);
  });

  it('cruce de medianoche en un único bloque — ahora anota offsetDiaInicio/offsetDiaFin (modelo de doble offset, Fase 5)', () => {
    const r = parsearBloquesHorario('22:00-06:00');
    expect(r.ok).toBe(true);
    expect(r.ok && r.bloques).toEqual([{ inicio: '22:00', fin: '06:00', orden: 1, offsetDiaInicio: 0, offsetDiaFin: 1 }]);
  });

  it('[ACTUALIZADO — Fase 5] varios bloques donde el PRIMERO ya cruza medianoche: el segundo hereda el día siguiente sin ambigüedad (22:00-06:00 día+0→+1, luego 08:00-10:00 continúa en el día+1 ya establecido)', () => {
    const r = parsearBloquesHorario('22:00-06:00 Y 08:00-10:00');
    expect(r.ok).toBe(true);
    expect(r.ok && r.bloques).toEqual([
      { inicio: '22:00', fin: '06:00', orden: 1, offsetDiaInicio: 0, offsetDiaFin: 1 },
      { inicio: '08:00', fin: '10:00', orden: 2, offsetDiaInicio: 1, offsetDiaFin: 1 },
    ]);
  });

  it('[Fase 5, cierre] dos bloques donde NINGUNO cruza medianoche individualmente (ej. turno nocturno "20:00-23:00 Y 01:00-06:00") se acepta por inferencia automática de secuencia, con el texto FINAL exacto de advertencia (dinámico por bloque/horario, sin comillas técnicas, sin "se interpretará")', () => {
    const r = parsearBloquesHorario('20:00-23:00 Y 01:00-06:00');
    expect(r.ok).toBe(true);
    expect(r.ok && r.bloques).toEqual([
      { inicio: '20:00', fin: '23:00', orden: 1 },
      { inicio: '01:00', fin: '06:00', orden: 2, offsetDiaInicio: 1, offsetDiaFin: 1 },
    ]);
    expect(r.ok && r.advertencias).toEqual([
      'El bloque 2 (01:00–06:00) continuará en el día siguiente. Verifica que esta programación sea correcta antes de guardar.',
    ]);
  });

  it('horario vacío', () => {
    const r = parsearBloquesHorario('');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errores[0].codigo).toBe('HORARIO_VACIO');
  });

  it('segmento irreconocible no se corrige silenciosamente', () => {
    const r = parsearBloquesHorario('mañana y tarde');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errores.length).toBeGreaterThan(0);
  });
});
