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

/** Filas de `nominabq.cargos` como vienen de la base: los de la sede (01/BAQ) y los generales, operativos (sin empresa ni UEN). */
const NOMINA = () => [
  { id: 1, empresa: '01', undnegocio: 'BAQ', codigo: 1, nombre: 'GERENTE GENERAL' },
  { id: 104, empresa: '01', undnegocio: 'BAQ', codigo: 104, nombre: 'SUPERVISOR' },
  { id: 99, empresa: '', undnegocio: '', codigo: 99, nombre: 'ASEADOR' },
  { id: 339, empresa: '', undnegocio: '', codigo: 339, nombre: 'SUPERVISOR' },
  { id: 426, empresa: '', undnegocio: '', codigo: 426, nombre: 'TURNANTE' },
  { id: 500, empresa: '02', undnegocio: 'MED', codigo: 500, nombre: 'CONDUCTOR' },
];

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
    [/AS sector, COUNT/, [[{ sector: 'Comercial', veces: 7, ultima: null }]]],
    [/^SELECT empresa, undnegocio FROM fc_control/, [[{ empresa: '01', undnegocio: 'BAQ' }]]],
    [/FROM act_subtipos/, [[{ id: 9, uen: 'MNA', grupo: '004', subtipo: '096', dtipo: '025' }, { id: 7, uen: '', grupo: '004', subtipo: '096', dtipo: '018' }]]],
    [/FROM fc_conceptos_costos_admtivos/, [[{ id: 1, descripcion: 'PÓLIZAS' }, { id: 2, descripcion: 'IMPUESTOS' }, { id: 6, descripcion: 'PAPELERÍA Y OFICINAS  ' }, { id: 11, descripcion: 'OTROS' }]]],
    [/FROM fc_conceptos/, [[{ empresa: '01', undnegocio: 'BAQ', codcpto: 'ASE' }]]],
    [/FROM fc_horarios/, [[{ codigo: '941' }]]],
    [/FROM gl_undnegocios/, [[{ empresa: '01', dbnomina: 'nominabq  ', codmun: '08001' }]]],
    [/FROM information_schema\.TABLES WHERE TABLE_NAME = 'cargos'/, [[]]],
    [/FROM `nominabq`\.cargos/, [NOMINA()]],
    [/FROM `nomina\w+`\.cargos/, [[]]],
    [/AS mayor$/, [[{ mayor: 0 }]]],
    [/^UPDATE fc_control/, [{ affectedRows: 1 }]],
    [/LAST_INSERT_ID\(\) AS numero/, [[{ numero: '937' }]]],
    [/AS n$/, [[{ n: 0 }]]],
    [/MAX\(id\)/, [[{ id: '501' }]]],
    [/^INSERT INTO fc_contratos_tarifa_inicial/, [{ affectedRows: 1 }]],
    [/^INSERT INTO fc_contratos_cargos_iniciales/, [{ affectedRows: 1 }]],
    [/^INSERT INTO fc_ofertas_adjudicadas/, [{ affectedRows: 1, insertId: 77 }]],
    [/^INSERT INTO fc_preciosventas_oferta/, [{ affectedRows: 1 }]],
    [/^INSERT INTO fc_contratos_costos_admtivos_iniciales/, [{ affectedRows: 1 }]],
    [/^INSERT INTO fc_elemxcont/, [{ affectedRows: 1 }]],
    [/^DELETE FROM fc_elemxcont/, [{ affectedRows: 1 }]],
    [/^INSERT INTO fc_contratos_equipos_iniciales/, [{ affectedRows: 1 }]],
    [/^INSERT INTO fc_contratos_no_continuos_iniciales/, [{ affectedRows: 1 }]],
    [/^INSERT INTO fc_contratos_vlrs_agregs_iniciales/, [{ affectedRows: 1 }]],
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
  const de = (patron) => sentencias.filter((s) => patron.test(s.sql));
  return { pool, sentencias, indice, hubo, de };
}

const escribir = (pool, d = datos(), opciones) => crearEscritorMySQL(pool, opciones).escribir(d, { huella: HUELLA });
const rechaza = async (promesa, estado, codigo) => {
  const error = await promesa.then(() => assert.fail('debía rechazar'), (e) => e);
  assert.ok(error instanceof ErrorNegocio, `se esperaba ErrorNegocio y fue: ${error}`);
  assert.equal(error.estado, estado);
  assert.equal(error.codigo, codigo);
  return error;
};
const NO_ESCRITO = ['contrato.objeto', 'contrato.valorMensual', 'contrato.plazoMeses', 'cliente.direccion'];
const CARGOS = () => [
  { nombre: 'Aseador', cantidad: 4, horasSemana: 48, jornada: 8, salario: 1423500, riesgo: 1, valorUnitario: 10000000, valorTotal: 40000000, codigoHorario: '941' },
  { nombre: 'Aseador', cantidad: 2, horasSemana: 44, jornada: 7.33, salario: 1423500, riesgo: 1, valorUnitario: 5000000, valorTotal: 10000000 },
  { nombre: 'Supervisor', cantidad: 1, horasSemana: 48, jornada: 8, salario: 2500000, riesgo: 2, valorUnitario: 2500000, valorTotal: 2500000 },
];
/** 52.500.000 sin A.I.U. son 58.968.000 con el 12,32 %. */
const conCargos = (cambiar = () => {}) => datos((e) => { e.tarifa.manoObra = 58968000; e.cargos = CARGOS(); cambiar(e); });

