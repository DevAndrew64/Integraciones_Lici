import { construirSemanasConContexto } from './construir-semana';
import { clasificarSemanas } from './clasificar-segmentos';
import { liquidarConceptos } from './liquidar-conceptos';
import { DIVISOR_MENSUAL_GENERAL_2026, JORNADA_SEMANAL_MINUTOS_GENERAL_2026 } from './tipos';
import type { EntradaCargoDistribuido, ResultadoLiquidacionDistribuida } from './tipos';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Calcula la liquidación económica de un cargo con programación
 * estructurada (distribucionesHorario). Fuente única del cálculo cuando
 * existen distribuciones — el motor legado (calcularHorasYCostoLinea,
 * page.tsx) nunca se ejecuta en paralelo para el mismo cargo (guard-motor-
 * legado.ts sigue decidiendo cuándo aplica cada uno).
 *
 * `auxTransporte` se recibe ya calculado por el llamador (una sola vez por
 * cargo elegible, sin duplicar por distribución/bloque) — este módulo no
 * decide elegibilidad de auxilio, solo lo suma al total del período.
 */
export function calcularCargoDistribuido(
  entrada: EntradaCargoDistribuido,
  auxTransporte: number,
  festivos: readonly string[] = [],
): ResultadoLiquidacionDistribuida {
  const vacio: ResultadoLiquidacionDistribuida = {
    estado: 'INCONSISTENTE', mensaje: null, cantidadDias: 0, minutosPeriodo: 0,
    buckets: { ordinariaHabil: 0, recargoNocturno: 0, extraDiurna: 0, extraNocturna: 0, ordinariaDominical: 0, recargoNocturnoDominical: 0, extraDiurnaFestiva: 0, extraNocturnaFestiva: 0 },
    conceptos: [], valorHoraExacto: 0, valorHoraMostrado: 0, salarioBasico: 0, costoRecargos: 0, auxTransporte: 0, totalPeriodo: 0,
  };

  if (entrada.distribuciones.length === 0) {
    return { ...vacio, estado: 'INCONSISTENTE', mensaje: 'El cargo no tiene ninguna distribución horaria configurada.' };
  }
  if (!RE_FECHA.test(entrada.fechaInicio) || !RE_FECHA.test(entrada.fechaFin) || entrada.fechaFin < entrada.fechaInicio) {
    return { ...vacio, estado: 'INCONSISTENTE', mensaje: 'El plazo de ejecución del cargo no es un rango de fechas válido.' };
  }
  if (entrada.distribuciones.some(d => d.bloques.length === 0)) {
    return { ...vacio, estado: 'INCONSISTENTE', mensaje: 'Una de las distribuciones no tiene bloques horarios válidos.' };
  }

  const dias = construirSemanasConContexto(entrada.fechaInicio, entrada.fechaFin);
  const { buckets, minutosPeriodo, cantidadDias } = clasificarSemanas(dias, entrada.distribuciones, JORNADA_SEMANAL_MINUTOS_GENERAL_2026, festivos);

  const valorHoraExacto = entrada.salarioMensual > 0 ? entrada.salarioMensual / DIVISOR_MENSUAL_GENERAL_2026 : 0;
  const valorHoraMostrado = Math.round(valorHoraExacto);
  const { conceptos, costoRecargos } = liquidarConceptos(buckets, valorHoraExacto);
  const salarioBasico = entrada.salarioMensual; // completo, nunca prorrateado por distribuciones/bloques/días

  const totalPeriodo = salarioBasico + costoRecargos + auxTransporte;

  return {
    estado: 'CALCULADO',
    mensaje: null,
    cantidadDias,
    minutosPeriodo,
    buckets,
    conceptos,
    valorHoraExacto,
    valorHoraMostrado,
    salarioBasico,
    costoRecargos,
    auxTransporte,
    totalPeriodo,
  };
}
