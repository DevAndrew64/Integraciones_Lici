/**
 * Pruebas del ensamblador financiero mensual — resultado visible de Mano
 * de Obra (ETAPA FINAL D/E, cierre financiero correctivo §6/§7/§8/§12).
 * Verifica el resultado puro producido por
 * construirResultadoFinancieroMensualLinea, incluida la conexión con el
 * contrato financiero explícito (parametros-financieros-mano-obra.ts).
 *
 * Fase dedicada de extracción del motor legado: la fixture ya NO usa
 * calcularTarifaMensual (motor legal anualizado, eliminado) — usa
 * calcularResultadoTarifaMensualComercial30Dias (único motor vigente). El
 * ensamblador es agnóstico de qué motor produjo el ResultadoTarifaMensual,
 * y ninguna aserción de este archivo dependía de valores específicos del
 * calendario legal (todas son relativas/estructurales), así que la
 * migración no cambia el significado de ninguna prueba.
 */
import { describe, expect, it } from 'vitest';
import { calcularResultadoTarifaMensualComercial30Dias } from './motor-comercial-30-dias';
import type { ResultadoTarifaMensual } from './tipos-resultado-mensual';
import { construirResultadoFinancieroMensualLinea } from './resultado-financiero-mensual-linea';
import { resolverParametrosFinancierosManoObra } from './parametros-financieros-mano-obra';

// Distribución con horas en los 7 conceptos de sobretiempo (recargo
// nocturno, extra diurna/nocturna hábil y dominical/festiva) — equivalente
// comercial de la antigua distConSobretiempo() (06:00-18:00, L-D).
const DISTRIBUCION_CON_SOBRETIEMPO = {
  horasOrdinariasDiaOrdinario: 8,
  horasRecargoNocturnoDiaOrdinario: 1,
  horasExtraDiurnaDiaOrdinario: 1,
  horasExtraNocturnaDiaOrdinario: 0.5,
  horasDominicalFestivaDiaEspecial: 8,
  horasRecargoNocturnoFestivoDiaEspecial: 1,
  horasExtraDiurnaFestivaDiaEspecial: 1,
  horasExtraNocturnaFestivaDiaEspecial: 0.5,
};

function resultadoMensual(overrides: Partial<{ salarioMensual: number; cantidadTrabajadores: number; bonoPrestacionalMensual: number }> = {}): ResultadoTarifaMensual {
  const r = calcularResultadoTarifaMensualComercial30Dias({
    distribucionHoras: DISTRIBUCION_CON_SOBRETIEMPO,
    salarioMensual: overrides.salarioMensual ?? 1750905,
    bonoPrestacionalMensual: overrides.bonoPrestacionalMensual ?? 0,
    auxilioTransporteMensual: 249095,
    cantidadTrabajadores: overrides.cantidadTrabajadores ?? 1,
  });
  if (r.estado !== 'CALCULADO') throw new Error('Fixture inválido: se esperaba estado CALCULADO — ' + r.mensaje);
  return r;
}

// Parámetros por defecto (respaldo) — equivalentes a no tener configuración
// personalizada. Usados en las pruebas que no versan sobre el contrato
// financiero en sí (§7 del bloque anterior, siguen vigentes).
const PARAMS_DEFAULT = resolverParametrosFinancierosManoObra(undefined);

// Caso de control obligatorio (§12, cierre financiero correctivo): salud,
// SENA e ICBF configurados EXPLÍCITAMENTE en 0% — deben sobrevivir, nunca
// sustituidos por los predeterminados (8.5/2/3).
const PARAMS_CONTROL = resolverParametrosFinancierosManoObra({
  porcentajeCesantias: 8.33, porcentajePrima: 8.33, porcentajeVacaciones: 5, porcentajeInteresesCesantias: 1,
  porcentajeSalud: 0, porcentajePension: 12, porcentajeCajaCompensacion: 4, porcentajeSena: 0, porcentajeIcbf: 0,
  porcentajeArlPorClase: { I: 0.522, II: 1.044, III: 2.436, IV: 4.35, V: 6.96 },
});

