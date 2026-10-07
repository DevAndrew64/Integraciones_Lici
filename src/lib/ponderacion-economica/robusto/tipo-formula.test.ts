import { describe, it, expect } from 'vitest';
import { mapearTipoFormula, MAPA_TIPO_FORMULA, TIPOS_FORMULA_MAPEABLES } from './tipo-formula';
import { FORMULA_KEYS } from '../formulas';
import { TIPOS_FORMULA_VALIDOS } from '../extraccionSchema';

describe('mapearTipoFormula — mapeo exacto', () => {
  it('mediana → mediana', () => {
    expect(mapearTipoFormula('mediana')).toEqual({ ok: true, formulaKey: 'mediana', entrada: 'mediana' });
  });

  it('media_geometrica_presupuesto (extracción) → media_geometrica_con_presupuesto (motor)', () => {
    const r = mapearTipoFormula('media_geometrica_presupuesto');
    expect(r).toEqual({ ok: true, formulaKey: 'media_geometrica_con_presupuesto', entrada: 'media_geometrica_presupuesto' });
  });

  it('media_geometrica_con_presupuesto (deletreo del motor) también mapea', () => {
    expect(mapearTipoFormula('media_geometrica_con_presupuesto').ok).toBe(true);
  });

  it.each(['media_geometrica', 'media_aritmetica', 'media_aritmetica_baja', 'media_aritmetica_alta', 'menor_valor'])(
    '%s mapea 1:1',
    tf => {
      const r = mapearTipoFormula(tf);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.formulaKey).toBe(tf);
    },
  );

  it('desconocida → REQUIERE_REVISION', () => {
    const r = mapearTipoFormula('desconocida');
    expect(r).toMatchObject({ ok: false, motivo: 'REQUIERE_REVISION' });
  });

  it('personalizada → REQUIERE_REVISION', () => {
    expect(mapearTipoFormula('personalizada')).toMatchObject({ ok: false, motivo: 'REQUIERE_REVISION' });
  });

  it('valor no listado → NO_MAPEABLE (sin fuzzy matching)', () => {
    expect(mapearTipoFormula('Media Geométrica')).toMatchObject({ ok: false, motivo: 'NO_MAPEABLE' });
    expect(mapearTipoFormula('mediana ')).toMatchObject({ ok: false, motivo: 'NO_MAPEABLE' });
    expect(mapearTipoFormula('MEDIANA')).toMatchObject({ ok: false, motivo: 'NO_MAPEABLE' });
    expect(mapearTipoFormula('')).toMatchObject({ ok: false, motivo: 'NO_MAPEABLE' });
    expect(mapearTipoFormula(null)).toMatchObject({ ok: false, motivo: 'NO_MAPEABLE' });
    expect(mapearTipoFormula(undefined)).toMatchObject({ ok: false, motivo: 'NO_MAPEABLE' });
  });
});

describe('cobertura del mapa', () => {
  it('todo destino no-null es un FormulaKey real del motor', () => {
    for (const [k, v] of Object.entries(MAPA_TIPO_FORMULA)) {
      if (v !== null) expect(FORMULA_KEYS).toContain(v);
      void k;
    }
  });

  it('cada valor de TIPOS_FORMULA_VALIDOS (extracción) está contemplado en el mapa', () => {
    for (const tf of TIPOS_FORMULA_VALIDOS) {
      expect(tf in MAPA_TIPO_FORMULA).toBe(true);
    }
  });

  it('desconocida y personalizada son los únicos válidos que NO son mapeables', () => {
    const noMapeables = (TIPOS_FORMULA_VALIDOS as readonly string[]).filter(
      tf => !TIPOS_FORMULA_MAPEABLES.includes(tf),
    );
    expect(new Set(noMapeables)).toEqual(new Set(['desconocida', 'personalizada']));
  });
});
