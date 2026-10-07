import { describe, expect, it } from 'vitest';
import {
  construirSujetoDotacionKey, resolverCategoriaDotGroup, resolverTipoDotacionHistorico,
  resolverTipoDotacionEfectivo, obtenerCategoriasActivas, filtrarGruposActivos,
  agruparGruposPorSujeto, detectarConfiguracionReal,
} from './dotacion-epp-tipo';

describe('construirSujetoDotacionKey', () => {
  it('1) construye la llave manoObra:id', () => {
    expect(construirSujetoDotacionKey('manoObra', 1)).toBe('manoObra:1');
  });
  it('2) construye la llave turnante:id', () => {
    expect(construirSujetoDotacionKey('turnante', 'turnante-1')).toBe('turnante:turnante-1');
  });
});

describe('resolverCategoriaDotGroup', () => {
  it('3) resuelve categorías históricas por nombre (Hombre/Mujer/EPP)', () => {
    expect(resolverCategoriaDotGroup({ tipo: 'dot', nombre: 'Hombre' })).toBe('DOTACION_MASCULINA');
    expect(resolverCategoriaDotGroup({ tipo: 'dot', nombre: 'Mujer' })).toBe('DOTACION_FEMENINA');
    expect(resolverCategoriaDotGroup({ tipo: 'epp', nombre: 'EPP' })).toBe('EPP');
  });
  it('resuelve variantes Masculino/Femenino', () => {
    expect(resolverCategoriaDotGroup({ tipo: 'dot', nombre: 'Masculino' })).toBe('DOTACION_MASCULINA');
    expect(resolverCategoriaDotGroup({ tipo: 'dot', nombre: 'Femenino' })).toBe('DOTACION_FEMENINA');
  });
  it('4) prefiere la categoria canónica explícita sobre el nombre', () => {
    expect(resolverCategoriaDotGroup({ tipo: 'dot', nombre: 'Mujer', categoria: 'DOTACION_MASCULINA' })).toBe('DOTACION_MASCULINA');
  });
  it('un grupo dot histórico con nombre no reconocido no se clasifica (null), nunca se pierde', () => {
    expect(resolverCategoriaDotGroup({ tipo: 'dot', nombre: 'Uniforme genérico' })).toBeNull();
  });
});

describe('resolverTipoDotacionHistorico — inferencia (§3)', () => {
  it('5) masculino con ítems + femenino vacío → MASCULINA', () => {
    const t = resolverTipoDotacionHistorico([
      { categoria: 'DOTACION_MASCULINA', tieneItems: true },
      { categoria: 'DOTACION_FEMENINA', tieneItems: false },
    ]);
    expect(t).toBe('MASCULINA');
  });
  it('6) femenino con ítems + masculino vacío → FEMENINA', () => {
    const t = resolverTipoDotacionHistorico([
      { categoria: 'DOTACION_MASCULINA', tieneItems: false },
      { categoria: 'DOTACION_FEMENINA', tieneItems: true },
    ]);
    expect(t).toBe('FEMENINA');
  });
  it('7) ambos con ítems → AMBAS', () => {
    const t = resolverTipoDotacionHistorico([
      { categoria: 'DOTACION_MASCULINA', tieneItems: true },
      { categoria: 'DOTACION_FEMENINA', tieneItems: true },
    ]);
    expect(t).toBe('AMBAS');
  });
  it('8) masculino y femenino vacíos, EPP con ítems → NO_REQUIERE_DOTACION', () => {
    const t = resolverTipoDotacionHistorico([
      { categoria: 'DOTACION_MASCULINA', tieneItems: false },
      { categoria: 'DOTACION_FEMENINA', tieneItems: false },
      { categoria: 'EPP', tieneItems: true },
    ]);
    expect(t).toBe('NO_REQUIERE_DOTACION');
  });
  it('9) los tres grupos vacíos (o ausentes) quedan SIN CONFIGURAR (undefined)', () => {
    expect(resolverTipoDotacionHistorico([
      { categoria: 'DOTACION_MASCULINA', tieneItems: false },
      { categoria: 'DOTACION_FEMENINA', tieneItems: false },
      { categoria: 'EPP', tieneItems: false },
    ])).toBeUndefined();
    expect(resolverTipoDotacionHistorico([])).toBeUndefined();
  });
});

describe('resolverTipoDotacionEfectivo', () => {
  it('10) el tipo explícito prevalece sobre cualquier inferencia histórica', () => {
    const efectivo = resolverTipoDotacionEfectivo({
      tipoExplicito: 'NO_REQUIERE_DOTACION',
      grupos: [
        { categoria: 'DOTACION_MASCULINA', tieneItems: true },
        { categoria: 'DOTACION_FEMENINA', tieneItems: true },
      ],
    });
    expect(efectivo).toBe('NO_REQUIERE_DOTACION');
  });
  it('sin tipo explícito, cae a la inferencia histórica', () => {
    const efectivo = resolverTipoDotacionEfectivo({
      grupos: [{ categoria: 'DOTACION_FEMENINA', tieneItems: true }],
    });
    expect(efectivo).toBe('FEMENINA');
  });
});

