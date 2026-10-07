import { describe, it, expect } from 'vitest';
import {
  determinarMensajeActualizarFicha, debeActualizarLinkInmediato,
  esErrorLimiteDePeticiones, tieneLimiteDePeticiones,
  determinarMensajeActualizacionPuntual, esErrorTecnicoCrudo,
} from './actualizar-ficha-resultado';

const MENSAJE_LIMITE = 'Límite temporal de consultas alcanzado. Espera aproximadamente 2 minutos antes de volver a actualizar la ficha.';
const MENSAJE_LIMITE_CON_LINK = 'Enlace SECOP actualizado, pero no fue posible completar los demás datos por límite temporal de consultas. Espera aproximadamente 2 minutos antes de intentarlo nuevamente.';

describe('determinarMensajeActualizarFicha — sin límite de peticiones', () => {
  it('CASO 1 — cambioDetectado true con linkDetalle: "Enlace SECOP actualizado." (prioridad máxima entre los casos sin error)', () => {
    const r = determinarMensajeActualizarFicha(
      { cambioDetectado: true, linkDetalle: 'https://www.secop.gov.co/...notice=CO1.NTC.10476283', sinCambios: 1 },
      true
    );
    expect(r).toEqual({ tipo: 'ok', texto: 'Enlace SECOP actualizado.' });
  });

  it('CASO 2 — cambio general (actualizados>0) sin cambio de link: mensaje detallado', () => {
    const r = determinarMensajeActualizarFicha(
      { actualizados: 1, cronogramasActualizados: 2, documentosNuevos: 1 },
      true
    );
    expect(r.tipo).toBe('ok');
    expect(r.texto).toContain('2 cambio(s) en cronograma');
    expect(r.texto).toContain('1 doc(s) nuevo(s)');
  });

  it('CASO 3 — sin cambios generales ni de link: "Sin cambios detectados."', () => {
    const r = determinarMensajeActualizarFicha({ sinCambios: 1 }, true);
    expect(r).toEqual({ tipo: 'ok', texto: 'Sin cambios detectados.' });
  });

  it('CASO 4 — falla la operación (error real, no rate-limit): conserva mensaje de error', () => {
    const r = determinarMensajeActualizarFicha({ errores: ['No se encontró el proceso en la API.'] }, false);
    expect(r).toEqual({ tipo: 'error', texto: 'No se encontró el proceso en la API.' });
  });

  it('error con data.error en vez de errores[]', () => {
    const r = determinarMensajeActualizarFicha({ error: 'Proceso no encontrado.' }, false);
    expect(r).toEqual({ tipo: 'error', texto: 'Proceso no encontrado.' });
  });

  it('cambioDetectado true pero SIN linkDetalle: no debe mostrar "Enlace SECOP actualizado." (dato incompleto)', () => {
    const r = determinarMensajeActualizarFicha({ cambioDetectado: true, sinCambios: 1 }, true);
    expect(r.texto).not.toBe('Enlace SECOP actualizado.');
    expect(r).toEqual({ tipo: 'ok', texto: 'Sin cambios detectados.' });
  });

  it('cambioDetectado false explícito con linkDetalle presente (sin cambio real): no muestra "Enlace SECOP actualizado."', () => {
    const r = determinarMensajeActualizarFicha(
      { cambioDetectado: false, linkDetalle: 'https://www.secop.gov.co/...notice=CO1.NTC.10264874', sinCambios: 1 },
      true
    );
    expect(r).toEqual({ tipo: 'ok', texto: 'Sin cambios detectados.' });
  });

  it('sin ningún dato (fallback): "Sincronización completada."', () => {
    const r = determinarMensajeActualizarFicha({}, true);
    expect(r).toEqual({ tipo: 'ok', texto: 'Sincronización completada.' });
  });
});

