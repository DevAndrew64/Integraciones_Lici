/**
 * Tipos neutrales del resultado "adaptador de cargo" — estado UI y vista
 * previa comercial que cualquier constructor de línea mensual expone hacia
 * page.tsx, independientemente de qué motor produjo el resultado. Sin
 * funciones, sin dependencia de ningún motor concreto.
 */
import type { ResultadoTarifaMensual } from './tipos-resultado-mensual';

/** Identificadores INTERNOS — nunca se renderizan como texto crudo en la
 * UI. page.tsx debe mostrar siempre `mensajeUsuario`, jamás `estadoUI`. */
export type EstadoAdaptadorCargo =
  | 'CALCULANDO'
  | 'TARIFA_CALCULADA'
  | 'PROGRAMACION_INCOMPLETA'
  | 'PARAMETROS_VIGENCIA_NO_ENCONTRADOS'
  | 'ROTACION_PENDIENTE'
  | 'ERROR_DE_CALCULO';

/** Subconjunto seguro para mostrar al usuario — nunca incluye fecha de
 * referencia, divisor, jornada, recargo, franja nocturna ni ninguna otra
 * instantánea normativa. */
export interface VistaPreviaMensualComercial {
  diasOrdinariosPromedio: number;
  domingosPromedio: number;
  festivosPromedio: number;
  totalDiasProgramadosPromedio: number;
  recargosSobretiempoMensual: number;
  tarifaMensualEstimada: number;
}

export interface ResultadoAdaptadorCargo {
  estadoUI: EstadoAdaptadorCargo;
  /** Único texto autorizado para mostrar al usuario — nunca nombres
   * internos de estado, nunca detalles técnicos del motor. */
  mensajeUsuario: string | null;
  /** Resultado completo — incluye `metodologia` (instantánea técnica).
   * Disponible para pruebas/diagnóstico; page.tsx NUNCA debe renderizar
   * `resultado.metodologia` ni pasarlo a ningún componente visual. */
  resultado: ResultadoTarifaMensual | null;
  /** Único subconjunto que page.tsx debe usar para la vista previa visible. */
  previewComercial: VistaPreviaMensualComercial | null;
}