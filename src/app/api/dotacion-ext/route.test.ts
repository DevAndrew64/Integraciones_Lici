/**
 * Ajuste "OPTIMIZAR VELOCIDAD DEL CATÁLOGO" — /api/dotacion-ext ahora
 * filtra por categoría, deduplica (última compra) y pagina en el
 * servidor, con caché en memoria por combinación empresa+uen (evita
 * repetir la consulta lenta a la API externa en cada apertura del modal).
 * `global.fetch` se reemplaza en cada prueba — nunca golpea la red real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const FILA_MASCULINA = { codigo: '06001', codgrp: 'M013', descripcion: 'Pantalón para caballero', valor: 85000, fecha_ultima_compra: '2026-06-15' };
const FILA_FEMENINA = { codigo: '06002', codgrp: 'F001', descripcion: 'Blusa para dama', valor: 60000, fecha_ultima_compra: '2026-06-10' };
const FILA_DUPLICADA_1 = { codigo: '06009', codgrp: 'F001', descripcion: 'Cofia genérica', valor: 7017, fecha_ultima_compra: '2026-01-01' };
const FILA_DUPLICADA_2 = { codigo: '06009', codgrp: 'F002', descripcion: 'Cofia genérica', valor: 7017, fecha_ultima_compra: '2026-07-30' };

function stubFetch(datos: Record<string, unknown>[]) {
  const llamada = vi.fn(async () => ({ ok: true, json: async () => ({ data: datos }) }));
  vi.stubGlobal('fetch', llamada);
  return llamada;
}

/** Cuerpos JSON enviados a la API externa, en orden de llamada. */
function cuerposEnviados(llamada: ReturnType<typeof stubFetch>): Record<string, unknown>[] {
  return (llamada.mock.calls as unknown as [string, RequestInit][]).map(c => JSON.parse(String(c[1]?.body ?? '{}')));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('POST /api/dotacion-ext', () => {
  it('2/3) filtra por categoría en el servidor — masculina nunca recibe registros femeninos', async () => {
    stubFetch([FILA_MASCULINA, FILA_FEMENINA]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', categoria: 'DOTACION_MASCULINA' }) }));
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.items).toHaveLength(1);
    expect(d.items[0].codigo).toBe('06001');
  });

  it('1/4) la respuesta nunca trae más de `limit` filas ni el catálogo completo', async () => {
    const muchos = Array.from({ length: 200 }, (_, i) => ({ codigo: `P${i}`, descripcion: `Pantalón para caballero modelo ${i}`, valor: 1000 + i, fecha_ultima_compra: '2026-01-01' }));
    stubFetch(muchos);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', limit: 50, page: 1 }) }));
    const d = await res.json();
    expect(d.items.length).toBeLessThanOrEqual(50);
    expect(d.total).toBe(200);
    expect(d.totalPages).toBe(4);
  });

  it('9) una segunda consulta con la MISMA empresa/uen dentro del TTL no vuelve a llamar a fetch (caché de servidor)', async () => {
    // Ajuste "OJO ESTÁS AJUSTANDO UNA Y SE DESCONFIGURA LA OTRA" — el caché
    // ya NUNCA guarda respuestas sospechosamente pequeñas (>50 filas,
    // mismo umbral que protege contra el envenenamiento por una consulta
    // con codgrp); el fixture debe reflejar un catálogo real, no una sola
    // fila, para seguir probando el camino de caché normal.
    const muchos = Array.from({ length: 100 }, (_, i) => ({ codigo: `P${i}`, codgrp: 'M013', descripcion: `Pantalón ${i}`, valor: 1000 + i, fecha_ultima_compra: '2026-01-01' }));
    const llamada = stubFetch(muchos);
    const { POST } = await import('./route');
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', q: 'pantalon' }) }));
    expect(llamada).toHaveBeenCalledTimes(1);
  });

  it('el caché NUNCA guarda una respuesta sospechosamente pequeña (≤50 filas) — evita que una consulta con codgrp "envenene" el catálogo completo para las demás categorías', async () => {
    const llamada = stubFetch([FILA_MASCULINA]);
    const { POST } = await import('./route');
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', codgrp: 'M013' }) }));
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', categoria: 'DOTACION_FEMENINA' }) }));
    expect(llamada).toHaveBeenCalledTimes(2);
  });

  it('la petición externa que alimenta el caché NUNCA incluye sexo/codgrp en el cuerpo (esos filtros ocurren después, sobre los datos ya cacheados)', async () => {
    const llamada = stubFetch([FILA_MASCULINA, FILA_FEMENINA]);
    const { POST } = await import('./route');
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', sexo: 'M', categoria: 'DOTACION_MASCULINA' }) }));
    expect(cuerposEnviados(llamada)).toEqual([{ empresa: 'aseo', uen: 'BAQ' }]);
  });

  describe('atajo por código de grupo con la caché fría (medido 2026-09-29: ~0,3 s vs ~20-30 s)', () => {
    const catalogoGrande = Array.from({ length: 100 }, (_, i) => ({ codigo: `P${i}`, codgrp: i % 2 ? 'M013' : 'F001', descripcion: `Producto ${i}`, valor: 1000 + i, fecha_ultima_compra: '2026-01-01' }));

    it('un código real con la caché fría se pide al origen con codgrp (recortado) y NUNCA con sexo', async () => {
      const llamada = stubFetch([FILA_MASCULINA]);
      const { POST } = await import('./route');
      const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', sexo: 'M', categoria: 'DOTACION_MASCULINA', codgrp: ' M013 ' }) }));
      const d = await res.json();
      expect(cuerposEnviados(llamada)).toEqual([{ empresa: 'aseo', uen: 'BAQ', codgrp: 'M013' }]);
      expect(d.items.map((i: Record<string, unknown>) => i.codigo)).toEqual(['06001']);
    });

    it('el subconjunto del atajo JAMÁS envenena la caché — la siguiente consulta sin codgrp trae el catálogo completo del origen', async () => {
      // Aun con >50 filas (que sí serían cacheables), el atajo no debe guardar nada.
      const llamada = stubFetch(catalogoGrande);
      const { POST } = await import('./route');
      await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', codgrp: 'M013' }) }));
      await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', categoria: 'DOTACION_FEMENINA' }) }));
      expect(cuerposEnviados(llamada)).toEqual([{ empresa: 'aseo', uen: 'BAQ', codgrp: 'M013' }, { empresa: 'aseo', uen: 'BAQ' }]);
    });

    it('con la caché tibia un código de grupo se filtra en local — no vuelve a llamar al origen', async () => {
      const llamada = stubFetch(catalogoGrande);
      const { POST } = await import('./route');
      await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
      const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', codgrp: 'M013' }) }));
      const d = await res.json();
      expect(llamada).toHaveBeenCalledTimes(1);
      expect(d.items.length).toBeGreaterThan(0);
      expect(d.items.every((i: Record<string, unknown>) => i.codgrp === 'M013')).toBe(true);
    });

    it('el filtro local se reafirma: si el origen ignorara codgrp y devolviera todo, el resultado sigue siendo solo ese grupo', async () => {
      stubFetch(catalogoGrande);
      const { POST } = await import('./route');
      const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', codgrp: 'F001', limit: 200 }) }));
      const d = await res.json();
      expect(d.items.length).toBeGreaterThan(0);
      expect(d.items.every((i: Record<string, unknown>) => i.codgrp === 'F001')).toBe(true);
    });

    it('"SIN GRUPO" y el campo vacío NO usan el atajo — piden el catálogo completo {empresa,uen}', async () => {
      const llamada = stubFetch(catalogoGrande);
      const { POST } = await import('./route');
      await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', codgrp: 'SIN GRUPO' }) }));
      expect(cuerposEnviados(llamada)).toEqual([{ empresa: 'aseo', uen: 'BAQ' }]);
      vi.unstubAllGlobals();
      vi.resetModules();
      const llamada2 = stubFetch(catalogoGrande);
      const { POST: POST2 } = await import('./route');
      await POST2(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', codgrp: '   ' }) }));
      expect(cuerposEnviados(llamada2)).toEqual([{ empresa: 'aseo', uen: 'BAQ' }]);
    });

    it('si el origen falla al recibir codgrp, cae al catálogo completo y responde normal (sin 502)', async () => {
      const llamada = vi.fn(async (_url: string, init: RequestInit) => {
        if ('codgrp' in JSON.parse(String(init.body))) throw new Error('timeout');
        return { ok: true, json: async () => ({ data: [FILA_MASCULINA, FILA_FEMENINA] }) };
      });
      vi.stubGlobal('fetch', llamada);
      const { POST } = await import('./route');
      const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', codgrp: 'M013' }) }));
      const d = await res.json();
      expect(res.status).toBe(200);
      expect(d.items.map((i: Record<string, unknown>) => i.codigo)).toEqual(['06001']);
      expect(llamada).toHaveBeenCalledTimes(2);
    });

    it('sin UEN, cada UEN se pide con su propio codgrp (el origen exige uen)', async () => {
      const llamada = stubFetch([FILA_MASCULINA]);
      const { POST } = await import('./route');
      await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', codgrp: 'M013' }) }));
      expect(cuerposEnviados(llamada)).toEqual([
        { empresa: 'aseo', uen: 'BAQ', codgrp: 'M013' },
        { empresa: 'aseo', uen: 'BOG', codgrp: 'M013' },
        { empresa: 'aseo', uen: 'MIN', codgrp: 'M013' },
      ]);
    });
  });

  it('16) el servidor deduplica ANTES de paginar — el mismo producto (codigo repetido, distinto codgrp) nunca aparece dos veces', async () => {
    stubFetch([FILA_DUPLICADA_1, FILA_DUPLICADA_2]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    const d = await res.json();
    expect(d.items).toHaveLength(1);
    expect(d.items[0].valor).toBe(7017);
    expect(d.items[0].fecha_ultima_compra).toBe('2026-07-30');
    expect(d.total).toBe(1);
  });

  it('Ajuste "UNA SOLA VARIANTE POR FAMILIA" — las tallas de un mismo producto se consolidan en una sola familia (gana el mayor valor vigente), antes de paginar', async () => {
    const tallas = ['36', '37', '38', '39', '40', '41', '42', '43'].map((t, i) => ({
      codigo: `0606${i}`, descripcion: `BOTA CUERO SEGURIDAD T. ${t}`,
      valor: t === '38' ? 750000 : 500000, fecha_ultima_compra: '2026-01-01',
    }));
    stubFetch(tallas);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    const d = await res.json();
    expect(d.items).toHaveLength(1);
    expect(d.total).toBe(1);
    expect(d.items[0].valor).toBe(750000);
    expect(d.items[0].descripcion).toBe('BOTA CUERO SEGURIDAD T. 38');
  });

  it('17) el backend siempre devuelve total y totalPages junto con items/page/limit', async () => {
    stubFetch([FILA_MASCULINA]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    const d = await res.json();
    expect(d).toMatchObject({ ok: true, page: 1, limit: 50 });
    expect(typeof d.total).toBe('number');
    expect(typeof d.totalPages).toBe('number');
  });

  it('10) solicitar la página 2 devuelve el segundo bloque, sin repetir productos de la página 1', async () => {
    const muchos = Array.from({ length: 120 }, (_, i) => ({ codigo: `P${i}`, descripcion: `Producto ${i}`, valor: 1000, fecha_ultima_compra: '2026-01-01' }));
    stubFetch(muchos);
    const { POST } = await import('./route');
    const r1 = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'tempo', uen: 'BOG', page: 1, limit: 50 }) }))).json();
    const r2 = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'tempo', uen: 'BOG', page: 2, limit: 50 }) }))).json();
    const codigosP1 = new Set(r1.items.map((i: Record<string, unknown>) => i.codigo));
    const codigosP2 = new Set(r2.items.map((i: Record<string, unknown>) => i.codigo));
    expect([...codigosP1].some(c => codigosP2.has(c))).toBe(false);
  });

  it('16) filtro de código de grupo se aplica antes de paginar', async () => {
    stubFetch([
      { codigo: 'A', codgrp: 'F001', valor: 100, fecha_ultima_compra: '2026-01-01' },
      { codigo: 'B', codgrp: 'F002', valor: 100, fecha_ultima_compra: '2026-01-01' },
    ]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', codgrp: 'F001' }) }));
    const d = await res.json();
    expect(d.items).toHaveLength(1);
    expect(d.items[0].codigo).toBe('A');
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

describe('Ajuste "CÓD. GRUPO COMO COLUMNA PRINCIPAL" — codgrp viaja intacto por el pipeline', () => {
  it('3) con "Todos" (sin filtro), cada fila conserva su codgrp real (nunca uno fijo)', async () => {
    stubFetch([FILA_MASCULINA, FILA_FEMENINA]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    const d = await res.json();
    const porCodigo = new Map(d.items.map((i: Record<string, unknown>) => [i.codigo, i.codgrp]));
    expect(porCodigo.get(FILA_MASCULINA.codigo)).toBe(FILA_MASCULINA.codgrp);
    expect(porCodigo.get(FILA_FEMENINA.codigo)).toBe(FILA_FEMENINA.codgrp);
  });

  it('4) al filtrar por F001, todos los resultados corresponden realmente a F001', async () => {
    stubFetch([
      { codigo: 'A', codgrp: 'F001', descripcion: 'Producto A', valor: 100, fecha_ultima_compra: '2026-01-01' },
      { codigo: 'B', codgrp: 'F002', descripcion: 'Producto B', valor: 100, fecha_ultima_compra: '2026-01-01' },
    ]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', codgrp: 'F001' }) }));
    const d = await res.json();
    expect(d.items.every((i: Record<string, unknown>) => i.codgrp === 'F001')).toBe(true);
  });

  it('5) el codgrp mostrado pertenece a la MISMA fila ganadora del mayor valor (nunca el de otra talla/compra)', async () => {
    stubFetch([
      { codigo: '06150', codgrp: 'F002', descripcion: 'BOTA CUERO SEGURIDAD T. 38', valor: 500000, fecha_ultima_compra: '2026-01-01' },
      { codigo: '06151', codgrp: 'F018', descripcion: 'BOTA CUERO SEGURIDAD T. 39', valor: 750000, fecha_ultima_compra: '2026-07-15' },
    ]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    const d = await res.json();
    expect(d.items).toHaveLength(1);
    expect(d.items[0].codigo).toBe('06151');
    expect(d.items[0].codgrp).toBe('F018'); // el de la variante ganadora, no 'F002' de la otra talla
  });

  it('6) la consolidación nunca mezcla el codgrp de una fila con el valor/fecha de otra', async () => {
    // Mismo código, distinto codgrp entre compras — el NIVEL 1 debe traer
    // codgrp/valor/fecha SIEMPRE de la compra más reciente, nunca combinar.
    stubFetch([FILA_DUPLICADA_1, FILA_DUPLICADA_2]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    const d = await res.json();
    expect(d.items[0].codgrp).toBe('F002'); // codgrp de FILA_DUPLICADA_2 (la compra más reciente), no F001
    expect(d.items[0].valor).toBe(7017);
    expect(d.items[0].fecha_ultima_compra).toBe('2026-07-30');
  });

  it('8) un registro sin codgrp conserva el campo ausente (el frontend decide mostrar "Sin grupo", el backend nunca inventa uno)', async () => {
    stubFetch([{ codigo: 'X', descripcion: 'Producto sin grupo', valor: 100, fecha_ultima_compra: '2026-01-01' }]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ' }) }));
    const d = await res.json();
    expect(d.items[0].codgrp).toBeUndefined();
  });

  it('10) la paginación conserva correctamente el codgrp de cada fila en cualquier página', async () => {
    const muchos = Array.from({ length: 120 }, (_, i) => ({ codigo: `P${i}`, codgrp: `G${i % 5}`, descripcion: `Producto ${i}`, valor: 1000, fecha_ultima_compra: '2026-01-01' }));
    stubFetch(muchos);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'MIN', page: 2, limit: 50 }) }));
    const d = await res.json();
    for (const item of d.items) {
      const i = Number(String(item.codigo).replace('P', ''));
      expect(item.codgrp).toBe(`G${i % 5}`);
    }
  });
});

describe('Ajuste "CORREGIR FILTRO DE CÓDIGO DE GRUPO PARA DOTACIÓN MASCULINA" — prefijo M/F obligatorio server-side', () => {
  const CATALOGO_MIXTO = [
    { codigo: '06339', codgrp: 'M013', descripcion: 'CAMISA TIPO POLO', valor: 50000, fecha_ultima_compra: '2026-01-01' },
    { codigo: '06489', codgrp: 'M015', descripcion: 'PANTALONETA CADIS', valor: 30000, fecha_ultima_compra: '2026-01-01' },
    { codigo: '06009', codgrp: 'F001', descripcion: 'COFIA AZUL', valor: 7017, fecha_ultima_compra: '2026-01-01' },
    { codigo: '06612', codgrp: 'F009', descripcion: 'DELANTAL', valor: 12000, fecha_ultima_compra: '2026-01-01' },
  ];

  it('1/3) DOTACION_MASCULINA nunca devuelve grupos F001/F009 — solo M013/M015', async () => {
    stubFetch(CATALOGO_MIXTO);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', categoria: 'DOTACION_MASCULINA' }) }));
    const d = await res.json();
    expect(d.items.map((i: Record<string, unknown>) => i.codgrp).sort()).toEqual(['M013', 'M015']);
  });

  it('DOTACION_FEMENINA nunca devuelve grupos M013/M015 — solo F001/F009', async () => {
    stubFetch(CATALOGO_MIXTO);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', categoria: 'DOTACION_FEMENINA' }) }));
    const d = await res.json();
    expect(d.items.map((i: Record<string, unknown>) => i.codgrp).sort()).toEqual(['F001', 'F009']);
  });

  it('4) campo vacío consulta todos los grupos masculinos (sin codgrp específico)', async () => {
    stubFetch(CATALOGO_MIXTO);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', categoria: 'DOTACION_MASCULINA' }) }));
    const d = await res.json();
    expect(d.items).toHaveLength(2);
  });

  it('5) un código específico (M013) filtra únicamente ese grupo dentro de masculina', async () => {
    stubFetch(CATALOGO_MIXTO);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', categoria: 'DOTACION_MASCULINA', codgrp: 'M013' }) }));
    const d = await res.json();
    expect(d.items.map((i: Record<string, unknown>) => i.codigo)).toEqual(['06339']);
  });

  it('12/13) la consolidación por familia ocurre DESPUÉS del filtro de prefijo — nunca mezcla variantes M y F en la misma familia', async () => {
    const variantesTalla = [
      { codigo: 'A1', codgrp: 'M013', descripcion: 'CAMISA TIPO POLO T. 36', valor: 50000, fecha_ultima_compra: '2026-01-01' },
      { codigo: 'A2', codgrp: 'M013', descripcion: 'CAMISA TIPO POLO T. 38', valor: 55000, fecha_ultima_compra: '2026-01-01' },
      { codigo: 'B1', codgrp: 'F001', descripcion: 'CAMISA TIPO POLO T. 36', valor: 40000, fecha_ultima_compra: '2026-01-01' },
    ];
    stubFetch(variantesTalla);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', categoria: 'DOTACION_MASCULINA' }) }));
    const d = await res.json();
    expect(d.items).toHaveLength(1);
    expect(d.items[0].codgrp).toBe('M013');
    expect(d.items[0].valor).toBe(55000);
  });

  it('15) EPP no aplica ningún filtro de prefijo (la fuente de EPP no trae codgrp)', async () => {
    stubFetch([{ codigo: 'X', descripcion: 'Guantes', valor: 5000, fecha_ultima_compra: '2026-01-01' }]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'aseo', uen: 'BAQ', categoria: 'EPP' }) }));
    const d = await res.json();
    expect(d.items).toHaveLength(1);
  });
});

