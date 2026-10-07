/**
 * Capa de compatibilidad — mantiene los nombres históricos usados por las
 * rutas (`/api/dotacion-ext`, `/api/epp-ext`) y sus pruebas, delegando toda
 * la lógica en el motor GENÉRICO de `normalizador-catalogo.ts` ("CORRECCIÓN
 * DE ENFOQUE — NORMALIZAR TODO EL CATÁLOGO"). No añadir aquí reglas nuevas:
 * cualquier ajuste de normalización va en el motor genérico.
 */
import {
  normalizarTextoProducto,
  extraerTallaProducto,
  expandirAbreviaturasProducto,
  normalizarTokensProducto,
  construirFamiliaKey,
  consolidarCatalogoPorFamilia,
} from './normalizador-catalogo';

/** Normalización de LECTURA (orden original conservado, sin plural/conectores). */
export function normalizarFamiliaProducto(nombre: string): string {
  const normalizado = normalizarTextoProducto(nombre);
  const { textoSinTalla } = extraerTallaProducto(normalizado);
  return expandirAbreviaturasProducto(textoSinTalla);
}

/** Firma canónica ordenada (independiente del orden de palabras) — para agrupar. */
export function construirFirmaFamilia(nombre: string): string {
  const normalizado = normalizarFamiliaProducto(nombre);
  const tokens = normalizarTokensProducto(normalizado).sort();
  return tokens.join('|');
}

export function resolverFamiliaProducto(registro: Record<string, unknown>): string {
  return construirFamiliaKey(registro);
}

export interface ResultadoConsolidacionFamilias<T> {
  familias: T[];
  totalFamilias: number;
}

export function consolidarFamiliasProducto<T extends Record<string, unknown>>(
  registros: readonly T[],
): ResultadoConsolidacionFamilias<T> {
  const r = consolidarCatalogoPorFamilia(registros);
  return { familias: r.familias, totalFamilias: r.totalFamilias };
}
