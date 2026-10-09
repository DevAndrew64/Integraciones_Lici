import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { cargarEsquemaEsperado, compararEsquema, crearEstadoBD, leerEsquemaReal, opcionesDeEscritura, serializarEsquema, verificarEsquema } from '../src/esquema.js';

const esperado = {
  version: 1,
  origen: 'prueba',
  tablas: {
    fc_demo: { motor: 'InnoDB', uso: 'escritura', columnas: { id: { tipo: 'int(18)', nulable: false }, rsocial: { tipo: 'varchar(100)', nulable: true } } },
  },
};
const realIgual = () => ({ fc_demo: { motor: 'InnoDB', columnas: { id: { tipo: 'int(18)', nulable: false }, rsocial: { tipo: 'varchar(100)', nulable: true }, extra: { tipo: 'text', nulable: true } } } });

/** Pool falso con la forma de mysql2/promise: query(sql, params) → [filas, campos]. */
function poolFalso(real, { falla = false } = {}) {
  const consultas = [];
  return {
    consultas,
    async query(sql, params) {
      consultas.push({ sql, params });
      if (falla) throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:3306'), { code: 'ECONNREFUSED' });
      if (sql.includes('information_schema.COLUMNS')) {
        const filas = Object.entries(real).flatMap(([tabla, t]) => Object.entries(t.columnas).map(([columna, c]) => ({ tabla, columna, tipo: c.tipo, nulable: c.nulable ? 'YES' : 'NO' })));
        return [filas, []];
      }
      return [Object.entries(real).map(([tabla, t]) => ({ tabla, motor: t.motor })), []];
    },
  };
}

describe('compararEsquema', () => {
  it('sin diferencias; las columnas de más en la base no son un problema', () => {
    assert.deepEqual(compararEsquema(esperado, realIgual()), []);
  });

  it('detecta tabla ausente, columna ausente, tipo más corto, nulabilidad y motor', () => {
    const real = realIgual();
    real.fc_demo.columnas.rsocial = { tipo: 'varchar(60)', nulable: true };
    delete real.fc_demo.columnas.id;
    assert.deepEqual(compararEsquema(esperado, real).map((p) => `${p.columna}: ${p.problema}`), ['id: La columna no existe.', 'rsocial: Tipo distinto: se esperaba varchar(100) y es varchar(60).']);
    assert.deepEqual(compararEsquema(esperado, {}), [{ tabla: 'fc_demo', problema: 'La tabla no existe.' }]);
    const otraNulabilidad = realIgual();
    otraNulabilidad.fc_demo.columnas.id.nulable = true;
    assert.match(compararEsquema(esperado, otraNulabilidad)[0].problema, /Nulabilidad distinta/);
    const otroMotor = realIgual();
    otroMotor.fc_demo.motor = 'MyISAM';
    assert.match(compararEsquema(esperado, otroMotor)[0].problema, /Motor distinto: se esperaba InnoDB y es MyISAM/);
  });

  it('no distingue mayúsculas en nombres ni en el texto del tipo', () => {
    const real = { FC_DEMO: { motor: 'innodb', columnas: { ID: { tipo: 'INT(18)', nulable: false }, RSocial: { tipo: 'varchar(100)', nulable: true } } } };
    assert.deepEqual(compararEsquema(esperado, real), []);
  });
});

describe('leerEsquemaReal / verificarEsquema', () => {
  it('lee information_schema de la base de la conexión con parámetros (sin armar SQL con datos)', async () => {
    const pool = poolFalso(realIgual());
    const real = await leerEsquemaReal(pool, ['fc_demo']);
    assert.deepEqual(real.fc_demo.columnas.id, { tipo: 'int(18)', nulable: false });
    assert.equal(real.fc_demo.motor, 'InnoDB');
    assert.ok(pool.consultas.every((c) => /TABLE_SCHEMA = DATABASE\(\)/.test(c.sql) && c.sql.includes('IN (?)') && Array.isArray(c.params[0])));
  });

  it('verificarEsquema devuelve ok o la lista de problemas', async () => {
    const bien = await verificarEsquema(poolFalso(realIgual()), esperado);
    assert.deepEqual([bien.ok, bien.problemas], [true, []]);
    assert.ok(bien.real.fc_demo, 'devuelve también la estructura leída');
    const real = realIgual();
    real.fc_demo.columnas.rsocial.tipo = 'varchar(50)';
    const r = await verificarEsquema(poolFalso(real), esperado);
    assert.equal(r.ok, false);
    assert.equal(r.problemas.length, 1);
  });
});

