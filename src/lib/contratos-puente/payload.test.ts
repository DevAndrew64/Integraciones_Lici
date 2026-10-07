import { describe, expect, it } from 'vitest';
import { armarPayloadContratos, describirError, normalizarNit, type SolicitudParaPuente } from './payload';

const solicitud = (o: Partial<SolicitudParaPuente> = {}): SolicitudParaPuente => ({
  id: 7, codigoProceso: 'SED-LP-2026-0091', entidad: ' Cliente SAS ', objeto: 'Aseo integral', nitContacto: '900.123.456-8', direccionContacto: 'Calle 1 # 2-3', ...o,
});

describe('normalizarNit', () => {
  it('quita puntos, espacios y el dígito de verificación cuando viene con guion', () => {
    expect(normalizarNit('900.123.456-8')).toBe('900123456');
    expect(normalizarNit(' 900 123 456 - 8 ')).toBe('900123456');
    expect(normalizarNit('900123456')).toBe('900123456');
  });
  it('entiende las cuatro formas en que se digitó el NIT de un mismo cliente en producción', () => {
    for (const real of [' 890102044-1', '890.102.044-1', '890102044 -1', '890102044-1']) expect(normalizarNit(real)).toBe('890102044');
  });
  it('sin guion lo deja tal cual (no puede saber si trae el dígito) y lo que no son dígitos no se «arregla»', () => {
    expect(normalizarNit('9001234568')).toBe('9001234568');
    expect(normalizarNit('ABC-123')).toBe('ABC-123'); // el puente lo rechaza
  });
  it('vacío o nulo → null', () => {
    expect(normalizarNit('   ')).toBeNull();
    expect(normalizarNit(null)).toBeNull();
    expect(normalizarNit(undefined)).toBeNull();
  });
});

describe('armarPayloadContratos', () => {
  const resultado = { valorMesIncluidoIva: 5000000, vigenciaMeses: 12, porcentajeIU: 8 };

  it('arma el JSON v1 con la solicitud y el Resultado guardado; el A.I.U. es el % de I.U. del costeo, tal cual', () => {
    expect(armarPayloadContratos({ solicitud: solicitud(), procesoCodigo: 'SED-LP-2026-0091', resultado })).toEqual({
      version: 1,
      origen: { solicitudId: 7, procesoCodigo: 'SED-LP-2026-0091' },
      cliente: { razonSocial: 'Cliente SAS', nit: '900123456', direccion: 'Calle 1 # 2-3' },
      contrato: { objeto: 'Aseo integral', porcentajeAIU: 8, valorMensual: 5000000, plazoMeses: 12 },
    });
  });

  it('lo que falta viaja como null (nunca se inventa); sin código en la solicitud usa el del costeo', () => {
    const p = armarPayloadContratos({ solicitud: solicitud({ codigoProceso: null, entidad: null, nitContacto: null, direccionContacto: '  ', objeto: null }), procesoCodigo: 'COSTEO-1', resultado: null });
    expect(p.origen.procesoCodigo).toBe('COSTEO-1');
    expect(p.cliente).toEqual({ razonSocial: null, nit: null, direccion: null });
    expect(p.contrato).toEqual({ objeto: null, porcentajeAIU: null, valorMensual: null, plazoMeses: null });
  });

  it('ignora valores del Resultado que no son números finitos', () => {
    const p = armarPayloadContratos({
      solicitud: solicitud(), procesoCodigo: null, resultado: { valorMesIncluidoIva: '5000000', vigenciaMeses: Number.NaN, porcentajeIU: undefined },
    });
    expect(p.contrato).toEqual({ objeto: 'Aseo integral', porcentajeAIU: null, valorMensual: null, plazoMeses: null });
  });
});

describe('describirError', () => {
  it('traduce el campo a una etiqueta legible y orienta dónde completar lo obligatorio', () => {
    expect(describirError({ campo: 'cliente.nit', mensaje: 'Es obligatorio.' })).toBe('NIT del cliente: Es obligatorio. Complételo en la ficha de la solicitud.');
    expect(describirError({ campo: 'contrato.plazoMeses', mensaje: 'Debe ser un número entero.' })).toBe('Plazo (meses): Debe ser un número entero.');
    expect(describirError({ campo: 'otro.campo', mensaje: 'x' })).toBe('otro.campo: x');
  });
});