describe('esErrorTecnicoCrudo — cualquier HTTP crudo, no solo 429 (caso real: HTTP 500 Corpoguajira)', () => {
  it('detecta "[liciGetProcesos] HTTP 500: {json}"', () => {
    expect(esErrorTecnicoCrudo('[liciGetProcesos] HTTP 500: {"message":"Server Error"}')).toBe(true);
  });

  it('detecta "[liciWeb] ... HTTP 401"', () => {
    expect(esErrorTecnicoCrudo('[liciWeb] Login fallido HTTP 401')).toBe(true);
  });

  it('un mensaje sin marca técnica no se considera crudo', () => {
    expect(esErrorTecnicoCrudo('Proceso no encontrado.')).toBe(false);
  });

  it('null/undefined/"" → false', () => {
    expect(esErrorTecnicoCrudo(null)).toBe(false);
    expect(esErrorTecnicoCrudo(undefined)).toBe(false);
    expect(esErrorTecnicoCrudo('')).toBe(false);
  });

  it('determinarMensajeActualizarFicha (contrato antiguo) también sustituye un HTTP 500 crudo', () => {
    const r = determinarMensajeActualizarFicha(
      { errores: ['[liciGetProcesos] HTTP 500: {"message":"Server Error"}'] },
      false
    );
    expect(r.texto).not.toContain('liciGetProcesos');
    expect(r.texto).not.toContain('Server Error');
    expect(r).toEqual({ tipo: 'error', texto: 'No fue posible actualizar la ficha. Intenta nuevamente más tarde.' });
  });
});

describe('esErrorLimiteDePeticiones / tieneLimiteDePeticiones', () => {
  it('detecta "HTTP 429"', () => {
    expect(esErrorLimiteDePeticiones('Perfil Vigicolba pág 1: [liciGetProcesos] HTTP 429: {...}')).toBe(true);
  });

  it('detecta "Excede el limite de peticiones por minuto"', () => {
    expect(esErrorLimiteDePeticiones('Excede el limite de peticiones por minuto, maximo 50 por minuto.')).toBe(true);
  });

  it('tieneLimiteDePeticiones revisa todo el arreglo errores[]', () => {
    expect(tieneLimiteDePeticiones({ errores: ['algo', 'Too Many Requests'] })).toBe(true);
  });

  it('tieneLimiteDePeticiones revisa data.error', () => {
    expect(tieneLimiteDePeticiones({ error: 'HTTP 429' })).toBe(true);
  });

  it('esErrorLimiteDePeticiones(null/undefined/"") → false', () => {
    expect(esErrorLimiteDePeticiones(null)).toBe(false);
    expect(esErrorLimiteDePeticiones(undefined)).toBe(false);
    expect(esErrorLimiteDePeticiones('')).toBe(false);
  });
});

