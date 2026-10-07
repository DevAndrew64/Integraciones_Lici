import { describe, it, expect } from 'vitest';
import { determinarOrigenProceso, pareceRawJsonFuenteHistorica } from './origen-proceso';

const RAW_FUENTE_HISTORICA_7669 = {
  link: 'https://portal-nc.example/detalle-contrato?random=6a675de7461942.32736861',
  alias_fuente: 'NC',
  idContrato: 11866231,
  Nombre: 'ELEMENTOS DE ASEO PARA LIMPIEZA DE PLANTAS Y MANTENIMIENTO DE 5S',
  EntidadContratante: 'Sociedad portuaria LAS AMÉRICAS S.A.',
  Objeto: 'ELEMENTOS DE ASEO PARA LIMPIEZA DE PLANTAS Y MANTENIMIENTO DE 5S',
};

describe('determinarOrigenProceso', () => {
  it('1. Clasificación MANUAL — sourceKey manual:, sin externalId, sin alias SECOP', () => {
    expect(determinarOrigenProceso({ sourceKey: 'manual:7cb05938-8c4b-45a8-8659-1957923ae6d7', externalId: null, aliasFuente: 'NC', fuente: 'Manual', rawJson: null })).toBe('MANUAL');
  });

  it('2. Clasificación FUENTE_HISTORICA — ext: + externalId + NC + rawJson con forma real (caso 7669)', () => {
    expect(determinarOrigenProceso({ sourceKey: 'ext:11866231', externalId: '11866231', aliasFuente: 'NC', fuente: '', rawJson: RAW_FUENTE_HISTORICA_7669 })).toBe('FUENTE_HISTORICA');
  });

  it('3. Clasificación S1 — alias S1 con identidad externa', () => {
    expect(determinarOrigenProceso({ sourceKey: 'ext:123', externalId: '123', aliasFuente: 'S1', rawJson: null })).toBe('SECOP_I');
  });

  it('4. Clasificación S2 — alias S2 con identidad externa', () => {
    expect(determinarOrigenProceso({ sourceKey: 'ext:456', externalId: '456', aliasFuente: 'S2', rawJson: null })).toBe('SECOP_II');
  });

  it('5. Clasificación DESCONOCIDO ante contradicción — sourceKey manual: con externalId presente', () => {
    expect(determinarOrigenProceso({ sourceKey: 'manual:uuid-x', externalId: '99999', aliasFuente: 'NC', rawJson: null })).toBe('DESCONOCIDO');
  });

  it('DESCONOCIDO ante contradicción — sourceKey manual: con aliasFuente S1', () => {
    expect(determinarOrigenProceso({ sourceKey: 'manual:uuid-x', externalId: null, aliasFuente: 'S1', rawJson: null })).toBe('DESCONOCIDO');
  });

  it('DESCONOCIDO — NC con sourceKey ext: pero SIN rawJson (forma no verificable)', () => {
    expect(determinarOrigenProceso({ sourceKey: 'ext:11866231', externalId: '11866231', aliasFuente: 'NC', rawJson: null })).toBe('DESCONOCIDO');
  });

  it('DESCONOCIDO — NC con sourceKey ext: y rawJson vacío/sin forma reconocible', () => {
    expect(determinarOrigenProceso({ sourceKey: 'ext:1', externalId: '1', aliasFuente: 'NC', rawJson: { foo: 'bar' } })).toBe('DESCONOCIDO');
  });

  it('DESCONOCIDO — NC con sourceKey ext: pero SIN externalId (inconsistencia interna)', () => {
    expect(determinarOrigenProceso({ sourceKey: 'ext:', externalId: null, aliasFuente: 'NC', rawJson: RAW_FUENTE_HISTORICA_7669 })).toBe('DESCONOCIDO');
  });

  it('DESCONOCIDO — S1 sin ninguna identidad externa (incoherente)', () => {
    expect(determinarOrigenProceso({ sourceKey: 'mix:algo', externalId: null, aliasFuente: 'S1', rawJson: null })).toBe('DESCONOCIDO');
  });

  it('DESCONOCIDO — S2 sin ninguna identidad externa', () => {
    expect(determinarOrigenProceso({ sourceKey: 'mix:algo', externalId: null, aliasFuente: 'S2', rawJson: null })).toBe('DESCONOCIDO');
  });

  it('DESCONOCIDO — entrada completamente vacía/incompleta', () => {
    expect(determinarOrigenProceso({})).toBe('DESCONOCIDO');
  });

  it('DESCONOCIDO — aliasFuente ausente aunque haya sourceKey ext: y externalId', () => {
    expect(determinarOrigenProceso({ sourceKey: 'ext:11866231', externalId: '11866231', aliasFuente: null, rawJson: RAW_FUENTE_HISTORICA_7669 })).toBe('DESCONOCIDO');
  });

  it('acepta rawJson ya parseado (objeto) o como string JSON, con el mismo resultado', () => {
    const comoString = determinarOrigenProceso({ sourceKey: 'ext:11866231', externalId: '11866231', aliasFuente: 'NC', rawJson: JSON.stringify(RAW_FUENTE_HISTORICA_7669) });
    const comoObjeto = determinarOrigenProceso({ sourceKey: 'ext:11866231', externalId: '11866231', aliasFuente: 'NC', rawJson: RAW_FUENTE_HISTORICA_7669 });
    expect(comoString).toBe('FUENTE_HISTORICA');
    expect(comoObjeto).toBe('FUENTE_HISTORICA');
  });

  it('rawJson con JSON inválido (string corrupto) no lanza y resuelve DESCONOCIDO para NC', () => {
    expect(determinarOrigenProceso({ sourceKey: 'ext:1', externalId: '1', aliasFuente: 'NC', rawJson: '{invalido' })).toBe('DESCONOCIDO');
  });

  it('los 8 manuales reales del diagnóstico clasifican MANUAL', () => {
    const manuales = [
      { sourceKey: 'manual:7cb05938-8c4b-45a8-8659-1957923ae6d7', externalId: null, aliasFuente: 'NC', fuente: 'Manual' },
      { sourceKey: 'manual:f0c1c12c-f06e-4333-be2d-e24ff47fdd59', externalId: null, aliasFuente: 'NC', fuente: 'Manual' },
      { sourceKey: 'manual:81769190-49b2-40a4-83ed-b2141ab52498', externalId: null, aliasFuente: 'NC', fuente: 'Manual' },
      { sourceKey: 'manual:08cad21a-65b5-47ec-9bb6-edd68ecea094', externalId: null, aliasFuente: 'NC', fuente: 'Manual' },
      { sourceKey: 'manual:83c54de3-391f-4773-970c-d74c1b57818b', externalId: null, aliasFuente: 'NC', fuente: 'Manual' },
      { sourceKey: 'manual:041e742a-63e0-4e86-82b6-9766ea39bf95', externalId: null, aliasFuente: 'NC', fuente: 'Manual' },
      { sourceKey: 'manual:1b41a9a4-a106-4777-93e5-60014f58875c', externalId: null, aliasFuente: 'NC', fuente: 'Manual' },
      { sourceKey: 'manual:f61df23d-2f15-40c2-9aec-7eba3de397c6', externalId: null, aliasFuente: 'NC', fuente: 'Manual' },
    ];
    for (const m of manuales) expect(determinarOrigenProceso(m)).toBe('MANUAL');
  });

  it('los 5 candidatos reales del diagnóstico (7669,7665,7637,7628,7629) clasifican FUENTE_HISTORICA', () => {
    const casos = [
      { externalId: '11866231', rawJson: { idContrato: 11866231, EntidadContratante: 'Sociedad portuaria LAS AMÉRICAS S.A.', link: 'https://portal-nc.example/detalle-contrato?random=6a675de7461942.32736861' } },
      { externalId: '11864577', rawJson: { idContrato: 11864577, EntidadContratante: 'CRUZ ROJA COLOMBIANA', link: 'https://portal-nc.example/detalle-contrato?random=6a674be2827166.81034659' } },
      { externalId: '11861268', rawJson: { idContrato: 11861268, EntidadContratante: 'ESP CENTRALES ELECTRICAS DEL NORTE DE SANTANDER SA', link: 'https://portal-nc.example/detalle-contrato?random=360aef88865f4bf8.47368149' } },
      { externalId: '11859030', rawJson: { idContrato: 11859030, EntidadContratante: 'CRUZ ROJA COLOMBIANA', link: 'https://portal-nc.example/detalle-contrato?random=6a6384b9e37b39.96777227' } },
      { externalId: '11858931', rawJson: { idContrato: 11858931, EntidadContratante: 'CRUZ ROJA COLOMBIANA', link: 'https://portal-nc.example/detalle-contrato?random=6a6381fea09a03.46148151' } },
    ];
    for (const c of casos) {
      expect(determinarOrigenProceso({ sourceKey: `ext:${c.externalId}`, externalId: c.externalId, aliasFuente: 'NC', rawJson: c.rawJson })).toBe('FUENTE_HISTORICA');
    }
  });
});

describe('pareceRawJsonFuenteHistorica', () => {
  it('null → false', () => expect(pareceRawJsonFuenteHistorica(null)).toBe(false));
  it('sin idContrato → false', () => expect(pareceRawJsonFuenteHistorica({ EntidadContratante: 'x' })).toBe(false));
  it('idContrato=0 → false (valor centinela de "sin id")', () => expect(pareceRawJsonFuenteHistorica({ idContrato: 0, EntidadContratante: 'x' })).toBe(false));
  it('idContrato válido pero sin ninguna señal adicional → false', () => expect(pareceRawJsonFuenteHistorica({ idContrato: 123 })).toBe(false));
  it('idContrato + EntidadContratante → true', () => expect(pareceRawJsonFuenteHistorica({ idContrato: 123, EntidadContratante: 'x' })).toBe(true));
});