import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cargarEsquemaEsperado } from '../src/esquema.js';
import {
  AHORA, aiuComoFraccion, comparable, COLUMNA_CARGO_HORARIO, COLUMNAS_CARGO_VFP, COLUMNAS_TARIFA_HISTORICAS, COLUMNAS_TARIFA_VFP, describirFila, marcaDeOrigen,
  marcaQueCabe, MAX_INT10, noEscritoEnLaOferta, patronDeSolicitud, planDeCargos, planDeOfertaAdjudicada, planDePreciosOferta, planDeTarifa, USUARIO_PUENTE,
} from '../src/oferta.js';
import { validarContrato } from '../src/validar.js';

const entrada = () => ({
  version: 1,
  origen: { solicitudId: 42, procesoCodigo: 'SED-LP-2026-0091' },
  cliente: { razonSocial: 'Cliente de Prueba S.A.S.', nit: '900123456', direccion: 'Calle 1 # 2-3' },
  contrato: { objeto: 'Servicio de aseo integral', porcentajeAIU: 12.32, valorMensual: 5000000, plazoMeses: 12 },
  oferta: { empresa: '01', undnegocio: 'BAQ', tipoAdm: 'A', origenProceso: 'LIC', codServicio: 'ASE', descripcionServicio: 'Aseo y cafetería' },
  tarifa: { manoObra: 61155743, insumos: 1000000, maquinaria: 500000, administrativos: 5000000, valorAgregado: 700000, serviciosNoContinuos: 250000 },
});
const datos = (cambiar = () => {}) => {
  const e = entrada();
  cambiar(e);
  const r = validarContrato(e);
  assert.equal(r.ok, true, JSON.stringify(r.errores));
  return r.datos;
};
const CLIENTE = { nit: '900123456-8', rsocial: 'CLIENTE DE PRUEBA S.A.S.' };
const HUELLA = 'ab12cd34ef56a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6';

describe('aiuComoFraccion', () => {
  it('convierte el porcentaje a la fracción que guarda la tarifa, sin coma flotante', () => {
    const casos = [[10, '0.1000'], [12.32, '0.1232'], [8, '0.0800'], [0.01, '0.0001'], [100, '1.0000'], [99.99, '0.9999'], [8.35, '0.0835'], [0.1, '0.0010']];
    for (const [porcentaje, esperado] of casos) assert.equal(aiuComoFraccion(porcentaje), esperado, `${porcentaje} %`);
  });
});

