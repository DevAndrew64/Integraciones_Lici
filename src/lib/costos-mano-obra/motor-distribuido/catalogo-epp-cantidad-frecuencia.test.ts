import { describe, expect, it } from 'vitest';
import {
  numeroPositivoApi, resolverCampoApi, anotarConResolucion,
  cantidadFrecuenciaInicialEpp, campoBloqueadoPorApi, mensajeCantidadFrecuenciaManual,
} from './catalogo-epp-cantidad-frecuencia';

describe('numeroPositivoApi', () => {
  it('acepta números y texto numérico; todo lo demás (0, negativos, vacío, null, basura) es 0', () => {
    expect(numeroPositivoApi(12)).toBe(12);
    expect(numeroPositivoApi('3')).toBe(3);
    expect(numeroPositivoApi(0)).toBe(0);
    expect(numeroPositivoApi('0')).toBe(0);
    expect(numeroPositivoApi(-2)).toBe(0);
    expect(numeroPositivoApi('')).toBe(0);
    expect(numeroPositivoApi('  ')).toBe(0);
    expect(numeroPositivoApi(null)).toBe(0);
    expect(numeroPositivoApi(undefined)).toBe(0);
    expect(numeroPositivoApi('abc')).toBe(0);
  });
});

describe('resolverCampoApi — valor > 0 se toma; 0 o ausente es "no definido"', () => {
  it("valor positivo → 'api' con ese valor", () => {
    expect(resolverCampoApi(50)).toEqual({ estado: 'api', valor: 50 });
    expect(resolverCampoApi('3')).toEqual({ estado: 'api', valor: 3 });
  });
  it("0, ausente o inválido → 'no_definido'", () => {
    expect(resolverCampoApi(0)).toEqual({ estado: 'no_definido', valor: 0 });
    expect(resolverCampoApi(undefined)).toEqual({ estado: 'no_definido', valor: 0 });
    expect(resolverCampoApi(null)).toEqual({ estado: 'no_definido', valor: 0 });
    expect(resolverCampoApi('')).toEqual({ estado: 'no_definido', valor: 0 });
  });
});

describe('anotarConResolucion — cada fila lleva SU valor (caso real 18111 por grupo de EPP)', () => {
  it('EP001 → 1/3 de la API', () => {
    expect(anotarConResolucion({ codigo: '18111', codgrp: 'EP001', cantidad: 1, frecuencia: 3 }))
      .toMatchObject({ codgrp: 'EP001', cantidadEstadoApi: 'api', cantidadApi: 1, frecuenciaEstadoApi: 'api', frecuenciaApi: 3 });
  });
  it('EP021 → 1/6 (otro grupo, otro valor)', () => {
    expect(anotarConResolucion({ codigo: '18111', codgrp: 'EP021', cantidad: 1, frecuencia: 6 }))
      .toMatchObject({ cantidadApi: 1, frecuenciaApi: 6 });
  });
  it('EP020 → 0/0: ambos no definidos', () => {
    expect(anotarConResolucion({ codigo: '18111', codgrp: 'EP020', cantidad: 0, frecuencia: 0 }))
      .toMatchObject({ cantidadEstadoApi: 'no_definido', cantidadApi: 0, frecuenciaEstadoApi: 'no_definido', frecuenciaApi: 0 });
  });
  it('EP115 → 0/3: cantidad sin definir, frecuencia de la API (cada campo por separado)', () => {
    expect(anotarConResolucion({ codigo: '18111', codgrp: 'EP115', cantidad: 0, frecuencia: 3 }))
      .toMatchObject({ cantidadEstadoApi: 'no_definido', cantidadApi: 0, frecuenciaEstadoApi: 'api', frecuenciaApi: 3 });
  });
  it('conserva el resto de la fila sin tocarla', () => {
    const item = anotarConResolucion({ codigo: '7', nombre: 'Casco', valor: 5000, cantidad: 2, frecuencia: 12 });
    expect(item).toMatchObject({ codigo: '7', nombre: 'Casco', valor: 5000, cantidad: 2, frecuencia: 12 });
  });
});

