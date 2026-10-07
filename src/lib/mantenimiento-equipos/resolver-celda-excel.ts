/**
 * Ajuste "DIAGNOSTICAR E IMPORTAR LA BASE DE TARIFAS DE MANTENIMIENTO DE
 * EQUIPOS" — resolución pura de una celda numérica de ExcelJS. Confirmado
 * en vivo (PLANTILLA COSTO MES MANTTO.xlsx, hoja BAQ, filas 125/218/231/
 * 235): una celda con fórmula real llega como
 * `{formula:'2800000/12', result:233333.33333333334}` (`cell.type===6`,
 * FormulaValue de ExcelJS) — NUNCA como `number` plano. Tratar ese objeto
 * con `Number(valor)` da `NaN`, que el importador interpretaba como
 * "vacío" y rechazaba la fila incorrectamente.
 *
 * Ajuste "RESOLVEDOR DE MANTENIMIENTO — CATÁLOGO MAESTRO" — confirmado
 * en vivo (COSTOS MTTO DE EQUIPOS ACT A 31 DE JULIO 2025.xlsx, columna
 * "valor mes"): la MAYORÍA de las celdas son fórmulas COMPARTIDAS
 * (`{sharedFormula:'F3', result:40000}`, sin la clave `formula`), no solo
 * el patrón `{formula,result}` ya cubierto — mismo caso de fondo (un
 * FormulaValue de ExcelJS con resultado cacheado), así que se detecta por
 * la presencia de `result`, nunca exigiendo `formula` como única señal
 * (eso descartaba silenciosamente ~95% de las filas del maestro).
 *
 * Nunca evalúa el texto de la fórmula (`formula`/`sharedFormula`) — solo
 * lee `result`, el valor YA calculado que Excel dejó cacheado en el
 * archivo. Si no hay `result` numérico, se rechaza explícitamente en vez
 * de intentar evaluar la fórmula (nunca `eval()` ni un motor de fórmulas).
 */

export type ResultadoCeldaExcel =
  | { ok: true; valor: number; formula?: string }
  | { ok: false; vacio: true }
  | { ok: false; vacio: false; motivo: string };

export function resolverValorCeldaNumericaExcel(cellValue: unknown): ResultadoCeldaExcel {
  if (cellValue === null || cellValue === undefined || cellValue === '') {
    return { ok: false, vacio: true };
  }
  if (typeof cellValue === 'number') {
    return isNaN(cellValue) ? { ok: false, vacio: false, motivo: 'Valor numérico inválido (NaN).' } : { ok: true, valor: cellValue };
  }
  if (typeof cellValue === 'string') {
    const n = Number(cellValue.trim());
    return isNaN(n)
      ? { ok: false, vacio: false, motivo: `Texto no numérico: "${cellValue}".` }
      : { ok: true, valor: n };
  }
  if (typeof cellValue === 'object' && cellValue !== null && ('formula' in cellValue || 'sharedFormula' in cellValue)) {
    const obj = cellValue as { formula?: unknown; sharedFormula?: unknown; result?: unknown };
    const formula = typeof obj.formula === 'string' ? obj.formula : (typeof obj.sharedFormula === 'string' ? obj.sharedFormula : undefined);
    if (typeof obj.result === 'number' && !isNaN(obj.result)) {
      return { ok: true, valor: obj.result, formula };
    }
    return { ok: false, vacio: false, motivo: 'Fórmula sin resultado cacheado; el importador no evalúa fórmulas arbitrarias.' };
  }
  return { ok: false, vacio: false, motivo: `Tipo de celda no soportado: ${typeof cellValue}.` };
}
