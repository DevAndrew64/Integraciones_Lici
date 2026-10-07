/**
 * Intérprete automático de turnos — capa NUEVA, puramente informativa/
 * clasificadora, intercalada entre el horario ya capturado por el usuario
 * (cargo, cantidad, salario, días, incluyeFestivos, bloques horarios — sin
 * cambios) y el derivador comercial (derivar-distribucion-comercial.ts).
 *
 * Decide DETERMINÍSTICAMENTE, sin preguntar nunca al usuario, qué patrón
 * de operación representa una programación: jornada individual normal,
 * turno de 12 horas individual, o una POSICIÓN de cobertura permanente
 * (12/7 o 24/7) que requerirá turnantes (fase futura, no implementada
 * aquí — ver §10 del cierre "INTÉRPRETE AUTOMÁTICO DE TURNOS").
 *
 * Regla central verificada contra el caso Avianca (CAV/CEO): la cantidad
 * capturada para una posición de cobertura permanente NUNCA representa
 * trabajadores físicos — representa posiciones/puntos de servicio. Este
 * módulo nunca multiplica horas de un bloque de 24h como si fueran las de
 * una sola persona; ver derivar-distribucion-comercial.ts para cómo se
 * traduce cada turno (diurno/nocturno) a horas ordinarias/extra por
 * separado, con su propia cuota.
 */
import type { BloqueHorario, DiaSemanaHorario } from '../horarios/tipos';
import { duracionBloqueMin } from './normalizar-bloques-turno';

export const VERSION_INTERPRETADOR_TURNOS = 'interprete-turnos-v1';

/** Turnos semanales de 12h que componen la jornada ordinaria comercial
 * vigente (42h ÷ 4 = 10,5h ordinarias por turno, §5 del cierre). Única
 * fuente de este parámetro — nunca se repite el literal 4 en otro
 * archivo para este propósito. */
export const TURNOS_SEMANALES_12_HORAS = 4;
const DURACION_TURNO_12_HORAS_MIN = 720; // 12h — tolerancia de comparación de duración de bloque.
const MINUTOS_DIA_TOTAL = 1440;

export type TipoOperacionInterpretada =
  | 'COBERTURA_24_7'
  | 'COBERTURA_12_7'
  | 'TURNO_12_HORAS_INDIVIDUAL'
  | 'JORNADA_INDIVIDUAL'
  | 'JORNADA_PARCIAL';

export type SignificadoCantidad = 'POSICIONES' | 'TRABAJADORES';

export interface ResultadoInterpretacionTurno {
  tipoOperacionInterpretada: TipoOperacionInterpretada;
  significadoCantidad: SignificadoCantidad;
  cantidadPosiciones: number;
  turnosInterpretados: number;
  duracionTurnoHoras: number | null;
  cruzaMedianoche: boolean;
  coberturaSemanalPorPosicion: number;
  coberturaSemanalTotal: number;
  requiereTurnantes: boolean;
  brechaCoberturaPendiente: boolean;
  versionInterpretador: string;
}

export interface EntradaInterpretacionTurno {
  /** Días de la semana efectivamente seleccionados (unión de todas las
   * distribuciones del cargo). */
  diasSemana: DiaSemanaHorario[];
  /** Bloques del día representativo, YA normalizados (ver
   * normalizarBloques24Horas) — nunca un bloque con inicio===fin. */
  bloques: BloqueHorario[];
  incluyeFestivos: boolean;
  /** Valor tal cual lo digitó el usuario en "cantidad" — se reinterpreta
   * aquí como posiciones o trabajadores según el patrón detectado, nunca
   * se le pregunta al usuario cuál es. */
  cantidad: number;
}

const DIAS_ORDINARIOS: DiaSemanaHorario[] = ['L', 'M', 'X', 'J', 'V', 'S'];

function esBloqueDe12Horas(b: BloqueHorario): boolean {
  return Math.abs(duracionBloqueMin(b) - DURACION_TURNO_12_HORAS_MIN) < 1;
}

function cruzaMedianocheBloque(b: BloqueHorario): boolean {
  const [hi, mi] = b.inicio.split(':').map(Number);
  const [hf, mf] = b.fin.split(':').map(Number);
  const inicioMin = hi * 60 + mi;
  const finMin = hf * 60 + mf;
  return finMin <= inicioMin; // incluye el caso ya dividido (fin=inicio+12h) cuando el bloque nocturno cruza 00:00
}

export type PatronBloquesDia = 'DOBLE_12H' | 'UNICO_12H' | 'OTRO';

/**
 * Clasifica los bloques de UN día (de UNA distribución específica, ya
 * normalizados) según si conforman un patrón fijo de turno de 12 horas —
 * reutilizada tanto por `interpretarOperacionTurno` (metadata) como por
 * derivar-distribucion-comercial.ts (decisión de cuota POR DÍA, nunca por
 * un "día representativo" único cuando el cargo mezcla distribuciones
 * distintas, §4 del cierre correctivo).
 */
export function clasificarPatronBloquesDia(bloques: BloqueHorario[]): PatronBloquesDia {
  const totalMinutosBloques = bloques.reduce((acc, b) => acc + duracionBloqueMin(b), 0);
  if (bloques.length >= 2 && totalMinutosBloques >= MINUTOS_DIA_TOTAL) return 'DOBLE_12H';
  if (bloques.length === 1 && esBloqueDe12Horas(bloques[0])) return 'UNICO_12H';
  return 'OTRO';
}

