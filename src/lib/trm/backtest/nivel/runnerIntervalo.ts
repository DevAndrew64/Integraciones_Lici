/**
 * Runner walk-forward de INTERVALOS (Fase 2). Semántica temporal EXCLUSIVA:
 * evento oficial (vigencias.ts), `h` eventos hacia adelante — nunca días
 * hábiles. Reutiliza `calcularParesEvaluablesPorHorizonte` (runner.ts).
 *
 * No-leakage: cada modelo recibe SOLO `eventos.slice(0, indiceOrigen + 1)`.
 * `verificarNoLeakageIntervalo` lo comprueba mecánicamente.
 */

import { calcularParesEvaluablesPorHorizonte } from '../runner';
import type { EventoTrmOficial } from '../vigencias';
import { calcularIntervalo, configIdIntervalo, type ConfigIntervalo, type ModeloIntervalo } from './intervalos';
import type { IntervaloEvaluado } from './metricasIntervalo';

export interface ConfigRunnerIntervalo {
  eventos: EventoTrmOficial[];
  horizontes: number[];
  calentamientoEventos: number;
  modelos: ModeloIntervalo[];
  configPorModelo: Partial<Record<ModeloIntervalo, ConfigIntervalo>>;
  /** BLOQUEA TEST_FINAL: solo se evalúan pares con evento objetivo <= esta fecha. */
  fechaObjetivoMaxima?: string;
}

export function ejecutarBacktestIntervalo(config: ConfigRunnerIntervalo): IntervaloEvaluado[] {
  const { eventos, horizontes, calentamientoEventos, modelos, configPorModelo } = config;
  const salida: IntervaloEvaluado[] = [];

  for (const h of horizontes) {
    let pares = calcularParesEvaluablesPorHorizonte(eventos, calentamientoEventos, h, 1);
    if (config.fechaObjetivoMaxima) {
      pares = pares.filter(p => eventos[p.indiceObjetivo].vigenciaDesde <= config.fechaObjetivoMaxima!);
    }
    for (const { indiceOrigen, indiceObjetivo, fechaCorte, fechaObjetivo } of pares) {
      const valorOrigen = eventos[indiceOrigen].valor;
      const valorReal = eventos[indiceObjetivo].valor;
      const anioObjetivo = Number(fechaObjetivo.slice(0, 4));

      for (const modelo of modelos) {
        const cfg = configPorModelo[modelo] ?? {};
        const cu = calcularIntervalo(modelo, eventos, indiceOrigen, h, cfg);
        if (cu === null) continue;
        salida.push({
          fechaCorte, fechaObjetivo, anioObjetivo, horizonteEventos: h,
          modelo, configId: configIdIntervalo(modelo, cfg),
          valorOrigen, valorReal,
          p05: cu.p05, p10: cu.p10, p20: cu.p20, p50: cu.p50, p80: cu.p80, p90: cu.p90, p95: cu.p95,
          i80: cu.i80, i95: cu.i95,
        });
      }
    }
  }
  return salida;
}

export function verificarNoLeakageIntervalo(
  eventos: EventoTrmOficial[],
  modelo: ModeloIntervalo,
  indiceOrigen: number,
  hEventos: number,
  cfg: ConfigIntervalo,
): boolean {
  const completo = calcularIntervalo(modelo, eventos, indiceOrigen, hEventos, cfg);
  const recortado = calcularIntervalo(modelo, eventos.slice(0, indiceOrigen + 1), indiceOrigen, hEventos, cfg);
  return JSON.stringify(completo) === JSON.stringify(recortado);
}

/**
 * Distribución empírica de residuos estandarizados z=(real−v0)/(v0·σ_h) por
 * horizonte, calculada SOLO sobre TRAIN (targets <= `trainHasta`). Alimenta
 * el modelo `vol_ewma_calibrado` — es la calibración de sesgo/cobertura que
 * NO puede usar VALIDATION ni TEST_FINAL.
 */
export function calibrarZTrain(
  eventos: EventoTrmOficial[],
  horizontes: number[],
  calentamientoEventos: number,
  volLambda: number,
  trainHasta: string,
): Record<number, number[]> {
  const { calcularIntervalo: _ } = { calcularIntervalo }; void _;
  const out: Record<number, number[]> = {};
  // σ_h de rw_vol_ewma sin z: usamos su i95 gaussiano para despejar σ_h
  // (i95.superior = v0·exp(1.959964·σ_h) ⇒ σ_h = ln(sup/v0)/1.959964).
  const Z975 = 1.959963984540054;
  for (const h of horizontes) {
    const zs: number[] = [];
    const pares = calcularParesEvaluablesPorHorizonte(eventos, calentamientoEventos, h, 1)
      .filter(p => eventos[p.indiceObjetivo].vigenciaDesde <= trainHasta);
    for (const { indiceOrigen, indiceObjetivo } of pares) {
      const v0 = eventos[indiceOrigen].valor;
      const real = eventos[indiceObjetivo].valor;
      const cu = calcularIntervalo('rw_vol_ewma', eventos, indiceOrigen, h, { volLambda });
      if (!cu) continue;
      const sigmaH = Math.log(cu.i95.superior / v0) / Z975;
      if (!(sigmaH > 0)) continue;
      zs.push((real - v0) / (v0 * sigmaH));
    }
    out[h] = zs.sort((a, b) => a - b);
  }
  return out;
}
