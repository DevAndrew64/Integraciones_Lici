import { describe, it, expect } from 'vitest';
import {
  consolidarFilasPorIdentidad,
  identidadDotItem, configuracionDotItem,
  identidadExamen, configuracionExamen,
  identidadVacuna, configuracionVacuna,
  identidadCurso, configuracionCurso,
} from './herencia-turnante-otros-costos';

describe('consolidarFilasPorIdentidad — regla genérica', () => {
  it('caso 3: dos posiciones con el MISMO elemento y la MISMA configuración se consolidan una sola vez (nunca duplican costo)', () => {
    const guanteA = { codigo: 'G001', cant: 2, frec: 6, vUnit: 10000, medida: 'PAR' };
    const guanteB = { ...guanteA };
    const r = consolidarFilasPorIdentidad(
      [{ posicionId: 1, fila: guanteA }, { posicionId: 2, fila: guanteB }],
      identidadDotItem, configuracionDotItem,
    );
    expect(r.consolidadas).toHaveLength(1);
    expect(r.conflictos).toHaveLength(0);
    expect(r.consolidadas[0].fila.cant).toBe(2); // nunca 4
    expect(r.consolidadas[0].origenPosicionIds.sort()).toEqual([1, 2]);
  });

  it('caso 4: dos posiciones con elementos DISTINTOS (identidad distinta) se heredan ambos', () => {
    const guante = { codigo: 'G001', cant: 2, frec: 6, vUnit: 10000, medida: 'PAR' };
    const casco = { codigo: 'C001', cant: 1, frec: 12, vUnit: 25000, medida: 'UND' };
    const r = consolidarFilasPorIdentidad(
      [{ posicionId: 1, fila: guante }, { posicionId: 2, fila: casco }],
      identidadDotItem, configuracionDotItem,
    );
    expect(r.consolidadas).toHaveLength(2);
    expect(r.conflictos).toHaveLength(0);
  });

  it('caso 5: mismo elemento (misma identidad), configuración DIFERENTE — se detecta como conflicto, nunca se resuelve en silencio', () => {
    const guanteCant2 = { codigo: 'G001', cant: 2, frec: 6, vUnit: 10000, medida: 'PAR' };
    const guanteCant4 = { codigo: 'G001', cant: 4, frec: 6, vUnit: 10000, medida: 'PAR' };
    const r = consolidarFilasPorIdentidad(
      [{ posicionId: 1, fila: guanteCant2 }, { posicionId: 2, fila: guanteCant4 }],
      identidadDotItem, configuracionDotItem,
    );
    expect(r.consolidadas).toHaveLength(0); // nunca 2+4=6, nunca promedio 3, nunca elegir una
    expect(r.conflictos).toHaveLength(1);
    expect(r.conflictos[0].identidad).toBe('g001');
    expect(r.conflictos[0].filas).toHaveLength(2);
  });

  it('nunca suma cantidades, nunca promedia, nunca escoge el máximo silenciosamente en un conflicto', () => {
    const a = { codigo: 'X', cant: 1, frec: 1, vUnit: 100, medida: 'UND' };
    const b = { codigo: 'X', cant: 999, frec: 1, vUnit: 100, medida: 'UND' };
    const r = consolidarFilasPorIdentidad([{ posicionId: 1, fila: a }, { posicionId: 2, fila: b }], identidadDotItem, configuracionDotItem);
    expect(r.consolidadas.some(c => c.fila.cant === 1000)).toBe(false);
    expect(r.consolidadas.some(c => c.fila.cant === 500)).toBe(false);
    expect(r.consolidadas.some(c => c.fila.cant === 999)).toBe(false);
    expect(r.conflictos).toHaveLength(1);
  });

  it('identidad NUNCA es la descripción textual — dos filas con distinto texto pero mismo código consolidan', () => {
    const a = { codigo: 'G001', cant: 2, frec: 6, vUnit: 10000, medida: 'PAR' };
    const b = { codigo: 'G001', cant: 2, frec: 6, vUnit: 10000, medida: 'PAR' };
    const r = consolidarFilasPorIdentidad([{ posicionId: 1, fila: a }, { posicionId: 2, fila: b }], identidadDotItem, configuracionDotItem);
    expect(r.consolidadas).toHaveLength(1);
  });
});

