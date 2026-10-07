/**
 * Agregador puro — ETAPA FINAL D/E §2/§11. Suma los resultados financieros
 * mensuales YA CALCULADOS de varias líneas (Mano de Obra y/o Turnantes) sin
 * volver a calcular nada: cada línea llega con su `tarifaMensualLinea` ya
 * multiplicada por su propia `cantidadTrabajadores` (una sola vez, dentro
 * del ensamblador) — este módulo únicamente suma.
 *
 * Una línea bloqueada (resultado === null) NUNCA se trata como si su valor
 * real fuera $0: se excluye de las sumas y se cuenta aparte en
 * `cantidadLineasBloqueadas`, para que la UI pueda advertir que el total
 * general está incompleto.
 */
import type { ResultadoFinancieroMensualLinea } from './resultado-financiero-mensual-linea';

export interface LineaParaAgregar {
  resultado: ResultadoFinancieroMensualLinea | null;
}

/** Totales del desglose de recargos — corrección visual/funcional §7/§1.
 * Cada campo es la suma del concepto monetario de cada línea (ya
 * multiplicado por su propia cantidadTrabajadores), nunca un porcentaje
 * recalculado sobre el agregado. */
export interface AgregadoDesgloseRecargos {
  valorRecargoNocturnoMensualTotal: number;
  valorExtraDiurnaMensualTotal: number;
  valorExtraNocturnaMensualTotal: number;
  valorDominicalFestivoMensualTotal: number;
  valorExtraFestivaDiurnaMensualTotal: number;
  valorExtraFestivaNocturnaMensualTotal: number;
  valorRecargoNocturnoFestivoMensualTotal: number;
}

export interface AgregadoDesglosePrestaciones {
  cesantiasMensualesTotal: number;
  primaMensualTotal: number;
  vacacionesMensualesTotal: number;
  interesesCesantiasMensualesTotal: number;
}

export interface AgregadoDesgloseSeguridadSocial {
  saludMensualTotal: number;
  pensionMensualTotal: number;
  arlMensualTotal: number;
}

export interface AgregadoDesgloseParafiscales {
  cajaCompensacionMensualTotal: number;
  senaMensualTotal: number;
  icbfMensualTotal: number;
}

export interface AgregadoResultadoFinancieroMensual {
  salarioBaseMensualTotal: number;
  bonoPrestacionalMensualTotal: number;
  bonoNoSalarialMensualTotal: number;
  recargosSobretiempoMensualTotal: number;
  auxilioTransporteMensualTotal: number;
  prestacionesSocialesMensualesTotal: number;
  seguridadSocialMensualTotal: number;
  parafiscalesMensualesTotal: number;
  otrosCostosMensualesTotal: number;
  tarifaMensualTotal: number;
  cantidadLineasCalculadas: number;
  cantidadLineasBloqueadas: number;
  hayLineasBloqueadas: boolean;
  desgloseRecargos: AgregadoDesgloseRecargos;
  desglosePrestaciones: AgregadoDesglosePrestaciones;
  desgloseSeguridadSocial: AgregadoDesgloseSeguridadSocial;
  desgloseParafiscales: AgregadoDesgloseParafiscales;
}

// Cierre de consistencia monetaria — misma política HALF_UP a pesos
// enteros usada en resultado-financiero-mensual-linea.ts. Cada línea ya
// llega con sus conceptos redondeados a pesos; esta función solo protege
// contra imprecisión de punto flotante en la multiplicación/suma, nunca
// introduce un redondeo a centavos.
function redondearPeso(n: number): number { return Math.round(n); }

/** Total de UNA línea para un concepto "por trabajador" — la única
 * multiplicación que hace este módulo, y solo para conceptos que el
 * ensamblador expone por trabajador (nunca para tarifaMensualLinea, que ya
 * viene multiplicada). */
function totalLinea(r: ResultadoFinancieroMensualLinea, porTrabajador: number): number {
  return redondearPeso(porTrabajador * r.cantidadTrabajadores);
}

/** Único punto de entrada para agregar varias líneas ya calculadas — nunca
 * se suma manualmente en page.tsx. */