/** El aviso de cargos sin horario se prueba aparte (planDeCargos); aquí se mira el resto. */
const sinAvisoDeHorario = (lista) => lista.filter((a) => !/^Sin horario de Contratos/.test(a.mensaje));
describe('escritor MySQL — camino feliz (tarifa, cargos, oferta adjudicada y precios)', () => {
  it('reserva el número y escribe la tarifa y la oferta adjudicada; devuelve lo escrito', async () => {
    const f = falso();
    const r = await escribir(f.pool);
    assert.equal(r.escrito.numOferta, 937);
    assert.deepEqual(r.escrito.numerosSaltados, []);
    assert.deepEqual([r.escrito.empresa, r.escrito.undnegocio], ['01', 'BAQ']);
    assert.deepEqual(r.escrito.cliente, { nit: '900123456-8', rsocial: 'CLIENTE DE PRUEBA S.A.S.' }, 'el NIT y la razón social son los de Contratos, sin espacios sobrantes');
    assert.deepEqual([r.escrito.tarifa.num_oferta, r.escrito.tarifa.fadd, r.escrito.tarifa.codservicio, r.escrito.tarifa.origen_proceso], [937, 'NOW()', 'ASE', 'LIC']);
    assert.equal(r.escrito.ofertaAdjudicada.vlr_adjudicado, 61155743 + 1000000 + 500000 + 5000000 + 250000);
    assert.deepEqual(r.advertencias, []);
    assert.deepEqual(r.noEscrito.map((n) => n.campo), NO_ESCRITO);
    assert.equal(r.escrito.columnasOmitidas, undefined);
  });

  it('las sentencias salen en orden: candado, reenvío, validaciones, contador, número libre, BEGIN, oferta, tarifa, COMMIT, candado', async () => {
    const f = falso();
    await escribir(f.pool);
    const orden = [/GET_LOCK/, /pc_add LIKE/, /FROM fc_clientes/, /^SELECT empresa, undnegocio FROM fc_control/, /FROM fc_conceptos/, /^UPDATE fc_control/, /LAST_INSERT_ID\(\)/,
      /AS n$/, /^BEGIN$/, /^INSERT INTO fc_ofertas_adjudicadas/, /^INSERT INTO fc_contratos_tarifa_inicial/, /^COMMIT$/, /RELEASE_LOCK/, /^RELEASE$/];
    const posiciones = orden.map((p) => f.indice(p));
    assert.ok(posiciones.every((i) => i >= 0), `faltan sentencias: ${posiciones}`);
    assert.deepEqual([...posiciones].sort((a, b) => a - b), posiciones, 'fuera de orden');
    assert.ok(!f.hubo(/MAX\(id\)/), 'con id auto_increment el puente no lo calcula');
  });

  it('el reenvío se busca en la tarifa y en la oferta adjudicada; el número libre se comprueba en las dos', async () => {
    const f = falso();
    await escribir(f.pool);
    const reenvio = f.de(/pc_add LIKE/)[0];
    assert.match(reenvio.sql, /FROM fc_contratos_tarifa_inicial WHERE pc_add LIKE \? UNION ALL .* FROM fc_ofertas_adjudicadas WHERE pc_add LIKE \?/);
    assert.deepEqual(reenvio.params, ['LICICOLBA:42:%', 'LICICOLBA:42:%']);
    const uso = f.de(/AS n$/)[0];
    assert.match(uso.sql, /FROM fc_contratos_tarifa_inicial .* FROM fc_ofertas_adjudicadas/);
    assert.deepEqual(uso.params, ['01', 'BAQ', 937, '01', 'BAQ', 937]);
  });

  it('el UPDATE del contador es UNO atómico y solo toca num_oferta; nunca se lee la fila completa de fc_control', async () => {
    const f = falso();
    await escribir(f.pool);
    const actualizacion = f.de(/^UPDATE fc_control/)[0];
    assert.equal(actualizacion.sql, 'UPDATE fc_control SET num_oferta = LAST_INSERT_ID(GREATEST(COALESCE(num_oferta, 0), ?) + 1) WHERE empresa = ? AND undnegocio = ?');
    assert.deepEqual(actualizacion.params, [0, '01', 'BAQ']);
    for (const s of f.de(/fc_control/)) assert.doesNotMatch(s.sql, /SELECT \*|SELECT\s+\w*\s*\*/);
  });

  it('el INSERT de la tarifa lleva las columnas de «Guardar oferta», parámetros, NOW() en el SQL y la marca en pc_add', async () => {
    const f = falso();
    await escribir(f.pool);
    const insert = f.de(/^INSERT INTO fc_contratos_tarifa_inicial/)[0];
    assert.match(insert.sql, /^INSERT INTO fc_contratos_tarifa_inicial \(empresa, undnegocio, num_oferta, ncontrato, nit, rsocial,/);
    assert.match(insert.sql, /user_add, fadd, pc_add, tar_insumos, tar_maquinaria, tar_otros, tar_nocontinuos, sector_economico, id_oferta_adjudicada\) VALUES \(/);
    assert.equal((insert.sql.match(/\?/g) ?? []).length, insert.params.length);
    assert.equal(insert.params.length, 36, '37 columnas menos fadd, que es NOW()');
    assert.deepEqual(insert.params.slice(-2), ['Comercial', 77], 'sector del cliente y el id de la oferta adjudicada recién creada');
    const sector = f.de(/AS sector, COUNT/)[0];
    assert.deepEqual(sector.params, ['900123456', 'LICICOLBA'], 'por la base del NIT y sin contar los envíos de LiciColba');
    assert.ok(insert.params.includes('LICICOLBA:42:ab12cd34ef56'));
    assert.ok(insert.params.includes('0.1232'), 'el A.I.U. viaja como texto decimal exacto');
    assert.ok(!insert.params.includes(undefined));
  });

  it('el INSERT de la oferta adjudicada: sin id (auto_increment), NOW() en el SQL y la marca en pc_add', async () => {
    const f = falso();
    await escribir(f.pool);
    const insert = f.de(/^INSERT INTO fc_ofertas_adjudicadas/)[0];
    assert.equal(insert.sql, 'INSERT INTO fc_ofertas_adjudicadas (empresa, undnegocio, num_oferta, nit, rsocial, vlr_adjudicado, vlr_manoobra, vlr_insumos, vlr_maquinaria, vlr_impuestos, vlr_otros, vlr_nocontinuos, user_add, fadd, pc_add) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)');
    assert.equal(insert.params.at(-1), 'LICICOLBA:42:ab12cd34ef56');
  });

  it('un id que no es auto_increment se asigna MAX(id) + 1 dentro de la transacción, tabla por tabla', async () => {
    const f = falso();
    await escribir(f.pool, datos(), { idManual: true, idManualPorTabla: { fc_contratos_tarifa_inicial: true } });
    const maximos = f.de(/MAX\(id\)/);
    assert.deepEqual(maximos.map((s) => /FROM (\w+)/.exec(s.sql)[1]), ['fc_ofertas_adjudicadas', 'fc_contratos_tarifa_inicial']);
    assert.ok(maximos.every((s) => /FOR UPDATE$/.test(s.sql)));
    assert.ok(f.indice(/^BEGIN$/) < f.indice(/MAX\(id\)/));
    assert.match(f.de(/^INSERT INTO fc_ofertas_adjudicadas/)[0].sql, /, id\) VALUES/);
  });

  it('las columnas que esta base no tiene se omiten del INSERT y se informan como no escritas', async () => {
    const f = falso();
    const r = await escribir(f.pool, conCargos(), { omitir: { fc_contratos_tarifa_inicial: ['origen_proceso', 'aplica_curso'], fc_contratos_cargos_iniciales: ['nom_cargo', 'experiencia'] } });
    const tarifa = f.de(/^INSERT INTO fc_contratos_tarifa_inicial/)[0];
    const cargo = f.de(/^INSERT INTO fc_contratos_cargos_iniciales/)[0];
    assert.doesNotMatch(tarifa.sql, /origen_proceso|aplica_curso/);
    assert.doesNotMatch(cargo.sql, /nom_cargo|experiencia/);
    for (const s of [tarifa, cargo]) assert.equal((s.sql.match(/\?/g) ?? []).length, s.params.length);
    assert.ok(r.noEscrito.some((n) => n.campo === 'oferta.origenProceso'));
    assert.ok(r.noEscrito.some((n) => n.campo === 'cargos' && /nom_cargo/.test(n.motivo)));
    assert.deepEqual(Object.keys(r.escrito.columnasOmitidas), ['fc_contratos_tarifa_inicial', 'fc_contratos_cargos_iniciales']);
  });

  it('user_add y pc_add de la oferta adjudicada se ajustan al largo real de las columnas', async () => {
    const f = falso();
    await escribir(f.pool, datos(), { largoUserAdd: 6, largoPcAdd: 20 });
    const insert = f.de(/^INSERT INTO fc_ofertas_adjudicadas/)[0];
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
    assert.deepEqual([r.escrito.tarifa.nit, r.escrito.ofertaAdjudicada.rsocial], ['900123456-5', 'OTRA RAZON SOCIAL LTDA']);
  });

  it('la clave de la oferta se escribe como está en Contratos aunque llegue en minúsculas', async () => {
    const r = await escribir(falso().pool, datos((e) => { e.oferta.undnegocio = 'baq'; e.oferta.codServicio = 'ase'; }));
    assert.deepEqual([r.escrito.undnegocio, r.escrito.tarifa.undnegocio, r.escrito.tarifa.codservicio], ['BAQ', 'BAQ', 'ASE']);
  });

  it('un concepto que existe solo para otra empresa o UEN es una advertencia, no un bloqueo', async () => {
    const r = await escribir(falso({ [/FROM fc_conceptos/.source]: [[{ empresa: '02', undnegocio: 'BOG', codcpto: 'ASE' }]] }).pool);
    assert.deepEqual(r.advertencias.map((a) => a.campo), ['oferta.codServicio']);
    assert.equal(r.escrito.numOferta, 937);
  });
});

