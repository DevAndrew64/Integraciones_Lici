import { describe, expect, it } from 'vitest';
import type { TotalesPantallaDto } from '@/lib/costos-estructura/exportacion/costos-pantalla';
import { armarPayloadContratos, describirError, leerDestino, normalizarNit, type SolicitudParaPuente } from './payload';

const solicitud = (o: Partial<SolicitudParaPuente> = {}): SolicitudParaPuente => ({
  id: 7, codigoProceso: 'SED-LP-2026-0091', entidad: ' Cliente SAS ', objeto: 'Aseo integral', nitContacto: '900.123.456-8', direccionContacto: 'Calle 1 # 2-3', ...o,
});

const SIN_OFERTA = { empresa: null, undnegocio: null, tipoAdm: null, origenProceso: null, codServicio: null, descripcionServicio: null };
const SIN_TARIFA = { manoObra: null, insumos: null, maquinaria: null, administrativos: null, valorAgregado: null, serviciosNoContinuos: null };
const totales: TotalesPantallaDto = {
  manoObra: 12140000, otrosCostosEnManoObra: 320000, insumos: 1000000, maquinaria: 500000, serviciosNoContinuos: 250000, valorAgregado: 0, administrativos: 5000, total: 13895000,
};

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

describe('leerDestino', () => {
  it('toma solo las claves conocidas, solo texto, sin espacios; los códigos van en mayúsculas', () => {
    expect(leerDestino({ empresa: ' 01 ', undnegocio: 'baq', tipoAdm: 'a', origenProceso: 'lic', codServicio: 'ase', descripcionServicio: ' Aseo y cafetería ', otra: 'x', admin: true })).toEqual({
      empresa: '01', undnegocio: 'BAQ', tipoAdm: 'A', origenProceso: 'LIC', codServicio: 'ASE', descripcionServicio: 'Aseo y cafetería',
    });
  });
  it('lo que no es texto o está vacío queda null (nunca se inventa); un cuerpo que no es objeto no rompe', () => {
    expect(leerDestino({ empresa: 1, undnegocio: '  ', tipoAdm: null, origenProceso: ['LIC'] })).toEqual(SIN_OFERTA);
    for (const raro of [null, undefined, 'texto', 5, [1, 2]]) expect(leerDestino(raro)).toEqual(SIN_OFERTA);
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
      oferta: SIN_OFERTA,
      tarifa: SIN_TARIFA,
    });
  });

  it('los seis valores de la tarifa llevan el A.I.U. incluido, al peso, como la hoja «Contratos» del Excel de costos', () => {
    const p = armarPayloadContratos({ solicitud: solicitud(), procesoCodigo: null, resultado, totales });
    expect(p.tarifa).toEqual({
      manoObra: 13111200, // 12.140.000 × 1,08
      insumos: 1080000,
      maquinaria: 540000,
      administrativos: 5400,
      valorAgregado: 0,
      serviciosNoContinuos: 270000,
    });
    for (const v of Object.values(p.tarifa)) expect(Number.isInteger(v)).toBe(true);
  });

  it('el redondeo es al peso: 55.596.129,98835262 con 10 % de I.U. → 61.155.743 (el caso de la plantilla de producción)', () => {
    const p = armarPayloadContratos({ solicitud: solicitud(), procesoCodigo: null, resultado: { porcentajeIU: 10 }, totales: { ...totales, manoObra: 55596129.98835262 } });
    expect(p.tarifa.manoObra).toBe(61155743);
  });

  it('sin el A.I.U. (Resultado sin guardar) no hay valores de tarifa: un valor sin A.I.U. no es el que lleva Contratos', () => {
    const p = armarPayloadContratos({ solicitud: solicitud(), procesoCodigo: null, resultado: null, totales });
    expect(p.tarifa).toEqual(SIN_TARIFA);
    expect(p.contrato.porcentajeAIU).toBeNull();
  });

  it('el destino elegido por quien envía viaja en «oferta»', () => {
    const destino = leerDestino({ empresa: '01', undnegocio: 'BAQ', tipoAdm: 'A', origenProceso: 'LIC', codServicio: 'ASE', descripcionServicio: 'Aseo' });
    expect(armarPayloadContratos({ solicitud: solicitud(), procesoCodigo: null, resultado, totales, destino }).oferta).toEqual({
      empresa: '01', undnegocio: 'BAQ', tipoAdm: 'A', origenProceso: 'LIC', codServicio: 'ASE', descripcionServicio: 'Aseo',
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

  it('los datos del envío y la tarifa dicen dónde corregirlos', () => {
    expect(describirError({ campo: 'oferta.tipoAdm', mensaje: 'Es obligatorio para escribir en Contratos.' })).toBe(
      'Tipo de tarifa (A o C): Es obligatorio para escribir en Contratos. Complételo en los datos del envío a Contratos.',
    );
    expect(describirError({ campo: 'tarifa.manoObra', mensaje: 'Es obligatorio para escribir en Contratos.' })).toBe(
      'Vr. Mano de obra: Es obligatorio para escribir en Contratos. Guarde la pestaña Resultado del costeo.',
    );
    expect(describirError({ campo: 'contrato.porcentajeAIU', mensaje: 'Es obligatorio para escribir en Contratos.' })).toContain('Guarde la pestaña Resultado del costeo.');
  });

  it('un cliente que no existe en Contratos NO se manda a la ficha: el NIT está completo y el mensaje ya dice qué hacer', () => {
    expect(describirError({ campo: 'cliente.nit', mensaje: 'El cliente con NIT 900123456 no existe en Contratos. Créelo en Contratos y vuelva a enviar.' })).toBe(
      'NIT del cliente: El cliente con NIT 900123456 no existe en Contratos. Créelo en Contratos y vuelva a enviar.',
    );
  });
});
