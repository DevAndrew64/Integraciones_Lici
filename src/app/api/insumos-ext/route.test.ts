/**
 * Ajuste "REDISEÑAR LA PESTAÑA INSUMOS" — /api/insumos-ext ahora filtra
 * (código/nombre) y pagina en el servidor, con caché en memoria por
 * combinación empresa+uen (mismo TTL/patrón que dotacion-ext/epp-ext).
 * `global.fetch` se reemplaza en cada prueba — nunca golpea la red real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const FILA_1 = { codigo: '11022', nombre: 'ABONO X KILO', undmed: 'KG', undnegocio: 'BAQ', valor: 357 };
const FILA_2 = { codigo: '21664', nombre: 'CODO DE 1 1/2 SANITARIA', undmed: 'UND', undnegocio: 'BAQ', valor: 2856 };

function stubFetch(datos: Record<string, unknown>[]) {
  const llamada = vi.fn(async () => ({ ok: true, json: async () => ({ data: datos }) }));
  vi.stubGlobal('fetch', llamada);
  return llamada;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('POST /api/insumos-ext', () => {
  it('conserva la fila completa del catálogo (código, nombre, unidad, UEN, valor) — nunca inventa campos', async () => {
    stubFetch([FILA_1]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.items[0]).toEqual(FILA_1);
  });

  it('la búsqueda filtra por código', async () => {
    stubFetch([FILA_1, FILA_2]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', q: '11022' }) }));
    const d = await res.json();
    expect(d.items).toHaveLength(1);
    expect(d.items[0].codigo).toBe('11022');
  });

  it('la búsqueda filtra por nombre (insensible a mayúsculas)', async () => {
    stubFetch([FILA_1, FILA_2]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', q: 'codo de' }) }));
    const d = await res.json();
    expect(d.items).toHaveLength(1);
    expect(d.items[0].codigo).toBe('21664');
  });

  it('la paginación devuelve únicamente el límite solicitado, con total/totalPages correctos', async () => {
    const muchos = Array.from({ length: 130 }, (_, i) => ({ codigo: `P${i}`, nombre: `Producto ${i}`, undmed: 'UND', undnegocio: 'BAQ', valor: 1000 + i }));
    stubFetch(muchos);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', page: 1, limit: 50 }) }));
    const d = await res.json();
    expect(d.items).toHaveLength(50);
    expect(d.total).toBe(130);
    expect(d.totalPages).toBe(3);
  });

  it('la página 2 no repite productos de la página 1', async () => {
    const muchos = Array.from({ length: 120 }, (_, i) => ({ codigo: `P${i}`, nombre: `Producto ${i}`, undmed: 'UND', undnegocio: 'BAQ', valor: 1000 }));
    stubFetch(muchos);
    const { POST } = await import('./route');
    const r1 = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'tempo', uen: 'BOG', page: 1, limit: 50 }) }))).json();
    const r2 = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'tempo', uen: 'BOG', page: 2, limit: 50 }) }))).json();
    const codigosP1 = new Set(r1.items.map((i: Record<string, unknown>) => i.codigo));
    const codigosP2 = new Set(r2.items.map((i: Record<string, unknown>) => i.codigo));
    expect([...codigosP1].some(c => codigosP2.has(c))).toBe(false);
  });

  it('una segunda consulta con la misma empresa/uen dentro del TTL no vuelve a llamar a fetch (caché de servidor)', async () => {
    const muchos = Array.from({ length: 30 }, (_, i) => ({ codigo: `P${i}`, nombre: `Producto ${i}`, undmed: 'UND', undnegocio: 'BAQ', valor: 1000 }));
    const llamada = stubFetch(muchos);
    const { POST } = await import('./route');
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', q: 'producto' }) }));
    expect(llamada).toHaveBeenCalledTimes(1);
  });

  it('dos peticiones simultáneas para la misma combinación comparten la misma promesa en curso (no llama fetch dos veces)', async () => {
    const muchos = Array.from({ length: 30 }, (_, i) => ({ codigo: `P${i}`, nombre: `Producto ${i}`, undmed: 'UND', undnegocio: 'BAQ', valor: 1000 }));
    const llamada = stubFetch(muchos);
    const { POST } = await import('./route');
    await Promise.all([
      POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'MIN' }) })),
      POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'MIN' }) })),
    ]);
    expect(llamada).toHaveBeenCalledTimes(1);
  });

  it('el caché nunca guarda una respuesta sospechosamente pequeña (≤20 filas)', async () => {
    const llamada = stubFetch([FILA_1]);
    const { POST } = await import('./route');
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BOG' }) }));
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BOG' }) }));
    expect(llamada).toHaveBeenCalledTimes(2);
  });

  it('el backend siempre devuelve total y totalPages junto con items/page/limit', async () => {
    stubFetch([FILA_1]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    const d = await res.json();
    expect(d).toMatchObject({ ok: true, page: 1, limit: 50 });
    expect(typeof d.total).toBe('number');
    expect(typeof d.totalPages).toBe('number');
  });

  it('errores de la API externa se devuelven controlados, sin caer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    expect(res.status).toBe(502);
    const d = await res.json();
    expect(d.ok).toBe(false);
  });
});

describe('Ajuste "APLICAR LA MISMA LÓGICA DE EMPRESA/PERFIL EN INSUMOS" §5 — empresa obligatoria, sin excepción', () => {
  it('empresa ausente se rechaza con 400, sin llamar a la API externa (nunca "Todos")', async () => {
    const llamada = stubFetch([FILA_1]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ uen: 'BAQ' }) }));
    expect(res.status).toBe(400);
    const d = await res.json();
    expect(d.ok).toBe(false);
    expect(llamada).not.toHaveBeenCalled();
  });

  it('empresa vacía ("Todos", comportamiento retirado) se rechaza igual que ausente', async () => {
    const llamada = stubFetch([FILA_1]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: '', uen: 'BAQ' }) }));
    expect(res.status).toBe(400);
    expect(llamada).not.toHaveBeenCalled();
  });

  it('un código de empresa no reconocido (ni aseo/tempo/vigi) se rechaza — nunca se reenvía tal cual a la API externa', async () => {
    const llamada = stubFetch([FILA_1]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'transcolba', uen: 'BAQ' }) }));
    expect(res.status).toBe(400);
    expect(llamada).not.toHaveBeenCalled();
  });

  it('una consulta con empresa=vigi NUNCA incluye insumos de aseo/tempo — la petición externa solo pide la combinación vigi+uen', async () => {
    const llamada = stubFetch([FILA_1]);
    const { POST } = await import('./route');
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ' }) }));
    expect(llamada).toHaveBeenCalledTimes(1);
    const cuerpo = JSON.parse(String((llamada.mock.calls[0] as unknown as [string, RequestInit])[1]?.body ?? '{}'));
    expect(cuerpo).toEqual({ empresa: 'vigi', uen: 'BAQ' });
  });
});

/**
 * Ajuste "INSUMOS — GRUPO 18 (EPP) SOLO EN SERVICIOS NO CONTINUOS" —
 * diagnóstico en vivo (2026-08-28, aseo/BAQ): `nocontinuo:false`/omitido
 * NUNCA trae códigos de grupo "18" (0/2894); `nocontinuo:true` sí (272/4076,
 * SIEMPRE superset de `false`). Ver `catalogo-insumos-snc.ts` para el
 * diagnóstico completo. Estas pruebas usan datos SINTÉTICOS (nunca golpean
 * la red real) para fijar el CONTRATO del endpoint, no el contenido real
 * del catálogo externo.
 */
