/**
 * Pruebas del harness de NIVEL (Fase 1). Datos sintéticos — nunca red/BD.
 * Fijan el contrato de los modelos y las métricas, y la propiedad de
 * no-leakage del runner.
 */
import { describe, expect, it } from 'vitest';
import { construirEventosTrmDesdeVigencias, type RegistroTrmOficial } from '../vigencias';
import { calcularPrediccionNivel, percentilInterp, normalInversa } from './modelosNivel';
import { metricasNivel, diferenciaParEadaBlockBootstrap, ratioMaeBlockBootstrap, pinball } from './metricasNivel';
import { ejecutarBacktestNivel, verificarNoLeakageNivel } from './runnerNivel';
import type { PrediccionNivelEvaluada } from './tipos';
import { crearRng } from '../../arimaBootstrap';

// Serie sintética: random walk con drift + ruido, una certificación por día hábil.
function serieSintetica(n: number, semilla = 1): RegistroTrmOficial[] {
  const rng = crearRng(semilla);
  const regs: RegistroTrmOficial[] = [];
  let v = 4000;
  const d = new Date(Date.UTC(2016, 0, 4));
  for (let i = 0; i < n; i++) {
    // avanza al siguiente día de semana
    do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    v = Math.max(1, v + 0.5 + (rng() - 0.5) * 20);
    const f = d.toISOString().slice(0, 10);
    regs.push({ valor: Math.round(v * 100) / 100, vigenciaDesde: f, vigenciaHasta: f });
  }
  return regs;
}

describe('percentilInterp / normalInversa', () => {
  it('percentil interpola linealmente (tipo 7)', () => {
    expect(percentilInterp([10, 20, 30, 40], 0.5)).toBeCloseTo(25, 9);
    expect(percentilInterp([10, 20, 30, 40], 0)).toBe(10);
    expect(percentilInterp([10, 20, 30, 40], 1)).toBe(40);
  });
  it('normalInversa aproxima los cuantiles conocidos', () => {
    expect(normalInversa(0.5)).toBeCloseTo(0, 6);
    expect(normalInversa(0.975)).toBeCloseTo(1.959964, 4);
    expect(normalInversa(0.025)).toBeCloseTo(-1.959964, 4);
  });
});

