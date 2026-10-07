/**
 * Presentación visual del estado del normalizador — texto y color por cada
 * uno de los 13 estados operativos, sin fallback genérico para estados
 * conocidos. `PRESENTACION_ESTADO_HORARIO` es un Record indexado por
 * EstadoNormalizacionHorario: si se agrega un estado nuevo al tipo sin
 * definir aquí su presentación, TypeScript deja de compilar (no hay forma
 * de "olvidarlo" en silencio).
 *
 * "Requiere revisión" (ESTADO_HORARIO_DESCONOCIDO) se reserva EXCLUSIVAMENTE
 * para cuando el valor recibido en runtime no corresponde a ninguno de los
 * 13 estados conocidos (dato corrupto/versión desincronizada) — nunca como
 * fallback de un estado real ya modelado.
 */
import type { EstadoNormalizacionHorario } from './tipos-normalizacion';

export type ColorEstadoHorario = 'verde' | 'amarillo' | 'naranja' | 'rojo';

export interface PresentacionEstadoHorario {
  texto: string;
  color: ColorEstadoHorario;
  bg: string;
  fg: string;
}

export const PRESENTACION_ESTADO_HORARIO: Record<EstadoNormalizacionHorario, PresentacionEstadoHorario> = {
  NORMALIZADO: {
    texto: 'Normalizado', color: 'verde', bg: '#ecfdf5', fg: '#047857',
  },
  NORMALIZADO_CON_ADVERTENCIAS: {
    texto: 'Con observaciones', color: 'amarillo', bg: '#fffbeb', fg: '#92400e',
  },
  DIFIERE_DE_DATOS_DECLARADOS: {
    texto: 'Difiere del dato declarado', color: 'amarillo', bg: '#fef9c3', fg: '#854d0e',
  },
  REQUIERE_ASIGNAR_DIAS: {
    texto: 'Requiere asignar días', color: 'naranja', bg: '#fff7ed', fg: '#c2410c',
  },
  REQUIERE_CONFIRMAR_ROTACION: {
    texto: 'Requiere confirmar rotación', color: 'naranja', bg: '#fff7ed', fg: '#c2410c',
  },
  REQUIERE_DETALLE_DESCANSO: {
    texto: 'Requiere completar descanso', color: 'naranja', bg: '#fff7ed', fg: '#c2410c',
  },
  REQUIERE_UBICAR_DESCANSO: {
    texto: 'Requiere ubicar descanso', color: 'naranja', bg: '#fff7ed', fg: '#c2410c',
  },
  REQUIERE_CONFIRMAR_HORA: {
    texto: 'Requiere confirmar hora', color: 'naranja', bg: '#fff7ed', fg: '#c2410c',
  },
  REQUIERE_CONFIRMAR_SEPARADORES: {
    texto: 'Requiere confirmar formato', color: 'naranja', bg: '#fff7ed', fg: '#c2410c',
  },
  REQUIERE_CONFIRMAR_CRUCE_MEDIANOCHE: {
    texto: 'Requiere confirmar turno nocturno', color: 'naranja', bg: '#fff7ed', fg: '#c2410c',
  },
  POSIBLE_INTERCAMBIO_DE_CAMPOS: {
    texto: 'Posible error de campos', color: 'rojo', bg: '#fef2f2', fg: '#b91c1c',
  },
  HORARIO_COMPUESTO_PENDIENTE: {
    texto: 'Requiere completar distribución', color: 'naranja', bg: '#fff7ed', fg: '#c2410c',
  },
  HORARIO_NO_INTERPRETABLE: {
    texto: 'No interpretable', color: 'rojo', bg: '#fef2f2', fg: '#b91c1c',
  },
};

export const ESTADO_HORARIO_DESCONOCIDO: PresentacionEstadoHorario = {
  texto: 'Requiere revisión', color: 'rojo', bg: '#fef2f2', fg: '#b91c1c',
};

/** Nunca usar este helper como sustituto de leer `PRESENTACION_ESTADO_HORARIO`
 * directamente cuando el tipo ya está garantizado — existe para el borde de
 * datos venidos de fetch() (string suelto, sin garantía de tipo en runtime). */
export function presentarEstadoHorario(estado: string | null | undefined): PresentacionEstadoHorario {
  if (estado && Object.prototype.hasOwnProperty.call(PRESENTACION_ESTADO_HORARIO, estado)) {
    return PRESENTACION_ESTADO_HORARIO[estado as EstadoNormalizacionHorario];
  }
  return ESTADO_HORARIO_DESCONOCIDO;
}