describe('escritor MySQL — cargos', () => {
  it('escribe la tarifa y TODOS sus cargos en la misma transacción, la tarifa primero', async () => {
    const f = falso();
    const r = await escribir(f.pool, conCargos());
    const posiciones = [/^BEGIN$/, /^INSERT INTO fc_contratos_tarifa_inicial/, /^INSERT INTO fc_contratos_cargos_iniciales/, /^COMMIT$/].map((p) => f.indice(p));
    assert.ok(posiciones.every((i) => i >= 0) && [...posiciones].sort((a, b) => a - b).join() === posiciones.join(), `fuera de orden: ${posiciones}`);
    assert.equal(f.de(/^INSERT INTO fc_contratos_cargos_iniciales/).length, 3);
    assert.deepEqual(r.escrito.cargos, [
      { item: 1, cargo: 99, nombre: 'Aseador', cantidad: 4 },
      { item: 2, cargo: 99, nombre: 'Aseador', cantidad: 2 },
      { item: 3, cargo: 339, nombre: 'Supervisor', cantidad: 1 },
    ]);
    assert.deepEqual(sinAvisoDeHorario(r.advertencias).map((a) => a.campo), ['cargos[2].nombre'], 'SUPERVISOR está en la sede (104) y en los generales (339)');
  });

  it('el código de cargo es el de la nómina de la UEN: la base sale de gl_undnegocios y se lee antes de reservar el número', async () => {
    const f = falso();
    const r = await escribir(f.pool, conCargos());
    assert.deepEqual(f.de(/FROM gl_undnegocios/)[0].params, ['BAQ']);
    assert.ok(f.indice(/FROM `nominabq`\.cargos/) < f.indice(/^UPDATE fc_control/));
    assert.match(sinAvisoDeHorario(r.advertencias)[0].mensaje, /nominabq\.cargos .*códigos 104, 339.*se escribió el 339/);
  });

  it('un cargo que no está en la nómina de la UEN (o solo en la de otra) es un error por línea y no reserva número', async () => {
    const f = falso();
    const error = await rechaza(escribir(f.pool, conCargos((e) => { e.cargos[1].nombre = 'Conductor'; })), 422, 'DATOS_INVALIDOS');
    assert.deepEqual(error.extra.errores.map((e) => e.campo), ['cargos[1].nombre']);
    assert.match(error.extra.errores[0].mensaje, /«Conductor» no existe en la nómina de la UEN BAQ \(nominabq\.cargos\)/);
    assert.ok(!f.hubo(/^UPDATE/) && !f.hubo(/^INSERT/));
  });

  it('la base de nómina: manda la fila de la empresa; si no tiene, la de la UEN; con varias, la primera que tiene todos los cargos', async () => {
    const empresa04 = (unidades, existentes = []) => falso({
      [/^SELECT empresa, undnegocio FROM fc_control/.source]: [[{ empresa: '04', undnegocio: 'BAQ' }]],
      [/FROM gl_undnegocios/.source]: [unidades],
      [/FROM information_schema\.TABLES WHERE TABLE_NAME = 'cargos'/.source]: [existentes.map((base) => ({ base }))],
    });
    const enviar = (f) => escribir(f.pool, conCargos((e) => { e.oferta.empresa = '04'; }));
    // Sin fila de la empresa: la de la UEN.
    const otra = empresa04([{ empresa: '01', dbnomina: 'nominabq' }]);
    await enviar(otra);
    assert.ok(otra.hubo(/FROM `nominabq`\.cargos/) && !otra.hubo(/information_schema/));
    // Dos bases para 04/BAQ y existen las dos (como en Contratos): la primera no tiene los cargos, la segunda sí → la segunda.
    const dos = empresa04([{ empresa: '01', dbnomina: 'otra' }, { empresa: '04', dbnomina: 'NOMINATMB' }, { empresa: '04', dbnomina: 'nominabq' }], ['nominatmb', 'nominabq']);
    const r = await enviar(dos);
    assert.deepEqual(dos.de(/information_schema/)[0].params, [['NOMINATMB', 'nominabq']]);
    assert.ok(dos.hubo(/FROM `nominatmb`\.cargos/), 'usa el nombre real que da el servidor');
    assert.equal(r.escrito.numOferta, 937);
    assert.ok(r.advertencias.some((a) => /varias bases de nómina \(nominatmb, nominabq\): los códigos de cargo se tomaron de nominabq/.test(a.mensaje)));
    // Ninguna tiene todos los cargos: los errores de la primera.
    const sinCargos = await rechaza(enviar(empresa04([{ empresa: '04', dbnomina: 'NOMINATMB' }, { empresa: '04', dbnomina: 'nominatmbe' }], ['nominatmb', 'nominatmbe'])), 422, 'DATOS_INVALIDOS');
    assert.match(sinCargos.extra.errores[0].mensaje, /no existe en la nómina de la UEN BAQ \(nominatmb\.cargos\)/);
    // Ninguna existe en el servidor.
    const ninguna = await rechaza(enviar(empresa04([{ empresa: '04', dbnomina: 'NOMINATMB' }, { empresa: '04', dbnomina: 'nominatmbe' }])), 422, 'DATOS_INVALIDOS');
    assert.match(ninguna.extra.errores[0].mensaje, /ninguna de NOMINATMB, nominatmbe tiene tabla cargos/);
    // La empresa tiene fila pero sin base (como Transcolba en gl_undnegocios): no toma la de otra empresa.
    const vacia = await rechaza(enviar(empresa04([{ empresa: '01', dbnomina: 'nominabq' }, { empresa: '04', dbnomina: '' }])), 422, 'DATOS_INVALIDOS');
    assert.match(vacia.extra.errores[0].mensaje, /empresa 04 y la UEN BAQ/);
  });

  it('Tempocolba usa nominatmb (quincenal) y luego nominatmb2 (mensual); Transcolba nominatr; gl_undnegocios no cuenta para ellas', async () => {
    const renumerada = (suma) => [NOMINA().map((f) => ({ ...f, codigo: f.codigo + suma }))];
    const de = (empresa, bases) => falso({
      [/^SELECT empresa, undnegocio FROM fc_control/.source]: [[{ empresa, undnegocio: 'BAQ' }]],
      [/FROM gl_undnegocios/.source]: [[{ empresa: '02', dbnomina: 'NOMINATMB' }, { empresa: '02', dbnomina: 'nominatmbe' }, { empresa: '03', dbnomina: '' }]],
      [/FROM information_schema\.TABLES WHERE TABLE_NAME = 'cargos'/.source]: [Object.keys(bases).map((base) => ({ base }))],
      [/FROM `nomina\w+`\.cargos/.source]: (_, sql) => bases[/FROM `(\w+)`/.exec(sql)[1]] ?? [[]],
    });
    const enviar = (f, empresa) => escribir(f.pool, conCargos((e) => { e.oferta.empresa = empresa; }));
    const codigos = (f) => JSON.stringify(f.de(/^INSERT INTO fc_contratos_cargos_iniciales/).map((x) => x.params));

    const quincenal = de('02', { nominatmb: renumerada(1000), nominatmb2: renumerada(2000) });
    await enviar(quincenal, '02');
    assert.ok(codigos(quincenal).includes('1099') && !quincenal.hubo(/nominatmbe/));
    const mensual = de('02', { nominatmb: [[{ id: 1, empresa: '', undnegocio: '', codigo: 7, nombre: 'CONDUCTOR' }]], nominatmb2: renumerada(2000) });
    await enviar(mensual, '02');
    assert.ok(codigos(mensual).includes('2099'));
    const transcolba = de('03', { nominatr: renumerada(3000) });
    await enviar(transcolba, '03');
    assert.ok(codigos(transcolba).includes('3099'));
  });

  it('sin base de nómina para la UEN, o sin permiso para leerla, no escribe y dice qué falta', async () => {
    const sinBase = await rechaza(escribir(falso({ [/FROM gl_undnegocios/.source]: [[]] }).pool, conCargos()), 422, 'DATOS_INVALIDOS');
    assert.match(sinBase.extra.errores[0].mensaje, /gl_undnegocios\.dbnomina/);
    const raro = await rechaza(escribir(falso({ [/FROM gl_undnegocios/.source]: [[{ dbnomina: 'nomina; DROP' }]] }).pool, conCargos()), 422, 'DATOS_INVALIDOS');
    assert.equal(raro.extra.errores[0].campo, 'cargos');
    const negado = () => { throw Object.assign(new Error('SELECT command denied'), { errno: 1142 }); };
    const f = falso({ [/FROM `nominabq`\.cargos/.source]: negado });
    const sinPermiso = await rechaza(escribir(f.pool, conCargos()), 422, 'DATOS_INVALIDOS');
    assert.match(sinPermiso.extra.errores[0].mensaje, /permiso de lectura \(SELECT\) sobre nominabq\.cargos/);
    assert.ok(!f.hubo(/^UPDATE/));
  });

  it('cada cargo lleva el número de oferta reservado, la marca de origen y NOW() en el SQL; el horario solo si viene', async () => {
    const f = falso();
    await escribir(f.pool, conCargos());
    const [uno, dos] = f.de(/^INSERT INTO fc_contratos_cargos_iniciales/);
    assert.match(uno.sql, /user_add, fadd, pc_add, nro_veces_mes, vlr_cargos, clasebono_alim, clasebono_trans, clasebono_prod, clasebono_prest, codhorario\) VALUES/);
    assert.doesNotMatch(dos.sql, /codhorario/);
    assert.equal(uno.params.length, 53, '54 columnas (47 + 6 de la pantalla + horario) menos fadd, que es NOW()');
    assert.ok(uno.params.includes(937) && uno.params.includes('LICICOLBA:42:ab12cd34ef56') && uno.params.includes('941'));
  });

  it('los grupos de la línea llegan a la fila de cargos (dotm, dotf, epp, examen, cod_grupo_curso)', async () => {
    const f = falso();
    await escribir(f.pool, conCargos((e) => Object.assign(e.cargos[0], { grupoDotacionMasculina: 'M025', grupoEpp: 'EP095', grupoExamen: 'EM007' })));
    const [uno] = f.de(/^INSERT INTO fc_contratos_cargos_iniciales/);
    const valor = (columna) => {
      const columnas = /\((.*)\) VALUES/.exec(uno.sql)[1].split(', ').filter((c) => c !== 'fadd');
      return uno.params[columnas.indexOf(columna)];
    };
    assert.deepEqual(['dotm', 'dotf', 'epp', 'examen', 'cod_grupo_curso'].map(valor), ['M025', '', 'EP095', 'EM007', '']);
  });

  it('un horario que no existe en Contratos es un error por línea, junto con los demás, y no reserva ningún número', async () => {
    const f = falso({ [/FROM fc_horarios/.source]: [[]] });
    const error = await rechaza(escribir(f.pool, conCargos()), 422, 'DATOS_INVALIDOS');
    assert.deepEqual(error.extra.errores.map((e) => e.campo), ['cargos[0].codigoHorario']);
    assert.ok(!f.hubo(/^UPDATE/) && !f.hubo(/^INSERT/));
  });

  it('un valor total que no cuadra con unitario × cantidad bloquea el envío, sin reservar número', async () => {
    const f = falso();
    const error = await rechaza(escribir(f.pool, conCargos((e) => { e.cargos[2].valorTotal = 1; })), 422, 'DATOS_INVALIDOS');
    assert.deepEqual(error.extra.errores.map((e) => e.campo), ['cargos[2].valorTotal']);
    assert.ok(!f.hubo(/^UPDATE/));
  });

  it('si falla el INSERT de un cargo se revierte TODO y el número se pierde', async () => {
    let n = 0;
    const f = falso({ [/^INSERT INTO fc_contratos_cargos_iniciales/.source]: () => { n += 1; if (n === 2) throw Object.assign(new Error('Data too long'), { errno: 1406 }); return [{ affectedRows: 1 }]; } });
    const error = await rechaza(escribir(f.pool, conCargos()), 422, 'DATOS_INVALIDOS');
    assert.equal(error.extra.numeroPerdido, 937);
    assert.ok(f.hubo(/^ROLLBACK$/) && !f.hubo(/^COMMIT$/));
    const fallido = f.sentencias.findLastIndex((x) => /^INSERT INTO fc_contratos_cargos_iniciales/.test(x.sql));
    assert.ok(!f.sentencias.slice(fallido + 1).some((x) => /^INSERT/.test(x.sql)), 'no sigue después del fallo');
  });

  it('avisa si los cargos no suman lo que equivale la mano de obra, pero escribe', async () => {
    const r = await escribir(falso().pool, conCargos((e) => { e.tarifa.manoObra = 70000000; e.cargos[2].nombre = 'Turnante — bloque integrado de 42h'; }));
    assert.deepEqual(sinAvisoDeHorario(r.advertencias).map((a) => a.campo), ['cargos']);
    assert.equal(r.escrito.cargos[2].cargo, 426, 'el turnante automático de LiciColba es el cargo TURNANTE');
    assert.equal(r.escrito.cargos.length, 3);
  });

  it('sin cargos ni siquiera consulta fc_horarios ni toca la tabla de cargos', async () => {
    const f = falso();
    const r = await escribir(f.pool, datos());
    assert.ok(!f.hubo(/cargos_iniciales/) && !f.hubo(/FROM fc_horarios/) && !f.hubo(/dbnomina|\.cargos/));
    assert.deepEqual(r.escrito.cargos, []);
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
    assert.ok(f.hubo(/RELEASE_LOCK/) && f.sentencias.at(-1).sql === 'RELEASE');
  });

  it('si lo reenviado cambió de contenido lo dice (sinCambios = false)', async () => {
    const error = await rechaza(escribir(falso(previa('LICICOLBA:42:000000000000')).pool), 409, 'YA_ENVIADA');
    assert.equal(error.extra.sinCambios, false);
  });

  it('si otro envío de la misma solicitud tiene el candado, responde 409 OCUPADO y no toca nada', async () => {
    const f = falso({ [/GET_LOCK/.source]: [[{ ok: 0 }]] });
    await rechaza(escribir(f.pool), 409, 'OCUPADO');
    assert.ok(!f.hubo(/pc_add LIKE/) && !f.hubo(/^UPDATE/) && !f.hubo(/^INSERT/));
    assert.ok(!f.hubo(/RELEASE_LOCK/));
  });
});