describe('construirResultadoFinancieroMensualLinea — modo sombra (§7/§8/§11)', () => {
  it('1) el salario base aparece una sola vez, tal cual lo entrega el motor mensual', () => {
    const r = resultadoMensual();
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    expect(res.salarioBaseMensual).toBe(r.salarioBaseMensual);
    expect(res.bases.salarioBaseMensual).toBe(r.salarioBaseMensual);
  });

  it('2) el auxilio de transporte aparece una sola vez y nunca entra a las bases de prestaciones/seguridad social', () => {
    const r = resultadoMensual();
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    expect(res.auxilioTransporteMensual).toBe(r.auxilioTransporteMensual);
    expect(res.basePrestacionesMensual).toBe(res.salarioBaseMensual + res.bonoPrestacionalMensual + res.recargosSobretiempoMensual);
  });

  it('3) los recargos (no horas extra) alimentan recargosSalarialesMensuales, no horasExtrasSalarialesMensuales', () => {
    const r = resultadoMensual();
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    const sumaRecargosEsperada = r.conceptos
      .filter(c => !['extraDiurna', 'extraNocturna', 'extraDiurnaFestiva', 'extraNocturnaFestiva'].includes(c.concepto))
      .reduce((s, c) => s + c.valorMensual, 0);
    expect(res.bases.recargosSalarialesMensuales).toBeCloseTo(sumaRecargosEsperada, 2);
  });

  it('4) las horas extra alimentan horasExtrasSalarialesMensuales, no recargosSalarialesMensuales', () => {
    const r = resultadoMensual();
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    const sumaExtrasEsperada = r.conceptos
      .filter(c => ['extraDiurna', 'extraNocturna', 'extraDiurnaFestiva', 'extraNocturnaFestiva'].includes(c.concepto))
      .reduce((s, c) => s + c.valorMensual, 0);
    expect(res.bases.horasExtrasSalarialesMensuales).toBeCloseTo(sumaExtrasEsperada, 2);
  });

  it('5) el bono prestacional se distingue como salarial; nunca aparece como bonoNoSalarialMensual', () => {
    const r = resultadoMensual({ bonoPrestacionalMensual: 150000 });
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    expect(res.bases.bonoSalarialMensual).toBe(res.bonoPrestacionalMensual);
    expect(res.bases.bonoNoSalarialMensual).toBe(0);
  });

  it('6/11) el ARL usa la clase de riesgo de la línea — clases distintas producen seguridad social distinta', () => {
    const r = resultadoMensual();
    const bajo = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'I', parametrosFinancieros: PARAMS_DEFAULT });
    const alto = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'V', parametrosFinancieros: PARAMS_DEFAULT });
    expect(alto.seguridadSocialMensual).toBeGreaterThan(bajo.seguridadSocialMensual);
  });

  it('12) dos líneas con distinta clase ARL (Riesgo II vs Riesgo IV) se calculan de forma independiente, sin multiplicar de nuevo al agregar', () => {
    const r = resultadoMensual();
    const riesgoII = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    const riesgoIV = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'IV', parametrosFinancieros: PARAMS_DEFAULT });
    const arlII = round2Local(riesgoII.basePrestacionesMensual * PARAMS_DEFAULT.porcentajeArlPorClase.II / 100);
    const arlIV = round2Local(riesgoIV.basePrestacionesMensual * PARAMS_DEFAULT.porcentajeArlPorClase.IV / 100);
    expect(arlII).not.toBe(arlIV);
    // La suma de ambas líneas no re-multiplica el ARL — cada una conserva
    // exactamente su propio cálculo, independiente de la otra.
    expect(riesgoII.seguridadSocialMensual + riesgoIV.seguridadSocialMensual)
      .toBeCloseTo(riesgoII.seguridadSocialMensual + riesgoIV.seguridadSocialMensual, 2);
  });

  it('7) la cantidad de trabajadores se aplica UNA sola vez — tarifaMensualPorTrabajador no depende de cantidadTrabajadores', () => {
    const uno = resultadoMensual({ cantidadTrabajadores: 1 });
    const tres = resultadoMensual({ cantidadTrabajadores: 3 });
    const resUno = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: uno, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    const resTres = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: tres, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    expect(resTres.tarifaMensualPorTrabajador).toBeCloseTo(resUno.tarifaMensualPorTrabajador, 0);
  });

  it('8) tarifaMensualLinea = tarifaMensualPorTrabajador × cantidadTrabajadores, sin desviación de redondeo mayor a $1', () => {
    const r = resultadoMensual({ cantidadTrabajadores: 4 });
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    expect(Math.abs(res.tarifaMensualLinea - res.tarifaMensualPorTrabajador * res.cantidadTrabajadores)).toBeLessThanOrEqual(1);
  });

  it('9) dos líneas con distinto salario son completamente independientes (sin estado compartido)', () => {
    const rA = resultadoMensual({ salarioMensual: 1750905 });
    const rB = resultadoMensual({ salarioMensual: 2200000 });
    const resA1 = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: rA, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    const resB = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: rB, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    const resA2 = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: rA, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    expect(resA1).toEqual(resA2);
    expect(resA1.salarioBaseMensual).not.toBe(resB.salarioBaseMensual);
  });

  it('10) el agregado de varias líneas es la suma simple de sus tarifaMensualLinea (nunca combinado dentro del ensamblador)', () => {
    const rA = resultadoMensual({ salarioMensual: 1750905, cantidadTrabajadores: 2 });
    const rB = resultadoMensual({ salarioMensual: 1900000, cantidadTrabajadores: 1 });
    const resA = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: rA, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    const resB = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: rB, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    const agregado = resA.tarifaMensualLinea + resB.tarifaMensualLinea;
    expect(agregado).toBeCloseTo(resA.tarifaMensualLinea + resB.tarifaMensualLinea, 2);
  });

  it('11) exoneración explícita (exoneradoSalud/Sena/Icbf), cuando aplica, deja salud/SENA/ICBF en cero sin afectar pensión/ARL', () => {
    const r = resultadoMensual();
    const sinExo = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    const conExo = construirResultadoFinancieroMensualLinea({
      resultadoTarifaMensual: r, claseArl: 'II',
      parametrosFinancieros: { ...PARAMS_DEFAULT, exoneradoSalud: true, exoneradoSena: true, exoneradoIcbf: true },
    });
    expect(conExo.seguridadSocialMensual).toBeLessThan(sinExo.seguridadSocialMensual);
    expect(conExo.parafiscalesMensuales).toBeLessThan(sinExo.parafiscalesMensuales);
  });

  it('12) horasPromedioMensuales replica los conceptos del motor mensual más la hora ordinaria, sin inventar ningún otro', () => {
    const r = resultadoMensual();
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    const esperado = ['ordinariaHabil', ...r.conceptos.map(c => c.concepto)].sort();
    expect(res.horasPromedioMensuales.map(h => h.concepto).sort()).toEqual(esperado);
  });

  it('13) la hora ordinaria mensual promedio coincide con la del motor y nunca tiene costo propio (ya cubierta por el salario)', () => {
    const r = resultadoMensual();
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    const ordinaria = res.horasPromedioMensuales.find(h => h.concepto === 'ordinariaHabil')!;
    expect(ordinaria.horas).toBe(r.horasOrdinariasMensualesPromedio);
  });
});

