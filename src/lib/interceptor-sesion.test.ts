/**
 * FASE 6 (diagnóstico Aseocolba) — manejo reactivo de sesión expirada.
 * Tests de las funciones puras (`evaluarRespuestaSesion`,
 * `esRutaApiSinSesion`) y del wrapper de fetch (`instalarInterceptorSesion`,
 * probado con un objeto `{fetch}` simulado — sin `window`, entorno 'node').
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { evaluarRespuestaSesion, instalarInterceptorSesion, resetearParaPruebas, marcarSesionEstablecida, dispararExpiracionSiCorresponde } from './interceptor-sesion';
import { esRutaApiSinSesion, RUTAS_API_SIN_SESION } from './rutas-api-sesion';

const ORIGEN = 'https://licycolba.example.com';

beforeEach(() => { resetearParaPruebas(); });

describe('FASE 6 — esRutaApiSinSesion (fuente única compartida con proxy.ts)', () => {
  it('/api/auth/login, /api/auth/logout, /api/uploadthing: sin sesión', () => {
    for (const r of RUTAS_API_SIN_SESION) expect(esRutaApiSinSesion(r)).toBe(true);
  });
  it('/api/public/* (cualquier subruta): sin sesión — usa X-API-Key propia', () => {
    expect(esRutaApiSinSesion('/api/public/insumos')).toBe(true);
    expect(esRutaApiSinSesion('/api/public/')).toBe(true);
  });
  it('cualquier otra ruta /api/*: SÍ depende de sesión', () => {
    expect(esRutaApiSinSesion('/api/solicitudes')).toBe(false);
    expect(esRutaApiSinSesion('/api/costos-estructura/123')).toBe(false);
    expect(esRutaApiSinSesion('/api/auth/permisos')).toBe(false);
  });
});

describe('FASE 6 — 1) request autenticado /api/* devuelve 401 → dispara el flujo (con sesión previa)', () => {
  it('/api/solicitudes 401, con sesión previa → dispara onExpirada', () => {
    const onExpirada = vi.fn();
    const disparo = evaluarRespuestaSesion({ url: '/api/solicitudes', status: 401, origenActual: ORIGEN, huboSesionPrevia: true }, onExpirada);
    expect(disparo).toBe(true);
    expect(onExpirada).toHaveBeenCalledTimes(1);
  });
});

describe('FASE 6 — 2) tres respuestas 401 concurrentes → una sola acción (idempotencia)', () => {
  it('solo la primera llamada dispara onExpirada; las siguientes no, hasta marcarSesionEstablecida', () => {
    const onExpirada = vi.fn();
    const params = { url: '/api/a', status: 401 as const, origenActual: ORIGEN, huboSesionPrevia: true };
    const d1 = evaluarRespuestaSesion({ ...params, url: '/api/a' }, onExpirada);
    const d2 = evaluarRespuestaSesion({ ...params, url: '/api/b' }, onExpirada);
    const d3 = evaluarRespuestaSesion({ ...params, url: '/api/c' }, onExpirada);
    expect([d1, d2, d3]).toEqual([true, false, false]);
    expect(onExpirada).toHaveBeenCalledTimes(1);
  });

  it('tras marcarSesionEstablecida (nuevo login), una nueva expiración vuelve a disparar', () => {
    const onExpirada = vi.fn();
    const params = { url: '/api/a', status: 401 as const, origenActual: ORIGEN, huboSesionPrevia: true };
    evaluarRespuestaSesion(params, onExpirada);
    marcarSesionEstablecida();
    const disparo2 = evaluarRespuestaSesion(params, onExpirada);
    expect(disparo2).toBe(true);
    expect(onExpirada).toHaveBeenCalledTimes(2);
  });
});

describe('FASE 6 — 3) API externa (Grupo Colba u otro dominio) devuelve 401 → NUNCA cierra sesión', () => {
  it('URL absoluta a otro origen, 401, con sesión previa → no dispara', () => {
    const onExpirada = vi.fn();
    const disparo = evaluarRespuestaSesion(
      { url: 'https://grupocolba.com/service/public/api/insumos', status: 401, origenActual: ORIGEN, huboSesionPrevia: true },
      onExpirada,
    );
    expect(disparo).toBe(false);
    expect(onExpirada).not.toHaveBeenCalled();
  });
});

describe('FASE 6 — 4) login devuelve 401 por credenciales incorrectas → NUNCA se trata como sesión expirada', () => {
  it('/api/auth/login 401, incluso con huboSesionPrevia=true (defensivo) → no dispara, por ruta excluida', () => {
    const onExpirada = vi.fn();
    const disparo = evaluarRespuestaSesion({ url: '/api/auth/login', status: 401, origenActual: ORIGEN, huboSesionPrevia: true }, onExpirada);
    expect(disparo).toBe(false);
    expect(onExpirada).not.toHaveBeenCalled();
  });

  it('sin sesión previa (caso real: usuario en la pantalla de login) tampoco dispara, por el guard de huboSesionPrevia', () => {
    const onExpirada = vi.fn();
    const disparo = evaluarRespuestaSesion({ url: '/api/auth/login', status: 401, origenActual: ORIGEN, huboSesionPrevia: false }, onExpirada);
    expect(disparo).toBe(false);
    expect(onExpirada).not.toHaveBeenCalled();
  });
});

describe('FASE 6 — 9) 403 nunca se trata como sesión expirada', () => {
  it('/api/solicitudes 403, con sesión previa → no dispara', () => {
    const onExpirada = vi.fn();
    const disparo = evaluarRespuestaSesion({ url: '/api/solicitudes', status: 403, origenActual: ORIGEN, huboSesionPrevia: true }, onExpirada);
    expect(disparo).toBe(false);
    expect(onExpirada).not.toHaveBeenCalled();
  });
});

describe('FASE 6 — 10) 500 nunca cierra sesión', () => {
  it('/api/solicitudes 500, con sesión previa → no dispara', () => {
    const onExpirada = vi.fn();
    const disparo = evaluarRespuestaSesion({ url: '/api/solicitudes', status: 500, origenActual: ORIGEN, huboSesionPrevia: true }, onExpirada);
    expect(disparo).toBe(false);
    expect(onExpirada).not.toHaveBeenCalled();
  });
});

describe('FASE 6 — 8) una llamada exitosa 200 nunca dispara ni modifica el estado de sesión', () => {
  it('/api/solicitudes 200 → no dispara', () => {
    const onExpirada = vi.fn();
    const disparo = evaluarRespuestaSesion({ url: '/api/solicitudes', status: 200, origenActual: ORIGEN, huboSesionPrevia: true }, onExpirada);
    expect(disparo).toBe(false);
    expect(onExpirada).not.toHaveBeenCalled();
  });
});

describe('FASE 6 — 11) request público 401 no genera loop', () => {
  it('/api/public/insumos 401 → no dispara (ruta pública versionada, X-API-Key propia)', () => {
    const onExpirada = vi.fn();
    const disparo = evaluarRespuestaSesion({ url: '/api/public/insumos', status: 401, origenActual: ORIGEN, huboSesionPrevia: true }, onExpirada);
    expect(disparo).toBe(false);
    expect(onExpirada).not.toHaveBeenCalled();
  });
});

describe('FASE 6 — instalarInterceptorSesion: envuelve fetch sin alterar la respuesta entregada al llamador', () => {
  it('devuelve exactamente la misma Response que el fetch original, y dispara onExpirada en 401', async () => {
    const respuestaOriginal = { status: 401 } as Response;
    const fetchOriginal = vi.fn().mockResolvedValue(respuestaOriginal);
    const objetivo = { fetch: fetchOriginal as unknown as typeof fetch };
    const onExpirada = vi.fn();
    const desinstalar = instalarInterceptorSesion(() => true, onExpirada, () => ORIGEN, objetivo);

    const respuesta = await objetivo.fetch('/api/solicitudes');

    expect(respuesta).toBe(respuestaOriginal); // nunca se altera lo entregado al llamador
    expect(fetchOriginal).toHaveBeenCalledWith('/api/solicitudes');
    expect(onExpirada).toHaveBeenCalledTimes(1);
    desinstalar();
    expect(objetivo.fetch).toBe(fetchOriginal);
  });

  it('con 200, la respuesta se entrega igual y onExpirada nunca se llama', async () => {
    const respuestaOriginal = { status: 200 } as Response;
    const fetchOriginal = vi.fn().mockResolvedValue(respuestaOriginal);
    const objetivo = { fetch: fetchOriginal as unknown as typeof fetch };
    const onExpirada = vi.fn();
    instalarInterceptorSesion(() => true, onExpirada, () => ORIGEN, objetivo);

    const respuesta = await objetivo.fetch('/api/solicitudes');
    expect(respuesta).toBe(respuestaOriginal);
    expect(onExpirada).not.toHaveBeenCalled();
  });

  it('tres llamadas 401 concurrentes (Promise.all) disparan onExpirada exactamente una vez', async () => {
    const fetchOriginal = vi.fn().mockResolvedValue({ status: 401 } as Response);
    const objetivo = { fetch: fetchOriginal as unknown as typeof fetch };
    const onExpirada = vi.fn();
    instalarInterceptorSesion(() => true, onExpirada, () => ORIGEN, objetivo);

    await Promise.all([
      objetivo.fetch('/api/a'),
      objetivo.fetch('/api/b'),
      objetivo.fetch('/api/c'),
    ]);

    expect(onExpirada).toHaveBeenCalledTimes(1);
  });
});

describe('FASE 6 (cierre) — dispararExpiracionSiCorresponde: punto único compartido por el interceptor de 401 y el temporizador de inactividad', () => {
  it('dispara la primera vez', () => {
    const onExpirada = vi.fn();
    expect(dispararExpiracionSiCorresponde(onExpirada)).toBe(true);
    expect(onExpirada).toHaveBeenCalledTimes(1);
  });

  it('una segunda llamada, sin marcarSesionEstablecida entre medio, no dispara de nuevo', () => {
    const onExpirada = vi.fn();
    dispararExpiracionSiCorresponde(onExpirada);
    expect(dispararExpiracionSiCorresponde(onExpirada)).toBe(false);
    expect(onExpirada).toHaveBeenCalledTimes(1);
  });

  it('timer de inactividad y un 401 "simultáneos" (mismo flag compartido) → una sola expiración, sin importar cuál llegue primero', () => {
    const onExpirada = vi.fn();
    // El temporizador de inactividad dispara primero...
    const disparoTimer = dispararExpiracionSiCorresponde(onExpirada);
    // ...y el interceptor de 401 llega después, para la misma expiración.
    const disparo401 = evaluarRespuestaSesion({ url: '/api/solicitudes', status: 401, origenActual: ORIGEN, huboSesionPrevia: true }, onExpirada);
    expect(disparoTimer).toBe(true);
    expect(disparo401).toBe(false);
    expect(onExpirada).toHaveBeenCalledTimes(1);
  });

  it('el 401 dispara primero y el timer de inactividad llega después → sigue siendo una sola expiración', () => {
    const onExpirada = vi.fn();
    const disparo401 = evaluarRespuestaSesion({ url: '/api/solicitudes', status: 401, origenActual: ORIGEN, huboSesionPrevia: true }, onExpirada);
    const disparoTimer = dispararExpiracionSiCorresponde(onExpirada);
    expect(disparo401).toBe(true);
    expect(disparoTimer).toBe(false);
    expect(onExpirada).toHaveBeenCalledTimes(1);
  });

  it('tras marcarSesionEstablecida (nuevo login), una futura expiración por inactividad vuelve a disparar', () => {
    const onExpirada = vi.fn();
    dispararExpiracionSiCorresponde(onExpirada);
    marcarSesionEstablecida();
    expect(dispararExpiracionSiCorresponde(onExpirada)).toBe(true);
    expect(onExpirada).toHaveBeenCalledTimes(2);
  });
});