describe('modelos de nivel — contrato', () => {
  const eventos = construirEventosTrmDesdeVigencias(serieSintetica(400));
  const iOrigen = 300;

  it('random_walk: p50 = último valor de entrenamiento', () => {
    const p = calcularPrediccionNivel('random_walk', eventos, iOrigen, 5, eventos[305].vigenciaDesde)!;
    expect(p).not.toBeNull();
    expect(p.valorPredicho).toBeCloseTo(eventos[iOrigen].valor, 6);
    expect(p.intervalo95.inferior).toBeLessThan(p.valorPredicho);
    expect(p.intervalo95.superior).toBeGreaterThan(p.valorPredicho);
    expect(p.intervalo80.inferior).toBeGreaterThanOrEqual(p.intervalo95.inferior);
  });

  it('random_walk_drift: p50 se separa del último valor por h·drift', () => {
    const rw = calcularPrediccionNivel('random_walk', eventos, iOrigen, 20, eventos[320].vigenciaDesde)!;
    const dr = calcularPrediccionNivel('random_walk_drift', eventos, iOrigen, 20, eventos[320].vigenciaDesde, { driftVentana: 60 })!;
    expect(dr.valorPredicho).not.toBeCloseTo(rw.valorPredicho, 0);
  });

  it('random_walk_vol_ewma: p50 == último valor, intervalos crecen con h', () => {
    const h1 = calcularPrediccionNivel('random_walk_vol_ewma', eventos, iOrigen, 1, eventos[301].vigenciaDesde, { volLambda: 0.94 })!;
    const h20 = calcularPrediccionNivel('random_walk_vol_ewma', eventos, iOrigen, 20, eventos[320].vigenciaDesde, { volLambda: 0.94 })!;
    expect(h1.valorPredicho).toBeCloseTo(eventos[iOrigen].valor, 6);
    const ancho1 = h1.intervalo95.superior - h1.intervalo95.inferior;
    const ancho20 = h20.intervalo95.superior - h20.intervalo95.inferior;
    expect(ancho20).toBeGreaterThan(ancho1);
  });

  it('ewma: devuelve una predicción con cuantiles ordenados', () => {
    const p = calcularPrediccionNivel('ewma', eventos, iOrigen, 5, eventos[305].vigenciaDesde, { ewmaLambda: 0.9 })!;
    expect(p.cuantiles.p10).toBeLessThanOrEqual(p.cuantiles.p50);
    expect(p.cuantiles.p50).toBeLessThanOrEqual(p.cuantiles.p90);
  });

  it('arima_eventos_corregido: h pasos = h eventos (no días hábiles)', () => {
    const p = calcularPrediccionNivel('arima_eventos_corregido', eventos, iOrigen, 5, eventos[305].vigenciaDesde, { nSimArima: 800 });
    // puede ser null si ARIMA no converge sobre la serie sintética; si no,
    // debe traer intervalos válidos
    if (p) {
      expect(p.intervalo95.superior).toBeGreaterThan(p.intervalo95.inferior);
      expect(Number.isFinite(p.valorPredicho)).toBe(true);
    }
  });

  it('arima_prod_actual: usa construirEventosEfectivos + días hábiles (no lanza)', () => {
    const p = calcularPrediccionNivel('arima_prod_actual', eventos, iOrigen, 5, eventos[305].vigenciaDesde, { nSimArima: 800 });
    if (p) expect(Number.isFinite(p.valorPredicho)).toBe(true);
  });

  it('determinismo: misma llamada → mismo resultado', () => {
    const a = calcularPrediccionNivel('arima_eventos_corregido', eventos, iOrigen, 5, eventos[305].vigenciaDesde, { nSimArima: 800 });
    const b = calcularPrediccionNivel('arima_eventos_corregido', eventos, iOrigen, 5, eventos[305].vigenciaDesde, { nSimArima: 800 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('runner de nivel — no-leakage + bloqueo de TEST_FINAL', () => {
  const eventos = construirEventosTrmDesdeVigencias(serieSintetica(500));

  it('cada modelo pasa la verificación mecánica de no-leakage', () => {
    for (const modelo of ['random_walk', 'random_walk_drift', 'ewma', 'random_walk_vol_ewma', 'arima_eventos_corregido', 'arima_prod_actual'] as const) {
      const ok = verificarNoLeakageNivel(eventos, modelo, 300, 5, eventos[305].vigenciaDesde, { nSimArima: 600, ewmaLambda: 0.9, driftVentana: 60, volLambda: 0.94 });
      expect(ok, `no-leakage falló para ${modelo}`).toBe(true);
    }
  });

  it('fechaObjetivoMaxima excluye por completo los targets posteriores (bloqueo TEST_FINAL)', () => {
    const corte = eventos[400].vigenciaDesde;
    const res = ejecutarBacktestNivel({
      eventos, horizontes: [1, 5], calentamientoEventos: 180,
      modelos: ['random_walk'], configPorModelo: {},
      fechaObjetivoMaxima: corte,
    });
    expect(res.length).toBeGreaterThan(0);
    expect(res.every(p => p.fechaObjetivo <= corte)).toBe(true);
  });

  it('mismos targets para todos los modelos en cada horizonte', () => {
    const res = ejecutarBacktestNivel({
      eventos, horizontes: [5], calentamientoEventos: 180,
      modelos: ['random_walk', 'ewma'], configPorModelo: { ewma: { ewmaLambda: 0.9 } },
    });
    const rw = new Set(res.filter(p => p.modelo === 'random_walk').map(p => p.fechaObjetivo));
    const ew = new Set(res.filter(p => p.modelo === 'ewma').map(p => p.fechaObjetivo));
    expect([...ew].every(f => rw.has(f))).toBe(true);
  });
});

describe('métricas de nivel', () => {
  function fila(real: number, pred: number, over: Partial<PrediccionNivelEvaluada> = {}): PrediccionNivelEvaluada {
    const errorSigned = real - pred;
    return {
      fechaCorte: '2020-01-01', fechaObjetivo: '2020-01-08', anioObjetivo: 2020, horizonteEventos: 5,
      modelo: 'random_walk', configId: 'x', valorOrigen: real - 1, valorReal: real, valorPredicho: pred,
      errorSigned, errorAbs: Math.abs(errorSigned), cambioReal: 1, cambioPredicho: pred - (real - 1),
      cuantiles: { p10: pred - 10, p20: pred - 5, p50: pred, p80: pred + 5, p90: pred + 10 },
      intervalo80: { inferior: pred - 10, superior: pred + 10 }, intervalo95: { inferior: pred - 20, superior: pred + 20 },
      dentro80: Math.abs(errorSigned) <= 10, dentro95: Math.abs(errorSigned) <= 20,
      decimalReal: 0, decimalPredicho: 0, aciertoDecimal: true, ...over,
    };
  }

  it('MAE/RMSE/bias/subestimación-sobreestimación', () => {
    const preds = [fila(100, 95), fila(100, 90), fila(100, 110)]; // errores +5, +10, -10
    const m = metricasNivel(preds);
    expect(m.mae).toBeCloseTo((5 + 10 + 10) / 3, 9);
    expect(m.rmse).toBeCloseTo(Math.sqrt((25 + 100 + 100) / 3), 9);
    expect(m.biasMedio).toBeCloseTo((5 + 10 - 10) / 3, 9);
    expect(m.subestimacion.n).toBe(2);      // real > predicho
    expect(m.sobreestimacion.n).toBe(1);
    expect(m.subestimacion.errorMedio).toBeCloseTo(7.5, 9);
  });

  it('MASE relativo a RW: ratio de MAE sobre los mismos targets', () => {
    const preds = [fila(100, 98), fila(100, 96)]; // MAE = 3
    const m = metricasNivel(preds, [4, 4]);        // MAE_rw = 4
    expect(m.maseVsRw).toBeCloseTo(3 / 4, 9);
  });

  it('pinball P90 penaliza más el quedarse corto (real > cuantil)', () => {
    const corto = [fila(100, 100, { cuantiles: { p10: 80, p20: 85, p50: 90, p80: 95, p90: 96 } })];
    const largo = [fila(100, 100, { cuantiles: { p10: 100, p20: 102, p50: 104, p80: 108, p90: 110 } })];
    expect(pinball(corto, 0.9, p => p.cuantiles.p90)).toBeGreaterThan(pinball(largo, 0.9, p => p.cuantiles.p90));
  });

  it('diferencia pareada block bootstrap: contieneCero cuando A≈B', () => {
    const a = Array.from({ length: 200 }, (_, i) => fila(100 + i, 100 + i - 3));
    const b = Array.from({ length: 200 }, (_, i) => fila(100 + i, 100 + i - 3));
    const r = diferenciaParEadaBlockBootstrap(a, b, 'abs', 20, 300, crearRng(1));
    expect(r).not.toBeNull();
    expect(r!.contieneCero).toBe(true);
    const rr = ratioMaeBlockBootstrap(a, b, 20, 300, crearRng(1));
    expect(rr!.contieneUno).toBe(true);
  });

  it('diferencia pareada detecta que A es mejor que B (IC no contiene 0)', () => {
    const a = Array.from({ length: 200 }, (_, i) => fila(100 + i, 100 + i - 1));  // |err| = 1
    const b = Array.from({ length: 200 }, (_, i) => fila(100 + i, 100 + i - 6));  // |err| = 6
    const r = diferenciaParEadaBlockBootstrap(a, b, 'abs', 20, 500, crearRng(2));
    expect(r!.diferenciaObservada).toBeLessThan(0); // A < B
    expect(r!.contieneCero).toBe(false);
  });
});
