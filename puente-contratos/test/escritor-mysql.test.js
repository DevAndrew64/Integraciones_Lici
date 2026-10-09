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
    [/^UPDATE fc_control/, [{ affectedRows: 1 }]],
    [/LAST_INSERT_ID\(\) AS numero/, [[{ numero: '937' }]]],
    [/COUNT\(\*\) AS n FROM fc_ofertas_adjudicadas/, [[{ n: 0 }]]],
    [/MAX\(id\)/, [[{ id: '501' }]]],
    [/^INSERT INTO fc_ofertas_adjudicadas/, [{ affectedRows: 1 }]],
    [/^INSERT INTO fc_preciosventas_oferta/, [{ affectedRows: 1 }]],
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

const escribir = (pool, d = datos(), opciones) => crearEscritorMySQL(pool, opciones).escribir(d, { huella: HUELLA });
const rechaza = async (promesa, estado, codigo) => {
  const error = await promesa.then(() => assert.fail('debía rechazar'), (e) => e);
  assert.ok(error instanceof ErrorNegocio, `se esperaba ErrorNegocio y fue: ${error}`);
  assert.equal(error.estado, estado);
  assert.equal(error.codigo, codigo);
  return error;
};
const NO_ESCRITO = ['contrato.porcentajeAIU', 'oferta.tipoAdm', 'oferta.origenProceso', 'oferta.codServicio', 'contrato.objeto', 'contrato.valorMensual', 'contrato.plazoMeses', 'cliente.direccion'];

