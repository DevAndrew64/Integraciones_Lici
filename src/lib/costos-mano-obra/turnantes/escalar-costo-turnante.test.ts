import { describe, expect, it } from 'vitest';
import { escalarTotalesLaborales, conciliarConTotalCanonico } from './escalar-costo-turnante';
import type { ResultadoFinancieroMensualLinea } from '../motor-distribuido/resultado-financiero-mensual-linea';

function fin(over: Partial<ResultadoFinancieroMensualLinea> = {}): ResultadoFinancieroMensualLinea {
  return {
    horasPromedioMensuales: [],
    salarioBaseMensual: 2000000,
    bonoPrestacionalMensual: 0,
    bonoNoSalarialMensual: 0,
    recargosSobretiempoMensual: 500000,
    auxilioTransporteMensual: 200000,
    basePrestacionesMensual: 2000000,
    prestacionesSocialesMensuales: 400000,
    baseSeguridadSocialMensual: 2000000,
    seguridadSocialMensual: 300000,
    baseParafiscalesMensual: 2000000,
    parafiscalesMensuales: 100000,
    otrosCostosMensuales: 0,
    tarifaMensualPorTrabajador: 3500000,
    cantidadTrabajadores: 1,
    tarifaMensualLinea: 3500000,
    bases: {} as ResultadoFinancieroMensualLinea['bases'],
    desgloseRecargos: {} as ResultadoFinancieroMensualLinea['desgloseRecargos'],
    desglosePrestaciones: {} as ResultadoFinancieroMensualLinea['desglosePrestaciones'],
    desgloseSeguridadSocial: {} as ResultadoFinancieroMensualLinea['desgloseSeguridadSocial'],
    desgloseParafiscales: {} as ResultadoFinancieroMensualLinea['desgloseParafiscales'],
    ...over,
  };
}

describe('escalarTotalesLaborales — factor 21/42 (medio tiempo)', () => {
  it('factor 0,5 reduce cada total exactamente a la mitad', () => {
    const r = escalarTotalesLaborales(fin(), 0.5);
    expect(r.salarioBaseMensual).toBe(1000000);
    expect(r.recargosSobretiempoMensual).toBe(250000);
    expect(r.auxilioTransporteMensual).toBe(100000);
    expect(r.prestacionesSocialesMensuales).toBe(200000);
    expect(r.seguridadSocialMensual).toBe(150000);
    expect(r.parafiscalesMensuales).toBe(50000);
  });
});

describe('escalarTotalesLaborales — factor 42/42 (tiempo completo)', () => {
  it('factor 1 nunca altera los totales (referencia = resultado real)', () => {
    const original = fin();
    const r = escalarTotalesLaborales(original, 1);
    expect(r.salarioBaseMensual).toBe(original.salarioBaseMensual);
    expect(r.recargosSobretiempoMensual).toBe(original.recargosSobretiempoMensual);
    expect(r.auxilioTransporteMensual).toBe(original.auxilioTransporteMensual);
    expect(r.prestacionesSocialesMensuales).toBe(original.prestacionesSocialesMensuales);
    expect(r.seguridadSocialMensual).toBe(original.seguridadSocialMensual);
    expect(r.parafiscalesMensuales).toBe(original.parafiscalesMensuales);
  });
});

describe('escalarTotalesLaborales — bono prestacional también escala (mismo criterio que salarioBaseDesglose en page.tsx)', () => {
  it('bonoPrestacionalMensual se escala igual que salarioBaseMensual', () => {
    const r = escalarTotalesLaborales(fin({ bonoPrestacionalMensual: 100000 }), 0.5);
    expect(r.bonoPrestacionalMensual).toBe(50000);
  });
});

describe('escalarTotalesLaborales — nunca redondea a centavos (HALF_UP a pesos enteros, misma política del proyecto)', () => {
  it('un factor no exacto redondea el resultado a pesos enteros', () => {
    const r = escalarTotalesLaborales(fin({ salarioBaseMensual: 1000001 }), 1 / 3);
    expect(Number.isInteger(r.salarioBaseMensual)).toBe(true);
  });
});

