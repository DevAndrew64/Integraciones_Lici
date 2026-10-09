import { describe, expect, it, vi } from 'vitest';
import { buscarNitEntidadSecop, completarNitEntidad, normalizarNitEntidad } from './nit-entidad';

/** fetch falso: responde según la consulta SoQL y registra las URL pedidas. */
function fetchFalso(responder: (where: string, url: URL) => unknown[] | 'error') {
  const urls: URL[] = [];
  const fn = vi.fn(async (entrada: string) => {
    const url = new URL(entrada);
    urls.push(url);
    const r = responder(url.searchParams.get('$where') ?? '', url);
    if (r === 'error') return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => r };
  });
  return { fn: fn as unknown as typeof fetch, urls };
}

describe('normalizarNitEntidad', () => {
  it('deja la base del NIT: sin puntos, espacios ni dígito de verificación', () => {
    expect(normalizarNitEntidad('830.037.739-1')).toBe('830037739');
    expect(normalizarNitEntidad(' 899999027 ')).toBe('899999027');
    expect(normalizarNitEntidad('ABC')).toBeNull();
    expect(normalizarNitEntidad('123')).toBeNull();
    expect(normalizarNitEntidad(null)).toBeNull();
  });
});

describe('buscarNitEntidadSecop', () => {
  const colegio = { entidad: 'Colegio Veintiún Ángeles', codigoProceso: "P.31-2026 O'NEIL", aliasFuente: 'S2' };

  it('SECOP II: primero por la referencia del proceso y la entidad (comillas escapadas)', async () => {
    const f = fetchFalso(() => [{ nit_entidad: '830037739' }]);
    expect(await buscarNitEntidadSecop(colegio, f.fn)).toEqual({ nit: '830037739', fuente: 'SECOP II', criterio: 'proceso' });
    expect(f.urls[0].pathname).toBe('/resource/p6dx-8zbt.json');
    expect(f.urls[0].searchParams.get('$where')).toBe("referencia_del_proceso='P.31-2026 O''NEIL' AND upper(entidad)='COLEGIO VEINTIÚN ÁNGELES'");
  });

  it('si el proceso no aparece, por la entidad, solo si todas sus filas tienen el mismo NIT', async () => {
    const uno = fetchFalso((w) => (w.startsWith('referencia') ? [] : [{ nit_entidad: '830037739' }]));
    expect(await buscarNitEntidadSecop(colegio, uno.fn)).toEqual({ nit: '830037739', fuente: 'SECOP II', criterio: 'entidad' });
    expect(uno.urls[1].searchParams.get('$group')).toBe('nit_entidad');

    const dos = fetchFalso((w) => (w.startsWith('referencia') ? [] : [{ nit_entidad: '830037739' }, { nit_entidad: '900111222' }]));
    expect(await buscarNitEntidadSecop(colegio, dos.fn)).toBeNull();
  });

  it('SECOP I usa su propio conjunto de datos y columnas', async () => {
    const f = fetchFalso(() => [{ nit_de_la_entidad: '891855735' }]);
    expect(await buscarNitEntidadSecop({ entidad: 'Alcaldía de Mongua', codigoProceso: 'CD-1', aliasFuente: 'S1' }, f.fn)).toEqual({ nit: '891855735', fuente: 'SECOP I', criterio: 'proceso' });
    expect(f.urls[0].pathname).toBe('/resource/f789-7hwg.json');
    expect(f.urls[0].searchParams.get('$where')).toContain("numero_de_proceso='CD-1'");
  });

  it('sin fuente pública (privado o manual), sin entidad, o si SECOP falla: null, nunca un NIT inventado', async () => {
    const f = fetchFalso(() => [{ nit_entidad: '830037739' }]);
    expect(await buscarNitEntidadSecop({ entidad: 'COOPIDROGAS', codigoProceso: 'X', aliasFuente: 'NC' }, f.fn)).toBeNull();
    expect(await buscarNitEntidadSecop({ entidad: '', codigoProceso: 'X', aliasFuente: 'S2' }, f.fn)).toBeNull();
    expect(f.urls).toHaveLength(0);
    expect(await buscarNitEntidadSecop(colegio, fetchFalso(() => 'error').fn)).toBeNull();
    const lanza = vi.fn(async () => { throw new Error('sin red'); }) as unknown as typeof fetch;
    expect(await buscarNitEntidadSecop(colegio, lanza)).toBeNull();
  });

  it('un enlace de community.secop.gov.co cuenta como SECOP II aunque falte el alias', async () => {
    const f = fetchFalso(() => [{ nit_entidad: '830037739' }]);
    expect((await buscarNitEntidadSecop({ entidad: 'X', codigoProceso: null, aliasFuente: null, linkSecop: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.1' }, f.fn))?.fuente).toBe('SECOP II');
  });
});

describe('completarNitEntidad', () => {
  function dbFalsa(fila: Record<string, unknown> | null) {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    return { db: { solicitud: { findUnique: vi.fn(async () => fila), updateMany } }, updateMany };
  }

  it('si ya tiene NIT no consulta SECOP ni escribe', async () => {
    const { db, updateMany } = dbFalsa({ nitContacto: '900123456', entidad: 'X', codigoProceso: 'P', aliasFuente: 'S2', linkSecop: null });
    const f = fetchFalso(() => []);
    expect(await completarNitEntidad(db, 7, f.fn)).toEqual({ nit: '900123456', origen: 'existente' });
    expect(f.urls).toHaveLength(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('si falta, lo trae de SECOP y lo guarda SOLO si sigue vacío (nunca pisa uno digitado)', async () => {
    const { db, updateMany } = dbFalsa({ nitContacto: null, entidad: 'Colegio', codigoProceso: 'P.31', aliasFuente: 'S2', linkSecop: null });
    const r = await completarNitEntidad(db, 7, fetchFalso(() => [{ nit_entidad: '830037739' }]).fn);
    expect(r).toMatchObject({ nit: '830037739', origen: 'secop' });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 7, OR: [{ nitContacto: null }, { nitContacto: '' }] }, data: { nitContacto: '830037739' } });
  });

  it('sin resultado en SECOP no escribe nada', async () => {
    const { db, updateMany } = dbFalsa({ nitContacto: '', entidad: 'COOPIDROGAS', codigoProceso: 'X', aliasFuente: 'NC', linkSecop: null });
    expect(await completarNitEntidad(db, 7, fetchFalso(() => []).fn)).toEqual({ nit: null, origen: 'no_disponible' });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
