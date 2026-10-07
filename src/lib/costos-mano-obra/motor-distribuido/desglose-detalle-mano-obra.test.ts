/**
 * Pruebas de la corrección visual/funcional de los paneles de detalle —
 * desgloses monetarios por concepto (recargos/prestaciones/seguridad
 * social/parafiscales), expuestos por resultado-financiero-mensual-linea.ts
 * y agregados por agregador-resultado-financiero-mensual.ts. Cubre las 22
 * pruebas obligatorias del bloque.
 *
 * Fase dedicada de extracción del motor legado: la fixture ya NO usa
 * calcularTarifaMensual (motor legal anualizado, eliminado) — usa
 * calcularResultadoTarifaMensualComercial30Dias (único motor vigente).
 * Todas las aserciones de este archivo son estructurales/relativas (nunca
 * dependían de un valor específico del calendario legal), así que la
 * migración no cambia el significado de ninguna prueba.
 */
import { describe, expect, it } from 'vitest';
import { calcularResultadoTarifaMensualComercial30Dias } from './motor-comercial-30-dias';
import type { ResultadoTarifaMensual } from './tipos-resultado-mensual';
import { construirResultadoFinancieroMensualLinea } from './resultado-financiero-mensual-linea';
import { agregarResultadosFinancierosMensuales } from './agregador-resultado-financiero-mensual';
import { resolverParametrosFinancierosManoObra } from './parametros-financieros-mano-obra';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function round2(n: number): number { return Math.round(n * 100) / 100; }

// Distribución con horas en los 7 conceptos de sobretiempo — equivalente
// comercial de la antigua distConTodo() (06:00-22:00, L-D), para poder
// verificar los 7 conceptos del desglose de recargos con datos no triviales.
const DISTRIBUCION_CON_TODO = {
  horasOrdinariasDiaOrdinario: 8,
  horasRecargoNocturnoDiaOrdinario: 3,
  horasExtraDiurnaDiaOrdinario: 1,
  horasExtraNocturnaDiaOrdinario: 1,
  horasDominicalFestivaDiaEspecial: 8,
  horasRecargoNocturnoFestivoDiaEspecial: 3,
  horasExtraDiurnaFestivaDiaEspecial: 1,
  horasExtraNocturnaFestivaDiaEspecial: 1,
};

// Parámetros con salud=0/SENA=0/ICBF=0 explícitos (caso de control, ya
// aceptado en el cierre financiero correctivo) — reutilizado para probar
// que el desglose conserva los ceros.
const PARAMS = resolverParametrosFinancierosManoObra({
  porcentajeCesantias: 8.33, porcentajePrima: 8.33, porcentajeVacaciones: 5, porcentajeInteresesCesantias: 1,
  porcentajeSalud: 0, porcentajePension: 12, porcentajeCajaCompensacion: 4, porcentajeSena: 0, porcentajeIcbf: 0,
  porcentajeArlPorClase: { I: 0.522, II: 1.044, III: 2.436, IV: 4.35, V: 6.96 },
});

function resultadoMensual(): ResultadoTarifaMensual {
  const r = calcularResultadoTarifaMensualComercial30Dias({
    distribucionHoras: DISTRIBUCION_CON_TODO,
    salarioMensual: 1750905,
    auxilioTransporteMensual: 249095,
    cantidadTrabajadores: 2,
  });
  if (r.estado !== 'CALCULADO') throw new Error('Fixture inválido: ' + r.mensaje);
  return r;
}