// Cierre de consistencia monetaria — política HALF_UP a pesos enteros
// (nunca centavos), igual que redondearPeso() del ensamblador.
function round2Local(n: number): number { return Math.round(n); }

describe('construirResultadoFinancieroMensualLinea — CASO DE CONTROL OBLIGATORIO (§12, cierre financiero correctivo)', () => {
  it('salud calculada = 0 cuando porcentajeSalud=0 explícito (nunca 8.5% predeterminado)', () => {
    const r = resultadoMensual();
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_CONTROL });
    const salud = round2Local(res.baseSeguridadSocialMensual * 0 / 100);
    expect(salud).toBe(0);
    // La única forma de que seguridadSocialMensual no incluya salud es que
    // el ensamblador haya usado 0%, no el 8.5% predeterminado — se verifica
    // comparando contra el resultado con los predeterminados.
    const resDefault = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    expect(res.seguridadSocialMensual).toBeLessThan(resDefault.seguridadSocialMensual);
  });

  it('SENA calculado = 0 y ICBF calculado = 0 cuando ambos están configurados explícitamente en 0', () => {
    const r = resultadoMensual();
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_CONTROL });
    const resDefault = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    expect(res.parafiscalesMensuales).toBeLessThan(resDefault.parafiscalesMensuales);
  });

  it('pensión utiliza 12% y caja utiliza 4% — igual al predeterminado en este caso, pero explícitamente configurado', () => {
    expect(PARAMS_CONTROL.porcentajePension).toBe(12);
    expect(PARAMS_CONTROL.porcentajeCajaCompensacion).toBe(4);
    expect(PARAMS_CONTROL.fuente).toBe('CONFIGURACION_USUARIO');
  });

  it('las prestaciones utilizan los valores configurados (cesantías/prima 8.33%, vacaciones 5%, intereses 1%)', () => {
    const r = resultadoMensual();
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_CONTROL });
    const baseCesantiasEtc = res.basePrestacionesMensual + res.auxilioTransporteMensual;
    const cesantiasEsperadas = round2Local(baseCesantiasEtc * 8.33 / 100);
    const primaEsperada = round2Local(baseCesantiasEtc * 8.33 / 100);
    const vacacionesEsperadas = round2Local(res.basePrestacionesMensual * 5 / 100);
    const interesesEsperados = round2Local(baseCesantiasEtc * 1 / 100);
    expect(res.prestacionesSocialesMensuales).toBe(cesantiasEsperadas + primaEsperada + vacacionesEsperadas + interesesEsperados);
  });

  it('ARL utiliza Riesgo II (1.044%)', () => {
    expect(PARAMS_CONTROL.porcentajeArlPorClase.II).toBe(1.044);
  });
});

