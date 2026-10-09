/**
 * Pruebas contra un MySQL 5.5 REAL (no un simulacro): la base de prueba de test/mysql/docker-compose.yml.
 * Se saltan solas si no hay base de prueba configurada (PUENTE_TEST_MYSQL_HOST); ver `npm run test:mysql`.
 *
 * Estas pruebas INSERTAN y BORRAN filas: solo corren contra una base cuyo nombre termina en «_prueba» o «_test».
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { ErrorNegocio } from '../src/errores.js';
import { crearEscritorMySQL } from '../src/escritor-mysql.js';
import { cargarEsquemaEsperado, esquemaHastaModulo, opcionesDeEscritura, verificarEsquema } from '../src/esquema.js';
import { MODULO_IMPLEMENTADO } from '../src/modulos.js';
import { crearPool, SQL_MODE_ESTRICTO } from '../src/mysql.js';
import { sentenciasDePermisos } from '../src/permisos.js';
import { huella, validarContrato } from '../src/validar.js';

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

const OFERTAS = 'fc_ofertas_adjudicadas';
const PRECIOS = 'fc_preciosventas_oferta';
const CLIENTE_LARGO = 'C'.repeat(101); // rsocial es varchar(100) en la base de prueba

describe('MySQL 5.5 real', { skip: saltar }, () => {
  let pool;
  before(async () => {
    pool = crearPool(config);
    await pool.query(`DELETE FROM ${OFERTAS}`);
    await pool.query(`DELETE FROM ${PRECIOS}`);
    await pool.query('DELETE FROM fc_elemxcont');
  });
  after(async () => {
    await pool.query(`DELETE FROM ${OFERTAS}`);
    await pool.query(`DELETE FROM ${PRECIOS}`);
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

  it('el esquema esperado coincide con lo que information_schema reporta en 5.5', async () => {
    const r = await verificarEsquema(pool, cargarEsquemaEsperado());
    assert.deepEqual(r.problemas, []);
    assert.equal(r.ok, true);
    assert.deepEqual(opcionesDeEscritura(r.real), { idManual: false, largoUserAdd: 12, largoPcAdd: 60 }, 'lee de la base si el id es auto_increment y los largos reales');
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
      pool.query(`INSERT INTO ${OFERTAS} (empresa, undnegocio, num_oferta, nit, rsocial) VALUES ('01', 'BAQ', 900001, '900123456-8', ?)`, [CLIENTE_LARGO]),
      (e) => e.errno === 1406, // ER_DATA_TOO_LONG
    );
    const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM ${OFERTAS} WHERE num_oferta = 900001`);
    assert.equal(Number(n), 0);

    // Lo que haría el servidor tal como lo tiene Contratos (sin modo estricto): cortar el texto sin avisar.
    const conexion = await pool.getConnection();
    try {
      await conexion.query("SET SESSION sql_mode = ''");
      await conexion.query(`INSERT INTO ${OFERTAS} (empresa, undnegocio, num_oferta, nit, rsocial) VALUES ('01', 'BAQ', 900002, '900123456-8', ?)`, [CLIENTE_LARGO]);
      const [[{ largo }]] = await conexion.query(`SELECT CHAR_LENGTH(rsocial) AS largo FROM ${OFERTAS} WHERE num_oferta = 900002`);
      assert.equal(Number(largo), 100, 'sin modo estricto MySQL corta el texto a 100 caracteres sin ningún aviso');
    } finally {
      conexion.destroy(); // esta conexión quedó en modo laxo: no vuelve al pool
    }
  });

  it('modo estricto: un valor que no cabe en una columna int (máx. 2.147.483.647 aunque diga int(18)) es un ERROR', async () => {
    await assert.rejects(pool.query(`INSERT INTO ${OFERTAS} (empresa, undnegocio, num_oferta, vlr_adjudicado) VALUES ('01', 'BAQ', 900007, 2147483648)`), (e) => e.errno === 1264);
  });

  it('latin1: la «ñ», las comillas tipográficas, el guion largo y el euro caben; un emoji o «≥» no se guardan', async () => {
    const bueno = 'Ñandú “Premium” – € S.A.';
    await pool.query(`INSERT INTO ${OFERTAS} (empresa, undnegocio, num_oferta, nit, rsocial) VALUES ('01', 'BAQ', 900003, '900123456-8', ?)`, [bueno]);
    const [[fila]] = await pool.query(`SELECT rsocial, HEX(CONVERT(rsocial USING latin1)) AS bytes FROM ${OFERTAS} WHERE num_oferta = 900003`);
    assert.equal(fila.rsocial, bueno, 'ida y vuelta sin pérdida');
    // «Ñandú “Premium” – € S.A.» en cp1252, byte a byte: Ñ D1 · ú FA · “ 93 · ” 94 · – 96 · € 80 (igual que lo escribe Visual FoxPro)
    assert.equal(fila.bytes, 'D1616E64FA20935072656D69756D942096208020532E412E');

    for (const malo of ['Cliente 😀', 'Mayor ≥ 8', 'Flecha →']) {
      await assert.rejects(pool.query(`INSERT INTO ${OFERTAS} (empresa, undnegocio, num_oferta, nit, rsocial) VALUES ('01', 'BAQ', 900004, '900123456-8', ?)`, [malo]), (e) => e.errno === 1366 || e.errno === 1300, malo);
    }
    const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM ${OFERTAS} WHERE num_oferta = 900004`);
    assert.equal(Number(n), 0);
  });

  it('los DECIMAL y las fechas llegan como texto exacto (sin coma flotante ni zona horaria)', async () => {
    await pool.query(`INSERT INTO ${PRECIOS} (undnegocio, num_oferta, codigo, valor, aiu, vr_costo) VALUES ('BAQ', 900005, '18111', '11232.0000', '0.1232', '10000.1234')`);
    const [[fila]] = await pool.query(`SELECT valor, aiu, vr_costo, fadd FROM ${PRECIOS} WHERE num_oferta = 900005`);
    assert.deepEqual([fila.valor, fila.aiu, fila.vr_costo], ['11232.0000', '0.1232', '10000.1234']);
    assert.strictEqual(fila.fadd, '0000-00-00 00:00:00', 'el valor por defecto de la tabla (fecha en ceros) llega como texto, sin convertirse en «Invalid Date»');
  });

  it('InnoDB se revierte (todo o nada): la oferta y su lista de precios se deshacen juntas', async () => {
    const conexion = await pool.getConnection();
    try {
      await conexion.beginTransaction();
      await conexion.query(`INSERT INTO ${OFERTAS} (empresa, undnegocio, num_oferta, nit) VALUES ('01', 'BAQ', 900006, '900123456-8')`);
      await conexion.query(`INSERT INTO ${PRECIOS} (undnegocio, num_oferta, codigo) VALUES ('BAQ', 900006, '18111')`);
      await conexion.query("INSERT INTO fc_elemxcont (empresa, undnegocio, num_oferta, codele) VALUES ('01', 'BAQ', 900006, 'PRUEBA')");
      await conexion.rollback();
    } finally {
      conexion.release();
    }
    const [[{ ofertas }]] = await pool.query(`SELECT COUNT(*) AS ofertas FROM ${OFERTAS} WHERE num_oferta = 900006`);
    const [[{ precios }]] = await pool.query(`SELECT COUNT(*) AS precios FROM ${PRECIOS} WHERE num_oferta = 900006`);
    const [[{ myisam }]] = await pool.query('SELECT COUNT(*) AS myisam FROM fc_elemxcont WHERE num_oferta = 900006');
    assert.deepEqual([Number(ofertas), Number(precios)], [0, 0], 'InnoDB: el ROLLBACK deshizo las dos filas');
    assert.equal(Number(myisam), 1, 'MyISAM no se revierte: por eso el puente no escribe en tablas MyISAM dentro de la transacción');
  });

  it('el servicio en modo «escritura» arranca con el esquema esperado, dice cómo escribe y /health dice bd: ok', async () => {
    const r = await arrancarServicio(4021, { PUENTE_MODO: 'escritura' });
    try {
      assert.equal(r.iniciado, true, r.salida);
      assert.match(r.salida, /"evento":"escritura-adaptada".*"idManual":false/);
      assert.deepEqual(await consultarSalud(4021), { ok: true, servicio: 'puente-contratos', modo: 'escritura', bd: 'ok' });
    } finally {
      r.hijo?.kill();
    }
  });

  it('si Contratos cambia una columna, el modo «escritura» NO arranca y en modo prueba /health avisa «esquema_distinto»', async () => {
    // fc_ofertas_adjudicadas.nit: varchar(20) → varchar(30), como si Contratos la hubiera cambiado (el contrato exige el tipo exacto)
    await pool.query(`ALTER TABLE ${OFERTAS} MODIFY nit varchar(30) DEFAULT NULL`);
    try {
      const escritura = await arrancarServicio(4022, { PUENTE_MODO: 'escritura' });
      assert.equal(escritura.iniciado, false, 'no debe arrancar');
      assert.equal(escritura.codigo, 1);
      assert.match(escritura.salida, /esquema-distinto/);
      assert.match(escritura.salida, /"columna":"nit"/, 'dice qué columna cambió');
      assert.doesNotMatch(escritura.salida, new RegExp(config.password), 'nunca imprime la clave');

      const prueba = await arrancarServicio(4023, { PUENTE_MODO: 'dry-run' });
      try {
        assert.equal(prueba.iniciado, true, prueba.salida);
        assert.equal((await consultarSalud(4023)).bd, 'esquema_distinto');
      } finally {
        prueba.hijo?.kill();
      }
    } finally {
      await pool.query(`ALTER TABLE ${OFERTAS} MODIFY nit varchar(20) DEFAULT NULL`);
    }
    assert.equal((await verificarEsquema(pool, cargarEsquemaEsperado())).ok, true, 'la base de prueba quedó como estaba');
  });

  it('una columna nueva OBLIGATORIA (NOT NULL sin valor por defecto) que el puente no llena impide arrancar', async () => {
    await pool.query(`ALTER TABLE ${OFERTAS} ADD COLUMN obligatoria_prueba int(3) NOT NULL`);
    try {
      const r = await arrancarServicio(4025, { PUENTE_MODO: 'escritura' });
      assert.equal(r.iniciado, false);
      assert.match(r.salida, /obligatoria_prueba/);
    } finally {
      await pool.query(`ALTER TABLE ${OFERTAS} DROP COLUMN obligatoria_prueba`);
    }
  });

  it('una tabla que el puente ya no usa (fc_contratos_tarifa_inicial) puede cambiar sin tumbar el servicio', async () => {
    await pool.query("ALTER TABLE fc_contratos_tarifa_inicial MODIFY codservicio char(4) DEFAULT ''");
    try {
      const r = await arrancarServicio(4024, { PUENTE_MODO: 'escritura' });
      try {
        assert.equal(r.iniciado, true, r.salida);
        assert.equal((await consultarSalud(4024)).bd, 'ok');
      } finally {
        r.hijo?.kill();
      }
    } finally {
      await pool.query("ALTER TABLE fc_contratos_tarifa_inicial MODIFY codservicio char(3) DEFAULT ''");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Módulos 4 a 6 — oferta adjudicada y lista de precios de insumos. Todo el flujo corre con un usuario de MySQL de permisos
// MÍNIMOS (`puente_min`), creado aquí con los GRANT que genera `npm run permisos:generar`: si no alcanzaran, estas pruebas fallarían.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const CLAVE_MINIMO = 'prueba-minimo-sin-valor';
const CLAVE_RAIZ = env.PUENTE_TEST_MYSQL_ROOT_PASSWORD;
const saltarModulo4 = saltar || (CLAVE_RAIZ ? false : 'sin PUENTE_TEST_MYSQL_ROOT_PASSWORD (npm run test:mysql la define)');

/** El contrato v1 completo de una solicitud; `cambios` reemplaza campos sección por sección. */
function armar(solicitudId, cambios = {}) {
  const base = {
    version: 1,
    origen: { solicitudId, procesoCodigo: `PROC-${solicitudId}` },
    cliente: { razonSocial: 'Cliente de Prueba S.A.S.', nit: '900123456', direccion: 'Calle 1 # 2-3' },
    contrato: { objeto: 'Servicio de aseo integral', porcentajeAIU: 12.32, valorMensual: 5000000, plazoMeses: 12 },
    oferta: { empresa: '01', undnegocio: 'BAQ', tipoAdm: 'A', origenProceso: 'LIC', codServicio: 'ASE', descripcionServicio: 'Aseo y cafetería' },
    tarifa: { manoObra: 56160000, insumos: 1000000, maquinaria: 500000, administrativos: 5000000, valorAgregado: 0, serviciosNoContinuos: 250000 },
    insumos: [
      { codigo: '18111', valorUnitario: 10000 },
      { codigo: '01050', valorUnitario: 1234.56789 },
    ],
  };
  for (const [seccion, campos] of Object.entries(cambios)) base[seccion] = Array.isArray(campos) ? campos : { ...base[seccion], ...campos };
  return base;
}

