/**
 * Contrato de salida del NORMALIZADOR ROBUSTO DE HORARIOS HISTÓRICOS
 * (catálogo inhouse, texto digitado manualmente durante años). Independiente
 * del parser estricto (parser-horario.ts) que usa el formulario de texto
 * para registros NUEVOS — este contrato es para interpretar lo que YA
 * existe en el catálogo, con toda su variabilidad tipográfica y semántica.
 *
 * Principio rector: nunca inventar datos. Cuando la información es
 * insuficiente o ambigua, se conserva el texto original, se explica qué
 * falta, y se bloquea únicamente el cálculo que depende de ese dato — no
 * todo el resultado.
 */
import type { DiaSemanaHorario } from './tipos';
import type { PatronTurnoCiclico } from './patron-turno-ciclico';

export type EstadoNormalizacionHorario =
  | 'NORMALIZADO'
  | 'NORMALIZADO_CON_ADVERTENCIAS'
  | 'DIFIERE_DE_DATOS_DECLARADOS'
  | 'REQUIERE_ASIGNAR_DIAS'
  | 'REQUIERE_CONFIRMAR_ROTACION'
  | 'REQUIERE_DETALLE_DESCANSO'
  | 'REQUIERE_UBICAR_DESCANSO'
  | 'REQUIERE_CONFIRMAR_HORA'
  | 'REQUIERE_CONFIRMAR_SEPARADORES'
  | 'REQUIERE_CONFIRMAR_CRUCE_MEDIANOCHE'
  | 'POSIBLE_INTERCAMBIO_DE_CAMPOS'
  | 'HORARIO_COMPUESTO_PENDIENTE'
  | 'HORARIO_NO_INTERPRETABLE';

/** Nunca se muestra el identificador técnico al usuario — ver ESTADO_LEGIBLE. */
export const ESTADO_LEGIBLE: Record<EstadoNormalizacionHorario, string> = {
  NORMALIZADO: 'Normalizado',
  NORMALIZADO_CON_ADVERTENCIAS: 'Normalizado con observaciones',
  DIFIERE_DE_DATOS_DECLARADOS: 'Difiere de los datos declarados',
  REQUIERE_ASIGNAR_DIAS: 'Requiere asignar días',
  REQUIERE_CONFIRMAR_ROTACION: 'Requiere confirmar la rotación',
  REQUIERE_DETALLE_DESCANSO: 'Requiere completar el descanso',
  REQUIERE_UBICAR_DESCANSO: 'Requiere ubicar el descanso',
  REQUIERE_CONFIRMAR_HORA: 'Requiere confirmar una hora',
  REQUIERE_CONFIRMAR_SEPARADORES: 'Requiere confirmar separadores',
  REQUIERE_CONFIRMAR_CRUCE_MEDIANOCHE: 'Requiere confirmar el cruce de medianoche',
  POSIBLE_INTERCAMBIO_DE_CAMPOS: 'Posible error entre horario y jornada',
  HORARIO_COMPUESTO_PENDIENTE: 'Horario compuesto pendiente',
  HORARIO_NO_INTERPRETABLE: 'No fue posible interpretar el horario',
};

// Estado de ASIGNACIÓN OPERATIVA — independiente del estado de
// normalización del texto (§ separación de conceptos). Un turno cíclico
// (ej. 7X1) puede tener el horario perfectamente interpretado (estado de
// normalización) y, al mismo tiempo, tener pendiente la fecha de inicio
// del ciclo (estado de asignación) — nunca se colapsan en un solo badge.
export type EstadoAsignacionOperativa =
  | 'NINGUNO'
  | 'REQUIERE_FECHA_INICIO_ROTACION';

export const ESTADO_ASIGNACION_LEGIBLE: Record<EstadoAsignacionOperativa, string> = {
  NINGUNO: '',
  REQUIERE_FECHA_INICIO_ROTACION: 'Indique la fecha de inicio del ciclo para determinar los días de trabajo y descanso',
};

