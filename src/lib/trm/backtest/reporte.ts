/**
 * Agregación de PrediccionEvaluada[] en la tabla final por (modelo, horizonte)
 * y su formato imprimible. Sin efectos secundarios (no escribe archivos).
 */

import { crearRng, hashSemilla } from '../arimaBootstrap';
import {
  brierScore,
  distanciaCircularMedia,
  exactCriterio,
  exactDecimal,
  icBootstrapExactDecimal,
  logLoss,
  probabilidadMediaRangoReal,
  topKDecimal,
} from './metricas';
import type {
  ConfiguracionCriterioTrm,
  NombreModeloBacktest,
  PrediccionEvaluada,
  ResultadoModeloHorizonte,
} from './types';

export interface OpcionesReporte {
  /** Corridas de bootstrap para el IC95 de exactDecimal (0 = omitir, más rápido). */
  nBootstrapIC?: number;
  seedIC?: string;
}

/**
 * Agrupa `predicciones` por (modelo, horizonte) y calcula todas las métricas.
 * `criterios` solo se usa para saber si hay que reportar las columnas de
 * criterio/rango (deben venir ya calculadas dentro de cada PrediccionEvaluada).
 */
export function agregarResultados(
  predicciones: PrediccionEvaluada[],
  criterios: ConfiguracionCriterioTrm[] | undefined,
  opciones: OpcionesReporte = {},
): ResultadoModeloHorizonte[] {
  const { nBootstrapIC = 0, seedIC = 'backtest-ic' } = opciones;
  const hayCriterios = !!criterios && criterios.length > 0;

  const grupos = new Map<string, PrediccionEvaluada[]>();
  for (const p of predicciones) {
    const clave = `${p.modelo}::${p.horizonteEventos}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave)!.push(p);
  }

  const salida: ResultadoModeloHorizonte[] = [];
  for (const [clave, grupo] of grupos) {
    const [modelo, horizonteStr] = clave.split('::');
    const horizonteEventos = Number(horizonteStr);

    let exactDecimalIC95 = null;
    if (nBootstrapIC > 0) {
      const rng = crearRng(hashSemilla(`${seedIC}|${clave}`));
      exactDecimalIC95 = icBootstrapExactDecimal(grupo, nBootstrapIC, rng);
    }

    let exactCriterioPorDecimal: number | null = null;
    let exactCriterioPorMasa: number | null = null;
    let probMediaRangoReal: number | null = null;
    let excluidos = 0;
    if (hayCriterios) {
      const rD = exactCriterio(grupo, 'porDecimal');
      const rM = exactCriterio(grupo, 'porMasa');
      const rP = probabilidadMediaRangoReal(grupo);
      exactCriterioPorDecimal = rD.valor;
      exactCriterioPorMasa = rM.valor;
      probMediaRangoReal = rP.valor;
      excluidos = rD.excluidos;
    }

    salida.push({
      modelo: modelo as NombreModeloBacktest,
      horizonteEventos,
      n: grupo.length,
      exactDecimal: exactDecimal(grupo),
      exactDecimalIC95,
      top3Decimal: topKDecimal(grupo, 3),
      top5Decimal: topKDecimal(grupo, 5),
      distCircularMedia: distanciaCircularMedia(grupo),
      brier: brierScore(grupo),
      logLoss: logLoss(grupo),
      exactCriterioPorDecimal,
      exactCriterioPorMasa,
      probabilidadMediaRangoReal: probMediaRangoReal,
      excluidosPorCriterioRealNulo: excluidos,
    });
  }

  // Orden estable: por horizonte, luego por modelo (orden de aparición).
  return salida.sort((a, b) => a.horizonteEventos - b.horizonteEventos || a.modelo.localeCompare(b.modelo));
}

const ORDEN_COL = [
  'Modelo', 'Horiz', 'n', 'ExactDec', 'Top3', 'Top5', 'DistCirc', 'Brier', 'LogLoss',
  'ExactCritDec', 'ExactCritMasa', 'ProbMediaRangoReal',
] as const;

function fmt(v: number | null, decimales = 3): string {
  if (v === null || Number.isNaN(v)) return '—';
  return v.toFixed(decimales);
}

/** Formato de tabla de texto plano (monoespaciado), lista para volcar a consola o archivo. */
export function formatearTabla(resultados: ResultadoModeloHorizonte[]): string {
  const filas = resultados.map(r => [
    r.modelo,
    String(r.horizonteEventos),
    String(r.n),
    fmt(r.exactDecimal),
    fmt(r.top3Decimal),
    fmt(r.top5Decimal),
    fmt(r.distCircularMedia, 2),
    fmt(r.brier, 3),
    fmt(r.logLoss, 3),
    fmt(r.exactCriterioPorDecimal),
    fmt(r.exactCriterioPorMasa),
    fmt(r.probabilidadMediaRangoReal),
  ]);

  const anchos = ORDEN_COL.map((h, i) => Math.max(h.length, ...filas.map(f => f[i].length)));
  const linea = (celdas: string[]) =>
    celdas.map((c, i) => c.padEnd(anchos[i])).join(' | ');

  const lineas = [linea([...ORDEN_COL]), anchos.map(a => '-'.repeat(a)).join('-|-'), ...filas.map(linea)];
  return lineas.join('\n');
}
