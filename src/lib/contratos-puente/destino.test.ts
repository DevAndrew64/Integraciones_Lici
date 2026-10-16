import { describe, expect, it } from 'vitest';
import { conceptoAutomatico, empresaDeSolicitud, origenProcesoContratos, tipoTarifaContratos, uenSugerida, validarEleccion, type DestinoLeido } from './destino';

const destino: DestinoLeido = {
  empresa: { codigo: '01', rsocial: 'ASEO COLBA S.A.S.' },
  uens: [
    { codigo: 'BAQ', conceptos: [{ codigo: '460', descripcion: 'ASEO' }, { codigo: '461', descripcion: 'CAFETERIA' }] },
    { codigo: 'BOG', conceptos: [{ codigo: '470', descripcion: 'ASEO' }] },
    { codigo: 'MNA', conceptos: [] },
  ],
};

describe('destino de la oferta en Contratos', () => {
  it('tipo de tarifa: «C» si el costeo lleva Costos Administrativos, «A» si no', () => {
    expect(tipoTarifaContratos(5000)).toBe('C');
    expect(tipoTarifaContratos(0)).toBe('A');
    expect(tipoTarifaContratos(null)).toBe('A');
    expect(tipoTarifaContratos(Number.NaN)).toBe('A');
  });

  it('origen: SECOP (alias o enlace) es licitación; lo demás, invitación privada', () => {
    expect(origenProcesoContratos({ aliasFuente: 's1' })).toBe('LIC');
    expect(origenProcesoContratos({ aliasFuente: 'S2' })).toBe('LIC');
    expect(origenProcesoContratos({ aliasFuente: null, linkSecop: 'https://community.secop.gov.co/x' })).toBe('LIC');
    expect(origenProcesoContratos({ aliasFuente: 'MANUAL', linkSecop: ' ' })).toBe('INV');
    expect(origenProcesoContratos({})).toBe('INV');
  });

  it('empresa: el perfil en mayúsculas, o null', () => {
    expect(empresaDeSolicitud(' aseocolba ')).toBe('ASEOCOLBA');
    expect(empresaDeSolicitud('')).toBeNull();
  });

  it('UEN sugerida: la preferida (código o ciudad) si existe; si la empresa tiene una sola, esa', () => {
    expect(uenSugerida('bog', destino.uens)).toBe('BOG');
    expect(uenSugerida('Bogotá', destino.uens)).toBe('BOG');
    expect(uenSugerida('Medellín', destino.uens)).toBeNull();
    expect(uenSugerida(null, [destino.uens[1]])).toBe('BOG');
  });

  it('concepto automático solo cuando la UEN tiene uno', () => {
    expect(conceptoAutomatico(destino.uens[1])).toBe('470');
    expect(conceptoAutomatico(destino.uens[0])).toBeNull();
    expect(conceptoAutomatico(undefined)).toBeNull();
  });

  it('valida la UEN y el concepto contra Contratos', () => {
    expect(validarEleccion(destino, 'baq', '461')).toEqual({ ok: true, undnegocio: 'BAQ', codServicio: '461' });
    expect(validarEleccion(destino, 'BOG', null)).toEqual({ ok: true, undnegocio: 'BOG', codServicio: '470' });
    expect(validarEleccion(destino, 'BOG', '999')).toEqual({ ok: true, undnegocio: 'BOG', codServicio: '470' });
    expect(validarEleccion(destino, 'BAQ', null)).toMatchObject({ ok: false, mensaje: expect.stringContaining('Seleccione el concepto') });
    expect(validarEleccion(destino, 'BAQ', '470')).toMatchObject({ ok: false });
    expect(validarEleccion(destino, 'MNA', null)).toMatchObject({ ok: false, mensaje: expect.stringContaining('no tiene conceptos') });
    expect(validarEleccion(destino, 'XYZ', null)).toMatchObject({ ok: false, mensaje: expect.stringContaining('UEN disponibles: BAQ, BOG, MNA') });
    expect(validarEleccion(destino, null, null)).toMatchObject({ ok: false, mensaje: 'Seleccione la UEN de Contratos.' });
  });
});
