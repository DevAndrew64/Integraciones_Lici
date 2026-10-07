/**
 * Pruebas del agregador puro entre líneas — ETAPA FINAL D/E §2/§11/§16.
 * Cubre, entre otras, las pruebas funcionales obligatorias #5, #7, #16, #21.
 *
 * Fase dedicada de extracción del motor legado: la fixture ya NO usa el
 * constructor legal (motor legal anualizado, eliminado) — usa
 * construirLineaCalculadaMensualComercial30Dias (único motor vigente,
 * envuelto aquí en el atajo local construirLineaComercialAtajo solo para
 * no repetir los 4 argumentos en cada prueba). El agregador es agnóstico
 * de qué motor produjo cada línea, y ninguna aserción de este archivo
 * dependía de valores específicos del calendario legal (todas son
 * relativas/estructurales), así que la migración no cambia el significado
 * de ninguna prueba.
 */
import { describe, expect, it } from 'vitest';
import { agregarResultadosFinancierosMensuales } from './agregador-resultado-financiero-mensual';
import { construirLineaCalculadaMensualComercial30Dias } from './motor-comercial-30-dias';
import type { DatosLineaComercial30Dias } from './motor-comercial-30-dias';
import { resolverParametrosFinancierosManoObra } from './parametros-financieros-mano-obra';

const PARAMS = resolverParametrosFinancierosManoObra(undefined);

const DISTRIBUCION_LUN_VIE = {
  horasOrdinariasDiaOrdinario: 8,
  horasRecargoNocturnoDiaOrdinario: 0,
  horasExtraDiurnaDiaOrdinario: 0,
  horasExtraNocturnaDiaOrdinario: 0,
  horasDominicalFestivaDiaEspecial: 0,
  horasRecargoNocturnoFestivoDiaEspecial: 0,
  horasExtraDiurnaFestivaDiaEspecial: 0,
  horasExtraNocturnaFestivaDiaEspecial: 0,
};

const datosLineaA: DatosLineaComercial30Dias = {
  distribucionHoras: DISTRIBUCION_LUN_VIE,
  salarioMensual: 1750905,
  cantidadTrabajadores: 3,
};

const datosLineaB: DatosLineaComercial30Dias = {
  distribucionHoras: DISTRIBUCION_LUN_VIE,
  salarioMensual: 1900000,
  cantidadTrabajadores: 2,
};

function construirLineaComercialAtajo(
  datos: DatosLineaComercial30Dias,
  auxilioTransporteMensual: number,
  claseArl: 'I' | 'II' | 'III' | 'IV' | 'V',
  parametrosFinancieros: typeof PARAMS,
) {
  return construirLineaCalculadaMensualComercial30Dias(datos, auxilioTransporteMensual, claseArl, parametrosFinancieros);
}

describe('agregarResultadosFinancierosMensuales — agregación pura, nunca recalcula (§2/§11)', () => {
  it('5/16) el total agregado es exactamente la suma de tarifaMensualLinea de cada línea (nunca recalculado)', () => {
    const a = construirLineaComercialAtajo(datosLineaA, 249095, 'II', PARAMS);
    const b = construirLineaComercialAtajo(datosLineaB, 249095, 'II', PARAMS);
    const agregado = agregarResultadosFinancierosMensuales([{ resultado: a.resultadoFinanciero }, { resultado: b.resultadoFinanciero }]);
    const sumaManual = a.resultadoFinanciero!.tarifaMensualLinea + b.resultadoFinanciero!.tarifaMensualLinea;
    expect(agregado.tarifaMensualTotal).toBeCloseTo(sumaManual, 2);
  });

  it('7) la cantidad de trabajadores no se multiplica una segunda vez en el agregado (tarifaMensualLinea ya viene multiplicada)', () => {
    const a = construirLineaComercialAtajo(datosLineaA, 249095, 'II', PARAMS);
    const agregado = agregarResultadosFinancierosMensuales([{ resultado: a.resultadoFinanciero }]);
    expect(agregado.tarifaMensualTotal).toBeCloseTo(a.resultadoFinanciero!.tarifaMensualLinea, 2);
    expect(agregado.tarifaMensualTotal).not.toBeCloseTo(a.resultadoFinanciero!.tarifaMensualPorTrabajador, 2);
  });

  it('21) una línea bloqueada nunca aparece como tarifa $0 válida — se excluye del total y se cuenta aparte', () => {
    const bloqueada = construirLineaComercialAtajo({ ...datosLineaA, salarioMensual: 0 }, 0, 'II', PARAMS);
    const ok = construirLineaComercialAtajo(datosLineaA, 249095, 'II', PARAMS);
    const agregado = agregarResultadosFinancierosMensuales([{ resultado: bloqueada.resultadoFinanciero }, { resultado: ok.resultadoFinanciero }]);
    expect(agregado.cantidadLineasBloqueadas).toBe(1);
    expect(agregado.cantidadLineasCalculadas).toBe(1);
    expect(agregado.hayLineasBloqueadas).toBe(true);
    expect(agregado.tarifaMensualTotal).toBeCloseTo(ok.resultadoFinanciero!.tarifaMensualLinea, 2);
  });

  it('sin líneas bloqueadas, hayLineasBloqueadas es false', () => {
    const ok = construirLineaComercialAtajo(datosLineaA, 249095, 'II', PARAMS);
    const agregado = agregarResultadosFinancierosMensuales([{ resultado: ok.resultadoFinanciero }]);
    expect(agregado.hayLineasBloqueadas).toBe(false);
  });

  it('lista vacía produce todos los totales en cero, sin lanzar', () => {
    const agregado = agregarResultadosFinancierosMensuales([]);
    expect(agregado.tarifaMensualTotal).toBe(0);
    expect(agregado.cantidadLineasCalculadas).toBe(0);
    expect(agregado.cantidadLineasBloqueadas).toBe(0);
  });

  it('cada concepto (salario, bono, recargos, aux, prestaciones, seguridad, parafiscales, otros) se agrega por separado', () => {
    const a = construirLineaComercialAtajo(datosLineaA, 249095, 'II', PARAMS);
    const b = construirLineaComercialAtajo(datosLineaB, 249095, 'II', PARAMS);
    const agregado = agregarResultadosFinancierosMensuales([{ resultado: a.resultadoFinanciero }, { resultado: b.resultadoFinanciero }]);
    const ra = a.resultadoFinanciero!, rb = b.resultadoFinanciero!;
    expect(agregado.salarioBaseMensualTotal).toBeCloseTo(ra.salarioBaseMensual * ra.cantidadTrabajadores + rb.salarioBaseMensual * rb.cantidadTrabajadores, 2);
    expect(agregado.auxilioTransporteMensualTotal).toBeCloseTo(ra.auxilioTransporteMensual * ra.cantidadTrabajadores + rb.auxilioTransporteMensual * rb.cantidadTrabajadores, 2);
    expect(agregado.prestacionesSocialesMensualesTotal).toBeCloseTo(ra.prestacionesSocialesMensuales * ra.cantidadTrabajadores + rb.prestacionesSocialesMensuales * rb.cantidadTrabajadores, 2);
  });
});