describe('desgloseRecargos — construirResultadoFinancieroMensualLinea (§1, pruebas #1/#2)', () => {
  const r = resultadoMensual();
  const financiero = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS });

  it('1) el detalle de recargos expone cada concepto monetario por separado', () => {
    const d = financiero.desgloseRecargos;
    expect(d).toHaveProperty('valorRecargoNocturnoMensual');
    expect(d).toHaveProperty('valorExtraDiurnaMensual');
    expect(d).toHaveProperty('valorExtraNocturnaMensual');
    expect(d).toHaveProperty('valorDominicalFestivoMensual');
    expect(d).toHaveProperty('valorExtraFestivaDiurnaMensual');
    expect(d).toHaveProperty('valorExtraFestivaNocturnaMensual');
    expect(d).toHaveProperty('valorRecargoNocturnoFestivoMensual');
    expect(d).toHaveProperty('totalRecargosSobretiempoMensual');
  });

  it('2) la suma de los 7 conceptos de recargos coincide exactamente con recargosSobretiempoMensual', () => {
    const d = financiero.desgloseRecargos;
    const suma = d.valorRecargoNocturnoMensual + d.valorExtraDiurnaMensual + d.valorExtraNocturnaMensual
      + d.valorDominicalFestivoMensual + d.valorExtraFestivaDiurnaMensual + d.valorExtraFestivaNocturnaMensual
      + d.valorRecargoNocturnoFestivoMensual;
    expect(suma).toBe(financiero.recargosSobretiempoMensual);
    expect(d.totalRecargosSobretiempoMensual).toBe(financiero.recargosSobretiempoMensual);
  });

  it('cada valor del desglose coincide con el conceptos[] del motor mensual (nunca recalculado)', () => {
    const buscar = (c: string) => r.conceptos.find(x => x.concepto === c)?.valorMensual ?? 0;
    expect(financiero.desgloseRecargos.valorRecargoNocturnoMensual).toBe(buscar('recargoNocturno'));
    expect(financiero.desgloseRecargos.valorExtraDiurnaMensual).toBe(buscar('extraDiurna'));
    expect(financiero.desgloseRecargos.valorExtraNocturnaMensual).toBe(buscar('extraNocturna'));
    expect(financiero.desgloseRecargos.valorDominicalFestivoMensual).toBe(buscar('ordinariaDominical'));
    expect(financiero.desgloseRecargos.valorExtraFestivaDiurnaMensual).toBe(buscar('extraDiurnaFestiva'));
    expect(financiero.desgloseRecargos.valorExtraFestivaNocturnaMensual).toBe(buscar('extraNocturnaFestiva'));
    expect(financiero.desgloseRecargos.valorRecargoNocturnoFestivoMensual).toBe(buscar('recargoNocturnoDominical'));
  });
});

describe('desglosePrestaciones — construirResultadoFinancieroMensualLinea (§2, pruebas #3-#7)', () => {
  const r = resultadoMensual();
  const financiero = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS });
  const dp = financiero.desglosePrestaciones;

  it('3) el detalle de prestaciones muestra cesantías', () => {
    expect(dp.cesantiasMensuales).toBeGreaterThan(0);
    expect(dp.porcentajeCesantias).toBe(8.33);
  });
  it('4) el detalle de prestaciones muestra prima', () => {
    expect(dp.primaMensual).toBeGreaterThan(0);
    expect(dp.porcentajePrima).toBe(8.33);
  });
  it('5) el detalle de prestaciones muestra vacaciones', () => {
    expect(dp.vacacionesMensuales).toBeGreaterThan(0);
    expect(dp.porcentajeVacaciones).toBe(5);
  });
  it('6) el detalle de prestaciones muestra intereses de cesantías', () => {
    expect(dp.interesesCesantiasMensuales).toBeGreaterThan(0);
    expect(dp.porcentajeInteresesCesantias).toBe(1);
  });
  it('7) la suma de los 4 conceptos coincide con prestacionesSocialesMensuales', () => {
    const suma = round2(dp.cesantiasMensuales + dp.primaMensual + dp.vacacionesMensuales + dp.interesesCesantiasMensuales);
    expect(suma).toBe(financiero.prestacionesSocialesMensuales);
    expect(dp.prestacionesSocialesMensuales).toBe(financiero.prestacionesSocialesMensuales);
  });
  it('§5 — bases y porcentajes de prestaciones ya vienen resueltos (nunca calculados en la UI)', () => {
    expect(dp.baseCesantiasMensual).toBeGreaterThan(0);
    expect(dp.basePrimaMensual).toBe(dp.baseCesantiasMensual);
    expect(dp.baseVacacionesMensual).toBeGreaterThan(0);
    expect(dp.baseInteresesCesantiasMensual).toBe(dp.baseCesantiasMensual);
  });
});

