import { describe, expect, it } from 'vitest';
import type { TotalesPantallaDto } from '@/lib/costos-estructura/exportacion/costos-pantalla';
import {
  armarPayloadContratos, costosAdministrativosParaPuente, describirError, equiposParaPuente, insumosParaPuente, lineasQueNoLlegan, serviciosNoContinuosParaPuente, valoresAgregadosParaPuente, leerDestino, normalizarNit, type SolicitudParaPuente } from './payload';

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

describe('insumosParaPuente (módulo 6)', () => {
  const fila = (cambios: Record<string, unknown>) => ({ codigo: '18111', nombre: 'JABÓN', unidad: 'GL', cantidad: 1, frecuenciaMeses: 1, valorUnitarioSinIva: 25000, valorUnitarioConIva: 29750, valorMensual: 25000, valorAgregado: false, ...cambios });
  it('solo los insumos con código de elemento y que se venden (no los de valor agregado); el costo va sin IVA', () => {
    expect(insumosParaPuente([
      fila({}),
      fila({ codigo: ' 01050 ', valorUnitarioSinIva: 1234.5 }),
      fila({ codigo: '' }),
      fila({ codigo: 'CON ESPACIO' }),
      fila({ codigo: '22222', valorAgregado: true }),
      fila({ codigo: '33333', valorUnitarioSinIva: Number.NaN }),
    ])).toEqual([
      { codigo: '18111', valorUnitario: 25000, cantidad: 1, frecuenciaMeses: 1, valorUnitarioConIva: 29750 },
      { codigo: '01050', valorUnitario: 1234.5, cantidad: 1, frecuenciaMeses: 1, valorUnitarioConIva: 29750 },
    ]);
    expect(insumosParaPuente(null)).toEqual([]);
  });

  it('los que no llegan a la pestaña Insumos ni a la lista de precios se nombran (no se pierden en silencio)', () => {
    const dto = {
      insumos: { total: 0, filas: [fila({}), fila({ codigo: '', nombre: 'Bolsa  negra' }), fila({ codigo: 'CON ESPACIO', nombre: 'Cloro' }), fila({ codigo: '', valorAgregado: true }), fila({ codigo: '33333', nombre: 'Escoba', valorUnitarioSinIva: Number.NaN })] },
      maquinaria: { subtotalAdquisicion: 0, subtotalMantenimiento: 0, filas: [
        { codigo: '', descripcion: '  ', categoria: '', cantidadRequerida: 1, cantidadComprar: 1, valorUnitario: 1, valorMesComprar: 1, valorMesMantenimiento: 0, valorAgregado: false },
        { codigo: '', descripcion: 'X'.repeat(260), categoria: '', cantidadRequerida: 1, cantidadComprar: 1, valorUnitario: 1, valorMesComprar: 1, valorMesMantenimiento: 0, valorAgregado: false },
      ] },
      serviciosNoContinuos: [{ descripcion: 'Ñ'.repeat(251), valorAgregado: false }],
    } as never;
    expect(lineasQueNoLlegan(dto)).toEqual([
      'insumo «Bolsa negra» sin código de elemento',
      'insumo «Cloro» sin código de elemento',
      'insumo «Escoba» sin valor unitario válido',
      'equipo sin descripción',
      `equipo «${'X'.repeat(60)}…» con descripción recortada a 254 caracteres`,
      `no continuo «${'Ñ'.repeat(60)}…» con descripción recortada a 250 caracteres`,
    ]);
    expect(lineasQueNoLlegan({ insumos: { total: 0, filas: [fila({})] } } as never)).toEqual([]);
  });

  it('lleva cantidad, frecuencia y valor con IVA para la pestaña Insumos; una frecuencia vacía o en 0 es mensual', () => {
    expect(insumosParaPuente([fila({ cantidad: 4, frecuenciaMeses: 0, valorUnitarioConIva: Number.NaN })])).toEqual([
      { codigo: '18111', valorUnitario: 25000, cantidad: 4, frecuenciaMeses: 1, valorUnitarioConIva: 0 },
    ]);
  });

  it('sin insumos el payload no lleva la lista (la huella del puente no cambia)', () => {
    const p = armarPayloadContratos({ solicitud: { id: 1, codigoProceso: 'X', entidad: 'E', objeto: null, nitContacto: '900123456', direccionContacto: null }, procesoCodigo: 'X', resultado: null, insumos: [] });
    expect('insumos' in p).toBe(false);
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

describe('costosAdministrativosParaPuente (pestaña Costos Admtivos)', () => {
  const adm = (cambios: Record<string, unknown> = {}) => ({
    variables: [
      { concepto: ' Papelería ', cantidad: 1, valorUnitario: 1500, valorMensual: 1500 },
      { concepto: 'Microsoft', cantidad: 1, valorUnitario: 0, valorMensual: 0 },
      { concepto: '', cantidad: 1, valorUnitario: 10, valorMensual: 10 },
    ],
    totalVariables: 1500, valorMensualPolizas: 2500, valorMensualImpuestos: 1000, ...cambios,
  });
  it('pólizas, impuestos y cada variable con su valor mensual; las que valen 0 o no tienen nombre no viajan', () => {
    expect(costosAdministrativosParaPuente(adm())).toEqual([
      { concepto: 'Pólizas', valorMensual: 2500 },
      { concepto: 'Impuestos', valorMensual: 1000 },
      { concepto: 'Papelería', valorMensual: 1500 },
    ]);
    expect(costosAdministrativosParaPuente(adm({ valorMensualPolizas: Number.NaN, valorMensualImpuestos: 0 }))).toEqual([{ concepto: 'Papelería', valorMensual: 1500 }]);
    expect(costosAdministrativosParaPuente(null)).toEqual([]);
  });

  it('sin costos el payload no lleva la lista', () => {
    const p = armarPayloadContratos({ solicitud: { id: 1, codigoProceso: 'X', entidad: 'E', objeto: null, nitContacto: '900123456', direccionContacto: null }, procesoCodigo: 'X', resultado: null, costosAdministrativos: [] });
    expect('costosAdministrativos' in p).toBe(false);
  });
});

describe('equipos, no continuos y valores agregados para Contratos', () => {
  const maquina = (c: Record<string, unknown> = {}) => ({
    codigo: '004-096', descripcion: 'Aspiradora “Pro”', categoria: '', cantidadRequerida: 2, cantidadComprar: 1, valorUnitario: 1000000, valorMesComprar: 0,
    valorMesMantenimiento: 23000, valorAgregado: false, codigoGrupo: '004', codigoSubtipo: '096', mesesDepreciacion: 12, valorConIva: 1190000, ...c,
  });
  it('equipos: sin los de valor agregado, valor con IVA, códigos solo si caben y texto que Contratos puede guardar', () => {
    expect(equiposParaPuente([maquina(), maquina({ valorAgregado: true }), maquina({ codigoGrupo: 'ABCD', mesesDepreciacion: 0 })])).toEqual([
      { codigoGrupo: '004', codigoSubtipo: '096', descripcion: 'Aspiradora Pro', valorUnitario: 1190000, cantidadRequerida: 2, cantidadComprar: 1, mesesDepreciacion: 12, valorMesMantenimiento: 23000 },
      { codigoGrupo: null, codigoSubtipo: '096', descripcion: 'Aspiradora Pro', valorUnitario: 1190000, cantidadRequerida: 2, cantidadComprar: 1, mesesDepreciacion: 1, valorMesMantenimiento: 23000 },
    ]);
  });

  it('no continuos: código numérico del catálogo como actividad, frecuencia 1-15 (si no, mensual); sin los de valor agregado ni los de valor 0', () => {
    const srv = (c: Record<string, unknown> = {}) => ({ codigo: '14', uen: 'BAQ', descripcion: 'Brigada', frecuencia: 3, manoObra: 100, insumos: 50, equipos: 0, otrosCostos: 0, valorServicio: 150, valorMensual: 50, valorAgregado: false, ...c });
    expect(serviciosNoContinuosParaPuente([srv(), srv({ codigo: '', frecuencia: 20 }), srv({ valorAgregado: true }), srv({ valorMensual: 0 })]).map((s) => [s.actividad, s.frecuencia])).toEqual([[14, 3], [null, 1]]);
  });

  it('valores agregados: los que tienen valor, con su frecuencia y el porcentaje de la reinversión', () => {
    expect(valoresAgregadosParaPuente([
      { tipo: 'REINVERSION', descripcion: 'R', valorMensual: 1000, frecuencia: 12, tipoReinversion: 'PORCENTAJE', porcentaje: 2 },
      { tipo: 'SNC', descripcion: 'S', valorMensual: 0, frecuencia: null, tipoReinversion: null, porcentaje: null },
    ])).toEqual([{ tipo: 'REINVERSION', descripcion: 'R', valorMensual: 1000, frecuencia: 12, tipoReinversion: 'PORCENTAJE', porcentaje: 2 }]);
  });
});
