import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cargarEsquemaEsperado, esquemaHastaModulo } from '../src/esquema.js';
import { MODULO_IMPLEMENTADO } from '../src/modulos.js';
import { sentenciasDePermisos } from '../src/permisos.js';

const esquema = cargarEsquemaEsperado();

describe('esquemaHastaModulo', () => {
  it('deja solo las tablas de los módulos ya implementados; las que no declaran módulo no se usan', () => {
    assert.deepEqual(Object.keys(esquemaHastaModulo(esquema, 4).tablas).sort(), ['fc_clientes', 'fc_conceptos', 'fc_contratos_tarifa_inicial', 'fc_control', 'fc_ofertas_adjudicadas']);
    assert.deepEqual(Object.keys(esquemaHastaModulo(esquema, 5).tablas).sort(), ['fc_clientes', 'fc_conceptos', 'fc_contratos_cargos_iniciales', 'fc_contratos_tarifa_inicial', 'fc_control', 'fc_horarios', 'fc_ofertas_adjudicadas']);
    const todas = Object.keys(esquemaHastaModulo(esquema, 99).tablas);
    assert.ok(todas.includes('fc_empresas'), 'la empresa de la oferta se busca por nombre en fc_empresas');
    assert.ok(!todas.includes('gl_undnegocios'));
    assert.equal(todas.length, Object.keys(esquema.tablas).length - 1);
  });

  it('el módulo 6 suma la lista de precios de la oferta a lo del 5 y lo del 4', () => {
    const hasta6 = Object.keys(esquemaHastaModulo(esquema, 6).tablas);
    assert.ok(hasta6.includes('fc_ofertas_adjudicadas') && hasta6.includes('fc_horarios') && hasta6.includes('fc_preciosventas_oferta'));
    assert.ok(!Object.keys(esquemaHastaModulo(esquema, 5).tablas).includes('fc_preciosventas_oferta'));
  });

  it('no modifica el contrato original', () => {
    const antes = Object.keys(esquema.tablas).length;
    esquemaHastaModulo(esquema, 4);
    assert.equal(Object.keys(esquema.tablas).length, antes);
  });
});

