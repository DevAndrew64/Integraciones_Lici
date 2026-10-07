/**
 * Ajuste "ACLARACIÓN FUNCIONAL — SÍ EXISTE API REAL DE CURSOS" — wiring del
 * endpoint interno /api/cursos: normaliza los nombres reales de la fuente
 * (cod_grp/cod_curso/descrip_curso/...) al contrato interno, filtra en el
 * servidor y nunca inventa fecha ni un solo "valor" (la fuente trae dos:
 * vlr_costo_primera/vlr_costo_reentrena).
 *
 * Ajuste "CURSOS — SOLO FILTROS REALMENTE SOPORTADOS POR LA FUENTE"
 * (hallazgo confirmado en vivo, probando la fuente parámetro por parámetro
 * contra https://grupocolba.com/service/public/api/cursos) — Cód. grupo
 * (cod_grp), Ciudad (ciudad) y NIT proveedor (nit_proveedor) son los ÚNICOS
 * 3 parámetros que la fuente filtra de verdad; `{empresa}` sola devuelve una
 * MUESTRA PARCIAL engañosa. Por eso el endpoint EXIGE al menos uno de los 3
 * antes de llamar a la fuente — todas las pruebas que antes enviaban solo
 * `{empresa}` ahora incluyen uno de esos 3 filtros base.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/session', () => ({
  getSession: async () => ({ id: 1, email: 'admin@grupocolba.com', rol: 'admin', exp: 9999999999, sv: 1, usuario: 'admin.qa' }),
}));

function stubFetch(datos: Record<string, unknown>[]) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => datos })));
}

function mkReq(body: Record<string, unknown>): NextRequest {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const FILAS = [
  { cod_grp: 'GC001', cod_curso: 'CU001', descrip_grp_curso: 'FUNDAMENTOS DE VIGILANCIA', descrip_curso: 'PERSONA AUTORIZADA T.S.A.', codmun: '08001', ciudad: 'BARRANQUILLA', nit_proveedor: '900900379-2', nombre_proveedor: 'SERSO SAS', vlr_costo_reentrena: 85000, vlr_costo_primera: 135000 },
  { cod_grp: 'GC006', cod_curso: 'CU010', descrip_grp_curso: 'ESPACIOS CONFINADOS', descrip_curso: 'VIGIA ESPACIO CONFINADO', codmun: '11001', ciudad: 'BOGOTA', nit_proveedor: '900307735-9', nombre_proveedor: 'SIGPE SAS', vlr_costo_reentrena: 20000, vlr_costo_primera: 57000 },
];

describe('POST /api/cursos', () => {
  it('exige empresa', async () => {
    stubFetch(FILAS);
    const { POST } = await import('./route');
    const res = await POST(mkReq({}));
    expect(res.status).toBe(400);
  });

  it('sin Cód. grupo/Ciudad/NIT proveedor: responde requiereFiltroSoportado sin llamar a la fuente', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => FILAS }));
    vi.stubGlobal('fetch', fetchMock);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo' }));
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.requiereFiltroSoportado).toBe(true);
    expect(d.data).toEqual([]);
    expect(d.total).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin Cód. grupo/Ciudad/NIT proveedor: filtros secundarios solos (codCurso, descripcion, etc.) tampoco disparan la consulta a la fuente', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => FILAS }));
    vi.stubGlobal('fetch', fetchMock);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', codCurso: 'CU001', descripcion: 'VIGIA', q: 'algo' }));
    const d = await res.json();
    expect(d.requiereFiltroSoportado).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normaliza los campos reales de la fuente al contrato interno', async () => {
    stubFetch(FILAS);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', codigoGrupo: 'GC001' }));
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(d.data[0]).toMatchObject({
      codigoGrupo: 'GC001', codigoCurso: 'CU001', descripcionCurso: 'PERSONA AUTORIZADA T.S.A.',
      nitProveedor: '900900379-2', nombreProveedor: 'SERSO SAS', codigoMunicipio: '08001', ciudad: 'BARRANQUILLA',
      valorPrimeraVez: 135000, valorReentrenamiento: 85000, fechaValor: null,
    });
  });

  it('filtra por cod_curso (codCurso), combinado con un filtro base (Cód. grupo)', async () => {
    stubFetch(FILAS);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', codigoGrupo: 'GC006', codCurso: 'CU010' }));
    const d = await res.json();
    expect(d.data).toHaveLength(1);
    expect(d.data[0].codigoCurso).toBe('CU010');
  });

  it('filtra por codigoGrupo (cod_grp) como filtro base', async () => {
    stubFetch(FILAS);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', codigoGrupo: 'GC006' }));
    const d = await res.json();
    expect(d.data).toHaveLength(1);
    expect(d.data[0].codigoGrupo).toBe('GC006');
  });

  it('filtra por nitProveedor como filtro base', async () => {
    stubFetch(FILAS);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', nitProveedor: '900307735-9' }));
    const d = await res.json();
    expect(d.data).toHaveLength(1);
    expect(d.data[0].nitProveedor).toBe('900307735-9');
  });

  it('filtra por codigoMunicipio, combinado con un filtro base (Ciudad)', async () => {
    stubFetch(FILAS);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', ciudad: 'BOGOTA', codigoMunicipio: '11001' }));
    const d = await res.json();
    expect(d.data).toHaveLength(1);
    expect(d.data[0].codigoMunicipio).toBe('11001');
  });

  it('filtra por descripcion (descrip_curso), combinado con un filtro base (Ciudad)', async () => {
    stubFetch(FILAS);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', ciudad: 'BOGOTA', descripcion: 'VIGIA' }));
    const d = await res.json();
    expect(d.data).toHaveLength(1);
  });

  it('nunca inventa una fecha para registros de catálogo', async () => {
    stubFetch(FILAS);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', ciudad: 'BARRANQUILLA' }));
    const d = await res.json();
    expect(d.data.length).toBeGreaterThan(0);
    expect(d.data.every((r: { fechaValor: unknown }) => r.fechaValor === null)).toBe(true);
  });

  it('errores de la fuente externa se controlan (500, nunca 200 con catálogo vacío)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', ciudad: 'BARRANQUILLA' }));
    expect(res.status).toBe(500);
  });
});

describe('Ajuste "CORREGIR KEYS DUPLICADAS EN SELECCIONAR CURSOS" — dedup de filas EXACTAMENTE idénticas, sin tocar ofertas distintas', () => {
  // Caso real confirmado en vivo (grupocolba.com/service/public/api/cursos,
  // empresa=aseo): la fuente repite, byte a byte, la fila
  // GC001|CU001|901481974-1|70001 dos veces.
  const OFERTA_DUPLICADA_EXACTA = { cod_grp: 'GC001', cod_curso: 'CU001', descrip_curso: 'PERSONA AUTORIZADA T.S.A.', codmun: '70001', ciudad: 'SINCELEJO', nit_proveedor: '901481974-1', nombre_proveedor: 'CENTRO DE ENTRENAMIENTO EN TRABAJO EN ESPACIOS CONFINADOS Y', vlr_costo_reentrena: 154000, vlr_costo_primera: 242000 };

  it('dos filas crudas IDÉNTICAS en los 9 campos colapsan a una sola — nunca aparecen ambas', async () => {
    stubFetch([OFERTA_DUPLICADA_EXACTA, { ...OFERTA_DUPLICADA_EXACTA }]);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', ciudad: 'SINCELEJO' }));
    const d = await res.json();
    expect(d.data).toHaveLength(1);
    expect(d.total).toBe(1);
  });

  // Caso real confirmado en vivo: misma fila (grupo/curso/proveedor/
  // municipio/primera vez idénticos) pero con OTRO valor de
  // reentrenamiento — es una oferta legítima distinta, nunca debe
  // colapsar con la anterior.
  const OFERTA_A = { cod_grp: 'GC001', cod_curso: 'CU001', descrip_curso: 'PERSONA AUTORIZADA T.S.A.', codmun: '47001', ciudad: 'SANTA MARTA', nit_proveedor: '900332102-2', nombre_proveedor: 'JFC VERTIKAL SAS', vlr_costo_reentrena: 110000, vlr_costo_primera: 160000 };
  const OFERTA_B_MISMO_TODO_MENOS_REENTRENA = { ...OFERTA_A, vlr_costo_reentrena: 100000 };

  it('dos filas que solo difieren en vlr_costo_reentrena NUNCA se deduplican — son ofertas distintas', async () => {
    stubFetch([OFERTA_A, OFERTA_B_MISMO_TODO_MENOS_REENTRENA]);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', ciudad: 'SANTA MARTA' }));
    const d = await res.json();
    expect(d.data).toHaveLength(2);
    expect(d.total).toBe(2);
    const reentrenas = d.data.map((r: { valorReentrenamiento: number }) => r.valorReentrenamiento).sort();
    expect(reentrenas).toEqual([100000, 110000]);
  });

  it('el dedup ocurre ANTES de paginar — total/totalPages reflejan ofertas reales, nunca filas repetidas de la fuente', async () => {
    stubFetch([OFERTA_A, { ...OFERTA_A }, { ...OFERTA_A }, OFERTA_B_MISMO_TODO_MENOS_REENTRENA]);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', ciudad: 'SANTA MARTA', limit: 50 }));
    const d = await res.json();
    expect(d.total).toBe(2); // OFERTA_A (una vez, aunque se repitió 3 veces) + la oferta con otro reentrenamiento
    expect(d.totalPages).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Ajuste "CIUDAD/VALOR — FILTRAR ANTES DE PAGINAR" — bug real reportado en
// vivo: el contador de "resultados" y la tabla del selector de cursos
// ignoraban coincidencias de Ciudad/Valor fuera de la página ya traída,
// porque ambos se filtraban en el CLIENTE sobre la página ya paginada por
// el backend (empresa=aseo, catálogo real confirmado con 9 filas totales,
// 4 de ellas en BARRANQUILLA — el selector mostraba "9 resultados" en vez
// de "4"). Ciudad y Valor pasan a ser filtros de servidor, en el MISMO
// bloque y ANTES de calcular total/paginar que el resto de filtros ya
// existentes — nunca después.
// ═══════════════════════════════════════════════════════════════════════
describe('Ajuste "CIUDAD/VALOR — FILTRAR ANTES DE PAGINAR"', () => {
  // 7 filas: 4 en BARRANQUILLA repartidas en distintos cod_grp (como el
  // caso real), 3 en otras ciudades — con limit=2 (menor que las 4 de
  // Barranquilla) para demostrar que el total/las filas NUNCA quedan
  // acotados por el tamaño de una sola página. Los 7 comparten el prefijo
  // de NIT '900900379-' — se usa como filtro base "amplio" en los casos que
  // necesitan ver el conjunto completo de las 7 filas.
  const FILAS_CIUDAD = [
    { cod_grp: 'GC029', cod_curso: 'CU004', descrip_grp_curso: 'GRUPO ESPACIO CONFINADO', descrip_curso: 'VIGIA ESPACIOS CONFINADOS', codmun: '08001', ciudad: 'BARRANQUILLA', nit_proveedor: '900900379-2', nombre_proveedor: 'SERSO SAS', vlr_costo_primera: 400000 },
    { cod_grp: 'GC008', cod_curso: 'CU005', descrip_grp_curso: 'PERSONA AUTORIZADA TSA', descrip_curso: 'SUPERVISOR ESPACIOS CONFINADOS', codmun: '08001', ciudad: 'BARRANQUILLA', nit_proveedor: '900900379-3', nombre_proveedor: 'SERSO SAS', vlr_costo_primera: 670000 },
    { cod_grp: 'GC029', cod_curso: 'CU017', descrip_grp_curso: 'GRUPO ESPACIO CONFINADO', descrip_curso: 'RESCATE EN ESPACIO CONFINADO', codmun: '08001', ciudad: 'BARRANQUILLA', nit_proveedor: '900900379-4', nombre_proveedor: 'SERSO SAS', vlr_costo_primera: 280000 },
    { cod_grp: 'GC030', cod_curso: 'CU019', descrip_grp_curso: 'GRUPO ANDAMIERO', descrip_curso: 'ANDAMIERO', codmun: '08001', ciudad: 'BARRANQUILLA', nit_proveedor: '900900379-5', nombre_proveedor: 'SERSO SAS', vlr_costo_primera: 80000 },
    { cod_grp: 'GC001', cod_curso: 'CU001', descrip_grp_curso: 'FUNDAMENTOS DE VIGILANCIA', descrip_curso: 'PERSONA AUTORIZADA T.S.A.', codmun: '11001', ciudad: 'BOGOTA', nit_proveedor: '900900379-6', nombre_proveedor: 'SERSO SAS', vlr_costo_primera: 135000 },
    { cod_grp: 'GC006', cod_curso: 'CU010', descrip_grp_curso: 'ESPACIOS CONFINADOS', descrip_curso: 'VIGIA ESPACIO CONFINADO', codmun: '70001', ciudad: 'SINCELEJO', nit_proveedor: '900900379-7', nombre_proveedor: 'SERSO SAS', vlr_costo_primera: 57000 },
    { cod_grp: 'GC007', cod_curso: 'CU011', descrip_grp_curso: 'OTRO GRUPO', descrip_curso: 'OTRO CURSO', codmun: '47001', ciudad: 'SANTA MARTA', nit_proveedor: '900900379-8', nombre_proveedor: 'SERSO SAS', vlr_costo_primera: 90000 },
  ];

  it('1) hay más coincidencias de Ciudad (4) que el tamaño de una página (limit=2)', async () => {
    stubFetch(FILAS_CIUDAD);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', ciudad: 'barranquilla', limit: 2 }));
    const d = await res.json();
    expect(d.total).toBe(4);
    expect(d.data).toHaveLength(2); // solo la página 1, pero total ya refleja las 4 reales
  });

  it('2/3) Ciudad se filtra ANTES de paginar — total corresponde a TODAS las coincidencias, no solo a data.length', async () => {
    stubFetch(FILAS_CIUDAD);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', ciudad: 'barranquilla', limit: 2 }));
    const d = await res.json();
    expect(d.total).toBe(4);
    expect(d.total).not.toBe(d.data.length);
    expect(d.data.every((r: { ciudad: string }) => r.ciudad === 'BARRANQUILLA')).toBe(true);
  });

  it('4) page 1 contiene solo la primera página (2 de las 4 filas de Barranquilla)', async () => {
    stubFetch(FILAS_CIUDAD);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', ciudad: 'barranquilla', limit: 2, page: 1 }));
    const d = await res.json();
    expect(d.page).toBe(1);
    expect(d.data.map((r: { codigoCurso: string }) => r.codigoCurso)).toEqual(['CU004', 'CU005']);
  });

  it('5) page 2 contiene las siguientes filas de Barranquilla, no las de otras ciudades', async () => {
    stubFetch(FILAS_CIUDAD);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', ciudad: 'barranquilla', limit: 2, page: 2 }));
    const d = await res.json();
    expect(d.page).toBe(2);
    expect(d.data.map((r: { codigoCurso: string }) => r.codigoCurso)).toEqual(['CU017', 'CU019']);
    expect(d.data.every((r: { ciudad: string }) => r.ciudad === 'BARRANQUILLA')).toBe(true);
  });

  it('6) combinar Ciudad + Cód. grupo funciona (intersección real, no solo Ciudad)', async () => {
    stubFetch(FILAS_CIUDAD);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', ciudad: 'barranquilla', codigoGrupo: 'GC029', limit: 30 }));
    const d = await res.json();
    expect(d.total).toBe(2);
    expect(d.data.every((r: { codigoGrupo: string; ciudad: string }) => r.codigoGrupo === 'GC029' && r.ciudad === 'BARRANQUILLA')).toBe(true);
  });

  it('7) combinar Ciudad + búsqueda general (q) funciona', async () => {
    stubFetch(FILAS_CIUDAD);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', ciudad: 'barranquilla', q: 'andamiero', limit: 30 }));
    const d = await res.json();
    expect(d.total).toBe(1);
    expect(d.data[0].codigoCurso).toBe('CU019');
  });

  it('8) sin Ciudad, pero con otro filtro base activo (NIT proveedor amplio): el total refleja lo que la fuente devolvió para ESE filtro, nunca una muestra vacía ni la de otro filtro', async () => {
    stubFetch(FILAS_CIUDAD);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', nitProveedor: '900900379-', limit: 30 }));
    const d = await res.json();
    expect(d.total).toBe(7);
  });

  it('Valor (valorMin/valorMax) también se filtra ANTES de paginar — mismo defecto, mismo cambio (con un filtro base amplio activo)', async () => {
    stubFetch(FILAS_CIUDAD);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', nitProveedor: '900900379-', valorMin: '100000', valorMax: '500000', limit: 2 }));
    const d = await res.json();
    // De las 7 filas, están entre 100.000 y 500.000: CU004(400k), CU017(280k), CU011(90k no), CU010(57k no), CU001(135k) => 3 reales
    expect(d.total).toBe(3);
    expect(d.data).toHaveLength(2);
  });

  it('Ciudad + Valor combinados', async () => {
    stubFetch(FILAS_CIUDAD);
    const { POST } = await import('./route');
    const res = await POST(mkReq({ empresa: 'aseo', ciudad: 'barranquilla', valorMin: '100000', limit: 30 }));
    const d = await res.json();
    // Barranquilla: CU004(400k), CU005(670k), CU017(280k), CU019(80k) — con valorMin=100000 quedan CU004/CU005/CU017
    expect(d.total).toBe(3);
    expect(d.data.map((r: { codigoCurso: string }) => r.codigoCurso).sort()).toEqual(['CU004', 'CU005', 'CU017']);
  });
});