describe('escritor MySQL — lo que debe existir en Contratos', () => {
  it('junta TODOS los problemas en un solo 422 y no reserva ningún número', async () => {
    const f = falso({ [/FROM fc_clientes/.source]: [[]], [/^SELECT empresa, undnegocio FROM fc_control/.source]: [[]], [/FROM fc_conceptos/.source]: [[]] });
    const error = await rechaza(escribir(f.pool, datos((e) => (e.contrato.porcentajeAIU = 0))), 422, 'DATOS_INVALIDOS');
    assert.deepEqual(error.extra.errores.map((e) => e.campo), ['cliente.nit', 'oferta.undnegocio', 'oferta.codServicio', 'contrato.porcentajeAIU']);
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
    const consulta = f.de(/FROM fc_clientes/)[0];
    assert.match(consulta.sql, /SUBSTRING_INDEX\(TRIM\(nit\), '-', 1\)/);
    assert.deepEqual(consulta.params, ['900123456', 'BAQ']);
  });
});

describe('escritor MySQL — número de oferta', () => {
  function contador(inicio, usados) {
    let actual = inicio;
    return {
      [/^UPDATE fc_control/.source]: () => { actual += 1; return [{ affectedRows: 1 }]; },
      [/LAST_INSERT_ID\(\) AS numero/.source]: () => [[{ numero: String(actual) }]],
      [/AS n$/.source]: (params) => [[{ n: usados.includes(params[2]) ? 1 : 0 }]],
    };
  }

  it('si el contador iba por detrás de lo ya usado, descarta esos números y toma el siguiente libre', async () => {
    const r = await escribir(falso(contador(935, [936, 937])).pool);
    assert.equal(r.escrito.numOferta, 938);
    assert.deepEqual(r.escrito.numerosSaltados, [936, 937]);
  });

  it('si Contratos ya tiene ofertas por encima del contador (digitadas a mano), sigue después de la mayor de la UEN', async () => {
    let actual = 836;
    const f = falso({
      [/AS mayor$/.source]: [[{ mayor: '943' }]],
      [/^UPDATE fc_control/.source]: (params) => { actual = Math.max(actual, params[0]) + 1; return [{ affectedRows: 1 }]; },
      [/LAST_INSERT_ID\(\) AS numero/.source]: () => [[{ numero: String(actual) }]],
    });
    const r = await escribir(f.pool);
    assert.equal(r.escrito.numOferta, 944);
    const mayor = f.de(/AS mayor$/)[0];
    assert.match(mayor.sql, /MAX\(num_oferta\) FROM fc_contratos_tarifa_inicial .* FROM fc_ofertas_adjudicadas .* FROM fc_contratos_costos_admtivos_iniciales/);
    assert.deepEqual(mayor.params, ['01', 'BAQ', '01', 'BAQ', '01', 'BAQ']);
    assert.ok(f.indice(/AS mayor$/) < f.indice(/^UPDATE fc_control/));
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

describe('escritor MySQL — lista de precios de insumos (módulo 6)', () => {
  const conInsumos = () => datos((e) => { e.insumos = [{ codigo: '18111', nombre: 'Jabón', valorUnitario: 10000 }, { codigo: '01050', valorUnitario: 500 }]; });

  it('una fila por insumo en la MISMA transacción, después de la oferta adjudicada, con el número reservado', async () => {
    const f = falso();
    const r = await escribir(f.pool, conInsumos());
    const precios = f.de(/^INSERT INTO fc_preciosventas_oferta/);
    assert.equal(precios.length, 2);
    assert.ok(f.indice(/^INSERT INTO fc_ofertas_adjudicadas/) < f.indice(/^INSERT INTO fc_preciosventas_oferta/) && f.indice(/^INSERT INTO fc_preciosventas_oferta/) < f.indice(/^COMMIT$/));
    assert.deepEqual(precios[0].params, ['BAQ', 937, '', 'tmp1', 'BAQ', '18111', 11232, 0, '0.1232', 'LICICOLBA', 10000]);
    assert.deepEqual(r.escrito.preciosOferta, [{ codigo: '18111', vr_costo: 10000, valor: 11232 }, { codigo: '01050', vr_costo: 500, valor: 561.6 }]);
  });

  it('si falla una fila de precios se revierte TODO y el número se pierde', async () => {
    const f = falso({ [/^INSERT INTO fc_preciosventas_oferta/.source]: () => { throw Object.assign(new Error('Data too long'), { errno: 1406 }); } });
    const error = await rechaza(escribir(f.pool, conInsumos()), 422, 'DATOS_INVALIDOS');
    assert.equal(error.extra.numeroPerdido, 937);
    assert.ok(f.hubo(/^ROLLBACK$/) && !f.hubo(/^COMMIT$/));
  });
});

describe('escritor MySQL — pestañas Costos Admtivos e Insumos de la Oferta Inicial', () => {
  const completa = () => datos((e) => {
    e.insumos = [
      { codigo: '18111', nombre: 'Jabón', valorUnitario: 10000, cantidad: 3, frecuenciaMeses: 2, valorUnitarioConIva: 11900 },
      { codigo: '01050', valorUnitario: 500, cantidad: 10, frecuenciaMeses: 1, valorUnitarioConIva: 595 },
    ];
    e.costosAdministrativos = [{ concepto: 'Pólizas', valorMensual: 2500 }, { concepto: 'Papelería', valorMensual: 1500 }, { concepto: 'Microsoft', valorMensual: 300 }];
  });

  it('lee el catálogo antes de reservar el número y escribe costos y luego insumos en la MISMA transacción, al final', async () => {
    const f = falso();
    const r = await escribir(f.pool, completa());
    assert.ok(f.indice(/FROM fc_conceptos_costos_admtivos/) < f.indice(/^UPDATE fc_control/));
    const orden = [/^INSERT INTO fc_preciosventas_oferta/, /^INSERT INTO fc_contratos_costos_admtivos_iniciales/, /^INSERT INTO fc_elemxcont/, /^COMMIT$/].map((p) => f.indice(p));
    assert.deepEqual([...orden].sort((a, b) => a - b), orden);
    assert.deepEqual(r.escrito.costosAdministrativos, [{ id_cpto_costo: 1, valor: 2500 }, { id_cpto_costo: 6, valor: 1500 }, { id_cpto_costo: 11, valor: 300 }]);
    assert.deepEqual(r.escrito.insumosOferta, [
      { codele: '18111', cantidad: 3, frecuencia: 2, vlr_unitario: 11900 },
      { codele: '01050', cantidad: 10, frecuencia: 1, vlr_unitario: 595 },
    ]);
    assert.ok(r.advertencias.some((a) => /OTROS.*Microsoft/.test(a.mensaje)));
  });

  it('cada fila lleva el número reservado, el NIT y nombre del cliente de Contratos y la marca de origen', async () => {
    const f = falso();
    await escribir(f.pool, completa());
    const [costo] = f.de(/^INSERT INTO fc_contratos_costos_admtivos_iniciales/);
    assert.equal(costo.sql, 'INSERT INTO fc_contratos_costos_admtivos_iniciales (empresa, undnegocio, num_oferta, ncontrato, consec, concepto, punto_entrega, nombre_punto, codmun, id_cpto_costo, valor, user_add, fadd, pc_add) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)');
    assert.deepEqual(costo.params.slice(0, 11), ['01', 'BAQ', 937, '', 1, 'ASE', '0000000000', 'CLIENTE DE PRUEBA S.A.S.', '08001', 1, 2500], 'codmun = municipio de la UEN (gl_undnegocios)');
    assert.match(costo.params.at(-1), /^LICICOLBA:42:/);
    const [insumo] = f.de(/^INSERT INTO fc_elemxcont/);
    assert.deepEqual(insumo.params.slice(0, 12), ['01', 'BAQ', '900123456-8', '', 'F', '18111', 3, 2, 11900, 0, 937, 1]);
    assert.ok(insumo.params.includes('08001'), 'el insumo también lleva el municipio');
  });

  it('sin municipio de la UEN en Contratos, la ciudad va vacía y se avisa (no bloquea)', async () => {
    const f = falso({ [/FROM gl_undnegocios/.source]: [[{ empresa: '01', dbnomina: 'nominabq', codmun: '' }]] });
    const r = await escribir(f.pool, completa());
    assert.ok(r.advertencias.some((a) => /no tiene municipio/.test(a.mensaje)));
    const [costo] = f.de(/^INSERT INTO fc_contratos_costos_admtivos_iniciales/);
    assert.equal(costo.params[8], '');
  });

  it('sin costos administrativos no consulta el catálogo ni toca la tabla', async () => {
    const f = falso();
    await escribir(f.pool);
    assert.ok(!f.hubo(/FROM fc_conceptos_costos_admtivos|INSERT INTO fc_contratos_costos_admtivos/) && !f.hubo(/fc_elemxcont/));
  });

  it('un id que no es auto_increment se asigna MAX(id) + 1 también en estas tablas', async () => {
    const f = falso();
    await escribir(f.pool, completa(), { idManualPorTabla: { fc_contratos_costos_admtivos_iniciales: true, fc_elemxcont: true } });
    assert.deepEqual(f.de(/MAX\(id\)/).map((s) => /FROM (\w+)/.exec(s.sql)[1]), [...Array(3).fill('fc_contratos_costos_admtivos_iniciales'), 'fc_elemxcont', 'fc_elemxcont']);
  });

  it('si falla un insumo (MyISAM no se revierte) borra SOLO lo suyo: misma oferta, usuario y marca; el número se pierde', async () => {
    let n = 0;
    const f = falso({ [/^INSERT INTO fc_elemxcont/.source]: () => { n += 1; if (n === 2) throw Object.assign(new Error('Data too long'), { errno: 1406 }); return [{ affectedRows: 1 }]; } });
    const error = await rechaza(escribir(f.pool, completa()), 422, 'DATOS_INVALIDOS');
    assert.equal(error.extra.numeroPerdido, 937);
    assert.ok(f.indice(/^ROLLBACK$/) < f.indice(/^DELETE FROM fc_elemxcont/));
    const [borrado] = f.de(/^DELETE FROM fc_elemxcont/);
    assert.equal(borrado.sql, 'DELETE FROM fc_elemxcont WHERE empresa = ? AND undnegocio = ? AND num_oferta = ? AND user_add = ? AND pc_add = ?');
    assert.deepEqual(borrado.params.slice(0, 4), ['01', 'BAQ', 937, 'LICICOLBA']);
    assert.match(borrado.params[4], /^LICICOLBA:42:/);
  });

  it('si falla antes de los insumos no borra nada en fc_elemxcont', async () => {
    const f = falso({ [/^INSERT INTO fc_contratos_costos_admtivos_iniciales/.source]: () => { throw Object.assign(new Error('x'), { errno: 1406 }); } });
    await rechaza(escribir(f.pool, completa()), 422, 'DATOS_INVALIDOS');
    assert.ok(!f.hubo(/fc_elemxcont/));
  });
});

describe('escritor MySQL — pestañas Equipos, Servs. No Continuos y Valores Agregados', () => {
  const completa = () => datos((e) => {
    e.equipos = [{ codigoGrupo: '004', codigoSubtipo: '096', descripcion: 'Aspiradora', valorUnitario: 1190000, cantidadRequerida: 2, cantidadComprar: 1, mesesDepreciacion: 12, valorMesMantenimiento: 23000 }];
    e.serviciosNoContinuos = [{ actividad: 14, uen: 'BAQ', descripcion: 'Brigada', frecuencia: 3, manoObra: 100, insumos: 50, equipos: 0, otrosCostos: 0, valorServicio: 150, valorMensual: 50 }];
    e.valoresAgregados = [{ tipo: 'REINVERSION', valorMensual: 1000, frecuencia: 12, tipoReinversion: 'VALOR' }];
  });

  it('escribe las tres en la MISMA transacción, antes de fc_elemxcont y del COMMIT, con el número reservado', async () => {
    const f = falso();
    const r = await escribir(f.pool, completa());
    const orden = [/^INSERT INTO fc_ofertas_adjudicadas/, /^INSERT INTO fc_contratos_equipos_iniciales/, /^INSERT INTO fc_contratos_no_continuos_iniciales/, /^INSERT INTO fc_contratos_vlrs_agregs_iniciales/, /^COMMIT$/].map((p) => f.indice(p));
    assert.ok(orden.every((x) => x >= 0));
    assert.deepEqual([...orden].sort((a, b) => a - b), orden);
    assert.equal(f.de(/^INSERT INTO fc_contratos_equipos_iniciales/)[0].params[2], 937);
    assert.match(f.de(/^INSERT INTO fc_contratos_vlrs_agregs_iniciales/)[0].sql, /usuario, pc\) VALUES/);
    assert.deepEqual(r.escrito.equipos.map((e) => [e.descrip_equipo, e.tipo_equipo, e.dtipo_equipo, e.subtipo_equipo]), [['Aspiradora', '004', '018', '096']]);
    assert.deepEqual(f.de(/FROM act_subtipos/)[0].params, ['01', ['004']]);
    assert.deepEqual(r.escrito.serviciosNoContinuos.map((e) => e.vlr_mes), [50]);
    assert.deepEqual(r.escrito.valoresAgregados.map((e) => e.valor), [1000]);
  });

  it('si la base no tiene la tabla de valores agregados, escribe lo demás y lo avisa', async () => {
    const f = falso();
    const r = await escribir(f.pool, completa(), { tablasAusentes: ['fc_contratos_vlrs_agregs_iniciales'] });
    assert.ok(!f.hubo(/vlrs_agregs/) && f.hubo(/^INSERT INTO fc_contratos_equipos_iniciales/));
    assert.ok(r.advertencias.some((a) => a.campo === 'valoresAgregados'));
  });

  it('el «Tipo» del equipo: sin la tabla act_subtipos o sin permiso de lectura va vacío y se avisa, sin detener el envío', async () => {
    const sinTabla = falso();
    const r1 = await escribir(sinTabla.pool, completa(), { tablasAusentes: ['act_subtipos'] });
    assert.ok(!sinTabla.hubo(/act_subtipos/));
    assert.deepEqual(r1.escrito.equipos.map((e) => e.dtipo_equipo), ['']);
    const sinPermiso = falso({ [/FROM act_subtipos/.source]: () => { throw Object.assign(new Error('SELECT command denied'), { errno: 1142 }); } });
    const r2 = await escribir(sinPermiso.pool, completa());
    assert.deepEqual(r2.escrito.equipos.map((e) => e.dtipo_equipo), ['']);
    assert.ok(r2.advertencias.some((a) => a.campo === 'equipos' && /act_subtipos \(código 1142\)/.test(a.mensaje)));
  });

  it('si falla un no continuo se revierte TODO', async () => {
    const f = falso({ [/^INSERT INTO fc_contratos_no_continuos_iniciales/.source]: () => { throw Object.assign(new Error('x'), { errno: 1406 }); } });
    await rechaza(escribir(f.pool, completa()), 422, 'DATOS_INVALIDOS');
    assert.ok(f.hubo(/^ROLLBACK$/) && !f.hubo(/^COMMIT$/));
  });
});

describe('escritor MySQL — fallos', () => {
  it('si un INSERT falla se revierte, el número se informa como perdido, el mensaje de MySQL no sale y el candado se libera', async () => {
    const f = falso({ [/^INSERT INTO fc_contratos_tarifa_inicial/.source]: () => { throw Object.assign(new Error('Data too long for column x'), { errno: 1406, code: 'ER_DATA_TOO_LONG' }); } });
    const error = await rechaza(escribir(f.pool), 422, 'DATOS_INVALIDOS');
    assert.equal(error.extra.numeroPerdido, 937);
    assert.doesNotMatch(JSON.stringify(error.extra), /Data too long/);
    assert.ok(f.hubo(/^ROLLBACK$/) && !f.hubo(/^COMMIT$/));
    assert.ok(f.hubo(/RELEASE_LOCK/) && f.sentencias.at(-1).sql === 'RELEASE');
  });

  it('una columna obligatoria sin valor por defecto (1364) es un dato que Contratos no acepta', async () => {
    const f = falso({ [/^INSERT INTO fc_ofertas_adjudicadas/.source]: () => { throw Object.assign(new Error("Field 'x' doesn't have a default value"), { errno: 1364 }); } });
    const error = await rechaza(escribir(f.pool), 422, 'DATOS_INVALIDOS');
    assert.match(error.extra.errores[0].mensaje, /1364/);
  });

  it('una conexión del pool que el servidor ya cerró se descarta y se usa otra', async () => {
    const f = falso();
    const buena = await f.pool.getConnection();
    const muerta = { ...buena, async ping() { throw Object.assign(new Error('Connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' }); }, destroy() { f.sentencias.push({ sql: 'DESTROY' }); } };
    const entregas = [muerta, buena];
    const r = await escribir({ async getConnection() { return entregas.shift() ?? buena; } });
    assert.equal(r.escrito.numOferta, 937);
    assert.equal(f.sentencias.filter((s) => s.sql === 'DESTROY').length, 1);
  });

  it('si la base no responde, 503 sin detalles', async () => {
    const pool = { async getConnection() { throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:3306'), { code: 'ECONNREFUSED' }); } };
    const error = await rechaza(escribir(pool), 503, 'BD_NO_DISPONIBLE');
    assert.doesNotMatch(error.message, /10\.0\.0\.5/);
  });

  it('un fallo desconocido sube tal cual y aun así libera todo', async () => {
    const f = falso({ [/FROM fc_clientes/.source]: () => { throw new Error('fallo raro'); } });
    const error = await escribir(f.pool).then(() => assert.fail('debía fallar'), (e) => e);
    assert.equal(error.message, 'fallo raro');
    assert.ok(!(error instanceof ErrorNegocio));
    assert.equal(f.sentencias.at(-1).sql, 'RELEASE');
  });
});