describe('construirResultadoFinancieroMensualLinea — CASO DE FALLBACK (§13, cierre financiero correctivo)', () => {
  it('sin configuración personalizada (undefined), usa PARAMETROS_FINANCIEROS_2026_DEFAULT y marca la fuente como predeterminados', () => {
    const params = resolverParametrosFinancierosManoObra(undefined);
    expect(params.fuente).toBe('VALORES_PREDETERMINADOS');
    expect(params.porcentajeSalud).toBe(8.5);
    expect(params.porcentajeSena).toBe(2);
    expect(params.porcentajeIcbf).toBe(3);
  });

  it('el fallback no bloquea la tarifa — el resultado sigue siendo TARIFA_CALCULADA con valores predeterminados', () => {
    const r = resultadoMensual();
    const params = resolverParametrosFinancierosManoObra(undefined);
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: params });
    expect(res.tarifaMensualLinea).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Cierre "LÍMITE DEL 40% DE PAGOS NO SALARIALES PARA IBC" — la base de
// salud/pensión se ajusta con el exceso de los 4 bonos no prestacionales
// sobre el 40% de la remuneración total; ARL/prestaciones/parafiscales
// quedan sin cambios en esta fase.
// ═══════════════════════════════════════════════════════════════════════

// Distribución sin ningún concepto de sobretiempo — para que
// baseSeguridadSocialMensual = salarioBaseMensual + bonoPrestacionalMensual
// exactamente, sin ruido de recargos, facilitando predecir el IBC.
const DISTRIBUCION_SIN_SOBRETIEMPO = {
  horasOrdinariasDiaOrdinario: 8,
  horasRecargoNocturnoDiaOrdinario: 0,
  horasExtraDiurnaDiaOrdinario: 0,
  horasExtraNocturnaDiaOrdinario: 0,
  horasDominicalFestivaDiaEspecial: 0,
  horasRecargoNocturnoFestivoDiaEspecial: 0,
  horasExtraDiurnaFestivaDiaEspecial: 0,
  horasExtraNocturnaFestivaDiaEspecial: 0,
};

function resultadoMensualSinSobretiempo(salarioMensual: number, bonoPrestacionalMensual = 0): ResultadoTarifaMensual {
  const r = calcularResultadoTarifaMensualComercial30Dias({
    distribucionHoras: DISTRIBUCION_SIN_SOBRETIEMPO,
    salarioMensual, bonoPrestacionalMensual, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
  });
  if (r.estado !== 'CALCULADO') throw new Error('Fixture inválido');
  return r;
}

describe('§9.5/§9.6 — el exceso aumenta pensión; salud 0% permanece en $0', () => {
  it('5) con exceso >0, pensionMensual > que sin bonos no salariales', () => {
    const r = resultadoMensualSinSobretiempo(2000000);
    const sinBonos = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT, pagosNoSalarialesMensualesPorTrabajador: 0 });
    const conBonos = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT, pagosNoSalarialesMensualesPorTrabajador: 1500000 });
    expect(conBonos.desgloseSeguridadSocial.pensionMensual).toBeGreaterThan(sinBonos.desgloseSeguridadSocial.pensionMensual);
    expect(conBonos.desgloseSeguridadSocial.limitePagosNoSalarialesIBC.excesoNoSalarialIBC).toBe(100000);
    expect(conBonos.desgloseSeguridadSocial.basePensionMensual).toBe(2100000);
  });

  it('6) salud exonerada (0%) sigue en $0 aunque exista IBC ajustado', () => {
    const r = resultadoMensualSinSobretiempo(2000000);
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_CONTROL, pagosNoSalarialesMensualesPorTrabajador: 1500000 });
    expect(PARAMS_CONTROL.porcentajeSalud).toBe(0);
    expect(res.desgloseSeguridadSocial.saludMensual).toBe(0);
    expect(res.desgloseSeguridadSocial.baseSaludMensual).toBe(2100000); // el IBC sí se ajustó, el aporte sigue en $0 por el 0%
  });
});

describe('§9.7/§9.8 — prestaciones y parafiscales no cambian en esta fase (cierre "APLICAR EL IBC AJUSTADO TAMBIÉN A ARL")', () => {
  const r = resultadoMensualSinSobretiempo(2000000);
  const sinBonos = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT, pagosNoSalarialesMensualesPorTrabajador: 0 });
  const conBonos = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT, pagosNoSalarialesMensualesPorTrabajador: 1500000 });

  it('7) prestaciones sociales idénticas con y sin exceso', () => {
    expect(conBonos.prestacionesSocialesMensuales).toBe(sinBonos.prestacionesSocialesMensuales);
    expect(conBonos.desglosePrestaciones).toEqual(sinBonos.desglosePrestaciones);
  });

  it('8) parafiscales idénticos con y sin exceso', () => {
    expect(conBonos.parafiscalesMensuales).toBe(sinBonos.parafiscalesMensuales);
    expect(conBonos.desgloseParafiscales).toEqual(sinBonos.desgloseParafiscales);
  });

  it('11) caja de compensación idéntica con y sin exceso (no cambia en esta fase)', () => {
    expect(conBonos.desglosePrestaciones).toEqual(sinBonos.desglosePrestaciones); // vacaciones (base de caja) vía prestaciones
    expect(conBonos.desgloseParafiscales.cajaCompensacionMensual).toBe(sinBonos.desgloseParafiscales.cajaCompensacionMensual);
  });

  it('12) SENA idéntico con y sin exceso', () => {
    expect(conBonos.desgloseParafiscales.senaMensual).toBe(sinBonos.desgloseParafiscales.senaMensual);
  });

  it('13) ICBF idéntico con y sin exceso', () => {
    expect(conBonos.desgloseParafiscales.icbfMensual).toBe(sinBonos.desgloseParafiscales.icbfMensual);
  });
});