describe('compararEsquema — tablas de escritura', () => {
  const escritura = {
    version: 1, origen: 'prueba',
    tablas: { fc_ofertas_demo: { motor: null, uso: 'escritura', columnas: { id: { tipo: 'int(18)', nulable: false }, nit: { tipo: null, nulable: true } } } },
  };
  it('una columna conocida solo por nombre (tipo null) no se compara por tipo; sin motor no se compara el motor', () => {
    const real = { fc_ofertas_demo: { motor: 'InnoDB', columnas: { id: { tipo: 'int(18)', nulable: false }, nit: { tipo: 'varchar(77)', nulable: true } } } };
    assert.deepEqual(compararEsquema(escritura, real), []);
  });

  it('una columna obligatoria (NOT NULL sin valor por defecto) que el puente no llena detiene el servicio; el id no (lo pone el puente si no es auto_increment)', () => {
    const real = { fc_ofertas_demo: { motor: 'InnoDB', columnas: {
      id: { tipo: 'int(18)', nulable: false, obligatoria: true },
      nit: { tipo: 'varchar(20)', nulable: true },
      fecha: { tipo: 'datetime', nulable: false, obligatoria: true },
      nota: { tipo: 'text', nulable: true },
    } } };
    assert.deepEqual(compararEsquema(escritura, real).map((p) => p.columna).sort(), ['fecha']);
  });

  it('opcionesDeEscritura: id manual si no es auto_increment, y los largos reales de user_add y pc_add', () => {
    const tabla = (id) => ({ fc_ofertas_adjudicadas: { motor: 'InnoDB', columnas: { id, user_add: { tipo: 'varchar(12)', nulable: true }, pc_add: { tipo: 'char(40)', nulable: true } } } });
    assert.deepEqual(opcionesDeEscritura(tabla({ tipo: 'int(18)', nulable: false, autoIncremento: true })), { idManual: false, largoUserAdd: 12, largoPcAdd: 40 });
    assert.equal(opcionesDeEscritura(tabla({ tipo: 'int(18)', nulable: false, obligatoria: true })).idManual, true);
  });

  it('leerEsquemaReal marca obligatoria solo NOT NULL sin default y sin auto_increment', async () => {
    const pool = { async query(sql) {
      if (sql.includes('information_schema.COLUMNS')) {
        return [[
          { tabla: 't', columna: 'id', tipo: 'int(18)', nulable: 'NO', pordefecto: null, extra: 'auto_increment' },
          { tabla: 't', columna: 'f', tipo: 'datetime', nulable: 'NO', pordefecto: null, extra: '' },
          { tabla: 't', columna: 'g', tipo: 'int(1)', nulable: 'NO', pordefecto: '0', extra: '' },
        ], []];
      }
      return [[{ tabla: 't', motor: 'InnoDB' }], []];
    } };
    const real = await leerEsquemaReal(pool, ['t']);
    assert.deepEqual(Object.entries(real.t.columnas).filter(([, c]) => c.obligatoria).map(([n]) => n), ['f']);
  });
});

