import { describe, expect, it } from 'vitest';
import { normalizarCodigoGrupoEpp, validarCodigoGrupoEpp, filtrarPorGrupoEpp, filasEppDesdeGrupo } from './catalogo-epp-grupo';

describe('validarCodigoGrupoEpp', () => {
  it('acepta EP + números en cualquier combinación de mayúsculas y con espacios, y lo normaliza', () => {
    expect(validarCodigoGrupoEpp('EP001')).toEqual({ ok: true, codigo: 'EP001' });
    expect(validarCodigoGrupoEpp('  ep021 ')).toEqual({ ok: true, codigo: 'EP021' });
    expect(validarCodigoGrupoEpp('Ep450')).toEqual({ ok: true, codigo: 'EP450' });
  });
  it('rechaza vacío y formatos que no son de EPP (p. ej. códigos de Dotación M001/F001)', () => {
    expect(validarCodigoGrupoEpp('').ok).toBe(false);
    expect(validarCodigoGrupoEpp('   ').ok).toBe(false);
    expect(validarCodigoGrupoEpp('M001').ok).toBe(false);
    expect(validarCodigoGrupoEpp('F001').ok).toBe(false);
    expect(validarCodigoGrupoEpp('EP').ok).toBe(false);
    expect(validarCodigoGrupoEpp('EP12A').ok).toBe(false);
    expect(validarCodigoGrupoEpp('EP001; DROP').ok).toBe(false);
  });
  it('el mensaje de error nombra el ejemplo EP001', () => {
    const v = validarCodigoGrupoEpp('M001');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.mensaje).toContain('EP001');
  });
});

describe('normalizarCodigoGrupoEpp', () => {
  it('trim + mayúsculas; null/undefined → vacío', () => {
    expect(normalizarCodigoGrupoEpp(' ep7 ')).toBe('EP7');
    expect(normalizarCodigoGrupoEpp(null)).toBe('');
    expect(normalizarCodigoGrupoEpp(undefined)).toBe('');
  });
});

describe('filtrarPorGrupoEpp — coincidencia EXACTA, nunca por subcadena', () => {
  const filas = [
    { codigo: '1', codgrp: 'EP001' },
    { codigo: '2', codgrp: 'EP0010' },
    { codigo: '3', codgrp: 'ep001' },
    { codigo: '4', codgrp: '' },
    { codigo: '5' },
  ];
  it('EP001 trae EP001 y ep001, no EP0010 ni las filas sin grupo', () => {
    expect(filtrarPorGrupoEpp(filas, 'EP001').map(f => f.codigo)).toEqual(['1', '3']);
  });
  it('un grupo inexistente no trae nada', () => {
    expect(filtrarPorGrupoEpp(filas, 'EP999')).toEqual([]);
  });
});

describe('filasEppDesdeGrupo — filas listas para agregar', () => {
  const item = (o: Record<string, unknown>) => ({
    codigo: '18111', nombre: 'LENTE CLARO', undmed: 'UND', valor: 2550, codgrp: 'EP021',
    fecha_ultima_compra: '2026-09-14',
    cantidadEstadoApi: 'api', cantidadApi: 1, frecuenciaEstadoApi: 'api', frecuenciaApi: 6, ...o,
  });

  it('cada producto sale con cant/frec del catálogo bloqueadas y el grupo pedido', () => {
    const r = filasEppDesdeGrupo([item({})], 'ep021', new Set());
    expect(r.sinValor).toBe(0);
    expect(r.yaAgregados).toBe(0);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]).toMatchObject({
      codigo: '18111', desc: 'LENTE CLARO', medida: 'UND', vUnit: 2550, codigoGrupo: 'EP021',
      fechaUltimaCompra: '2026-09-14', cant: 1, frec: 6, cantEstadoApi: 'api', frecEstadoApi: 'api',
    });
  });

  it('un producto con 0 en el catálogo queda editable (1 por defecto) y marcado como no definido', () => {
    const r = filasEppDesdeGrupo(
      [item({ codigo: '2', cantidadEstadoApi: 'no_definido', cantidadApi: 0, frecuenciaEstadoApi: 'api', frecuenciaApi: 3 })],
      'EP021', new Set());
    expect(r.filas[0]).toMatchObject({ cant: 1, frec: 3, cantEstadoApi: 'no_definido', frecEstadoApi: 'api' });
  });

  it('omite (y cuenta) los productos sin valor vigente', () => {
    const r = filasEppDesdeGrupo([item({ valor: 0 }), item({ codigo: '3', valor: undefined }), item({ codigo: '4' })], 'EP021', new Set());
    expect(r.sinValor).toBe(2);
    expect(r.filas.map(f => f.codigo)).toEqual(['4']);
  });

  it('no duplica productos que la línea ya tenía ni repetidos dentro del mismo grupo', () => {
    const r = filasEppDesdeGrupo(
      [item({ codigo: 'A1' }), item({ codigo: 'A1' }), item({ codigo: 'B2' }), item({ codigo: 'C3' })],
      'EP021', new Set(['c3']));
    expect(r.filas.map(f => f.codigo)).toEqual(['A1', 'B2']);
    expect(r.yaAgregados).toBe(2);
  });

  it('un item sin resolución del servidor mantiene el comportamiento histórico (1/1 sin estado)', () => {
    const r = filasEppDesdeGrupo([{ codigo: '9', nombre: 'Casco', valor: 5000 }], 'EP001', new Set());
    expect(r.filas[0]).toMatchObject({ cant: 1, frec: 1 });
    expect(r.filas[0].cantEstadoApi).toBeUndefined();
  });
});
