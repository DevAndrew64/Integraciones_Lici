import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { cargarEsquemaEsperado, compararEsquema, crearEstadoBD, leerEsquemaReal, serializarEsquema, verificarEsquema } from '../src/esquema.js';

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
    assert.deepEqual(await verificarEsquema(poolFalso(realIgual()), esperado), { ok: true, problemas: [] });
    const real = realIgual();
    real.fc_demo.columnas.rsocial.tipo = 'varchar(50)';
    const r = await verificarEsquema(poolFalso(real), esperado);
    assert.equal(r.ok, false);
    assert.equal(r.problemas.length, 1);
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

  it('cubre las ocho tablas donde el puente escribirá y las de consulta', () => {
    const escritura = Object.entries(real.tablas).filter(([, t]) => t.uso === 'escritura').map(([n]) => n).sort();
    assert.deepEqual(escritura, [
      'fc_contratos_cargos_iniciales',
      'fc_contratos_costos_admtivos_iniciales',
      'fc_contratos_equipos_iniciales',
      'fc_contratos_no_continuos_iniciales',
      'fc_contratos_tarifa_inicial',
      'fc_contratos_vlrs_agregs_iniciales',
      'fc_elemxcont',
      'fc_preciosventas_oferta',
    ]);
    assert.deepEqual(Object.entries(real.tablas).filter(([, t]) => t.uso === 'lectura').map(([n]) => n).sort(), ['fc_clientes', 'fc_conceptos', 'fc_empresas', 'fc_horarios', 'gl_undnegocios']);
  });

  it('la clave de la oferta y los largos que importan están donde se esperan', () => {
    const t = real.tablas.fc_contratos_tarifa_inicial.columnas;
    assert.equal(t.rsocial.tipo, 'varchar(100)');
    assert.equal(t.nit.tipo, 'varchar(20)');
    assert.equal(t.aiu.tipo, 'decimal(13,10)');
    assert.equal(t.num_oferta.tipo, 'decimal(10,0)');
    assert.equal(t.origen_proceso.tipo, 'varchar(3)');
    assert.equal(real.tablas.fc_contratos_no_continuos_iniciales.columnas.rhumano.tipo, 'char(254)');
  });

  it('las tablas de oferta con hijas transaccionales son InnoDB; fc_elemxcont es MyISAM (sin transacción)', () => {
    assert.equal(real.tablas.fc_contratos_tarifa_inicial.motor, 'InnoDB');
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
