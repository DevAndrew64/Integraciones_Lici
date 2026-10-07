import { describe, it, expect, vi } from 'vitest';

// Prisma mockeado: las pruebas no tocan la BD
vi.mock('@/lib/prisma', () => ({ default: {} }));

import {
  clasificarPresentacion, porcentajePresentacion, participacionPresentadosSobreTotal,
  construirTotales, type ProcesoClasificable,
} from './clasificacion';
import {
  generarApiKey, extraerPrefijo, hashApiKey, verificarClaveContraRegistro,
  RateLimiterMemoria, type ApiClientRegistro,
} from './auth';
import { parsearFiltros, normalizarPaginacion, PAGE_SIZE_MAX } from './indicadores';

const AHORA = new Date('2026-07-11T12:00:00Z');

function proceso(over: Partial<ProcesoClasificable> = {}): ProcesoClasificable {
  return { noViable: false, oculto: false, fechaVencimiento: null, solicitud: null, ...over };
}

function solicitud(over: Partial<NonNullable<ProcesoClasificable['solicitud']>> = {}) {
  return { estadoSolicitud: 'En revisión', estadoRevisionUltimo: null, resultadoFinal: null, ...over };
}

// ─── Clasificación ───────────────────────────────────────────────────────────

describe('clasificarPresentacion', () => {
  it('PRESENTADO por estadoRevision (incluye cerrados post-presentación)', () => {
    for (const rev of ['PRESENTADO', 'CERRADO_ADJUDICADO', 'CERRADO_NO_ADJUDICADO', 'CERRADO_NO_CUMPLIMIENTO']) {
      expect(clasificarPresentacion(proceso({ solicitud: solicitud({ estadoRevisionUltimo: rev }) }), AHORA)).toBe('PRESENTADO');
    }
  });

  it('PRESENTADO por estadoSolicitud o resultadoFinal', () => {
    expect(clasificarPresentacion(proceso({ solicitud: solicitud({ estadoSolicitud: 'Listo para presentar - PRESENTADO' }) }), AHORA)).toBe('PRESENTADO');
    expect(clasificarPresentacion(proceso({ solicitud: solicitud({ resultadoFinal: 'Adjudicado' }) }), AHORA)).toBe('PRESENTADO');
    expect(clasificarPresentacion(proceso({ solicitud: solicitud({ resultadoFinal: 'No adjudicado' }) }), AHORA)).toBe('PRESENTADO');
  });

  it('NO_PRESENTADO solo con decisión definitiva (no por descarte)', () => {
    expect(clasificarPresentacion(proceso({ solicitud: solicitud({ estadoRevisionUltimo: 'RECHAZADO' }) }), AHORA)).toBe('NO_PRESENTADO');
    expect(clasificarPresentacion(proceso({ solicitud: solicitud({ estadoSolicitud: 'Cerrada' }) }), AHORA)).toBe('NO_PRESENTADO');
    expect(clasificarPresentacion(proceso({ solicitud: solicitud({ resultadoFinal: 'No favorable' }) }), AHORA)).toBe('NO_PRESENTADO');
  });

  it('PENDIENTE: solicitud en gestión o proceso sin vencer', () => {
    expect(clasificarPresentacion(proceso({ solicitud: solicitud({ estadoSolicitud: 'En revisión' }) }), AHORA)).toBe('PENDIENTE');
    expect(clasificarPresentacion(proceso({ fechaVencimiento: new Date('2026-08-01') }), AHORA)).toBe('PENDIENTE');
  });

  it('NO_APLICA: noViable, oculto o solicitud cancelada', () => {
    expect(clasificarPresentacion(proceso({ noViable: true }), AHORA)).toBe('NO_APLICA');
    expect(clasificarPresentacion(proceso({ oculto: true }), AHORA)).toBe('NO_APLICA');
    expect(clasificarPresentacion(proceso({ solicitud: solicitud({ estadoSolicitud: 'Cancelada' }) }), AHORA)).toBe('NO_APLICA');
  });

  it('SIN_INFORMACION: vencido sin gestión, o sin fecha ni solicitud', () => {
    expect(clasificarPresentacion(proceso({ fechaVencimiento: new Date('2026-01-01') }), AHORA)).toBe('SIN_INFORMACION');
    expect(clasificarPresentacion(proceso(), AHORA)).toBe('SIN_INFORMACION');
  });
});

// ─── Fórmulas ────────────────────────────────────────────────────────────────

describe('fórmulas de indicadores', () => {
  it('porcentajePresentacion = presentados / (presentados+noPresentados) × 100', () => {
    expect(porcentajePresentacion(45, 30)).toBe(60);
    expect(porcentajePresentacion(1, 3)).toBe(25);
  });

  it('división por cero → null (no 0 ni NaN)', () => {
    expect(porcentajePresentacion(0, 0)).toBeNull();
    expect(participacionPresentadosSobreTotal(0, 0)).toBeNull();
  });

  it('participación usa el total como denominador (indicador distinto)', () => {
    expect(participacionPresentadosSobreTotal(45, 120)).toBe(37.5);
    // mismo caso, fórmulas distintas:
    expect(porcentajePresentacion(45, 30)).not.toBe(participacionPresentadosSobreTotal(45, 120));
  });

  it('la suma de categorías es igual al total', () => {
    const t = construirTotales({ PRESENTADO: 45, NO_PRESENTADO: 30, PENDIENTE: 25, NO_APLICA: 15, SIN_INFORMACION: 5 });
    expect(t.totalProcesos).toBe(120);
    expect(t.presentados + t.noPresentados + t.pendientes + t.noAplica + t.sinInformacion).toBe(t.totalProcesos);
  });
});

