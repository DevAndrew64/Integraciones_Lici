/**
 * Motor DISTRIBUIDO (Bloque HORARIOS 2B) — liquidación económica de un
 * cargo cuya programación horaria ya es estructurada (distribucionesHorario,
 * ver src/lib/costos-mano-obra/horarios/tipos.ts). Reemplaza al motor legado
 * (calcularHorasYCostoLinea, page.tsx) para esos cargos: nunca trata el
 * primer inicio y el último fin como un intervalo continuo, nunca rellena
 * el rango completo sin filtrar por día, y clasifica ordinaria/extra por el
 * ACUMULADO SEMANAL (no por un tope diario fijo por fecha).
 *
 * Régimen GENERAL, julio 2026: jornada semanal 2520 min (42h), divisor
 * mensual 210. Estas dos constantes quedan fijas aquí (no resueltas por
 * vigencia todavía — esa es la Fase 1 del plan de vigencias, fuera de
 * alcance de este bloque) y documentadas explícitamente para auditoría.
 */
import type { DistribucionHorarioConfigurada } from '../horarios/tipos';

export const JORNADA_SEMANAL_MINUTOS_GENERAL_2026 = 2520; // 42 h
export const DIVISOR_MENSUAL_GENERAL_2026 = 210;
export const NOCTURNO_INICIO_HORA = 19;
export const NOCTURNO_FIN_HORA = 6;

export interface EntradaCargoDistribuido {
  distribuciones: DistribucionHorarioConfigurada[];
  fechaInicio: string; // "YYYY-MM-DD", inicio del PERÍODO económico del cargo
  fechaFin: string;
  salarioMensual: number;
  headcount: number;
}

/** Minutos de un día ya separados en diurno/nocturno, dentro de sus 2 posibles rutas (hábil/dominical). */
export interface MinutosDiaClasificados {
  fecha: string;
  esDomingo: boolean;
  dentroDelPeriodo: boolean; // false = día de contexto (ej. el lunes anterior), nunca se cobra
  minutosTotales: number;
  minutosNocturnos: number;
}

export interface HorasBucketsDistribuido {
  ordinariaHabil: number;      // minutos
  recargoNocturno: number;
  extraDiurna: number;
  extraNocturna: number;
  ordinariaDominical: number;
  recargoNocturnoDominical: number;
  extraDiurnaFestiva: number;
  extraNocturnaFestiva: number;
}

export type EstadoLiquidacionDistribuida =
  | 'CALCULADO'
  | 'REQUIERE_CONTEXTO_ANTERIOR'
  | 'BLOQUEADO_POR_PARAMETROS'
  | 'INCONSISTENTE';

export interface ConceptoMonetario {
  concepto: keyof HorasBucketsDistribuido;
  minutos: number;
  horasDecimal: number;
  factor: number;
  valorSinRedondear: number;
  valorRedondeado: number;
}

export interface ResultadoLiquidacionDistribuida {
  estado: EstadoLiquidacionDistribuida;
  mensaje: string | null;
  cantidadDias: number;
  minutosPeriodo: number;
  buckets: HorasBucketsDistribuido;
  conceptos: ConceptoMonetario[];
  valorHoraExacto: number;
  valorHoraMostrado: number;
  salarioBasico: number;
  costoRecargos: number;
  auxTransporte: number;
  totalPeriodo: number;
}
