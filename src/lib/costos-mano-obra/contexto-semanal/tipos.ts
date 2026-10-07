/**
 * Contratos de dominio del contexto semanal de Mano de Obra (Fase 1A.3A).
 *
 * Importa únicamente desde enums.ts. Sin dependencias con Prisma, React,
 * Next.js, BD, APIs ni código económico. Las fechas se representan como
 * string ISO ("YYYY-MM-DD" para fechas de calendario, "YYYY-MM-DDTHH:mm:ssZ"
 * o equivalente para timestamps) — nunca como `Date` obligatorio, para no
 * introducir dependencia de la zona horaria del entorno de ejecución.
 * La unidad interna de toda duración es MINUTOS ENTEROS.
 */
import type {
  ModalidadDistribucionJornada,
  RegimenLaboral,
  TipoAsignacionTrabajador,
  TipoDescansoObligatorio,
  EstadoContextoSemanal,
  FuenteProgramacion,
  TipoExcepcionProgramacion,
  EstadoConfirmacion,
} from './enums';

/** Día de la semana en notación corta, mismo criterio ya usado en motor-mano-obra.ts. */
export type DiaSemana = 'L' | 'M' | 'X' | 'J' | 'V' | 'S' | 'D';

export const DIAS_SEMANA: readonly DiaSemana[] = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

// ── A. Bloque horario ──────────────────────────────────────────────────────

export interface BloqueHorarioContexto {
  inicio: string; // "HH:mm"
  fin: string;    // "HH:mm"
  orden: number;
}

// ── B. Patrón de trabajador ─────────────────────────────────────────────────

export interface PatronTrabajadorContexto {
  id?: number;
  cargoManoObraId: number;
  codigo: string;
  nombre: string;
  cantidadTrabajadores: number;
  jornadaContractualSemanalMinutos: number;
  modalidadDistribucionJornada: ModalidadDistribucionJornada;
  /** null = no aplica (modalidad != FLEXIBLE_ACORDADA); true/false solo tiene sentido si aplica. */
  acuerdoJornadaFlexible: boolean | null;
  regimenLaboral: RegimenLaboral;
  tipoDescanso: TipoDescansoObligatorio;
  diaDescansoObligatorio?: DiaSemana;
  zonaHoraria: string;
  vigenteDesde: string;   // "YYYY-MM-DD"
  vigenteHasta?: string;  // "YYYY-MM-DD" | ausente = indefinido
  activo: boolean;
  version: number;
  origen: FuenteProgramacion;
}

// ── C. Regla semanal del patrón ─────────────────────────────────────────────

export interface ReglaSemanalPatronContexto {
  diaSemana: DiaSemana;
  tipoAsignacion: TipoAsignacionTrabajador;
  turnoManoObraId?: number;
  horarioCatalogoId?: number;
  bloques: BloqueHorarioContexto[];
  minutosOrdinariosPactados: number;
  orden: number;
  activo: boolean;
  vigenteDesde: string;
  vigenteHasta?: string;
}

// ── D. Excepción de programación por fecha ──────────────────────────────────

export interface ExcepcionProgramacionContexto {
  fecha: string; // "YYYY-MM-DD"
  tipo: TipoExcepcionProgramacion;
  turnoSustitutoId?: number;
  bloquesSustitutos?: BloqueHorarioContexto[];
  motivo: string;
  fuente: FuenteProgramacion;
  estadoConfirmacion: EstadoConfirmacion;
  usuarioConfirmo?: string;
  fechaConfirmacion?: string;
  referenciaSustituida?: string;
}

// ── E. Programación diaria calculada (estructura temporal, no persistente) ──

export interface ProgramacionDiariaCalculada {
  fecha: string;
  diaSemana: DiaSemana;
  tipoAsignacion: TipoAsignacionTrabajador;
  bloques: BloqueHorarioContexto[];
  minutosTrabajadosProgramados: number;
  minutosOrdinariosPactados: number;
  fuente: FuenteProgramacion;
  excepcionesAplicadas: ExcepcionProgramacionContexto[];
  contextoCompleto: boolean;
}