/**
 * Único punto de entrada del intérprete — determinístico, sin efectos de
 * lado, sin I/O. Aplica las reglas A–E del cierre en orden:
 * A) COBERTURA_24_7, B) COBERTURA_12_7, C) TURNO_12_HORAS_INDIVIDUAL,
 * D) JORNADA_INDIVIDUAL, E) JORNADA_PARCIAL.
 */
export function interpretarOperacionTurno(entrada: EntradaInterpretacionTurno): ResultadoInterpretacionTurno {
  const bloques = entrada.bloques;
  const todosLosDiasOrdinarios = DIAS_ORDINARIOS.every(d => entrada.diasSemana.includes(d));
  const incluyeDomingo = entrada.diasSemana.includes('D');
  const coberturaPermanente = todosLosDiasOrdinarios && incluyeDomingo && entrada.incluyeFestivos;

  const totalMinutosBloques = bloques.reduce((acc, b) => acc + duracionBloqueMin(b), 0);
  const patron = clasificarPatronBloquesDia(bloques);
  const cubre24Horas = patron === 'DOBLE_12H';
  const esUnBloqueDe12h = patron === 'UNICO_12H';
  const cruzaMedianoche = bloques.some(cruzaMedianocheBloque);

  let tipo: TipoOperacionInterpretada;
  if (cubre24Horas && coberturaPermanente) {
    tipo = 'COBERTURA_24_7';
  } else if (esUnBloqueDe12h && coberturaPermanente) {
    tipo = 'COBERTURA_12_7';
  } else if (esUnBloqueDe12h) {
    tipo = 'TURNO_12_HORAS_INDIVIDUAL';
  } else if (!todosLosDiasOrdinarios) {
    tipo = 'JORNADA_PARCIAL';
  } else {
    tipo = 'JORNADA_INDIVIDUAL';
  }

  const esPosicion = tipo === 'COBERTURA_24_7' || tipo === 'COBERTURA_12_7';
  const cantidadPosiciones = entrada.cantidad;

  const turnosInterpretados = tipo === 'COBERTURA_24_7' ? 2 : (tipo === 'COBERTURA_12_7' || tipo === 'TURNO_12_HORAS_INDIVIDUAL' ? 1 : bloques.length);
  const duracionTurnoHoras = tipo === 'COBERTURA_24_7' || tipo === 'COBERTURA_12_7' || tipo === 'TURNO_12_HORAS_INDIVIDUAL'
    ? DURACION_TURNO_12_HORAS_MIN / 60
    : null;

  const diasSemanaCount = entrada.diasSemana.length;
  const coberturaSemanalPorPosicion =
    tipo === 'COBERTURA_24_7' ? 168 :
    tipo === 'COBERTURA_12_7' ? 84 :
    (totalMinutosBloques / 60) * diasSemanaCount;
  const coberturaSemanalTotal = coberturaSemanalPorPosicion * (esPosicion ? cantidadPosiciones : 1);

  return {
    tipoOperacionInterpretada: tipo,
    significadoCantidad: esPosicion ? 'POSICIONES' : 'TRABAJADORES',
    cantidadPosiciones,
    turnosInterpretados,
    duracionTurnoHoras,
    cruzaMedianoche,
    coberturaSemanalPorPosicion,
    coberturaSemanalTotal,
    requiereTurnantes: esPosicion,
    brechaCoberturaPendiente: esPosicion,
    versionInterpretador: VERSION_INTERPRETADOR_TURNOS,
  };
}

/** Notas informativas de solo lectura (§1 del cierre correctivo) — nunca
 * solicitan respuesta del usuario, solo describen lo que el intérprete ya
 * decidió automáticamente. Siempre al menos una línea (tipo de
 * operación); líneas adicionales cuando la cantidad se reinterpretó como
 * posiciones o cuando el resultado sigue siendo provisional. */
export function notasInterpretacionTurno(r: ResultadoInterpretacionTurno): string[] {
  const notas: string[] = [];
  switch (r.tipoOperacionInterpretada) {
    case 'COBERTURA_24_7':
      notas.push('Cobertura 24/7 detectada: dos turnos diarios de 12 horas.');
      break;
    case 'COBERTURA_12_7':
      notas.push('Cobertura 12/7 detectada: un turno diario de 12 horas.');
      break;
    case 'TURNO_12_HORAS_INDIVIDUAL':
      notas.push('Turno de 12 horas interpretado.');
      break;
    case 'JORNADA_PARCIAL':
      notas.push('Jornada parcial interpretada.');
      break;
    default:
      notas.push('Jornada individual interpretada.');
  }
  if (r.significadoCantidad === 'POSICIONES') {
    notas.push('Cantidad interpretada como posiciones de servicio.');
    if (r.cantidadPosiciones === 3) notas.push('Tres posiciones simultáneas.');
    else if (r.cantidadPosiciones > 1) notas.push(`${r.cantidadPosiciones} posiciones simultáneas.`);
  }
  if (r.brechaCoberturaPendiente) notas.push('Resultado provisional pendiente de titulares y turnantes.');
  return notas;
}