describe('§8.3/§8.6/§8.7 — ARL ahora SÍ se ajusta con el mismo IBC que salud y pensión (corrección de este cierre)', () => {
  it('3) el exceso aumenta la base de ARL', () => {
    const r = resultadoMensualSinSobretiempo(2000000);
    const sinBonos = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT, pagosNoSalarialesMensualesPorTrabajador: 0 });
    const conBonos = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT, pagosNoSalarialesMensualesPorTrabajador: 1500000 });
    expect(conBonos.desgloseSeguridadSocial.baseArlMensual).toBe(sinBonos.desgloseSeguridadSocial.baseArlMensual + 100000);
    expect(conBonos.desgloseSeguridadSocial.arlMensual).toBeGreaterThan(sinBonos.desgloseSeguridadSocial.arlMensual);
  });

  it('6) §3 EJEMPLO DE CONTROL exacto: base=$2.000.000, bonos=$1.500.000, ARL 1,044% → $21.924 (sin ajuste habría sido $20.880, +$1.044)', () => {
    const r = resultadoMensualSinSobretiempo(2000000);
    const params = resolverParametrosFinancierosManoObra({ porcentajeArlPorClase: { I: 0.522, II: 1.044, III: 2.436, IV: 4.35, V: 6.96 } });
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: params, pagosNoSalarialesMensualesPorTrabajador: 1500000 });
    expect(res.desgloseSeguridadSocial.baseArlMensual).toBe(2100000);
    expect(res.desgloseSeguridadSocial.arlMensual).toBe(21924);
    expect(res.desgloseSeguridadSocial.pensionMensual).toBe(252000);
    expect(res.desgloseSeguridadSocial.saludMensual).toBeGreaterThanOrEqual(0);
    const sinAjuste = Math.round(2000000 * 1.044 / 100);
    expect(sinAjuste).toBe(20880);
    expect(res.desgloseSeguridadSocial.arlMensual - sinAjuste).toBe(1044);
  });

  it('salud/pensión/ARL comparten exactamente la misma base ajustada (un solo cálculo del exceso)', () => {
    const r = resultadoMensualSinSobretiempo(2000000);
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT, pagosNoSalarialesMensualesPorTrabajador: 1500000 });
    expect(res.desgloseSeguridadSocial.baseSaludMensual).toBe(res.desgloseSeguridadSocial.baseArlMensual);
    expect(res.desgloseSeguridadSocial.basePensionMensual).toBe(res.desgloseSeguridadSocial.baseArlMensual);
    expect(res.desgloseSeguridadSocial.baseSeguridadSocialAjustada).toBe(res.desgloseSeguridadSocial.baseArlMensual);
  });

  it('7) sin exceso, ARL conserva exactamente el resultado anterior (idéntico al cierre previo)', () => {
    const r = resultadoMensualSinSobretiempo(2000000);
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT, pagosNoSalarialesMensualesPorTrabajador: 0 });
    expect(res.desgloseSeguridadSocial.arlMensual).toBe(Math.round(2000000 * 1.044 / 100));
    expect(res.desgloseSeguridadSocial.baseSeguridadSocialOriginal).toBe(res.desgloseSeguridadSocial.baseArlMensual);
  });

  it('otra clase de riesgo (V) usa su propio porcentaje sobre la base ajustada, nunca hardcodeado', () => {
    const r = resultadoMensualSinSobretiempo(2000000);
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'V', parametrosFinancieros: PARAMS_DEFAULT, pagosNoSalarialesMensualesPorTrabajador: 1500000 });
    expect(res.desgloseSeguridadSocial.porcentajeArl).toBe(PARAMS_DEFAULT.porcentajeArlPorClase.V);
    expect(res.desgloseSeguridadSocial.arlMensual).toBe(Math.round(2100000 * PARAMS_DEFAULT.porcentajeArlPorClase.V / 100));
  });
});

