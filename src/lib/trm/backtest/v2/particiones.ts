/**
 * Partición temporal para la Segunda Generación del predictor TRM.
 * Ver auditoría §3: TRAIN para selección de features/modelos, VALIDATION
 * para hiperparámetros/calibración, TEST_FINAL intocable hasta elegir el
 * candidato definitivo.
 *
 * Validada contra los 2.500 eventos reales (script de verificación,
 * ver reporte de esta ronda): TRAIN=1.641 (65,6%), VALIDATION=472 (18,9%),
 * TEST_FINAL=387 (15,5%) — proporciones razonables, no requiere ajustar
 * las fechas propuestas por el usuario.
 */

import type { EventoTrmOficial } from '../vigencias';

export interface RangoParticion {
  desde: string;
  hasta: string;
}

export const PARTICION_TRM_V2: Record<'TRAIN' | 'VALIDATION' | 'TEST_FINAL', RangoParticion> = {
  TRAIN: { desde: '2016-02-05', hasta: '2022-12-31' },
  VALIDATION: { desde: '2023-01-01', hasta: '2024-12-31' },
  TEST_FINAL: { desde: '2025-01-01', hasta: '2026-08-26' },
};

export function eventosEnRango(eventos: EventoTrmOficial[], rango: RangoParticion): EventoTrmOficial[] {
  return eventos.filter(e => e.vigenciaDesde >= rango.desde && e.vigenciaDesde <= rango.hasta);
}

export interface ReporteParticiones {
  train: { n: number; desde: string; hasta: string };
  validation: { n: number; desde: string; hasta: string };
  testFinal: { n: number; desde: string; hasta: string };
  totalCubierto: number;
  totalEventos: number;
}

export function reportarParticiones(eventos: EventoTrmOficial[]): ReporteParticiones {
  const train = eventosEnRango(eventos, PARTICION_TRM_V2.TRAIN);
  const validation = eventosEnRango(eventos, PARTICION_TRM_V2.VALIDATION);
  const testFinal = eventosEnRango(eventos, PARTICION_TRM_V2.TEST_FINAL);
  return {
    train: { n: train.length, desde: train[0]?.vigenciaDesde ?? '', hasta: train[train.length - 1]?.vigenciaDesde ?? '' },
    validation: { n: validation.length, desde: validation[0]?.vigenciaDesde ?? '', hasta: validation[validation.length - 1]?.vigenciaDesde ?? '' },
    testFinal: { n: testFinal.length, desde: testFinal[0]?.vigenciaDesde ?? '', hasta: testFinal[testFinal.length - 1]?.vigenciaDesde ?? '' },
    totalCubierto: train.length + validation.length + testFinal.length,
    totalEventos: eventos.length,
  };
}
