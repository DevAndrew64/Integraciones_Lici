/**
 * Pruebas contra un MySQL 5.5 REAL (no un simulacro): la base de prueba de test/mysql/docker-compose.yml.
 * Se saltan solas si no hay base de prueba configurada (PUENTE_TEST_MYSQL_HOST); ver `npm run test:mysql`.
 *
 * Estas pruebas INSERTAN y BORRAN filas: solo corren contra una base cuyo nombre termina en «_prueba» o «_test».
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import { cargarEsquemaEsperado, verificarEsquema } from '../src/esquema.js';
import { crearPool, SQL_MODE_ESTRICTO } from '../src/mysql.js';

const env = process.env;
const saltar = env.PUENTE_TEST_MYSQL_HOST ? false : 'sin base de prueba: defina PUENTE_TEST_MYSQL_HOST (npm run test:mysql)';
const config = {
  host: env.PUENTE_TEST_MYSQL_HOST,
  port: Number(env.PUENTE_TEST_MYSQL_PORT || 3306),
  user: env.PUENTE_TEST_MYSQL_USER,
  password: env.PUENTE_TEST_MYSQL_PASSWORD,
  database: env.PUENTE_TEST_MYSQL_DATABASE,
};
if (!saltar && !/_(prueba|test)$/.test(String(config.database))) {
  throw new Error(`Por seguridad estas pruebas solo corren contra una base de prueba (nombre terminado en _prueba o _test), no contra «${config.database}».`);
}


const TOKEN = 'token-de-prueba-integracion-0123456789';

/** Arranca `src/server.js` como proceso aparte contra la base de prueba. Resuelve al iniciar o al salir (p. ej. por esquema distinto). */
function arrancarServicio(puerto, extra = {}) {
  const hijo = spawn(process.execPath, ['src/server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...env,
      PUENTE_TOKEN: TOKEN,
      PUENTE_PORT: String(puerto),
      PUENTE_MYSQL_HOST: config.host,
      PUENTE_MYSQL_PORT: String(config.port),
      PUENTE_MYSQL_USER: config.user,
      PUENTE_MYSQL_PASSWORD: config.password,
      PUENTE_MYSQL_DATABASE: config.database,
      ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolver) => {
    let salida = '';
    const alRecibir = (d) => {
      salida += d;
      if (salida.includes('puente-contratos-iniciado')) resolver({ iniciado: true, hijo, salida });
    };
    hijo.stdout.on('data', alRecibir);
    hijo.stderr.on('data', (d) => (salida += d));
    hijo.on('exit', (codigo) => resolver({ iniciado: false, codigo, salida }));
  });
}
const consultarSalud = async (puerto) => (await fetch(`http://127.0.0.1:${puerto}/health`)).json();

const TARIFA = 'fc_contratos_tarifa_inicial';
const CLIENTE_LARGO = 'C'.repeat(101); // rsocial es varchar(100)