describe('Corrección "CHAPUZA DESAPARECE PARA VIGICOLBA" — codgrp vacío ya no excluye productos reales', () => {
  // Fixture real medido en vivo contra vigi/BAQ (2026-08-24): 3 filas de
  // CHAPUZA con codgrp vacío que antes desaparecían de AMBAS categorías.
  const CHAPUZAS_VIGICOLBA = [
    { codigo: '07001', codgrp: '', descripcion: 'CHAPUZA CON PORTA BALAS', valor: 23000, fecha_ultima_compra: '2026-06-16' },
    { codigo: '01067', codgrp: '', descripcion: 'CHAPUZA  EN ACERO', valor: 12456, fecha_ultima_compra: '2019-10-18' },
    { codigo: '06006', codgrp: '', descripcion: 'CHAPUZA PARA PISTOLA 9MM', valor: 20000, fecha_ultima_compra: '2026-07-30' },
  ];
  const OTROS_CODGRP_VACIO = [
    { codigo: '01078', codgrp: '', descripcion: 'CAMISA BLANCA GRUPOCOLBA T.M', valor: 45000, fecha_ultima_compra: '2026-01-01' },
    { codigo: '01076', codgrp: '', descripcion: 'BOTAS MEDIA CANA T.45', valor: 60000, fecha_ultima_compra: '2026-01-01' },
  ];
  const CATALOGO_VIGICOLBA_MIXTO = [
    ...CHAPUZAS_VIGICOLBA,
    ...OTROS_CODGRP_VACIO,
    { codigo: 'M1', codgrp: 'M013', descripcion: 'CAMISA TIPO POLO HOMBRE', valor: 50000, fecha_ultima_compra: '2026-01-01' },
    { codigo: 'M2', codgrp: 'M015', descripcion: 'PANTALONETA CADIS', valor: 30000, fecha_ultima_compra: '2026-01-01' },
    { codigo: 'F1', codgrp: 'F001', descripcion: 'COFIA AZUL', valor: 7017, fecha_ultima_compra: '2026-01-01' },
    { codigo: 'F2', codgrp: 'F009', descripcion: 'DELANTAL', valor: 12000, fecha_ultima_compra: '2026-01-01' },
  ];

  it('CHAPUZA llega al resultado de DOTACION_MASCULINA para Vigicolba (antes desaparecía)', async () => {
    stubFetch(CATALOGO_VIGICOLBA_MIXTO);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', categoria: 'DOTACION_MASCULINA' }) }));
    const d = await res.json();
    const codigos = d.items.map((i: Record<string, unknown>) => i.codigo);
    expect(codigos).toContain('07001');
    expect(codigos).toContain('01067');
    expect(codigos).toContain('06006');
  });

  it('CHAPUZA también llega a DOTACION_FEMENINA (DESCONOCIDO conserva la fila en ambas, nunca se inventa un sexo)', async () => {
    stubFetch(CATALOGO_VIGICOLBA_MIXTO);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', categoria: 'DOTACION_FEMENINA' }) }));
    const d = await res.json();
    const codigos = d.items.map((i: Record<string, unknown>) => i.codigo);
    expect(codigos).toContain('07001');
    expect(codigos).toContain('01067');
    expect(codigos).toContain('06006');
  });

  it('las filas con codgrp M013/M015 SIGUEN clasificando únicamente masculino (sin regresión)', async () => {
    stubFetch(CATALOGO_VIGICOLBA_MIXTO);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', categoria: 'DOTACION_FEMENINA' }) }));
    const d = await res.json();
    const codigos = d.items.map((i: Record<string, unknown>) => i.codigo);
    expect(codigos).not.toContain('M1');
    expect(codigos).not.toContain('M2');
  });

  it('las filas con codgrp F001/F009 SIGUEN clasificando únicamente femenino (sin regresión)', async () => {
    stubFetch(CATALOGO_VIGICOLBA_MIXTO);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', categoria: 'DOTACION_MASCULINA' }) }));
    const d = await res.json();
    const codigos = d.items.map((i: Record<string, unknown>) => i.codigo);
    expect(codigos).not.toContain('F1');
    expect(codigos).not.toContain('F2');
  });

  it('no se pierde ninguna de las 5 filas con codgrp vacío al filtrar por DOTACION_MASCULINA — todas + las M reales, ninguna F', async () => {
    stubFetch(CATALOGO_VIGICOLBA_MIXTO);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', categoria: 'DOTACION_MASCULINA' }) }));
    const d = await res.json();
    // 5 filas con codgrp vacío (3 chapuzas + 2 otras) + 2 filas M013/M015 = 7 familias distintas (nombres todos diferentes).
    expect(d.total).toBe(7);
  });

  it('la búsqueda por nombre ("chapuza") sigue encontrando las 3 filas dentro de masculina', async () => {
    stubFetch(CATALOGO_VIGICOLBA_MIXTO);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', categoria: 'DOTACION_MASCULINA', q: 'chapuza' }) }));
    const d = await res.json();
    expect(d.items).toHaveLength(3);
    expect(d.items.map((i: Record<string, unknown>) => i.codigo).sort()).toEqual(['01067', '06006', '07001']);
  });

  it('la búsqueda por código ("07001") sigue encontrando CHAPUZA CON PORTA BALAS dentro de masculina', async () => {
    stubFetch(CATALOGO_VIGICOLBA_MIXTO);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', categoria: 'DOTACION_MASCULINA', q: '07001' }) }));
    const d = await res.json();
    expect(d.items).toHaveLength(1);
    expect(d.items[0].descripcion).toBe('CHAPUZA CON PORTA BALAS');
  });

  it('CHAPUZA nunca aparece duplicada dentro del mismo resultado (una familia por nombre distinto, sin repetir)', async () => {
    stubFetch(CATALOGO_VIGICOLBA_MIXTO);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', categoria: 'DOTACION_MASCULINA' }) }));
    const d = await res.json();
    const codigosChapuza = d.items.map((i: Record<string, unknown>) => i.codigo).filter((c: string) => ['07001', '01067', '06006'].includes(c));
    expect(codigosChapuza).toHaveLength(3); // cada una exactamente una vez, nunca repetida
  });

  it('limpiar filtros (q="" y codgrp="") restaura el catálogo completo — mismo total que la consulta original sin filtros', async () => {
    stubFetch(CATALOGO_VIGICOLBA_MIXTO);
    const { POST } = await import('./route');
    const original = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', categoria: 'DOTACION_MASCULINA' }) }))).json();
    const filtrada = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', categoria: 'DOTACION_MASCULINA', q: 'chapuza' }) }))).json();
    const limpia = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', categoria: 'DOTACION_MASCULINA', q: '', codgrp: '' }) }))).json();
    expect(filtrada.total).toBe(3);
    expect(limpia.total).toBe(original.total);
  });
});