describe('determinarMensajeActualizarFicha — resultados con límite de peticiones (429)', () => {
  it('PRUEBA 1 — 429 + actualizados=1: NO muestra el mensaje de éxito general', () => {
    const r = determinarMensajeActualizarFicha(
      { errores: ['HTTP 429: Too Many Requests'], actualizados: 1, cronogramasActualizados: 3 },
      false
    );
    expect(r.texto).not.toContain('cambio(s) en cronograma');
    expect(r).toEqual({ tipo: 'error', texto: MENSAJE_LIMITE });
  });

  it('PRUEBA 2 — 429 + creados=1: NO muestra el mensaje de éxito general', () => {
    const r = determinarMensajeActualizarFicha(
      { errores: ['HTTP 429: Too Many Requests'], creados: 1 },
      false
    );
    expect(r).toEqual({ tipo: 'error', texto: MENSAJE_LIMITE });
  });

  it('PRUEBA 3 — 429 + cambioDetectado=true + linkDetalle válido: mensaje de éxito parcial', () => {
    const r = determinarMensajeActualizarFicha(
      {
        errores: ['Perfil Vigicolba pág 1: [liciGetProcesos] HTTP 429: {...}'],
        linkDetalle: 'https://www.secop.gov.co/...notice=CO1.NTC.10334664',
        linkResuelto: true,
        cambioDetectado: true,
      },
      false
    );
    expect(r).toEqual({ tipo: 'parcial', texto: MENSAJE_LIMITE_CON_LINK });
  });

  it('PRUEBA 4 — mismo caso: debeActualizarLinkInmediato sigue siendo true (el link se aplica a solLocal)', () => {
    expect(debeActualizarLinkInmediato({
      errores: ['HTTP 429'],
      linkDetalle: 'https://www.secop.gov.co/...notice=CO1.NTC.10334664',
      cambioDetectado: true,
    })).toBe(true);
  });

  it('PRUEBA 5 — tipo "parcial" es distinguible de "ok" y "error" (para que page.tsx no marque "Actualizada hoy")', () => {
    const r = determinarMensajeActualizarFicha(
      { errores: ['HTTP 429'], linkDetalle: 'https://www.secop.gov.co/...', cambioDetectado: true },
      false
    );
    expect(r.tipo).toBe('parcial');
    expect(r.tipo).not.toBe('ok');
    expect(r.tipo).not.toBe('error');
  });

  it('PRUEBA 6 — 429 + cambioDetectado=false: SOLO el mensaje amigable de límite (sin dato de link parcial)', () => {
    const r = determinarMensajeActualizarFicha(
      {
        errores: ['Perfil Vigicolba pág 1: [liciGetProcesos] HTTP 429: {...}'],
        linkDetalle: 'https://www.secop.gov.co/...notice=CO1.NTC.10334664',
        linkResuelto: false,
        cambioDetectado: false,
      },
      false
    );
    expect(r).toEqual({ tipo: 'error', texto: MENSAJE_LIMITE });
  });

  it('PRUEBA 7 — sin 429 + cambioDetectado=true: conserva "Enlace SECOP actualizado." (tipo ok, no parcial)', () => {
    const r = determinarMensajeActualizarFicha(
      { linkDetalle: 'https://www.secop.gov.co/...notice=CO1.NTC.10476283', cambioDetectado: true },
      true
    );
    expect(r).toEqual({ tipo: 'ok', texto: 'Enlace SECOP actualizado.' });
  });

  it('PRUEBA 8 — sin 429 + actualizados>0: conserva el mensaje detallado actual', () => {
    const r = determinarMensajeActualizarFicha(
      { actualizados: 1, cronogramasActualizados: 2, documentosNuevos: 1 },
      true
    );
    expect(r.tipo).toBe('ok');
    expect(r.texto).toContain('2 cambio(s) en cronograma');
  });

  it('tres errores 429 repetidos por perfil + sin cambio de link: un solo mensaje amigable', () => {
    const data = {
      errores: [
        'Perfil Vigicolba pág 1: [liciGetProcesos] HTTP 429: {"message":"Excede el limite de peticiones por minuto, maximo 50 por minuto."}',
        'Perfil Tempocolba pág 1: [liciGetProcesos] HTTP 429: {"message":"Excede el limite de peticiones por minuto, maximo 50 por minuto."}',
        'Perfil Aseocolba pág 1: [liciGetProcesos] HTTP 429: {"message":"Excede el limite de peticiones por minuto, maximo 50 por minuto."}',
        'No se encontró el proceso "SAMC-0005-2026" en las páginas consultadas.',
      ],
    };
    expect(determinarMensajeActualizarFicha(data, false)).toEqual({ tipo: 'error', texto: MENSAJE_LIMITE });
  });

  it('caso real Corpoguajira (SAMC-0005-2026): 429 sin cambio real de link → mensaje amigable de límite', () => {
    const data = {
      ok: false,
      recibidos: 0,
      errores: [
        'Perfil Vigicolba pág 1: [liciGetProcesos] HTTP 429: {"success":false,"message":"Excede el limite de peticiones por minuto, maximo 50 por minuto.","count":0,"data":[]}',
        'Perfil Tempocolba pág 1: [liciGetProcesos] HTTP 429: {"success":false,"message":"Excede el limite de peticiones por minuto, maximo 50 por minuto.","count":0,"data":[]}',
        'Perfil Aseocolba pág 1: [liciGetProcesos] HTTP 429: {"success":false,"message":"Excede el limite de peticiones por minuto, maximo 50 por minuto.","count":0,"data":[]}',
        'No se encontró el proceso "SAMC-0005-2026" en las páginas consultadas.',
      ],
      linkDetalle: 'https://www.secop.gov.co/CO1BusinessLine/Tendering/ContractNoticeView/Index?notice=CO1.NTC.10334664',
      linkResuelto: false,
      cambioDetectado: false,
    };
    expect(determinarMensajeActualizarFicha(data, false)).toEqual({ tipo: 'error', texto: MENSAJE_LIMITE });
  });

  it('error distinto de 429 con cambioDetectado=true: NO se trata como parcial (solo el 429 activa el mensaje combinado)', () => {
    const r = determinarMensajeActualizarFicha(
      { errores: ['Timeout de red al consultar el proceso.'], linkDetalle: 'https://www.secop.gov.co/...', cambioDetectado: true },
      false
    );
    expect(r).toEqual({ tipo: 'error', texto: 'Timeout de red al consultar el proceso.' });
  });
});

