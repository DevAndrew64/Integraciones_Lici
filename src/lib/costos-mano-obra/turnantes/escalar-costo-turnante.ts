/**
 * Ajuste "IMPLEMENTAR FICHAS DE TURNANTES USANDO EXACTAMENTE LA MISMA
 * ESTRUCTURA DE MANO DE OBRA" — la línea automática de un turnante SIEMPRE
 * se calcula por el motor real a la jornada de REFERENCIA (42h,
 * `construirLineaTurnanteAutomatica` fija `horasSemanal`/
 * `horasSemanalesManual` en `LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL`, nunca
 * la jornada contratada real de 21h/42h) — el resto del proyecto ya
 * corrige esto multiplicando por `factorEscalaContrato =
 * horasContratadasTotal÷42` en el punto de consumo (costoTurnantePorCargo,
 * la tarjeta por cargo, el total general). Esta función es la ÚNICA
 * fuente de esa misma multiplicación para la ficha propia del turnante —
 * nunca reimplementa el cálculo laboral, solo escala linealmente los
 * TOTALES YA CALCULADOS por el motor real (nunca los campos base/
 * porcentaje anidados de los desgloses — esos requerirían recalcular el
 * IBC/las bases, fuera de alcance de este ajuste; la ficha del turnante
 * muestra los totales por concepto, sin el detalle anidado por eso).
 */
import type { ResultadoFinancieroMensualLinea } from '../motor-distribuido/resultado-financiero-mensual-linea';

export interface TotalesLaboralesEscalados {
  salarioBaseMensual: number;
  bonoPrestacionalMensual: number;
  recargosSobretiempoMensual: number;
  auxilioTransporteMensual: number;
  prestacionesSocialesMensuales: number;
  seguridadSocialMensual: number;
  parafiscalesMensuales: number;
}

const redondearPeso = (n: number): number => Math.round(n);

/**
 * Escala los totales YA CALCULADOS por el motor real (a la referencia de
 * 42h) al costo REAL del contrato del turnante (21h o 42h, `factor =
 * horasContratadasTotal÷42`) — mismo criterio ya usado en
 * `costoContratoGrupo=resultado.costoMensualTotalLinea*factorEscalaContrato`
 * (page.tsx, costoTurnantePorCargo y la tarjeta por cargo), nunca una
 * fórmula nueva.
 */
export function escalarTotalesLaborales(
  fin: ResultadoFinancieroMensualLinea,
  factor: number,
): TotalesLaboralesEscalados {
  return {
    salarioBaseMensual: redondearPeso(fin.salarioBaseMensual * factor),
    bonoPrestacionalMensual: redondearPeso(fin.bonoPrestacionalMensual * factor),
    recargosSobretiempoMensual: redondearPeso(fin.recargosSobretiempoMensual * factor),
    auxilioTransporteMensual: redondearPeso(fin.auxilioTransporteMensual * factor),
    prestacionesSocialesMensuales: redondearPeso(fin.prestacionesSocialesMensuales * factor),
    seguridadSocialMensual: redondearPeso(fin.seguridadSocialMensual * factor),
    parafiscalesMensuales: redondearPeso(fin.parafiscalesMensuales * factor),
  };
}

export interface TotalesLaboralesConciliados extends TotalesLaboralesEscalados {
  otrosCostosMensuales: number;
}

const CONCEPTOS_CONCILIABLES: readonly (keyof TotalesLaboralesConciliados)[] = [
  'salarioBaseMensual', 'bonoPrestacionalMensual', 'recargosSobretiempoMensual',
  'auxilioTransporteMensual', 'prestacionesSocialesMensuales', 'seguridadSocialMensual',
  'parafiscalesMensuales', 'otrosCostosMensuales',
];

/**
 * Ajuste "VALIDAR Y AJUSTAR LA CONCILIACIÓN VISUAL DE LA FICHA DEL
 * TURNANTE" — redondear cada concepto por separado (escalarTotalesLaborales,
 * un Math.round por campo) y redondear el costo TOTAL de la línea por
 * separado (un solo Math.round sobre `costoMensualTotalLinea*factor` — el
 * MISMO criterio ya usado en `costoTurnantePorCargo`/
 * `resultadosTurnantesEscaladosParaTotal`, política de redondeo única en
 * toda la app, NUNCA reemplazada aquí) puede producir una diferencia de 1
 * o 2 pesos entre "suma de los conceptos visibles" y "total visible": son
 * dos redondeos independientes sobre el mismo valor exacto.
 *
 * El total NUNCA se ajusta (es el valor canónico, el mismo que usan el
 * resumen y el total general de Mano de Obra) — el residuo se absorbe,
 * de forma determinística, en el concepto de MAYOR magnitud (método del
 * mayor residuo/"largest remainder", nunca aleatorio, nunca repartido en
 * el JSX de la ficha) para que `Σ conceptos visibles === total visible`
 * se cumpla exactamente.
 */
export function conciliarConTotalCanonico(
  totales: TotalesLaboralesEscalados,
  otrosCostosMensuales: number,
  totalCanonico: number,
): TotalesLaboralesConciliados {
  const resultado: TotalesLaboralesConciliados = { ...totales, otrosCostosMensuales };
  const suma = CONCEPTOS_CONCILIABLES.reduce((s, c) => s + resultado[c], 0);
  const residuo = totalCanonico - suma;
  if (residuo === 0) return resultado;
  let claveMayor = CONCEPTOS_CONCILIABLES[0];
  for (const c of CONCEPTOS_CONCILIABLES) {
    if (Math.abs(resultado[c]) > Math.abs(resultado[claveMayor])) claveMayor = c;
  }
  resultado[claveMayor] = resultado[claveMayor] + residuo;
  return resultado;
}