describe('Ajuste "SIN GRUPO" (§6/§7) — filtro especial server-side, en ambos modales', () => {
  const CATALOGO_SIN_GRUPO_MIXTO = [
    { codigo: '07001', codgrp: '', descripcion: 'CHAPUZA CON PORTA BALAS', valor: 23000, fecha_ultima_compra: '2026-06-16' },
    { codigo: '01067', codgrp: '', descripcion: 'CHAPUZA  EN ACERO', valor: 12456, fecha_ultima_compra: '2019-10-18' },
    { codigo: 'M1', codgrp: 'M013', descripcion: 'CAMISA TIPO POLO HOMBRE', valor: 50000, fecha_ultima_compra: '2026-01-01' },
    { codigo: 'F1', codgrp: 'F001', descripcion: 'COFIA AZUL', valor: 7017, fecha_ultima_compra: '2026-01-01' },
  ];

  it('DOTACION_MASCULINA + SIN GRUPO devuelve únicamente los productos sin codgrp (nunca M013)', async () => {
    stubFetch(CATALOGO_SIN_GRUPO_MIXTO);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', categoria: 'DOTACION_MASCULINA', codgrp: 'SIN GRUPO' }) }));
    const d = await res.json();
    const codigos = d.items.map((i: Record<string, unknown>) => i.codigo).sort();
    expect(codigos).toEqual(['01067', '07001']);
  });

  it('DOTACION_FEMENINA + SIN GRUPO devuelve los MISMOS productos sin codgrp (nunca F001)', async () => {
    stubFetch(CATALOGO_SIN_GRUPO_MIXTO);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', categoria: 'DOTACION_FEMENINA', codgrp: 'SIN GRUPO' }) }));
    const d = await res.json();
    const codigos = d.items.map((i: Record<string, unknown>) => i.codigo).sort();
    expect(codigos).toEqual(['01067', '07001']);
  });

  it('SIN GRUPO es insensible a mayúsculas/minúsculas y espacios', async () => {
    stubFetch(CATALOGO_SIN_GRUPO_MIXTO);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', categoria: 'DOTACION_MASCULINA', codgrp: '  sin grupo  ' }) }));
    const d = await res.json();
    expect(d.items).toHaveLength(2);
  });

  it('campo vacío ("") NUNCA se comporta como SIN GRUPO — sigue sin filtrar por grupo (trae M013 también)', async () => {
    stubFetch(CATALOGO_SIN_GRUPO_MIXTO);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', categoria: 'DOTACION_MASCULINA', codgrp: '' }) }));
    const d = await res.json();
    const codigos = d.items.map((i: Record<string, unknown>) => i.codigo).sort();
    expect(codigos).toEqual(['01067', '07001', 'M1']);
  });

  it('SIN GRUPO nunca dispara el error de prefijo M/F — la ruta responde 200 tanto en masculina como en femenina', async () => {
    stubFetch(CATALOGO_SIN_GRUPO_MIXTO);
    const { POST } = await import('./route');
    const resM = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', categoria: 'DOTACION_MASCULINA', codgrp: 'SIN GRUPO' }) }));
    const resF = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ', categoria: 'DOTACION_FEMENINA', codgrp: 'SIN GRUPO' }) }));
    expect(resM.status).toBe(200);
    expect(resF.status).toBe(200);
    expect((await resM.json()).ok).toBe(true);
    expect((await resF.json()).ok).toBe(true);
  });
});