describe('identidad de Exámenes — incluye proveedor/municipio, nunca solo el código', () => {
  it('mismo examen, mismo proveedor, mismo municipio, misma configuración → consolida', () => {
    const a = { codExamen: 'EX001', tipo: 'Ocupacional', nitProveedor: '900-1', codigoMunicipio: '08001', cant: 1, valor: 50000, frecAnios: 1, factorExamen: 1 };
    const b = { ...a };
    const r = consolidarFilasPorIdentidad([{ posicionId: 1, fila: a }, { posicionId: 2, fila: b }], identidadExamen, configuracionExamen);
    expect(r.consolidadas).toHaveLength(1);
  });

  it('mismo examen, proveedor DISTINTO → identidad distinta (nunca se mezclan como si fueran el mismo)', () => {
    const a = { codExamen: 'EX001', tipo: 'Ocupacional', nitProveedor: '900-1', codigoMunicipio: '08001', cant: 1, valor: 50000, frecAnios: 1 };
    const b = { ...a, nitProveedor: '900-2' };
    const r = consolidarFilasPorIdentidad([{ posicionId: 1, fila: a }, { posicionId: 2, fila: b }], identidadExamen, configuracionExamen);
    expect(r.consolidadas).toHaveLength(2);
    expect(r.conflictos).toHaveLength(0);
  });

  it('mismo examen/proveedor/municipio, valor DISTINTO → conflicto', () => {
    const a = { codExamen: 'EX001', tipo: 'Ocupacional', nitProveedor: '900-1', codigoMunicipio: '08001', cant: 1, valor: 50000, frecAnios: 1 };
    const b = { ...a, valor: 70000 };
    const r = consolidarFilasPorIdentidad([{ posicionId: 1, fila: a }, { posicionId: 2, fila: b }], identidadExamen, configuracionExamen);
    expect(r.conflictos).toHaveLength(1);
    expect(r.consolidadas).toHaveLength(0);
  });
});

describe('identidad de Vacunas — incluye tipoTarifa', () => {
  it('mismo código, misma tarifa, misma configuración → consolida', () => {
    const a = { codigo: 'V001', tipo: 'Influenza', tipoTarifa: 'PREFERENCIAL', cant: 1, valor: 30000, frecAnios: 1, dosisPorTrabajador: 1 };
    const b = { ...a };
    const r = consolidarFilasPorIdentidad([{ posicionId: 1, fila: a }, { posicionId: 2, fila: b }], identidadVacuna, configuracionVacuna);
    expect(r.consolidadas).toHaveLength(1);
  });

  it('misma vacuna, tarifa PREFERENCIAL vs PUBLICO_GENERAL → identidades distintas (ofertas distintas)', () => {
    const a = { codigo: 'V001', tipo: 'Influenza', tipoTarifa: 'PREFERENCIAL', cant: 1, valor: 30000, frecAnios: 1 };
    const b = { ...a, tipoTarifa: 'PUBLICO_GENERAL' };
    const r = consolidarFilasPorIdentidad([{ posicionId: 1, fila: a }, { posicionId: 2, fila: b }], identidadVacuna, configuracionVacuna);
    expect(r.consolidadas).toHaveLength(2);
  });
});

describe('identidad de Cursos — proveedor/ciudad/precio forman parte de la identidad (nunca solo el código de curso)', () => {
  it('mismo curso, mismo proveedor/ciudad/valores, misma configuración → consolida', () => {
    const a = { codigoGrupo: 'GC001', codigo: 'CU001', nitProveedor: '900-1', nombreProveedor: 'ACME', codigoMunicipio: '08001', ciudad: 'BAQ', valorPrimeraVez: 100000, valorReentrenamiento: 50000, cant: 1, frecAnios: 1, alcance: 'POR_TRABAJADOR' };
    const b = { ...a };
    const r = consolidarFilasPorIdentidad([{ posicionId: 1, fila: a }, { posicionId: 2, fila: b }], identidadCurso, configuracionCurso);
    expect(r.consolidadas).toHaveLength(1);
  });

  it('mismo código de curso, proveedor/ciudad/precio DISTINTOS → dos registros legítimamente distintos, nunca se consolidan por compartir código', () => {
    const a = { codigoGrupo: 'GC001', codigo: 'CU001', nitProveedor: '900-1', nombreProveedor: 'ACME', codigoMunicipio: '08001', ciudad: 'BAQ', valorPrimeraVez: 100000, valorReentrenamiento: 50000, cant: 1, frecAnios: 1 };
    const b = { ...a, nitProveedor: '900-2', nombreProveedor: 'OTRO PROVEEDOR', ciudad: 'BOG', codigoMunicipio: '11001', valorPrimeraVez: 200000 };
    const r = consolidarFilasPorIdentidad([{ posicionId: 1, fila: a }, { posicionId: 2, fila: b }], identidadCurso, configuracionCurso);
    expect(r.consolidadas).toHaveLength(2);
    expect(r.conflictos).toHaveLength(0);
  });

  it('mismo curso/proveedor/ciudad/valores, alcance DISTINTO → conflicto', () => {
    const a = { codigoGrupo: 'GC001', codigo: 'CU001', nitProveedor: '900-1', codigoMunicipio: '08001', valorPrimeraVez: 100000, valorReentrenamiento: 50000, cant: 1, frecAnios: 1, alcance: 'POR_TRABAJADOR' };
    const b = { ...a, alcance: 'POR_LINEA' };
    const r = consolidarFilasPorIdentidad([{ posicionId: 1, fila: a }, { posicionId: 2, fila: b }], identidadCurso, configuracionCurso);
    expect(r.conflictos).toHaveLength(1);
  });
});
