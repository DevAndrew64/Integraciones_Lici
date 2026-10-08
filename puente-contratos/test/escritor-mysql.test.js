import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErrorNegocio } from '../src/errores.js';
import { crearEscritorMySQL } from '../src/escritor-mysql.js';
import { validarContrato } from '../src/validar.js';

const entrada = () => ({
  version: 1,
  origen: { solicitudId: 42, procesoCodigo: 'SED-LP-2026-0091' },
  cliente: { razonSocial: 'Cliente de Prueba S.A.S.', nit: '900123456', direccion: 'Calle 1 # 2-3' },
  contrato: { objeto: 'Servicio de aseo integral', porcentajeAIU: 12.32, valorMensual: 5000000, plazoMeses: 12 },
  oferta: { empresa: '01', undnegocio: 'BAQ', tipoAdm: 'A', origenProceso: 'LIC', codServicio: 'ASE', descripcionServicio: 'Aseo y cafetería' },
  tarifa: { manoObra: 61155743, insumos: 1000000, maquinaria: 500000, administrativos: 5000000, valorAgregado: 0, serviciosNoContinuos: 250000 },
});
const datos = (cambiar = () => {}) => {
  const e = entrada();
  cambiar(e);
  const r = validarContrato(e, { paraEscribir: true });
  assert.equal(r.ok, true, JSON.stringify(r.errores));
  return r.datos;
};
const HUELLA = 'ab12cd34ef56a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6';

/**
 * Pool falso que responde por patrón (el primero que coincide) y registra todo lo que se le pide. Las respuestas imitan lo
 * que devuelve mysql2: `[filas]` en los SELECT y `[{affectedRows}]` en los UPDATE/INSERT.
 */
function falso(respuestas = {}) {
  const sentencias = [];
  const reglas = [
    [/GET_LOCK/, [[{ ok: 1 }]]],
    [/RELEASE_LOCK/, [[{ ok: 1 }]]],
    [/pc_add LIKE/, [[]]],
    [/FROM fc_clientes/, [[{ nit: '900123456-8  ', rsocial: 'CLIENTE DE PRUEBA S.A.S.' }]]],
    [/^SELECT empresa, undnegocio FROM fc_control/, [[{ empresa: '01', undnegocio: 'BAQ' }]]],
    [/FROM fc_conceptos/, [[{ empresa: '01', undnegocio: 'BAQ', codcpto: 'ASE' }]]],
    [/^UPDATE fc_control/, [{ affectedRows: 1 }]],
    [/LAST_INSERT_ID\(\) AS numero/, [[{ numero: '937' }]]],
    [/COUNT\(\*\) AS n FROM fc_contratos_tarifa_inicial/, [[{ n: 0 }]]],
    [/FROM fc_horarios/, [[{ codigo: '941' }]]],
    [/^INSERT INTO fc_contratos_tarifa_inicial/, [{ affectedRows: 1 }]],
    [/^INSERT INTO fc_contratos_cargos_iniciales/, [{ affectedRows: 1 }]],
  ].map(([patron, valor]) => [patron, respuestas[patron.source] ?? valor]);
  const conexion = {
    async query(sql, params = []) {
      const limpio = sql.replace(/\s+/g, ' ').trim();
      sentencias.push({ sql: limpio, params });
      const regla = reglas.find(([patron]) => patron.test(limpio));
      if (!regla) throw new Error(`Sin respuesta en la prueba para: ${limpio}`);
      const [, valor] = regla;
      return typeof valor === 'function' ? valor(params, limpio) : valor;
    },
    async ping() {},
    destroy() { sentencias.push({ sql: 'DESTROY' }); },
    async beginTransaction() { sentencias.push({ sql: 'BEGIN' }); },
    async commit() { sentencias.push({ sql: 'COMMIT' }); },
    async rollback() { sentencias.push({ sql: 'ROLLBACK' }); },
    release() { sentencias.push({ sql: 'RELEASE' }); },
  };
  const pool = { async getConnection() { return conexion; } };
  const indice = (patron) => sentencias.findIndex((s) => patron.test(s.sql));
  const hubo = (patron) => indice(patron) >= 0;
  return { pool, sentencias, indice, hubo };
}

