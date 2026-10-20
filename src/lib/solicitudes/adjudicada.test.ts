import { describe, expect, it } from 'vitest';
import { esAdjudicada } from './adjudicada';

describe('esAdjudicada', () => {
  it('un proceso cerrado antes (resultadoFinal vacío) cuenta como adjudicado por su última asignación', () => {
    expect(esAdjudicada({ resultadoFinal: null, asignaciones: [{ estadoRevision: 'EN_EJECUCION' }, { estadoRevision: 'CERRADO_ADJUDICADO' }] })).toBe(true);
    expect(esAdjudicada({ resultadoFinal: null, asignaciones: [{ estadoRevision: 'CERRADO_ADJUDICADO' }, { estadoRevision: 'CERRADO_NO_ADJUDICADO' }] })).toBe(false);
    expect(esAdjudicada({ resultadoFinal: null, asignaciones: [] })).toBe(false);
    expect(esAdjudicada({ resultadoFinal: null, asignaciones: 'x' })).toBe(false);
    expect(esAdjudicada(null)).toBe(false);
  });
  it('con resultadoFinal lleno, manda', () => {
    expect(esAdjudicada({ resultadoFinal: 'Adjudicado' })).toBe(true);
    expect(esAdjudicada({ resultadoFinal: 'No adjudicado', asignaciones: [{ estadoRevision: 'CERRADO_ADJUDICADO' }] })).toBe(false);
  });
});
