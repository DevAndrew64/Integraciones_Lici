import { describe, it, expect } from 'vitest';
import {
  validarInvariante, planearCrearCandidata, planearAprobar, planearRechazar,
  reglaCentavosAModo, evaluarGateRegla, type ReglaLite, type EstadoRegla,
} from './lifecycle';

const R = (over: Partial<ReglaLite>): ReglaLite => ({
  id: 1, procesoId: 10, version: 1, estadoVersion: 'CANDIDATA', reglaCentavos: 'REDONDEO', ...over,
});

describe('validarInvariante', () => {
  it('acepta 1 ACTIVA + 1 CANDIDATA + N históricas', () => {
    expect(() => validarInvariante([
      { estadoVersion: 'ACTIVA' }, { estadoVersion: 'CANDIDATA' },
      { estadoVersion: 'SUPERSEDED' }, { estadoVersion: 'RECHAZADA' }, { estadoVersion: 'RECHAZADA' },
    ])).not.toThrow();
  });
  it('rechaza 2 ACTIVA', () => {
    expect(() => validarInvariante([{ estadoVersion: 'ACTIVA' }, { estadoVersion: 'ACTIVA' }])).toThrow(/ACTIVA/);
  });
  it('rechaza 2 CANDIDATA', () => {
    expect(() => validarInvariante([{ estadoVersion: 'CANDIDATA' }, { estadoVersion: 'CANDIDATA' }])).toThrow(/CANDIDATA/);
  });
});

describe('planearCrearCandidata (T1)', () => {
  it('primera extracción: version 1, sin auto-rechazo', () => {
    const plan = planearCrearCandidata({ versionMaxima: 0 });
    expect(plan.nuevaVersion).toBe(1);
    expect(plan.autoRechazar).toBeUndefined();
    expect(plan.estadoRevisionPliego).toBe('PENDIENTE_REVISION');
  });
  it('con ACTIVA existente: NO la toca, nueva version = max+1', () => {
    const plan = planearCrearCandidata({ activa: R({ id: 5, version: 2, estadoVersion: 'ACTIVA' }), versionMaxima: 2 });
    expect(plan.nuevaVersion).toBe(3);
    expect(plan.autoRechazar).toBeUndefined();
  });
  it('con CANDIDATA pendiente: la auto-rechaza como transición de SISTEMA sin actor', () => {
    const plan = planearCrearCandidata({ candidata: R({ id: 7, version: 3 }), versionMaxima: 3 });
    expect(plan.nuevaVersion).toBe(4);
    expect(plan.autoRechazar).toEqual({
      id: 7,
      motivoRechazo: expect.stringMatching(/SISTEMA/),
      origenTransicion: 'SISTEMA',
      rechazadoPorId: null,
    });
  });
});

describe('planearAprobar (T3)', () => {
  it('sin ACTIVA previa: candidata → ACTIVA, sin supersede', () => {
    const plan = planearAprobar({ candidata: R({ id: 9 }), versionMaxima: 1 });
    expect(plan).toMatchObject({ candidataId: 9, supersederActivaId: null });
  });
  it('con ACTIVA previa: supersede la anterior', () => {
    const plan = planearAprobar({ candidata: R({ id: 9, version: 2 }), activa: R({ id: 4, version: 1, estadoVersion: 'ACTIVA' }), versionMaxima: 2 });
    expect(plan.supersederActivaId).toBe(4);
  });
  it('rechaza aprobar sin CANDIDATA', () => {
    expect(() => planearAprobar({ versionMaxima: 1 })).toThrow(/CANDIDATA/);
  });
  it('rechaza aprobar con reglaCentavos = NO_DEFINIDA', () => {
    expect(() => planearAprobar({ candidata: R({ reglaCentavos: 'NO_DEFINIDA' }), versionMaxima: 1 })).toThrow(/reglaCentavos/);
  });
  it('rechaza aprobar con reglaCentavos = OTRA', () => {
    expect(() => planearAprobar({ candidata: R({ reglaCentavos: 'OTRA' }), versionMaxima: 1 })).toThrow(/reglaCentavos/);
  });
});

