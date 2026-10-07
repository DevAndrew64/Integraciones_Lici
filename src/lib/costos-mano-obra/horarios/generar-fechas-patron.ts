/**
 * Generación pura de fechas calendario a partir de un período + patrón
 * semanal (Bloque HORARIOS 2A-UNIFICADO). Minutos/fechas enteros, sin
 * Float. Operaciones exclusivamente en UTC (Date.UTC/getUTC*) — nunca
 * parsing local ambiguo (new Date('YYYY-MM-DD') sin componente UTC
 * explícito, .getDate()/.getMonth() locales, etc.) — mismo criterio ya
 * exigido para el contexto semanal (Fase 1A.3B-2 §6).
 */
import type { DiaSemanaHorario } from './tipos';

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const DIA_SEMANA_JS: Record<number, DiaSemanaHorario> = {
  0: 'D', 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S',
};

function esFechaIsoValida(fecha: string): boolean {
  if (!RE_FECHA.test(fecha)) return false;
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function parsearFechaUTC(fecha: string): Date {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatearFechaUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Genera, en orden ascendente y sin duplicados (garantizado por
 * construcción: un único recorrido día a día), las fechas del período
 * [fechaInicio, fechaFin] (ambos extremos incluidos) cuyo día de semana
 * está en `diasSemana`. Lanza un error explícito ante un rango inválido
 * — nunca devuelve un resultado "corregido" en silencio.
 */
export function generarFechasPatron(
  fechaInicio: string,
  fechaFin: string,
  diasSemana: DiaSemanaHorario[],
): string[] {
  if (!esFechaIsoValida(fechaInicio) || !esFechaIsoValida(fechaFin)) {
    throw new Error('RANGO_INVALIDO: fechaInicio/fechaFin deben tener formato "YYYY-MM-DD" y ser fechas calendario reales');
  }
  const ini = parsearFechaUTC(fechaInicio);
  const fin = parsearFechaUTC(fechaFin);
  if (fin.getTime() < ini.getTime()) {
    throw new Error('RANGO_INVALIDO: fechaFin es anterior a fechaInicio');
  }

  const diasSet = new Set(diasSemana);
  const resultado: string[] = [];
  const cur = new Date(ini.getTime());
  while (cur.getTime() <= fin.getTime()) {
    if (diasSet.has(DIA_SEMANA_JS[cur.getUTCDay()])) {
      resultado.push(formatearFechaUTC(cur));
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return resultado;
}
