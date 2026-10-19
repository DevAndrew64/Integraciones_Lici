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

  it('destino: lee empresa, UEN y conceptos también en dry-run; sin permiso o sin conexión responde 503', async () => {
    const pool = { async query(sql) {
      if (/fc_empresas/.test(sql)) return [[{ codigo: '01', undnegocio: 'BAQ', rsocial: 'ASEOCOLBA S.A.' }]];
      if (/fc_control/.test(sql)) return [[{ empresa: '01', undnegocio: 'BAQ' }]];
      return [[]];
    } };
    const motor = crearMotor({ modo: 'dry-run', configMySQL: config, esquemaEsperado: cargarEsquemaEsperado(), crearPoolFn: () => pool });
    assert.deepEqual(await motor.destino('ASEOCOLBA'), { estado: 200, cuerpo: { ok: true, empresa: { codigo: '01', rsocial: 'ASEOCOLBA S.A.' }, uens: [{ codigo: 'BAQ', conceptos: [] }] } });
    for (const [error, codigo] of [[{ errno: 1142 }, 'SIN_PERMISO'], [{ code: 'ECONNREFUSED' }, 'BD_NO_DISPONIBLE']]) {
      const roto = crearMotor({ modo: 'dry-run', configMySQL: config, esquemaEsperado: cargarEsquemaEsperado(), crearPoolFn: () => ({ async query() { throw Object.assign(new Error('x'), error); } }) });
      const r = await roto.destino('ASEOCOLBA');
      assert.deepEqual([r.estado, r.cuerpo.error], [503, codigo]);
    }
  });

  it('destino: si la conexión del pool ya estaba cerrada, repite la lectura una vez con otra', async () => {
    let caidas = 1;
    const pool = { async query(sql) {
      if (caidas > 0) { caidas -= 1; throw Object.assign(new Error("Can't add new command when connection is in closed state"), { fatal: true }); }
      if (/fc_empresas/.test(sql)) return [[{ codigo: '02', undnegocio: 'BAQ', rsocial: 'Tempocolba S.A.S.' }]];
      if (/fc_control/.test(sql)) return [[{ empresa: '02', undnegocio: 'BAQ' }]];
      return [[]];
    } };
    const motor = crearMotor({ modo: 'dry-run', configMySQL: config, esquemaEsperado: cargarEsquemaEsperado(), crearPoolFn: () => pool });
    const r = await motor.destino('TEMPOCOLBA');
    assert.equal(r.estado, 200);
    assert.equal(r.cuerpo.empresa.codigo, '02');
  });
});