describe('agregarResultadosFinancierosMensuales — titular + turnante, sin duplicación (§10, cierre financiero correctivo, #18/#19)', () => {
  it('la suma de un titular (2 operarios) y un turnante (1 operario, mismo cargo) es exactamente titular + turnante — nunca titular + turnante duplicado', () => {
    const titular: DatosLineaComercial30Dias = { ...datosLineaA, cantidadTrabajadores: 2 };
    const turnante: DatosLineaComercial30Dias = { ...datosLineaA, cantidadTrabajadores: 1 };
    const rTitular = construirLineaComercialAtajo(titular, 249095, 'II', PARAMS);
    const rTurnante = construirLineaComercialAtajo(turnante, 249095, 'II', PARAMS);

    const agregadoTitulares = agregarResultadosFinancierosMensuales([{ resultado: rTitular.resultadoFinanciero }]);
    const agregadoTurnantes = agregarResultadosFinancierosMensuales([{ resultado: rTurnante.resultadoFinanciero }]);
    const total = agregadoTitulares.tarifaMensualTotal + agregadoTurnantes.tarifaMensualTotal;

    // El total combinado (titulares+turnantes, cada grupo agregado por
    // separado y luego sumado — exactamente como hace page.tsx con
    // agregadoManoObraMensual + agregadoTurnantesMensual) debe coincidir
    // con agregar las DOS líneas juntas en una sola pasada — nunca puede
    // ser mayor (lo que delataría una duplicación del turnante).
    const agregadoJunto = agregarResultadosFinancierosMensuales([
      { resultado: rTitular.resultadoFinanciero }, { resultado: rTurnante.resultadoFinanciero },
    ]);
    expect(total).toBeCloseTo(agregadoJunto.tarifaMensualTotal, 2);
    // La cantidad total de trabajadores (2+1=3) se refleja una sola vez —
    // ni el titular ni el turnante se cuentan dos veces.
    expect(rTitular.resultadoFinanciero!.cantidadTrabajadores).toBe(2);
    expect(rTurnante.resultadoFinanciero!.cantidadTrabajadores).toBe(1);
  });

  it('titular y turnante con cargos distintos también producen un total = suma exacta de ambas líneas', () => {
    const titular: DatosLineaComercial30Dias = { ...datosLineaA, cantidadTrabajadores: 4, salarioMensual: 1750905 };
    const turnante: DatosLineaComercial30Dias = { ...datosLineaB, cantidadTrabajadores: 2, salarioMensual: 1900000 };
    const rTitular = construirLineaComercialAtajo(titular, 249095, 'II', PARAMS);
    const rTurnante = construirLineaComercialAtajo(turnante, 249095, 'IV', PARAMS);
    const agregado = agregarResultadosFinancierosMensuales([
      { resultado: rTitular.resultadoFinanciero }, { resultado: rTurnante.resultadoFinanciero },
    ]);
    expect(agregado.tarifaMensualTotal).toBeCloseTo(
      rTitular.resultadoFinanciero!.tarifaMensualLinea + rTurnante.resultadoFinanciero!.tarifaMensualLinea, 2,
    );
  });
});