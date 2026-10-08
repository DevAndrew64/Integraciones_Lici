import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cargarEsquemaEsperado, esquemaHastaModulo } from '../src/esquema.js';
import { MODULO_IMPLEMENTADO } from '../src/modulos.js';
import { sentenciasDePermisos } from '../src/permisos.js';

const esquema = cargarEsquemaEsperado();

describe('esquemaHastaModulo', () => {
  it('deja solo las tablas de los módulos ya implementados; las que no declaran módulo no se usan', () => {
    assert.deepEqual(Object.keys(esquemaHastaModulo(esquema, 4).tablas).sort(), ['fc_clientes', 'fc_conceptos', 'fc_contratos_tarifa_inicial', 'fc_control']);
    assert.deepEqual(Object.keys(esquemaHastaModulo(esquema, 5).tablas).sort(), ['fc_clientes', 'fc_conceptos', 'fc_contratos_cargos_iniciales', 'fc_contratos_tarifa_inicial', 'fc_control', 'fc_horarios']);
    const todas = Object.keys(esquemaHastaModulo(esquema, 99).tablas);
    assert.ok(!todas.includes('fc_empresas') && !todas.includes('gl_undnegocios'));
    assert.equal(todas.length, Object.keys(esquema.tablas).length - 2);
  });

  it('el módulo 6 suma lo del 5 y lo del 4', () => {
    const hasta6 = Object.keys(esquemaHastaModulo(esquema, 6).tablas);
    assert.ok(hasta6.includes('fc_contratos_tarifa_inicial') && hasta6.includes('fc_contratos_cargos_iniciales') && hasta6.includes('fc_elemxcont'));
    assert.ok(!hasta6.includes('fc_contratos_no_continuos_iniciales'));
  });

  it('no modifica el contrato original', () => {
    const antes = Object.keys(esquema.tablas).length;
    esquemaHastaModulo(esquema, 4);
    assert.equal(Object.keys(esquema.tablas).length, antes);
  });
});

describe('sentenciasDePermisos', () => {
  it('módulo 4: tarifa (leer e insertar), clientes y conceptos (solo las columnas que se consultan) y el contador', () => {
    assert.deepEqual(sentenciasDePermisos(esquema, { usuario: 'puente', base: 'almacen', hastaModulo: 4 }), [
      "GRANT SELECT, INSERT ON `almacen`.`fc_contratos_tarifa_inicial` TO 'puente'@'%';",
      "GRANT SELECT (undnegocio, nit, sucursal, rsocial) ON `almacen`.`fc_clientes` TO 'puente'@'%';",
      "GRANT SELECT (empresa, undnegocio, codcpto) ON `almacen`.`fc_conceptos` TO 'puente'@'%';",
      "GRANT SELECT (empresa, undnegocio, num_oferta), UPDATE (num_oferta) ON `almacen`.`fc_control` TO 'puente'@'%';",
    ]);
  });

  it('módulo implementado (5): suma los cargos —solo INSERT, el puente no los lee— y los horarios (solo el código)', () => {
    assert.equal(MODULO_IMPLEMENTADO, 5);
    const sentencias = sentenciasDePermisos(esquema, { usuario: 'puente', base: 'almacen', hastaModulo: MODULO_IMPLEMENTADO });
    assert.equal(sentencias.length, 6);
    assert.ok(sentencias.includes("GRANT INSERT ON `almacen`.`fc_contratos_cargos_iniciales` TO 'puente'@'%';"));
    assert.ok(sentencias.includes("GRANT SELECT (codigo) ON `almacen`.`fc_horarios` TO 'puente'@'%';"));
  });

  it('nunca otorga DDL, ALL, GRANT OPTION ni nada global; fc_control solo el contador', () => {
    for (const modulo of [4, 5, 6, 7]) {
      for (const sentencia of sentenciasDePermisos(esquema, { usuario: 'puente', base: 'almacen', hastaModulo: modulo })) {
        assert.doesNotMatch(sentencia, /\b(ALL|DROP|ALTER|CREATE|INDEX|REFERENCES|GRANT OPTION|SUPER|FILE)\b|\*\.\*/i, sentencia);
        assert.match(sentencia, /^GRANT .+ ON `almacen`\.`\w+` TO 'puente'@'%';$/);
      }
    }
    const control = sentenciasDePermisos(esquema, { usuario: 'puente', base: 'almacen', hastaModulo: 4 }).find((s) => s.includes('`fc_control`'));
    assert.ok(!control.includes('SELECT,') && !control.includes('SELECT ON'), 'nunca SELECT de toda la fila: trae usuario y clave de conexión');
  });

  it('DELETE solo donde hay que compensar una tabla sin transacciones (fc_elemxcont, módulo 6)', () => {
    const con = (modulo) => sentenciasDePermisos(esquema, { usuario: 'puente', base: 'almacen', hastaModulo: modulo }).filter((s) => /DELETE/.test(s));
    assert.deepEqual(con(5), []);
    assert.equal(con(6).length, 1);
    assert.match(con(6)[0], /`fc_elemxcont`/);
  });

  it('rechaza identificadores con comillas, espacios o punto y coma (no se arma SQL con texto libre)', () => {
    for (const malo of ["puente'; DROP USER 'root", 'a b', 'x;y', '', 'a`b']) {
      assert.throws(() => sentenciasDePermisos(esquema, { usuario: malo, base: 'almacen', hastaModulo: 4 }), RangeError, malo);
      assert.throws(() => sentenciasDePermisos(esquema, { usuario: 'puente', base: malo, hastaModulo: 4 }), RangeError, malo);
      assert.throws(() => sentenciasDePermisos(esquema, { usuario: 'puente', base: 'almacen', host: malo, hastaModulo: 4 }), RangeError, malo);
    }
  });
});
