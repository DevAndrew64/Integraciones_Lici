import { describe, expect, it } from 'vitest';
import { PARAMETROS_FINANCIEROS_2026_DEFAULT } from './parametros-financieros-default';

describe('PARAMETROS_FINANCIEROS_2026_DEFAULT — extracción neutral (§1, prueba #1)', () => {
  it('1) conserva exactamente los valores que tenía en liquidador-mo.ts (sin cambios financieros)', () => {
    expect(PARAMETROS_FINANCIEROS_2026_DEFAULT).toEqual({
      divisorHora: 220,
      jornadaMaxSemana: 44,
      pctVacaciones: 5,
      pctPension: 12,
      pctArlPorClase: { I: 0.522, II: 1.044, III: 2.436, IV: 4.35, V: 6.96 },
      pctCaja: 4,
      pctCesantias: 8.33,
      pctPrima: 8.33,
      pctIntCesantias: 1,
      pctSalud: 8.5,
      pctSena: 2,
      pctIcbf: 3,
      exoneracionParafiscal: false,
      modoRecargoNocturno: 'hora_completa',
      factoresDominicales: 'vigentes',
      auxTransporteLegal: 249095,
    });
  });
});