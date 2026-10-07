/**
 * Ajuste "UNIFICACIÓN SNC — MISMA UI, DISTINTA FUENTE POR EMPRESA" — tests
 * puros de `resolverCapacidadCatalogoSNC`/`empresaTieneCatalogoSNCPropio`.
 * La evidencia de POR QUÉ solo aseo/vigi tienen catálogo propio vive en el
 * docblock de `catalogo-snc-empresa.ts` (confirmado en vivo contra la
 * fuente real).
 */
import { describe, it, expect } from 'vitest';
import {
  resolverCapacidadCatalogoSNC, empresaTieneCatalogoSNCPropio,
  EMPRESAS_CON_CATALOGO_SNC_PROPIO,
} from './catalogo-snc-empresa';

describe('resolverCapacidadCatalogoSNC', () => {
  it('ASEOCOLBA → catálogo disponible, código "aseo"', () => {
    expect(resolverCapacidadCatalogoSNC('ASEOCOLBA')).toEqual({ disponibleCatalogo: true, codigoEmpresaCatalogo: 'aseo' });
  });

  it('VIGICOLBA → catálogo disponible, código "vigi"', () => {
    expect(resolverCapacidadCatalogoSNC('VIGICOLBA')).toEqual({ disponibleCatalogo: true, codigoEmpresaCatalogo: 'vigi' });
  });

  it('TEMPOCOLBA → catálogo NO disponible (confirmado: la fuente real cae al catálogo de Aseocolba, nunca uno propio)', () => {
    expect(resolverCapacidadCatalogoSNC('TEMPOCOLBA')).toEqual({ disponibleCatalogo: false, codigoEmpresaCatalogo: null });
  });

  it('TRANSCOLBA → catálogo NO disponible (mismo caso que Tempocolba)', () => {
    expect(resolverCapacidadCatalogoSNC('TRANSCOLBA')).toEqual({ disponibleCatalogo: false, codigoEmpresaCatalogo: null });
  });

  it('empresa vacía/no reconocida ("") → catálogo NO disponible, nunca cae a Aseocolba por defecto', () => {
    expect(resolverCapacidadCatalogoSNC('')).toEqual({ disponibleCatalogo: false, codigoEmpresaCatalogo: null });
  });
});

describe('empresaTieneCatalogoSNCPropio — whitelist usada por la ruta backend', () => {
  it('aseo/vigi → true', () => {
    expect(empresaTieneCatalogoSNCPropio('aseo')).toBe(true);
    expect(empresaTieneCatalogoSNCPropio('vigi')).toBe(true);
  });

  it('tempo/trans → false (sin catálogo propio confirmado)', () => {
    expect(empresaTieneCatalogoSNCPropio('tempo')).toBe(false);
    expect(empresaTieneCatalogoSNCPropio('trans')).toBe(false);
  });

  it('cualquier código no reconocido → false, nunca un default silencioso', () => {
    expect(empresaTieneCatalogoSNCPropio('')).toBe(false);
    expect(empresaTieneCatalogoSNCPropio('ASEO')).toBe(false); // case-sensitive, mismo criterio que dotacion-ext/insumos-ext
    expect(empresaTieneCatalogoSNCPropio('cualquier-cosa')).toBe(false);
  });

  it('la whitelist expuesta contiene EXACTAMENTE aseo/vigi, nada más', () => {
    expect([...EMPRESAS_CON_CATALOGO_SNC_PROPIO].sort()).toEqual(['aseo', 'vigi']);
  });
});
