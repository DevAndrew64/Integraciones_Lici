/**
 * Runner walk-forward de NIVEL (Fase 1). Reutiliza `calcularParesEvaluablesPorHorizonte`
 * de runner.ts (misma semántica certificada: pares origen→objetivo por índice
 * de evento, `h` = número de eventos oficiales hacia adelante, no-leakage por
 * índice). Poblado de campos de nivel + decimal diagnóstico.
 *
 * No-leakage: cada modelo recibe SOLO `eventos.slice(0, indiceOrigen + 1)`
 * (garantizado dentro de `calcularPrediccionNivel`). `verificarNoLeakageNivel`
 * lo comprueba mecánicamente para una fila (misma técnica de datasetCausal.ts).
 */

import { calcularParesEvaluablesPorHorizonte } from '../runner';
import { decimalesDe } from '../../proyeccionDecimal';
import type { EventoTrmOficial } from '../vigencias';
import { calcularPrediccionNivel, configId } from './modelosNivel';
import type { ConfigModeloNivel, ModeloNivel, PrediccionNivelEvaluada } from './tipos';

export interface ConfigRunnerNivel {
  eventos: EventoTrmOficial[];
  horizontes: number[];
  calentamientoEventos: number;
  modelos: ModeloNivel[];
  /** Config por modelo (hiperparámetros ya seleccionados). */
  configPorModelo: Partial<Record<ModeloNivel, ConfigModeloNivel>>;
  /** Solo se evalúan pares cuyo evento objetivo cae en `[, fechaObjetivoMaxima]`
   *  — así se BLOQUEA TEST_FINAL sin tocar el cálculo de pares. */
  fechaObjetivoMaxima?: string;
  /** 1 = todos los orígenes; N = 1 de cada N (reduce costo de exploración). */
  muestreoOrigenes?: number;
}

export function ejecutarBacktestNivel(config: ConfigRunnerNivel): PrediccionNivelEvaluada[] {
  const { eventos, horizontes, calentamientoEventos, modelos, configPorModelo } = config;
  const muestreo = config.muestreoOrigenes ?? 1;
  const salida: PrediccionNivelEvaluada[] = [];

  for (const h of horizontes) {
    let pares = calcularParesEvaluablesPorHorizonte(eventos, calentamientoEventos, h, 1);
    if (config.fechaObjetivoMaxima) {
      pares = pares.filter(p => eventos[p.indiceObjetivo].vigenciaDesde <= config.fechaObjetivoMaxima!);
    }
    if (muestreo > 1) pares = pares.filter((_, idx) => idx % muestreo === 0);

    for (const { indiceOrigen, indiceObjetivo, fechaCorte, fechaObjetivo } of pares) {
      const eventoOrigen = eventos[indiceOrigen];
      const eventoObjetivo = eventos[indiceObjetivo];
      const valorOrigen = eventoOrigen.valor;
      const valorReal = eventoObjetivo.valor;
      const decimalReal = eventoObjetivo.decimal;
      const anioObjetivo = Number(fechaObjetivo.slice(0, 4));

      for (const modelo of modelos) {
        const cfg = configPorModelo[modelo] ?? {};
        const pred = calcularPrediccionNivel(modelo, eventos, indiceOrigen, h, fechaObjetivo, cfg);
        if (pred === null) continue; // datos insuficientes para este modelo en este origen

        const errorSigned = valorReal - pred.valorPredicho;
        const decimalPredicho = decimalesDe(pred.valorPredicho);

        salida.push({
          fechaCorte,
          fechaObjetivo,
          anioObjetivo,
          horizonteEventos: h,
          modelo,
          configId: configId(modelo, cfg),
          valorOrigen,
          valorReal,
          valorPredicho: pred.valorPredicho,
          errorSigned,
          errorAbs: Math.abs(errorSigned),
          cambioReal: valorReal - valorOrigen,
          cambioPredicho: pred.valorPredicho - valorOrigen,
          cuantiles: pred.cuantiles,
          intervalo80: pred.intervalo80,
          intervalo95: pred.intervalo95,
          dentro80: valorReal >= pred.intervalo80.inferior && valorReal <= pred.intervalo80.superior,
          dentro95: valorReal >= pred.intervalo95.inferior && valorReal <= pred.intervalo95.superior,
          decimalReal,
          decimalPredicho,
          aciertoDecimal: decimalPredicho === decimalReal,
        });
      }
    }
  }
  return salida;
}

/**
 * Verificación mecánica de no-leakage para un modelo/origen/horizonte:
 * recalcula la predicción sobre la serie recortada a `eventos[0..indiceOrigen]`
 * y comprueba que es idéntica a la calculada sobre la serie completa. Si
 * coinciden, ninguna feature interna pudo leer eventos posteriores al origen.
 */
export function verificarNoLeakageNivel(
  eventosCompletos: EventoTrmOficial[],
  modelo: ModeloNivel,
  indiceOrigen: number,
  hEventos: number,
  fechaObjetivo: string,
  cfg: ConfigModeloNivel,
): boolean {
  const completo = calcularPrediccionNivel(modelo, eventosCompletos, indiceOrigen, hEventos, fechaObjetivo, cfg);
  const recortado = calcularPrediccionNivel(
    modelo, eventosCompletos.slice(0, indiceOrigen + 1), indiceOrigen, hEventos, fechaObjetivo, cfg,
  );
  return JSON.stringify(completo) === JSON.stringify(recortado);
}

/** Índice de |error| de random_walk por target, alineado a `preds` (para MASE). */
export function erroresRandomWalkAlineados(
  todas: PrediccionNivelEvaluada[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of todas) {
    if (p.modelo !== 'random_walk') continue;
    m.set(`${p.horizonteEventos}|${p.fechaObjetivo}`, p.errorAbs);
  }
  return m;
}
