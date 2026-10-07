/**
 * Construcción pura del body que se envía a `POST /api/solicitudes/[id]/cerrar`
 * — extraída de los 3 call-sites de `page.tsx` migrados en esta ronda
 * (`VistFichaAsignacion.guardarCierreDirecto`, `ModalEditarAsignacion.handleRechazar`,
 * `ModuloProcesosEnEjecucion.cerrarGerencial`) para poder probarla sin
 * infraestructura de componentes React. El backend vuelve a validar todo
 * de forma independiente (allowlist + coherencia) — esto solo evita que el
 * cliente arme un payload con forma incorrecta o con campos de más.
 */

export interface PayloadCierre {
  idAsignacion: string;
  resultadoEstado: 'Cerrada' | 'Cancelada';
  filaExtra: Record<string, unknown>;
}

export function payloadCierreAdjudicado(idAsignacion: string): PayloadCierre {
  return { idAsignacion, resultadoEstado: 'Cerrada', filaExtra: { estadoRevision: 'CERRADO_ADJUDICADO', resultadoFinal: 'Adjudicado' } };
}

export function payloadCierreNoAdjudicado(idAsignacion: string): PayloadCierre {
  return { idAsignacion, resultadoEstado: 'Cerrada', filaExtra: { estadoRevision: 'CERRADO_NO_ADJUDICADO', resultadoFinal: 'No adjudicado' } };
}

/** "Cerrar sin presentar" — CANCELADO si la causa es "Cancelación por la entidad", CERRADO_NO_CUMPLIMIENTO en los demás casos. */
export function payloadCierreDirecto(
  idAsignacion: string,
  causaNoPresentacion: string,
  detalleCierreDirecto: string | null,
  evidenciaCierre: { nombre: string; tipo: string; base64: string } | null,
): PayloadCierre {
  const esCancelado = causaNoPresentacion === 'Cancelación por la entidad';
  return {
    idAsignacion,
    resultadoEstado: esCancelado ? 'Cancelada' : 'Cerrada',
    filaExtra: {
      estadoRevision: esCancelado ? 'CANCELADO' : 'CERRADO_NO_CUMPLIMIENTO',
      causaNoPresentacion,
      detalleCierreDirecto: detalleCierreDirecto?.trim() || null,
      evidenciaCierre: evidenciaCierre ?? null,
    },
  };
}

/** Rechazo simple (motivo de texto libre) — GestionAsignacionInline ya usa este, se conserva aquí como referencia reutilizable. */
export function payloadRechazoSimple(idAsignacion: string, motivoRechazo: string): PayloadCierre {
  return { idAsignacion, resultadoEstado: 'Cerrada', filaExtra: { estadoRevision: 'RECHAZADO', motivoRechazo } };
}

/** Rechazo con causal + evidencia opcional — ModalEditarAsignacion.handleRechazar. */
export function payloadRechazoCausal(
  idAsignacion: string,
  causalRechazo: string,
  observacionRechazo: string,
  urlEvidenciaRechazo: string | null,
): PayloadCierre {
  return {
    idAsignacion,
    resultadoEstado: 'Cerrada',
    filaExtra: { estadoRevision: 'RECHAZADO', causalRechazo, observacionRechazo, urlEvidenciaRechazo },
  };
}

/** Cierre gerencial (sin resultadoFinal) — ModuloProcesosEnEjecucion.cerrarGerencial. */
export function payloadCierreGerencial(idAsignacion: string, causaEspecifica: string): PayloadCierre {
  return {
    idAsignacion,
    resultadoEstado: 'Cerrada',
    filaExtra: { estadoRevision: 'CERRADO_NO_ADJUDICADO', tipoCausa: 'Determinación gerencial', causaEspecifica },
  };
}