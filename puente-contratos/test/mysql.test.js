import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { crearPool, leerConfigMySQL, SQL_MODE_ESTRICTO } from '../src/mysql.js';

const completo = { PUENTE_MYSQL_HOST: '10.0.0.5', PUENTE_MYSQL_USER: 'puente', PUENTE_MYSQL_PASSWORD: 'clave-secreta-123', PUENTE_MYSQL_DATABASE: 'almacen' };

describe('leerConfigMySQL', () => {
  it('sin host no hay MySQL (el puente sigue en modo prueba)', () => {
    assert.equal(leerConfigMySQL({}), null);
    assert.equal(leerConfigMySQL({ PUENTE_MYSQL_HOST: '  ' }), null);
  });

  it('lee la configuración completa; el puerto por defecto es 3306', () => {
    assert.deepEqual(leerConfigMySQL(completo), { host: '10.0.0.5', port: 3306, user: 'puente', password: 'clave-secreta-123', database: 'almacen' });
    assert.equal(leerConfigMySQL({ ...completo, PUENTE_MYSQL_PORT: '3307' }).port, 3307);
    assert.equal(leerConfigMySQL({ ...completo, PUENTE_MYSQL_PORT: '' }).port, 3306, 'variable vacía ⇒ puerto por defecto');
  });

  it('informa TODO lo que falta o está mal, sin incluir la clave en el mensaje', () => {
    assert.throws(
      () => leerConfigMySQL({ PUENTE_MYSQL_HOST: 'h', PUENTE_MYSQL_PORT: '70000', PUENTE_MYSQL_PASSWORD: 'clave-secreta-123' }),
      (error) => {
        assert.match(error.message, /PUENTE_MYSQL_PORT/);
        assert.match(error.message, /PUENTE_MYSQL_USER/);
        assert.match(error.message, /PUENTE_MYSQL_DATABASE/);
        assert.doesNotMatch(error.message, /clave-secreta-123/);
        return true;
      },
    );
    assert.throws(() => leerConfigMySQL({ ...completo, PUENTE_MYSQL_PASSWORD: '' }), /PUENTE_MYSQL_PASSWORD/);
  });
});

describe('crearPool', () => {
  function pruebaConLibFalsa() {
    const emisor = new EventEmitter();
    let opciones;
    const lib = {
      createPool(o) {
        opciones = o;
        return { pool: emisor };
      },
    };
    const pool = crearPool(leerConfigMySQL(completo), lib);
    return { pool, emisor, opciones };
  }

  it('conecta como utf8 con fechas y decimales como texto (sin perder precisión) y tiempos acotados', () => {
    const { opciones } = pruebaConLibFalsa();
    assert.equal(opciones.charset, 'UTF8_GENERAL_CI');
    assert.equal(opciones.dateStrings, true);
    assert.equal(opciones.supportBigNumbers, true);
    assert.equal(opciones.bigNumberStrings, true);
    assert.ok(opciones.connectTimeout <= 10_000);
    assert.equal(opciones.database, 'almacen');
    assert.equal(opciones.multipleStatements, undefined, 'nunca varias sentencias por consulta');
  });

  it('cada conexión nueva queda en modo estricto antes de usarse', () => {
    const { emisor } = pruebaConLibFalsa();
    const ejecutadas = [];
    emisor.emit('connection', { query: (sql, cb) => (ejecutadas.push(sql), cb(null)), destroy: () => assert.fail('no debe destruirse') });
    assert.equal(ejecutadas.length, 1);
    assert.match(ejecutadas[0], new RegExp(`sql_mode = '${SQL_MODE_ESTRICTO}'`));
    assert.match(SQL_MODE_ESTRICTO, /STRICT_ALL_TABLES/, 'STRICT_ALL_TABLES cubre también las tablas MyISAM');
  });

  it('si no se logra el modo estricto, la conexión se descarta (nunca se usa en modo laxo)', () => {
    const { emisor } = pruebaConLibFalsa();
    let destruida = false;
    emisor.emit('connection', { query: (_sql, cb) => cb(new Error('sin permiso')), destroy: () => (destruida = true) });
    assert.equal(destruida, true);
  });
});
