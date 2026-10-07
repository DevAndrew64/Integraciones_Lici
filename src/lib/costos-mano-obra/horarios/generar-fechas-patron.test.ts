import { describe, it, expect } from 'vitest';
import { generarFechasPatron } from './generar-fechas-patron';

describe('generarFechasPatron', () => {
  it('rango de un día', () => {
    expect(generarFechasPatron('2026-07-21', '2026-07-21', ['L', 'M', 'X', 'J', 'V', 'S', 'D'])).toEqual(['2026-07-21']);
  });

  it('rango inclusivo (incluye fecha inicial y final)', () => {
    const r = generarFechasPatron('2026-07-21', '2026-07-23', ['L', 'M', 'X', 'J', 'V', 'S', 'D']);
    expect(r[0]).toBe('2026-07-21');
    expect(r[r.length - 1]).toBe('2026-07-23');
  });

  it('lunes a jueves — caso obligatorio: 21-25/07/2026, días L,M,X,J → 21,22,23 (sábado 25 excluido)', () => {
    expect(generarFechasPatron('2026-07-21', '2026-07-25', ['L', 'M', 'X', 'J'])).toEqual([
      '2026-07-21', '2026-07-22', '2026-07-23',
    ]);
  });

  it('período que empieza martes: 21-25/07/2026 con L,M,X,J excluye el lunes 20 (fuera de rango) igual que el sábado', () => {
    const r = generarFechasPatron('2026-07-21', '2026-07-25', ['L', 'M', 'X', 'J']);
    expect(r).not.toContain('2026-07-20');
    expect(r).not.toContain('2026-07-25');
  });

  it('período que empieza lunes: 20-25/07/2026 con L,M,X,J → 20,21,22,23', () => {
    expect(generarFechasPatron('2026-07-20', '2026-07-25', ['L', 'M', 'X', 'J'])).toEqual([
      '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23',
    ]);
  });

  it('sábado excluido cuando no está en diasSemana', () => {
    const r = generarFechasPatron('2026-07-21', '2026-07-25', ['V']);
    expect(r).toEqual(['2026-07-24']);
  });

  it('fecha final incluida cuando su día de semana está en el patrón', () => {
    expect(generarFechasPatron('2026-07-21', '2026-07-25', ['S'])).toEqual(['2026-07-25']);
  });

  it('rango inválido: fechaFin anterior a fechaInicio', () => {
    expect(() => generarFechasPatron('2026-07-25', '2026-07-21', ['L'])).toThrow(/RANGO_INVALIDO/);
  });

  it('rango inválido: formato de fecha no reconocible', () => {
    expect(() => generarFechasPatron('25/07/2026', '2026-07-25', ['L'])).toThrow(/RANGO_INVALIDO/);
  });

  it('fecha bisiesta: 2028-02-28 a 2028-03-01 (2028 es bisiesto, incluye 29/02)', () => {
    const r = generarFechasPatron('2028-02-28', '2028-03-01', ['L', 'M', 'X', 'J', 'V', 'S', 'D']);
    expect(r).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });

  it('operación UTC sin desplazamiento: no pierde ni gana un día en el límite del rango', () => {
    const r = generarFechasPatron('2026-07-21', '2026-07-21', ['L', 'M', 'X', 'J', 'V', 'S', 'D']);
    expect(r).toHaveLength(1);
    expect(r[0]).toBe('2026-07-21');
  });

  it('no genera duplicados ni desordena (ascendente por construcción)', () => {
    const r = generarFechasPatron('2026-07-01', '2026-07-31', ['L', 'M', 'X', 'J', 'V', 'S', 'D']);
    expect(new Set(r).size).toBe(r.length);
    expect([...r].sort()).toEqual(r);
  });
});
