/**
 * Enums de dominio del contexto semanal de Mano de Obra (Fase 1A.3A).
 *
 * Solo tipos y constantes tipadas — SIN lógica de negocio, SIN valores
 * por defecto asignados aquí (ningún campo de dominio "cae" en un valor
 * si no se declara explícitamente; ver docs/diseno-mano-obra/FASE_1A_1_DISENO_CONTEXTO_SEMANAL_MANO_OBRA.md
 * §17.1/§17.5 y docs/diseno-mano-obra/FASE_1A_2_ESPECIFICACION_IMPLEMENTACION_CONTEXTO_SEMANAL.md §8).
 *
 * Sin dependencias con React, Next.js, Prisma, BD, APIs, variables de
 * entorno, sistema de archivos ni fechas del servidor.
 */

export type ModalidadDistribucionJornada =
  | 'ESTANDAR'
  | 'FLEXIBLE_ACORDADA'
  | 'TURNOS_SUCESIVOS_ESPECIALES'
  | 'REGIMEN_ESPECIAL';

export const MODALIDADES_DISTRIBUCION_JORNADA: readonly ModalidadDistribucionJornada[] = [
  'ESTANDAR', 'FLEXIBLE_ACORDADA', 'TURNOS_SUCESIVOS_ESPECIALES', 'REGIMEN_ESPECIAL',
];

export type RegimenLaboral = 'GENERAL' | 'VIGILANCIA_SEGURIDAD_PRIVADA';

export const REGIMENES_LABORALES: readonly RegimenLaboral[] = [
  'GENERAL', 'VIGILANCIA_SEGURIDAD_PRIVADA',
];

export type TipoAsignacionTrabajador =
  | 'TURNO_ORDINARIO'
  | 'RELEVO'
  | 'COBERTURA_DESCANSO'
  | 'REEMPLAZO'
  | 'TURNO_ADICIONAL'
  | 'DESCANSO'
  | 'AUSENCIA'
  | 'FESTIVO_NO_LABORADO';

export const TIPOS_ASIGNACION_TRABAJADOR: readonly TipoAsignacionTrabajador[] = [
  'TURNO_ORDINARIO', 'RELEVO', 'COBERTURA_DESCANSO', 'REEMPLAZO',
  'TURNO_ADICIONAL', 'DESCANSO', 'AUSENCIA', 'FESTIVO_NO_LABORADO',
];

/** Asignaciones que implican trabajo efectivo — requieren bloques horarios (ver validadores.ts). */
export const TIPOS_ASIGNACION_LABORADA: readonly TipoAsignacionTrabajador[] = [
  'TURNO_ORDINARIO', 'RELEVO', 'COBERTURA_DESCANSO', 'REEMPLAZO', 'TURNO_ADICIONAL',
];

/** Asignaciones que NUNCA requieren bloques horarios. */
export const TIPOS_ASIGNACION_SIN_BLOQUES: readonly TipoAsignacionTrabajador[] = [
  'DESCANSO', 'AUSENCIA', 'FESTIVO_NO_LABORADO',
];

export type TipoDescansoObligatorio = 'FIJO' | 'ROTATIVO' | 'EXCEPCIONAL' | 'PENDIENTE_CONFIRMACION';

export const TIPOS_DESCANSO_OBLIGATORIO: readonly TipoDescansoObligatorio[] = [
  'FIJO', 'ROTATIVO', 'EXCEPCIONAL', 'PENDIENTE_CONFIRMACION',
];

export type EstadoContextoSemanal =
  | 'COMPLETO'
  | 'REQUIERE_CONTEXTO_ANTERIOR'
  | 'REQUIERE_PROGRAMACION_DIARIA'
  | 'INCONSISTENTE'
  | 'BLOQUEADO_POR_PARAMETROS'
  | 'LISTO_PARA_CLASIFICAR';

export const ESTADOS_CONTEXTO_SEMANAL: readonly EstadoContextoSemanal[] = [
  'COMPLETO', 'REQUIERE_CONTEXTO_ANTERIOR', 'REQUIERE_PROGRAMACION_DIARIA',
  'INCONSISTENTE', 'BLOQUEADO_POR_PARAMETROS', 'LISTO_PARA_CLASIFICAR',
];

export type FuenteProgramacion =
  | 'REGLA_SEMANAL'
  | 'EXCEPCION_FECHA'
  | 'MATRIZ_TURNO'
  | 'COBERTURA_DESCANSO'
  | 'AJUSTE_MANUAL'
  | 'API_TURNOS'
  | 'REGULARIZACION_MANUAL';

export const FUENTES_PROGRAMACION: readonly FuenteProgramacion[] = [
  'REGLA_SEMANAL', 'EXCEPCION_FECHA', 'MATRIZ_TURNO', 'COBERTURA_DESCANSO',
  'AJUSTE_MANUAL', 'API_TURNOS', 'REGULARIZACION_MANUAL',
];

export type TipoExcepcionProgramacion =
  | 'CAMBIO_TURNO'
  | 'DESCANSO_EXCEPCIONAL'
  | 'TRABAJO_ADICIONAL'
  | 'REEMPLAZO'
  | 'AUSENCIA'
  | 'INCAPACIDAD'
  | 'FESTIVO_NO_LABORADO'
  | 'COBERTURA'
  | 'AJUSTE_CONFIRMADO';

export const TIPOS_EXCEPCION_PROGRAMACION: readonly TipoExcepcionProgramacion[] = [
  'CAMBIO_TURNO', 'DESCANSO_EXCEPCIONAL', 'TRABAJO_ADICIONAL', 'REEMPLAZO',
  'AUSENCIA', 'INCAPACIDAD', 'FESTIVO_NO_LABORADO', 'COBERTURA', 'AJUSTE_CONFIRMADO',
];

/** Tipos de excepción que implican sustituir el turno/bloques del día (requieren turnoSustitutoId o bloquesSustitutos). */
export const TIPOS_EXCEPCION_CON_SUSTITUCION: readonly TipoExcepcionProgramacion[] = [
  'CAMBIO_TURNO', 'TRABAJO_ADICIONAL', 'REEMPLAZO', 'COBERTURA',
];

export type EstadoConfirmacion = 'PENDIENTE' | 'CONFIRMADO' | 'RECHAZADO';

export const ESTADOS_CONFIRMACION: readonly EstadoConfirmacion[] = [
  'PENDIENTE', 'CONFIRMADO', 'RECHAZADO',
];

export type FuenteAplicadaSobretiempo = 'AUTOMATICO' | 'MATRIZ_TURNO' | 'COBERTURA_DESCANSO' | 'AJUSTE_EXCEPCIONAL';

export const FUENTES_APLICADAS_SOBRETIEMPO: readonly FuenteAplicadaSobretiempo[] = [
  'AUTOMATICO', 'MATRIZ_TURNO', 'COBERTURA_DESCANSO', 'AJUSTE_EXCEPCIONAL',
];
