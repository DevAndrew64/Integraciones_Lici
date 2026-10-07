/**
 * FASE B.4.4 §8 — tests del equivalente canónico de clasificación de
 * origen/actualizabilidad (sin BD, sin red).
 */
import { describe, it, expect } from 'vitest';
import {
  origenCanonicoDeProceso,
  puedeActualizarDesdeDataApi,
  esSourceKeyLocal,
  esSourceKeyManualOLocal,
  whereExcluirManual,
  sqlExcluirManual,
  condicionFuente,
  sqlAliasFuenteEfectivo,
  PREFIJO_SOURCE_KEY_LOCAL,
  PREFIJO_SOURCE_KEY_MANUAL_LEGACY,
} from './origenCanonico';

describe('esSourceKeyLocal', () => {
  it('reconoce el prefijo local: (case-insensitive, con espacios)', () => {
    expect(esSourceKeyLocal('local:abc-123')).toBe(true);
    expect(esSourceKeyLocal('LOCAL:abc-123')).toBe(true);
    expect(esSourceKeyLocal('  local:abc-123  ')).toBe(true);
  });
  it('NUNCA reconoce el prefijo legacy manual: como local', () => {
    expect(esSourceKeyLocal('manual:algo')).toBe(false);
  });
  it('null/undefined/vacío → false', () => {
    expect(esSourceKeyLocal(null)).toBe(false);
    expect(esSourceKeyLocal(undefined)).toBe(false);
    expect(esSourceKeyLocal('')).toBe(false);
  });
  it('un UUID opaco de la Data API (sin prefijo) no es local', () => {
    expect(esSourceKeyLocal('35bf171a-ff3d-4230-bcd0-1336e4254a97')).toBe(false);
  });
  it('el prefijo exportado es exactamente "local:"', () => {
    expect(PREFIJO_SOURCE_KEY_LOCAL).toBe('local:');
  });
});

describe('origenCanonicoDeProceso', () => {
  it('devuelve origenFuncional tal cual cuando está presente', () => {
    expect(origenCanonicoDeProceso({ origenFuncional: 'PUBLICO_ABIERTO' })).toBe('PUBLICO_ABIERTO');
    expect(origenCanonicoDeProceso({ origenFuncional: 'MANUAL' })).toBe('MANUAL');
  });
  it('sin origenFuncional (legacy sin backfill) → DESCONOCIDO, nunca inventado', () => {
    expect(origenCanonicoDeProceso({})).toBe('DESCONOCIDO');
    expect(origenCanonicoDeProceso({ origenFuncional: null })).toBe('DESCONOCIDO');
  });
});

describe('puedeActualizarDesdeDataApi', () => {
  it('proceso con disponibleDataApi=true y origenFuncional no-MANUAL → SÍ', () => {
    expect(puedeActualizarDesdeDataApi({ disponibleDataApi: true, origenFuncional: 'PUBLICO_ABIERTO', sourceKey: 'uuid-opaco' })).toBe(true);
  });
  it('proceso MANUAL → NO, aunque disponibleDataApi fuera true por error', () => {
    expect(puedeActualizarDesdeDataApi({ disponibleDataApi: true, origenFuncional: 'MANUAL', sourceKey: 'uuid-opaco' })).toBe(false);
  });
  it('proceso con sourceKey local: → NO, sin importar disponibleDataApi', () => {
    expect(puedeActualizarDesdeDataApi({ disponibleDataApi: true, origenFuncional: 'PUBLICO_ABIERTO', sourceKey: 'local:abc' })).toBe(false);
  });
  it('C2.2-d — proceso con sourceKey manual: (legacy migrado, sin origenFuncional backfillado) → NO', () => {
    expect(puedeActualizarDesdeDataApi({ disponibleDataApi: true, origenFuncional: 'PUBLICO_ABIERTO', sourceKey: 'manual:legacy-1' })).toBe(false);
  });
  it('disponibleDataApi=false → NO', () => {
    expect(puedeActualizarDesdeDataApi({ disponibleDataApi: false, origenFuncional: 'PUBLICO_ABIERTO', sourceKey: 'uuid-opaco' })).toBe(false);
  });
  it('disponibleDataApi ausente (undefined/null) → NO (fail-closed, nunca asume actualizable)', () => {
    expect(puedeActualizarDesdeDataApi({ origenFuncional: 'PUBLICO_ABIERTO', sourceKey: 'uuid-opaco' })).toBe(false);
    expect(puedeActualizarDesdeDataApi({ disponibleDataApi: null, origenFuncional: 'PUBLICO_ABIERTO', sourceKey: 'uuid-opaco' })).toBe(false);
  });
});

