/**
 * Ajuste "ACLARACIÓN FUNCIONAL — SÍ EXISTE API REAL DE CURSOS" — misma
 * estrategia de caché en memoria que examenes-cache.ts, con la diferencia
 * de que la fuente exige `empresa` (POST). Cubre: no repetir la llamada
 * externa por empresa ya cacheada, cachés independientes por empresa, y
 * la caché de grupos separada de la de cursos.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

function stubFetch(datos: Record<string, unknown>[] | Record<string, unknown>) {
  const llamada = vi.fn(async () => ({ ok: true, json: async () => datos }));
  vi.stubGlobal('fetch', llamada);
  return llamada;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('obtenerCursos', () => {
  it('una segunda consulta con la misma empresa no repite la llamada externa (caché)', async () => {
    const llamada = stubFetch([{ cod_curso: 'CU001' }]);
    const { obtenerCursos, invalidarCacheCursos } = await import('./cursos-cache');
    invalidarCacheCursos();
    await obtenerCursos('aseo');
    await obtenerCursos('aseo');
    expect(llamada).toHaveBeenCalledTimes(1);
  });

  it('empresas distintas usan cachés independientes (nueva llamada externa cada una)', async () => {
    const llamada = stubFetch([{ cod_curso: 'CU001' }]);
    const { obtenerCursos, invalidarCacheCursos } = await import('./cursos-cache');
    invalidarCacheCursos();
    await obtenerCursos('aseo');
    await obtenerCursos('tempo');
    expect(llamada).toHaveBeenCalledTimes(2);
  });

  it('acepta la respuesta como array plano (formato real confirmado)', async () => {
    stubFetch([{ cod_curso: 'CU001' }, { cod_curso: 'CU002' }]);
    const { obtenerCursos, invalidarCacheCursos } = await import('./cursos-cache');
    invalidarCacheCursos();
    const data = await obtenerCursos('aseo');
    expect(data).toHaveLength(2);
  });

  it('errores de la fuente externa se propagan (nunca catálogo vacío silencioso)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    const { obtenerCursos, invalidarCacheCursos } = await import('./cursos-cache');
    invalidarCacheCursos();
    await expect(obtenerCursos('aseo')).rejects.toThrow();
  });
});

describe('obtenerGruposCursos', () => {
  it('usa una caché separada de obtenerCursos (grupo_cursos es otro endpoint)', async () => {
    const llamada = stubFetch([{ cod_grp: 'GC001', descripcion: 'X' }]);
    const { obtenerCursos, obtenerGruposCursos, invalidarCacheCursos } = await import('./cursos-cache');
    invalidarCacheCursos();
    await obtenerGruposCursos('aseo');
    await obtenerCursos('aseo');
    expect(llamada).toHaveBeenCalledTimes(2);
  });
});

// Ajuste "CURSOS — SOLO FILTROS REALMENTE SOPORTADOS POR LA FUENTE"
// (hallazgo confirmado en vivo) — `obtenerCursos` (sin filtro) queda sin uso
// desde route.ts porque `{empresa}` sola devuelve una muestra parcial
// engañosa. `obtenerCursosFiltrados` es la función que realmente consume el
// endpoint: exige Cód. grupo/Ciudad/NIT proveedor y cachea por la
// combinación exacta de esos 3 + empresa, nunca solo por empresa.
describe('obtenerCursosFiltrados', () => {
  it('exige al menos un filtro soportado (Cód. grupo, Ciudad o NIT proveedor) — nunca consulta la fuente sin ninguno', async () => {
    const llamada = stubFetch([{ cod_curso: 'CU001' }]);
    const { obtenerCursosFiltrados, invalidarCacheCursos } = await import('./cursos-cache');
    invalidarCacheCursos();
    await expect(obtenerCursosFiltrados('aseo', {})).rejects.toThrow();
    expect(llamada).not.toHaveBeenCalled();
  });

  it('envía solo los filtros presentes en el body a la fuente (nunca cod_grp/ciudad/nit_proveedor vacíos)', async () => {
    const llamada = stubFetch([{ cod_curso: 'CU001' }]);
    const { obtenerCursosFiltrados, invalidarCacheCursos } = await import('./cursos-cache');
    invalidarCacheCursos();
    await obtenerCursosFiltrados('aseo', { ciudad: 'barranquilla' });
    const [, opciones] = llamada.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(opciones.body as string);
    expect(body).toEqual({ empresa: 'aseo', ciudad: 'barranquilla' });
  });

  it('una segunda consulta con la MISMA combinación empresa+filtros no repite la llamada externa (caché)', async () => {
    const llamada = stubFetch([{ cod_curso: 'CU001' }]);
    const { obtenerCursosFiltrados, invalidarCacheCursos } = await import('./cursos-cache');
    invalidarCacheCursos();
    await obtenerCursosFiltrados('aseo', { ciudad: 'barranquilla' });
    await obtenerCursosFiltrados('aseo', { ciudad: 'barranquilla' });
    expect(llamada).toHaveBeenCalledTimes(1);
  });

  it('combinaciones distintas de filtros NUNCA comparten caché, aunque la empresa sea la misma', async () => {
    const llamada = stubFetch([{ cod_curso: 'CU001' }]);
    const { obtenerCursosFiltrados, invalidarCacheCursos } = await import('./cursos-cache');
    invalidarCacheCursos();
    await obtenerCursosFiltrados('aseo', { ciudad: 'barranquilla' });
    await expect(obtenerCursosFiltrados('aseo', {})).rejects.toThrow();
    await obtenerCursosFiltrados('aseo', { codGrupo: 'GC029' });
    await obtenerCursosFiltrados('aseo', { codGrupo: 'GC029', ciudad: 'barranquilla' });
    // la llamada sin filtros lanza antes de tocar la caché/fuente — solo
    // cuentan las 3 combinaciones realmente distintas que sí consultan.
    expect(llamada).toHaveBeenCalledTimes(3);
  });

  it('errores de la fuente externa se propagan (nunca catálogo vacío silencioso)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    const { obtenerCursosFiltrados, invalidarCacheCursos } = await import('./cursos-cache');
    invalidarCacheCursos();
    await expect(obtenerCursosFiltrados('aseo', { ciudad: 'barranquilla' })).rejects.toThrow();
  });
});
