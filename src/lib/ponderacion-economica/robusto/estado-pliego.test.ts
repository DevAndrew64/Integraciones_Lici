import { describe, it, expect } from 'vitest';
import { computarEstadoRevisionPliego, evaluarGateUsoPonderacionTrm, type InsumosEstadoPliego } from './estado-pliego';

const base: InsumosEstadoPliego = {
  usaPonderacionTrm: 'SI',
  reglaActiva: { reglaCentavos: 'REDONDEO' },
  reglaCandidataPendiente: false,
  conjuntoActivo: { criteriosOk: true, presupuestoOficialAprobado: 500_000_000, puntajeMaximoEconomicoAprobado: 40 },
  conjuntoCandidatoPendiente: false,
  huboAlgunAnalisis: true,
};

describe('computarEstadoRevisionPliego', () => {
  it('SIN_ANALIZAR cuando no hubo ningún análisis', () => {
    expect(computarEstadoRevisionPliego({ ...base, huboAlgunAnalisis: false })).toBe('SIN_ANALIZAR');
  });

  it('PLIEGO_VERIFICADO: regla ACTIVA válida + conjunto ACTIVO válido + sin candidatas', () => {
    expect(computarEstadoRevisionPliego(base)).toBe('PLIEGO_VERIFICADO');
  });

  it('NO verificado si la regla ACTIVA tiene centavos NO_DEFINIDA', () => {
    expect(computarEstadoRevisionPliego({ ...base, reglaActiva: { reglaCentavos: 'NO_DEFINIDA' } })).toBe('REQUIERE_REVISION_PLIEGO');
  });

  it('NO verificado si el conjunto ACTIVO no pasa criterios', () => {
    expect(computarEstadoRevisionPliego({ ...base, conjuntoActivo: { ...base.conjuntoActivo!, criteriosOk: false } })).toBe('REQUIERE_REVISION_PLIEGO');
  });

  it('NO verificado si falta presupuesto o PM aprobado en el conjunto ACTIVO', () => {
    expect(computarEstadoRevisionPliego({ ...base, conjuntoActivo: { ...base.conjuntoActivo!, presupuestoOficialAprobado: null } })).toBe('REQUIERE_REVISION_PLIEGO');
    expect(computarEstadoRevisionPliego({ ...base, conjuntoActivo: { ...base.conjuntoActivo!, puntajeMaximoEconomicoAprobado: 0 } })).toBe('REQUIERE_REVISION_PLIEGO');
  });

  it('PENDIENTE_REVISION si hay CANDIDATA de regla, aunque exista ACTIVA válida (no se pierde lo aprobado)', () => {
    expect(computarEstadoRevisionPliego({ ...base, reglaCandidataPendiente: true })).toBe('PENDIENTE_REVISION');
  });

  it('PENDIENTE_REVISION si hay CANDIDATO de conjunto sobre config aprobada', () => {
    expect(computarEstadoRevisionPliego({ ...base, conjuntoCandidatoPendiente: true })).toBe('PENDIENTE_REVISION');
  });

  it('PENDIENTE_REVISION en el primer análisis (candidatas nuevas, sin ACTIVA/ACTIVO aún)', () => {
    expect(computarEstadoRevisionPliego({
      usaPonderacionTrm: 'SI',
      reglaActiva: null, reglaCandidataPendiente: true,
      conjuntoActivo: null, conjuntoCandidatoPendiente: true,
      huboAlgunAnalisis: true,
    })).toBe('PENDIENTE_REVISION');
  });

  it('REQUIERE_REVISION_PLIEGO si NO hay ACTIVA/ACTIVO válidos y tampoco candidatas (todo rechazado)', () => {
    expect(computarEstadoRevisionPliego({
      usaPonderacionTrm: 'SI',
      reglaActiva: null, reglaCandidataPendiente: false,
      conjuntoActivo: null, conjuntoCandidatoPendiente: false,
      huboAlgunAnalisis: true,
    })).toBe('REQUIERE_REVISION_PLIEGO');
  });
});