describe('planDeTarifa', () => {
  it('escribe EXACTAMENTE las 30 columnas del INSERT de cmdGrabar.Click, en su orden, más los 4 componentes históricos', () => {
    const { fila, errores } = planDeTarifa(datos(), { cliente: CLIENTE, numOferta: 937, huella: HUELLA });
    assert.deepEqual(errores, []);
    assert.deepEqual(Object.keys(fila), [...COLUMNAS_TARIFA_VFP, ...COLUMNAS_TARIFA_HISTORICAS]);
    assert.equal(COLUMNAS_TARIFA_VFP.length, 30);
  });

  it('cada valor va a la columna que le corresponde', () => {
    const { fila } = planDeTarifa(datos(), { cliente: CLIENTE, numOferta: 937, huella: HUELLA });
    assert.deepEqual(
      { ...fila, fadd: fila.fadd === AHORA ? 'NOW()' : fila.fadd },
      {
        empresa: '01', undnegocio: 'BAQ', num_oferta: 937, ncontrato: '', nit: '900123456-8', rsocial: 'CLIENTE DE PRUEBA S.A.S.', consec: 1,
        codservicio: 'ASE', descripcion: 'Aseo y cafetería', tipo_adm: 'A',
        tarifa: 61155743 + 1000000 + 500000 + 5000000 + 700000 + 250000,
        tar_manoobra: 61155743, tar_examenes: 0, tar_dotacion: 0, tar_impuestos: 5000000,
        aiu: '0.1232', aiu_examenes: 0, aiu_dotacion: 0,
        exa_medico_vta: 0, venta_dotacion: 0, dot_epp_factur: 0, costos_reembol: 0, aplica_dotacion: 0, aplica_examen: 0, aplica_curso: 0, curso_vta: 0,
        origen_proceso: 'LIC', user_add: 'LICICOLBA', fadd: 'NOW()', pc_add: 'LICICOLBA:42:ab12cd34ef56',
        tar_insumos: 1000000, tar_maquinaria: 500000, tar_otros: 700000, tar_nocontinuos: 250000,
      },
    );
  });

  it('la tarifa es la suma de los seis componentes (así está en el 99,7 % de las filas de producción)', () => {
    const { fila } = planDeTarifa(datos(), { cliente: CLIENTE, huella: HUELLA });
    const suma = fila.tar_manoobra + fila.tar_insumos + fila.tar_maquinaria + fila.tar_impuestos + fila.tar_otros + fila.tar_nocontinuos;
    assert.equal(fila.tarifa, suma);
  });

  it('sin número reservado (modo prueba) la fila lleva num_oferta nulo', () => {
    assert.equal(planDeTarifa(datos(), { cliente: CLIENTE, huella: HUELLA }).fila.num_oferta, null);
  });

  it('A.I.U. vacío o en 0: Contratos no deja guardar la tarifa', () => {
    for (const aiu of [0, null]) {
      const r = planDeTarifa(datos((e) => (e.contrato.porcentajeAIU = aiu)), { cliente: CLIENTE, huella: HUELLA });
      assert.equal(r.fila, null);
      assert.deepEqual(r.errores.map((e) => e.campo), ['contrato.porcentajeAIU']);
    }
  });

  it('cada valor debe caber en su columna: el valor agregado va a tar_otros, que es int(10)', () => {
    const ok = planDeTarifa(datos((e) => (e.tarifa.valorAgregado = MAX_INT10)), { cliente: CLIENTE, huella: HUELLA });
    assert.equal(ok.errores.length, 0);
    const mal = planDeTarifa(datos((e) => (e.tarifa.valorAgregado = MAX_INT10 + 1)), { cliente: CLIENTE, huella: HUELLA });
    assert.deepEqual(mal.errores.map((e) => e.campo), ['tarifa.valorAgregado']);
    assert.equal(mal.fila, null);
  });

  it('la suma no puede salirse del rango exacto de los enteros', () => {
    const r = planDeTarifa(datos((e) => { e.tarifa.manoObra = Number.MAX_SAFE_INTEGER; e.tarifa.insumos = 5; }), { cliente: CLIENTE, huella: HUELLA });
    assert.deepEqual(r.errores.map((e) => e.campo), ['tarifa']);
  });

  it('la descripción del servicio es opcional: sin ella la tarifa queda con descripción vacía, como el formulario', () => {
    const { fila } = planDeTarifa(datos((e) => delete e.oferta.descripcionServicio), { cliente: CLIENTE, huella: HUELLA });
    assert.equal(fila.descripcion, '');
  });

  it('no escribe columnas que el formulario no escribe ni toca las del contrato', () => {
    const { fila } = planDeTarifa(datos(), { cliente: CLIENTE, huella: HUELLA });
    for (const prohibida of ['tipo', 'tfa_global', 'marco', 'hay_cargos_recorrido', 'control_st', 'sector_economico', 'personas', 'id_oferta_adjudicada', 'user_mod', 'fmod', 'pc_mod', 'nro_factura']) {
      assert.ok(!(prohibida in fila), prohibida);
    }
  });
});