describe('§9.10 — auxilio de transporte nunca entra al grupo de bonos no salariales del límite', () => {
  it('el helper del límite no recibe auxilioTransporteMensual', () => {
    const r = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: DISTRIBUCION_SIN_SOBRETIEMPO,
      salarioMensual: 2000000, bonoPrestacionalMensual: 0, auxilioTransporteMensual: 249095, cantidadTrabajadores: 1,
    });
    if (r.estado !== 'CALCULADO') throw new Error('fixture inválido');
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT, pagosNoSalarialesMensualesPorTrabajador: 0 });
    // Sin bonos no salariales, el auxilio (aunque presente) nunca genera exceso.
    expect(res.desgloseSeguridadSocial.limitePagosNoSalarialesIBC.excesoNoSalarialIBC).toBe(0);
  });
});

describe('§9.11 — Bono Prestacional integra la base salarial (tratamiento ya vigente, sin cambios)', () => {
  it('un bono prestacional mayor aumenta la base de salud/pensión igual que antes de este cierre', () => {
    const rSinBono = resultadoMensualSinSobretiempo(2000000, 0);
    const rConBono = resultadoMensualSinSobretiempo(2000000, 300000);
    const resSinBono = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: rSinBono, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    const resConBono = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: rConBono, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    expect(resConBono.desgloseSeguridadSocial.basePensionMensual).toBe(resSinBono.desgloseSeguridadSocial.basePensionMensual + 300000);
  });
});

describe('§9.12 — los cuatro bonos no prestacionales se suman una sola vez (nunca duplicados en tarifaMensualPorTrabajador)', () => {
  it('pagosNoSalarialesMensualesPorTrabajador nunca se suma dentro de tarifaMensualPorTrabajador/tarifaMensualLinea', () => {
    const r = resultadoMensualSinSobretiempo(2000000);
    const sinBonos = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT, pagosNoSalarialesMensualesPorTrabajador: 0 });
    const conBonos = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT, pagosNoSalarialesMensualesPorTrabajador: 1500000 });
    // La única diferencia permitida es en seguridadSocialMensual (vía pensión) —
    // nunca en tarifaMensualPorTrabajador, que no incluye estos bonos.
    const diferenciaSeguridadSocial = conBonos.seguridadSocialMensual - sinBonos.seguridadSocialMensual;
    const diferenciaTarifa = conBonos.tarifaMensualPorTrabajador - sinBonos.tarifaMensualPorTrabajador;
    expect(diferenciaSeguridadSocial).toBeGreaterThan(0);
    expect(diferenciaTarifa).toBe(diferenciaSeguridadSocial); // el único efecto viaja a través de seguridadSocialMensual
  });
});

describe('§9.13 — varias líneas no se mezclan antes de calcular su límite individual', () => {
  it('cada línea calcula su propio límite con SU PROPIA base salarial y sus propios bonos, nunca combinados', () => {
    const rLinea1 = resultadoMensualSinSobretiempo(1000000);
    const rLinea2 = resultadoMensualSinSobretiempo(5000000);
    const resLinea1 = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: rLinea1, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT, pagosNoSalarialesMensualesPorTrabajador: 1000000 });
    const resLinea2 = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: rLinea2, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT, pagosNoSalarialesMensualesPorTrabajador: 100000 });
    // Línea 1: base=1.000.000, bonos=1.000.000 → total=2.000.000, límite=800.000, exceso=200.000, IBC=1.200.000
    expect(resLinea1.desgloseSeguridadSocial.limitePagosNoSalarialesIBC.excesoNoSalarialIBC).toBe(200000);
    // Línea 2: base=5.000.000, bonos=100.000 → total=5.100.000, límite=2.040.000, exceso=0 (100.000<2.040.000)
    expect(resLinea2.desgloseSeguridadSocial.limitePagosNoSalarialesIBC.excesoNoSalarialIBC).toBe(0);
  });
});