const escribir = (pool, d = datos()) => crearEscritorMySQL(pool).escribir(d, { huella: HUELLA });
const rechaza = async (promesa, estado, codigo) => {
  const error = await promesa.then(() => assert.fail('debía rechazar'), (e) => e);
  assert.ok(error instanceof ErrorNegocio, `se esperaba ErrorNegocio y fue: ${error}`);
  assert.equal(error.estado, estado);
  assert.equal(error.codigo, codigo);
  return error;
};

describe('escritor MySQL — camino feliz', () => {
  it('reserva el número, escribe la tarifa en una transacción y devuelve lo escrito', async () => {
    const f = falso();
    const r = await escribir(f.pool);
    assert.equal(r.escrito.numOferta, 937);
    assert.deepEqual(r.escrito.numerosSaltados, []);
    assert.equal(r.escrito.empresa, '01');
    assert.equal(r.escrito.undnegocio, 'BAQ');
    assert.deepEqual(r.escrito.cliente, { nit: '900123456-8', rsocial: 'CLIENTE DE PRUEBA S.A.S.' }, 'el NIT y la razón social son los de Contratos, sin espacios sobrantes');
    assert.equal(r.escrito.tarifa.num_oferta, 937);
    assert.equal(r.escrito.tarifa.fadd, 'NOW()');
    assert.deepEqual(r.advertencias, []);
    assert.deepEqual(r.noEscrito.map((n) => n.campo), ['contrato.objeto', 'contrato.valorMensual', 'contrato.plazoMeses', 'cliente.direccion']);
  });

  it('las sentencias salen en el orden de Visual FoxPro: candado, reenvío, validaciones, contador, número libre, BEGIN, INSERT, COMMIT, candado', async () => {
    const f = falso();
    await escribir(f.pool);
    const orden = [/GET_LOCK/, /pc_add LIKE/, /FROM fc_clientes/, /^SELECT empresa, undnegocio FROM fc_control/, /FROM fc_conceptos/, /^UPDATE fc_control/, /LAST_INSERT_ID\(\)/,
      /COUNT\(\*\) AS n FROM fc_contratos_tarifa_inicial/, /^BEGIN$/, /^INSERT INTO fc_contratos_tarifa_inicial/, /^COMMIT$/, /RELEASE_LOCK/, /^RELEASE$/];
    const posiciones = orden.map((p) => f.indice(p));
    assert.ok(posiciones.every((i) => i >= 0), `faltan sentencias: ${posiciones}`);
    assert.deepEqual([...posiciones].sort((a, b) => a - b), posiciones, 'fuera de orden');
    assert.equal(f.sentencias.filter((s) => /^INSERT/.test(s.sql)).length, 1);
  });

  it('el UPDATE del contador es UNO atómico y solo toca num_oferta; nunca se lee la fila completa de fc_control', async () => {
    const f = falso();
    await escribir(f.pool);
    const actualizacion = f.sentencias.find((s) => /^UPDATE fc_control/.test(s.sql));
    assert.equal(actualizacion.sql, 'UPDATE fc_control SET num_oferta = LAST_INSERT_ID(COALESCE(num_oferta, 0) + 1) WHERE empresa = ? AND undnegocio = ?');
    assert.deepEqual(actualizacion.params, ['01', 'BAQ']);
    for (const s of f.sentencias.filter((x) => /fc_control/.test(x.sql))) assert.doesNotMatch(s.sql, /SELECT \*|SELECT\s+\w*\s*\*/);
  });

  it('el INSERT lleva parámetros, NOW() va en el SQL y no como dato, y la marca de origen queda en pc_add', async () => {
    const f = falso();
    await escribir(f.pool);
    const insert = f.sentencias.find((s) => /^INSERT/.test(s.sql));
    assert.match(insert.sql, /^INSERT INTO fc_contratos_tarifa_inicial \(empresa, undnegocio, num_oferta, ncontrato, nit, rsocial,/);
    assert.match(insert.sql, /user_add, fadd, pc_add, tar_insumos, tar_maquinaria, tar_otros, tar_nocontinuos\) VALUES \(/);
    assert.match(insert.sql, /\?, NOW\(\), \?, \?, \?, \?, \?\)$/);
    assert.equal((insert.sql.match(/\?/g) ?? []).length, insert.params.length);
    assert.equal(insert.params.length, 33, '34 columnas menos fadd, que es NOW()');
    assert.ok(insert.params.includes('LICICOLBA:42:ab12cd34ef56'));
    assert.ok(insert.params.includes('0.1232'), 'el A.I.U. viaja como texto decimal exacto, no como número de coma flotante');
    assert.ok(!insert.params.includes(undefined));
  });

  it('el candado y la conexión se liberan siempre', async () => {
    const f = falso();
    await escribir(f.pool);
    assert.equal(f.sentencias.at(-1).sql, 'RELEASE');
    assert.ok(f.hubo(/RELEASE_LOCK/));
  });

  it('avisa (sin bloquear) si la razón social o el dígito de verificación difieren; escribe lo de Contratos', async () => {
    const f = falso({ [/FROM fc_clientes/.source]: [[{ nit: '900123456-5', rsocial: 'OTRA RAZON SOCIAL LTDA' }]] });
    const r = await escribir(f.pool);
    assert.deepEqual(r.advertencias.map((a) => a.campo), ['cliente.razonSocial', 'cliente.nit']);
    assert.equal(r.escrito.tarifa.nit, '900123456-5');
    assert.equal(r.escrito.tarifa.rsocial, 'OTRA RAZON SOCIAL LTDA');
  });

  it('un cliente guardado sin dígito de verificación se respeta tal cual (la unión con el cliente es por igualdad)', async () => {
    const f = falso({ [/FROM fc_clientes/.source]: [[{ nit: '900123456', rsocial: 'Cliente de Prueba S.A.S.' }]] });
    const r = await escribir(f.pool);
    assert.equal(r.escrito.tarifa.nit, '900123456');
    assert.deepEqual(r.advertencias, []);
  });

  it('la clave de la oferta se escribe como está en Contratos aunque llegue en minúsculas', async () => {
    const f = falso();
    const r = await escribir(f.pool, datos((e) => { e.oferta.undnegocio = 'baq'; e.oferta.codServicio = 'ase'; }));
    assert.equal(r.escrito.undnegocio, 'BAQ');
    assert.equal(r.escrito.tarifa.undnegocio, 'BAQ');
    assert.equal(r.escrito.tarifa.codservicio, 'ASE');
    assert.deepEqual(r.advertencias, []);
  });

  it('un concepto que existe solo para otra empresa o UEN es una advertencia, no un bloqueo', async () => {
    const f = falso({ [/FROM fc_conceptos/.source]: [[{ empresa: '02', undnegocio: 'BOG', codcpto: 'ASE' }]] });
    const r = await escribir(f.pool);
    assert.deepEqual(r.advertencias.map((a) => a.campo), ['oferta.codServicio']);
    assert.equal(r.escrito.numOferta, 937);
  });
});