describe('planDeOfertaAdjudicada', () => {
  it('una fila con la clave, el cliente de Contratos y los valores en pesos enteros; adjudicado = suma de los seis', () => {
    const { errores, fila } = planDeOfertaAdjudicada(datos(), { cliente: CLIENTE, numOferta: 937, huella: HUELLA });
    assert.deepEqual(errores, []);
    assert.deepEqual(fila, {
      empresa: '01', undnegocio: 'BAQ', num_oferta: 937, nit: '900123456-8', rsocial: 'CLIENTE DE PRUEBA S.A.S.',
      vlr_adjudicado: 61155743 + 1000000 + 500000 + 5000000 + 700000 + 250000,
      vlr_manoobra: 61155743, vlr_insumos: 1000000, vlr_maquinaria: 500000, vlr_impuestos: 5000000, vlr_otros: 700000, vlr_nocontinuos: 250000,
      user_add: USUARIO_PUENTE, fadd: AHORA, pc_add: 'LICICOLBA:42:ab12cd34ef56',
    });
  });

  it('user_add y pc_add se ajustan al largo real de la columna; la marca corta sigue reconociendo la solicitud', () => {
    const { fila } = planDeOfertaAdjudicada(datos(), { cliente: CLIENTE, huella: HUELLA, largoUserAdd: 6, largoPcAdd: 20 });
    assert.equal(fila.user_add, 'LICICO');
    assert.equal(fila.pc_add, 'LICICOLBA:42:');
    assert.equal(marcaQueCabe(42, HUELLA, 60), 'LICICOLBA:42:ab12cd34ef56');
    assert.equal(marcaQueCabe(42, HUELLA, null), 'LICICOLBA:42:ab12cd34ef56');
  });

  it('sin número reservado (modo prueba) la fila lleva num_oferta nulo; lo que no viene va en 0', () => {
    const { fila } = planDeOfertaAdjudicada(datos((e) => { e.tarifa.valorAgregado = null; }), { cliente: CLIENTE });
    assert.equal(fila.num_oferta, null);
    assert.equal(fila.vlr_otros, 0);
  });

  it('las columnas int de MySQL no pasan de 2.147.483.647 aunque digan int(18): lo que no cabe es un error', () => {
    const { errores, fila } = planDeOfertaAdjudicada(datos((e) => { e.tarifa.manoObra = MAX_INT10; }), { cliente: CLIENTE });
    assert.equal(fila, null);
    assert.ok(errores.some((e) => /vlr_adjudicado/.test(e.mensaje)));
  });

  it('todas las columnas existen en el contrato de esquema y lo que se escribe cabe en ellas', () => {
    const tabla = cargarEsquemaEsperado().tablas.fc_ofertas_adjudicadas.columnas;
    const { fila } = planDeOfertaAdjudicada(datos(), { cliente: { nit: '999999999999-9', rsocial: 'y'.repeat(60) }, numOferta: 9999999 });
    for (const [columna, valor] of Object.entries(fila)) {
      const definicion = tabla[columna];
      assert.ok(definicion, `la columna ${columna} no está en esquema-esperado.json`);
      const largo = /^(?:var)?char\((\d+)\)$/.exec(definicion.tipo ?? '');
      if (largo && typeof valor === 'string') assert.ok(valor.length <= Number(largo[1]), `${columna}: ${valor.length} > ${largo[1]}`);
      if (/^int\(/.test(definicion.tipo ?? '') && typeof valor === 'number') assert.ok(valor <= MAX_INT10, `${columna} desborda`);
    }
    assert.ok(!('id' in fila), 'el id lo pone la base');
  });
});

describe('planDePreciosOferta (módulo 6)', () => {
  const conInsumos = (cambiar = () => {}) => datos((e) => {
    e.insumos = [
      { codigo: '18111', nombre: 'Jabón', valorUnitario: 10000 },
      { codigo: '01050', nombre: 'Bolsa', valorUnitario: 1234.56789 },
    ];
    cambiar(e);
  });

  it('una fila por código: costo, A.I.U. como fracción y precio de venta = costo × (1 + A.I.U.), a 4 decimales', () => {
    const { errores, advertencias, filas } = planDePreciosOferta(conInsumos(), { numOferta: 937 });
    assert.deepEqual([errores, advertencias], [[], []]);
    assert.deepEqual(filas.map(describirFila), [
      { undnegocio: 'BAQ', num_oferta: 937, ncontrato: '', cliente: 'tmp1', nom_punto: 'BAQ', codigo: '18111', valor: 11232, valor_anterior: 0, aiu: '0.1232', fadd: 'NOW()', user_add: 'LICICOLBA', vr_costo: 10000 },
      { undnegocio: 'BAQ', num_oferta: 937, ncontrato: '', cliente: 'tmp1', nom_punto: 'BAQ', codigo: '01050', valor: 1386.6667, valor_anterior: 0, aiu: '0.1232', fadd: 'NOW()', user_add: 'LICICOLBA', vr_costo: 1234.5679 },
    ]);
  });

  it('un código repetido se escribe una vez (el primero) y se avisa', () => {
    const { advertencias, filas } = planDePreciosOferta(conInsumos((e) => e.insumos.push({ codigo: '18111', valorUnitario: 1 })));
    assert.equal(filas.length, 2);
    assert.deepEqual(advertencias.map((a) => a.campo), ['insumos[2].codigo']);
  });

  it('sin insumos no hay filas; una UEN de más de 3 caracteres no cabe en la lista de precios', () => {
    assert.deepEqual(planDePreciosOferta(datos()).filas, []);
    const { errores } = planDePreciosOferta(conInsumos((e) => (e.oferta.undnegocio = 'BAQ1')));
    assert.deepEqual(errores.map((e) => e.campo), ['oferta.undnegocio']);
  });

  it('todas las columnas existen en el contrato de esquema y lo que se escribe cabe en ellas', () => {
    const tabla = cargarEsquemaEsperado().tablas.fc_preciosventas_oferta.columnas;
    const [fila] = planDePreciosOferta(conInsumos((e) => (e.insumos[0].codigo = 'X'.repeat(10))), { numOferta: 9999999 }).filas;
    for (const [columna, valor] of Object.entries(fila)) {
      const definicion = tabla[columna];
      assert.ok(definicion, `la columna ${columna} no está en esquema-esperado.json`);
      const largo = /^(?:var)?char\((\d+)\)$/.exec(definicion.tipo ?? '');
      if (largo && typeof valor === 'string') assert.ok(valor.length <= Number(largo[1]), `${columna}: ${valor.length} > ${largo[1]}`);
    }
    assert.ok(!('id' in fila), 'el id lo pone la base (auto_increment)');
  });
});

describe('marca de origen', () => {
  it('identifica la solicitud y el contenido, y el patrón de una solicitud no atrapa a otra', () => {
    assert.equal(marcaDeOrigen(42, HUELLA), 'LICICOLBA:42:ab12cd34ef56');
    assert.equal(patronDeSolicitud(42), 'LICICOLBA:42:%');
    // LIKE 'LICICOLBA:4:%' no debe coincidir con la marca de la solicitud 42 (ni al revés).
    const comoLike = (patron) => new RegExp(`^${patron.replace('%', '.*')}$`);
    assert.equal(comoLike(patronDeSolicitud(4)).test(marcaDeOrigen(42, HUELLA)), false);
    assert.equal(comoLike(patronDeSolicitud(42)).test(marcaDeOrigen(4, HUELLA)), false);
    assert.equal(comoLike(patronDeSolicitud(42)).test(marcaDeOrigen(42, HUELLA)), true);
  });
});

describe('noEscritoEnLaOferta y describirFila', () => {
  it('informa lo que LiciColba envió y este módulo no escribe', () => {
    assert.deepEqual(noEscritoEnLaOferta(datos()).map((n) => n.campo), ['contrato.porcentajeAIU', 'oferta.tipoAdm', 'oferta.origenProceso', 'oferta.codServicio', 'contrato.objeto', 'contrato.valorMensual', 'contrato.plazoMeses', 'cliente.direccion']);
    const sin = datos((e) => { e.contrato.objeto = ''; e.cliente.direccion = ''; });
    assert.ok(!noEscritoEnLaOferta(sin).some((n) => ['contrato.objeto', 'cliente.direccion'].includes(n.campo)));
  });

  it('NOW() se muestra como texto', () => {
    const { fila } = planDeTarifa(datos(), { cliente: CLIENTE, huella: HUELLA });
    assert.equal(describirFila(fila).fadd, 'NOW()');
    assert.doesNotThrow(() => JSON.stringify(describirFila(fila)));
  });
});

describe('comparable', () => {
  it('ignora mayúsculas, tildes, puntuación y espacios repetidos', () => {
    assert.equal(comparable('Cajacopi  Atlántico, S.A.S.'), comparable('CAJACOPI ATLANTICO S A S'));
    assert.notEqual(comparable('Cajacopi'), comparable('Cajanal'));
  });
});

describe('planDeCargos', () => {
  /** Dos líneas del mismo cargo (mismo nombre y salario), el mismo nombre con otro salario y otro cargo. Suman 71.500.001. */
  const CARGOS = () => [
    { nombre: 'Aseador', cantidad: 4, horasSemana: 48, jornada: 8, salario: 1423500, riesgo: 1, valorUnitario: 10000000, valorTotal: 40000000, codigoHorario: '941' },
    { nombre: ' ASEADOR ', cantidad: 2, horasSemana: 44, jornada: 7.33, salario: 1423500, riesgo: 1, valorUnitario: 9000000.5, valorTotal: 18000001 },
    { nombre: 'Aseador', cantidad: 1, horasSemana: 48, jornada: 8, salario: 1700000, riesgo: 1, valorUnitario: 11000000, valorTotal: 11000000 },
    { nombre: 'Supervisor', cantidad: 1, horasSemana: 48, jornada: 8, salario: 2500000, riesgo: 2, valorUnitario: 2500000, valorTotal: 2500000 },
  ];
  /** Con el 12,32 % de A.I.U., 71.500.001 son 80.308.801 (lo que debería traer la mano de obra de la tarifa). */
  const conCargos = (cambiar = () => {}) =>
    datos((e) => {
      e.tarifa.manoObra = 80308801;
      e.cargos = CARGOS();
      cambiar(e);
    });

  it('escribe EXACTAMENTE las 47 columnas del INSERT de cargos de cmdGrabar.Click, en su orden; el horario se agrega solo si viene', () => {
    const { filas, errores } = planDeCargos(conCargos(), { numOferta: 937, huella: HUELLA });
    assert.deepEqual(errores, []);
    assert.equal(COLUMNAS_CARGO_VFP.length, 47);
    assert.deepEqual(Object.keys(filas[0]), [...COLUMNAS_CARGO_VFP, COLUMNA_CARGO_HORARIO]);
    assert.deepEqual(Object.keys(filas[1]), COLUMNAS_CARGO_VFP);
    assert.equal(filas[0][COLUMNA_CARGO_HORARIO], '941');
  });

  it('el código de cargo es un consecutivo por oferta: misma información ⇒ mismo código; otro salario u otro cargo ⇒ otro código', () => {
    const { filas } = planDeCargos(conCargos(), { numOferta: 937, huella: HUELLA });
    assert.deepEqual(filas.map((f) => f.cargo), [1, 1, 2, 3]);
    assert.deepEqual(filas.map((f) => f.item), [1, 2, 3, 4], 'cada línea tiene su ítem: nunca se repite (sección, ítem, cargo)');
    const claves = filas.map((f) => `${f.cod_seccion}|${f.item}|${f.cargo}`);
    assert.equal(new Set(claves).size, claves.length);
  });

  it('cada valor va a la columna que le corresponde; lo que LiciColba no trae queda como lo inserta el formulario', () => {
    const { filas } = planDeCargos(conCargos(), { numOferta: 937, huella: HUELLA });
    const { fadd, ...fila } = filas[0];
    assert.equal(fadd, AHORA);
    assert.deepEqual(fila, {
      empresa: '01', undnegocio: 'BAQ', ncontrato: '', num_oferta: 937, consec: 1, concepto: 'ASE', cod_seccion: 0, tipo_cargo: '', item: 1, cargo: 1,
      jornada: 8, horassem: 48, cantidad: 4, vlr_unitario: 10000000, vlr_total: 40000000, codmun: '', salario: 1423500, dotm: '', dotf: '', riesgo: 1, tipocont: '',
      epp: '', examen: '', snextras: 0, snrecargos: 0, snfestivos: 0, snextrasf: 0, cnextras: 0, cnrecargos: 0, cnfestivos: 0, cnextrasf: 0,
      rnocturno: 0, ediurnas: 0, rfestivas: 0, enocturnas: 0, hfestivas: 0, efestivas: 0, enocturnasf: 0,
      nom_cargo: 'Aseador', nivel_educacion: '', titulo_educacion: '', curso_formacion: '', experiencia: 0, cod_grupo_curso: '',
      user_add: 'LICICOLBA', pc_add: 'LICICOLBA:42:ab12cd34ef56', codhorario: '941',
    });
  });

  it('sin número reservado (modo prueba) la fila lleva num_oferta nulo', () => {
    assert.equal(planDeCargos(conCargos(), { huella: HUELLA }).filas[0].num_oferta, null);
  });

  it('el valor total debe ser valorUnitario × cantidad (con 1 peso de holgura): lo contrario es un error de LiciColba', () => {
    const r = planDeCargos(conCargos((e) => { e.cargos[2].valorTotal = 12000000; }), { numOferta: 937, huella: HUELLA });
    assert.deepEqual(r.errores.map((e) => e.campo), ['cargos[2].valorTotal']);
    const holgura = planDeCargos(conCargos((e) => { e.cargos[1].valorTotal = 18000001.9; }), { numOferta: 937, huella: HUELLA });
    assert.deepEqual(holgura.errores, []);
  });

  it('avisa (sin bloquear) si los cargos no suman lo que equivale la mano de obra de la tarifa; cuadran con 1 peso por cargo de holgura', () => {
    const cuadra = planDeCargos(conCargos(), { numOferta: 937, huella: HUELLA });
    assert.deepEqual(cuadra.advertencias, []);
    const descuadra = planDeCargos(conCargos((e) => { e.cargos.pop(); }), { numOferta: 937, huella: HUELLA });
    assert.deepEqual(descuadra.advertencias.map((a) => a.campo), ['cargos']);
    assert.match(descuadra.advertencias[0].mensaje, /Los cargos suman 69\.000\.001 sin A\.I\.U\./);
    const sinAIU = planDeCargos(conCargos((e) => { e.contrato.porcentajeAIU = null; }), { numOferta: 937, huella: HUELLA });
    assert.deepEqual(sinAIU.advertencias, [], 'sin A.I.U. no hay con qué comparar');
  });

  it('sin cargos (o sin la clave de la oferta) no hay filas', () => {
    assert.deepEqual(planDeCargos(datos(), { huella: HUELLA }), { errores: [], advertencias: [], filas: [] });
    const sinOferta = { ...conCargos(), oferta: null };
    assert.deepEqual(planDeCargos(sinOferta, { huella: HUELLA }).filas, []);
  });

  it('informa lo que de los cargos no se escribe (se completa en Contratos)', () => {
    const campos = noEscritoEnLaOferta(conCargos()).map((n) => n.campo);
    assert.ok(campos.includes('cargos'));
    assert.ok(!noEscritoEnLaOferta(datos()).some((n) => n.campo === 'cargos'));
  });
});
