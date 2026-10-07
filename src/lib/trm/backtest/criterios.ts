/**
 * Configuración y validación de criterios de evaluación económica (rangos
 * de decimales 00–99) para el backtest. Puramente determinístico, sin IA.
 *
 * `ConfiguracionCriterioTrm` es genérica a propósito — no asume la tabla
 * estándar de 7 criterios (RANGOS_TRM de @/lib/ponderacion-economica) ni
 * lee/escribe `MetodoPonderacionProceso` (Prisma). Un pliego puede definir
 * cualquier subconjunto de criterios con rangos propios, incluida
 * cobertura parcial de 00–99.
 */

import type { ConfiguracionCriterioTrm, ValidacionConfiguracionCriterios } from './types';

/**
 * Valida una configuración de criterios. Detecta:
 *  - rangos fuera de 00–99;
 *  - desde > hasta;
 *  - solapamientos entre criterios;
 *  - códigos duplicados;
 *  - huecos (si `exigirCoberturaCompleta` es true, un hueco es un error;
 *    si es false/omitido, la cobertura parcial es válida y solo se informa).
 */
export function validarConfiguracionCriterios(
  criterios: ConfiguracionCriterioTrm[],
  opciones: { exigirCoberturaCompleta?: boolean } = {},
): ValidacionConfiguracionCriterios {
  const errores: string[] = [];

  if (!criterios.length) {
    errores.push('La configuración de criterios está vacía.');
  }

  const codigosVistos = new Set<string>();
  for (const c of criterios) {
    if (codigosVistos.has(c.codigo)) {
      errores.push(`Código de criterio duplicado: "${c.codigo}".`);
    }
    codigosVistos.add(c.codigo);

    if (!Number.isInteger(c.desde) || c.desde < 0 || c.desde > 99) {
      errores.push(`Criterio "${c.codigo}": "desde" (${c.desde}) fuera de 00–99.`);
    }
    if (!Number.isInteger(c.hasta) || c.hasta < 0 || c.hasta > 99) {
      errores.push(`Criterio "${c.codigo}": "hasta" (${c.hasta}) fuera de 00–99.`);
    }
    if (Number.isInteger(c.desde) && Number.isInteger(c.hasta) && c.desde > c.hasta) {
      errores.push(`Criterio "${c.codigo}": "desde" (${c.desde}) > "hasta" (${c.hasta}).`);
    }
  }

  // Solapamientos: marca qué criterio cubre cada decimal; si un decimal ya
  // tiene dueño y otro criterio (válido en rango) también lo reclama, hay overlap.
  const dueno = new Array<string | null>(100).fill(null);
  const cubiertos = new Array<boolean>(100).fill(false);
  for (const c of criterios) {
    if (!Number.isInteger(c.desde) || !Number.isInteger(c.hasta)) continue;
    const desde = Math.max(0, Math.min(99, c.desde));
    const hasta = Math.max(0, Math.min(99, c.hasta));
    if (desde > hasta) continue;
    for (let d = desde; d <= hasta; d++) {
      if (dueno[d] !== null && dueno[d] !== c.codigo) {
        errores.push(
          `Solapamiento en el decimal ${String(d).padStart(2, '0')}: criterios "${dueno[d]}" y "${c.codigo}".`,
        );
      }
      dueno[d] = c.codigo;
      cubiertos[d] = true;
    }
  }

  const decimalesSinCubrir: number[] = [];
  for (let d = 0; d < 100; d++) if (!cubiertos[d]) decimalesSinCubrir.push(d);
  const coberturaCompleta = decimalesSinCubrir.length === 0;

  if (opciones.exigirCoberturaCompleta && !coberturaCompleta) {
    errores.push(
      `Cobertura incompleta: ${decimalesSinCubrir.length} decimal(es) sin criterio asignado ` +
        `(se exigió cobertura completa 00–99).`,
    );
  }

  return {
    valida: errores.length === 0,
    errores,
    coberturaCompleta,
    decimalesSinCubrir,
  };
}

/**
 * Código del criterio que contiene `decimal` (0–99), o null si ningún
 * criterio lo cubre (cobertura parcial). Con una configuración validada
 * (sin solapamientos) el resultado es siempre único y determinístico.
 */
export function obtenerCriterioPorDecimal(
  decimal: number,
  criterios: ConfiguracionCriterioTrm[],
): string | null {
  if (!Number.isInteger(decimal) || decimal < 0 || decimal > 99) {
    throw new Error(`Decimal fuera de 00–99: ${decimal}`);
  }
  for (const c of criterios) {
    if (decimal >= c.desde && decimal <= c.hasta) return c.codigo;
  }
  return null;
}

/**
 * Suma la distribución de probabilidad 00–99 por código de criterio.
 * La suma total es 1 si la configuración cubre 00–99 por completo;
 * si la cobertura es parcial, la suma es < 1 (la masa de los decimales
 * sin criterio simplemente no se asigna a ningún código).
 */
export function obtenerDistribucionPorCriterio(
  distribucion00a99: number[],
  criterios: ConfiguracionCriterioTrm[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of criterios) out[c.codigo] = 0;
  for (let d = 0; d < 100; d++) {
    const codigo = obtenerCriterioPorDecimal(d, criterios);
    if (codigo !== null && codigo in out) out[codigo] += distribucion00a99[d] ?? 0;
  }
  return out;
}

/**
 * Estrategia B: código del criterio con mayor masa de probabilidad acumulada.
 * Desempate determinístico: el primer criterio (según el orden del array
 * `criterios`) entre los que empatan en la masa máxima.
 * Devuelve null si `criterios` está vacío.
 */
export function obtenerCriterioPorMayorMasa(
  distribucionPorCriterioCalculada: Record<string, number>,
  criterios: ConfiguracionCriterioTrm[],
): string | null {
  let mejorCodigo: string | null = null;
  let mejorMasa = -Infinity;
  for (const c of criterios) {
    const masa = distribucionPorCriterioCalculada[c.codigo] ?? 0;
    if (masa > mejorMasa) {
      mejorMasa = masa;
      mejorCodigo = c.codigo;
    }
  }
  return mejorCodigo;
}

/** Códigos de criterio ordenados por masa de probabilidad descendente (Top-K de criterios). */
export function ordenarCriteriosPorMasa(
  distribucionPorCriterioCalculada: Record<string, number>,
  criterios: ConfiguracionCriterioTrm[],
): string[] {
  return criterios
    .map(c => c.codigo)
    .sort((a, b) => (distribucionPorCriterioCalculada[b] ?? 0) - (distribucionPorCriterioCalculada[a] ?? 0));
}
