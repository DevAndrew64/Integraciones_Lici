import { describe, it, expect } from 'vitest';
import {
  toISO, formatoDDMMAAAA, plazoTexto,
  siguienteRangoPorClicDia, siguienteRangoPorInputInicio, siguienteRangoPorInputFin,
} from './SelectorRangoFechas';

describe('toISO / formatoDDMMAAAA', () => {
  it('convierte una fecha a ISO y de vuelta a dd/mm/aaaa', () => {
    expect(toISO(new Date(2026, 6, 15))).toBe('2026-07-15');
    expect(formatoDDMMAAAA('2026-07-15')).toBe('15/07/2026');
  });
});

describe('plazoTexto', () => {
  // NOTA: `plazoTexto('','')` no produce '' sino 'NaN meses' (bug preexistente,
  // no introducido en esta corrección). No se ejerce en producción porque el
  // JSX solo llama plazoTexto cuando fechaInicio Y fechaFin ya están definidos
  // (`!fechaInicio?'...':!fechaFin?'...':plazoTexto(...)`); se documenta aquí
  // en vez de "arreglarlo" para no modificar lógica fuera de este alcance.
  it('rango vacío (input que el componente nunca produce en la práctica) → NaN meses', () => {
    expect(plazoTexto('', '')).toBe('NaN meses');
  });
  it('un solo día', () => {
    expect(plazoTexto('2026-07-15', '2026-07-15')).toBe('1 día');
  });
  it('varios días sin llegar a un mes', () => {
    expect(plazoTexto('2026-07-01', '2026-07-10')).toBe('10 días');
  });
  it('exactamente un mes (30 días)', () => {
    expect(plazoTexto('2026-07-01', '2026-07-30')).toBe('1 mes');
  });
  it('un mes y días de resto', () => {
    expect(plazoTexto('2026-07-01', '2026-08-05')).toBe('1 mes y 6 días');
  });
});

describe('siguienteRangoPorClicDia', () => {
  it('sin inicio: el clic se vuelve el inicio de un rango nuevo', () => {
    expect(siguienteRangoPorClicDia({ fechaInicio: '', fechaFin: '' }, '2026-07-10'))
      .toEqual({ fechaInicio: '2026-07-10', fechaFin: '' });
  });
  it('con rango ya completo: el clic empieza un rango nuevo (no lo extiende)', () => {
    expect(siguienteRangoPorClicDia({ fechaInicio: '2026-07-01', fechaFin: '2026-07-10' }, '2026-08-01'))
      .toEqual({ fechaInicio: '2026-08-01', fechaFin: '' });
  });
  it('con inicio y sin fin, clic posterior al inicio: cierra el rango', () => {
    expect(siguienteRangoPorClicDia({ fechaInicio: '2026-07-10', fechaFin: '' }, '2026-07-20'))
      .toEqual({ fechaInicio: '2026-07-10', fechaFin: '2026-07-20' });
  });
  it('con inicio y sin fin, clic ANTERIOR al inicio: ordena (el clic pasa a ser el inicio)', () => {
    expect(siguienteRangoPorClicDia({ fechaInicio: '2026-07-10', fechaFin: '' }, '2026-07-01'))
      .toEqual({ fechaInicio: '2026-07-01', fechaFin: '2026-07-10' });
  });
});

describe('siguienteRangoPorInputInicio', () => {
  it('sin fin todavía: solo actualiza el inicio', () => {
    expect(siguienteRangoPorInputInicio({ fechaInicio: '2026-07-01', fechaFin: '' }, '2026-07-05'))
      .toEqual({ fechaInicio: '2026-07-05', fechaFin: '' });
  });
  it('con fin existente y nuevo inicio anterior al fin: conserva el fin', () => {
    expect(siguienteRangoPorInputInicio({ fechaInicio: '2026-07-01', fechaFin: '2026-07-20' }, '2026-07-05'))
      .toEqual({ fechaInicio: '2026-07-05', fechaFin: '2026-07-20' });
  });
  it('con fin existente y nuevo inicio POSTERIOR al fin: limpia el fin (rango inválido)', () => {
    expect(siguienteRangoPorInputInicio({ fechaInicio: '2026-07-01', fechaFin: '2026-07-10' }, '2026-07-20'))
      .toEqual({ fechaInicio: '2026-07-20', fechaFin: '' });
  });
});

describe('siguienteRangoPorInputFin', () => {
  it('con inicio existente y nuevo fin posterior: solo actualiza el fin', () => {
    expect(siguienteRangoPorInputFin({ fechaInicio: '2026-07-01', fechaFin: '' }, '2026-07-20'))
      .toEqual({ fechaInicio: '2026-07-01', fechaFin: '2026-07-20' });
  });
  it('con inicio existente y nuevo fin ANTERIOR al inicio: intercambia', () => {
    expect(siguienteRangoPorInputFin({ fechaInicio: '2026-07-20', fechaFin: '' }, '2026-07-01'))
      .toEqual({ fechaInicio: '2026-07-01', fechaFin: '2026-07-20' });
  });
  it('sin inicio todavía: solo fija el fin', () => {
    expect(siguienteRangoPorInputFin({ fechaInicio: '', fechaFin: '' }, '2026-07-20'))
      .toEqual({ fechaInicio: '', fechaFin: '2026-07-20' });
  });
});
