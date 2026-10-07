/**
 * Mismo contrato paginado/deduplicado que /api/dotacion-ext (ver ese
 * archivo de test para la cobertura exhaustiva de la lógica compartida:
 * seleccionarUltimaCompraPorProducto/paginar). Aquí solo se confirma el
 * wiring propio de este endpoint (categoría EPP fija, caché por
 * empresa+uen).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

function stubFetch(datos: Record<string, unknown>[]) {
  const llamada = vi.fn(async () => ({ ok: true, json: async () => ({ data: datos }) }));
  vi.stubGlobal('fetch', llamada);
  return llamada;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('POST /api/epp-ext', () => {
  it('devuelve items/total/page/limit/totalPages paginados', async () => {
    stubFetch([{ codigo: '1', descripcion: 'Guantes', valor: 5000 }, { codigo: '2', descripcion: 'Gafas', valor: 8000 }]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.items).toHaveLength(2);
    expect(d).toMatchObject({ page: 1, limit: 50, total: 2, totalPages: 1 });
  });

  it('una segunda consulta con la misma empresa/uen no repite la llamada externa (caché)', async () => {
    const llamada = stubFetch([{ codigo: '1', descripcion: 'Guantes', valor: 5000 }]);
    const { POST } = await import('./route');
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', q: 'guantes' }) }));
    expect(llamada).toHaveBeenCalledTimes(1);
  });

  it('deduplica productos repetidos (mismo código, distintas filas)', async () => {
    stubFetch([
      { codigo: '9', descripcion: 'Casco', valor: 10000, fecha_ultima_compra: '2026-01-01' },
      { codigo: '9', descripcion: 'Casco', valor: 12000, fecha_ultima_compra: '2026-06-01' },
    ]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    const d = await res.json();
    expect(d.items).toHaveLength(1);
    expect(d.items[0].valor).toBe(12000);
  });

  it('errores de la API externa se devuelven controlados', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    expect(res.status).toBe(502);
  });

  it('9) Ajuste "CÓD. GRUPO" — EPP no trae codgrp (confirmado en el catálogo real); el pipeline no falla ni inventa uno', async () => {
    stubFetch([{ codigo: '1', descripcion: 'Guantes', valor: 5000 }]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.items[0].codgrp).toBeUndefined();
  });
});

describe('Ajuste "CANTIDAD Y FRECUENCIA DE EPP DESDE LA API" — valor de la fila (grupo de EPP), opt-in', () => {
  const pedir = async (cuerpo: Record<string, unknown>) => {
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', ...cuerpo }) }));
    return res.json();
  };
  // Caso real (medido 2026-09-30): el mismo código viene una vez por grupo de EPP y cada grupo trae sus valores.
  const filas18111 = [
    { codigo: '18111', nombre: 'Lente claro seguridad', valor: 2550, codgrp: 'EP001', cantidad: 1, frecuencia: 3, fecha_ultima_compra: '2026-09-14' },
    { codigo: '18111', nombre: 'Lente claro seguridad', valor: 2550, codgrp: 'EP021', cantidad: 1, frecuencia: 6, fecha_ultima_compra: '2026-09-14' },
    { codigo: '18111', nombre: 'Lente claro seguridad', valor: 2550, codgrp: 'EP020', cantidad: 0, frecuencia: 0, fecha_ultima_compra: '2026-09-14' },
    { codigo: '18111', nombre: 'Lente claro seguridad', valor: 2550, codgrp: 'EP115', cantidad: 0, frecuencia: 3, fecha_ultima_compra: '2026-09-14' },
  ];

  it('sin el flag NO agrega campos extra (la tabla genérica de Equipos pinta todas las llaves)', async () => {
    stubFetch([{ codigo: '1', nombre: 'Guantes', valor: 5000, cantidad: 2, frecuencia: 3 }]);
    const d = await pedir({});
    expect(d.items[0].cantidadEstadoApi).toBeUndefined();
    expect(d.items[0].cantidadApi).toBeUndefined();
  });

  it('con el flag, la fila que se muestra lleva los valores de SU grupo — sin búsqueda es el primero que encuentra (EP001 → 1/3)', async () => {
    stubFetch(filas18111);
    const d = await pedir({ resolverCantidadFrecuencia: true });
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ codgrp: 'EP001', cantidadEstadoApi: 'api', cantidadApi: 1, frecuenciaEstadoApi: 'api', frecuenciaApi: 3 });
  });

  it("buscando por el código del grupo, el producto sale con los valores de ESE grupo (EP021 → 1/6)", async () => {
    stubFetch(filas18111);
    const d = await pedir({ q: 'EP021', resolverCantidadFrecuencia: true });
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ codgrp: 'EP021', cantidadApi: 1, frecuenciaApi: 6 });
  });

  it("un grupo con 0/0 sale 'no_definido' en ambos campos (EP020)", async () => {
    stubFetch(filas18111);
    const d = await pedir({ q: 'EP020', resolverCantidadFrecuencia: true });
    expect(d.items[0]).toMatchObject({ codgrp: 'EP020', cantidadEstadoApi: 'no_definido', cantidadApi: 0, frecuenciaEstadoApi: 'no_definido', frecuenciaApi: 0 });
  });

  it('cada campo se resuelve por separado: cantidad sin definir y frecuencia del catálogo (EP115 → 0/3)', async () => {
    stubFetch(filas18111);
    const d = await pedir({ q: 'EP115', resolverCantidadFrecuencia: true });
    expect(d.items[0]).toMatchObject({ codgrp: 'EP115', cantidadEstadoApi: 'no_definido', cantidadApi: 0, frecuenciaEstadoApi: 'api', frecuenciaApi: 3 });
  });

  it('`data` (compatibilidad) lleva los mismos items anotados', async () => {
    stubFetch([{ codigo: '1', nombre: 'Guantes', valor: 5000, cantidad: 2, frecuencia: 3 }]);
    const d = await pedir({ resolverCantidadFrecuencia: true });
    expect(d.data).toEqual(d.items);
  });
});


describe('Ajuste "TRAER EPP POR CÓDIGO DE GRUPO" — codgrp en /api/epp-ext', () => {
  const pedir = async (cuerpo: Record<string, unknown>) => {
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', ...cuerpo }) }));
    return { status: res.status, d: await res.json() };
  };
  const cuerpoDe = (llamada: ReturnType<typeof vi.fn>, n: number) => JSON.parse(String((llamada.mock.calls[n] as unknown as [string, RequestInit])[1]?.body ?? '{}'));
  // Catálogo con dos grupos; el grupo EP001 trae dos tallas de la MISMA familia (deben conservarse ambas).
  const catalogo = [
    { codigo: '10', nombre: 'BOTA SEGURIDAD T.40', valor: 90000, codgrp: 'EP001', cantidad: 1, frecuencia: 12, fecha_ultima_compra: '2026-09-01' },
    { codigo: '11', nombre: 'BOTA SEGURIDAD T.41', valor: 90000, codgrp: 'EP001', cantidad: 1, frecuencia: 12, fecha_ultima_compra: '2026-09-01' },
    { codigo: '20', nombre: 'LENTE CLARO', valor: 2550, codgrp: 'EP001', cantidad: 2, frecuencia: 3, fecha_ultima_compra: '2026-09-01' },
    { codigo: '20', nombre: 'LENTE CLARO', valor: 2550, codgrp: 'EP021', cantidad: 1, frecuencia: 6, fecha_ultima_compra: '2026-09-01' },
    { codigo: '30', nombre: 'GUANTE', valor: 500, codgrp: 'EP021', cantidad: 0, frecuencia: 0, fecha_ultima_compra: '2026-09-01' },
    { codigo: '40', nombre: 'SIN GRUPO', valor: 700, codgrp: '', cantidad: 1, frecuencia: 1 },
  ];
  // Origen que SÍ filtra por codgrp (como dotación).
  const origenQueFiltra = () => {
    const llamada = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const c = JSON.parse(String(init?.body ?? '{}'));
      const datos = c.codgrp ? catalogo.filter(r => r.codgrp === c.codgrp) : catalogo;
      return { ok: true, json: async () => ({ data: datos }) };
    });
    vi.stubGlobal('fetch', llamada);
    return llamada;
  };
  const codigosDe = (d: { items: { codigo: string }[] }) => d.items.map(i => i.codigo).sort();

  it('trae SOLO los productos del grupo (exacto, sin distinguir mayúsculas) y conserva las tallas de la misma familia', async () => {
    stubFetch(catalogo);
    const { d } = await pedir({ codgrp: 'ep001', resolverCantidadFrecuencia: true });
    expect(codigosDe(d)).toEqual(['10', '11', '20']);
    expect(d.total).toBe(3);
  });

  it('cada producto lleva los valores de ESE grupo (LENTE: EP001 → 2/3, EP021 → 1/6)', async () => {
    stubFetch(catalogo);
    const a = (await pedir({ codgrp: 'EP001', resolverCantidadFrecuencia: true })).d.items.find((i: { codigo: string }) => i.codigo === '20');
    expect(a).toMatchObject({ cantidadApi: 2, frecuenciaApi: 3 });
    vi.resetModules();
    stubFetch(catalogo);
    const b = (await pedir({ codgrp: 'EP021', resolverCantidadFrecuencia: true })).d.items.find((i: { codigo: string }) => i.codigo === '20');
    expect(b).toMatchObject({ cantidadApi: 1, frecuenciaApi: 6 });
  });

  it("un producto del grupo con 0/0 sale 'no_definido'", async () => {
    stubFetch(catalogo);
    const { d } = await pedir({ codgrp: 'EP021', resolverCantidadFrecuencia: true });
    expect(d.items.find((i: { codigo: string }) => i.codigo === '30')).toMatchObject({ cantidadEstadoApi: 'no_definido', frecuenciaEstadoApi: 'no_definido' });
  });

  it('un grupo inexistente devuelve ok con lista vacía', async () => {
    stubFetch(catalogo);
    const { status, d } = await pedir({ codgrp: 'EP999' });
    expect(status).toBe(200);
    expect(d).toMatchObject({ ok: true, total: 0, items: [] });
  });

  it('un codgrp con formato inválido se rechaza con 400 y NUNCA se reenvía al origen', async () => {
    const llamada = stubFetch(catalogo);
    const { status, d } = await pedir({ codgrp: 'M001' });
    expect(status).toBe(400);
    expect(d.ok).toBe(false);
    expect(llamada).not.toHaveBeenCalled();
  });

  it('sin codgrp (vacío o ausente) no filtra y sigue consolidando por familias como siempre', async () => {
    stubFetch(catalogo);
    const { d } = await pedir({ codgrp: '   ' });
    const codigos = d.items.map((i: { codigo: string }) => i.codigo);
    expect(codigos).toContain('40');
    // Las dos tallas de bota colapsan en UNA familia sin grupo.
    expect(codigos.filter((c: string) => c === '10' || c === '11')).toHaveLength(1);
  });

  it('con la caché fría pide SOLO ese grupo al origen (atajo ~0,3 s)', async () => {
    const llamada = origenQueFiltra();
    await pedir({ codgrp: 'EP021' });
    expect(llamada).toHaveBeenCalledTimes(1);
    expect(cuerpoDe(llamada, 0)).toEqual({ empresa: 'aseo', uen: 'BAQ', codgrp: 'EP021' });
  });

  it('el subconjunto de UN grupo NO se guarda en la caché compartida: otro grupo vuelve a consultar y el catálogo completo sigue completo', async () => {
    const llamada = origenQueFiltra();
    await pedir({ codgrp: 'EP021' });
    await pedir({ codgrp: 'EP001' });
    expect(llamada).toHaveBeenCalledTimes(2);
    // Una consulta sin grupo pide el catálogo COMPLETO (no el subconjunto de EP001).
    const { d } = await pedir({});
    expect(d.items.map((i: { codigo: string }) => i.codigo)).toContain('40');
    expect(cuerpoDe(llamada, 2)).toEqual({ empresa: 'aseo', uen: 'BAQ' });
  });

  it('si el origen aún NO filtra por codgrp y devuelve todo, el resultado sigue siendo solo el grupo pedido y el catálogo completo se cachea', async () => {
    const relleno = Array.from({ length: 60 }, (_, i) => ({ codigo: `R${i}`, nombre: `Relleno ${i}`, valor: 100, codgrp: i % 2 ? 'EP100' : 'EP200' }));
    const llamada = stubFetch([...catalogo, ...relleno]);
    const a = await pedir({ codgrp: 'EP021' });
    expect(codigosDe(a.d)).toEqual(['20', '30']);
    await pedir({ codgrp: 'EP001' });
    expect(llamada).toHaveBeenCalledTimes(1); // la segunda salió de la caché
  });

  it('si el origen falla al pedir el grupo, cae al catálogo completo y filtra en local', async () => {
    let n = 0;
    const llamada = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const c = JSON.parse(String(init?.body ?? '{}'));
      if (c.codgrp && n++ === 0) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => ({ data: catalogo }) };
    });
    vi.stubGlobal('fetch', llamada);
    const { status, d } = await pedir({ codgrp: 'EP021' });
    expect(status).toBe(200);
    expect(codigosDe(d)).toEqual(['20', '30']);
    expect(llamada).toHaveBeenCalledTimes(2);
  });
});

describe('Ajuste "FILTRO DE EMPRESA EN DOTACIÓN/EPP DEBE SER AUTOMÁTICO" §5 — empresa obligatoria, sin excepción', () => {
  it('empresa ausente se rechaza con 400, sin llamar a la API externa (nunca "Todos")', async () => {
    const llamada = stubFetch([{ codigo: '1', descripcion: 'Guantes', valor: 5000 }]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ uen: 'BAQ' }) }));
    expect(res.status).toBe(400);
    const d = await res.json();
    expect(d.ok).toBe(false);
    expect(llamada).not.toHaveBeenCalled();
  });

  it('empresa vacía se rechaza igual que ausente', async () => {
    const llamada = stubFetch([{ codigo: '1', descripcion: 'Guantes', valor: 5000 }]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: '', uen: 'BAQ' }) }));
    expect(res.status).toBe(400);
    expect(llamada).not.toHaveBeenCalled();
  });

  it('un código de empresa no reconocido (ni aseo/tempo/vigi) se rechaza — nunca se reenvía tal cual a la API externa', async () => {
    const llamada = stubFetch([{ codigo: '1', descripcion: 'Guantes', valor: 5000 }]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'otraempresa', uen: 'BAQ' }) }));
    expect(res.status).toBe(400);
    expect(llamada).not.toHaveBeenCalled();
  });

  it('una consulta con empresa=vigi NUNCA incluye productos de aseo/tempo — la petición externa solo pide la combinación vigi+uen', async () => {
    const llamada = stubFetch([{ codigo: 'V1', descripcion: 'Casco Vigicolba', valor: 20000 }]);
    const { POST } = await import('./route');
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ' }) }));
    expect(llamada).toHaveBeenCalledTimes(1);
    const cuerpo = JSON.parse(String((llamada.mock.calls[0] as unknown as [string, RequestInit])[1]?.body ?? '{}'));
    expect(cuerpo).toEqual({ empresa: 'vigi', uen: 'BAQ' });
  });
});
