import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { empresaPorNombre, leerDestino, nombreComparable, uensDeEmpresa } from '../src/destino.js';

const EMPRESAS = [
  { codigo: '01', undnegocio: 'BAQ', rsocial: 'ASEOCOLBA S.A.' },
  { codigo: '01', undnegocio: 'MNA', rsocial: 'ASEOCOLBA S.A.' },
  { codigo: '02', undnegocio: 'BAQ', rsocial: 'Vigilancia Vigicolba Ltda.' },
  { codigo: '04', undnegocio: 'BAQ', rsocial: 'TEMPOCOLBA S.A.S' },
  { codigo: '09', undnegocio: 'BAQ', rsocial: 'TEMPOCOLBA SERVICIOS' },
];

describe('destino de la oferta en Contratos', () => {
  it('nombreComparable quita tildes, espacios y signos', () => {
    assert.equal(nombreComparable('  Aseo Colba S.A.S. '), 'ASEOCOLBASAS');
    assert.equal(nombreComparable('Compañía Ñ'), 'COMPANIAN');
  });

  it('la empresa por su nombre: igual sin forma societaria, si no la que lo contiene; varias distintas = ambigua', () => {
    assert.deepEqual(empresaPorNombre(EMPRESAS, 'ASEOCOLBA'), { codigo: '01', rsocial: 'ASEOCOLBA S.A.' });
    assert.deepEqual(empresaPorNombre(EMPRESAS, 'vigicolba'), { codigo: '02', rsocial: 'Vigilancia Vigicolba Ltda.' });
    assert.deepEqual(empresaPorNombre(EMPRESAS, 'TEMPOCOLBA'), { codigo: '04', rsocial: 'TEMPOCOLBA S.A.S' }, 'el nombre exacto gana sobre el que lo contiene');
    assert.equal(empresaPorNombre(EMPRESAS, 'TRANSCOLBA').error, 'SIN_EMPRESA');
    assert.equal(empresaPorNombre(EMPRESAS, '').error, 'SIN_EMPRESA');
    const ambigua = empresaPorNombre([...EMPRESAS, { codigo: '05', undnegocio: 'BAQ', rsocial: 'VIGICOLBA SEGURIDAD' }], 'VIGICOLBA');
    assert.equal(ambigua.error, 'EMPRESA_AMBIGUA');
    assert.equal(ambigua.candidatas.length, 2);
  });

  it('las UEN son las del contador de ofertas de la empresa, cada una con sus conceptos', () => {
    const uens = uensDeEmpresa('01', {
      contadores: [{ empresa: '01', undnegocio: 'mna' }, { empresa: '01', undnegocio: 'BAQ' }, { empresa: '02', undnegocio: 'BAQ' }],
      conceptos: [
        { empresa: '01', undnegocio: 'BAQ', codcpto: '461', descrip: 'ASEO Y CAFETERIA  ', nombre: '' },
        { empresa: '01', undnegocio: 'BAQ', codcpto: '460', descrip: '', nombre: 'ASEO' },
        { empresa: '01', undnegocio: 'BOG', codcpto: '470', descrip: 'X', nombre: '' },
      ],
    });
    assert.deepEqual(uens, [
      { codigo: 'BAQ', conceptos: [{ codigo: '460', descripcion: 'ASEO', veces: 0 }, { codigo: '461', descripcion: 'ASEO Y CAFETERIA', veces: 0 }] },
      { codigo: 'MNA', conceptos: [] },
    ]);
  });

  it('si la UEN ya tiene tarifas, solo ofrece los conceptos usados (no retenciones), del más usado al menos', () => {
    const conceptos = [
      { empresa: '01', undnegocio: 'BAQ', codcpto: '101', descrip: 'RETENCION SERVICIOS 1%', nombre: '' },
      { empresa: '01', undnegocio: 'BAQ', codcpto: '460', descrip: 'SERVICIO DE ASEO', nombre: '' },
      { empresa: '01', undnegocio: 'BAQ', codcpto: '461', descrip: 'SERVICIO DE CAFETERIA', nombre: '' },
      { empresa: '01', undnegocio: 'BOG', codcpto: '101', descrip: 'RETENCION SERVICIOS 1%', nombre: '' },
    ];
    const usos = [
      { undnegocio: 'BAQ', codservicio: '460', veces: 3 },
      { undnegocio: 'BAQ', codservicio: '461', veces: 9 },
      { undnegocio: 'BAQ', codservicio: '999', veces: 4 }, // ya no está en fc_conceptos
    ];
    const [baq, bog] = uensDeEmpresa('01', { contadores: [{ empresa: '01', undnegocio: 'BAQ' }, { empresa: '01', undnegocio: 'BOG' }], conceptos, usos });
    assert.deepEqual(baq.conceptos.map((c) => [c.codigo, c.veces]), [['461', 9], ['460', 3]]);
    assert.deepEqual(bog.conceptos.map((c) => c.codigo), ['101'], 'sin tarifas en la UEN se ofrecen todos');
  });

  it('leerDestino solo hace SELECT, con la empresa como parámetro', async () => {
    const sentencias = [];
    const conexion = {
      async query(sql, params) {
        sentencias.push({ sql, params });
        if (/FROM fc_empresas/.test(sql)) return [EMPRESAS];
        if (/FROM fc_control/.test(sql)) return [[{ empresa: '01', undnegocio: 'BAQ' }]];
        if (/FROM fc_contratos_tarifa_inicial/.test(sql)) return [[{ undnegocio: 'BAQ', codservicio: '460', veces: 2 }]];
        return [[{ empresa: '01', undnegocio: 'BAQ', codcpto: '460', descrip: 'ASEO', nombre: '' }]];
      },
    };
    const d = await leerDestino(conexion, 'ASEOCOLBA');
    assert.deepEqual(d, { empresa: { codigo: '01', rsocial: 'ASEOCOLBA S.A.' }, uens: [{ codigo: 'BAQ', conceptos: [{ codigo: '460', descripcion: 'ASEO', veces: 2 }] }] });
    assert.ok(sentencias.every((s) => /^SELECT /.test(s.sql)));
    assert.deepEqual(sentencias.slice(1).map((s) => s.params), [['01'], ['01'], ['01']]);
    const sin = await leerDestino(conexion, 'TRANSCOLBA');
    assert.deepEqual([sin.empresa, sin.error, sentencias.length], [null, 'SIN_EMPRESA', 5]);
  });
});