describe('planearRechazar (T2) — la ACTIVA anterior permanece', () => {
  it('con ACTIVA y gate OK → PLIEGO_VERIFICADO', () => {
    const plan = planearRechazar({ candidata: R({ id: 9 }), activa: R({ id: 4, estadoVersion: 'ACTIVA' }), versionMaxima: 2 }, true);
    expect(plan).toMatchObject({ candidataId: 9, origenTransicion: 'HUMANO', estadoRevisionPliegoResultante: 'PLIEGO_VERIFICADO' });
  });
  it('sin ACTIVA → REQUIERE_REVISION_PLIEGO', () => {
    const plan = planearRechazar({ candidata: R({ id: 9 }), versionMaxima: 1 }, false);
    expect(plan.estadoRevisionPliegoResultante).toBe('REQUIERE_REVISION_PLIEGO');
  });
});

describe('reglaCentavosAModo', () => {
  it('REDONDEO → redondeo, TRUNCADO → truncado', () => {
    expect(reglaCentavosAModo('REDONDEO')).toBe('redondeo');
    expect(reglaCentavosAModo('TRUNCADO')).toBe('truncado');
  });
  it('NO_DEFINIDA / OTRA lanzan (nunca default silencioso)', () => {
    expect(() => reglaCentavosAModo('NO_DEFINIDA')).toThrow();
    expect(() => reglaCentavosAModo('OTRA')).toThrow();
  });
});

describe('evaluarGateRegla (parte regla TRM del gate G3)', () => {
  it('sin ACTIVA → SIN_REGLA_ACTIVA', () => {
    expect(evaluarGateRegla({}).ok).toBe(false);
  });
  it('ACTIVA con reglaCentavos NO_DEFINIDA → REGLA_CENTAVOS_NO_RESUELTA', () => {
    const r = evaluarGateRegla({ activa: R({ estadoVersion: 'ACTIVA', reglaCentavos: 'NO_DEFINIDA' }) });
    expect(r).toMatchObject({ ok: false, motivo: 'REGLA_CENTAVOS_NO_RESUELTA' });
  });
  it('ACTIVA OK, sin candidata pendiente → ok', () => {
    const r = evaluarGateRegla({ activa: R({ id: 3, estadoVersion: 'ACTIVA', reglaCentavos: 'TRUNCADO' }) });
    expect(r).toEqual({ ok: true, reglaId: 3 });
  });
  it('ACTIVA OK + CANDIDATA pendiente SIN excepción → bloquea', () => {
    const r = evaluarGateRegla({
      activa: R({ id: 3, estadoVersion: 'ACTIVA' }),
      candidataPendiente: R({ id: 8, estadoVersion: 'CANDIDATA' }),
    });
    expect(r).toMatchObject({ ok: false, motivo: 'CANDIDATA_PENDIENTE_SIN_EXCEPCION' });
  });
  it('ACTIVA OK + CANDIDATA pendiente + excepción humana válida → ok', () => {
    const r = evaluarGateRegla({
      activa: R({ id: 3, estadoVersion: 'ACTIVA' }),
      candidataPendiente: R({ id: 8, estadoVersion: 'CANDIDATA' }),
      excepcionVigente: { id: 1, actorId: 42, motivo: 'La adenda solo movió el cronograma, no la regla.' },
    });
    expect(r).toEqual({ ok: true, reglaId: 3 });
  });
  it('excepción sin actor o sin motivo → NO vale', () => {
    const base: any = { activa: R({ id: 3, estadoVersion: 'ACTIVA' }), candidataPendiente: R({ id: 8, estadoVersion: 'CANDIDATA' }) };
    expect(evaluarGateRegla({ ...base, excepcionVigente: { id: 1, actorId: 0, motivo: 'x' } }).ok).toBe(false);
    expect(evaluarGateRegla({ ...base, excepcionVigente: { id: 1, actorId: 42, motivo: '  ' } }).ok).toBe(false);
  });
});