describe('escritor MySQL — camino feliz (fc_ofertas_adjudicadas)', () => {
  it('reserva el número, escribe UNA fila de oferta adjudicada y devuelve lo escrito', async () => {
    const f = falso();
    const r = await escribir(f.pool);
    assert.equal(r.escrito.numOferta, 937);
    assert.deepEqual(r.escrito.numerosSaltados, []);
    assert.equal(r.escrito.empresa, '01');
    assert.equal(r.escrito.undnegocio, 'BAQ');
    assert.deepEqual(r.escrito.cliente, { nit: '900123456-8', rsocial: 'CLIENTE DE PRUEBA S.A.S.' }, 'el NIT y la razón social son los de Contratos, sin espacios sobrantes');
    assert.deepEqual(r.escrito.ofertaAdjudicada, {
      empresa: '01', undnegocio: 'BAQ', num_oferta: 937, nit: '900123456-8', rsocial: 'CLIENTE DE PRUEBA S.A.S.',
      vlr_adjudicado: 61155743 + 1000000 + 500000 + 5000000 + 0 + 250000,
      vlr_manoobra: 61155743, vlr_insumos: 1000000, vlr_maquinaria: 500000, vlr_impuestos: 5000000, vlr_otros: 0, vlr_nocontinuos: 250000,
      user_add: 'LICICOLBA', fadd: 'NOW()', pc_add: 'LICICOLBA:42:ab12cd34ef56',
    });
    assert.deepEqual(r.advertencias, []);
    assert.deepEqual(r.noEscrito.map((n) => n.campo), NO_ESCRITO);
    assert.equal(f.sentencias.filter((s) => /^INSERT/.test(s.sql)).length, 1);
    assert.ok(!f.hubo(/_iniciales/), 'ya no toca las tablas *_iniciales');
  });

  it('las sentencias salen en orden: candado, reenvío, cliente, contador, número libre, BEGIN, INSERT, COMMIT, candado', async () => {
    const f = falso();
    await escribir(f.pool);
    const orden = [/GET_LOCK/, /pc_add LIKE/, /FROM fc_clientes/, /^SELECT empresa, undnegocio FROM fc_control/, /^UPDATE fc_control/, /LAST_INSERT_ID\(\)/,
      /COUNT\(\*\) AS n FROM fc_ofertas_adjudicadas/, /^BEGIN$/, /^INSERT INTO fc_ofertas_adjudicadas/, /^COMMIT$/, /RELEASE_LOCK/, /^RELEASE$/];
    const posiciones = orden.map((p) => f.indice(p));
    assert.ok(posiciones.every((i) => i >= 0), `faltan sentencias: ${posiciones}`);
    assert.deepEqual([...posiciones].sort((a, b) => a - b), posiciones, 'fuera de orden');
    assert.ok(!f.hubo(/MAX\(id\)/), 'con id auto_increment el puente no lo calcula');
  });

  it('el UPDATE del contador es UNO atómico y solo toca num_oferta; nunca se lee la fila completa de fc_control', async () => {
    const f = falso();
    await escribir(f.pool);
    const actualizacion = f.sentencias.find((s) => /^UPDATE fc_control/.test(s.sql));
    assert.equal(actualizacion.sql, 'UPDATE fc_control SET num_oferta = LAST_INSERT_ID(COALESCE(num_oferta, 0) + 1) WHERE empresa = ? AND undnegocio = ?');
    assert.deepEqual(actualizacion.params, ['01', 'BAQ']);
    for (const s of f.sentencias.filter((x) => /fc_control/.test(x.sql))) assert.doesNotMatch(s.sql, /SELECT \*|SELECT\s+\w*\s*\*/);
  });

  it('el INSERT lleva parámetros, NOW() va en el SQL y no como dato, sin id (auto_increment) y con la marca en pc_add', async () => {
    const f = falso();
    await escribir(f.pool);
    const insert = f.sentencias.find((s) => /^INSERT/.test(s.sql));
    assert.equal(insert.sql, 'INSERT INTO fc_ofertas_adjudicadas (empresa, undnegocio, num_oferta, nit, rsocial, vlr_adjudicado, vlr_manoobra, vlr_insumos, vlr_maquinaria, vlr_impuestos, vlr_otros, vlr_nocontinuos, user_add, fadd, pc_add) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)');
    assert.equal(insert.params.length, 14);
    assert.equal(insert.params.at(-1), 'LICICOLBA:42:ab12cd34ef56');
    assert.ok(!insert.params.includes(undefined));
  });

  it('si el id NO es auto_increment en esa base, lo asigna MAX(id) + 1 dentro de la transacción, antes del INSERT', async () => {
    const f = falso();
    const r = await escribir(f.pool, datos(), { idManual: true });
    const [inicio, maximo, insert, fin] = [/^BEGIN$/, /MAX\(id\)/, /^INSERT/, /^COMMIT$/].map((p) => f.indice(p));
    assert.ok(inicio < maximo && maximo < insert && insert < fin);
    assert.match(f.sentencias[maximo].sql, /FOR UPDATE$/);
    assert.match(f.sentencias[insert].sql, /, id\) VALUES/);
    assert.equal(f.sentencias[insert].params.at(-1), 501);
    assert.equal(r.escrito.numOferta, 937);
  });

  it('user_add y pc_add se ajustan al largo real de las columnas', async () => {
    const f = falso();
    await escribir(f.pool, datos(), { largoUserAdd: 6, largoPcAdd: 20 });
    const insert = f.sentencias.find((s) => /^INSERT/.test(s.sql));
    assert.ok(insert.params.includes('LICICO') && insert.params.includes('LICICOLBA:42:'));
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
    assert.equal(r.escrito.ofertaAdjudicada.nit, '900123456-5');
    assert.equal(r.escrito.ofertaAdjudicada.rsocial, 'OTRA RAZON SOCIAL LTDA');
  });

  it('la clave de la oferta se escribe como está en Contratos aunque llegue en minúsculas', async () => {
    const f = falso();
    const r = await escribir(f.pool, datos((e) => { e.oferta.undnegocio = 'baq'; }));
    assert.equal(r.escrito.undnegocio, 'BAQ');
    assert.equal(r.escrito.ofertaAdjudicada.undnegocio, 'BAQ');
  });

  it('los cargos no se escriben (no hay dónde en esta base): se informan como no escritos', async () => {
    const f = falso();
    const r = await escribir(f.pool, datos((e) => {
      e.tarifa.manoObra = 11232000;
      e.cargos = [{ nombre: 'Aseador', cantidad: 1, horasSemana: 48, jornada: 8, salario: 1423500, riesgo: 1, valorUnitario: 10000000, valorTotal: 10000000 }];
    }));
    assert.ok(r.noEscrito.some((n) => n.campo === 'cargos'));
    assert.equal(f.sentencias.filter((s) => /^INSERT/.test(s.sql)).length, 1);
  });
});