// ── F. Alerta del contexto semanal ──────────────────────────────────────────

export type SeveridadAlerta = 'INFO' | 'ADVERTENCIA' | 'ERROR' | 'BLOQUEANTE';

export const SEVERIDADES_ALERTA: readonly SeveridadAlerta[] = ['INFO', 'ADVERTENCIA', 'ERROR', 'BLOQUEANTE'];

export interface AlertaContextoSemanal {
  codigo: string;
  mensaje: string;
  severidad: SeveridadAlerta;
  bloqueaCalculo: boolean;
  fecha?: string;
  campo?: string;
}

// ── G. Contexto semanal base ────────────────────────────────────────────────

export interface ContextoSemanalBase {
  patron: PatronTrabajadorContexto;
  semanaInicio: string; // lunes 00:00, "YYYY-MM-DD"
  semanaFin: string;    // domingo, "YYYY-MM-DD"
  zonaHoraria: string;
  jornadaContractualSemanalMinutos: number;
  programacion: ProgramacionDiariaCalculada[];
  minutosTrabajadosAcumulados: number;
  /** null explícito = no determinable todavía — NUNCA 0 por defecto. */
  minutosOrdinariosAcumulados: number | null;
  /** null explícito = no determinable todavía — NUNCA 0 por defecto. */
  minutosExtraAcumulados: number | null;
  versionContexto: number;
  fechaConstruccion: string;
  alertas: AlertaContextoSemanal[];
}

// ── H. Resultado del contexto semanal — unión discriminada por `estado` ────

export interface ContextoSemanalListo {
  estado: 'LISTO_PARA_CLASIFICAR';
  contextoCompleto: true;
  contexto: ContextoSemanalBase;
  faltantes: [];
}

export interface ContextoSemanalIncompleto {
  estado: 'REQUIERE_CONTEXTO_ANTERIOR' | 'REQUIERE_PROGRAMACION_DIARIA';
  contextoCompleto: false;
  contexto: Partial<ContextoSemanalBase>;
  faltantes: string[];
  alertas: AlertaContextoSemanal[];
}

export interface ContextoSemanalInconsistente {
  estado: 'INCONSISTENTE';
  contextoCompleto: false;
  errores: ErrorValidacionDominio[];
  alertas: AlertaContextoSemanal[];
}

export interface ContextoSemanalBloqueado {
  estado: 'BLOQUEADO_POR_PARAMETROS';
  contextoCompleto: false;
  regimenLaboral: RegimenLaboral;
  parametrosFaltantes: string[];
  alertas: AlertaContextoSemanal[];
}

/**
 * ResultadoContextoSemanal cubre 5 de los 6 valores de EstadoContextoSemanal
 * ('LISTO_PARA_CLASIFICAR' | 'REQUIERE_CONTEXTO_ANTERIOR' | 'REQUIERE_PROGRAMACION_DIARIA'
 * | 'INCONSISTENTE' | 'BLOQUEADO_POR_PARAMETROS'). 'COMPLETO' es un estado
 * intermedio de construcción (usado por validarContextoParcial en
 * validadores.ts), no una variante final de este tipo.
 */
export type ResultadoContextoSemanal =
  | ContextoSemanalListo
  | ContextoSemanalIncompleto
  | ContextoSemanalInconsistente
  | ContextoSemanalBloqueado;

// ── I. Resultado de validación genérico ─────────────────────────────────────

export interface ErrorValidacionDominio {
  codigo: string;
  campo: string;
  mensaje: string;
  valorRecibido?: unknown;
}

export type ResultadoValidacion<T> =
  | { valido: true; valor: T; errores: [] }
  | { valido: false; errores: ErrorValidacionDominio[] };
