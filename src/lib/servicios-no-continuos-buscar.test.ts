/**
 * Ajuste "AUDITORÍA FASE 1 §4" — el contrato real de
 * `POST https://grupocolba.com/service/public/api/no_continuos {empresa:"aseo"}`
 * fue verificado en vivo durante la auditoría: la fuente devuelve
 * `{codigo:number, uen:string, descripcion:string}` — SIN `empresa` por
 * registro y con `uen` (no `undneg`, que era una suposición del enunciado
 * original de Fase 1). Los fixtures de este archivo usan esa forma REAL
 * (confirmada, no inventada) como caso primario; se mantiene un caso
 * defensivo para `undneg` por si la fuente cambia de nombre en el futuro.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buscarServiciosNoContinuos } from './servicios-no-continuos-buscar';

function stubFetch(respuesta: unknown, ok = true) {
  const llamada = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => respuesta }));
  vi.stubGlobal('fetch', llamada);
  return llamada;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buscarServiciosNoContinuos — POST .../no_continuos {empresa}', () => {
  it('envía únicamente {empresa} en el body (la fuente no acepta más filtros)', async () => {
    const llamada = stubFetch([{ codigo: 1, uen: 'BAQ', descripcion: 'BRIGADA DE ASEO' }]);
    await buscarServiciosNoContinuos('aseo');
    expect(llamada).toHaveBeenCalledTimes(1);
    const [url, init] = llamada.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/no_continuos');
    expect(JSON.parse(String(init.body))).toEqual({ empresa: 'aseo' });
  });

  it('CONTRATO REAL verificado en vivo: {codigo:number,uen,descripcion} (sin empresa) → {codigo:string,descripcion,empresa:"",undneg:uen}', async () => {
    stubFetch([{ codigo: 1, uen: 'BAQ', descripcion: 'BRIGADA DE ASEO' }]);
    const r = await buscarServiciosNoContinuos('aseo');
    expect(r).toEqual([{ codigo: '1', descripcion: 'BRIGADA DE ASEO', empresa: '', undneg: 'BAQ' }]);
  });

  it('codigo se repite entre uen distintos en la fuente real (ej. codigo=1 en BAQ/MIN/BOG son servicios distintos) — nunca se deduplica por codigo solo', async () => {
    stubFetch([
      { codigo: 1, uen: 'BAQ', descripcion: 'BRIGADA DE ASEO' },
      { codigo: 1, uen: 'MIN', descripcion: 'LAVADO DE FUENTE' },
      { codigo: 1, uen: 'BOG', descripcion: 'LIMPIEZA Y LAVADO DE TANQUES' },
    ]);
    const r = await buscarServiciosNoContinuos('aseo');
    expect(r).toHaveLength(3);
    expect(r.map(s => s.descripcion)).toEqual(['BRIGADA DE ASEO', 'LAVADO DE FUENTE', 'LIMPIEZA Y LAVADO DE TANQUES']);
  });

  it('admite también la forma envuelta {data:[...]}, igual que el resto de catálogos externos', async () => {
    stubFetch({ data: [{ codigo: 2, uen: 'BAQ', descripcion: 'LIMPIZA DE VIDRIOS SIN ALTURA' }] });
    const r = await buscarServiciosNoContinuos('aseo');
    expect(r).toHaveLength(1);
    expect(r[0].descripcion).toBe('LIMPIZA DE VIDRIOS SIN ALTURA');
  });

  it('descarta registros sin descripción (nunca una fila en blanco en el selector)', async () => {
    stubFetch([{ codigo: 3, uen: 'BAQ', descripcion: '  ' }, { codigo: 4, uen: 'BAQ', descripcion: 'BRILLADO DE PISOS' }]);
    const r = await buscarServiciosNoContinuos('aseo');
    expect(r).toEqual([{ codigo: '4', descripcion: 'BRILLADO DE PISOS', empresa: '', undneg: 'BAQ' }]);
  });

  it('Corrección "AUDITORÍA FASE 1 §2" — si el registro trajera `empresa` (la fuente real nunca lo hace), NUNCA se sustituye por el parámetro de consulta cuando falta', async () => {
    stubFetch([{ uen: 'BAQ', codigo: 5, descripcion: 'FUMIGACIÓN' }]); // forma real: sin campo empresa
    const r = await buscarServiciosNoContinuos('aseo');
    expect(r[0].empresa).toBe('');
  });

  it('defensivo: si algún registro trajera `undneg` en vez de `uen` (nombre original supuesto), también se lee', async () => {
    stubFetch([{ codigo: 6, undneg: 'CAL', descripcion: 'REFUERZO DE ACTIVIDADES' }]);
    const r = await buscarServiciosNoContinuos('aseo');
    expect(r[0].undneg).toBe('CAL');
  });

  it('respuesta vacía → arreglo vacío, sin lanzar', async () => {
    stubFetch([]);
    const r = await buscarServiciosNoContinuos('aseo');
    expect(r).toEqual([]);
  });

  it('error HTTP de la fuente se propaga como excepción (el caller la maneja)', async () => {
    stubFetch({}, false);
    await expect(buscarServiciosNoContinuos('aseo')).rejects.toThrow();
  });
});