describe('escritor MySQL — reenvío y concurrencia', () => {
  const previa = (pc_add) => ({ [/pc_add LIKE/.source]: [[{ empresa: '01', undnegocio: 'BAQ', num_oferta: '930', pc_add }]] });

  it('una solicitud ya enviada responde 409 con la oferta existente y NO reserva número ni escribe', async () => {
    const f = falso(previa('LICICOLBA:42:ab12cd34ef56'));
    const error = await rechaza(escribir(f.pool), 409, 'YA_ENVIADA');
    assert.deepEqual(error.extra.oferta, { empresa: '01', undnegocio: 'BAQ', numOferta: 930 });
    assert.equal(error.extra.sinCambios, true);
    assert.ok(!f.hubo(/^UPDATE/) && !f.hubo(/^INSERT/) && !f.hubo(/^BEGIN/));
    assert.ok(f.hubo(/RELEASE_LOCK/) && f.sentencias.at(-1).sql === 'RELEASE', 'el candado se libera aunque no se escriba');
  });

  it('si lo reenviado cambió de contenido lo dice (sinCambios = false): la oferta de Contratos tiene lo anterior', async () => {
    const error = await rechaza(escribir(falso(previa('LICICOLBA:42:000000000000')).pool), 409, 'YA_ENVIADA');
    assert.equal(error.extra.sinCambios, false);
  });

  it('si otro envío de la misma solicitud tiene el candado, responde 409 OCUPADO y no toca nada', async () => {
    const f = falso({ [/GET_LOCK/.source]: [[{ ok: 0 }]] });
    await rechaza(escribir(f.pool), 409, 'OCUPADO');
    assert.ok(!f.hubo(/pc_add LIKE/) && !f.hubo(/^UPDATE/) && !f.hubo(/^INSERT/));
    assert.ok(!f.hubo(/RELEASE_LOCK/), 'no se libera un candado que no se tiene');
    assert.equal(f.sentencias.at(-1).sql, 'RELEASE');
  });
});

