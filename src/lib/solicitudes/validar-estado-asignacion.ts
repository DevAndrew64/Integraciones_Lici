/**
 * Blindaje centralizado: nunca debe poder guardarse
 * `estadoSolicitud = "Asignado para revisión"` con `asignaciones` vacío.
 *
 * No basta con mirar el cuerpo del PATCH tal cual llega — se calcula el
 * ESTADO FINAL real después de combinar:
 *   actuales (en BD) + agregar (agregarResponsables) − remover (removerResponsables)
 * y solo entonces se valida contra el `estadoSolicitud` resultante. Esta es
 * la única puerta de entrada: tanto POST (creación) como PATCH (edición)
 * deben pasar por aquí antes de escribir en BD — nunca se agregan reglas
 * sueltas en cada botón del frontend.
 */
import { resolverResponsableElegible } from './validar-responsable';
import type { PrismaDb } from './crear-solicitud';

export class EstadoAsignacionInvalidoError extends Error {}

export interface AsignacionSolicitud {
  idAsignacion?: string;
  analistaAsignado?: string;
  [key: string]: unknown;
}

export interface ResponsableAAgregar {
  usuario: string;
  cargo?: string;
  entidadGrupo?: string;
}

export interface EntradaCalculoEstadoFinal {
  estadoActual: string;
  actuales: AsignacionSolicitud[];
  agregar?: ResponsableAAgregar[];
  remover?: string[];
  /** Si el llamador no pide explícitamente un estado nuevo, se conserva
   * `estadoActual` — igual se valida contra el resultado final. */
  estadoSolicitalPedido?: string | null;
  /** Constructor de una fila de asignación completa — inyectado por el
   * llamador (POST/PATCH) porque cada uno arma campos distintos
   * (solicitudId, codigoProceso, entidad, etc.) que esta función no conoce. */
  construirAsignacion: (r: ResponsableAAgregar) => AsignacionSolicitud;
}

/** Estados que EXIGEN al menos un responsable (asignación o revisor) —
 * cualquier otro valor de estadoSolicitud no tiene esta restricción (ej.
 * "Selección de proceso", "Cerrada", "Cancelada" pueden no tener
 * responsable). Única fuente de verdad — reutilizada tanto por el POST
 * (creación) como por el PATCH (edición) de `/api/solicitudes`. */
export const ESTADOS_QUE_EXIGEN_RESPONSABLE = new Set([
  'Asignado para revisión', 'Asignado para elaboración', 'En revisión',
  'En revisión comercial', 'En ejecución', 'En evaluación',
]);

export async function calcularYValidarEstadoFinal(
  db: PrismaDb,
  entrada: EntradaCalculoEstadoFinal,
): Promise<{ asignacionesFinal: AsignacionSolicitud[]; estadoFinal: string }> {
  const remover = new Set((entrada.remover ?? []).map((u) => u.trim()));
  let finales = entrada.actuales.filter((a) => !remover.has(String(a.analistaAsignado ?? '').trim()));

  for (const candidato of entrada.agregar ?? []) {
    const nombre = (candidato.usuario ?? '').trim();
    if (!nombre) continue;
    // Duplicados: nunca se agrega dos veces el mismo responsable — se
    // ignora silenciosamente el repetido (mismo comportamiento ya
    // existente en el endpoint, no es un caso de error).
    if (finales.some((a) => String(a.analistaAsignado ?? '').trim() === nombre)) continue;

    const elegible = await resolverResponsableElegible(db, nombre);
    if (!elegible) {
      throw new EstadoAsignacionInvalidoError(
        `El usuario "${nombre}" no existe, no está activo, o no tiene un rol habilitado para gestión comercial. ` +
        'No se asigna — nunca se inventa un responsable.',
      );
    }
    finales = [...finales, entrada.construirAsignacion({ usuario: elegible.usuario, cargo: elegible.cargo, entidadGrupo: elegible.entidadGrupo })];
  }

  const estadoFinal = entrada.estadoSolicitalPedido || entrada.estadoActual;

  if (ESTADOS_QUE_EXIGEN_RESPONSABLE.has(estadoFinal) && finales.length === 0) {
    throw new EstadoAsignacionInvalidoError(
      `No se puede guardar el estado "${estadoFinal}" sin al menos un responsable asignado. ` +
      'Si se removió el último responsable, debe indicarse explícitamente un estado coherente (ej. "En revisión" o "Selección de proceso").',
    );
  }

  return { asignacionesFinal: finales, estadoFinal };
}