describe('crearEstadoBD (para /health)', () => {
  const sinRuido = async (fn) => {
    const log = console.error;
    console.error = () => {};
    try {
      return await fn();
    } finally {
      console.error = log;
    }
  };

  it('ok / esquema_distinto / sin_conexion, y nunca expone detalles', async () => {
    assert.deepEqual(await crearEstadoBD(poolFalso(realIgual()), esperado)(), { estado: 'ok' });
    const distinto = realIgual();
    delete distinto.fc_demo.columnas.rsocial;
    assert.deepEqual(await sinRuido(() => crearEstadoBD(poolFalso(distinto), esperado)()), { estado: 'esquema_distinto' });
    assert.deepEqual(await sinRuido(() => crearEstadoBD(poolFalso(realIgual(), { falla: true }), esperado)()), { estado: 'sin_conexion' });
  });

  it('consultas simultáneas comparten una sola verificación', async () => {
    const pool = poolFalso(realIgual());
    const estado = crearEstadoBD(pool, esperado, 60_000);
    const resultados = await Promise.all([estado(), estado(), estado(), estado()]);
    assert.ok(resultados.every((r) => r.estado === 'ok'));
    assert.equal(pool.consultas.length, 2);
  });

  it('recuerda el resultado durante el tiempo indicado (no recarga a MySQL en cada /health)', async () => {
    const pool = poolFalso(realIgual());
    const estado = crearEstadoBD(pool, esperado, 60_000);
    await estado();
    await estado();
    await estado();
    assert.equal(pool.consultas.length, 2, 'dos consultas (columnas y motores) en total, no seis');
  });
});

describe('esquema-esperado.json (copia de producción, solo estructura)', () => {
  const real = cargarEsquemaEsperado();

  it('cubre la tabla donde el puente escribe hoy, las de fases siguientes y las de consulta', () => {
    const escritura = Object.entries(real.tablas).filter(([, t]) => t.uso === 'escritura').map(([n]) => n).sort();
    assert.deepEqual(escritura, [
      'fc_contratos_costos_admtivos_iniciales',
      'fc_contratos_equipos_iniciales',
      'fc_contratos_no_continuos_iniciales',
      'fc_contratos_vlrs_agregs_iniciales',
      'fc_elemxcont',
      'fc_ofertas_adjudicadas',
      'fc_preciosventas_oferta',
    ]);
    assert.deepEqual(Object.entries(real.tablas).filter(([, t]) => t.uso === 'lectura').map(([n]) => n).sort(), ['fc_clientes', 'fc_conceptos', 'fc_empresas', 'fc_horarios', 'gl_undnegocios']);
    assert.ok(!real.tablas.fc_contratos_tarifa_inicial && !real.tablas.fc_contratos_cargos_iniciales, 'ya no se escriben: no se pueden usar en la base viva');
  });

  it('fc_ofertas_adjudicadas: las columnas leídas de la base viva que el puente llena; los largos no confirmados sin tipo', () => {
    const t = real.tablas.fc_ofertas_adjudicadas;
    assert.equal(t.modulo, 4);
    assert.deepEqual(Object.keys(t.columnas), ['id', 'empresa', 'undnegocio', 'num_oferta', 'nit', 'rsocial', 'vlr_adjudicado', 'vlr_manoobra', 'vlr_insumos', 'vlr_maquinaria', 'vlr_impuestos', 'vlr_otros', 'vlr_nocontinuos', 'user_add', 'fadd', 'pc_add']);
    assert.equal(t.columnas.rsocial.tipo, null);
    assert.equal(t.columnas.pc_add.tipo, null);
    assert.equal(t.columnas.vlr_otros.tipo, 'int(10)');
    assert.equal(real.tablas.fc_elemxcont.motor, 'MyISAM');
  });

  it('nunca incluye columnas de credenciales (las tablas de configuración guardan claves en texto plano)', () => {
    const nombres = Object.values(real.tablas).flatMap((t) => Object.keys(t.columnas));
    assert.deepEqual(nombres.filter((n) => /pass|clave|^user_cont|^server_|^usernomina|^servernomina/i.test(n)), []);
    // fc_control guarda usuario y clave de conexión: solo puede figurar con las tres columnas del contador de ofertas.
    assert.deepEqual(Object.keys(real.tablas.fc_control.columnas).sort(), ['empresa', 'num_oferta', 'undnegocio']);
  });

  it('el archivo está en el formato canónico (una columna por línea), así el comando de actualizar no mete ruido', () => {
    // Git en Windows (autocrlf) entrega el archivo con CRLF: el formato canónico se compara con saltos de línea LF.
    const texto = readFileSync(new URL('../src/esquema-esperado.json', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
    assert.equal(serializarEsquema(real), texto);
  });
});