describe('conciliarConTotalCanonico — ajuste "VALIDAR Y AJUSTAR LA CONCILIACIÓN VISUAL DE LA FICHA DEL TURNANTE"', () => {
  // Caso real reportado: turnante de 21h (factor 0,5) de VIGILANTE
  // ($1.750.905 salario, $249.095 auxilio) — el motor real produce
  // prestaciones/seguridad social/parafiscales que, escaladas y
  // redondeadas por separado, dan 875453+124548+220373+143137+36769=
  // 1.400.280, pero el total canónico (redondeado independientemente,
  // mismo criterio que costoTurnantePorCargo) es 1.400.278 — diferencia
  // de $2 por doble redondeo independiente sobre el mismo valor exacto.
  it('reproduce el caso real: residuo de -2 se absorbe en el concepto de mayor magnitud (salario), la suma queda exacta', () => {
    const totales = escalarTotalesLaborales(fin({
      salarioBaseMensual: 1750905, bonoPrestacionalMensual: 0, recargosSobretiempoMensual: 0,
      auxilioTransporteMensual: 249095, prestacionesSocialesMensuales: 440745,
      seguridadSocialMensual: 286273, parafiscalesMensuales: 73538,
    }), 0.5);
    // Reproduce exactamente las cifras visibles reportadas antes de conciliar.
    expect(totales.salarioBaseMensual).toBe(875453);
    expect(totales.auxilioTransporteMensual).toBe(124548);
    expect(totales.prestacionesSocialesMensuales).toBe(220373);
    expect(totales.seguridadSocialMensual).toBe(143137);
    expect(totales.parafiscalesMensuales).toBe(36769);
    const sumaSinConciliar = totales.salarioBaseMensual + totales.bonoPrestacionalMensual
      + totales.recargosSobretiempoMensual + totales.auxilioTransporteMensual
      + totales.prestacionesSocialesMensuales + totales.seguridadSocialMensual
      + totales.parafiscalesMensuales + 0;
    expect(sumaSinConciliar).toBe(1400280);

    const totalCanonico = 1400278;
    const conciliado = conciliarConTotalCanonico(totales, 0, totalCanonico);

    expect(conciliado.salarioBaseMensual).toBe(875451); // 875453 - 2 (residuo absorbido aquí, el concepto mayor)
    expect(conciliado.auxilioTransporteMensual).toBe(124548); // resto intacto
    expect(conciliado.prestacionesSocialesMensuales).toBe(220373);
    expect(conciliado.seguridadSocialMensual).toBe(143137);
    expect(conciliado.parafiscalesMensuales).toBe(36769);
    expect(conciliado.otrosCostosMensuales).toBe(0);

    const sumaConciliada = conciliado.salarioBaseMensual + conciliado.bonoPrestacionalMensual
      + conciliado.recargosSobretiempoMensual + conciliado.auxilioTransporteMensual
      + conciliado.prestacionesSocialesMensuales + conciliado.seguridadSocialMensual
      + conciliado.parafiscalesMensuales + conciliado.otrosCostosMensuales;
    expect(sumaConciliada).toBe(totalCanonico);
  });

  it('sin residuo (suma ya coincide con el total), no altera ningún concepto', () => {
    const totales = escalarTotalesLaborales(fin(), 1);
    const suma = totales.salarioBaseMensual + totales.bonoPrestacionalMensual + totales.recargosSobretiempoMensual
      + totales.auxilioTransporteMensual + totales.prestacionesSocialesMensuales + totales.seguridadSocialMensual
      + totales.parafiscalesMensuales;
    const conciliado = conciliarConTotalCanonico(totales, 0, suma);
    expect(conciliado.salarioBaseMensual).toBe(totales.salarioBaseMensual);
    expect(conciliado.prestacionesSocialesMensuales).toBe(totales.prestacionesSocialesMensuales);
  });

  it('nunca ajusta el total (no es un parámetro de salida) — el total sigue siendo el valor canónico recibido, la conciliación solo redistribuye las filas', () => {
    const totales = escalarTotalesLaborales(fin(), 0.5);
    const totalCanonico = 1234567;
    const conciliado = conciliarConTotalCanonico(totales, 5000, totalCanonico);
    const suma = conciliado.salarioBaseMensual + conciliado.bonoPrestacionalMensual + conciliado.recargosSobretiempoMensual
      + conciliado.auxilioTransporteMensual + conciliado.prestacionesSocialesMensuales + conciliado.seguridadSocialMensual
      + conciliado.parafiscalesMensuales + conciliado.otrosCostosMensuales;
    expect(suma).toBe(totalCanonico);
  });

  it('el residuo se absorbe en el concepto de MAYOR magnitud absoluta, nunca en el primero de la lista ni de forma aleatoria (determinístico)', () => {
    // otrosCostosMensuales es aquí el concepto de mayor magnitud (no el
    // primero en el orden de campos) — confirma que la elección depende
    // del VALOR, no de la posición.
    const totales = escalarTotalesLaborales(fin({
      salarioBaseMensual: 100, bonoPrestacionalMensual: 0, recargosSobretiempoMensual: 0,
      auxilioTransporteMensual: 0, prestacionesSocialesMensuales: 0, seguridadSocialMensual: 0, parafiscalesMensuales: 0,
    }), 1);
    const conciliado1 = conciliarConTotalCanonico(totales, 900000, 900099);
    expect(conciliado1.otrosCostosMensuales).toBe(899999); // 900000 - 1
    const conciliado2 = conciliarConTotalCanonico(totales, 900000, 900103);
    expect(conciliado2.otrosCostosMensuales).toBe(900003); // 900000 + 3
  });
});
