import { describe, it, expect } from 'vitest';
import { materializarFechasProgramadas } from './materializar-fechas-programadas';

describe('materializarFechasProgramadas', () => {
  it('excluir una fecha del patrón', () => {
    const r = materializarFechasProgramadas('2026-07-21', '2026-07-25', ['L', 'M', 'X', 'J'], [
      { fecha: '2026-07-22', accion: 'EXCLUIR' },
    ]);
    expect(r.fechasBase).toEqual(['2026-07-21', '2026-07-22', '2026-07-23']);
    expect(r.fechasProgramadas).toEqual(['2026-07-21', '2026-07-23']);
  });

  it('incluir un sábado excepcional (caso del enunciado — sábado 25 no se agrega permanentemente a diasSemana, solo a este resultado)', () => {
    const r = materializarFechasProgramadas('2026-07-21', '2026-07-25', ['L', 'M', 'X', 'J'], [
      { fecha: '2026-07-25', accion: 'INCLUIR' },
    ]);
    expect(r.fechasProgramadas).toEqual(['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-25']);
    expect(r.advertencias).toEqual([]);
  });

  it('retirar la excepción (lista de excepciones vacía) regresa al comportamiento normal del patrón', () => {
    const conExcepcion = materializarFechasProgramadas('2026-07-21', '2026-07-25', ['L', 'M', 'X', 'J'], [
      { fecha: '2026-07-25', accion: 'INCLUIR' },
    ]);
    expect(conExcepcion.fechasProgramadas).toContain('2026-07-25');
    const sinExcepcion = materializarFechasProgramadas('2026-07-21', '2026-07-25', ['L', 'M', 'X', 'J'], []);
    expect(sinExcepcion.fechasProgramadas).not.toContain('2026-07-25');
    expect(sinExcepcion.fechasProgramadas).toEqual(sinExcepcion.fechasBase);
  });

  it('excepción fuera del rango se ignora con advertencia, no se aplica', () => {
    const r = materializarFechasProgramadas('2026-07-21', '2026-07-25', ['L', 'M', 'X', 'J'], [
      { fecha: '2026-08-01', accion: 'INCLUIR' },
    ]);
    expect(r.fechasProgramadas).not.toContain('2026-08-01');
    expect(r.advertencias.length).toBe(1);
    expect(r.advertencias[0]).toContain('fuera del período');
  });

  it('acciones contradictorias para la misma fecha se ignoran, prevalece el patrón', () => {
    const r = materializarFechasProgramadas('2026-07-21', '2026-07-25', ['L', 'M', 'X', 'J'], [
      { fecha: '2026-07-25', accion: 'INCLUIR' },
      { fecha: '2026-07-25', accion: 'EXCLUIR' },
    ]);
    expect(r.fechasProgramadas).not.toContain('2026-07-25'); // el patrón no lo incluía, y la contradicción no lo agrega
    expect(r.advertencias[0]).toContain('contradictorias');
  });

  it('no duplica fechas cuando una excepción INCLUIR coincide con una fecha ya presente en el patrón', () => {
    const r = materializarFechasProgramadas('2026-07-21', '2026-07-25', ['L', 'M', 'X', 'J'], [
      { fecha: '2026-07-21', accion: 'INCLUIR' },
    ]);
    expect(r.fechasProgramadas.filter(f => f === '2026-07-21')).toHaveLength(1);
  });

  it('caso obligatorio completo: Distribución 1 (L-J) sin excepciones', () => {
    const r = materializarFechasProgramadas('2026-07-21', '2026-07-25', ['L', 'M', 'X', 'J'], []);
    expect(r.fechasProgramadas).toEqual(['2026-07-21', '2026-07-22', '2026-07-23']);
  });

  it('caso obligatorio completo: Distribución 2 (V) sin excepciones', () => {
    const r = materializarFechasProgramadas('2026-07-21', '2026-07-25', ['V'], []);
    expect(r.fechasProgramadas).toEqual(['2026-07-24']);
  });
});
