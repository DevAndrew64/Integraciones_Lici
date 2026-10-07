/**
 * Ajuste "REDISEÑAR MAQUINARIA Y EQUIPOS" — /api/equipos-ext ahora filtra
 * y pagina en el servidor (POST), con caché en memoria (TTL 10 min);
 * conserva el GET plano para el consumidor previo (ModuloEquipos).
 * `global.fetch` se reemplaza en cada prueba — nunca golpea la red real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const FILA_1 = { codigo: 41, codtipo_c: '004', codstipo_c: '048', descripcion: 'ASPIRADORA INDUSTRIAL 1 MOTOR', marca: 'N/A', referencia: 'N/A', serial: 'N/A', vlr_dia: 14227 };
const FILA_2 = { codigo: 46, codtipo_c: '004', codstipo_c: '033', descripcion: 'ESCALERA TIPO TIJERA 12 PASOS', marca: 'N/A', referencia: 'N/A', serial: 'N/A', vlr_dia: 17304 };

function stubFetch(datos: Record<string, unknown>[]) {
  const llamada = vi.fn(async () => ({ ok: true, json: async () => ({ data: datos }) }));
  vi.stubGlobal('fetch', llamada);
  return llamada;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('GET /api/equipos-ext (consumidor previo)', () => {
  it('devuelve el catálogo completo, sin paginar (comportamiento previo preservado)', async () => {
    stubFetch([FILA_1, FILA_2]);
    const { GET } = await import('./route');
    const res = await GET();
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.data).toHaveLength(2);
  });
});

describe('POST /api/equipos-ext (nuevo selector de catálogo)', () => {
  it('conserva la fila completa (código, descripción, marca, vlr_dia)', async () => {
    stubFetch([FILA_1]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({}) }));
    const d = await res.json();
    expect(d.items[0]).toEqual(FILA_1);
  });

  it('la búsqueda filtra por descripción', async () => {
    stubFetch([FILA_1, FILA_2]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ q: 'escalera' }) }));
    const d = await res.json();
    expect(d.items).toHaveLength(1);
    expect(d.items[0].codigo).toBe(46);
  });

  it('pagina en el servidor', async () => {
    const muchos = Array.from({ length: 25 }, (_, i) => ({ codigo: i, descripcion: `Equipo ${i}`, marca: 'N/A', vlr_dia: 1000 }));
    stubFetch(muchos);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ page: 1, limit: 10 }) }));
    const d = await res.json();
    expect(d.items).toHaveLength(10);
    expect(d.total).toBe(25);
    expect(d.totalPages).toBe(3);
  });

  it('GET y POST comparten la misma caché (una sola llamada externa)', async () => {
    const muchos = Array.from({ length: 20 }, (_, i) => ({ codigo: i, descripcion: `Equipo ${i}`, marca: 'N/A', vlr_dia: 1000 }));
    const llamada = stubFetch(muchos);
    const { GET, POST } = await import('./route');
    await GET();
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({}) }));
    expect(llamada).toHaveBeenCalledTimes(1);
  });

  it('errores de la API externa se devuelven controlados, sin caer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({}) }));
    expect(res.status).toBe(502);
    const d = await res.json();
    expect(d.ok).toBe(false);
  });
});