describe('desgloseSeguridadSocial — construirResultadoFinancieroMensualLinea (§3, pruebas #8-#11, #16)', () => {
  const r = resultadoMensual();
  const financiero = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS });
  const ds = financiero.desgloseSeguridadSocial;

  it('8) el detalle de seguridad social muestra salud', () => {
    expect(ds).toHaveProperty('saludMensual');
  });
  it('9) el detalle de seguridad social muestra pensión', () => {
    expect(ds.pensionMensual).toBeGreaterThan(0);
    expect(ds.porcentajePension).toBe(12);
  });
  it('10) el detalle de seguridad social muestra ARL, dependiente de la clase de la línea', () => {
    expect(ds.arlMensual).toBeGreaterThan(0);
    expect(ds.porcentajeArl).toBe(1.044); // Riesgo II
  });
  it('11) la suma de salud+pensión+ARL coincide con seguridadSocialMensual', () => {
    const suma = round2(ds.saludMensual + ds.pensionMensual + ds.arlMensual);
    expect(suma).toBe(financiero.seguridadSocialMensual);
  });
  it('16) salud=0% (configurado explícitamente) se muestra como $0, no se oculta ni sustituye', () => {
    expect(ds.saludMensual).toBe(0);
    expect(ds.porcentajeSalud).toBe(0);
  });
});

describe('desgloseParafiscales — construirResultadoFinancieroMensualLinea (§4, pruebas #12-#15, #16)', () => {
  const r = resultadoMensual();
  const financiero = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS });
  const dpf = financiero.desgloseParafiscales;

  it('12) el detalle de parafiscales muestra caja de compensación', () => {
    expect(dpf.cajaCompensacionMensual).toBeGreaterThan(0);
    expect(dpf.porcentajeCaja).toBe(4);
  });
  it('13) el detalle de parafiscales muestra SENA', () => {
    expect(dpf).toHaveProperty('senaMensual');
  });
  it('14) el detalle de parafiscales muestra ICBF', () => {
    expect(dpf).toHaveProperty('icbfMensual');
  });
  it('15) la suma de caja+SENA+ICBF coincide con parafiscalesMensuales', () => {
    const suma = round2(dpf.cajaCompensacionMensual + dpf.senaMensual + dpf.icbfMensual);
    expect(suma).toBe(financiero.parafiscalesMensuales);
  });
  it('16) SENA=0% e ICBF=0% (configurados explícitamente) se muestran como $0', () => {
    expect(dpf.senaMensual).toBe(0);
    expect(dpf.icbfMensual).toBe(0);
    expect(dpf.porcentajeSena).toBe(0);
    expect(dpf.porcentajeIcbf).toBe(0);
  });
});

