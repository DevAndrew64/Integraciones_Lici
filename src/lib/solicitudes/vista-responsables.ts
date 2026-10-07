/**
 * Lógica de presentación PURA para la sección "Responsables asignados"
 * (ficha y editor) — extraída para poder probarla sin jsdom/RTL. Nunca
 * decide autorización real (eso lo revalida el backend en cada endpoint),
 * solo qué mostrar dado un estado de carga ya resuelto.
 */
import type { AsignacionSeleccionable } from './seleccion-asignacion';

export type EstadoCargaResponsables<T> =
  | { tipo: 'loading' }
  | { tipo: 'error' }
  | { tipo: 'success'; responsables: T[] };

export interface VistaResponsables<T> {
  /** Mensaje a mostrar en vez de la lista (carga/error/vacío) — `null` cuando hay responsables que listar. */
  mensaje: string | null;
  /** Nunca contiene datos parciales: `[]` en loading/error, la lista completa en success. */
  responsables: T[];
}

export function calcularVistaResponsables<T extends AsignacionSeleccionable>(
  estado: EstadoCargaResponsables<T>,
): VistaResponsables<T> {
  if (estado.tipo === 'loading') return { mensaje: 'Cargando responsables…', responsables: [] };
  if (estado.tipo === 'error') return { mensaje: 'No fue posible cargar los responsables. Intenta nuevamente.', responsables: [] };
  if (estado.responsables.length === 0) return { mensaje: 'No hay responsables asignados.', responsables: [] };
  return { mensaje: null, responsables: estado.responsables };
}

/** Estados canónicos globales desde los que "Regresar a observaciones" está
 * disponible — Ejecución (aprobado/en elaboración) o ya presentado. Nunca
 * depende de `asignaciones[]` (ni primera, ni última, ni la más reciente):
 * el mismo resultado para cualquier orden del arreglo. */
const ESTADOS_CON_REGRESO_A_OBSERVACIONES = new Set(['APROBADO_ELABORACION', 'EN_ELABORACION', 'PRESENTADO']);

export function puedeRegresarAObservaciones(estadoGlobalCanonico: string | null | undefined): boolean {
  return !!estadoGlobalCanonico && ESTADOS_CON_REGRESO_A_OBSERVACIONES.has(estadoGlobalCanonico);
}