import { describe, expect, it } from 'vitest';
import { aplicarEleccionNomina, cargosParaVista, cargosSinNomina, claveCargo, leerEleccionNomina, leerVistaNomina } from './nomina';
import { cargosParaPuente, validarCargosPantalla, type CargoPantallaDto } from './cargos';
import { consultarCargosNomina } from './directo';
import { vi } from 'vitest';

vi.mock('server-only', () => ({}));

const linea = (nombre: string, extra: Partial<CargoPantallaDto> = {}): CargoPantallaDto => ({
  id: 1, nombre, cantidad: 2, horasSemana: 47, jornada: 8, salario: 1500000, arlKey: 'I', codigoHorario: '', valorTotal: 6000000, esTurnante: false, ...extra,
});

describe('cargos de nómina elegidos en «Enviar a Contratos»', () => {
  it('la clave del cargo es la misma del puente: sin tildes, mayúsculas ni puntuación', () => {
    expect(claveCargo('  Jefe   facturación y cartera ')).toBe('JEFE FACTURACION Y CARTERA');
    expect(claveCargo('Turnante — bloque de 42h')).toBe('TURNANTE BLOQUE DE 42H');
  });

  it('la elección se aplica a todas las líneas del mismo cargo y viaja como codigoNomina al puente', () => {
    const eleccion = { baseNomina: 'nominatmb', codigos: { 'JEFE FACTURACION Y CARTERA': 3 } };
    const cargos = aplicarEleccionNomina([linea('Jefe facturación y cartera'), linea('JEFE FACTURACION Y CARTERA', { id: 2 }), linea('Aseador', { id: 3 })], eleccion);
    expect(cargos.map((c) => c.codigoNomina)).toEqual([3, 3, undefined]);
    const v = validarCargosPantalla(cargos, 18000000);
    expect(v.ok).toBe(true);
    const payload = cargosParaPuente(v.ok ? v.cargos : []);
    expect(payload.map((c) => c.codigoNomina)).toEqual([3, 3, undefined]);
    expect('codigoNomina' in payload[2]).toBe(false);
  });

  it('un codigoNomina que no es entero positivo no pasa la validación', () => {
    const v = validarCargosPantalla([{ ...linea('Aseador'), codigoNomina: -4 }], 6000000);
    expect(v.ok).toBe(false);
  });

  it('a revisar van los cargos distintos con trabajadores, con el código elegido', () => {
    const eleccion = { baseNomina: null, codigos: { ASEADOR: 99 } };
    expect(cargosParaVista([linea('Aseador'), linea('ASEADOR'), linea('Supervisor', { cantidad: 0 }), linea('Jefe')], eleccion))
      .toEqual([{ nombre: 'Aseador', codigoNomina: 99 }, { nombre: 'Jefe', codigoNomina: null }]);
  });

  it('una elección guardada mal formada se ignora', () => {
    expect(leerEleccionNomina({ baseNomina: 'nomina; DROP', codigos: { A: 1, B: 'x', C: -1 } })).toEqual({ baseNomina: null, codigos: { A: 1 } });
    expect(leerEleccionNomina(null)).toEqual({ baseNomina: null, codigos: {} });
  });

  it('la vista dice qué cargos faltan; mientras falte alguno no se envía', () => {
    const vista = leerVistaNomina({
      base: 'nominatmb', bases: ['nominatmb', 'nominatmb2'], catalogo: [{ codigo: 3, nombre: 'JEFE DE FACTURACION' }],
      cargos: [{ nombre: 'Jefe facturación y cartera', estado: 'falta', codigo: null, parecidos: [{ codigo: 3, nombre: 'JEFE DE FACTURACION' }] }, { nombre: 'Aseador', estado: 'exacto', codigo: 43, nombreNomina: 'SERVICIOS GENERALES', parecidos: [] }],
    });
    expect(cargosSinNomina(vista)).toEqual(['Jefe facturación y cartera']);
    expect(leerVistaNomina({ ok: false })).toBeNull();
  });
});

describe('consultarCargosNomina', () => {
  it('pasa el pedido al puente y devuelve la vista', async () => {
    const cargosNomina = vi.fn(async () => ({ estado: 200, cuerpo: { ok: true, base: 'nominatmb', bases: ['nominatmb'], cargos: [], catalogo: [] } }));
    const r = await consultarCargosNomina({ empresa: '02', undnegocio: 'BAQ', cargos: [{ nombre: 'Aseador', codigoNomina: null }], baseNomina: null }, {}, { cargosNomina });
    expect(r).toEqual({ ok: true, vista: { base: 'nominatmb', bases: ['nominatmb'], cargos: [], catalogo: [] } });
    expect(cargosNomina).toHaveBeenCalledWith({ empresa: '02', undnegocio: 'BAQ', cargos: [{ nombre: 'Aseador', codigoNomina: null }], baseNomina: null });
  });

  it('si Contratos no tiene la nómina, el mensaje del puente', async () => {
    const cargosNomina = vi.fn(async () => ({ estado: 422, cuerpo: { ok: false, error: 'SIN_NOMINA', mensaje: 'Contratos no tiene una base de nómina…' } }));
    expect(await consultarCargosNomina({ empresa: '01', undnegocio: 'XXX', cargos: [], baseNomina: null }, {}, { cargosNomina })).toEqual({ ok: false, mensaje: 'Contratos no tiene una base de nómina…' });
  });
});
