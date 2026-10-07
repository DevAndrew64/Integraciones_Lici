/**
 * Total semanal (patrón, no período) de una o varias distribuciones, y su
 * evaluación frente a una meta semanal configurable. Independiente de
 * calcular-distribucion.ts: ese módulo trabaja sobre el período real del
 * cargo (fechasProgramadas dentro de fechaInicio/fechaFin); este trabaja
 * sobre el patrón semanal puro (diasSemana.length), que es lo que el modal
 * de horarios necesita mostrar como "N horas semanales" antes de conocer
 * ningún período. Minutos enteros — nunca Float como fuente interna.
 */
import { calcularHorario } from './normalizador-horario';
import type { DiasJornada, DistribucionHorarioConfigurada } from './tipos';

const DIAS_JORNADA_DUMMY: DiasJornada = { lun: false, mar: false, mie: false, jue: false, vie: false, sab: false, dom: false, fes: false };

/** minutosDia (de los bloques) × cantidad de días de la semana seleccionados. */
export function calcularMinutosSemanaDistribucion(configuracion: DistribucionHorarioConfigurada): number {
  if (configuracion.bloques.length === 0) return 0;
  const minutosDia = calcularHorario(configuracion.bloques, DIAS_JORNADA_DUMMY).minutosDiarios;
  return minutosDia * configuracion.diasSemana.length;
}

export function calcularTotalSemanalCargo(distribuciones: DistribucionHorarioConfigurada[]): number {
  return distribuciones.reduce((s, d) => s + calcularMinutosSemanaDistribucion(d), 0);
}

/**
 * "Guardar programación" (Bloque CIERRE FUNCIONAL DE DISTRIBUCIONES
 * HORARIAS §5B) se habilita únicamente con al menos una distribución ya
 * agregada — cada distribución ya agregada superó la validación de
 * solapes de días al momento de agregarse (validar-solapes-distribuciones.ts),
 * así que no hay nada adicional que revalidar aquí.
 */
export function puedeGuardarProgramacion(distribuciones: DistribucionHorarioConfigurada[]): boolean {
  return distribuciones.length > 0;
}

export type EstadoProgramacionSemanal = 'INCOMPLETA' | 'COMPLETA' | 'SUPERA_META';

export interface ResultadoEvaluacionProgramacionSemanal {
  estado: EstadoProgramacionSemanal;
  totalMinutos: number;
  metaMinutos: number;
  mensaje: string | null;
}

/**
 * `metaMinutos` es configurable por el llamador (ej. 2520 = 42 h) — nunca
 * fijo dentro de este módulo, para no acoplar la jornada legal vigente
 * aquí (eso lo resuelve el motor económico, no este bloque).
 */
export function evaluarProgramacionSemanal(
  totalMinutos: number,
  metaMinutos: number,
): ResultadoEvaluacionProgramacionSemanal {
  if (totalMinutos < metaMinutos) {
    return { estado: 'INCOMPLETA', totalMinutos, metaMinutos, mensaje: null };
  }
  if (totalMinutos === metaMinutos) {
    return { estado: 'COMPLETA', totalMinutos, metaMinutos, mensaje: null };
  }
  const excedente = totalMinutos - metaMinutos;
  return {
    estado: 'SUPERA_META',
    totalMinutos,
    metaMinutos,
    mensaje: `La programación suma ${formatearHorasMensaje(totalMinutos)} semanales, es decir, ${formatearHorasMensaje(excedente)} por encima de la jornada semanal de ${formatearHorasMensaje(metaMinutos)}.`,
  };
}

/** "120" → "2 horas"; "90" → "1 hora 30 minutos"; "60" → "1 hora". */
function formatearHorasMensaje(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  const partes: string[] = [];
  if (h > 0) partes.push(`${h} ${h === 1 ? 'hora' : 'horas'}`);
  if (m > 0) partes.push(`${m} ${m === 1 ? 'minuto' : 'minutos'}`);
  return partes.length > 0 ? partes.join(' ') : '0 minutos';
}
