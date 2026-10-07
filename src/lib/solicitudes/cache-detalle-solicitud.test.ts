import { describe, it, expect, vi, beforeEach } from 'vitest';
import { obtenerDetalleSolicitudCacheado, precargarDetalleSolicitud, invalidarDetalleSolicitud, limpiarCacheDetalleSolicitud } from './cache-detalle-solicitud';

describe('cache-detalle-solicitud', () => {
  beforeEach(() => {
    limpiarCacheDetalleSolicitud();
  });

  it('dos llamadas simultáneas para el mismo id reutilizan la misma petición (sin fetch duplicado)', async () => {
    const fetchSpy = vi.fn(async () => ({ json: async () => ({ ok: true, solicitud: { id: 300 } }) }));
    vi.stubGlobal('fetch', fetchSpy);

    const p1 = obtenerDetalleSolicitudCacheado(300);
    const p2 = obtenerDetalleSolicitudCacheado(300);
    await Promise.all([p1, p2]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('ids distintos disparan peticiones distintas', async () => {
    const fetchSpy = vi.fn(async () => ({ json: async () => ({ ok: true, solicitud: {} }) }));
    vi.stubGlobal('fetch', fetchSpy);

    await Promise.all([obtenerDetalleSolicitudCacheado(300), obtenerDetalleSolicitudCacheado(301)]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('invalidarDetalleSolicitud fuerza una nueva petición en la siguiente lectura', async () => {
    const fetchSpy = vi.fn(async () => ({ json: async () => ({ ok: true, solicitud: {} }) }));
    vi.stubGlobal('fetch', fetchSpy);

    await obtenerDetalleSolicitudCacheado(300);
    invalidarDetalleSolicitud(300);
    await obtenerDetalleSolicitudCacheado(300);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('precargarDetalleSolicitud dispara la petición sin que el llamador tenga que esperar', () => {
    const fetchSpy = vi.fn(async () => ({ json: async () => ({ ok: true, solicitud: {} }) }));
    vi.stubGlobal('fetch', fetchSpy);

    precargarDetalleSolicitud(300);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('una petición que falla no deja una entrada rota — el siguiente intento reintenta', async () => {
    let intentos = 0;
    const fetchSpy = vi.fn(async () => {
      intentos++;
      if (intentos === 1) throw new Error('fallo de red');
      return { json: async () => ({ ok: true, solicitud: {} }) };
    });
    vi.stubGlobal('fetch', fetchSpy);

    precargarDetalleSolicitud(300);
    await new Promise((r) => setTimeout(r, 0)); // deja que el .catch interno limpie la entrada
    await obtenerDetalleSolicitudCacheado(300);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});