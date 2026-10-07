/**
 * D7/D16 — resolución de `linkDetalle` BAJO DEMANDA en `GET /api/procesos`.
 *
 * Regla exigida: SOLO se resuelve cuando el cliente consulta UN proceso
 * puntual por `id` (nunca en un listado/búsqueda general — eso sería hacerlo
 * "en masa", justo lo que este diseño evita). Y solo si el proceso es
 * elegible (Data API: origenFuncional PUBLICO_ABIERTO/PUBLICO_REGISTRADO) y
 * todavía no tiene link.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  proceso: { count: vi.fn(), findMany: vi.fn() },
  procesoDocumentoSecop: { findMany: vi.fn().mockResolvedValue([]) },
  procesoCronogramaSecop: { findMany: vi.fn().mockResolvedValue([]) },
}));
const fachadaSyncMock = vi.hoisted(() => ({ resolverLinkProceso: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/session', () => ({ getSession: vi.fn().mockResolvedValue({ id: 1, usuario: 'test', rol: 'Analista Comercial' }) }));
vi.mock('@/lib/data-api/sync/fachadaSync', () => ({ fachadaSync: fachadaSyncMock }));

import { GET } from './route';
import { NextRequest } from 'next/server';

const req = (qs = '') => new NextRequest(`http://localhost/api/procesos${qs}`);

const base = {
  externalId: null, sourceKey: 'uuid-1', entidad: 'Municipio', objeto: 'Obj', fuente: null, aliasFuente: null,
  modalidad: 'MC', perfil: null, departamento: 'Arauca', estadoFuente: 'Convocatoria',
  fechaPublicacion: new Date('2026-09-09T00:00:00Z'), fechaVencimiento: new Date('2027-01-01T00:00:00Z'),
  fechaVencimientoAnterior: null, tieneCambioFechaCierre: false, fechaCambioFechaCierre: null,
  valor: 1000, linkSecop: '', linkSecopReg: '',
  totalCronogramas: 0, totalDocumentos: 0, lastSyncedAt: null, rawJson: null, oculto: false,
};

beforeEach(() => {
  prismaMock.proceso.count.mockReset().mockResolvedValue(1);
  prismaMock.proceso.findMany.mockReset();
  fachadaSyncMock.resolverLinkProceso.mockReset();
});

describe('GET /api/procesos — resolución de linkDetalle bajo demanda', () => {
  it('id=X + sin link + Data API elegible (PUBLICO_ABIERTO) → SÍ resuelve, y la respuesta trae el link nuevo', async () => {
    prismaMock.proceso.findMany.mockResolvedValue([
      { ...base, id: 55, codigoProceso: 'CO-055', nombre: 'CO-055', linkDetalle: null, origenFuncional: 'PUBLICO_ABIERTO' },
    ]);
    fachadaSyncMock.resolverLinkProceso.mockResolvedValue({
      estado: 'ejecutado', modo: 'data-api', datos: { ok: true, yaExistia: false, linkDetalle: 'https://community.secop.gov.co/detalle-55' },
    });

    const body = await (await GET(req('?id=55&limit=1'))).json();

    expect(fachadaSyncMock.resolverLinkProceso).toHaveBeenCalledWith(55);
    expect(fachadaSyncMock.resolverLinkProceso).toHaveBeenCalledTimes(1);
    expect(body.procesos[0].linkDetalle).toBe('https://community.secop.gov.co/detalle-55');
  });

  it('id=X + YA tiene link → NO llama a resolverLinkProceso (no gasta la llamada)', async () => {
    prismaMock.proceso.findMany.mockResolvedValue([
      { ...base, id: 56, codigoProceso: 'CO-056', nombre: 'CO-056', linkDetalle: 'https://ya-tenia.invalid', origenFuncional: 'PUBLICO_REGISTRADO' },
    ]);

    const body = await (await GET(req('?id=56&limit=1'))).json();

    expect(fachadaSyncMock.resolverLinkProceso).not.toHaveBeenCalled();
    expect(body.procesos[0].linkDetalle).toBe('https://ya-tenia.invalid');
  });

  it('id=X + sin link + PRIVADO/MANUAL con sourceKey → SÍ resuelve porque tiene identidad resoluble', async () => {
    prismaMock.proceso.findMany.mockResolvedValue([
      { ...base, id: 57, codigoProceso: 'CO-057', nombre: 'CO-057', sourceKey: 'uuid-privado-57', linkDetalle: null, origenFuncional: 'PRIVADO' },
    ]);
    fachadaSyncMock.resolverLinkProceso.mockResolvedValue({
      estado: 'ejecutado', modo: 'data-api', datos: { ok: true, yaExistia: false, linkDetalle: 'https://privado.local/detalle-57' },
    });

    const body = await (await GET(req('?id=57&limit=1'))).json();

    expect(fachadaSyncMock.resolverLinkProceso).toHaveBeenCalledWith(57);
    expect(body.procesos[0].linkDetalle).toBe('https://privado.local/detalle-57');
  });

  it('id=X + sin link + PRIVADO/MANUAL sin sourceKey → NO llama a resolverLinkProceso', async () => {
    prismaMock.proceso.findMany.mockResolvedValue([
      { ...base, id: 58, codigoProceso: 'CO-058', nombre: 'CO-058', sourceKey: null, linkDetalle: null, origenFuncional: 'PRIVADO' },
    ]);

    await GET(req('?id=58&limit=1'));

    expect(fachadaSyncMock.resolverLinkProceso).not.toHaveBeenCalled();
  });

  it('LISTADO general (sin id) — NUNCA resuelve en masa, aunque varias filas de la página no tengan link', async () => {
    prismaMock.proceso.findMany.mockResolvedValue([
      { ...base, id: 60, codigoProceso: 'CO-060', nombre: 'CO-060', linkDetalle: null, origenFuncional: 'PUBLICO_ABIERTO' },
      { ...base, id: 61, codigoProceso: 'CO-061', nombre: 'CO-061', linkDetalle: null, origenFuncional: 'PUBLICO_REGISTRADO' },
      { ...base, id: 62, codigoProceso: 'CO-062', nombre: 'CO-062', linkDetalle: null, origenFuncional: 'PUBLICO_ABIERTO' },
    ]);
    prismaMock.proceso.count.mockResolvedValue(3);

    await GET(req('?query=algo'));

    expect(fachadaSyncMock.resolverLinkProceso).not.toHaveBeenCalled();
  });

  it('la Data API falla al resolver → no rompe la respuesta, sigue devolviendo lo que ya había en BD', async () => {
    prismaMock.proceso.findMany.mockResolvedValue([
      { ...base, id: 58, codigoProceso: 'CO-058', nombre: 'CO-058', linkDetalle: null, origenFuncional: 'PUBLICO_ABIERTO' },
    ]);
    fachadaSyncMock.resolverLinkProceso.mockRejectedValue(new Error('timeout'));

    const res = await GET(req('?id=58&limit=1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.procesos[0].linkDetalle).toBe('');
  });

  it('sync deshabilitado (fachadaSync devuelve estado:"deshabilitado") → no rompe la respuesta', async () => {
    prismaMock.proceso.findMany.mockResolvedValue([
      { ...base, id: 59, codigoProceso: 'CO-059', nombre: 'CO-059', linkDetalle: null, origenFuncional: 'PUBLICO_REGISTRADO' },
    ]);
    fachadaSyncMock.resolverLinkProceso.mockResolvedValue({ estado: 'deshabilitado', modo: 'disabled', mensaje: 'apagado' });

    const res = await GET(req('?id=59&limit=1'));
    expect(res.status).toBe(200);
  });
});
