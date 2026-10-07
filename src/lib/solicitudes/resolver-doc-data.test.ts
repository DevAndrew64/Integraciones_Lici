import { describe, it, expect } from 'vitest';
import { faltaCargarDocData, resolverDocDataComplementario } from './resolver-doc-data';

describe('faltaCargarDocData', () => {
  it('undefined → falta cargar (dispara fetch)', () => {
    expect(faltaCargarDocData(undefined)).toBe(true);
  });
  it('null → falta cargar (dispara fetch)', () => {
    expect(faltaCargarDocData(null)).toBe(true);
  });
  it('arreglo vacío real → ya cargado, no repetir', () => {
    expect(faltaCargarDocData([])).toBe(false);
  });
  it('arreglo con elementos → ya cargado, no repetir', () => {
    expect(faltaCargarDocData([{ nombre: 'a.pdf' }])).toBe(false);
  });
});

describe('resolverDocDataComplementario', () => {
  const DOC1 = { nombre: 'GLC-FT-34 Solicitud invitación privada a cotizar No 001-2026.pdf' };
  const DOC2 = { nombre: 'PROPUESTA RFP HONOR PARA PROVEEDORES SERVICOS GENERALES Y CAFETERIA AÑO 2026.pdf' };

  it('Caso 1: respuesta ok con 2 documentos para la Solicitud pedida → los devuelve', () => {
    const docs = resolverDocDataComplementario(222, { ok: true, solicitud: { id: 222, docData: [DOC1, DOC2] } });
    expect(docs).toEqual([DOC1, DOC2]);
  });

  it('Caso 2: respuesta ok sin documentos → arreglo vacío (no null, para no repetir el fetch)', () => {
    const docs = resolverDocDataComplementario(222, { ok: true, solicitud: { id: 222, docData: [] } });
    expect(docs).toEqual([]);
  });

  it('respuesta con ok:false → null (se descarta, no pisa solLocal)', () => {
    const docs = resolverDocDataComplementario(222, { ok: false });
    expect(docs).toBeNull();
  });

  it('respuesta de una Solicitud distinta a la pedida (ficha cambiada) → null, se ignora', () => {
    const docs = resolverDocDataComplementario(222, { ok: true, solicitud: { id: 999, docData: [DOC1] } });
    expect(docs).toBeNull();
  });

  it('docData no es un arreglo (JSON corrupto) → arreglo vacío, no rompe la ficha', () => {
    const docs = resolverDocDataComplementario(222, { ok: true, solicitud: { id: 222, docData: 'no-es-un-arreglo' } });
    expect(docs).toEqual([]);
  });

  it('aislamiento Fortul/Honor & Laurel: nunca se resuelve por codigoProceso ni Proceso.id, solo por Solicitud.id', () => {
    // Aunque el código de proceso coincida con el de Fortul (Proceso.id=7050),
    // esta función solo compara el id de Solicitud recibido contra el pedido.
    const docsHonor = resolverDocDataComplementario(222, { ok: true, solicitud: { id: 222, docData: [DOC1, DOC2] } });
    const docsFortulComoRespuestaObsoleta = resolverDocDataComplementario(222, { ok: true, solicitud: { id: 7050, docData: [{ nombre: 'doc-fortul-1.pdf' }] } });
    expect(docsHonor).toEqual([DOC1, DOC2]);
    expect(docsFortulComoRespuestaObsoleta).toBeNull();
  });
});
