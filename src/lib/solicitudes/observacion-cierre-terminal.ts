/**
 * Ajuste "TIPO DE CIERRE SQR" (confirmado explícitamente) — punto ÚNICO
 * para obtener la observación de negocio que corresponde a un cierre
 * terminal `NO_PRESENTADO` (RECHAZADO, CERRADO_NO_CUMPLIMIENTO, CANCELADO)
 * — nunca el código interno del estado (`estadoRevision`). Prioridad:
 * texto libre escrito por el usuario (`motivoRechazo`/`observacionRechazo`/
 * `detalleCierreDirecto`) — si no hay texto libre, la causa/causal
 * seleccionada (ya es una etiqueta legible de negocio, nunca un código
 * interno como "CERRADO_NO_CUMPLIMIENTO").
 */

/** Mismas etiquetas que ya muestra el modal de rechazo con causal
 * (`ModalEditarAsignacion`, page.tsx) — única fuente para no divergir. */
export const ETIQUETA_CAUSAL_RECHAZO: Record<string, string> = {
  ESTUDIO_MERCADO: 'Estudio de mercado',
  PROCESO_DUPLICADO: 'Proceso duplicado',
  NO_OBJETO_SOCIAL: 'No corresponde a objeto social',
  SERVICIOS_ESPECIALIZADOS: 'Servicios especializados',
  DECISION_GERENCIAL: 'Decisión gerencial',
  // Ajuste "OTRA CAUSA — RECHAZO" — `observacionRechazo` es OBLIGATORIO para
  // esta causal (ver `validarRechazado` en `/cerrar/route.ts`), así que en
  // la práctica `obtenerObservacionCierreTerminal` (abajo) siempre devuelve
  // el detalle real antes de llegar a esta etiqueta — se agrega igual, por
  // paridad con las demás causales y como fallback defensivo.
  OTRA_CAUSA: 'Otra causa',
};

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * `fila` es el objeto YA VALIDADO por `validarFilaExtra`/`validarRechazado`/
 * `validarCierreDirecto`/`validarCerradoAdjudicado`/`validarCerradoNoAdjudicado`
 * en `/[id]/cerrar/route.ts` — nunca el body crudo del cliente. Devuelve
 * `null` únicamente cuando no hay fila (cierre administrativo directo sin
 * `filaExtra`).
 *
 * Ajuste "DETALLE DEL CIERRE — ADJUDICADO/NO ADJUDICADO" — `observacionResultado`
 * (texto obligatorio del analista en esos 2 flujos, ver `validarObservacionResultado`)
 * se contempla SOLO cuando `estadoRevision` de la fila es `CERRADO_ADJUDICADO`/
 * `CERRADO_NO_ADJUDICADO` — nunca como fallback genérico para cualquier
 * estado (esos 2 flujos nunca escriben `motivoRechazo`/`causalRechazo`/etc.,
 * así que en la práctica no había ambigüedad, pero se gatea explícitamente
 * por claridad y para que el bloque quede `null` — nunca una etiqueta
 * inventada — si el analista no dejó ese texto).
 */
export function obtenerObservacionCierreTerminal(fila: Record<string, unknown> | null | undefined): string | null {
  if (!fila) return null;

  const estadoRevisionFila = texto(fila.estadoRevision);
  if (estadoRevisionFila === 'CERRADO_ADJUDICADO' || estadoRevisionFila === 'CERRADO_NO_ADJUDICADO') {
    const observacionResultado = texto(fila.observacionResultado);
    return observacionResultado || null;
  }

  const motivoRechazo = texto(fila.motivoRechazo);
  if (motivoRechazo) return motivoRechazo;

  const observacionRechazo = texto(fila.observacionRechazo);
  if (observacionRechazo) return observacionRechazo;

  const detalleCierreDirecto = texto(fila.detalleCierreDirecto);
  if (detalleCierreDirecto) return detalleCierreDirecto;

  const causalRechazo = texto(fila.causalRechazo);
  if (causalRechazo) return ETIQUETA_CAUSAL_RECHAZO[causalRechazo] ?? causalRechazo;

  const causaNoPresentacion = texto(fila.causaNoPresentacion);
  if (causaNoPresentacion) return causaNoPresentacion;

  const causaEspecifica = texto(fila.causaEspecifica);
  if (causaEspecifica) return causaEspecifica;

  return null;
}