describe('MySQL 5.5 real', { skip: saltar }, () => {
  let pool;
  before(async () => {
    pool = crearPool(config);
    await pool.query(`DELETE FROM ${TARIFA}`);
    await pool.query('DELETE FROM fc_elemxcont');
  });
  after(async () => {
    await pool.query(`DELETE FROM ${TARIFA}`);
    await pool.query('DELETE FROM fc_elemxcont');
    await pool.end();
  });

  it('es un MySQL 5.5 y cada conexión del puente queda en modo estricto y como utf8', async () => {
    const [[fila]] = await pool.query('SELECT @@version AS version, @@session.sql_mode AS modo, @@session.character_set_client AS cliente, @@session.character_set_results AS resultados, @@global.sql_mode AS modo_global');
    assert.match(fila.version, /^5\.5\./);
    assert.equal(fila.modo, SQL_MODE_ESTRICTO);
    assert.match(fila.cliente, /^utf8/);
    assert.match(fila.resultados, /^utf8/);
    assert.equal(fila.modo_global, '', 'el servidor de Contratos trae el modo laxo: el puente no depende de él');
  });

  it('el esquema esperado (sacado del DDL de producción) coincide con lo que information_schema reporta en 5.5', async () => {
    const r = await verificarEsquema(pool, cargarEsquemaEsperado());
    assert.deepEqual(r.problemas, []);
    assert.equal(r.ok, true);
  });

  it('npm run esquema:actualizar ve lo mismo y no encuentra diferencias', () => {
    const r = spawnSync(process.execPath, ['src/herramientas/exportar-esquema.js'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      env: { ...env, PUENTE_MYSQL_HOST: config.host, PUENTE_MYSQL_PORT: String(config.port), PUENTE_MYSQL_USER: config.user, PUENTE_MYSQL_PASSWORD: config.password, PUENTE_MYSQL_DATABASE: config.database },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /coincide con el esperado/);
  });

  it('modo estricto: un texto que no cabe es un ERROR y no queda ninguna fila (el servidor laxo lo cortaría en silencio)', async () => {
    await assert.rejects(
      pool.query(`INSERT INTO ${TARIFA} (empresa, undnegocio, num_oferta, nit, rsocial) VALUES ('01', 'BAQ', 900001, '900123456-8', ?)`, [CLIENTE_LARGO]),
      (e) => e.errno === 1406, // ER_DATA_TOO_LONG
    );
    const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM ${TARIFA} WHERE num_oferta = 900001`);
    assert.equal(Number(n), 0);

    // Lo que haría el servidor tal como lo tiene Contratos (sin modo estricto): cortar el texto sin avisar.
    const conexion = await pool.getConnection();
    try {
      await conexion.query("SET SESSION sql_mode = ''");
      await conexion.query(`INSERT INTO ${TARIFA} (empresa, undnegocio, num_oferta, nit, rsocial) VALUES ('01', 'BAQ', 900002, '900123456-8', ?)`, [CLIENTE_LARGO]);
      const [[{ largo }]] = await conexion.query(`SELECT CHAR_LENGTH(rsocial) AS largo FROM ${TARIFA} WHERE num_oferta = 900002`);
      assert.equal(Number(largo), 100, 'sin modo estricto MySQL corta el texto a 100 caracteres sin ningún aviso');
    } finally {
      conexion.destroy(); // esta conexión quedó en modo laxo: no vuelve al pool
    }
  });

  it('latin1: la «ñ», las comillas tipográficas, el guion largo y el euro caben; un emoji o «≥» no se guardan', async () => {
    const bueno = 'Ñandú “Premium” – € S.A.';
    await pool.query(`INSERT INTO ${TARIFA} (empresa, undnegocio, num_oferta, nit, rsocial) VALUES ('01', 'BAQ', 900003, '900123456-8', ?)`, [bueno]);
    const [[fila]] = await pool.query(`SELECT rsocial, HEX(CONVERT(rsocial USING latin1)) AS bytes FROM ${TARIFA} WHERE num_oferta = 900003`);
    assert.equal(fila.rsocial, bueno, 'ida y vuelta sin pérdida');
    // «Ñandú “Premium” – € S.A.» en cp1252, byte a byte: Ñ D1 · ú FA · “ 93 · ” 94 · – 96 · € 80 (igual que lo escribe Visual FoxPro)
    assert.equal(fila.bytes, 'D1616E64FA20935072656D69756D942096208020532E412E');

    for (const malo of ['Cliente 😀', 'Mayor ≥ 8', 'Flecha →']) {
      await assert.rejects(pool.query(`INSERT INTO ${TARIFA} (empresa, undnegocio, num_oferta, nit, rsocial) VALUES ('01', 'BAQ', 900004, '900123456-8', ?)`, [malo]), (e) => e.errno === 1366 || e.errno === 1300, malo);
    }
    const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM ${TARIFA} WHERE num_oferta = 900004`);
    assert.equal(Number(n), 0);
  });

  it('los DECIMAL y las fechas llegan como texto exacto (sin coma flotante ni zona horaria)', async () => {
    await pool.query(`INSERT INTO ${TARIFA} (empresa, undnegocio, num_oferta, nit, aiu, tarifa) VALUES ('01', 'BAQ', 900005, '900123456-8', '0.0835000000', 61155746)`);
    const [[fila]] = await pool.query(`SELECT aiu, tarifa, fadd, fmod FROM ${TARIFA} WHERE num_oferta = 900005`);
    assert.strictEqual(fila.aiu, '0.0835000000');
    assert.strictEqual(fila.tarifa, '61155746');
    assert.strictEqual(fila.fadd, '0000-00-00 00:00:00', 'el valor por defecto de la tabla (fecha en ceros) llega como texto, sin convertirse en «Invalid Date»');
  });

  it('InnoDB se revierte (todo o nada); MyISAM (fc_elemxcont) NO: por eso lo suyo se compensa borrando lo propio', async () => {
    const conexion = await pool.getConnection();
    try {
      await conexion.beginTransaction();
      await conexion.query(`INSERT INTO ${TARIFA} (empresa, undnegocio, num_oferta, nit) VALUES ('01', 'BAQ', 900006, '900123456-8')`);
      await conexion.query("INSERT INTO fc_elemxcont (empresa, undnegocio, num_oferta, codele) VALUES ('01', 'BAQ', 900006, 'PRUEBA')");
      await conexion.rollback();
    } finally {
      conexion.release();
    }
    const [[{ innodb }]] = await pool.query(`SELECT COUNT(*) AS innodb FROM ${TARIFA} WHERE num_oferta = 900006`);
    const [[{ myisam }]] = await pool.query('SELECT COUNT(*) AS myisam FROM fc_elemxcont WHERE num_oferta = 900006');
    assert.equal(Number(innodb), 0, 'InnoDB: el ROLLBACK deshizo la fila');
    assert.equal(Number(myisam), 1, 'MyISAM: el ROLLBACK no deshace nada');
  });

  it('el servicio en modo «escritura» arranca con el esquema esperado y /health dice bd: ok', async () => {
    const r = await arrancarServicio(4021, { PUENTE_MODO: 'escritura' });
    try {
      assert.equal(r.iniciado, true, r.salida);
      assert.deepEqual(await consultarSalud(4021), { ok: true, servicio: 'puente-contratos', modo: 'escritura', bd: 'ok' });
    } finally {
      r.hijo?.kill();
    }
  });

  it('si Contratos cambia una columna, el modo «escritura» NO arranca y en modo prueba /health avisa «esquema_distinto»', async () => {
    // fc_preciosventas_oferta.nom_punto: varchar(60) → varchar(50), como si Contratos la hubiera acortado
    await pool.query('ALTER TABLE fc_preciosventas_oferta MODIFY nom_punto varchar(50) DEFAULT ""');
    try {
      const escritura = await arrancarServicio(4022, { PUENTE_MODO: 'escritura' });
      assert.equal(escritura.iniciado, false, 'no debe arrancar');
      assert.equal(escritura.codigo, 1);
      assert.match(escritura.salida, /esquema-distinto/);
      assert.match(escritura.salida, /nom_punto/, 'dice qué columna cambió');
      assert.doesNotMatch(escritura.salida, new RegExp(config.password), 'nunca imprime la clave');

      const prueba = await arrancarServicio(4023, { PUENTE_MODO: 'dry-run' });
      try {
        assert.equal(prueba.iniciado, true, prueba.salida);
        assert.equal((await consultarSalud(4023)).bd, 'esquema_distinto');
      } finally {
        prueba.hijo?.kill();
      }
    } finally {
      await pool.query('ALTER TABLE fc_preciosventas_oferta MODIFY nom_punto varchar(60) DEFAULT ""');
    }
    assert.equal((await verificarEsquema(pool, cargarEsquemaEsperado())).ok, true, 'la base de prueba quedó como estaba');
  });
});
