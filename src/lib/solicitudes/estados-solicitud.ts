/**
 * Estados terminales de `Solicitud.estadoSolicitud` — única fuente de
 * verdad, reutilizada por el cierre concurrente y por cualquier lógica que
 * necesite saber si una Solicitud ya no admite más acciones.
 *
 * Confirmado por inventario del código (page.tsx, MACRO de transición de
 * estadoRevision → estadoSolicitud): los únicos dos valores terminales que
 * `Solicitud.estadoSolicitud` puede tomar son "Cerrada" y "Cancelada".
 * "Presentado"/"En evaluación" NO son terminales (llevan a un siguiente
 * paso). "No viable" NO es un valor de `Solicitud.estadoSolicitud` — es un
 * campo booleano aparte (`Proceso.noViable`), de un modelo distinto; no se
 * incluye aquí a propósito.
 */
export const ESTADOS_SOLICITUD_TERMINALES = new Set(['Cerrada', 'Cancelada']);

export function esEstadoSolicitudTerminal(estado: string | null | undefined): boolean {
  return ESTADOS_SOLICITUD_TERMINALES.has(String(estado ?? ''));
}