import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, describe, it } from 'node:test';
import { crearApp } from '../src/app.js';
import { huella, validarContrato } from '../src/validar.js';

const TOKEN = 'token-de-prueba-0123456789';
let servidor;
let base;

const valido = () => ({
  version: 1,
  origen: { solicitudId: 42, procesoCodigo: 'SED-LP-2026-0091' },
  cliente: { razonSocial: 'Cliente de Prueba S.A.S.', nit: '900123456', direccion: 'Calle 1 # 2-3' },
  contrato: { objeto: 'Servicio de aseo integral', porcentajeAIU: 12.32, valorMensual: 5000000, plazoMeses: 12 },
});

function arrancar(opciones = {}) {
  const s = crearApp({ token: TOKEN, ...opciones }).listen(0, '127.0.0.1');
  return once(s, 'listening').then(() => ({ s, url: `http://127.0.0.1:${s.address().port}` }));
}
const post = (cuerpo, { token = TOKEN, url = base } = {}) =>
  fetch(`${url}/contratos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  });

// El log por petición es ruido en las pruebas.
const log = console.log;
before(async () => {
  console.log = () => {};
  ({ s: servidor, url: base } = await arrancar());
});
after(() => {
  console.log = log;
  servidor.close();
});

describe('autenticación', () => {
  it('/health responde sin token y no revela datos', async () => {
    const r = await fetch(`${base}/health`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, servicio: 'puente-contratos', modo: 'dry-run', bd: 'sin_configurar' });
  });
  it('/health informa solo el estado de la base en una palabra, sin detalles', async () => {
    const { s, url } = await arrancar({ estadoBD: async () => ({ estado: 'esquema_distinto', problemas: [{ tabla: 'secreta' }] }) });
    try {
      assert.deepEqual(await (await fetch(`${url}/health`)).json(), { ok: true, servicio: 'puente-contratos', modo: 'dry-run', bd: 'esquema_distinto' });
    } finally {
      s.close();
    }
  });
  it('POST sin token o con token incorrecto → 401', async () => {
    assert.equal((await post(valido(), { token: null })).status, 401);
    assert.equal((await post(valido(), { token: 'otro-token-que-no-es-el-bueno' })).status, 401);
  });
});

describe('POST /contratos (modo prueba)', () => {
  it('un contrato válido responde 200 con lo que escribiría y la huella, sin tocar ninguna base de datos', async () => {
    const r = await post(valido());
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.ok, true);
    assert.equal(j.modo, 'dry-run');
    assert.equal(j.escribiria.cliente.nit, '900123456');
    assert.equal(j.escribiria.cliente.nitCompleto, '900123456-8', 'Contratos guarda el NIT como base-DV; el DV lo calcula el puente');
    assert.equal(j.escribiria.contrato.valorMensual, 5000000);
    assert.match(j.huella, /^[0-9a-f]{64}$/);
    assert.deepEqual(j.advertencias, []);
  });

  it('lo opcional que falta no bloquea: se informa como advertencia y queda en null', async () => {
    const c = valido();
    c.cliente.direccion = '   ';
    c.contrato.plazoMeses = null;
    const j = await (await post(c)).json();
    assert.equal(j.ok, true);
    assert.equal(j.escribiria.cliente.direccion, null);
    assert.deepEqual(j.advertencias.map((a) => a.campo).sort(), ['cliente.direccion', 'contrato.plazoMeses']);
  });

  it('devuelve TODOS los errores a la vez (422), cada uno con su campo', async () => {
    const c = valido();
    c.cliente.nit = '900.123.456-8';
    c.cliente.razonSocial = '';
    c.contrato.valorMensual = -1;
    c.contrato.porcentajeAIU = 12.345;
    c.contrato.plazoMeses = 0;
    const r = await post(c);
    const j = await r.json();
    assert.equal(r.status, 422);
    assert.equal(j.error, 'DATOS_INVALIDOS');
    assert.deepEqual(j.errores.map((e) => e.campo).sort(), ['cliente.nit', 'cliente.razonSocial', 'contrato.plazoMeses', 'contrato.porcentajeAIU', 'contrato.valorMensual']);
  });

  it('rechaza campos desconocidos y secciones faltantes (no se cuela nada que Contratos no pidió)', async () => {
    const c = valido();
    c.cliente.telefono = '3000000000';
    c.extra = {};
    delete c.contrato;
    const j = await (await post(c)).json();
    assert.deepEqual(j.errores.map((e) => e.campo).sort(), ['cliente.telefono', 'contrato', 'extra']);
  });

  it('JSON inválido → 400; cuerpo que no es un objeto → 422', async () => {
    const malo = await post('{"version": 1,');
    assert.equal(malo.status, 400);
    assert.equal((await malo.json()).error, 'JSON_INVALIDO');
    const arreglo = await post('[1,2,3]'); // JSON válido pero no es un objeto: lo rechaza el validador
    assert.equal(arreglo.status, 422);
    assert.equal((await arreglo.json()).errores[0].campo, '(cuerpo)');
  });

  it('en modo «escritura» (aún sin MySQL) responde 501 y no escribe nada', async () => {
    const { s, url } = await arrancar({ modo: 'escritura' });
    try {
      const r = await post(valido(), { url });
      assert.equal(r.status, 501);
      assert.equal((await r.json()).error, 'MODO_NO_DISPONIBLE');
    } finally {
      s.close();
    }
  });

  it('un fallo del escritor responde 500 sin filtrar el mensaje interno', async () => {
    const escritor = { async escribir() { throw new Error('falló con mysql://usuario:CLAVE@10.0.0.5/xconfac'); } };
    const { s, url } = await arrancar({ escritor });
    const err = console.error;
    console.error = () => {};
    try {
      const r = await post(valido(), { url });
      assert.equal(r.status, 500);
      assert.deepEqual(await r.json(), { ok: false, error: 'ERROR_INTERNO' });
    } finally {
      console.error = err;
      s.close();
    }
  });
});

describe('validarContrato', () => {
  it('normaliza el texto (NFC, espacios) y respeta los saltos de línea del objeto', () => {
    const c = valido();
    c.cliente.razonSocial = '  Café   del   Sur  ';
    c.contrato.objeto = 'Línea 1  \r\nLínea 2\n\n';
    const r = validarContrato(c);
    assert.equal(r.ok, true);
    assert.equal(r.datos.cliente.razonSocial, 'Café del Sur');
    assert.equal(r.datos.contrato.objeto, 'Línea 1\nLínea 2');
  });

  it('nunca trunca: lo que excede el límite se rechaza', () => {
    const c = valido();
    c.cliente.razonSocial = 'ñ'.repeat(200);
    assert.equal(validarContrato(c).ok, true);
    c.cliente.razonSocial = 'ñ'.repeat(201);
    assert.match(validarContrato(c).errores[0].mensaje, /Máximo 200 caracteres \(tiene 201\)/);
  });

  it('las tablas de Contratos son latin1: lo que no cabe se rechaza, nunca se cambia por «?»', () => {
    const c = valido();
    c.cliente.razonSocial = 'Aseo “Premium” – Ñandú’s S.A. €';
    c.contrato.objeto = 'Servicio de aseo ≥ 8 horas 😀';
    const r = validarContrato(c);
    assert.deepEqual(r.errores.map((e) => e.campo), ['contrato.objeto']);
    assert.match(r.errores[0].mensaje, /no puede guardar: «≥» «😀»/);
  });

  it('rechaza caracteres de control y valores de tipo equivocado', () => {
    const c = valido();
    c.cliente.direccion = 'Calle\u0000 1';
    c.contrato.valorMensual = '5000000';
    c.origen.solicitudId = 1.5;
    assert.deepEqual(validarContrato(c).errores.map((e) => e.campo).sort(), ['cliente.direccion', 'contrato.valorMensual', 'origen.solicitudId']);
  });

  it('la huella no depende del orden de las claves y cambia con cualquier dato', () => {
    const a = validarContrato(valido()).datos;
    const b = validarContrato(JSON.parse(JSON.stringify(valido(), ['contrato', 'cliente', 'origen', 'version', 'objeto', 'porcentajeAIU', 'valorMensual', 'plazoMeses', 'razonSocial', 'nit', 'direccion', 'solicitudId', 'procesoCodigo']))).datos;
    assert.equal(huella(a), huella(b));
    const c = valido();
    c.contrato.valorMensual = 5000001;
    assert.notEqual(huella(a), huella(validarContrato(c).datos));
  });
});