describe('cantidadFrecuenciaInicialEpp — valores con los que nace la fila', () => {
  it('ambos de la API → toma los valores y los marca para bloquear', () => {
    expect(cantidadFrecuenciaInicialEpp({ cantidadEstadoApi: 'api', cantidadApi: 50, frecuenciaEstadoApi: 'api', frecuenciaApi: 2 }))
      .toEqual({ cant: 50, frec: 2, cantEstadoApi: 'api', frecEstadoApi: 'api' });
  });
  it("no definido → conserva el 1 de siempre y queda editable ('no_definido')", () => {
    expect(cantidadFrecuenciaInicialEpp({ cantidadEstadoApi: 'no_definido', cantidadApi: 0, frecuenciaEstadoApi: 'no_definido', frecuenciaApi: 0 }))
      .toEqual({ cant: 1, frec: 1, cantEstadoApi: 'no_definido', frecEstadoApi: 'no_definido' });
  });
  it('un campo de la API y el otro no: cada uno por separado', () => {
    expect(cantidadFrecuenciaInicialEpp({ cantidadEstadoApi: 'no_definido', cantidadApi: 0, frecuenciaEstadoApi: 'api', frecuenciaApi: 3 }))
      .toEqual({ cant: 1, frec: 3, cantEstadoApi: 'no_definido', frecEstadoApi: 'api' });
  });
  it("un estado 'api' sin valor positivo NUNCA bloquea (queda 'no_definido' y editable)", () => {
    expect(cantidadFrecuenciaInicialEpp({ cantidadEstadoApi: 'api', cantidadApi: 0, frecuenciaEstadoApi: 'api', frecuenciaApi: 0 }))
      .toEqual({ cant: 1, frec: 1, cantEstadoApi: 'no_definido', frecEstadoApi: 'no_definido' });
  });
  it('un item sin resolución (respuesta antigua) mantiene el comportamiento histórico: 1/1, sin estado ni aviso', () => {
    expect(cantidadFrecuenciaInicialEpp({ codigo: '1', cantidad: 5, frecuencia: 3 })).toEqual({ cant: 1, frec: 1 });
  });
});

describe('campoBloqueadoPorApi', () => {
  it("solo bloquea el campo cuyo estado es 'api'", () => {
    const fila = { cantEstadoApi: 'api' as const, frecEstadoApi: 'no_definido' as const };
    expect(campoBloqueadoPorApi(fila, 'cant')).toBe(true);
    expect(campoBloqueadoPorApi(fila, 'frec')).toBe(false);
    expect(campoBloqueadoPorApi(fila, 'vUnit')).toBe(false);
  });
  it('una fila manual o histórica (sin estado) nunca se bloquea', () => {
    expect(campoBloqueadoPorApi({}, 'cant')).toBe(false);
    expect(campoBloqueadoPorApi({}, 'frec')).toBe(false);
  });
});

describe('mensajeCantidadFrecuenciaManual — texto para el usuario, sin la palabra "API"', () => {
  it('sin aviso cuando ambos vienen del catálogo o la fila no tiene estado', () => {
    expect(mensajeCantidadFrecuenciaManual({ cantEstadoApi: 'api', frecEstadoApi: 'api' })).toBeNull();
    expect(mensajeCantidadFrecuenciaManual({})).toBeNull();
  });
  it('ambos no definidos', () => {
    expect(mensajeCantidadFrecuenciaManual({ cantEstadoApi: 'no_definido', frecEstadoApi: 'no_definido' }))
      .toBe('Este EPP no tiene cantidad ni frecuencia definidas en el catálogo. Ingrésalas manualmente.');
  });
  it('solo uno no definido', () => {
    expect(mensajeCantidadFrecuenciaManual({ cantEstadoApi: 'api', frecEstadoApi: 'no_definido' }))
      .toBe('Este EPP no tiene frecuencia definida en el catálogo. Ingrésala manualmente.');
    expect(mensajeCantidadFrecuenciaManual({ cantEstadoApi: 'no_definido', frecEstadoApi: 'api' }))
      .toBe('Este EPP no tiene cantidad definida en el catálogo. Ingrésala manualmente.');
  });
  it('ningún mensaje menciona "API"', () => {
    for (const c of ['api', 'no_definido'] as const) for (const f of ['api', 'no_definido'] as const) {
      const m = mensajeCantidadFrecuenciaManual({ cantEstadoApi: c, frecEstadoApi: f });
      if (m) expect(m).not.toMatch(/\bAPI\b/i);
    }
  });
});
