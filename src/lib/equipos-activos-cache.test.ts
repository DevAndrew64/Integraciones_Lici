import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/**
 * Ajuste "DIAGNÓSTICO CATÁLOGO DE SELECCIÓN — SOLO 18 RESULTADOS" — dos
 * hallazgos reales confirmados contra la API externa: (1) `subtipo_activo`
 * puede repetir el mismo `cod_subtipo` con distinta descripción (grupo 004:
 * 382 filas, 217 códigos únicos) — consultar `equipos/obtener` una vez por
 * FILA desperdicia llamadas; (2) los pares que fallan tras reintentos se
 * omiten en silencio del catálogo — ahora se cuentan explícitamente.
 */
describe('obtenerCatalogoConsolidadoEmpresa — deduplicación de pares grupo+subtipo y detección de incompletitud', () => {
  it('no repite equipos/obtener para el mismo cod_grupo+cod_subtipo aunque subtipo_activo lo liste varias veces con descripciones distintas', async () => {
    const llamadasEquipos: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts: { body: string }) => {
      if (url.includes('grupo_activo')) return { ok: true, json: async () => [{ cod_grupo: '004' }] };
      if (url.includes('subtipo_activo')) {
        return {
          ok: true,
          json: async () => [
            { cod_subtipo: '096', descripcion: 'AVISOS PREVENTIVOS' },
            { cod_subtipo: '096', descripcion: 'AVISOS INFORMATIVOS' },
            { cod_subtipo: '097', descripcion: 'OTRO' },
          ],
        };
      }
      if (url.includes('equipos/obtener')) {
        llamadasEquipos.push(opts.body);
        return { ok: true, json: async () => [{ nombre_c: 'X', uen: 'BAQ' }] };
      }
      throw new Error(`URL inesperada: ${url}`);
    }));
    const { obtenerCatalogoConsolidadoEmpresa, invalidarCacheEquiposActivos } = await import('./equipos-activos-cache');
    invalidarCacheEquiposActivos();
    const r = await obtenerCatalogoConsolidadoEmpresa('aseo');
    // Solo 2 pares únicos (004|096 y 004|097), nunca 3 (el subtipo 096 se
    // repitió 2 veces en subtipo_activo con descripciones distintas).
    expect(llamadasEquipos.length).toBe(2);
    expect(r.paresConsultados).toBe(2);
    expect(r.data.length).toBe(2); // un equipo por cada par consultado
    expect(r.incompleto).toBe(false);
    expect(r.paresFallidos).toBe(0);
  });

  it('cuenta y expone los pares que fallan tras reintentos (catálogo incompleto), nunca los oculta', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('grupo_activo')) return { ok: true, json: async () => [{ cod_grupo: '004' }] };
      if (url.includes('subtipo_activo')) return { ok: true, json: async () => [{ cod_subtipo: '096' }, { cod_subtipo: '097' }] };
      if (url.includes('equipos/obtener')) throw new Error('Timeout simulado');
      throw new Error(`URL inesperada: ${url}`);
    }));
    const { obtenerCatalogoConsolidadoEmpresa, invalidarCacheEquiposActivos } = await import('./equipos-activos-cache');
    invalidarCacheEquiposActivos();
    const r = await obtenerCatalogoConsolidadoEmpresa('aseo');
    expect(r.incompleto).toBe(true);
    expect(r.paresFallidos).toBe(2);
    expect(r.paresConsultados).toBe(2);
    expect(r.data).toEqual([]);
  }, 15000);

  it('un grupo cuyo subtipo_activo falla no aporta pares (nada que reintentar a nivel de equipos/obtener) pero SÍ marca incompleto (gruposFallidos), nunca desaparece en silencio', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts: { body: string }) => {
      if (url.includes('grupo_activo')) return { ok: true, json: async () => [{ cod_grupo: '004' }, { cod_grupo: '006' }] };
      if (url.includes('subtipo_activo')) {
        const body = JSON.parse(opts.body);
        if (body.cod_grupo === '006') throw new Error('Timeout simulado en subtipo_activo de 006');
        return { ok: true, json: async () => [{ cod_subtipo: '096' }] };
      }
      if (url.includes('equipos/obtener')) return { ok: true, json: async () => [{ nombre_c: 'X' }] };
      throw new Error(`URL inesperada: ${url}`);
    }));
    const { obtenerCatalogoConsolidadoEmpresa, invalidarCacheEquiposActivos } = await import('./equipos-activos-cache');
    invalidarCacheEquiposActivos();
    const r = await obtenerCatalogoConsolidadoEmpresa('aseo');
    expect(r.gruposFallidos).toBe(1);
    expect(r.incompleto).toBe(true);
    expect(r.paresConsultados).toBe(1); // solo 004|096; 006 no aportó ningún par
    expect(r.data.length).toBe(1);
  }, 15000);

  it('un catálogo sin fallos queda marcado explícitamente como completo (incompleto:false)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('grupo_activo')) return { ok: true, json: async () => [{ cod_grupo: '004' }] };
      if (url.includes('subtipo_activo')) return { ok: true, json: async () => [{ cod_subtipo: '096' }] };
      if (url.includes('equipos/obtener')) return { ok: true, json: async () => [{ nombre_c: 'X' }] };
      throw new Error(`URL inesperada: ${url}`);
    }));
    const { obtenerCatalogoConsolidadoEmpresa, invalidarCacheEquiposActivos } = await import('./equipos-activos-cache');
    invalidarCacheEquiposActivos();
    const r = await obtenerCatalogoConsolidadoEmpresa('aseo');
    expect(r.incompleto).toBe(false);
    expect(r.paresFallidos).toBe(0);
    expect(r.gruposFallidos).toBe(0);
    expect(r.grupoActivoFallido).toBe(false);
  });

  // Ajuste "CATÁLOGO DE MAQUINARIA — RECORRIDO COMPLETO Y SEGURO" §16 —
  // grupo_activo es la RAÍZ del recorrido (empresa → grupo_activo →
  // subtipo_activo → equipos/obtener); antes, si esa única llamada
  // fallaba, la excepción se propagaba sin capturar hasta la ruta HTTP
  // (500 genérico). Ahora se captura igual que las demás etapas.
  it('un fallo en grupo_activo (la raíz del recorrido) NUNCA se propaga como excepción — catálogo vacío pero incompleto:true y grupoActivoFallido:true', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('grupo_activo')) throw new Error('Timeout simulado en grupo_activo');
      throw new Error(`URL inesperada (no debería llamarse subtipo_activo/equipos si grupo_activo falló): ${url}`);
    }));
    const { obtenerCatalogoConsolidadoEmpresa, invalidarCacheEquiposActivos } = await import('./equipos-activos-cache');
    invalidarCacheEquiposActivos();
    const r = await obtenerCatalogoConsolidadoEmpresa('aseo');
    expect(r.grupoActivoFallido).toBe(true);
    expect(r.incompleto).toBe(true);
    expect(r.data).toEqual([]);
    expect(r.paresConsultados).toBe(0);
  }, 15000);
});