describe('computarEstadoRevisionPliego × usaPonderacionTrm — §3 de la microauditoría', () => {
  it('SI + regla ACTIVA válida + conjunto ACTIVO válido → PLIEGO_VERIFICADO (caso base ya cubierto arriba)', () => {
    expect(computarEstadoRevisionPliego(base)).toBe('PLIEGO_VERIFICADO');
  });

  it('NO + la MISMA config históricamente válida → NO_APLICA_TRM (no "requiere revisión": simplemente no aplica)', () => {
    const r = computarEstadoRevisionPliego({ ...base, usaPonderacionTrm: 'NO' });
    expect(r).not.toBe('PLIEGO_VERIFICADO');
    expect(r).toBe('NO_APLICA_TRM');
  });

  it('NO con CANDIDATAS pendientes sin resolver → sigue siendo NO_APLICA_TRM (NO es "pendiente de revisión")', () => {
    const r = computarEstadoRevisionPliego({ ...base, usaPonderacionTrm: 'NO', reglaCandidataPendiente: true, conjuntoCandidatoPendiente: true });
    expect(r).toBe('NO_APLICA_TRM');
  });

  it('REGLA FINAL: NO sin ningún análisis previo → SIGUE SIENDO NO_APLICA_TRM (NO se comprueba ANTES que huboAlgunAnalisis)', () => {
    const r = computarEstadoRevisionPliego({ ...base, usaPonderacionTrm: 'NO', huboAlgunAnalisis: false });
    expect(r).toBe('NO_APLICA_TRM');
  });

  it('REGLA FINAL: NO_DETERMINADO + nunca analizado → SIN_ANALIZAR (SIN_ANALIZAR es de NO_DETERMINADO/SI, nunca de NO)', () => {
    const r = computarEstadoRevisionPliego({ ...base, usaPonderacionTrm: 'NO_DETERMINADO', huboAlgunAnalisis: false });
    expect(r).toBe('SIN_ANALIZAR');
  });

  it('NO_DETERMINADO + candidatas nuevas (primer análisis) → PENDIENTE_REVISION, NUNCA PLIEGO_VERIFICADO', () => {
    const r = computarEstadoRevisionPliego({
      usaPonderacionTrm: 'NO_DETERMINADO',
      reglaActiva: null, reglaCandidataPendiente: true,
      conjuntoActivo: null, conjuntoCandidatoPendiente: true,
      huboAlgunAnalisis: true,
    });
    expect(r).toBe('PENDIENTE_REVISION');
  });

  it('NO_DETERMINADO sin candidatas pendientes → REQUIERE_REVISION_PLIEGO, nunca PLIEGO_VERIFICADO', () => {
    const r = computarEstadoRevisionPliego({ ...base, usaPonderacionTrm: 'NO_DETERMINADO', reglaCandidataPendiente: false, conjuntoCandidatoPendiente: false });
    expect(r).toBe('REQUIERE_REVISION_PLIEGO');
  });

  it('NO → SI de nuevo, con la misma config ACTIVA aún válida → sale de NO_APLICA_TRM y vuelve a PLIEGO_VERIFICADO (reversible, sin estados atascados)', () => {
    const enNo = computarEstadoRevisionPliego({ ...base, usaPonderacionTrm: 'NO' });
    expect(enNo).toBe('NO_APLICA_TRM');
    const enSiDeNuevo = computarEstadoRevisionPliego({ ...base, usaPonderacionTrm: 'SI' });
    expect(enSiDeNuevo).toBe('PLIEGO_VERIFICADO');
  });
});

describe('evaluarGateUsoPonderacionTrm — §1', () => {
  it('SI habilita', () => {
    expect(evaluarGateUsoPonderacionTrm('SI')).toEqual({ ok: true });
  });
  it('NO bloquea (humano confirmó que no aplica)', () => {
    const r = evaluarGateUsoPonderacionTrm('NO');
    expect(r).toMatchObject({ ok: false, motivo: 'NO_ES_PONDERACION_TRM' });
  });
  it('NO_DETERMINADO bloquea igual que NO — sin confirmación humana no hay activación', () => {
    const r = evaluarGateUsoPonderacionTrm('NO_DETERMINADO');
    expect(r).toMatchObject({ ok: false, motivo: 'PENDIENTE_CONFIRMACION_HUMANA' });
  });
});