describe('escritor MySQL — lo que debe existir en Contratos', () => {
  it('junta TODOS los problemas en un solo 422 y no reserva ningún número', async () => {
    const f = falso({
      [/FROM fc_clientes/.source]: [[]],
      [/^SELECT empresa, undnegocio FROM fc_control/.source]: [[]],
      [/FROM fc_conceptos/.source]: [[]],
    });
    const error = await rechaza(escribir(f.pool, datos((e) => (e.contrato.porcentajeAIU = 0))), 422, 'DATOS_INVALIDOS');
    assert.deepEqual(error.extra.errores.map((e) => e.campo), ['cliente.nit', 'oferta.undnegocio', 'oferta.codServicio', 'contrato.porcentajeAIU']);
    assert.match(error.extra.errores[0].mensaje, /900123456/);
    assert.ok(!f.hubo(/^UPDATE/) && !f.hubo(/^INSERT/));
  });

  it('un contador duplicado para (empresa, UEN) es un problema de Contratos: 409, sin reservar', async () => {
    const f = falso({ [/^SELECT empresa, undnegocio FROM fc_control/.source]: [[{ empresa: '01', undnegocio: 'BAQ' }, { empresa: '01', undnegocio: 'BAQ' }]] });
    await rechaza(escribir(f.pool), 409, 'CONTADOR_AMBIGUO');
    assert.ok(!f.hubo(/^UPDATE/));
  });

  it('el cliente se busca por la BASE del NIT (sin DV ni puntos) y se prefiere el de la misma UEN, sucursal 00', async () => {
    const f = falso();
    await escribir(f.pool);
    const consulta = f.sentencias.find((s) => /FROM fc_clientes/.test(s.sql));
    assert.match(consulta.sql, /SUBSTRING_INDEX\(TRIM\(nit\), '-', 1\)/);
    assert.match(consulta.sql, /ORDER BY \(undnegocio = \?\) DESC, \(sucursal = '00'\) DESC, sucursal LIMIT 1$/);
    assert.deepEqual(consulta.params, ['900123456', 'BAQ']);
  });
});

describe('escritor MySQL — número de oferta', () => {
  /** Contador que avanza en cada UPDATE; los números de `usados` ya existen en la tarifa. */
  function contador(inicio, usados) {
    let actual = inicio;
    return {
      [/^UPDATE fc_control/.source]: () => { actual += 1; return [{ affectedRows: 1 }]; },
      [/LAST_INSERT_ID\(\) AS numero/.source]: () => [[{ numero: String(actual) }]],
      [/COUNT\(\*\) AS n FROM fc_contratos_tarifa_inicial/.source]: (params) => [[{ n: usados.includes(params[2]) ? 1 : 0 }]],
    };
  }

  it('si el contador iba por detrás de lo ya usado, descarta esos números y toma el siguiente libre', async () => {
    const f = falso(contador(935, [936, 937]));
    const r = await escribir(f.pool);
    assert.equal(r.escrito.numOferta, 938);
    assert.deepEqual(r.escrito.numerosSaltados, [936, 937]);
    assert.equal(f.sentencias.filter((s) => /^UPDATE fc_control/.test(s.sql)).length, 3);
  });

  it('tras tres números en uso se rinde con 409 y no escribe', async () => {
    const f = falso(contador(935, [936, 937, 938, 939]));
    const error = await rechaza(escribir(f.pool), 409, 'NUMERO_OFERTA_EN_USO');
    assert.deepEqual(error.extra.numerosEnUso, [936, 937, 938]);
    assert.ok(!f.hubo(/^INSERT/) && !f.hubo(/^BEGIN/));
  });

  it('si el UPDATE no afecta exactamente una fila, no se usa el número', async () => {
    const f = falso({ [/^UPDATE fc_control/.source]: [{ affectedRows: 2 }] });
    await rechaza(escribir(f.pool), 409, 'CONTADOR_AMBIGUO');
    assert.ok(!f.hubo(/^INSERT/));
  });
});