export type TipoAplicacionDistribucion =
  | 'POR_DIAS'
  | 'ROTACION_SEMANAL'
  | 'ALTERNATIVO'
  | 'TURNANTE'
  | 'PENDIENTE_CONFIRMACION';

export type FuenteDias =
  | 'FLAGS_API'
  | 'TEXTO_JORNADA'
  | 'TEXTO_HORARIO'
  | 'USUARIO'
  | 'NO_DETERMINADO';

export interface BloqueHorarioNormalizado {
  inicio: string; // "HH:mm"
  fin: string;    // "HH:mm"
  inicioDiaOffset: number; // 0 = mismo día que el inicio de la distribución
  finDiaOffset: number;
  minutos: number;
  orden: number;
}

export interface IntervaloDescanso {
  inicio: string | null;
  fin: string | null;
  minutos: number;
}

export interface DistribucionHorarioNormalizada {
  idTemporal: string;
  textoOriginal: string;
  textoCanonico: string | null;

  tipoAplicacion: TipoAplicacionDistribucion;

  diasSemana: DiaSemanaHorario[];
  fuenteDias: FuenteDias;

  bloques: BloqueHorarioNormalizado[];

  descansoDeclaradoMinutos: number | null;
  descansoUbicado: boolean;
  descansosDerivados: IntervaloDescanso[];

  cruzaMedianoche: boolean;
  minutosTrabajoCalculados: number | null;

  alias: string | null;
  anotaciones: string[];
  advertencias: string[];
}

export interface AdvertenciaNormalizacion {
  codigo: string;
  mensaje: string;
}

export interface CampoPendienteHorario {
  campo: string;
  motivo: string;
}

export interface ResultadoNormalizacionHorario {
  textoOriginal: string;
  textoPreNormalizado: string;
  textoCanonico: string | null;

  distribuciones: DistribucionHorarioNormalizada[];

  horasJornadaDeclaradas: number | null;
  horasSemanaDeclaradas: number | null;

  minutosJornadaCalculados: number | null;
  minutosSemanaCalculados: number | null;

  estado: EstadoNormalizacionHorario;
  nivelConfianza: 'ALTO' | 'MEDIO' | 'BAJO';

  advertencias: AdvertenciaNormalizacion[];
  camposPendientes: CampoPendienteHorario[];

  puedeAplicarse: boolean;
  puedeCalcularTiempoTotal: boolean;
  puedeClasificarCronologicamente: boolean;
  requiereConfirmacion: boolean;

  // Patrón cíclico trabajo/descanso (ej. 7X1) cuando el TURNO lo indica —
  // null si el turno no corresponde a ningún patrón cíclico conocido.
  patronTurnoCiclico: PatronTurnoCiclico | null;
  // minutos de UN ciclo completo trabajado por el titular (ej. 7 jornadas
  // de 460 min = 3220) — NUNCA es "minutos de una semana calendario fija".
  minutosCicloCalculados: number | null;
  // dato de validación únicamente (minutosCicloCalculados × 7 / duración del
  // ciclo) — nunca se usa para liquidar, solo para comparar contra lo
  // declarado; la liquidación real requiere materializar fechas concretas.
  promedioSemanalMinutosCiclo: number | null;
  estadoAsignacion: EstadoAsignacionOperativa;
  informacionOperativa: string[];
}

/** Entradas opcionales de contexto (JORNADA, flags, horas declaradas) — nunca obligatorias. */
export interface ContextoNormalizacionHorario {
  jornadaTexto?: string | null;
  turnoTexto?: string | null;
  horasJornadaDeclaradas?: number | null;
  horasSemanaDeclaradas?: number | null;
  flagsDias?: Partial<Record<DiaSemanaHorario, boolean>> | null;
  // Fecha de inicio del ciclo cíclico (ej. 7X1), "YYYY-MM-DD" — sin ella el
  // ciclo no puede materializarse, ver estadoAsignacion.
  fechaInicioCicloTurno?: string | null;
}