describe('Ajuste "FILTRO DE EMPRESA EN DOTACIÓN/EPP DEBE SER AUTOMÁTICO" §5 — empresa obligatoria, sin excepción', () => {
  it('empresa ausente se rechaza con 400, sin llamar a la API externa (nunca "Todos")', async () => {
    const llamada = stubFetch([FILA_MASCULINA]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ uen: 'BAQ' }) }));
    expect(res.status).toBe(400);
    const d = await res.json();
    expect(d.ok).toBe(false);
    expect(llamada).not.toHaveBeenCalled();
  });

  it('empresa vacía ("Todos", comportamiento retirado) se rechaza igual que ausente', async () => {
    const llamada = stubFetch([FILA_MASCULINA]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: '', uen: 'BAQ' }) }));
    expect(res.status).toBe(400);
    expect(llamada).not.toHaveBeenCalled();
  });

  it('un código de empresa no reconocido (ni aseo/tempo/vigi) se rechaza — nunca se reenvía tal cual a la API externa', async () => {
    const llamada = stubFetch([FILA_MASCULINA]);
    const { POST } = await import('./route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'transcolba', uen: 'BAQ' }) }));
    expect(res.status).toBe(400);
    expect(llamada).not.toHaveBeenCalled();
  });

  it('una consulta con empresa=vigi NUNCA incluye productos de aseo/tempo — la petición externa solo pide la combinación vigi+uen', async () => {
    const llamada = stubFetch([FILA_MASCULINA]);
    const { POST } = await import('./route');
    await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ empresa: 'vigi', uen: 'BAQ' }) }));
    expect(llamada).toHaveBeenCalledTimes(1);
    const cuerpo = JSON.parse(String((llamada.mock.calls[0] as unknown as [string, RequestInit])[1]?.body ?? '{}'));
    expect(cuerpo).toEqual({ empresa: 'vigi', uen: 'BAQ' });
  });
});