describe('sentenciasDePermisos', () => {
  it('módulo 4: la oferta adjudicada (leer e insertar), clientes y conceptos (solo las columnas que se consultan) y el contador', () => {
    assert.deepEqual(sentenciasDePermisos(esquema, { usuario: 'puente', base: 'almacen', hastaModulo: 4 }), [
      "GRANT SELECT, INSERT ON `almacen`.`fc_contratos_tarifa_inicial` TO 'puente'@'%';",
      "GRANT SELECT, INSERT ON `almacen`.`fc_ofertas_adjudicadas` TO 'puente'@'%';",
      "GRANT SELECT (undnegocio, nit, sucursal, rsocial) ON `almacen`.`fc_clientes` TO 'puente'@'%';",
      "GRANT SELECT (empresa, undnegocio, codcpto, descrip, nombre) ON `almacen`.`fc_conceptos` TO 'puente'@'%';",
      "GRANT SELECT (empresa, undnegocio, num_oferta), UPDATE (num_oferta) ON `almacen`.`fc_control` TO 'puente'@'%';",
    ]);
  });

  it('módulo implementado (7): tarifa, cargos, oferta adjudicada, lista de precios, insumos, costos administrativos, equipos, no continuos y valores agregados, clientes, conceptos, contador y horarios', () => {
    assert.equal(MODULO_IMPLEMENTADO, 7);
    const sentencias = sentenciasDePermisos(esquema, { usuario: 'puente', base: 'almacen', hastaModulo: MODULO_IMPLEMENTADO });
    assert.equal(sentencias.length, 22);
    assert.ok(sentencias.includes("GRANT SELECT (codigo, empresa, dbnomina) ON `almacen`.`gl_undnegocios` TO 'puente'@'%';"), 'qué nómina tiene cada UEN');
    for (const nomina of ['nominabq', 'nominamn', 'nominatmb', 'nominatmb2', 'nominatr']) {
      assert.ok(sentencias.includes(`GRANT SELECT ON \`${nomina}\`.\`cargos\` TO 'puente'@'%';`), `códigos de cargo de ${nomina}`);
    }
    for (const t of ['fc_contratos_equipos_iniciales', 'fc_contratos_no_continuos_iniciales', 'fc_contratos_vlrs_agregs_iniciales']) {
      assert.ok(sentencias.includes(`GRANT SELECT, INSERT ON \`almacen\`.\`${t}\` TO 'puente'@'%';`), t);
    }
    assert.ok(sentencias.includes("GRANT SELECT, INSERT ON `almacen`.`fc_contratos_costos_admtivos_iniciales` TO 'puente'@'%';"));
    assert.ok(sentencias.includes("GRANT SELECT, INSERT, DELETE ON `almacen`.`fc_elemxcont` TO 'puente'@'%';"));
    assert.ok(sentencias.includes("GRANT SELECT, INSERT ON `almacen`.`fc_contratos_cargos_iniciales` TO 'puente'@'%';"));
    assert.ok(sentencias.includes("GRANT SELECT, INSERT ON `almacen`.`fc_preciosventas_oferta` TO 'puente'@'%';"));
    assert.ok(sentencias.includes("GRANT SELECT (codigo) ON `almacen`.`fc_horarios` TO 'puente'@'%';"));
    assert.ok(sentencias.includes("GRANT SELECT (id, empresa_c, unidad_negocio_c, codtipo_c, codstipo_c, coddtipo) ON `almacen`.`act_subtipos` TO 'puente'@'%';"), 'el «Tipo» de cada equipo');
    assert.ok(sentencias.includes("GRANT SELECT (codigo, undnegocio, rsocial) ON `almacen`.`fc_empresas` TO 'puente'@'%';"), 'la empresa de la oferta, por su nombre');
  });

  it('nunca otorga DDL, ALL, GRANT OPTION ni nada global; fc_control solo el contador', () => {
    for (const modulo of [4, 5, 6, 7]) {
      for (const sentencia of sentenciasDePermisos(esquema, { usuario: 'puente', base: 'almacen', hastaModulo: modulo })) {
        assert.doesNotMatch(sentencia, /\b(ALL|DROP|ALTER|CREATE|INDEX|REFERENCES|GRANT OPTION|SUPER|FILE)\b|\*\.\*/i, sentencia);
        // Fuera de almacen, solo la tabla cargos de las bases de nómina y solo lectura.
        assert.match(sentencia, /^GRANT .+ ON `almacen`\.`\w+` TO 'puente'@'%';$|^GRANT SELECT ON `nomina\w+`\.`cargos` TO 'puente'@'%';$/);
      }
    }
    const control = sentenciasDePermisos(esquema, { usuario: 'puente', base: 'almacen', hastaModulo: 4 }).find((s) => s.includes('`fc_control`'));
    assert.ok(!control.includes('SELECT,') && !control.includes('SELECT ON'), 'nunca SELECT de toda la fila: trae usuario y clave de conexión');
  });

  it('nunca pide UPDATE de datos de la oferta (solo el contador de fc_control); DELETE solo en fc_elemxcont, para borrar lo propio si el envío falla', () => {
    const sentencias = sentenciasDePermisos(esquema, { usuario: 'puente', base: 'almacen', hastaModulo: 99 });
    assert.deepEqual(sentencias.filter((s) => /DELETE/.test(s)).map((s) => /`(\w+)` TO /.exec(s)[1]), ['fc_elemxcont']);
    assert.deepEqual(sentencias.filter((s) => /UPDATE/.test(s)).map((s) => /`(\w+)` TO /.exec(s)[1]), ['fc_control']);
  });

  it('rechaza identificadores con comillas, espacios o punto y coma (no se arma SQL con texto libre)', () => {
    for (const malo of ["puente'; DROP USER 'root", 'a b', 'x;y', '', 'a`b']) {
      assert.throws(() => sentenciasDePermisos(esquema, { usuario: malo, base: 'almacen', hastaModulo: 4 }), RangeError, malo);
      assert.throws(() => sentenciasDePermisos(esquema, { usuario: 'puente', base: malo, hastaModulo: 4 }), RangeError, malo);
      assert.throws(() => sentenciasDePermisos(esquema, { usuario: 'puente', base: 'almacen', host: malo, hastaModulo: 4 }), RangeError, malo);
    }
  });
});