describe('determinarMensajeActualizacionPuntual — contrato del endpoint puntual (PRUEBA 23)', () => {
  it('completa + cambio de link: "Enlace SECOP actualizado." (ok)', () => {
    expect(determinarMensajeActualizacionPuntual({ estado: 'completa', cambioDetectado: true, linkDetalle: 'https://x' }))
      .toEqual({ tipo: 'ok', texto: 'Enlace SECOP actualizado.' });
  });

  it('completa sin cambio de link: "Ficha actualizada correctamente." (ok)', () => {
    expect(determinarMensajeActualizacionPuntual({ estado: 'completa', cambioDetectado: false }))
      .toEqual({ tipo: 'ok', texto: 'Ficha actualizada correctamente.' });
  });

  it('sin_cambios: "Sin cambios detectados." (ok)', () => {
    expect(determinarMensajeActualizacionPuntual({ estado: 'sin_cambios' }))
      .toEqual({ tipo: 'ok', texto: 'Sin cambios detectados.' });
  });

  it('reciente: mensaje de frescura (ok — no reintenta)', () => {
    const r = determinarMensajeActualizacionPuntual({ estado: 'reciente', mensaje: 'La ficha ya fue actualizada recientemente.' });
    expect(r).toEqual({ tipo: 'ok', texto: 'La ficha ya fue actualizada recientemente.' });
  });

  it('en_curso: aviso ámbar "ya se está actualizando"', () => {
    const r = determinarMensajeActualizacionPuntual({ estado: 'en_curso' });
    expect(r.tipo).toBe('parcial');
    expect(r.texto).toContain('ya se está actualizando');
  });

  it('limite_peticiones sin Retry-After: mensaje amigable con ~2 minutos', () => {
    const r = determinarMensajeActualizacionPuntual({ estado: 'limite_peticiones' });
    expect(r.tipo).toBe('error');
    expect(r.texto).toContain('aproximadamente 2 minutos');
  });

  it('limite_peticiones con Retry-After: usa el tiempo real', () => {
    const r = determinarMensajeActualizacionPuntual({ estado: 'limite_peticiones', retryAfterSegundos: 180 });
    expect(r.texto).toContain('3 minuto(s)');
  });

  it('parcial con link nuevo: conserva el mensaje ámbar de éxito parcial', () => {
    const r = determinarMensajeActualizacionPuntual({ estado: 'parcial', cambioDetectado: true, linkDetalle: 'https://x' });
    expect(r.tipo).toBe('parcial');
    expect(r.texto).toContain('Enlace SECOP actualizado, pero');
  });

  it('parcial sin cambio de link: aviso genérico de resultado parcial (ámbar)', () => {
    const r = determinarMensajeActualizacionPuntual({ estado: 'parcial', cambioDetectado: false });
    expect(r.tipo).toBe('parcial');
    expect(r.texto).toContain('parcialmente');
  });

  it('PRUEBA 8 — parcial con puedeCompletarDatos=true (caso PSA-UNP-054-2026: enlace confirmado sin cambio + API general falló): mensaje específico de continuación, ámbar', () => {
    const r = determinarMensajeActualizacionPuntual({
      estado: 'parcial', cambioDetectado: false, puedeCompletarDatos: true,
      continuacionActualizacion: 'abc.def', continuacionExpiraEn: '2026-07-17T20:25:00.000Z', noticeConfirmado: 'CO1.NTC.10510828',
    });
    expect(r.tipo).toBe('parcial');
    expect(r.texto).toBe('Se confirmó el enlace SECOP, pero el servicio de licitaciones no permitió completar los demás datos. Intenta nuevamente para completar la información pendiente.');
  });

  it('puedeCompletarDatos=true tiene prioridad sobre el mensaje de cambioDetectado', () => {
    const r = determinarMensajeActualizacionPuntual({
      estado: 'parcial', cambioDetectado: true, linkDetalle: 'https://x', puedeCompletarDatos: true, continuacionActualizacion: 'abc.def',
    });
    expect(r.texto).not.toContain('Enlace SECOP actualizado, pero');
    expect(r.texto).toContain('Se confirmó el enlace SECOP');
  });

  it('fuente_no_disponible: mensaje de error genérico de fuente externa (sin continuación posible)', () => {
    const r = determinarMensajeActualizacionPuntual({ estado: 'fuente_no_disponible' });
    expect(r.tipo).toBe('error');
    expect(r.texto).toContain('fuente externa');
  });

  it('error con texto técnico de 429: mensaje amigable, nunca el JSON crudo', () => {
    const r = determinarMensajeActualizacionPuntual({
      estado: 'error',
      error: '[liciGetProcesos] HTTP 429: {"message":"Excede el limite de peticiones por minuto"}',
    });
    expect(r.tipo).toBe('error');
    expect(r.texto).not.toContain('liciGetProcesos');
    expect(r.texto).toContain('Límite temporal de consultas');
  });

  it('error genérico sin detalle: fallback amigable', () => {
    const r = determinarMensajeActualizacionPuntual({ estado: 'error' });
    expect(r).toEqual({ tipo: 'error', texto: 'No fue posible actualizar la ficha. Intenta nuevamente más tarde.' });
  });

  it('respuesta sin estado (contrato inesperado): trata como error con fallback', () => {
    const r = determinarMensajeActualizacionPuntual({});
    expect(r.tipo).toBe('error');
  });

  it('caso real Corpoguajira (SAMC-0005-2026): HTTP 500 de liciGetProcesos → mensaje amigable, nunca el JSON crudo', () => {
    const r = determinarMensajeActualizacionPuntual({
      estado: 'error',
      error: '[liciGetProcesos] HTTP 500: {"message":"Server Error"}',
    });
    expect(r.tipo).toBe('error');
    expect(r.texto).not.toContain('liciGetProcesos');
    expect(r.texto).not.toContain('Server Error');
    expect(r.texto).not.toContain('500');
    expect(r.texto).toBe('No fue posible actualizar la ficha. Intenta nuevamente más tarde.');
  });

  it('cualquier HTTP crudo (no solo 429/500) queda sustituido por el mensaje genérico', () => {
    const r = determinarMensajeActualizacionPuntual({ estado: 'error', error: '[liciWeb] Login fallido HTTP 401' });
    expect(r.texto).not.toContain('liciWeb');
    expect(r.texto).not.toContain('401');
  });

  it('mensaje ya controlado (sin marca técnica) SÍ se muestra tal cual', () => {
    const r = determinarMensajeActualizacionPuntual({
      estado: 'error',
      error: 'Este proceso no tiene una fuente externa para actualizar.',
    });
    expect(r.texto).toBe('Este proceso no tiene una fuente externa para actualizar.');
  });
});

describe('debeActualizarLinkInmediato', () => {
  it('true cuando linkDetalle es un string no vacío', () => {
    expect(debeActualizarLinkInmediato({ linkDetalle: 'https://www.secop.gov.co/...' })).toBe(true);
  });

  it('false cuando linkDetalle está ausente', () => {
    expect(debeActualizarLinkInmediato({})).toBe(false);
  });

  it('false cuando linkDetalle es string vacío', () => {
    expect(debeActualizarLinkInmediato({ linkDetalle: '' })).toBe(false);
  });

  it('false para NC/manual (respuesta sin linkDetalle porque nunca se ejecuta la revalidación)', () => {
    expect(debeActualizarLinkInmediato({ actualizados: 1 })).toBe(false);
  });
});