describe('esSourceKeyManualOLocal — C2.2-d, ambos universos de identidad manual', () => {
  it('reconoce local: (candidata nativo) y manual: (legacy migrado)', () => {
    expect(esSourceKeyManualOLocal('local:abc')).toBe(true);
    expect(esSourceKeyManualOLocal('manual:abc')).toBe(true);
    expect(esSourceKeyManualOLocal('MANUAL:abc')).toBe(true);
  });
  it('un sourceKey real (uuid opaco / ext: / sin prefijo especial) → false', () => {
    expect(esSourceKeyManualOLocal('35bf171a-ff3d-4230-bcd0-1336e4254a97')).toBe(false);
    expect(esSourceKeyManualOLocal('ext:123')).toBe(false);
  });
  it('el prefijo legacy exportado es exactamente "manual:"', () => {
    expect(PREFIJO_SOURCE_KEY_MANUAL_LEGACY).toBe('manual:');
  });
});

describe('whereExcluirManual — C2.2-d', () => {
  it('produce EXACTAMENTE la forma: OR(origenFuncional null | not MANUAL) AND NOT local: AND NOT manual:', () => {
    expect(whereExcluirManual()).toEqual({
      AND: [
        { OR: [{ origenFuncional: null }, { NOT: { origenFuncional: 'MANUAL' } }] },
        { NOT: { sourceKey: { startsWith: 'local:' } } },
        { NOT: { sourceKey: { startsWith: 'manual:' } } },
      ],
    });
  });
});

describe('sqlExcluirManual — C2.2-d (equivalente crudo para $queryRawUnsafe)', () => {
  it('genera la misma exclusión en SQL, sin alias', () => {
    expect(sqlExcluirManual()).toBe(
      `("origenFuncional" IS NULL OR "origenFuncional" <> 'MANUAL') AND "sourceKey" NOT LIKE 'local:%' AND "sourceKey" NOT LIKE 'manual:%'`,
    );
  });
});

describe('condicionFuente — D11 (fallback a origenFuncional cuando aliasFuente es null)', () => {
  it('S2 → aliasFuente=S2 directo, o aliasFuente null + origenFuncional=PUBLICO_REGISTRADO', () => {
    expect(condicionFuente('S2')).toEqual({
      OR: [{ aliasFuente: { equals: 'S2' } }, { AND: [{ aliasFuente: null }, { origenFuncional: 'PUBLICO_REGISTRADO' }] }],
    });
    expect(condicionFuente('s2')).toEqual(condicionFuente('S2')); // insensible a mayúsculas
  });
  it('S1 → aliasFuente=S1 directo, o aliasFuente null + origenFuncional=PUBLICO_ABIERTO', () => {
    expect(condicionFuente('S1')).toEqual({
      OR: [{ aliasFuente: { equals: 'S1' } }, { AND: [{ aliasFuente: null }, { origenFuncional: 'PUBLICO_ABIERTO' }] }],
    });
  });
  it('cualquier otro valor (p.ej. NC) → igualdad directa por aliasFuente, sin fallback', () => {
    expect(condicionFuente('NC')).toEqual({ aliasFuente: 'NC' });
    expect(condicionFuente('nc')).toEqual({ aliasFuente: 'NC' });
  });
});

describe('sqlAliasFuenteEfectivo — D12 (equivalente crudo para $queryRawUnsafe)', () => {
  it('genera el COALESCE con el CASE de origenFuncional y sentinela vacío, sin alias', () => {
    expect(sqlAliasFuenteEfectivo()).toBe(
      `COALESCE("aliasFuente", CASE "origenFuncional" WHEN 'PUBLICO_REGISTRADO' THEN 'S2' WHEN 'PUBLICO_ABIERTO' THEN 'S1' END, '')`,
    );
  });
  it('con alias de tabla, califica cada columna', () => {
    expect(sqlAliasFuenteEfectivo('p.')).toBe(
      `COALESCE(p."aliasFuente", CASE p."origenFuncional" WHEN 'PUBLICO_REGISTRADO' THEN 'S2' WHEN 'PUBLICO_ABIERTO' THEN 'S1' END, '')`,
    );
  });
});