export function agregarResultadosFinancierosMensuales(lineas: LineaParaAgregar[]): AgregadoResultadoFinancieroMensual {
  const calculadas = lineas.filter((l): l is { resultado: ResultadoFinancieroMensualLinea } => l.resultado !== null);
  const bloqueadas = lineas.length - calculadas.length;

  const acumulado: AgregadoResultadoFinancieroMensual = {
    salarioBaseMensualTotal: 0,
    bonoPrestacionalMensualTotal: 0,
    bonoNoSalarialMensualTotal: 0,
    recargosSobretiempoMensualTotal: 0,
    auxilioTransporteMensualTotal: 0,
    prestacionesSocialesMensualesTotal: 0,
    seguridadSocialMensualTotal: 0,
    parafiscalesMensualesTotal: 0,
    otrosCostosMensualesTotal: 0,
    tarifaMensualTotal: 0,
    cantidadLineasCalculadas: calculadas.length,
    cantidadLineasBloqueadas: bloqueadas,
    hayLineasBloqueadas: bloqueadas > 0,
    desgloseRecargos: {
      valorRecargoNocturnoMensualTotal: 0, valorExtraDiurnaMensualTotal: 0, valorExtraNocturnaMensualTotal: 0,
      valorDominicalFestivoMensualTotal: 0, valorExtraFestivaDiurnaMensualTotal: 0,
      valorExtraFestivaNocturnaMensualTotal: 0, valorRecargoNocturnoFestivoMensualTotal: 0,
    },
    desglosePrestaciones: { cesantiasMensualesTotal: 0, primaMensualTotal: 0, vacacionesMensualesTotal: 0, interesesCesantiasMensualesTotal: 0 },
    desgloseSeguridadSocial: { saludMensualTotal: 0, pensionMensualTotal: 0, arlMensualTotal: 0 },
    desgloseParafiscales: { cajaCompensacionMensualTotal: 0, senaMensualTotal: 0, icbfMensualTotal: 0 },
  };

  for (const { resultado: r } of calculadas) {
    acumulado.salarioBaseMensualTotal = redondearPeso(acumulado.salarioBaseMensualTotal + totalLinea(r, r.salarioBaseMensual));
    acumulado.bonoPrestacionalMensualTotal = redondearPeso(acumulado.bonoPrestacionalMensualTotal + totalLinea(r, r.bonoPrestacionalMensual));
    acumulado.bonoNoSalarialMensualTotal = redondearPeso(acumulado.bonoNoSalarialMensualTotal + totalLinea(r, r.bonoNoSalarialMensual));
    acumulado.recargosSobretiempoMensualTotal = redondearPeso(acumulado.recargosSobretiempoMensualTotal + totalLinea(r, r.recargosSobretiempoMensual));
    acumulado.auxilioTransporteMensualTotal = redondearPeso(acumulado.auxilioTransporteMensualTotal + totalLinea(r, r.auxilioTransporteMensual));
    acumulado.prestacionesSocialesMensualesTotal = redondearPeso(acumulado.prestacionesSocialesMensualesTotal + totalLinea(r, r.prestacionesSocialesMensuales));
    acumulado.seguridadSocialMensualTotal = redondearPeso(acumulado.seguridadSocialMensualTotal + totalLinea(r, r.seguridadSocialMensual));
    acumulado.parafiscalesMensualesTotal = redondearPeso(acumulado.parafiscalesMensualesTotal + totalLinea(r, r.parafiscalesMensuales));
    acumulado.otrosCostosMensualesTotal = redondearPeso(acumulado.otrosCostosMensualesTotal + totalLinea(r, r.otrosCostosMensuales));
    // tarifaMensualLinea YA viene multiplicada por cantidadTrabajadores
    // dentro del ensamblador — nunca se vuelve a multiplicar aquí.
    acumulado.tarifaMensualTotal = redondearPeso(acumulado.tarifaMensualTotal + r.tarifaMensualLinea);

    const dr = r.desgloseRecargos;
    acumulado.desgloseRecargos.valorRecargoNocturnoMensualTotal = redondearPeso(acumulado.desgloseRecargos.valorRecargoNocturnoMensualTotal + totalLinea(r, dr.valorRecargoNocturnoMensual));
    acumulado.desgloseRecargos.valorExtraDiurnaMensualTotal = redondearPeso(acumulado.desgloseRecargos.valorExtraDiurnaMensualTotal + totalLinea(r, dr.valorExtraDiurnaMensual));
    acumulado.desgloseRecargos.valorExtraNocturnaMensualTotal = redondearPeso(acumulado.desgloseRecargos.valorExtraNocturnaMensualTotal + totalLinea(r, dr.valorExtraNocturnaMensual));
    acumulado.desgloseRecargos.valorDominicalFestivoMensualTotal = redondearPeso(acumulado.desgloseRecargos.valorDominicalFestivoMensualTotal + totalLinea(r, dr.valorDominicalFestivoMensual));
    acumulado.desgloseRecargos.valorExtraFestivaDiurnaMensualTotal = redondearPeso(acumulado.desgloseRecargos.valorExtraFestivaDiurnaMensualTotal + totalLinea(r, dr.valorExtraFestivaDiurnaMensual));
    acumulado.desgloseRecargos.valorExtraFestivaNocturnaMensualTotal = redondearPeso(acumulado.desgloseRecargos.valorExtraFestivaNocturnaMensualTotal + totalLinea(r, dr.valorExtraFestivaNocturnaMensual));
    acumulado.desgloseRecargos.valorRecargoNocturnoFestivoMensualTotal = redondearPeso(acumulado.desgloseRecargos.valorRecargoNocturnoFestivoMensualTotal + totalLinea(r, dr.valorRecargoNocturnoFestivoMensual));

    const dp = r.desglosePrestaciones;
    acumulado.desglosePrestaciones.cesantiasMensualesTotal = redondearPeso(acumulado.desglosePrestaciones.cesantiasMensualesTotal + totalLinea(r, dp.cesantiasMensuales));
    acumulado.desglosePrestaciones.primaMensualTotal = redondearPeso(acumulado.desglosePrestaciones.primaMensualTotal + totalLinea(r, dp.primaMensual));
    acumulado.desglosePrestaciones.vacacionesMensualesTotal = redondearPeso(acumulado.desglosePrestaciones.vacacionesMensualesTotal + totalLinea(r, dp.vacacionesMensuales));
    acumulado.desglosePrestaciones.interesesCesantiasMensualesTotal = redondearPeso(acumulado.desglosePrestaciones.interesesCesantiasMensualesTotal + totalLinea(r, dp.interesesCesantiasMensuales));

    const ds = r.desgloseSeguridadSocial;
    acumulado.desgloseSeguridadSocial.saludMensualTotal = redondearPeso(acumulado.desgloseSeguridadSocial.saludMensualTotal + totalLinea(r, ds.saludMensual));
    acumulado.desgloseSeguridadSocial.pensionMensualTotal = redondearPeso(acumulado.desgloseSeguridadSocial.pensionMensualTotal + totalLinea(r, ds.pensionMensual));
    acumulado.desgloseSeguridadSocial.arlMensualTotal = redondearPeso(acumulado.desgloseSeguridadSocial.arlMensualTotal + totalLinea(r, ds.arlMensual));

    const dpf = r.desgloseParafiscales;
    acumulado.desgloseParafiscales.cajaCompensacionMensualTotal = redondearPeso(acumulado.desgloseParafiscales.cajaCompensacionMensualTotal + totalLinea(r, dpf.cajaCompensacionMensual));
    acumulado.desgloseParafiscales.senaMensualTotal = redondearPeso(acumulado.desgloseParafiscales.senaMensualTotal + totalLinea(r, dpf.senaMensual));
    acumulado.desgloseParafiscales.icbfMensualTotal = redondearPeso(acumulado.desgloseParafiscales.icbfMensualTotal + totalLinea(r, dpf.icbfMensual));
  }

  return acumulado;
}