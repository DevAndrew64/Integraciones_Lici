import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { claveDeTarifa, planDeCargos, planDeCostosAdministrativos, planDeTarifa, tarifasDeOferta } from '../src/oferta.js';
import { validarContrato } from '../src/validar.js';

const HUELLA = 'ab12cd34ef567890';
const CLIENTE = { nit: '900123456-8', rsocial: 'CLIENTE DE PRUEBA S.A.S.' };
const archivo = () => JSON.parse(readFileSync(new URL('./fixtures/payload-licicolba.json', import.meta.url), 'utf8'));

/** La oferta del archivo de LiciColba partida en dos tarifas: aseo (452) con el aseador y cafetería (453) con el turnante. */
function enDosTarifas(cambios = (e) => e) {
  const e = archivo();
  e.tarifas = [
    { consec: 1, codServicio: '452', descripcion: 'Aseo', manoObra: 9871200, insumos: 0, maquinaria: 0, administrativos: 4320, valorAgregado: 0, serviciosNoContinuos: 0 },
    { consec: 2, codServicio: '453', descripcion: 'Cafetería', manoObra: 3240000, insumos: 0, maquinaria: 0, administrativos: 1080, valorAgregado: 0, serviciosNoContinuos: 0 },
  ];
  e.cargos[1].tarifa = 2;
  e.costosAdministrativos[0].tarifa = 1;
  e.costosAdministrativos[1].tarifa = 2;
  cambios(e);
  return e;
}
const validar = (e) => validarContrato(e, { paraEscribir: true });

describe('varias tarifas en una oferta', () => {
  it('sin la lista `tarifas` hay una sola: consecutivo 1 con el concepto y los valores de la oferta (como hasta ahora)', () => {
    const r = validar(archivo());
    assert.equal(r.ok, true, JSON.stringify(r.errores));
    assert.deepEqual(tarifasDeOferta(r.datos).map((t) => [t.consec, t.codServicio, t.valores.manoObra]), [[1, 'ASE', 13111200]]);
    assert.deepEqual(claveDeTarifa(r.datos, null), { consec: 1, concepto: 'ASE' });
  });

  it('una fila de tarifa por consecutivo, cada una con su concepto, sus valores y su total', () => {
    const r = validar(enDosTarifas());
    assert.equal(r.ok, true, JSON.stringify(r.errores));
    const { errores, filas } = planDeTarifa(r.datos, { cliente: CLIENTE, numOferta: 950, huella: HUELLA });
    assert.deepEqual(errores, []);
    assert.deepEqual(filas.map((f) => [f.consec, f.codservicio, f.descripcion, f.tar_manoobra, f.tar_impuestos, f.tarifa, f.num_oferta]), [
      [1, '452', 'Aseo', 9871200, 4320, 9875520, 950],
      [2, '453', 'Cafetería', 3240000, 1080, 3241080, 950],
    ]);
  });

  it('cada cargo y cada costo va con el consecutivo y el concepto de su tarifa; la mano de obra se cuadra tarifa por tarifa', () => {
    const r = validar(enDosTarifas());
    const cargos = planDeCargos(r.datos, { numOferta: 950, huella: HUELLA, codigosNomina: [247, 426] });
    assert.deepEqual(cargos.filas.map((f) => [f.consec, f.concepto, f.cargo]), [[1, '452', 247], [2, '453', 426]]);
    assert.deepEqual(cargos.advertencias.filter((a) => /suman/.test(a.mensaje)), [], 'cada tarifa cuadra con sus cargos');
    const costos = planDeCostosAdministrativos(r.datos, { numOferta: 950, huella: HUELLA, cliente: CLIENTE });
    assert.deepEqual(costos.filas.map((f) => [f.consec, f.concepto, f.id_cpto_costo, f.valor]), [[1, '452', 1, 2500], [1, '452', 6, 1500], [2, '453', 2, 1000]]);
  });

  it('si los cargos de una tarifa no suman su mano de obra, el aviso dice cuál', () => {
    const r = validar(enDosTarifas((e) => { e.cargos[1].tarifa = 1; }));
    const { advertencias } = planDeCargos(r.datos, { numOferta: 950, huella: HUELLA, codigosNomina: [247, 426] });
    assert.deepEqual(advertencias.filter((a) => /suman/.test(a.mensaje)).map((a) => a.mensaje.slice(0, 32)), ['Los cargos de la tarifa 1 suman ', 'Los cargos de la tarifa 2 suman ']);
  });

  it('rechaza consecutivos repetidos, filas que apuntan a una tarifa que no está y tarifas que no suman la oferta', () => {
    const repetido = validar(enDosTarifas((e) => { e.tarifas[1].consec = 1; }));
    assert.ok(repetido.errores.some((x) => x.campo === 'tarifas[1].consec'), JSON.stringify(repetido.errores));
    const huerfana = validar(enDosTarifas((e) => { e.cargos[0].tarifa = 3; }));
    assert.deepEqual(huerfana.errores.map((x) => [x.campo, x.mensaje]), [['cargos[0].tarifa', 'La tarifa 3 no está en la oferta (tarifas: 1, 2).']]);
    const descuadre = validar(enDosTarifas((e) => { e.tarifas[1].manoObra = 3000000; }));
    assert.deepEqual(descuadre.errores.map((x) => x.campo), ['tarifas.manoObra']);
    const sinLista = validar((() => { const e = archivo(); e.cargos[0].tarifa = 2; return e; })());
    assert.deepEqual(sinLista.errores.map((x) => x.campo), ['cargos[0].tarifa']);
  });
});