describe('obtenerCategoriasActivas / filtrarGruposActivos (§10)', () => {
  const grupos = [
    { id: 1, tipo: 'dot' as const, nombre: 'Hombre' },
    { id: 2, tipo: 'dot' as const, nombre: 'Mujer' },
    { id: 3, tipo: 'epp' as const, nombre: 'EPP' },
  ];
  it('11) FEMENINA activa solo femenina y EPP', () => {
    expect(obtenerCategoriasActivas('FEMENINA')).toEqual(['DOTACION_FEMENINA', 'EPP']);
    const activos = filtrarGruposActivos(grupos, 'FEMENINA');
    expect(activos.map(g => g.id)).toEqual([2, 3]);
  });
  it('12) MASCULINA activa solo masculina y EPP', () => {
    expect(obtenerCategoriasActivas('MASCULINA')).toEqual(['DOTACION_MASCULINA', 'EPP']);
    const activos = filtrarGruposActivos(grupos, 'MASCULINA');
    expect(activos.map(g => g.id)).toEqual([1, 3]);
  });
  it('13) AMBAS activa ambas y EPP', () => {
    expect(obtenerCategoriasActivas('AMBAS')).toEqual(['DOTACION_MASCULINA', 'DOTACION_FEMENINA', 'EPP']);
    const activos = filtrarGruposActivos(grupos, 'AMBAS');
    expect(activos.map(g => g.id)).toEqual([1, 2, 3]);
  });
  it('14) NO_REQUIERE_DOTACION activa solo EPP', () => {
    expect(obtenerCategoriasActivas('NO_REQUIERE_DOTACION')).toEqual(['EPP']);
    const activos = filtrarGruposActivos(grupos, 'NO_REQUIERE_DOTACION');
    expect(activos.map(g => g.id)).toEqual([3]);
  });
  it('15) SIN CONFIGURAR (undefined) no activa ningún grupo — nunca genera costo', () => {
    expect(obtenerCategoriasActivas(undefined)).toEqual([]);
    expect(filtrarGruposActivos(grupos, undefined)).toEqual([]);
  });
  it('16) EPP se incluye una sola vez en cualquier tipo que lo active, nunca duplicado por género', () => {
    for (const tipo of ['MASCULINA', 'FEMENINA', 'AMBAS', 'NO_REQUIERE_DOTACION'] as const) {
      const activos = filtrarGruposActivos(grupos, tipo);
      expect(activos.filter(g => g.tipo === 'epp')).toHaveLength(1);
    }
  });
  it('un grupo inactivo (ej. masculino bajo FEMENINA) se excluye del resultado pero permanece en el arreglo fuente (nunca se elimina)', () => {
    const activos = filtrarGruposActivos(grupos, 'FEMENINA');
    expect(activos.find(g => g.id === 1)).toBeUndefined();
    expect(grupos.find(g => g.id === 1)).toBeDefined(); // el arreglo original es intocado
  });
});

describe('agruparGruposPorSujeto', () => {
  it('agrupa por la clave de sujeto ya resuelta, sin asumir nombre/índice', () => {
    const items = [
      { id: 1, sujetoKey: 'manoObra:1' as const },
      { id: 2, sujetoKey: 'manoObra:1' as const },
      { id: 3, sujetoKey: 'turnante:1' as const },
    ];
    const mapa = agruparGruposPorSujeto(items, i => i.sujetoKey);
    expect(mapa.get('manoObra:1')?.map(i => i.id)).toEqual([1, 2]);
    expect(mapa.get('turnante:1')?.map(i => i.id)).toEqual([3]);
  });
  it('19) dos sujetos con el mismo nombre visible pero distinta llave nunca se mezclan', () => {
    const items = [
      { id: 1, sujetoKey: 'manoObra:1' as const, nombre: 'ASEADOR' },
      { id: 2, sujetoKey: 'manoObra:2' as const, nombre: 'ASEADOR' },
    ];
    const mapa = agruparGruposPorSujeto(items, i => i.sujetoKey);
    expect(mapa.size).toBe(2);
    expect(mapa.get('manoObra:1')).toHaveLength(1);
    expect(mapa.get('manoObra:2')).toHaveLength(1);
  });
  it('ignora items sin clave resoluble (null)', () => {
    const items = [{ id: 1 }, { id: 2 }];
    const mapa = agruparGruposPorSujeto(items, () => null);
    expect(mapa.size).toBe(0);
  });
});

describe('detectarConfiguracionReal (§9/§14)', () => {
  it('tipo explícito → siempre configuración real, aunque no haya ítems', () => {
    expect(detectarConfiguracionReal({ tipoExplicito: 'NO_REQUIERE_DOTACION', grupos: [] })).toBe(true);
  });
  it('sin tipo explícito, con al menos un grupo con ítems → configuración real', () => {
    expect(detectarConfiguracionReal({ grupos: [{ categoria: 'EPP', tieneItems: true }] })).toBe(true);
  });
  it('9/24) sin tipo explícito y todos los grupos vacíos (o ausentes) → sin configuración real, nunca se muestra', () => {
    expect(detectarConfiguracionReal({ grupos: [{ categoria: 'DOTACION_MASCULINA', tieneItems: false }] })).toBe(false);
    expect(detectarConfiguracionReal({ grupos: [] })).toBe(false);
  });
});