/**
 * `estadoRevision` que representan un cierre ANTES de presentar — únicos
 * casos donde el proceso se clasifica `NO_PRESENTADO`. `CERRADO_ADJUDICADO`/
 * `CERRADO_NO_ADJUDICADO` quedan deliberadamente fuera: ocurren DESPUÉS de
 * `PRESENTADO`, así que nunca sobrescriben esa clasificación.
 */
export const ESTADOS_REVISION_NO_PRESENTADO = new Set(['RECHAZADO', 'CERRADO_NO_CUMPLIMIENTO', 'CANCELADO']);

/**
 * Ajuste "MOTIVO DEL CIERRE — FILA TERMINAL REAL" — TODOS los `estadoRevision`
 * que representan un cierre terminal real de una fila de asignación (única
 * fuente para decidir cuál fila explica por qué se cerró el proceso).
 * Reutiliza `ESTADOS_REVISION_NO_PRESENTADO` (RECHAZADO/
 * CERRADO_NO_CUMPLIMIENTO/CANCELADO) y agrega los 2 estados de cierre CON
 * presentación (CERRADO_ADJUDICADO/CERRADO_NO_ADJUDICADO) — los mismos que
 * ese Set excluye deliberadamente por el motivo documentado arriba, pero
 * que SÍ son terminales a efectos de "qué fila cerró el proceso".
 */
export const ESTADOS_REVISION_TERMINALES = new Set<string>([
  'CERRADO_ADJUDICADO', 'CERRADO_NO_ADJUDICADO',
  ...ESTADOS_REVISION_NO_PRESENTADO,
]);

/**
 * Encuentra, dentro de `Solicitud.asignaciones[]`, la fila que realmente
 * cerró el proceso — NUNCA la fila "visible/accionable" para un viewer
 * concreto (`asigActual`/`seleccionarAsignacionVisible`, que da prioridad
 * a la fila propia del viewer y puede no ser la fila que cerró el
 * proceso: caso real detectado, proceso reasignado después del cierre).
 *
 * Criterio (documentado, determinístico, sin usar identidad del viewer):
 *  1. Filtra solo filas con `estadoRevision` en `ESTADOS_REVISION_TERMINALES`.
 *  2. Si hay exactamente una, se usa esa.
 *  3. Si hay 2+ (no debería ocurrir en el flujo normal — una Solicitud
 *     cierra una sola vez — pero se protege igual), se usa la de
 *     `fechaCierre` más reciente (campo SIEMPRE fijado por el servidor,
 *     nunca por el cliente — ver `CAMPOS_SIEMPRE_SERVIDOR`,
 *     `/api/solicitudes/[id]/cerrar/route.ts`).
 *  4. Si ninguna fila terminal tiene `fechaCierre` parseable, fallback
 *     determinístico: la ÚLTIMA fila terminal en el orden recibido
 *     (`asignaciones[]`, nunca por identidad del viewer).
 *  5. Si no hay ninguna fila terminal, devuelve `null`.
 */
export function obtenerFilaCierreTerminal(asignaciones: unknown): Record<string, unknown> | null {
  const filas = Array.isArray(asignaciones) ? (asignaciones as Record<string, unknown>[]) : [];
  const terminales = filas.filter((a) => ESTADOS_REVISION_TERMINALES.has(texto(a?.estadoRevision)));
  if (terminales.length === 0) return null;
  if (terminales.length === 1) return terminales[0];

  let mejor: Record<string, unknown> | null = null;
  let mejorFecha = -Infinity;
  for (const fila of terminales) {
    const raw = texto(fila.fechaCierre);
    const t = raw ? new Date(raw).getTime() : NaN;
    if (!Number.isNaN(t) && t > mejorFecha) {
      mejorFecha = t;
      mejor = fila;
    }
  }
  if (mejor) return mejor;

  return terminales[terminales.length - 1];
}