// ─── API Keys ────────────────────────────────────────────────────────────────

function registro(over: Partial<ApiClientRegistro> = {}): ApiClientRegistro {
  const { key, hash } = generarApiKey();
  return {
    id: 1, nombre: 'test', apiKeyHash: hash, activo: true,
    scopes: ['procesos:indicadores:read'], empresasPermitidas: [],
    rateLimitPorMinuto: 60, expiraEn: null,
    // truco: la clave real correspondiente queda en (registro as any)._key
    ...( { _key: key } as object ),
    ...over,
  } as ApiClientRegistro & { _key: string };
}

describe('autenticación por API Key', () => {
  it('formato y prefijo', () => {
    const { key, prefix } = generarApiKey();
    expect(key.startsWith('lcb_')).toBe(true);
    expect(extraerPrefijo(key)).toBe(prefix);
    expect(extraerPrefijo('cualquier-cosa')).toBeNull();
    expect(extraerPrefijo('')).toBeNull();
  });

  it('clave válida con scope correcto → ok', () => {
    const r = registro() as ApiClientRegistro & { _key: string };
    expect(verificarClaveContraRegistro(r._key, r, 'procesos:indicadores:read', AHORA)).toEqual({ ok: true });
  });

  it('clave inválida (hash no coincide) y registro inexistente', () => {
    const r = registro() as ApiClientRegistro & { _key: string };
    const otra = generarApiKey().key;
    expect(verificarClaveContraRegistro(otra, r, 'procesos:indicadores:read', AHORA)).toEqual({ ok: false, error: 'clave_invalida' });
    expect(verificarClaveContraRegistro(otra, null, 'procesos:indicadores:read', AHORA)).toEqual({ ok: false, error: 'clave_invalida' });
  });

  it('clave deshabilitada', () => {
    const r = registro({ activo: false }) as ApiClientRegistro & { _key: string };
    expect(verificarClaveContraRegistro(r._key, r, 'procesos:indicadores:read', AHORA)).toEqual({ ok: false, error: 'clave_deshabilitada' });
  });

  it('clave expirada', () => {
    const r = registro({ expiraEn: new Date('2026-01-01') }) as ApiClientRegistro & { _key: string };
    expect(verificarClaveContraRegistro(r._key, r, 'procesos:indicadores:read', AHORA)).toEqual({ ok: false, error: 'clave_expirada' });
  });

  it('scope insuficiente (detalle requiere procesos:detalle:read)', () => {
    const r = registro() as ApiClientRegistro & { _key: string };
    expect(verificarClaveContraRegistro(r._key, r, 'procesos:detalle:read', AHORA)).toEqual({ ok: false, error: 'scope_insuficiente' });
  });

  it('el hash nunca es la clave y no se puede derivar trivialmente', () => {
    const { key, hash } = generarApiKey();
    expect(hash).not.toContain(key);
    expect(hash).toHaveLength(64);
    expect(hashApiKey(key)).toBe(hash);
  });

  it('rate limit: bloquea al exceder la ventana y se resetea al minuto siguiente', () => {
    const rl = new RateLimiterMemoria();
    const t0 = Date.parse('2026-07-11T12:00:00Z');
    for (let i = 0; i < 3; i++) expect(rl.permitir(1, 3, t0 + i * 1000)).toBe(true);
    expect(rl.permitir(1, 3, t0 + 4000)).toBe(false);          // 4ª en el mismo minuto
    expect(rl.permitir(2, 3, t0 + 4000)).toBe(true);           // otro cliente no se afecta
    expect(rl.permitir(1, 3, t0 + 61_000)).toBe(true);         // minuto siguiente
  });
});

// ─── Filtros y paginación ────────────────────────────────────────────────────

describe('filtros whitelisted', () => {
  const parse = (qs: string, empresas: string[] = []) => parsearFiltros(new URLSearchParams(qs), empresas);

  it('acepta filtros válidos y aplica defaults', () => {
    const r = parse('anio=2026&mes=7&empresa=ASEOCOLBA&fuente=S2');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.filtros.anio).toBe(2026);
      expect(r.filtros.mes).toBe(7);
      expect(r.filtros.fechaReferencia).toBe('registro');
    }
  });

  it('rechaza valores fuera de whitelist', () => {
    expect(parse('mes=13&anio=2026').ok).toBe(false);
    expect(parse('anio=1800').ok).toBe(false);
    expect(parse('fechaDesde=07/11/2026').ok).toBe(false);
    expect(parse('fechaReferencia=updatedAt').ok).toBe(false);   // no se aceptan columnas arbitrarias
    expect(parse('categoria=GANADO').ok).toBe(false);
    expect(parse('mes=7').ok).toBe(false);                        // mes sin anio
  });

  it('empresasPermitidas restringe el filtro empresa', () => {
    expect(parse('empresa=VIGICOLBA', ['ASEOCOLBA']).ok).toBe(false);
    const r = parse('empresa=ASEOCOLBA', ['ASEOCOLBA']);
    expect(r.ok).toBe(true);
  });

  it('paginación: defaults y límites', () => {
    expect(normalizarPaginacion(null, null)).toEqual({ page: 1, pageSize: 25 });
    expect(normalizarPaginacion('0', '500')).toEqual({ page: 1, pageSize: PAGE_SIZE_MAX });
    expect(normalizarPaginacion('3', '50')).toEqual({ page: 3, pageSize: 50 });
    expect(normalizarPaginacion('abc', 'xyz')).toEqual({ page: 1, pageSize: 25 });
  });
});