describe('escritor MySQL — fallos', () => {
  it('si el INSERT falla se revierte, el número reservado se informa como perdido y el candado se libera', async () => {
    const f = falso({ [/^INSERT INTO fc_contratos_tarifa_inicial/.source]: () => { throw Object.assign(new Error('Data too long for column x'), { errno: 1406, code: 'ER_DATA_TOO_LONG' }); } });
    const error = await rechaza(escribir(f.pool), 422, 'DATOS_INVALIDOS');
    assert.equal(error.extra.numeroPerdido, 937);
    assert.match(error.extra.errores[0].mensaje, /1406/);
    assert.doesNotMatch(JSON.stringify(error.extra), /Data too long/, 'el mensaje de MySQL no sale');
    assert.ok(f.hubo(/^ROLLBACK$/) && !f.hubo(/^COMMIT$/));
    assert.ok(f.hubo(/RELEASE_LOCK/) && f.sentencias.at(-1).sql === 'RELEASE');
  });

  it('una conexión del pool que el servidor ya cerró se descarta y se usa otra (la primera oferta del día no falla)', async () => {
    const f = falso();
    const buena = await f.pool.getConnection();
    const muerta = { ...buena, async ping() { throw Object.assign(new Error('Connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' }); }, destroy() { f.sentencias.push({ sql: 'DESTROY' }); } };
    const entregas = [muerta, buena];
    const pool = { async getConnection() { return entregas.shift() ?? buena; } };
    const r = await escribir(pool);
    assert.equal(r.escrito.numOferta, 937);
    assert.equal(f.sentencias.filter((s) => s.sql === 'DESTROY').length, 1);
  });

  it('si la base no responde, 503 sin detalles', async () => {
    const pool = { async getConnection() { throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:3306'), { code: 'ECONNREFUSED' }); } };
    const error = await rechaza(escribir(pool), 503, 'BD_NO_DISPONIBLE');
    assert.doesNotMatch(error.message, /10\.0\.0\.5/);
  });

  it('un fallo desconocido sube tal cual (la capa HTTP responde 500 sin filtrarlo) y aun así libera todo', async () => {
    const f = falso({ [/FROM fc_clientes/.source]: () => { throw new Error('fallo raro'); } });
    const error = await escribir(f.pool).then(() => assert.fail('debía fallar'), (e) => e);
    assert.equal(error.message, 'fallo raro');
    assert.ok(!(error instanceof ErrorNegocio));
    assert.equal(f.sentencias.at(-1).sql, 'RELEASE');
    assert.ok(f.hubo(/RELEASE_LOCK/));
  });
});

describe('escritor MySQL — cargos', () => {
  const CARGOS = () => [
    { nombre: 'Aseador', cantidad: 4, horasSemana: 48, jornada: 8, salario: 1423500, riesgo: 1, valorUnitario: 10000000, valorTotal: 40000000, codigoHorario: '941' },
    { nombre: 'Aseador', cantidad: 2, horasSemana: 44, jornada: 7.33, salario: 1423500, riesgo: 1, valorUnitario: 5000000, valorTotal: 10000000 },
    { nombre: 'Supervisor', cantidad: 1, horasSemana: 48, jornada: 8, salario: 2500000, riesgo: 2, valorUnitario: 2500000, valorTotal: 2500000 },
  ];
  /** 52.500.000 sin A.I.U. son 58.968.000 con el 12,32 %. */
  const conCargos = (cambiar = () => {}) =>
    datos((e) => {
      e.tarifa.manoObra = 58968000;
      e.cargos = CARGOS();
      cambiar(e);
    });

  it('escribe la tarifa y TODOS sus cargos en la misma transacción, la tarifa primero', async () => {
    const f = falso();
    const r = await escribir(f.pool, conCargos());
    const posiciones = [/^BEGIN$/, /^INSERT INTO fc_contratos_tarifa_inicial/, /^INSERT INTO fc_contratos_cargos_iniciales/, /^COMMIT$/].map((p) => f.indice(p));
    assert.ok(posiciones.every((i) => i >= 0) && [...posiciones].sort((a, b) => a - b).join() === posiciones.join(), `fuera de orden: ${posiciones}`);
    const inserts = f.sentencias.filter((s) => /^INSERT INTO fc_contratos_cargos_iniciales/.test(s.sql));
    assert.equal(inserts.length, 3);
    assert.ok(f.indice(/^COMMIT$/) > f.sentencias.map((s) => /^INSERT INTO fc_contratos_cargos_iniciales/.test(s.sql)).lastIndexOf(true));
    assert.deepEqual(r.escrito.cargos, [
      { item: 1, cargo: 1, nombre: 'Aseador', cantidad: 4 },
      { item: 2, cargo: 1, nombre: 'Aseador', cantidad: 2 },
      { item: 3, cargo: 2, nombre: 'Supervisor', cantidad: 1 },
    ]);
    assert.deepEqual(r.advertencias, []);
  });

  it('cada cargo lleva el número de oferta reservado, la marca de origen y NOW() en el SQL; el horario solo si viene', async () => {
    const f = falso();
    await escribir(f.pool, conCargos());
    const [uno, dos] = f.sentencias.filter((s) => /^INSERT INTO fc_contratos_cargos_iniciales/.test(s.sql));
    assert.match(uno.sql, /\(empresa, undnegocio, ncontrato, num_oferta, consec, concepto, cod_seccion, tipo_cargo, item, cargo,/);
    assert.match(uno.sql, /user_add, fadd, pc_add, codhorario\) VALUES/);
    assert.doesNotMatch(dos.sql, /codhorario/);
    assert.equal((uno.sql.match(/\?/g) ?? []).length, uno.params.length);
    assert.equal(uno.params.length, 47, '48 columnas (47 + horario) menos fadd, que es NOW()');
    assert.ok(uno.params.includes(937) && uno.params.includes('LICICOLBA:42:ab12cd34ef56') && uno.params.includes('941'));
    assert.ok(!uno.params.includes(undefined));
  });

  it('un horario que no existe en Contratos es un error por línea, junto con los demás, y no reserva ningún número', async () => {
    const f = falso({ [/FROM fc_horarios/.source]: [[]] });
    const error = await rechaza(escribir(f.pool, conCargos()), 422, 'DATOS_INVALIDOS');
    assert.deepEqual(error.extra.errores.map((e) => e.campo), ['cargos[0].codigoHorario']);
    assert.match(error.extra.errores[0].mensaje, /941/);
    assert.ok(!f.hubo(/^UPDATE/) && !f.hubo(/^INSERT/));
  });

  it('sin horarios en los cargos ni siquiera consulta fc_horarios', async () => {
    const f = falso();
    await escribir(f.pool, conCargos((e) => { e.cargos[0].codigoHorario = null; }));
    assert.ok(!f.hubo(/FROM fc_horarios/));
  });

  it('un valor total que no cuadra con unitario × cantidad bloquea el envío (error de LiciColba), sin reservar número', async () => {
    const f = falso();
    const error = await rechaza(escribir(f.pool, conCargos((e) => { e.cargos[2].valorTotal = 1; })), 422, 'DATOS_INVALIDOS');
    assert.deepEqual(error.extra.errores.map((e) => e.campo), ['cargos[2].valorTotal']);
    assert.ok(!f.hubo(/^UPDATE/));
  });

  it('si falla el INSERT de un cargo se revierte TODO (también la tarifa) y el número se pierde', async () => {
    let n = 0;
    const f = falso({
      [/^INSERT INTO fc_contratos_cargos_iniciales/.source]: () => {
        n += 1;
        if (n === 2) throw Object.assign(new Error('Data too long'), { errno: 1406 });
        return [{ affectedRows: 1 }];
      },
    });
    const error = await rechaza(escribir(f.pool, conCargos()), 422, 'DATOS_INVALIDOS');
    assert.equal(error.extra.numeroPerdido, 937);
    assert.ok(f.hubo(/^ROLLBACK$/) && !f.hubo(/^COMMIT$/));
    assert.equal(f.sentencias.filter((s) => /^INSERT INTO fc_contratos_cargos_iniciales/.test(s.sql)).length, 2, 'no sigue después del fallo');
  });

  it('avisa si los cargos no suman lo que equivale la mano de obra, pero escribe', async () => {
    const r = await escribir(falso().pool, conCargos((e) => { e.tarifa.manoObra = 70000000; }));
    assert.deepEqual(r.advertencias.map((a) => a.campo), ['cargos']);
    assert.equal(r.escrito.cargos.length, 3);
  });

  it('sin cargos escribe solo la tarifa, como en el módulo 4', async () => {
    const f = falso();
    const r = await escribir(f.pool, datos());
    assert.equal(f.sentencias.filter((s) => /cargos_iniciales/.test(s.sql)).length, 0);
    assert.deepEqual(r.escrito.cargos, []);
  });
});
