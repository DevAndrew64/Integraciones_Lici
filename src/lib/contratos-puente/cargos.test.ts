import { describe, expect, it } from 'vitest';
import { cargosParaPuente, validarCargosPantalla, type CargoPantallaDto } from './cargos';

const cargo = (o: Partial<CargoPantallaDto> = {}): CargoPantallaDto => ({
  id: 1, nombre: 'ASEADOR', cantidad: 4, horasSemana: 48, jornada: 8, salario: 1423500, arlKey: 'I', codigoHorario: '941', valorTotal: 10000000, esTurnante: false, ...o,
});

describe('validarCargosPantalla', () => {
  it('acepta una lista cuyas líneas suman la Mano de Obra del panel', () => {
    const lista = [cargo(), cargo({ id: 2, nombre: 'SUPERVISOR', cantidad: 1, valorTotal: 2140000 })];
    const r = validarCargosPantalla(lista, 12140000);
    expect(r).toEqual({ ok: true, cargos: lista });
  });

  it('cada línea ya viene redondeada al peso: se admite 1 peso de holgura por línea (más 1)', () => {
    const lista = [cargo({ valorTotal: 10000000.4 }), cargo({ id: 2, valorTotal: 2139999.8 })];
    expect(validarCargosPantalla(lista, 12140000).ok).toBe(true);
    expect(validarCargosPantalla(lista, 12140004).ok).toBe(false);
  });

  it('si las líneas no suman el total, algo se extrajo mal: no se envía nada', () => {
    const r = validarCargosPantalla([cargo()], 12140000);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errores[0]).toBe('Los cargos no cuadran con la Mano de Obra del panel: suman 10000000 y el total es 12140000.');
  });

  it('una lista vacía solo es válida si la Mano de Obra es 0', () => {
    expect(validarCargosPantalla([], 0).ok).toBe(true);
    expect(validarCargosPantalla([], 5000000).ok).toBe(false);
  });

  it('rechaza lo que no es una lista, demasiadas líneas y campos de tipo equivocado (todos los errores)', () => {
    expect(validarCargosPantalla('x', 0)).toEqual({ ok: false, errores: ['cargos debe ser una lista.'] });
    expect(validarCargosPantalla(Array.from({ length: 301 }, (_, i) => cargo({ id: i })), 0).ok).toBe(false);
    const malo = { id: 'a', nombre: 5, cantidad: -1, valorTotal: Number.NaN, horasSemana: '48', jornada: undefined, salario: null, arlKey: 1, codigoHorario: null, esTurnante: 'no' };
    const r = validarCargosPantalla([malo, 'x'], 0);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errores).toEqual(expect.arrayContaining([
        'cargos[0].id debe ser un entero.', 'cargos[0].nombre debe ser texto.', 'cargos[0].cantidad debe ser un número ≥ 0.', 'cargos[0].valorTotal debe ser un número ≥ 0.',
        'cargos[0].horasSemana debe ser un número o null.', 'cargos[0].jornada debe ser un número o null.', 'cargos[0].arlKey debe ser texto.',
        'cargos[0].codigoHorario debe ser texto.', 'cargos[0].esTurnante debe ser verdadero o falso.', 'cargos[1] debe ser un objeto.',
      ]));
    }
  });
});

describe('cargosParaPuente', () => {
  it('convierte a la forma del puente: valor por trabajador = total ÷ personas, riesgo en número, textos sin espacios', () => {
    expect(cargosParaPuente([cargo({ nombre: '  ASEADOR ', codigoHorario: ' 941 ' })])).toEqual([
      { nombre: 'ASEADOR', cantidad: 4, horasSemana: 48, jornada: 8, salario: 1423500, riesgo: 1, valorUnitario: 2500000, valorTotal: 10000000, codigoHorario: '941' },
    ]);
  });

  it('unitario × cantidad = total siempre, aunque la división no sea exacta', () => {
    const [c] = cargosParaPuente([cargo({ cantidad: 3, valorTotal: 10000000 })]);
    expect(c.valorUnitario).toBeCloseTo(3333333.3333333335, 6);
    expect(Math.abs((c.valorUnitario ?? 0) * (c.cantidad ?? 0) - 10000000)).toBeLessThan(1e-6);
  });

  it('redondea a la escala de la columna: horas y salario enteros, jornada a 2 decimales', () => {
    const [c] = cargosParaPuente([cargo({ horasSemana: 47.6, jornada: 7.3333, salario: 1423500.4 })]);
    expect([c.horasSemana, c.jornada, c.salario]).toEqual([48, 7.33, 1423500]);
  });

  it('el riesgo ARL va de I a V → 1 a 5; lo desconocido queda null (el puente lo exige: nunca se inventa)', () => {
    const riesgos = ['I', 'II', 'III', 'IV', 'V', ' iii ', 'VI', ''].map((arlKey) => cargosParaPuente([cargo({ arlKey })])[0].riesgo);
    expect(riesgos).toEqual([1, 2, 3, 4, 5, 3, null, null]);
  });

  it('sin jornada diaria (el turnante automático) envía 0 —no una cifra inventada—; sin horas o salario envía null', () => {
    const [t] = cargosParaPuente([cargo({ esTurnante: true, jornada: null, horasSemana: null, salario: null, codigoHorario: '' })]);
    expect([t.jornada, t.horasSemana, t.salario, t.codigoHorario]).toEqual([0, null, null, null]);
  });

  it('las líneas sin trabajadores (costo 0) no se envían', () => {
    expect(cargosParaPuente([cargo({ cantidad: 0, valorTotal: 0 }), cargo({ id: 2 })]).length).toBe(1);
  });

  it('una cantidad fraccionaria se redondea (mínimo 1) y el unitario se calcula con la cantidad enviada', () => {
    const [c] = cargosParaPuente([cargo({ cantidad: 0.4, valorTotal: 1000 })]);
    expect(c.cantidad).toBe(1);
    expect(c.valorUnitario).toBe(1000);
  });
});
