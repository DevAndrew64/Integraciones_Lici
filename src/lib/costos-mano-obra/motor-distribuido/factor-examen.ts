/**
 * Ajuste "REDISEÑAR EXÁMENES, CURSOS Y VACUNAS" §4 — regla comercial EX001:
 * el catálogo real (grupocolba.com/service/public/api/examenes, confirmado
 * vía fetch en vivo 2026-08-02: 4.749 filas, 1.147 con `cod_examen==='EX001'`
 * bajo proveedores/ciudades distintos) NUNCA trae un factor — el motor de
 * costos tampoco lo aplicaba (confirmado por diagnóstico: cero referencias
 * a "EX001" ligadas a cálculo antes de este ajuste). Esta es la ÚNICA
 * fuente del factor — nunca se duplica en otra función, y el valor
 * unitario recibido de la API nunca se modifica (el factor se aplica por
 * separado en la fórmula de costo mensual, una sola vez).
 */

const CODIGO_FACTOR_DOBLE = 'EX001';

export function normalizarCodigoExamen(codigo: string): string {
  return codigo.trim().toUpperCase();
}

/**
 * Factor comercial por código de examen — `EX001` → 2, cualquier otro
 * código (incluido ausente/vacío, p. ej. registros históricos sin
 * `codExamen` verificable) → 1. Nunca infiere el código desde la
 * descripción — solo el código exacto normalizado decide.
 */
export function resolverFactorExamen(codigoExamen: string | null | undefined): number {
  if (!codigoExamen) return 1;
  return normalizarCodigoExamen(codigoExamen) === CODIGO_FACTOR_DOBLE ? 2 : 1;
}

/**
 * Ajuste "CORREGIR PERIODICIDAD DE EXÁMENES MÉDICOS: DE AÑOS A MESES" —
 * Exámenes Médicos maneja su propia periodicidad en MESES
 * (`frecuenciaMeses`), nunca años — a diferencia de Cursos/Vacunas, que
 * conservan `frecAnios` sin cambios (§3 del ajuste: no se reutiliza
 * ambiguamente el mismo campo entre módulos).
 *
 * Compatibilidad histórica (§4): un registro guardado ANTES de este
 * ajuste solo trae `frecAnios` (nunca `frecuenciaMeses`) — se traduce
 * como `frecAnios × 12`, preservando EXACTAMENTE el costo ya calculado
 * para esos registros. Un registro nuevo con `frecuenciaMeses` explícito
 * usa ese valor directamente, sin pasar por años en ningún momento.
 */
export function resolverFrecuenciaMesesExamen(r: { frecAnios?: number; frecuenciaMeses?: number }): number {
  if (r.frecuenciaMeses != null && r.frecuenciaMeses > 0) return r.frecuenciaMeses;
  return (r.frecAnios || 1) * 12;
}

/**
 * Requerimiento 5 (auditoría) — "el valor mes de las vacunas no tiene en
 * cuenta la frecuencia para el cálculo del valor mensual": revierte el
 * ajuste histórico "CURSOS NO SE AMORTIZA" (aplicado también a Vacunas por
 * consistencia) — Vacunas SÍ debe amortizarse por su frecuencia en meses,
 * igual que Exámenes/Cursos. `frecAnios` sigue siendo el campo que
 * almacena la frecuencia (en años, mostrado en la UI como meses =
 * frecAnios×12 — mismo patrón que Cursos). Ejemplo del requerimiento:
 * valor=$180.000, frecuencia=12 meses, dosis=1 → $15.000/mes.
 */
export function resolverValorMensualVacuna(r: { valor: number; cant: number; frecAnios?: number; dosisPorTrabajador?: number | null }): number {
  const dosis = r.dosisPorTrabajador != null ? r.dosisPorTrabajador : r.cant;
  return (r.valor * dosis) / ((r.frecAnios || 1) * 12);
}
