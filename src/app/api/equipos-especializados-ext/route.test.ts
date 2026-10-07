/**
 * Ajuste "MAQUINARIA Y EQUIPOS SNC — MODELO SERVICIOS ESPECIALIZADOS" —
 * cierre del punto #16 del checklist: prueba DETERMINÍSTICA (sin
 * navegador) de que un fallo de la fuente (`GET equipos/obtener_espec`)
 * produce un error controlado, SIN fallback a `/api/equipos-ext` (POST
 * equipos/obtener, exclusivo del modelo general) y SIN una segunda
 * llamada de red. `global.fetch` se reemplaza en cada prueba — nunca
 * golpea la red real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const FILA_REAL = { codigo: 41, descripcion: 'ASPIRADORA INDUSTRIAL', vlr_dia: 14227, codtipo_c: '004', codstipo_c: '048', sub_tipo: 'ASPIRADORA INDUSTRIAL 1 MOTOR' };
const FILA_SIN_TARIFA = { codigo: 46, descripcion: 'BOMBA SUMERGIBLE DE 3 PULG.', vlr_dia: 0, codtipo_c: '004', codstipo_c: '054', sub_tipo: 'BOMBA SUMERGIBLE 3 IHM - 2.0 HP' };

function stubFetchOk(datos: Record<string, unknown>[]) {
  const llamada = vi.fn(async (_url?: unknown) => ({ ok: true, json: async () => datos }));
  vi.stubGlobal('fetch', llamada);
  return llamada;
}

function stubFetchHttpError(status: number) {
  const llamada = vi.fn(async (_url?: unknown) => ({ ok: false, status, json: async () => ({}) }));
  vi.stubGlobal('fetch', llamada);
  return llamada;
}

function stubFetchThrows() {
  const llamada = vi.fn(async (_url?: unknown) => { throw new Error('fetch failed (network down)'); });
  vi.stubGlobal('fetch', llamada);
  return llamada;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('GET /api/equipos-especializados-ext — camino feliz', () => {
  it('normaliza snake_case → camelCase (codigo/descripcion/subTipo/valorDia/codigoTipo/codigoSubtipo)', async () => {
    const llamada = stubFetchOk([FILA_REAL]);
    const { GET } = await import('./route');
    const res = await GET();
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.data).toEqual([{ codigo: 41, descripcion: 'ASPIRADORA INDUSTRIAL', subTipo: 'ASPIRADORA INDUSTRIAL 1 MOTOR', valorDia: 14227, codigoTipo: '004', codigoSubtipo: '048' }]);
    expect(llamada).toHaveBeenCalledTimes(1);
  });

  it('conserva vlr_dia=0 exacto (nunca lo descarta ni lo convierte)', async () => {
    stubFetchOk([FILA_SIN_TARIFA]);
    const { GET } = await import('./route');
    const res = await GET();
    const d = await res.json();
    expect(d.data[0].valorDia).toBe(0);
  });

  it('llama EXCLUSIVAMENTE a la URL de obtener_espec — nunca a equipos/obtener (modelo general)', async () => {
    const llamada = stubFetchOk([FILA_REAL]);
    const { GET } = await import('./route');
    await GET();
    const urlLlamada = String(llamada.mock.calls[0][0]);
    expect(urlLlamada).toContain('equipos/obtener_espec');
    expect(urlLlamada.endsWith('equipos/obtener')).toBe(false); // nunca el endpoint general
  });
});

describe('GET /api/equipos-especializados-ext — fuente caída (punto #16 del checklist)', () => {
  it('la fuente responde HTTP no-ok (ej. 500) → error controlado 502, SIN datos inventados', async () => {
    stubFetchHttpError(500);
    const { GET } = await import('./route');
    const res = await GET();
    const d = await res.json();
    expect(res.status).toBe(502);
    expect(d.ok).toBe(false);
    expect(d.data).toBeUndefined();
  });

  it('la fuente no responde (fetch lanza, ej. red caída) → mismo error controlado 502', async () => {
    stubFetchThrows();
    const { GET } = await import('./route');
    const res = await GET();
    const d = await res.json();
    expect(res.status).toBe(502);
    expect(d.ok).toBe(false);
    expect(typeof d.error).toBe('string');
  });

  it('tras un fallo, SOLO se intenta la fuente especializada UNA vez — nunca un segundo intento contra otra URL (sin fallback a equipos/obtener)', async () => {
    const llamada = stubFetchHttpError(500);
    const { GET } = await import('./route');
    await GET();
    expect(llamada).toHaveBeenCalledTimes(1);
    const urlLlamada = String(llamada.mock.calls[0][0]);
    expect(urlLlamada).toContain('equipos/obtener_espec');
  });

  it('un fallo de la fuente nunca deja `cacheCatalogo` poblado con datos de una fuente distinta (siguiente llamada reintenta la MISMA fuente, no devuelve un catálogo general)', async () => {
    stubFetchHttpError(500);
    const { GET } = await import('./route');
    const primero = await (await GET()).json();
    expect(primero.ok).toBe(false);
    // Segunda llamada, ahora con la fuente recuperada — debe volver a
    // consultar obtener_espec (no quedó cacheado un fallback).
    const llamadaOk = stubFetchOk([FILA_REAL]);
    const segundo = await (await GET()).json();
    expect(segundo.ok).toBe(true);
    expect(segundo.data[0].codigo).toBe(41);
    expect(String(llamadaOk.mock.calls[0][0])).toContain('equipos/obtener_espec');
  });
});
