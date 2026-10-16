import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cargarEsquemaEsperado } from '../src/esquema.js';
import {
  AHORA, aiuComoFraccion, comparable, COLUMNA_CARGO_HORARIO, COLUMNAS_CARGO_PANTALLA, COLUMNAS_CARGO_VFP, COLUMNAS_TARIFA_HISTORICAS, COLUMNAS_TARIFA_VFP, describirFila, marcaDeOrigen,
  codigosDeNomina, conceptoDeCostoAdmtivo, marcaQueCabe, MAX_INT10, noEscritoEnLaOferta, patronDeSolicitud, planDeCargos, planDeCostosAdministrativos, planDeInsumosOferta,
  claveDeSubtipo, dtiposDeEquipos, planDeEquipos, planDeNoContinuos, planDeOfertaAdjudicada, planDePreciosOferta, planDeTarifa, planDeValoresAgregados, TIPO_VALOR_AGREGADO, tipoDeActividad, USUARIO_PUENTE,
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

const cabeEnLaTabla = (tabla, fila) => {
  const columnas = cargarEsquemaEsperado().tablas[tabla].columnas;
  for (const [columna, valor] of Object.entries(fila)) {
    const definicion = columnas[columna];
    assert.ok(definicion, `la columna ${tabla}.${columna} no está en esquema-esperado.json`);
    const largo = /^(?:var)?char\((\d+)\)$/.exec(definicion.tipo ?? '');
    if (largo && typeof valor === 'string') assert.ok(valor.length <= Number(largo[1]), `${columna}: ${valor.length} > ${largo[1]}`);
  }
};

describe('planDeInsumosOferta (pestaña Insumos, fc_elemxcont)', () => {
  const conInsumos = (cambiar = () => {}) => datos((e) => {
    e.insumos = [
      { codigo: '18111', nombre: 'Jabón', valorUnitario: 10000, cantidad: 3, frecuenciaMeses: 2, valorUnitarioConIva: 11900.123456 },
      { codigo: 'ab01', nombre: 'Bolsa', valorUnitario: 500, cantidad: 10, frecuenciaMeses: 1, valorUnitarioConIva: 595 },
    ];
    cambiar(e);
  });

  it('una fila por insumo como las ofertas a mano: tipo F, cantidad, frecuencia y valor CON IVA; NIT y nombre del cliente', () => {
    const { errores, advertencias, filas } = planDeInsumosOferta(conInsumos(), { numOferta: 937, huella: HUELLA, cliente: CLIENTE });
    assert.deepEqual([errores, advertencias], [[], []]);
    assert.deepEqual(filas.map(describirFila), [
      {
        empresa: '01', undnegocio: 'BAQ', nit: '900123456-8', ncontrato: '', tipo_insumo: 'F', codele: '18111', cantidad: 3, frecuencia: 2, vlr_unitario: 11900.12346,
        cantsoli: 0, num_oferta: 937, consec: 1, concepto: 'ASE', codmun: '', fadd: 'NOW()', user_add: 'LICICOLBA', pc_add: marcaDeOrigen(42, HUELLA), nitloc: '',
        nombre_punto: 'CLIENTE DE PRUEBA S.A.S.', clase: 1, vlr_unitario_va: 0,
      },
      {
        empresa: '01', undnegocio: 'BAQ', nit: '900123456-8', ncontrato: '', tipo_insumo: 'F', codele: 'AB01', cantidad: 10, frecuencia: 1, vlr_unitario: 595,
        cantsoli: 0, num_oferta: 937, consec: 1, concepto: 'ASE', codmun: '', fadd: 'NOW()', user_add: 'LICICOLBA', pc_add: marcaDeOrigen(42, HUELLA), nitloc: '',
        nombre_punto: 'CLIENTE DE PRUEBA S.A.S.', clase: 1, vlr_unitario_va: 0,
      },
    ]);
  });

  it('un insumo sin cantidad, frecuencia o valor con IVA no va a la pestaña (sí a la lista de precios) y se avisa', () => {
    const { advertencias, filas } = planDeInsumosOferta(conInsumos((e) => {
      delete e.insumos[0].valorUnitarioConIva;
      e.insumos[1].cantidad = 0;
    }), { cliente: CLIENTE });
    assert.deepEqual(filas, []);
    assert.deepEqual(advertencias.map((a) => a.mensaje), ['Sin cantidad, frecuencia o valor con IVA (van solo a la lista de precios): 18111, ab01.']);
  });

  it('sin insumos no hay filas; las columnas existen y lo que se escribe cabe', () => {
    assert.deepEqual(planDeInsumosOferta(datos()).filas, []);
    const largo = { nit: '900123456-8', rsocial: 'Ñ'.repeat(200) };
    const [fila] = planDeInsumosOferta(conInsumos(), { numOferta: 1, huella: HUELLA, cliente: largo }).filas;
    assert.equal(fila.nombre_punto.length, 60);
    cabeEnLaTabla('fc_elemxcont', fila);
  });
});

describe('planDeCostosAdministrativos (pestaña Costos Admtivos)', () => {
  const conCostos = (costos) => datos((e) => (e.costosAdministrativos = costos));

  it('conceptoDeCostoAdmtivo: por nombre sin tildes, por alias, y si no existe a «OTROS»', () => {
    assert.equal(conceptoDeCostoAdmtivo('Pólizas').id, 1);
    assert.equal(conceptoDeCostoAdmtivo('Papelería').id, 6);
    assert.equal(conceptoDeCostoAdmtivo('Plan de datos').id, 8);
    assert.equal(conceptoDeCostoAdmtivo('Transporte de insumos').id, 3);
    assert.deepEqual(conceptoDeCostoAdmtivo('Microsoft'), { id: 11, descripcion: 'OTROS', esOtros: true });
    assert.equal(conceptoDeCostoAdmtivo('Microsoft', [{ id: 1, descripcion: 'PÓLIZAS' }]), null);
  });

  it('una fila por concepto de Contratos con su valor mensual en pesos; lo que no existe se suma en OTROS y se avisa', () => {
    const { errores, advertencias, filas } = planDeCostosAdministrativos(conCostos([
      { concepto: 'Pólizas', valorMensual: 2500.4 },
      { concepto: 'Impuestos', valorMensual: 1000 },
      { concepto: 'Papelería', valorMensual: 1500 },
      { concepto: 'Microsoft', valorMensual: 300 },
      { concepto: 'Carnet', valorMensual: 200 },
      { concepto: 'Kontrol ID', valorMensual: 0 },
    ]), { numOferta: 937, huella: HUELLA, cliente: CLIENTE });
    assert.deepEqual(errores, []);
    assert.deepEqual(advertencias.map((a) => a.mensaje), ['Van en «OTROS» porque Contratos no tiene ese concepto: Microsoft, Carnet.']);
    const comun = {
      empresa: '01', undnegocio: 'BAQ', num_oferta: 937, ncontrato: '', consec: 1, concepto: 'ASE', punto_entrega: '0000000000',
      nombre_punto: 'CLIENTE DE PRUEBA S.A.S.', codmun: '', user_add: 'LICICOLBA', fadd: 'NOW()', pc_add: marcaDeOrigen(42, HUELLA),
    };
    assert.deepEqual(filas.map(describirFila), [
      { ...comun, id_cpto_costo: 1, valor: 2500 },
      { ...comun, id_cpto_costo: 2, valor: 1000 },
      { ...comun, id_cpto_costo: 6, valor: 1500 },
      { ...comun, id_cpto_costo: 11, valor: 500 },
    ].map((f) => Object.fromEntries(Object.keys(filas[0]).map((k) => [k, f[k]]))));
  });

  it('usa el catálogo que se le pase (el real de la base) y sin «OTROS» un concepto desconocido detiene el envío', () => {
    const catalogo = [{ id: 7, descripcion: 'PÓLIZAS' }];
    const { errores, filas } = planDeCostosAdministrativos(conCostos([{ concepto: 'Pólizas', valorMensual: 1 }, { concepto: 'Carnet', valorMensual: 1 }]), { catalogo });
    assert.deepEqual(filas.map((f) => f.id_cpto_costo), [7]);
    assert.deepEqual(errores.map((e) => e.campo), ['costosAdministrativos[1].concepto']);
  });

  it('sin costos no hay filas; las columnas existen y lo que se escribe cabe', () => {
    assert.deepEqual(planDeCostosAdministrativos(datos()).filas, []);
    const [fila] = planDeCostosAdministrativos(conCostos([{ concepto: 'Pólizas', valorMensual: 1 }]), { numOferta: 1, huella: HUELLA, cliente: CLIENTE }).filas;
    cabeEnLaTabla('fc_contratos_costos_admtivos_iniciales', fila);
  });
});

describe('planDeEquipos (pestaña Equipos)', () => {
  const conEquipos = (equipos) => datos((e) => (e.equipos = equipos));
  const ASPIRADORA = { codigoGrupo: '004', codigoSubtipo: '096', descripcion: 'Aspiradora industrial', valorUnitario: 1190000, cantidadRequerida: 2, cantidadComprar: 1, mesesDepreciacion: 12, valorMesMantenimiento: 23000.4 };

  it('una fila por máquina como las ofertas a mano: grupo/subtipo, a comprar, requeridas, meses, valor con IVA y mantenimiento', () => {
    const { errores, advertencias, filas } = planDeEquipos(conEquipos([ASPIRADORA]), { numOferta: 937, huella: HUELLA, cliente: CLIENTE });
    assert.deepEqual([errores, advertencias], [[], []]);
    assert.deepEqual(describirFila(filas[0]), {
      empresa: '01', undnegocio: 'BAQ', num_oferta: 937, ncontrato: '', consec: 1, concepto: 'ASE', tipo_servicio: '', codmun: '', punto_entrega: '0000000000',
      nom_punto_entrega: 'CLIENTE DE PRUEBA S.A.S.', tipo_equipo: '004', subtipo_equipo: '096', codigo: '', descrip_equipo: 'Aspiradora industrial',
      precio_costo: 1190000, porc_vlr_compra: 1, cantidad: 1, frecuencia: 12, valor: 1190000, cant_facturar: 2, valor_inicial: 1190000,
      user_add: 'LICICOLBA', fadd: 'NOW()', pc_add: marcaDeOrigen(42, HUELLA), dtipo_equipo: '', vlr_mes_mantenimiento: 23000, vlr_mes_otr_rubros: 0, clase: 1, valor_inicial_va: 0,
    });
    cabeEnLaTabla('fc_contratos_equipos_iniciales', filas[0]);
  });

  it('el «Tipo» (dtipo_equipo) sale del catálogo act_subtipos; si el subtipo no tiene tipo, va vacío y se avisa', () => {
    const dtipos = dtiposDeEquipos([{ id: 1, uen: '', grupo: '004', subtipo: '096', dtipo: '018' }], 'BAQ');
    const { advertencias, filas } = planDeEquipos(conEquipos([ASPIRADORA, { ...ASPIRADORA, codigoSubtipo: '097', descripcion: 'Escalera' }]), { dtipos });
    assert.deepEqual(filas.map((f) => f.dtipo_equipo), ['018', '']);
    assert.deepEqual(advertencias.map((a) => a.mensaje), ['Subtipo sin «Tipo» en el catálogo de activos de Contratos (se completa en Contratos): Escalera.']);
  });

  it('sin compra ni mantenimiento no va; sin grupo va y se avisa', () => {
    const { advertencias, filas } = planDeEquipos(conEquipos([
      { ...ASPIRADORA, cantidadComprar: 0, valorMesMantenimiento: 0 },
      { ...ASPIRADORA, codigoGrupo: null, descripcion: 'Escalera' },
    ]));
    assert.deepEqual(filas.map((f) => f.descrip_equipo), ['Escalera']);
    assert.deepEqual(advertencias.map((a) => a.mensaje), [
      'Sin compra ni mantenimiento (no van a la pestaña Equipos): Aspiradora industrial.',
      'Sin grupo o subtipo del activo (se completan en Contratos): Escalera.',
    ]);
  });
});

describe('dtiposDeEquipos (Tipo del activo entre Grupo y Subtipo)', () => {
  it('prefiere la fila de la UEN de la oferta, luego la sin UEN, luego la de menor id; ignora tipos vacíos', () => {
    const filas = [
      { id: 30, uen: 'MNA', grupo: '004', subtipo: '171', dtipo: '025' },
      { id: 20, uen: '', grupo: '004', subtipo: '171', dtipo: '018' },
      { id: 10, uen: '', grupo: '004', subtipo: '171', dtipo: '014' },
      { id: 5, uen: 'BAQ', grupo: '004  ', subtipo: '172', dtipo: '   ' },
      { id: 6, uen: '', grupo: '004', subtipo: '172', dtipo: '008' },
      { id: 7, uen: 'BAQ', grupo: '005', subtipo: '002', dtipo: '029' },
    ];
    const dtipos = dtiposDeEquipos(filas, 'baq');
    assert.deepEqual(Object.fromEntries(dtipos), { '004|171': '014', '004|172': '008', '005|002': '029' });
    assert.equal(dtiposDeEquipos(filas, 'MNA').get('004|171'), '025');
    assert.equal(dtipos.get(claveDeSubtipo('4', '172')), '008', 'códigos numéricos a 3 dígitos');
  });
});

describe('planDeNoContinuos (pestaña Servs. No Continuos)', () => {
  const BRIGADA = { actividad: 14, uen: 'BAQ', descripcion: 'Brigada de aseo', frecuencia: 3, manoObra: 116969, insumos: 61439, equipos: 35266, otrosCostos: 0, valorServicio: 213674, valorMensual: 71224.67 };
  const conServicios = (servicios) => datos((e) => (e.serviciosNoContinuos = servicios));

  it('una fila por servicio: actividad y UEN del catálogo, frecuencia, costo de cada servicio por rubro y valor mensual (VM)', () => {
    const { errores, advertencias, filas } = planDeNoContinuos(conServicios([BRIGADA]), { numOferta: 937, huella: HUELLA, cliente: CLIENTE });
    assert.deepEqual([errores, advertencias], [[], []]);
    const f = describirFila(filas[0]);
    assert.deepEqual(
      [f.actividad, f.UEN_Adm, f.uen_punto, f.tipo_actividad, f.frecuencia, f.tipo_facturacion, f.valor, f.vlr_mes, f.vlr_mano_obra, f.vlr_insumos, f.vlr_equipos, f.vlr_costos, f.cant_servs_contrato, f.clase, f.tipo],
      [14, 'BAQ', 'BAQ', 'AMBOS', 3, 'VM', 213674, 71225, 116969, 61439, 35266, 0, 4, 1, 1],
    );
    assert.equal(f.descrip_servicio, 'Brigada de aseo');
    cabeEnLaTabla('fc_contratos_no_continuos_iniciales', filas[0]);
  });

  it('tipo de actividad según lo que lleva; sin código del catálogo va y se avisa; sin valor no va', () => {
    assert.deepEqual([tipoDeActividad({ manoObra: 1, equipos: 0 }), tipoDeActividad({ manoObra: 0, equipos: 1 }), tipoDeActividad({ manoObra: 1, equipos: 1 })], ['REHUM', 'MAQUI', 'AMBOS']);
    const { advertencias, filas } = planDeNoContinuos(conServicios([{ ...BRIGADA, actividad: null }, { ...BRIGADA, valorMensual: 0 }]));
    assert.equal(filas.length, 1);
    assert.equal(filas[0].actividad, 0);
    assert.equal(advertencias.length, 1);
  });
});

describe('planDeValoresAgregados (pestaña Valores Agregados)', () => {
  it('una fila por valor agregado con su tipo, valor mensual, tipo y frecuencia de reinversión y porcentaje; marca en usuario/pc', () => {
    const { filas } = planDeValoresAgregados(datos((e) => (e.valoresAgregados = [
      { tipo: 'REINVERSION', valorMensual: 291666.666, frecuencia: 12, tipoReinversion: 'PORCENTAJE', porcentaje: 1.5 },
      { tipo: 'MAQUINARIA', valorMensual: 1000 },
      { tipo: 'SNC', valorMensual: 0 },
    ])), { numOferta: 937, huella: HUELLA });
    assert.deepEqual(filas.map(describirFila), [
      { empresa: '01', undnegocio: 'BAQ', num_oferta: 937, ncontrato: '', consec: 1, concepto: 'ASE', tipo: TIPO_VALOR_AGREGADO.REINVERSION, valor: 291666.67, tipo_reinv: 2, frec_reinv: 12, porc_reinv: 1.5, fproc: 'NOW()', usuario: 'LICICOLBA', pc: marcaDeOrigen(42, HUELLA) },
      { empresa: '01', undnegocio: 'BAQ', num_oferta: 937, ncontrato: '', consec: 1, concepto: 'ASE', tipo: TIPO_VALOR_AGREGADO.MAQUINARIA, valor: 1000, tipo_reinv: 1, frec_reinv: 1, porc_reinv: 0, fproc: 'NOW()', usuario: 'LICICOLBA', pc: marcaDeOrigen(42, HUELLA) },
    ]);
    cabeEnLaTabla('fc_contratos_vlrs_agregs_iniciales', filas[0]);
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
    assert.deepEqual(noEscritoEnLaOferta(datos()).map((n) => n.campo), ['contrato.objeto', 'contrato.valorMensual', 'contrato.plazoMeses', 'cliente.direccion']);
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

describe('codigosDeNomina', () => {
  const contexto = { empresa: '01', undnegocio: 'BAQ', base: 'nominabq' };
  /** Como en nominabq.cargos: los de la sede (01/BAQ), los generales (operativos, sin empresa ni UEN) y uno de otra UEN. */
  const BAQ = [
    { empresa: '01', undnegocio: 'BAQ', codigo: 8, nombre: 'SECRETARIA' },
    { empresa: '01', undnegocio: 'BAQ', codigo: 16, nombre: 'SECRETARIA' },
    { empresa: '01', undnegocio: 'BAQ', codigo: 104, nombre: 'SUPERVISOR' },
    { empresa: '', undnegocio: '', codigo: 339, nombre: 'SUPERVISOR' },
    { empresa: '', undnegocio: '', codigo: 99, nombre: 'ASEADOR' },
    { empresa: '', undnegocio: '', codigo: 18, nombre: 'SUPERVISOR  SENIOR' },
    { empresa: '', undnegocio: '', codigo: 426, nombre: 'TURNANTE' },
    { empresa: '02', undnegocio: 'MED', codigo: 500, nombre: 'CONDUCTOR' },
    { empresa: '', undnegocio: '', codigo: null, nombre: 'SIN CODIGO' },
  ];
  const cruzar = (nombres, filas = BAQ, ctx = contexto) => codigosDeNomina(nombres.map((nombre) => ({ nombre })), filas, ctx);

  it('cruza por nombre sin importar mayúsculas, tildes ni espacios repetidos', () => {
    const r = cruzar(['Aseador', 'supervisor senior']);
    assert.deepEqual(r.codigos, [99, 18]);
    assert.deepEqual([r.errores, r.advertencias], [[], []]);
  });

  it('prefiere el cargo general (operativo) al de la sede, y avisa cuando el nombre tiene varios códigos', () => {
    const r = cruzar(['Supervisor', 'Secretaria']);
    assert.deepEqual(r.codigos, [339, 8]);
    assert.deepEqual(r.advertencias.map((a) => a.campo), ['cargos[0].nombre', 'cargos[1].nombre']);
    assert.match(r.advertencias[1].mensaje, /códigos 8, 16\): se escribió el 8/);
  });

  it('un cargo que no está, que es de otra empresa/UEN, o una fila sin código: error por línea', () => {
    const r = cruzar(['Conductor', 'Sin código', '  ']);
    assert.deepEqual(r.codigos, [null, null, null]);
    assert.deepEqual(r.errores.map((e) => e.campo), ['cargos[0].nombre', 'cargos[1].nombre', 'cargos[2].nombre']);
    assert.match(r.errores[0].mensaje, /«Conductor» no existe en la nómina de la UEN BAQ \(nominabq\.cargos\)/);
  });

  it('el turnante automático de LiciColba es el cargo TURNANTE', () => {
    assert.deepEqual(cruzar(['Turnante — bloque integrado de 42h']).codigos, [426]);
  });

  it('nominamn.cargos no tiene empresa ni UEN y corta el nombre en 30 caracteres: igual se cruza', () => {
    const mina = [{ codigo: 112, nombre: 'UJIER' }, { codigo: 77, nombre: 'OPERADOR DE EQUIPO PESADO MINE' }];
    const r = cruzar(['Ujier', 'Operador de equipo pesado minero'], mina, { empresa: '03', undnegocio: 'MIN', base: 'nominamn' });
    assert.deepEqual(r.codigos, [112, 77]);
    assert.deepEqual(r.errores, []);
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

  it('los grupos del catálogo van a dotm, dotf, epp, examen y cod_grupo_curso; sin grupo quedan vacíos como en el formulario', () => {
    const { filas } = planDeCargos(conCargos((e) => {
      Object.assign(e.cargos[0], { grupoDotacionMasculina: 'm025', grupoDotacionFemenina: 'F009', grupoEpp: 'EP095', grupoExamen: 'EM007', grupoCurso: 'GC010' });
    }), { numOferta: 937, huella: HUELLA });
    assert.deepEqual([filas[0].dotm, filas[0].dotf, filas[0].epp, filas[0].examen, filas[0].cod_grupo_curso], ['M025', 'F009', 'EP095', 'EM007', 'GC010']);
    assert.deepEqual([filas[1].dotm, filas[1].dotf, filas[1].epp, filas[1].examen, filas[1].cod_grupo_curso], ['', '', '', '', '']);
  });

  it('el código de cargo es el de nómina que se le pase por línea; sin él (modo prueba) va nulo', () => {
    assert.deepEqual(planDeCargos(conCargos(), { numOferta: 937, huella: HUELLA, codigosNomina: [99, 99, 99, 339] }).filas.map((f) => f.cargo), [99, 99, 99, 339]);
    assert.deepEqual(planDeCargos(conCargos(), { huella: HUELLA }).filas.map((f) => f.cargo), [null, null, null, null]);
  });

  it('escribe las 47 columnas del INSERT de cargos de cmdGrabar.Click en su orden, luego las que usa la pantalla; el horario solo si viene', () => {
    const { filas, errores } = planDeCargos(conCargos(), { numOferta: 937, huella: HUELLA });
    assert.deepEqual(errores, []);
    assert.equal(COLUMNAS_CARGO_VFP.length, 47);
    assert.deepEqual(Object.keys(filas[0]), [...COLUMNAS_CARGO_VFP, ...COLUMNAS_CARGO_PANTALLA, COLUMNA_CARGO_HORARIO]);
    assert.deepEqual(Object.keys(filas[1]), [...COLUMNAS_CARGO_VFP, ...COLUMNAS_CARGO_PANTALLA]);
    assert.equal(filas[0][COLUMNA_CARGO_HORARIO], '941');
  });

  it('cada línea tiene su ítem (1, 2, 3…): nunca se repite (sección, ítem, cargo) aunque el cargo de nómina sea el mismo', () => {
    const { filas } = planDeCargos(conCargos(), { numOferta: 937, huella: HUELLA, codigosNomina: [99, 99, 99, 339] });
    assert.deepEqual(filas.map((f) => f.item), [1, 2, 3, 4]);
    const claves = filas.map((f) => `${f.cod_seccion}|${f.item}|${f.cargo}`);
    assert.equal(new Set(claves).size, claves.length);
  });

  it('cada valor va a la columna que le corresponde; lo que LiciColba no trae queda como lo inserta el formulario', () => {
    const { filas } = planDeCargos(conCargos(), { numOferta: 937, huella: HUELLA, codigosNomina: [99, 99, 99, 339] });
    const { fadd, ...fila } = filas[0];
    assert.equal(fadd, AHORA);
    assert.deepEqual(fila, {
      empresa: '01', undnegocio: 'BAQ', ncontrato: '', num_oferta: 937, consec: 1, concepto: 'ASE', cod_seccion: 0, tipo_cargo: 'F', item: 1, cargo: 99,
      jornada: 8, horassem: 48, cantidad: 4, vlr_unitario: 10000000, vlr_total: 40000000, codmun: '', salario: 1423500, dotm: '', dotf: '', riesgo: 1, tipocont: '',
      epp: '', examen: '', snextras: 0, snrecargos: 0, snfestivos: 0, snextrasf: 0, cnextras: 0, cnrecargos: 0, cnfestivos: 0, cnextrasf: 0,
      rnocturno: 0, ediurnas: 0, rfestivas: 0, enocturnas: 0, hfestivas: 0, efestivas: 0, enocturnasf: 0,
      nom_cargo: 'Aseador', nivel_educacion: '', titulo_educacion: '', curso_formacion: '', experiencia: 0, cod_grupo_curso: '',
      user_add: 'LICICOLBA', pc_add: 'LICICOLBA:42:ab12cd34ef56',
      // como las ofertas digitadas en Contratos: 30 veces al mes, valor de cargos = valor total, sin bonos
      nro_veces_mes: 30, vlr_cargos: 40000000, clasebono_alim: '00', clasebono_trans: '00', clasebono_prod: '00', clasebono_prest: '00',
      codhorario: '941',
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
