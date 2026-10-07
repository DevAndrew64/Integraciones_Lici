export type TrmFuente = 'datos_gov_co' | 'superfinanciera_soap' | 'cache';

export interface TrmResponse {
  fecha: string;           // YYYY-MM-DD
  valor: number;
  centavos: number;
  fuente: TrmFuente;
  esOficial: boolean;
  vigenciaDesde?: string;  // YYYY-MM-DD
  vigenciaHasta?: string;  // YYYY-MM-DD
  consultadoEn: string;    // ISO timestamp
  desdeCache: boolean;
  advertencia?: string;
}

export interface TrmHistorialEntry {
  fecha: string;   // YYYY-MM-DD
  valor: number;
}

export interface TrmFetchResult {
  ok: boolean;
  httpStatus?: number;
  valor?: number;
  vigenciaDesde?: string;
  vigenciaHasta?: string;
  historial?: TrmHistorialEntry[];
  error?: string;
  respuestaRaw?: string;
}