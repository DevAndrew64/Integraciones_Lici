/**
 * Consulta TRM desde datos.gov.co (Superfinanciera vía datos abiertos).
 * Devuelve el valor actual más un mapa de días histórico.
 * No hace ninguna escritura en BD — eso lo hace trmCache.ts.
 */

import type { TrmFetchResult, TrmHistorialEntry } from './types';

const API_URL = 'https://www.datos.gov.co/resource/32sa-8pi3.json';
const FUENTE_URL = `${API_URL}?$order=vigenciahasta DESC`;

interface TrmRow {
  valor: string;
  unidad: string;
  vigenciadesde: string;
  vigenciahasta: string;
}

/**
 * Expande las filas TRM (rangos de vigencia) en un mapa fecha → valor.
 * Procesa de más antiguo a más reciente para que registros nuevos sobrescriban.
 */
function expandirRangos(rows: TrmRow[]): Map<string, number> {
  const dayMap = new Map<string, number>();
  for (const r of [...rows].reverse()) {
    const valor = parseFloat(r.valor);
    if (isNaN(valor)) continue;
    const desde = r.vigenciadesde?.slice(0, 10);
    const hasta = r.vigenciahasta?.slice(0, 10);
    if (!desde || !hasta) continue;
    const d = new Date(desde + 'T12:00:00Z');
    const fin = new Date(hasta + 'T12:00:00Z');
    if (d > fin) continue;
    while (d <= fin) {
      dayMap.set(d.toISOString().slice(0, 10), valor);
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  // Propagar último valor conocido hasta hoy
  if (dayMap.size > 0) {
    const lastKnown = Array.from(dayMap.keys()).sort().at(-1)!;
    const lastValor = dayMap.get(lastKnown)!;
    const today = new Date();
    today.setUTCHours(12, 0, 0, 0);
    const d = new Date(lastKnown + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    while (d <= today) {
      const key = d.toISOString().slice(0, 10);
      if (!dayMap.has(key)) dayMap.set(key, lastValor);
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  return dayMap;
}

/**
 * Fetch principal. Devuelve el valor actual y el historial para los últimos `dias` días.
 */
export async function fetchTrmDatosGov(dias: number = 30): Promise<TrmFetchResult> {
  const limit = Math.ceil(dias * 1.5) + 10;
  const url = `${API_URL}?$limit=${limit}&$order=vigenciahasta%20DESC`;

  let httpStatus: number | undefined;
  let respuestaRaw: string | undefined;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    httpStatus = res.status;

    if (!res.ok) {
      return {
        ok: false,
        httpStatus,
        error: `datos.gov.co HTTP ${res.status}`,
        respuestaRaw: `HTTP ${res.status}`,
      };
    }

    const rows: TrmRow[] = await res.json();
    respuestaRaw = JSON.stringify(rows[0] ?? {}).slice(0, 500);

    if (!rows.length) {
      return { ok: false, httpStatus, error: 'Sin datos en respuesta', respuestaRaw };
    }

    const actual = rows[0];
    const valor = parseFloat(actual.valor);
    if (isNaN(valor)) {
      return { ok: false, httpStatus, error: 'Valor TRM no numérico', respuestaRaw };
    }

    const vigenciaDesde = actual.vigenciadesde?.slice(0, 10);
    const vigenciaHasta = actual.vigenciahasta?.slice(0, 10);

    const dayMap = expandirRangos(rows);
    const historial: TrmHistorialEntry[] = Array.from(dayMap.entries())
      .map(([fecha, v]) => ({ fecha, valor: v }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
      .slice(-dias);

    return {
      ok: true,
      httpStatus,
      valor,
      vigenciaDesde,
      vigenciaHasta,
      historial,
      respuestaRaw,
    };
  } catch (e) {
    return {
      ok: false,
      httpStatus,
      error: e instanceof Error ? e.message : 'Error desconocido en fetch TRM',
      respuestaRaw,
    };
  }
}

export { FUENTE_URL as TRM_DATOS_GOV_URL };