describe('Módulos 4 a 6 — oferta adjudicada y lista de precios en MySQL 5.5 real, con el usuario de permisos mínimos', { skip: saltarModulo4 }, () => {
  let admin; // usuario completo de la base de prueba: siembra y verifica
  let raiz; // solo para crear el usuario mínimo y simular cambios de estructura
  let minimo; // el del puente
  let escritor;

  const contador = async (empresa, uen) => Number((await admin.query('SELECT num_oferta FROM fc_control WHERE empresa = ? AND undnegocio = ?', [empresa, uen]))[0][0].num_oferta);
  const filasDe = async (solicitudId) => (await admin.query(`SELECT * FROM ${OFERTAS} WHERE pc_add LIKE ?`, [`LICICOLBA:${solicitudId}:%`]))[0];
  const preciosDe = async (uen, numOferta) => (await admin.query(`SELECT * FROM ${PRECIOS} WHERE undnegocio = ? AND num_oferta = ? ORDER BY id`, [uen, numOferta]))[0];
  const enviar = (solicitudId, cambios, conEscritor = escritor) => {
    const r = validarContrato(armar(solicitudId, cambios), { paraEscribir: true });
    assert.equal(r.ok, true, JSON.stringify(r.errores));
    return conEscritor.escribir(r.datos, { huella: huella(r.datos) });
  };
  const fallo = (promesa) => promesa.then(() => assert.fail('debía fallar'), (e) => e);
  const limpiar = async () => {
    for (const tabla of [PRECIOS, OFERTAS, 'fc_clientes', 'fc_control', 'fc_conceptos', 'fc_horarios']) await admin.query(`DELETE FROM ${tabla}`);
  };

  before(async () => {
    admin = crearPool(config);
    raiz = crearPool({ ...config, user: 'root', password: CLAVE_RAIZ });
    // MySQL 5.5: GRANT USAGE crea el usuario si no existe; luego se le quita todo y se le dan SOLO los permisos generados.
    await raiz.query("GRANT USAGE ON *.* TO 'puente_min'@'%' IDENTIFIED BY ?", [CLAVE_MINIMO]);
    await raiz.query("REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'puente_min'@'%'");
    for (const sentencia of sentenciasDePermisos(cargarEsquemaEsperado(), { usuario: 'puente_min', base: config.database, hastaModulo: MODULO_IMPLEMENTADO })) await raiz.query(sentencia);
    minimo = crearPool({ ...config, user: 'puente_min', password: CLAVE_MINIMO });
    const { real } = await verificarEsquema(minimo, esquemaHastaModulo(cargarEsquemaEsperado(), MODULO_IMPLEMENTADO));
    escritor = crearEscritorMySQL(minimo, opcionesDeEscritura(real));

    await limpiar();
    await admin.query('INSERT INTO fc_clientes (undnegocio, nit, sucursal, rsocial, snbasertf) VALUES ?', [[
      ['BAQ', '900123456-8', '00', 'CLIENTE DE PRUEBA S.A.S.', 'N'],
      ['BAQ', '800197268-4 ', '00', 'Ñandú “Premium” S.A.S.', 'N'], // NIT guardado con un espacio al final y texto con latin1
      ['BAQ', '860034313-7', '01', 'CASA DE SUCURSAL UNO', 'N'],
      ['BAQ', '860034313-7', '00', 'CASA MATRIZ BARRANQUILLA', 'N'],
      ['BOG', '860034313-7', '00', 'SEDE BOGOTA', 'N'],
    ]]);
    // Una fila por (empresa, UEN); num_oferta = el ÚLTIMO número usado. (03, XXX) está duplicada a propósito.
    await admin.query('INSERT INTO fc_control (empresa, undnegocio, num_oferta) VALUES ?', [[['01', 'BAQ', 936], ['01', 'BOG', 219], ['02', 'BAQ', 7], ['03', 'XXX', 1], ['03', 'XXX', 1]]]);
    await admin.query('INSERT INTO fc_conceptos (empresa, undnegocio, codcpto) VALUES ?', [[['01', 'BAQ', 'ASE'], ['01', 'BOG', 'ASE'], ['02', 'BAQ', 'VIG']]]);
    await admin.query('INSERT INTO fc_horarios (codigo, horario, snactivo) VALUES ?', [[['941', 'LUN-VIE 6-14', 1], ['942', 'LUN-SAB 14-22', 1]]]);
  });
  after(async () => {
    await limpiar();
    await minimo?.end();
    await raiz?.end();
    await admin?.end();
  });

  it('con permisos mínimos escribe la oferta adjudicada: reserva el número, llena sus columnas y deja el contador al día', async () => {
    const antes = await contador('01', 'BAQ');
    const r = await enviar(1001);
    assert.equal(r.escrito.numOferta, antes + 1);
    assert.equal(await contador('01', 'BAQ'), antes + 1, 'num_oferta guarda el ÚLTIMO número usado');

    const filas = await filasDe(1001);
    assert.equal(filas.length, 1);
    const f = filas[0];
    assert.deepEqual(
      {
        empresa: f.empresa, undnegocio: f.undnegocio, num_oferta: f.num_oferta, nit: f.nit, rsocial: f.rsocial, vlr_adjudicado: f.vlr_adjudicado,
        vlr_manoobra: f.vlr_manoobra, vlr_insumos: f.vlr_insumos, vlr_maquinaria: f.vlr_maquinaria, vlr_impuestos: f.vlr_impuestos, vlr_otros: f.vlr_otros,
        vlr_nocontinuos: f.vlr_nocontinuos, user_add: f.user_add, user_mod: f.user_mod, fmod: f.fmod,
      },
      {
        empresa: '01', undnegocio: 'BAQ', num_oferta: antes + 1, nit: '900123456-8', rsocial: 'CLIENTE DE PRUEBA S.A.S.', vlr_adjudicado: 62910000,
        vlr_manoobra: 56160000, vlr_insumos: 1000000, vlr_maquinaria: 500000, vlr_impuestos: 5000000, vlr_otros: 0, vlr_nocontinuos: 250000,
        user_add: 'LICICOLBA', user_mod: null, fmod: '0000-00-00 00:00:00',
      },
    );
    assert.match(f.pc_add, /^LICICOLBA:1001:[0-9a-f]{12}$/);
    const [[reciente]] = await admin.query(`SELECT TIMESTAMPDIFF(SECOND, fadd, NOW()) AS seg FROM ${OFERTAS} WHERE id = ?`, [f.id]);
    assert.ok(Number(reciente.seg) >= 0 && Number(reciente.seg) < 60, 'fadd lo pone el servidor con NOW()');
  });

  it('escribe la lista de precios de los insumos con el número de la oferta: costo, A.I.U. y precio de venta exactos', async () => {
    const [{ num_oferta: n }] = await filasDe(1001);
    const precios = await preciosDe('BAQ', n);
    assert.deepEqual(
      precios.map((p) => [p.codigo, p.vr_costo, p.aiu, p.valor, p.cliente, p.nom_punto, p.ncontrato, p.valor_anterior, p.user_add]),
      [
        ['18111', '10000.0000', '0.1232', '11232.0000', 'tmp1', 'BAQ', '', '0.0000', 'LICICOLBA'],
        ['01050', '1234.5679', '0.1232', '1386.6667', 'tmp1', 'BAQ', '', '0.0000', 'LICICOLBA'],
      ],
    );
    assert.ok(precios.every((p) => p.fadd !== '0000-00-00 00:00:00'));
  });

  it('el reenvío de la misma solicitud no crea otra oferta ni gasta otro número', async () => {
    const antes = await contador('01', 'BAQ');
    const e = await fallo(enviar(1001));
    assert.ok(e instanceof ErrorNegocio);
    assert.equal(e.codigo, 'YA_ENVIADA');
    assert.equal(e.estado, 409);
    assert.equal(e.extra.oferta.numOferta, antes);
    assert.equal(e.extra.sinCambios, true);
    assert.equal(await contador('01', 'BAQ'), antes);
    assert.equal((await filasDe(1001)).length, 1);

    const cambiado = await fallo(enviar(1001, { tarifa: { manoObra: 1 } }));
    assert.equal(cambiado.extra.sinCambios, false, 'avisa que lo reenviado cambió y que Contratos conserva lo anterior');
  });

  it('ocho solicitudes distintas a la vez reciben ocho números consecutivos distintos', async () => {
    const antes = await contador('01', 'BAQ');
    const ids = [2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008];
    const resultados = await Promise.all(ids.map((id) => enviar(id)));
    assert.deepEqual(resultados.map((r) => r.escrito.numOferta).sort((a, b) => a - b), ids.map((_, i) => antes + 1 + i));
    assert.equal(await contador('01', 'BAQ'), antes + 8);
    const [[{ n }]] = await admin.query(`SELECT COUNT(DISTINCT num_oferta) AS n FROM ${OFERTAS} WHERE empresa = '01' AND undnegocio = 'BAQ' AND pc_add LIKE 'LICICOLBA:200%'`);
    assert.equal(Number(n), 8);
  });

  it('la MISMA solicitud enviada seis veces a la vez produce una sola oferta', async () => {
    const antes = await contador('01', 'BAQ');
    const resultados = await Promise.allSettled(Array.from({ length: 6 }, () => enviar(3001)));
    assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
    for (const r of resultados.filter((x) => x.status === 'rejected')) {
      assert.ok(r.reason instanceof ErrorNegocio && ['YA_ENVIADA', 'OCUPADO'].includes(r.reason.codigo), String(r.reason));
    }
    assert.equal((await filasDe(3001)).length, 1);
    assert.equal(await contador('01', 'BAQ'), antes + 1, 'solo se gastó un número');
  });

  it('si el contador iba por detrás de lo ya usado, salta ese número y avisa cuál', async () => {
    const antes = await contador('01', 'BOG');
    await admin.query(`INSERT INTO ${OFERTAS} (empresa, undnegocio, num_oferta, nit) VALUES ('01', 'BOG', ?, '111-1')`, [antes + 1]);
    const r = await enviar(4001, { oferta: { undnegocio: 'BOG' } });
    assert.equal(r.escrito.numOferta, antes + 2);
    assert.deepEqual(r.escrito.numerosSaltados, [antes + 1]);
    assert.equal(await contador('01', 'BOG'), antes + 2);
  });

  it('cliente que no existe y UEN sin contador: errores por campo y NINGÚN número reservado', async () => {
    const antes = { baq: await contador('01', 'BAQ'), bog: await contador('01', 'BOG') };
    const e1 = await fallo(enviar(5001, { cliente: { nit: '700000007' } }));
    assert.equal(e1.codigo, 'DATOS_INVALIDOS');
    assert.deepEqual(e1.extra.errores.map((x) => x.campo), ['cliente.nit']);
    const e2 = await fallo(enviar(5002, { oferta: { undnegocio: 'CAL' } }));
    assert.deepEqual(e2.extra.errores.map((x) => x.campo), ['oferta.undnegocio']);
    assert.deepEqual({ baq: await contador('01', 'BAQ'), bog: await contador('01', 'BOG') }, antes);
    assert.equal((await filasDe(5001)).length + (await filasDe(5002)).length, 0);
  });

  it('un contador duplicado para (empresa, UEN) se rechaza sin tocarlo', async () => {
    const e = await fallo(enviar(6001, { oferta: { empresa: '03', undnegocio: 'XXX' } }));
    assert.equal(e.codigo, 'CONTADOR_AMBIGUO');
    const [filas] = await admin.query("SELECT num_oferta FROM fc_control WHERE empresa = '03' AND undnegocio = 'XXX'");
    assert.deepEqual(filas.map((f) => Number(f.num_oferta)), [1, 1]);
  });

  it('el NIT guardado con espacios se encuentra por su base, se escribe como está en Contratos y la razón social viaja en latin1 sin perderse', async () => {
    const r = await enviar(7001, { cliente: { nit: '800197268', razonSocial: 'Otro nombre del cliente' } });
    assert.equal(r.escrito.cliente.nit, '800197268-4');
    assert.deepEqual(r.advertencias.map((a) => a.campo), ['cliente.razonSocial'], 'la razón social de LiciColba difiere: se avisa y se usa la de Contratos');
    const [f] = await filasDe(7001);
    assert.equal(f.nit, '800197268-4');
    assert.equal(f.rsocial, 'Ñandú “Premium” S.A.S.');
    const [[{ hex }]] = await admin.query(`SELECT HEX(CONVERT(rsocial USING latin1)) AS hex FROM ${OFERTAS} WHERE id = ?`, [f.id]);
    assert.equal(hex, 'D1616E64FA20935072656D69756D9420532E412E532E', 'los bytes son los de cp1252, como los escribe Visual FoxPro');
  });

  it('con varios clientes del mismo NIT elige el de la misma UEN y la sucursal 00', async () => {
    const baq = await enviar(7101, { cliente: { nit: '860034313' } });
    assert.equal(baq.escrito.cliente.rsocial, 'CASA MATRIZ BARRANQUILLA');
    const bog = await enviar(7102, { cliente: { nit: '860034313' }, oferta: { undnegocio: 'BOG' } });
    assert.equal(bog.escrito.cliente.rsocial, 'SEDE BOGOTA');
  });

  it('la clave de la oferta llega en minúsculas y se escribe como está en Contratos', async () => {
    const antes = await contador('01', 'BAQ');
    const r = await enviar(7201, { oferta: { undnegocio: 'baq' } });
    assert.equal(r.escrito.numOferta, antes + 1);
    const [f] = await filasDe(7201);
    assert.deepEqual({ empresa: f.empresa, undnegocio: f.undnegocio }, { empresa: '01', undnegocio: 'BAQ' });
  });

  it('el archivo de contrato de LiciColba (el JSON que arma su código) se escribe tal cual, sin advertencias', async () => {
    const archivo = JSON.parse(readFileSync(new URL('./fixtures/payload-licicolba.json', import.meta.url), 'utf8'));
    const r = validarContrato(archivo, { paraEscribir: true });
    assert.equal(r.ok, true, JSON.stringify(r.errores));
    const antes = await contador('01', 'BAQ');
    const escrito = await escritor.escribir(r.datos, { huella: huella(r.datos) });
    assert.deepEqual(escrito.advertencias, []);
    assert.equal(escrito.escrito.numOferta, antes + 1);
    const [oferta] = await filasDe(archivo.origen.solicitudId);
    assert.deepEqual([oferta.vlr_manoobra, oferta.vlr_impuestos], [13111200, 5400]);
    assert.equal((await preciosDe('BAQ', antes + 1)).length, archivo.insumos.length);
  });

  it('un envío sin insumos crea solo la oferta adjudicada', async () => {
    const sin = armar(7401);
    delete sin.insumos;
    const r = validarContrato(sin, { paraEscribir: true });
    const escrito = await escritor.escribir(r.datos, { huella: huella(r.datos) });
    assert.deepEqual(escrito.escrito.preciosOferta, []);
    assert.equal((await filasDe(7401)).length, 1);
    assert.equal((await preciosDe('BAQ', escrito.escrito.numOferta)).length, 0);
  });

  it('si falla el INSERT de un precio se revierte TAMBIÉN la oferta (todo o nada), el número se pierde y el candado queda libre', async () => {
    await raiz.query(`ALTER TABLE ${PRECIOS} DROP COLUMN vr_costo`);
    try {
      const antes = await contador('01', 'BAQ');
      const e = await fallo(enviar(7501));
      assert.ok(!(e instanceof ErrorNegocio), 'un fallo inesperado no se disfraza de error de negocio');
      assert.equal(e.errno, 1054);
      assert.equal((await filasDe(7501)).length, 0, 'la oferta, que ya se había insertado, se deshizo con el ROLLBACK');
      assert.equal(await contador('01', 'BAQ'), antes + 1, 'fc_control es MyISAM: el número reservado no se devuelve');

      const conexion = await admin.getConnection();
      try {
        const [[{ ok }]] = await conexion.query("SELECT GET_LOCK('puente-contratos:solicitud:7501', 0) AS ok");
        assert.equal(Number(ok), 1, 'el candado de la solicitud quedó libre');
        await conexion.query("SELECT RELEASE_LOCK('puente-contratos:solicitud:7501')");
      } finally {
        conexion.release();
      }
    } finally {
      await raiz.query(`ALTER TABLE ${PRECIOS} ADD COLUMN vr_costo decimal(15,4) DEFAULT NULL`);
    }
    assert.equal((await verificarEsquema(admin, cargarEsquemaEsperado())).ok, true, 'la base de prueba quedó como estaba');
  });

  it('si el id de la oferta NO es auto_increment, el puente lo asigna (MAX + 1) en la misma transacción', async () => {
    await raiz.query(`ALTER TABLE ${OFERTAS} MODIFY id int(18) NOT NULL`);
    try {
      const { ok, real } = await verificarEsquema(minimo, esquemaHastaModulo(cargarEsquemaEsperado(), MODULO_IMPLEMENTADO));
      assert.equal(ok, true, 'el id lo llena el puente: no impide arrancar');
      const opciones = opcionesDeEscritura(real);
      assert.equal(opciones.idManual, true);
      const [[{ maximo }]] = await admin.query(`SELECT MAX(id) AS maximo FROM ${OFERTAS}`);
      await enviar(7601, {}, crearEscritorMySQL(minimo, opciones));
      const [f] = await filasDe(7601);
      assert.equal(f.id, Number(maximo) + 1);
    } finally {
      await raiz.query(`ALTER TABLE ${OFERTAS} MODIFY id int(18) NOT NULL AUTO_INCREMENT`);
    }
  });

  it('el usuario mínimo NO puede leer credenciales ni tocar lo que el puente no usa', async () => {
    const denegado = async (sql) => {
      const e = await fallo(minimo.query(sql));
      assert.ok([1142, 1143].includes(e.errno), `${sql} → ${e.errno} ${e.code}`);
    };
    await denegado('SELECT * FROM fc_control'); // la fila real trae usuario y clave de conexión
    await denegado('SELECT id FROM fc_control');
    await denegado('UPDATE fc_control SET empresa = "99"');
    await denegado('SELECT direccion FROM fc_clientes');
    await denegado('SELECT * FROM fc_empresas');
    await denegado(`DELETE FROM ${OFERTAS}`);
    await denegado(`UPDATE ${OFERTAS} SET vlr_adjudicado = 0`);
    await denegado(`DROP TABLE ${OFERTAS}`);
    await denegado(`ALTER TABLE ${OFERTAS} ADD COLUMN x int`);
    await denegado(`DELETE FROM ${PRECIOS}`);
    await denegado(`UPDATE ${PRECIOS} SET valor = 0`);
    await denegado('UPDATE fc_horarios SET snactivo = 0');
    await denegado('SELECT horario FROM fc_horarios'); // del horario solo se consulta el código
    await denegado('SELECT * FROM fc_contratos_tarifa_inicial'); // ya no se usa: sin permisos
    // Lo que sí necesita:
    assert.equal(Number((await minimo.query('SELECT num_oferta FROM fc_control WHERE empresa = "01" AND undnegocio = "BAQ"'))[0][0].num_oferta) > 0, true);
  });

  it('visto con el usuario mínimo, el esquema de los módulos hechos coincide; el completo no (las demás tablas no se ven)', async () => {
    const esperado = cargarEsquemaEsperado();
    assert.deepEqual((await verificarEsquema(minimo, esquemaHastaModulo(esperado, MODULO_IMPLEMENTADO))).problemas, []);
    const completo = await verificarEsquema(minimo, esperado);
    assert.equal(completo.ok, false);
    assert.ok(completo.problemas.some((p) => p.tabla === 'fc_empresas' && p.problema === 'La tabla no existe.'));
  });

  it('el servicio completo (proceso aparte, modo escritura, usuario mínimo): /health ok, escribe, reenvío 409 y 422 sin oferta', async () => {
    const r = await arrancarServicio(4031, { PUENTE_MODO: 'escritura', PUENTE_MYSQL_USER: 'puente_min', PUENTE_MYSQL_PASSWORD: CLAVE_MINIMO });
    try {
      assert.equal(r.iniciado, true, r.salida);
      assert.deepEqual(await consultarSalud(4031), { ok: true, servicio: 'puente-contratos', modo: 'escritura', bd: 'ok' });
      const post = (cuerpo) => fetch('http://127.0.0.1:4031/contratos', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(cuerpo) });

      const antes = await contador('01', 'BAQ');
      const creada = await post(armar(9001));
      const j = await creada.json();
      assert.equal(creada.status, 200, JSON.stringify(j));
      assert.equal(j.modo, 'escritura');
      assert.equal(j.escrito.numOferta, antes + 1);
      assert.deepEqual(j.advertencias, []);
      assert.deepEqual(j.noEscrito.map((n) => n.campo), ['contrato.porcentajeAIU', 'oferta.tipoAdm', 'oferta.origenProceso', 'oferta.codServicio', 'contrato.objeto', 'contrato.valorMensual', 'contrato.plazoMeses', 'cliente.direccion']);
      assert.equal(j.escrito.preciosOferta.length, 2);

      const repetida = await post(armar(9001));
      assert.equal(repetida.status, 409);
      const rj = await repetida.json();
      assert.equal(rj.error, 'YA_ENVIADA');
      assert.equal(rj.oferta.numOferta, antes + 1);

      const sinOferta = armar(9002);
      delete sinOferta.oferta;
      const faltante = await post(sinOferta);
      assert.equal(faltante.status, 422);
      assert.deepEqual((await faltante.json()).errores.map((e) => e.campo), ['oferta']);
      assert.equal(await contador('01', 'BAQ'), antes + 1);
    } finally {
      r.hijo?.kill();
    }
  });
});
