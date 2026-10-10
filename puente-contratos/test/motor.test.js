import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { cargarEsquemaEsperado } from '../src/esquema.js';
import { crearMotor } from '../src/motor.js';

const payload = () => JSON.parse(readFileSync(new URL('./fixtures/payload-licicolba.json', import.meta.url), 'utf8'));
const config = { host: 'contratos', port: 3306, user: 'puente', password: '', database: 'almacen' };

/** Pool falso: `information_schema` responde lo que diga `real`, o falla con `error`. */
function poolFalso({ error, columnas = [], motores = [] } = {}) {
  let creados = 0;
  const pool = {
    async query(sql) {
      if (error) throw error;
      return [/information_schema\.COLUMNS/.test(sql) ? columnas : motores];
    },
  };
  return { crear: () => (creados++, pool), creados: () => creados };
}

describe('crearMotor', () => {
  it('en dry-run valida y responde lo que escribiría, sin tocar MySQL', async () => {
    const falso = poolFalso({ error: new Error('no debe usarse') });
    const motor = crearMotor({ modo: 'dry-run', configMySQL: config, esquemaEsperado: cargarEsquemaEsperado(), crearPoolFn: falso.crear });
    const { estado, cuerpo } = await motor.enviar(payload());
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.modo, 'dry-run');
    assert.ok(cuerpo.escribiria);
    assert.equal(falso.creados(), 0);
  });

  it('datos inválidos responden 422 sin conectar a MySQL en dry-run', async () => {
    const motor = crearMotor({ modo: 'dry-run', configMySQL: config, esquemaEsperado: cargarEsquemaEsperado() });
    const { estado, cuerpo } = await motor.enviar({ version: 1 });
    assert.equal(estado, 422);
    assert.equal(cuerpo.error, 'DATOS_INVALIDOS');
  });

  it('sin conexión responde 503 BD_NO_DISPONIBLE y reintenta en el siguiente envío', async () => {
    const falso = poolFalso({ error: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) });
    const motor = crearMotor({ modo: 'escritura', configMySQL: config, esquemaEsperado: cargarEsquemaEsperado(), crearPoolFn: falso.crear });
    for (let i = 0; i < 2; i++) {
      const { estado, cuerpo } = await motor.enviar(payload());
      assert.equal(estado, 503);
      assert.equal(cuerpo.error, 'BD_NO_DISPONIBLE');
    }
    assert.equal(falso.creados(), 1, 'el pool se crea una sola vez');
  });

  it('con un esquema distinto no escribe: 503 ESQUEMA_DISTINTO', async () => {
    const falso = poolFalso();
    const motor = crearMotor({ modo: 'escritura', configMySQL: config, esquemaEsperado: cargarEsquemaEsperado(), crearPoolFn: falso.crear });
    const { estado, cuerpo } = await motor.enviar(payload());
    assert.equal(estado, 503);
    assert.equal(cuerpo.error, 'ESQUEMA_DISTINTO');
  });
});