describe('Ajuste "INSUMOS — GRUPO 18 (EPP) SOLO EN SERVICIOS NO CONTINUOS"', () => {
  const FILA_18 = { codigo: '18173', nombre: 'ARNEZ 4 ARGOLLAS MULTIPROPOSITO', undmed: 'UND', undnegocio: 'BAQ', valor: 101724 };
  const FILA_01 = { codigo: '01050', nombre: 'GRUPO 01 (SINTETICO — no confirmado en vivo)', undmed: 'UND', undnegocio: 'BAQ', valor: 1000 };

  it('1. Insumos normal (nocontinuo ausente) manda el body de SIEMPRE, sin la clave nocontinuo', async () => {
    const llamada = stubFetch([FILA_1, FILA_2]);
    const { POST } = await import('./route');
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    const cuerpo = JSON.parse(String((llamada.mock.calls[0] as unknown as [string, RequestInit])[1]?.body ?? '{}'));
    expect(cuerpo).toEqual({ empresa: 'aseo', uen: 'BAQ' });
  });

  it('2. Servicios No Continuos (nocontinuo:true) manda nocontinuo:true a la fuente externa', async () => {
    const llamada = stubFetch([FILA_1, FILA_18]);
    const { POST } = await import('./route');
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', nocontinuo: true }) }));
    const cuerpo = JSON.parse(String((llamada.mock.calls[0] as unknown as [string, RequestInit])[1]?.body ?? '{}'));
    expect(cuerpo).toEqual({ empresa: 'aseo', uen: 'BAQ', nocontinuo: true });
  });

  it('3./8. La caché distingue false/true — misma empresa+uen, distinto nocontinuo, dos llamadas reales a la fuente (nunca reutiliza la respuesta del otro contexto)', async () => {
    // >20 filas para que el guard "nunca cachea una respuesta sospechosamente
    // pequeña" (route.ts) permita que la caché entre en juego — igual que la
    // prueba de caché ya existente arriba en este archivo.
    const relleno = Array.from({ length: 25 }, (_, i) => ({ codigo: `P${i}`, nombre: `Producto ${i}`, undmed: 'UND', undnegocio: 'BAQ', valor: 1000 }));
    const llamada = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: relleno }) }) // normal
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [...relleno, FILA_18] }) }); // SNC
    vi.stubGlobal('fetch', llamada);
    const { POST } = await import('./route');

    const rNormal = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }))).json();
    const rSnc = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', nocontinuo: true }) }))).json();

    expect(llamada).toHaveBeenCalledTimes(2); // nunca comparte caché entre false/true
    expect(rNormal.items.some((i: Record<string, unknown>) => i.codigo === '18173')).toBe(false);
    expect(rSnc.items.some((i: Record<string, unknown>) => i.codigo === '18173')).toBe(true);

    // Repetir AMBAS consultas: cada una debe servirse de SU PROPIA entrada
    // de caché (nunca vuelve a llamar a fetch, y nunca mezcla resultados).
    const rNormal2 = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }))).json();
    const rSnc2 = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', nocontinuo: true }) }))).json();
    expect(llamada).toHaveBeenCalledTimes(2);
    expect(rNormal2.items.some((i: Record<string, unknown>) => i.codigo === '18173')).toBe(false);
    expect(rSnc2.items.some((i: Record<string, unknown>) => i.codigo === '18173')).toBe(true);
  });

  it('4. Aseocolba SNC (nocontinuo:true) permite el grupo 18 — el item llega intacto en la respuesta', async () => {
    stubFetch([FILA_1, FILA_18]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', nocontinuo: true }) }));
    const d = await res.json();
    expect(d.items).toContainEqual(FILA_18);
  });

  it('5. Aseocolba SNC sigue excluyendo el grupo 01', async () => {
    stubFetch([FILA_1, FILA_18, FILA_01]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', nocontinuo: true }) }));
    const d = await res.json();
    expect(d.items.some((i: Record<string, unknown>) => i.codigo === '01050')).toBe(false);
    expect(d.items.some((i: Record<string, unknown>) => i.codigo === '18173')).toBe(true); // 18 no se ve afectado por la exclusión de 01
  });

  it('6. Insumos normal (nocontinuo ausente) NO cambia sus reglas: nunca filtra por grupo 01/18 — cualquier fila que la fuente devuelva se conserva tal cual', async () => {
    stubFetch([FILA_1, FILA_01]); // dato sintético: la fuente real no trae "01" con nocontinuo:false, pero el contrato del endpoint no debe filtrarlo si algún día lo hiciera
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    const d = await res.json();
    expect(d.items).toContainEqual(FILA_01); // la exclusión de "01" es EXCLUSIVA del contexto SNC (nocontinuo:true)
  });

  it('7. La exclusión de grupo 01 NUNCA se aplica a Vigicolba (regla exclusiva de Aseocolba)', async () => {
    stubFetch([FILA_1, FILA_01]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', nocontinuo: true }) }));
    const d = await res.json();
    expect(d.items.some((i: Record<string, unknown>) => i.codigo === '01050')).toBe(true);
  });
});