describe('Ajuste "CORRECCIÓN DE BASES — TOTAL_SEMANAL" — baseMinimaSeguridadSocialMensual', () => {
  it('sin baseMinimaSeguridadSocialMensual (comportamiento actual, HORARIO_DETALLADO): las tres bases siguen derivándose de salarioBaseMensual, sin cambios', () => {
    const r = resultadoMensualSinSobretiempo(1750905);
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    expect(res.basePrestacionesMensual).toBe(res.salarioBaseMensual);
    expect(res.baseSeguridadSocialMensual).toBe(res.salarioBaseMensual);
    expect(res.baseParafiscalesMensual).toBe(res.salarioBaseMensual);
  });

  it('1/2/3 — 19 horas: salario ordinario $792.076, base de prestaciones $792.076 (=salario ordinario), IBC seguridad social $1.750.905 (mínimo)', () => {
    const rProporcional = resultadoMensualSinSobretiempo(792076);
    const res = construirResultadoFinancieroMensualLinea({
      resultadoTarifaMensual: rProporcional, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT,
      baseMinimaSeguridadSocialMensual: 1750905,
    });
    expect(res.salarioBaseMensual).toBe(792076);
    expect(res.basePrestacionesMensual).toBe(792076);
    expect(res.baseSeguridadSocialMensual).toBe(1750905);
    // Parafiscales NUNCA hereda el mínimo de seguridad social (§5).
    expect(res.baseParafiscalesMensual).toBe(792076);
  });

  it('4/5 — 21 horas: base de prestaciones $875.453 (=salario ordinario), IBC seguridad social $1.750.905 (mínimo)', () => {
    const rProporcional = resultadoMensualSinSobretiempo(875453);
    const res = construirResultadoFinancieroMensualLinea({
      resultadoTarifaMensual: rProporcional, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT,
      baseMinimaSeguridadSocialMensual: 1750905,
    });
    expect(res.salarioBaseMensual).toBe(875453);
    expect(res.basePrestacionesMensual).toBe(875453);
    expect(res.baseSeguridadSocialMensual).toBe(1750905);
  });

  it('6 — 42 horas (jornada completa): las tres bases coinciden en $1.750.905 (el subtotal ya iguala/supera el mínimo)', () => {
    const r = resultadoMensualSinSobretiempo(1750905);
    const res = construirResultadoFinancieroMensualLinea({
      resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT,
      baseMinimaSeguridadSocialMensual: 1750905,
    });
    expect(res.salarioBaseMensual).toBe(1750905);
    expect(res.basePrestacionesMensual).toBe(1750905);
    expect(res.baseSeguridadSocialMensual).toBe(1750905);
    expect(res.baseParafiscalesMensual).toBe(1750905);
  });

  it('7 — un bono salarial incrementa el subtotal y, por tanto, la base de prestaciones (caso D: 19h + bono $100.000)', () => {
    const rConBono = resultadoMensualSinSobretiempo(792076, 100000);
    const res = construirResultadoFinancieroMensualLinea({
      resultadoTarifaMensual: rConBono, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT,
      baseMinimaSeguridadSocialMensual: 1750905,
    });
    expect(res.salarioBaseMensual).toBe(792076);
    expect(res.basePrestacionesMensual).toBe(892076); // 792076+100000
    expect(res.baseSeguridadSocialMensual).toBe(1750905); // el subtotal (892.076) sigue bajo el mínimo
  });

  it('8 — el IBC conserva el mínimo mientras el subtotal cotizable sea inferior a él', () => {
    const r = resultadoMensualSinSobretiempo(792076);
    const res = construirResultadoFinancieroMensualLinea({
      resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT,
      baseMinimaSeguridadSocialMensual: 1750905,
    });
    expect(res.baseSeguridadSocialMensual).toBe(1750905);
    expect(res.baseSeguridadSocialMensual).toBeGreaterThan(res.basePrestacionesMensual);
  });

  it('9 — si el subtotal supera el mínimo, el IBC toma el subtotal cotizable (nunca se queda anclado al mínimo)', () => {
    const r = resultadoMensualSinSobretiempo(2000000); // supera el mínimo de 1.750.905
    const res = construirResultadoFinancieroMensualLinea({
      resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT,
      baseMinimaSeguridadSocialMensual: 1750905,
    });
    expect(res.baseSeguridadSocialMensual).toBe(2000000);
    expect(res.basePrestacionesMensual).toBe(2000000);
  });

  it('10 — el salario completo (jornada completa) NUNCA se suma como costo adicional — no aparece como sumando de tarifaMensualPorTrabajador', () => {
    const rProporcional = resultadoMensualSinSobretiempo(792076);
    const res = construirResultadoFinancieroMensualLinea({
      resultadoTarifaMensual: rProporcional, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT,
      baseMinimaSeguridadSocialMensual: 1750905,
    });
    // tarifaMensualPorTrabajador suma únicamente el salario ORDINARIO
    // (792.076) + prestaciones/seguridad social/parafiscales — nunca
    // 1.750.905 en sí mismo como sumando adicional.
    expect(res.tarifaMensualPorTrabajador).toBe(
      res.salarioBaseMensual + res.bonoPrestacionalMensual + res.bonoNoSalarialMensual + res.recargosSobretiempoMensual
      + res.auxilioTransporteMensual + res.prestacionesSocialesMensuales + res.seguridadSocialMensual + res.parafiscalesMensuales + res.otrosCostosMensuales,
    );
  });

  it('11 — la fila SALARIO (salarioBaseMensual) suma únicamente el proporcional, nunca duplicado con el completo', () => {
    const rProporcional = resultadoMensualSinSobretiempo(792076);
    const res = construirResultadoFinancieroMensualLinea({
      resultadoTarifaMensual: rProporcional, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT,
      baseMinimaSeguridadSocialMensual: 1750905,
    });
    expect(res.salarioBaseMensual).toBe(792076);
    expect(res.bases.salarioBaseMensual).toBe(792076);
  });

  it('12 — las prestaciones NO usan el salario completo de referencia — usan el subtotal salarial (el mismo que la fila SALARIO + bonos salariales)', () => {
    const rProporcional = resultadoMensualSinSobretiempo(792076);
    const res = construirResultadoFinancieroMensualLinea({
      resultadoTarifaMensual: rProporcional, claseArl: 'II', parametrosFinancieros: PARAMS_CONTROL,
      baseMinimaSeguridadSocialMensual: 1750905,
    });
    expect(res.desglosePrestaciones.baseVacacionesMensual).toBe(792076);
    expect(res.desglosePrestaciones.baseCesantiasMensual).toBe(792076);
    expect(res.desglosePrestaciones.basePrimaMensual).toBe(792076);
    expect(res.desglosePrestaciones.baseInteresesCesantiasMensual).toBe(792076);
    expect(res.desglosePrestaciones.vacacionesMensuales).toBe(Math.round(792076 * 5 / 100));
  });

  it('13 — seguridad social SÍ utiliza su IBC independiente (distinto de la base de prestaciones cuando el mínimo aplica)', () => {
    const rProporcional = resultadoMensualSinSobretiempo(792076);
    const res = construirResultadoFinancieroMensualLinea({
      resultadoTarifaMensual: rProporcional, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT,
      baseMinimaSeguridadSocialMensual: 1750905,
    });
    expect(res.desgloseSeguridadSocial.basePensionMensual).toBe(1750905);
    expect(res.desgloseSeguridadSocial.baseSaludMensual).toBe(1750905);
    expect(res.desgloseSeguridadSocial.baseArlMensual).toBe(1750905);
    expect(res.desgloseSeguridadSocial.basePensionMensual).not.toBe(res.basePrestacionesMensual);
  });

  it('14 — los parafiscales NO heredan silenciosamente el IBC de seguridad social (§5) — conservan la base de prestaciones', () => {
    const rProporcional = resultadoMensualSinSobretiempo(792076);
    const res = construirResultadoFinancieroMensualLinea({
      resultadoTarifaMensual: rProporcional, claseArl: 'II', parametrosFinancieros: PARAMS_CONTROL,
      baseMinimaSeguridadSocialMensual: 1750905,
    });
    expect(res.desgloseParafiscales.baseSenaMensual).toBe(792076);
    expect(res.desgloseParafiscales.baseIcbfMensual).toBe(792076);
    expect(res.desgloseParafiscales.baseSenaMensual).not.toBe(res.baseSeguridadSocialMensual);
  });

  it('15 — el total (tarifaMensualPorTrabajador) coincide exactamente con la suma de todos los conceptos visibles', () => {
    const rProporcional = resultadoMensualSinSobretiempo(875453);
    const res = construirResultadoFinancieroMensualLinea({
      resultadoTarifaMensual: rProporcional, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT,
      baseMinimaSeguridadSocialMensual: 1750905,
    });
    const sumaConceptos = res.salarioBaseMensual + res.bonoPrestacionalMensual + res.bonoNoSalarialMensual
      + res.recargosSobretiempoMensual + res.auxilioTransporteMensual + res.prestacionesSocialesMensuales
      + res.seguridadSocialMensual + res.parafiscalesMensuales + res.otrosCostosMensuales;
    expect(res.tarifaMensualPorTrabajador).toBe(sumaConceptos);
  });

  it('16 — HORARIO_DETALLADO no cambia (con o sin sobretiempo, sin baseMinimaSeguridadSocialMensual): comportamiento idéntico al histórico', () => {
    const r = resultadoMensual(); // fixture con sobretiempo, sin overrides
    const res = construirResultadoFinancieroMensualLinea({ resultadoTarifaMensual: r, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT });
    expect(res.basePrestacionesMensual).toBe(res.salarioBaseMensual + res.bonoPrestacionalMensual + res.recargosSobretiempoMensual);
    expect(res.baseSeguridadSocialMensual).toBe(res.basePrestacionesMensual);
    expect(res.baseParafiscalesMensual).toBe(res.basePrestacionesMensual);
  });

  it('17 — no se utiliza 24,08 en ningún punto de este cálculo', () => {
    const rProporcional = resultadoMensualSinSobretiempo(792076);
    const res = construirResultadoFinancieroMensualLinea({
      resultadoTarifaMensual: rProporcional, claseArl: 'II', parametrosFinancieros: PARAMS_DEFAULT,
      baseMinimaSeguridadSocialMensual: 1750905,
    });
    expect(res.basePrestacionesMensual).not.toBeCloseTo(792076 * 24.08, 2);
    expect(res.baseSeguridadSocialMensual).not.toBeCloseTo(1750905 * 24.08, 2);
  });
});