describe('escritor MySQL — reenvío y concurrencia', () => {
  const previa = (pc_add) => ({ [/pc_add LIKE/.source]: [[{ empresa: '01', undnegocio: 'BAQ', num_oferta: '930', pc_add }]] });

  it('una solicitud ya enviada responde 409 con la oferta existente y NO reserva número ni escribe', async () => {
    const f = falso(previa('LICICOLBA:42:ab12cd34ef56'));
    const error = await rechaza(escribir(f.pool), 409, 'YA_ENVIADA');
    assert.deepEqual(error.extra.oferta, { empresa: '01', undnegocio: 'BAQ', numOferta: 930 });
    assert.equal(error.extra.sinCambios, true);
    const consulta = f.sentencias.find((s) => /pc_add LIKE/.test(s.sql));
    assert.match(consulta.sql, /FROM fc_ofertas_adjudicadas WHERE pc_add LIKE \?/);
    assert.deepEqual(consulta.params, ['LICICOLBA:42:%']);
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
    });
    const error = await rechaza(escribir(f.pool, datos((e) => (e.tarifa.manoObra = 2_147_483_647))), 422, 'DATOS_INVALIDOS');
    assert.deepEqual(error.extra.errores.map((e) => e.campo), ['cliente.nit', 'oferta.undnegocio', 'tarifa']);
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
  /** Contador que avanza en cada UPDATE; los números de `usados` ya existen en fc_ofertas_adjudicadas. */
  function contador(inicio, usados) {
    let actual = inicio;
    return {
      [/^UPDATE fc_control/.source]: () => { actual += 1; return [{ affectedRows: 1 }]; },
      [/LAST_INSERT_ID\(\) AS numero/.source]: () => [[{ numero: String(actual) }]],
      [/COUNT\(\*\) AS n FROM fc_ofertas_adjudicadas/.source]: (params) => [[{ n: usados.includes(params[2]) ? 1 : 0 }]],
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
    const f = falso({ [/^INSERT INTO fc_ofertas_adjudicadas/.source]: () => { throw Object.assign(new Error('Data too long for column x'), { errno: 1406, code: 'ER_DATA_TOO_LONG' }); } });
    const error = await rechaza(escribir(f.pool), 422, 'DATOS_INVALIDOS');
    assert.equal(error.extra.numeroPerdido, 937);
    assert.match(error.extra.errores[0].mensaje, /1406/);
    assert.doesNotMatch(JSON.stringify(error.extra), /Data too long/, 'el mensaje de MySQL no sale');
    assert.ok(f.hubo(/^ROLLBACK$/) && !f.hubo(/^COMMIT$/));
    assert.ok(f.hubo(/RELEASE_LOCK/) && f.sentencias.at(-1).sql === 'RELEASE');
  });

  it('una columna obligatoria sin valor por defecto (1364) también es un dato que Contratos no acepta, sin filtrar el mensaje', async () => {
    const f = falso({ [/^INSERT INTO fc_ofertas_adjudicadas/.source]: () => { throw Object.assign(new Error("Field 'x' doesn't have a default value"), { errno: 1364 }); } });
    const error = await rechaza(escribir(f.pool), 422, 'DATOS_INVALIDOS');
    assert.match(error.extra.errores[0].mensaje, /1364/);
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

describe('escritor MySQL — lista de precios de insumos (módulo 6)', () => {
  const conInsumos = () => datos((e) => {
    e.insumos = [{ codigo: '18111', nombre: 'Jabón', valorUnitario: 10000 }, { codigo: '01050', valorUnitario: 500 }];
  });

  it('escribe la oferta y una fila por insumo en la MISMA transacción, la oferta primero, con el número reservado', async () => {
    const f = falso();
    const r = await escribir(f.pool, conInsumos());
    const precios = f.sentencias.filter((s) => /^INSERT INTO fc_preciosventas_oferta/.test(s.sql));
    assert.equal(precios.length, 2);
    const [inicio, oferta, fin] = [/^BEGIN$/, /^INSERT INTO fc_ofertas_adjudicadas/, /^COMMIT$/].map((p) => f.indice(p));
    const posiciones = f.sentencias.map((s, i) => (/^INSERT INTO fc_preciosventas_oferta/.test(s.sql) ? i : -1)).filter((i) => i >= 0);
    assert.ok(posiciones.every((i) => i > oferta && i < fin) && inicio < oferta);
    assert.match(precios[0].sql, /^INSERT INTO fc_preciosventas_oferta \(undnegocio, num_oferta, ncontrato, cliente, nom_punto, codigo, valor, valor_anterior, aiu, fadd, user_add, vr_costo\) VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, NOW\(\), \?, \?\)$/);
    assert.deepEqual(precios[0].params, ['BAQ', 937, '', 'tmp1', 'BAQ', '18111', 11232, 0, '0.1232', 'LICICOLBA', 10000]);
    assert.deepEqual(r.escrito.preciosOferta, [{ codigo: '18111', vr_costo: 10000, valor: 11232 }, { codigo: '01050', vr_costo: 500, valor: 561.6 }]);
  });

  it('si falla una fila de precios se revierte TODO (también la oferta) y el número se pierde', async () => {
    const f = falso({ [/^INSERT INTO fc_preciosventas_oferta/.source]: () => { throw Object.assign(new Error('Data too long'), { errno: 1406 }); } });
    const error = await rechaza(escribir(f.pool, conInsumos()), 422, 'DATOS_INVALIDOS');
    assert.equal(error.extra.numeroPerdido, 937);
    assert.ok(f.hubo(/^ROLLBACK$/) && !f.hubo(/^COMMIT$/));
  });

  it('sin insumos no toca fc_preciosventas_oferta', async () => {
    const f = falso();
    const r = await escribir(f.pool);
    assert.ok(!f.hubo(/fc_preciosventas_oferta/));
    assert.deepEqual(r.escrito.preciosOferta, []);
  });
});