describe('agregarResultadosFinancierosMensuales — totales de los desgloses por concepto (§7, pruebas #17-#19)', () => {
  const rA = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: DISTRIBUCION_CON_TODO, salarioMensual: 1750905, auxilioTransporteMensual: 249095, cantidadTrabajadores: 3 });
  const rB = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: DISTRIBUCION_CON_TODO, salarioMensual: 1900000, auxilioTransporteMensual: 249095, cantidadTrabajadores: 1 });
  if (rA.estado !== 'CALCULADO' || rB.estado !== 'CALCULADO') throw new Error('Fixture inválido');
  const finA = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: rA, claseArl: 'II', parametrosFinancieros: PARAMS });
  const finB = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: rB, claseArl: 'IV', parametrosFinancieros: PARAMS });
  const agregado = agregarResultadosFinancierosMensuales([{ resultado: finA }, { resultado: finB }]);

  it('17) dos líneas "ASEADOR" (mismo nombre, dos objetos independientes) aparecen separadas — cada resultado conserva su propio desglose', () => {
    expect(finA.desglosePrestaciones.cesantiasMensuales).not.toBe(finB.desglosePrestaciones.cesantiasMensuales);
    expect(finA.desgloseSeguridadSocial.arlMensual).not.toBe(finB.desgloseSeguridadSocial.arlMensual); // Riesgo II vs IV
  });

  it('18) el total general de cada concepto es la suma de las líneas (nunca recalculado sobre el agregado)', () => {
    const totalCesantiasEsperado = round2(finA.desglosePrestaciones.cesantiasMensuales * finA.cantidadTrabajadores + finB.desglosePrestaciones.cesantiasMensuales * finB.cantidadTrabajadores);
    expect(agregado.desglosePrestaciones.cesantiasMensualesTotal).toBe(totalCesantiasEsperado);
    const totalSaludEsperado = round2(finA.desgloseSeguridadSocial.saludMensual * finA.cantidadTrabajadores + finB.desgloseSeguridadSocial.saludMensual * finB.cantidadTrabajadores);
    expect(agregado.desgloseSeguridadSocial.saludMensualTotal).toBe(totalSaludEsperado);
    const totalCajaEsperado = round2(finA.desgloseParafiscales.cajaCompensacionMensual * finA.cantidadTrabajadores + finB.desgloseParafiscales.cajaCompensacionMensual * finB.cantidadTrabajadores);
    expect(agregado.desgloseParafiscales.cajaCompensacionMensualTotal).toBe(totalCajaEsperado);
    const totalRecNoctEsperado = round2(finA.desgloseRecargos.valorRecargoNocturnoMensual * finA.cantidadTrabajadores + finB.desgloseRecargos.valorRecargoNocturnoMensual * finB.cantidadTrabajadores);
    expect(agregado.desgloseRecargos.valorRecargoNocturnoMensualTotal).toBe(totalRecNoctEsperado);
  });

  it('19) no se agrupa por nombre del cargo — cantidadLineasCalculadas=2 aunque ambas se llamen igual (el agregador solo ve resultados, no nombres)', () => {
    expect(agregado.cantidadLineasCalculadas).toBe(2);
  });
});

describe('page.tsx — corrección visual/funcional conectada (fuente, #20/#21/#22)', () => {
  const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

  it('20) no existen fórmulas duplicadas en page.tsx — los desgloses se leen de d.financiero.desglose*, nunca recalculados', () => {
    expect(PAGE_TSX).toContain('d.financiero?.desgloseRecargos');
    expect(PAGE_TSX).toContain('d.financiero?.desglosePrestaciones');
    expect(PAGE_TSX).toContain('d.financiero?.desgloseSeguridadSocial');
    expect(PAGE_TSX).toContain('d.financiero?.desgloseParafiscales');
    // Ninguna multiplicación/división de porcentajes calculada inline en
    // los bloques de detalle (serían patrones como "*params." o "/100"
    // fuera del ensamblador) — el bloque mensual solo usa cop()/ppCorto().
    const inicio = PAGE_TSX.indexOf('ETAPA FINAL D/E — tabla y rótulos 100% mensuales');
    const fin = PAGE_TSX.indexOf('La tarifa mensual total no incluye los cargos pendientes');
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('/100');
  });

  it('21) la bandera mensual ya no existe — el motor comercial es el único camino', () => {
    expect(PAGE_TSX).not.toContain('USAR_TARIFA_MENSUAL_COMPLETA');
  });

  it('22) el motor legado no alimenta estos nuevos detalles — ningún bloque de desglose referencia detalleLineas/prestacionesPorLinea/seguridadPorLinea (variables legadas)', () => {
    const inicio = PAGE_TSX.indexOf('ETAPA FINAL D/E — tabla y rótulos 100% mensuales');
    const fin = PAGE_TSX.indexOf('La tarifa mensual total no incluye los cargos pendientes');
    const bloque = PAGE_TSX.slice(inicio, fin);
    expect(bloque).not.toContain('prestacionesPorLinea');
    expect(bloque).not.toContain('seguridadPorLinea');
    expect(bloque).not.toContain('parafiscalesPorLinea');
    expect(bloque).not.toContain('detalleLineas.map');
  });
});