import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BASES_DE_NOMINA, elegirNomina, NOMINAS_DE_EMPRESA, vistaDeNomina } from '../src/nomina.js';
import { codigosDeNomina } from '../src/oferta.js';

const TMB = [
  { empresa: '', undnegocio: '', codigo: 3, nombre: 'JEFE DE FACTURACION' },
  { empresa: '', undnegocio: '', codigo: 41, nombre: 'AUXILIAR DE CARTERA' },
  { empresa: '', undnegocio: '', codigo: 43, nombre: 'SERVICIOS GENERALES' },
  { empresa: '', undnegocio: '', codigo: 43, nombre: 'SERVICIOS GENERALES' },
];
const TMB2 = [
  { empresa: '', undnegocio: '', codigo: 7, nombre: 'JEFE FACTURACION Y CARTERA' },
  { empresa: '', undnegocio: '', codigo: 9, nombre: 'AUXILIAR DE CARTERA' },
];
const ctx = { empresa: '02', undnegocio: 'BAQ' };

/** Conexión falsa: responde según el SQL (gl_undnegocios, information_schema y `<base>`.cargos). */
function conexion(bases, unidades = []) {
  const consultas = [];
  return {
    consultas,
    async query(sql, params) {
      consultas.push({ sql, params });
      if (/FROM gl_undnegocios/.test(sql)) return [unidades];
      if (/information_schema/.test(sql)) return [params[0].filter((b) => b in bases).map((base) => ({ base }))];
      const base = /FROM `(\w+)`\.cargos/.exec(sql)?.[1];
      if (base in bases) return [bases[base]];
      throw Object.assign(new Error('no existe'), { errno: 1146 });
    },
  };
}

describe('cargo de nómina elegido en la pantalla (codigoNomina)', () => {
  it('si existe en la base se usa tal cual, sin cruzar por nombre ni avisar', () => {
    const r = codigosDeNomina([{ nombre: 'Jefe facturación y cartera', codigoNomina: 3 }, { nombre: 'Servicio general' }], TMB, { ...ctx, base: 'nominatmb' });
    assert.deepEqual(r.codigos, [3, 43]);
    assert.deepEqual(r.errores, []);
    assert.ok(!r.advertencias.some((a) => a.campo === 'cargos[0].nombre'));
  });

  it('si no existe en la base es un error de esa línea (nunca se escribe un código que Contratos no encuentra)', () => {
    const r = codigosDeNomina([{ nombre: 'Jefe facturación y cartera', codigoNomina: 999 }], TMB, { ...ctx, base: 'nominatmb' });
    assert.deepEqual(r.codigos, [null]);
    assert.equal(r.errores[0].campo, 'cargos[0].codigoNomina');
    assert.match(r.errores[0].mensaje, /código de nómina 999 .* no está en nominatmb\.cargos/);
  });

  it('el error de un cargo que falta dice que se puede elegir en «Enviar a Contratos»', () => {
    const r = codigosDeNomina([{ nombre: 'Coordinador de bienestar' }], TMB, { ...ctx, base: 'nominatmb' });
    assert.match(r.errores[0].mensaje, /Elija en «Enviar a Contratos» el cargo de nómina/);
  });
});

describe('elegirNomina', () => {
  const bases = [{ base: 'nominatmb', filas: TMB }, { base: 'nominatmb2', filas: TMB2 }];
  const cargos = [{ nombre: 'Jefe facturación y cartera' }, { nombre: 'Auxiliar de cartera' }];

  it('sin base pedida: la primera donde están todos los cargos, y avisa cuál', () => {
    const r = elegirNomina(cargos, bases, ctx);
    assert.equal(r.base, 'nominatmb2');
    assert.deepEqual(r.codigos, [7, 9]);
    assert.ok(r.advertencias.some((a) => /se tomaron de nominatmb2/.test(a.mensaje)));
  });

  it('con la base que eligió la pantalla: esa, aunque otra tenga más cargos', () => {
    const r = elegirNomina([{ nombre: 'Jefe facturación y cartera', codigoNomina: 3 }, cargos[1]], bases, ctx, 'NOMINATMB');
    assert.equal(r.base, 'nominatmb');
    assert.deepEqual(r.codigos, [3, 41]);
    assert.deepEqual(r.errores, []);
  });

  it('una base pedida que no es de la UEN es un error, no se cambia de base en silencio', () => {
    const r = elegirNomina(cargos, bases, ctx, 'nominabq');
    assert.deepEqual(r.codigos, [null, null]);
    assert.equal(r.errores[0].campo, 'oferta.baseNomina');
  });

  it('si ninguna base tiene todos, los errores son los de la que tiene más', () => {
    const r = elegirNomina([{ nombre: 'Auxiliar de cartera' }, { nombre: 'Servicios generales' }, { nombre: 'Gerente' }], bases, ctx);
    assert.equal(r.base, 'nominatmb');
    assert.deepEqual(r.codigos, [41, 43, null]);
    assert.equal(r.errores.length, 1);
  });
});

describe('vistaDeNomina', () => {
  it('Tempocolba: dice qué toma cada línea, con los parecidos de la que falta, y da el catálogo de la base sin repetidos', async () => {
    const c = conexion({ nominatmb: TMB, nominatmb2: TMB2 });
    const v = await vistaDeNomina(c, { ...ctx, cargos: [{ nombre: 'Servicio General' }, { nombre: 'Jefe de cartera' }, { nombre: 'Auxiliar de cartera', codigoNomina: 41 }] });
    assert.equal(v.ok, true);
    assert.equal(v.base, 'nominatmb');
    assert.deepEqual(v.bases, ['nominatmb', 'nominatmb2']);
    assert.deepEqual(v.cargos.map((x) => [x.estado, x.codigo]), [['palabras', 43], ['falta', null], ['elegido', 41]]);
    assert.ok(v.cargos[1].parecidos.length > 0);
    assert.deepEqual(v.catalogo.map((f) => f.codigo), [41, 3, 43], 'ordenado por nombre, cada código una vez');
    assert.ok(!c.consultas.some((q) => /gl_undnegocios/.test(q.sql)), 'Tempocolba no usa gl_undnegocios');
  });

  it('con la base elegida, la vista es de esa base', async () => {
    const v = await vistaDeNomina(conexion({ nominatmb: TMB, nominatmb2: TMB2 }), { ...ctx, cargos: [{ nombre: 'Auxiliar de cartera' }], baseNomina: 'nominatmb2' });
    assert.equal(v.base, 'nominatmb2');
    assert.deepEqual(v.cargos[0].codigo, 9);
  });

  it('sin base de nómina para la UEN: el mensaje para avisar a Contratos', async () => {
    const v = await vistaDeNomina(conexion({}, [{ empresa: '01', dbnomina: '' }]), { empresa: '01', undnegocio: 'XXX', cargos: [{ nombre: 'Aseador' }] });
    assert.equal(v.ok, false);
    assert.match(v.mensaje, /no tiene una base de nómina para la empresa 01 y la UEN XXX/);
  });

  it('las bases fijas de Tempocolba y Transcolba están entre las que tienen permiso de lectura', () => {
    for (const b of Object.values(NOMINAS_DE_EMPRESA).flat()) assert.ok(BASES_DE_NOMINA.includes(b), b);
  });
});
