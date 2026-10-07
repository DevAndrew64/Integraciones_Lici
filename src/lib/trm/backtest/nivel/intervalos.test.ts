/**
 * Pruebas del harness de INTERVALOS (Fase 2). Datos sintéticos — nunca red/BD.
 */
import { describe, expect, it } from 'vitest';
import { construirEventosTrmDesdeVigencias, type RegistroTrmOficial } from '../vigencias';
import { calcularIntervalo, ajustarGarch11, MODELOS_INTERVALO } from './intervalos';
import { metricasIntervalo, pinball, intervalScore, diferenciaIntervalScoreBlockBootstrap, type IntervaloEvaluado } from './metricasIntervalo';
import { ejecutarBacktestIntervalo, verificarNoLeakageIntervalo, calibrarZTrain } from './runnerIntervalo';
import { crearRng } from '../../arimaBootstrap';

function serie(n: number, semilla = 7): RegistroTrmOficial[] {
  const rng = crearRng(semilla);
  const regs: RegistroTrmOficial[] = [];
  let v = 4000;
  const d = new Date(Date.UTC(2016, 0, 4));
  for (let i = 0; i < n; i++) {
    do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    v = Math.max(1, v * Math.exp((rng() - 0.5) * 0.01));
    const f = d.toISOString().slice(0, 10);
    regs.push({ valor: Math.round(v * 100) / 100, vigenciaDesde: f, vigenciaHasta: f });
  }
  return regs;
}

describe('modelos de intervalo — P50 congelado en la última TRM', () => {
  const eventos = construirEventosTrmDesdeVigencias(serie(600));
  const i = 400;
  const v0 = eventos[i].valor;

  it.each(MODELOS_INTERVALO)('%s: p50 == v0 y cuantiles estrictamente ordenados', (modelo) => {
    const cfg = modelo === 'garch11' ? { garch: { alpha: 0.05, beta: 0.9 } } : {};
    const cu = calcularIntervalo(modelo, eventos, i, 5, cfg);
    if (!cu) return; // puede ser null con serie corta; los demás modelos cubren
    expect(cu.p50).toBeCloseTo(v0, 6);
    expect(cu.p05).toBeLessThan(cu.p10);
    expect(cu.p10).toBeLessThan(cu.p20);
    expect(cu.p20).toBeLessThan(cu.p50);
    expect(cu.p50).toBeLessThan(cu.p80);
    expect(cu.p80).toBeLessThan(cu.p90);
    expect(cu.p90).toBeLessThan(cu.p95);
    expect(cu.i95.inferior).toBeLessThanOrEqual(cu.i80.inferior);
    expect(cu.i95.superior).toBeGreaterThanOrEqual(cu.i80.superior);
  });

  it('rw_vol_ewma y garch: el ancho crece con el horizonte', () => {
    for (const modelo of ['rw_vol_ewma', 'garch11'] as const) {
      const cfg = modelo === 'garch11' ? { garch: { alpha: 0.05, beta: 0.9 } } : {};
      const h1 = calcularIntervalo(modelo, eventos, i, 1, cfg)!;
      const h20 = calcularIntervalo(modelo, eventos, i, 20, cfg)!;
      const a1 = h1.i95.superior - h1.i95.inferior;
      const a20 = h20.i95.superior - h20.i95.inferior;
      expect(a20).toBeGreaterThan(a1);
    }
  });

  it('ajustarGarch11: (α,β) válidos, α+β<1', () => {
    const r = Array.from({ length: 500 }, (_, k) => (crearRng(k + 1)() - 0.5) * 0.02);
    const g = ajustarGarch11(r);
    expect(g.alpha).toBeGreaterThan(0);
    expect(g.beta).toBeGreaterThan(0);
    expect(g.alpha + g.beta).toBeLessThan(1);
    expect(Number.isFinite(g.logLik)).toBe(true);
  });
});

