import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { crearApp } from '../src/app.js';
import { ErrorNegocio } from '../src/errores.js';
import { huella, validarContrato } from '../src/validar.js';

const TOKEN = 'token-de-prueba-0123456789';
let servidor;
let base;

const valido = () => ({
  version: 1,
  origen: { solicitudId: 42, procesoCodigo: 'SED-LP-2026-0091' },
  cliente: { razonSocial: 'Cliente de Prueba S.A.S.', nit: '900123456', direccion: 'Calle 1 # 2-3' },
  contrato: { objeto: 'Servicio de aseo integral', porcentajeAIU: 12.32, valorMensual: 5000000, plazoMeses: 12 },
  oferta: { empresa: '01', undnegocio: 'BAQ', tipoAdm: 'A', origenProceso: 'LIC', codServicio: 'ASE', descripcionServicio: 'Aseo y cafetería' },
  // Los cargos suman 50.000.000,12345 sin A.I.U.; con el 12,32 % de A.I.U. son 56.160.000 (la mano de obra de la tarifa).
  tarifa: { manoObra: 56160000, insumos: 1000000, maquinaria: 500000, administrativos: 5000000, valorAgregado: 0, serviciosNoContinuos: 250000 },
  cargos: [
    { nombre: 'Aseador', cantidad: 4, horasSemana: 48, jornada: 8, salario: 1423500, riesgo: 1, valorUnitario: 10000000, valorTotal: 40000000, codigoHorario: '941' },
    { nombre: 'Supervisor', cantidad: 1, horasSemana: 44, jornada: 7.33, salario: 2500000, riesgo: 2, valorUnitario: 10000000.123456, valorTotal: 10000000.12346 },
  ],
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

  it('muestra la fila de tarifa que escribiría, con el A.I.U. como fracción y sin reservar número', async () => {
    const j = await (await post(valido())).json();
    const t = j.escribiria.tarifaInicial;
    assert.equal(t.empresa, '01');
    assert.equal(t.undnegocio, 'BAQ');
    assert.equal(t.num_oferta, null, 'el número de oferta se reserva al escribir, no en modo prueba');
    assert.equal(t.nit, '900123456-8');
    assert.equal(t.aiu, '0.1232');
    assert.equal(t.tarifa, 56160000 + 1000000 + 500000 + 5000000 + 250000);
    assert.equal(t.tar_impuestos, 5000000, 'los costos administrativos van en tar_impuestos');
    assert.equal(t.fadd, 'NOW()');
    assert.equal(t.pc_add, `LICICOLBA:42:${j.huella.slice(0, 12)}`);
    assert.deepEqual(
      j.noEscrito.map((n) => n.campo),
      ['contrato.objeto', 'contrato.valorMensual', 'contrato.plazoMeses', 'cliente.direccion', 'cargos'],
      'lo que no tiene destino todavía se informa, no se pierde en silencio',
    );
  });

  it('muestra los cargos que escribiría: código consecutivo por oferta, ítem de la línea y el horario solo si viene', async () => {
    const j = await (await post(valido())).json();
    const [a, b] = j.escribiria.cargosIniciales;
    assert.deepEqual([a.cargo, a.item, a.nom_cargo, a.cantidad, a.codhorario], [1, 1, 'Aseador', 4, '941']);
    assert.deepEqual([b.cargo, b.item, b.nom_cargo, b.vlr_unitario, b.jornada], [2, 2, 'Supervisor', 10000000.12346, 7.33]);
    assert.equal('codhorario' in b, false, 'sin horario no se escribe la columna');
    assert.equal(a.num_oferta, null);
    assert.equal(a.fadd, 'NOW()');
    assert.deepEqual(j.advertencias, [], 'los cargos cuadran con la mano de obra de la tarifa');
  });

  it('sin cargos el envío vale (la oferta se crea sin mano de obra) y se avisa; con cargos que no cuadran con la tarifa también se avisa', async () => {
    const sin = valido();
    delete sin.cargos;
    const j = await (await post(sin)).json();
    assert.equal(j.ok, true);
    assert.deepEqual(j.advertencias.map((a) => a.campo), ['cargos']);
    assert.equal(j.escribiria.cargosIniciales, undefined);

    const descuadrado = valido();
    descuadrado.cargos.pop();
    const d = await (await post(descuadrado)).json();
    assert.equal(d.ok, true);
    assert.deepEqual(d.advertencias.map((a) => a.campo), ['cargos']);
    assert.match(d.advertencias[0].mensaje, /Los cargos suman .* sin A\.I\.U\..* y la mano de obra de la tarifa es .*: revise que estén todos los cargos\./);
  });

  it('un valor total que no es valorUnitario × cantidad se rechaza en modo prueba como una advertencia y al escribir como error', async () => {
    const c = valido();
    c.cargos[0].valorTotal = 1;
    const j = await (await post(c)).json();
    assert.equal(j.ok, true);
    assert.ok(j.advertencias.some((a) => a.campo === 'cargos[0].valorTotal'));
  });

  it('un envío de los módulos 1 y 2 (sin oferta ni tarifa) sigue valiendo en modo prueba, con una advertencia por sección', async () => {
    const c = valido();
    delete c.oferta;
    delete c.tarifa;
    const j = await (await post(c)).json();
    assert.equal(j.ok, true);
    assert.deepEqual(j.advertencias.map((a) => a.campo), ['oferta', 'tarifa']);
    assert.equal(j.escribiria.tarifaInicial, undefined);
  });

  it('lo que impediría escribir (A.I.U. en 0) sale como advertencia en modo prueba, no como rechazo', async () => {
    const c = valido();
    c.contrato.porcentajeAIU = 0;
    const j = await (await post(c)).json();
    assert.equal(j.ok, true);
    assert.deepEqual(j.advertencias.map((a) => a.campo), ['contrato.porcentajeAIU']);
    assert.equal(j.escribiria.tarifaInicial, undefined);
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

describe('POST /contratos (modo escritura)', () => {
  const llamadas = [];
  const escritorFalso = (comportamiento) => ({
    async escribir(datos, contexto) {
      llamadas.push({ datos, contexto });
      return comportamiento(datos, contexto);
    },
  });
  const conEscritor = async (escritor, prueba) => {
    llamadas.length = 0;
    const { s, url } = await arrancar({ modo: 'escritura', escritor });
    try {
      await prueba(url);
    } finally {
      s.close();
    }
  };

  it('entrega al escritor el contrato validado y su huella, y devuelve lo que escribió junto a las advertencias', async () => {
    const escritor = escritorFalso(() => ({ advertencias: [{ campo: 'cliente.razonSocial', mensaje: 'difiere' }], escrito: { numOferta: 937 }, noEscrito: [] }));
    await conEscritor(escritor, async (url) => {
      const c = valido();
      c.contrato.plazoMeses = null; // advertencia del validador
      const r = await post(c, { url });
      const j = await r.json();
      assert.equal(r.status, 200);
      assert.equal(j.modo, 'escritura');
      assert.equal(j.escrito.numOferta, 937);
      assert.deepEqual(j.advertencias.map((a) => a.campo), ['contrato.plazoMeses', 'cliente.razonSocial']);
      assert.equal(llamadas.length, 1);
      assert.equal(llamadas[0].contexto.huella, j.huella);
      assert.equal(llamadas[0].datos.oferta.empresa, '01');
    });
  });

  it('para escribir, la oferta y la tarifa son obligatorias: sin ellas responde 422 y el escritor ni se entera', async () => {
    await conEscritor(escritorFalso(() => ({})), async (url) => {
      const c = valido();
      delete c.oferta;
      c.tarifa.manoObra = null;
      c.contrato.porcentajeAIU = null;
      const r = await post(c, { url });
      const j = await r.json();
      assert.equal(r.status, 422);
      assert.deepEqual(j.errores.map((e) => e.campo).sort(), ['contrato.porcentajeAIU', 'oferta', 'tarifa.manoObra']);
      assert.equal(llamadas.length, 0);
    });
  });

  it('un error de negocio del escritor conserva su código HTTP y su cuerpo (reenvío → 409 con la oferta existente)', async () => {
    const escritor = escritorFalso(() => {
      throw new ErrorNegocio(409, 'YA_ENVIADA', 'Esta solicitud ya se envió.', { oferta: { empresa: '01', undnegocio: 'BAQ', numOferta: 937 }, sinCambios: true });
    });
    await conEscritor(escritor, async (url) => {
      const r = await post(valido(), { url });
      assert.equal(r.status, 409);
      assert.deepEqual(await r.json(), {
        ok: false,
        error: 'YA_ENVIADA',
        mensaje: 'Esta solicitud ya se envió.',
        oferta: { empresa: '01', undnegocio: 'BAQ', numOferta: 937 },
        sinCambios: true,
      });
    });
  });

  it('lo que Contratos no acepta se devuelve como DATOS_INVALIDOS con sus campos (422), igual que la validación', async () => {
    const escritor = escritorFalso(() => {
      throw new ErrorNegocio(422, 'DATOS_INVALIDOS', 'Contratos no puede recibir esta oferta.', { errores: [{ campo: 'cliente.nit', mensaje: 'El cliente no existe en Contratos.' }] });
    });
    await conEscritor(escritor, async (url) => {
      const r = await post(valido(), { url });
      const j = await r.json();
      assert.equal(r.status, 422);
      assert.equal(j.error, 'DATOS_INVALIDOS');
      assert.deepEqual(j.errores, [{ campo: 'cliente.nit', mensaje: 'El cliente no existe en Contratos.' }]);
    });
  });

  it('un error de MySQL no filtra su mensaje (puede traer un trozo del dato rechazado) ni a la respuesta ni al registro', async () => {
    const escritor = escritorFalso(() => {
      throw Object.assign(new Error('Incorrect string value: 0xF0 for column rsocial'), { code: 'ER_TRUNCATED_WRONG_VALUE', errno: 1366, sqlMessage: 'Incorrect string value: 0xF0 for column rsocial' });
    });
    await conEscritor(escritor, async (url) => {
      const registros = [];
      const err = console.error;
      console.error = (m) => registros.push(m);
      try {
        const r = await post(valido(), { url });
        assert.equal(r.status, 500);
        assert.deepEqual(await r.json(), { ok: false, error: 'ERROR_INTERNO' });
      } finally {
        console.error = err;
      }
      assert.equal(registros.length, 1);
      assert.doesNotMatch(registros[0], /0xF0|rsocial/);
      assert.match(registros[0], /1366/);
    });
  });
});

describe('contrato con LiciColba (archivo compartido con sus pruebas)', () => {
  // `src/lib/contratos-puente/contrato-v1.test.ts` (LiciColba) comprueba que su payload es EXACTAMENTE este archivo.
  const archivo = () => JSON.parse(readFileSync(new URL('./fixtures/payload-licicolba.json', import.meta.url), 'utf8'));

  it('es válido para ESCRIBIR con el validador estricto y no deja ninguna advertencia', () => {
    const r = validarContrato(archivo(), { paraEscribir: true });
    assert.equal(r.ok, true, JSON.stringify(r.errores));
    assert.deepEqual(r.advertencias, []);
  });

  it('el modo prueba lo acepta completo: tarifa, cargos con código consecutivo y sin advertencias (los cargos cuadran con la tarifa)', async () => {
    const j = await (await post(archivo())).json();
    assert.equal(j.ok, true, JSON.stringify(j));
    assert.deepEqual(j.advertencias, []);
    assert.equal(j.escribiria.tarifaInicial.tar_manoobra, 13111200);
    assert.deepEqual(j.escribiria.cargosIniciales.map((c) => [c.cargo, c.item, c.nom_cargo]), [[1, 1, 'ASEADOR'], [2, 2, 'Turnante — bloque integrado de 42h']]);
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

  it('oferta y tarifa: solo códigos, opciones y pesos enteros; con errores por campo', () => {
    const c = valido();
    c.oferta = { empresa: '0 1', undnegocio: 'BARRANQUILLA', tipoAdm: 'X', origenProceso: 'PUB', codServicio: 'ASEO', descripcionServicio: 'ñ'.repeat(255) };
    c.tarifa = { manoObra: 1.5, insumos: -1, maquinaria: '10', administrativos: Number.NaN, valorAgregado: 0, serviciosNoContinuos: 1e300 };
    const r = validarContrato(c);
    assert.equal(r.ok, false);
    assert.deepEqual(
      r.errores.map((e) => e.campo).sort(),
      ['oferta.codServicio', 'oferta.descripcionServicio', 'oferta.empresa', 'oferta.origenProceso', 'oferta.tipoAdm', 'oferta.undnegocio',
        'tarifa.administrativos', 'tarifa.insumos', 'tarifa.manoObra', 'tarifa.maquinaria', 'tarifa.serviciosNoContinuos'].sort(),
    );
  });

  it('cargos: lista de objetos con límites de las columnas reales; errores con su posición; el valor se redondea a 5 decimales', () => {
    const c = valido();
    c.cargos = [
      { nombre: 'x'.repeat(101), cantidad: 0, horasSemana: 200, jornada: 8.123, salario: -1, riesgo: 6, valorUnitario: -5, valorTotal: 'mucho', codigoHorario: '94 1', otro: 1 },
      { nombre: 'Bueno', cantidad: 2, horasSemana: 48, jornada: 8, salario: 1423500, riesgo: 1, valorUnitario: 1234567.123456789, valorTotal: 2469134.246913578 },
      'no soy un objeto',
    ];
    const r = validarContrato(c);
    assert.equal(r.ok, false);
    assert.deepEqual(
      r.errores.map((e) => e.campo).sort(),
      ['cargos[0].cantidad', 'cargos[0].codigoHorario', 'cargos[0].horasSemana', 'cargos[0].jornada', 'cargos[0].nombre', 'cargos[0].otro', 'cargos[0].riesgo',
        'cargos[0].salario', 'cargos[0].valorTotal', 'cargos[0].valorUnitario', 'cargos[2]'].sort(),
    );
    const bueno = valido();
    bueno.cargos = [c.cargos[1]];
    const ok = validarContrato(bueno);
    assert.equal(ok.ok, true);
    assert.deepEqual([ok.datos.cargos[0].valorUnitario, ok.datos.cargos[0].valorTotal], [1234567.12346, 2469134.24691], 'a la escala de la columna decimal(15,5)');
  });

  it('cargos debe ser una lista, no más de 300; vacía o ausente es una advertencia y no deja rastro en los datos (la huella no cambia)', () => {
    for (const mal of ['uno', 5, {}]) {
      const c = valido();
      c.cargos = mal;
      assert.deepEqual(validarContrato(c).errores.map((e) => e.campo), ['cargos'], String(mal));
    }
    const muchos = valido();
    muchos.cargos = Array.from({ length: 301 }, () => muchos.cargos[0]);
    assert.match(validarContrato(muchos).errores[0].mensaje, /Máximo 300 elementos/);
    for (const vacio of [[], null]) {
      const c = valido();
      c.cargos = vacio;
      const r = validarContrato(c);
      assert.equal(r.ok, true);
      assert.equal('cargos' in r.datos, false);
      assert.deepEqual(r.advertencias.map((a) => a.campo), ['cargos']);
    }
  });

  it('con «paraEscribir», lo marcado como necesario para escribir es obligatorio; sin él es solo una advertencia', () => {
    const c = valido();
    c.oferta.tipoAdm = '';
    c.tarifa.insumos = null;
    const prueba = validarContrato(c);
    assert.equal(prueba.ok, true);
    assert.deepEqual(prueba.advertencias.map((a) => a.campo).sort(), ['oferta.tipoAdm', 'tarifa.insumos']);
    const escritura = validarContrato(c, { paraEscribir: true });
    assert.equal(escritura.ok, false);
    assert.deepEqual(escritura.errores.map((e) => e.campo).sort(), ['oferta.tipoAdm', 'tarifa.insumos']);
  });

  it('la descripción del servicio es opcional también al escribir (la tarifa admite descripción vacía)', () => {
    const c = valido();
    delete c.oferta.descripcionServicio;
    assert.equal(validarContrato(c, { paraEscribir: true }).ok, true);
  });

  it('la huella no depende del orden de las claves y cambia con cualquier dato', () => {
    const a = validarContrato(valido()).datos;
    // El arreglo de claves del `stringify` fija el ORDEN de salida: aquí va distinto al del original.
    const claves = ['cargos', 'tarifa', 'oferta', 'contrato', 'cliente', 'origen', 'version', 'objeto', 'porcentajeAIU', 'valorMensual', 'plazoMeses', 'razonSocial', 'nit', 'direccion', 'solicitudId', 'procesoCodigo',
      'serviciosNoContinuos', 'valorAgregado', 'administrativos', 'maquinaria', 'insumos', 'manoObra', 'descripcionServicio', 'codServicio', 'origenProceso', 'tipoAdm', 'undnegocio', 'empresa',
      'nombre', 'cantidad', 'horasSemana', 'jornada', 'salario', 'riesgo', 'valorUnitario', 'valorTotal', 'codigoHorario'];
    const b = validarContrato(JSON.parse(JSON.stringify(valido(), claves))).datos;
    assert.equal(huella(a), huella(b));
    const c = valido();
    c.contrato.valorMensual = 5000001;
    assert.notEqual(huella(a), huella(validarContrato(c).datos));
  });
});
