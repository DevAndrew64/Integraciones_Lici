/**
 * Ajuste "SIGUIENTE AJUSTE — SERVICIO PARCIAL POR TOTAL DE HORAS
 * SEMANALES" — módulo puro (sin React, sin Prisma) para la modalidad
 * alternativa de captura de horario "Registrar horas semanales", exclusiva
 * de jornadas parciales ordinarias (≤42h/semana, lunes a sábado, sin
 * franjas ni recargos). Reutiliza `FACTOR_SEMANAS_MES` ya existente
 * (motor-comercial-30-dias.ts) — nunca duplica el literal 4,33, y nunca usa
 * 24,08 (ese aislamiento queda intocado, ver derivar-distribucion-
 * comercial.ts).
 */
import type { DiaSemanaHorario } from './tipos';
import { FACTOR_SEMANAS_MES } from '../motor-distribuido/motor-comercial-30-dias';

export { FACTOR_SEMANAS_MES };

/** Límite superior de esta modalidad (§3 del ajuste) — por encima de este
 * valor es obligatorio un horario detallado, porque ya no es posible
 * identificar horas extra ni sus franjas sin horas de inicio/fin. */
export const LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL = 42;

export const MENSAJE_LIMITE_HORAS_SEMANALES =
  'Para jornadas superiores a 42 horas debe registrar un horario detallado, ya que es necesario identificar las horas extras y sus franjas.';

export type ResultadoValidacionHorasSemanales =
  | { ok: true }
  | { ok: false; mensaje: string };

/** Valida `0 < horasSemanales <= 42` (§3). */
export function validarHorasSemanalesTotalSemanal(horasSemanales: number): ResultadoValidacionHorasSemanales {
  if (!(horasSemanales > 0)) {
    return { ok: false, mensaje: 'Ingresa el total de horas semanales del servicio.' };
  }
  if (horasSemanales > LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL) {
    return { ok: false, mensaje: MENSAJE_LIMITE_HORAS_SEMANALES };
  }
  return { ok: true };
}

export interface PromedioDiarioInformativo {
  horasDecimal: number;
  horas: number;
  minutos: number;
  texto: string;
}

/** Distribución promedio ÚNICAMENTE informativa (§4) — nunca sustituye el
 * total semanal digitado, que es siempre el dato autoritativo. */
export function calcularPromedioDiarioInformativo(horasSemanales: number, cantidadDias: number): PromedioDiarioInformativo {
  if (cantidadDias <= 0 || !(horasSemanales > 0)) {
    return { horasDecimal: 0, horas: 0, minutos: 0, texto: '—' };
  }
  const horasDecimal = horasSemanales / cantidadDias;
  const minutosTotales = Math.round(horasDecimal * 60);
  const horas = Math.floor(minutosTotales / 60);
  const minutos = minutosTotales % 60;
  const texto = minutos > 0 ? `${horas} h ${String(minutos).padStart(2, '0')} min diarios` : `${horas} h diarios`;
  return { horasDecimal, horas, minutos, texto };
}

/** `horasServicioMes = horasServicioSemana × FACTOR_SEMANAS_MES` (§6) —
 * nunca 24,08. */
export function calcularHorasServicioMes(horasServicioSemana: number): number {
  return horasServicioSemana * FACTOR_SEMANAS_MES;
}

function redondearPesoHalfUp(valor: number): number {
  return Math.round(valor);
}

/** `salarioProporcionalServicio = (salarioBaseJornadaCompleta / 42) ×
 * horasServicioSemana` (§7), con precisión completa hasta el redondeo
 * final HALF_UP a pesos. `jornadaMaxima` default 42 — mismo valor que
 * `LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL`, nunca duplicado con un literal
 * distinto. */
export function calcularSalarioProporcionalServicio(
  salarioBaseJornadaCompleta: number,
  horasServicioSemana: number,
  jornadaMaxima: number = LIMITE_HORAS_SEMANALES_TOTAL_SEMANAL,
): number {
  if (!(salarioBaseJornadaCompleta > 0) || !(horasServicioSemana > 0) || !(jornadaMaxima > 0)) return 0;
  const valorExacto = (salarioBaseJornadaCompleta * horasServicioSemana) / jornadaMaxima;
  return redondearPesoHalfUp(valorExacto);
}

const MAPA_LETRA_DIA: Record<string, DiaSemanaHorario> = {
  lun: 'L', mar: 'M', mie: 'X', mié: 'X', jue: 'J', vie: 'V', sab: 'S', sáb: 'S',
};

export const DIAS_LUNES_A_VIERNES: DiaSemanaHorario[] = ['L', 'M', 'X', 'J', 'V'];
export const DIAS_LUNES_A_SABADO: DiaSemanaHorario[] = ['L', 'M', 'X', 'J', 'V', 'S'];

export interface InterpretacionTextoTotalSemanal {
  horasSemanales: number;
  /** `null` cuando el texto no indicó días — nunca se seleccionan días en
   * silencio (§11): el llamador debe mostrar los accesos rápidos L-V/L-S
   * y dejar la selección pendiente de confirmación explícita. */
  dias: DiaSemanaHorario[] | null;
}

/**
 * Reconoce expresiones como "servicio de 19 horas semanales", "jornada
 * parcial de 21 horas", "25 h a la semana", "30 horas semanales de lunes a
 * sábado" (§11). Nunca inventa horas de inicio/fin. Retorna `null` si el
 * texto no contiene una cantidad de horas semanales reconocible.
 */
export function interpretarTextoTotalSemanal(texto: string): InterpretacionTextoTotalSemanal | null {
  const t = texto.toLowerCase().trim();
  if (!t) return null;
  const matchHoras = t.match(/(\d+(?:[.,]\d+)?)\s*h(?:oras?)?\b/);
  if (!matchHoras) return null;
  const esSemanal = /semanal(?:es)?|a la semana|por semana/.test(t);
  if (!esSemanal) return null;
  const horasSemanales = Number(matchHoras[1].replace(',', '.'));
  if (!(horasSemanales > 0)) return null;

  let dias: DiaSemanaHorario[] | null = null;
  if (/lunes\s+a\s+s[áa]bado/.test(t)) dias = DIAS_LUNES_A_SABADO;
  else if (/lunes\s+a\s+viernes/.test(t)) dias = DIAS_LUNES_A_VIERNES;
  else {
    const diasSueltos = [...t.matchAll(/\b(lun|mar|mi[ée]|jue|vie|s[áa]b)\b/g)]
      .map(m => MAPA_LETRA_DIA[m[1]])
      .filter((d): d is DiaSemanaHorario => !!d);
    if (diasSueltos.length > 0) dias = [...new Set(diasSueltos)];
  }

  return { horasSemanales, dias };
}