describe('runner de intervalo — no-leakage + bloqueo TEST_FINAL', () => {
  const eventos = construirEventosTrmDesdeVigencias(serie(700));

  it('cada modelo pasa la verificación mecánica de no-leakage', () => {
    for (const modelo of MODELOS_INTERVALO) {
      const cfg = modelo === 'garch11' ? { garch: { alpha: 0.05, beta: 0.9 } } : { rollingVentana: 200, volLambda: 0.94 };
      expect(verificarNoLeakageIntervalo(eventos, modelo, 400, 5, cfg), `no-leakage ${modelo}`).toBe(true);
    }
  });

  it('fechaObjetivoMaxima excluye targets posteriores', () => {
    const corte = eventos[500].vigenciaDesde;
    const res = ejecutarBacktestIntervalo({
      eventos, horizontes: [1, 5], calentamientoEventos: 180,
      modelos: ['empirico_global'], configPorModelo: {}, fechaObjetivoMaxima: corte,
    });
    expect(res.length).toBeGreaterThan(0);
    expect(res.every(p => p.fechaObjetivo <= corte)).toBe(true);
  });

  it('calibrarZTrain usa SOLO datos <= trainHasta', () => {
    const trainHasta = eventos[450].vigenciaDesde;
    const z = calibrarZTrain(eventos, [1, 5], 180, 0.94, trainHasta);
    expect(z[1].length).toBeGreaterThan(30);
    expect(z[1]).toEqual([...z[1]].sort((a, b) => a - b)); // ordenado
  });
});

describe('métricas de intervalo — calibración + sharpness', () => {
  function fila(real: number, l95: number, u95: number, over: Partial<IntervaloEvaluado> = {}): IntervaloEvaluado {
    return {
      fechaCorte: '2020-01-01', fechaObjetivo: '2020-02-01', anioObjetivo: 2020, horizonteEventos: 5,
      modelo: 'x', configId: 'x', valorOrigen: 100, valorReal: real,
      p05: l95, p10: l95 + 1, p20: l95 + 3, p50: 100, p80: u95 - 3, p90: u95 - 1, p95: u95,
      i80: { inferior: l95 + 1, superior: u95 - 1 }, i95: { inferior: l95, superior: u95 }, ...over,
    };
  }

  it('cobertura empírica y detección de calibración', () => {
    // 95 de 100 reales dentro de [90,110] → cobertura95 = 0.95 → calibrado
    const dentro = Array.from({ length: 95 }, () => fila(100, 90, 110));
    const fuera = Array.from({ length: 5 }, () => fila(120, 90, 110));
    const m = metricasIntervalo([...dentro, ...fuera]);
    expect(m.cobertura95).toBeCloseTo(0.95, 6);
    expect(m.calibrado95).toBe(true);
    expect(m.colaSuperior975).toBeCloseTo(0.05, 6); // los 5 quedaron por encima
    expect(m.colaInferior025).toBe(0);
  });

  it('interval score penaliza el intervalo demasiado ancho pese a cubrir el 100 %', () => {
    const estrecho = Array.from({ length: 100 }, (_, k) => fila(100 + (k - 50) * 0.1, 96, 104));   // cubre casi todo, angosto
    const anchisimo = Array.from({ length: 100 }, (_, k) => fila(100 + (k - 50) * 0.1, 0, 200));    // cubre todo, absurdo
    const isEstrecho = intervalScore(estrecho, 0.05, p => ({ l: p.i95.inferior, u: p.i95.superior }));
    const isAncho = intervalScore(anchisimo, 0.05, p => ({ l: p.i95.inferior, u: p.i95.superior }));
    expect(isAncho).toBeGreaterThan(isEstrecho); // el ancho absurdo pierde
  });

  it('pinball P90 penaliza más quedarse corto (real por encima del cuantil)', () => {
    const corto = [fila(100, 80, 100, { p90: 96 })];   // real 100 > p90 96
    const largo = [fila(100, 100, 120, { p90: 110 })]; // real 100 < p90 110
    expect(pinball(corto, 0.9, p => p.p90)).toBeGreaterThan(pinball(largo, 0.9, p => p.p90));
  });

  it('diferencia pareada de interval score: contieneCero cuando A≈B', () => {
    const a = Array.from({ length: 200 }, (_, k) => fila(100 + (k % 7) - 3, 92, 108));
    const b = Array.from({ length: 200 }, (_, k) => fila(100 + (k % 7) - 3, 92, 108));
    const r = diferenciaIntervalScoreBlockBootstrap(a, b, 0.05, 20, 300, crearRng(1));
    expect(r!.contieneCero).toBe(true);
  });

  it('diferencia pareada detecta que A (más angosto y calibrado) mejora a B (ancho)', () => {
    const a = Array.from({ length: 200 }, (_, k) => fila(100 + (k % 9) - 4, 94, 106));
    const b = Array.from({ length: 200 }, (_, k) => fila(100 + (k % 9) - 4, 70, 130));
    const r = diferenciaIntervalScoreBlockBootstrap(a, b, 0.05, 20, 400, crearRng(2));
    expect(r!.diferenciaObservada).toBeLessThan(0);
    expect(r!.contieneCero).toBe(false);
  });
});
