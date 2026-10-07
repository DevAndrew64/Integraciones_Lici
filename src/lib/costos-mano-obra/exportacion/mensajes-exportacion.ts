/**
 * Ajuste "EXPORTAR COSTOS — MENSAJES AL USUARIO" — textos que ve el usuario al
 * exportar. Módulo PURO (sin `node:fs` ni React) para poder usarlo tanto en
 * los routes de export como en la pantalla de Costos.
 *
 * Criterio (pedido explícito del usuario):
 *  - El botón "Exportar costos" SIEMPRE está habilitado (salvo mientras genera)
 *    para que cada bloqueo muestre su mensaje al hacer clic; ver
 *    `exportarCostos` en page.tsx.
 *  - Si el Excel no se puede generar por cualquier causa (plantilla ausente,
 *    error de escritura, etc.) el usuario ve SOLO que ocurrió un error: el
 *    detalle técnico (qué archivo falta, dónde) queda en el log del servidor,
 *    nunca en pantalla.
 */

/** Mensaje único para cualquier fallo al generar el Excel en el servidor. */
export const MENSAJE_ERROR_GENERAR_EXCEL =
  'Ocurrió un error al generar el archivo Excel. Intenta de nuevo; si el problema continúa, comunícalo al administrador.';

export const MENSAJE_EXPORTACION_EXITOSA = 'Excel de la estructura de costos generado exitosamente.';

/** Sesión vencida / sin permiso: mensajes accionables, no el genérico. */
export const MENSAJE_EXPORTACION_SESION_VENCIDA = 'Tu sesión expiró. Vuelve a iniciar sesión para exportar los costos.';
export const MENSAJE_EXPORTACION_SIN_PERMISO = 'No tienes permiso para exportar los costos.';

/**
 * Texto a mostrar cuando el servidor responde con un error al exportar.
 * Prioridad: 401/403 (mensaje propio) → `mensaje` del servidor (ya redactado
 * para el usuario: GUARDAR_REQUERIDO, CONFLICTO_CONCURRENCIA…) → genérico.
 * NUNCA se muestra `error` tal cual: es un código o texto técnico
 * ("DTO_INVALIDO", "estructuraCostoId no coincide…") que no le sirve al usuario.
 */
export function mensajeErrorExportacion(estadoHttp: number, cuerpo: { mensaje?: unknown } | null | undefined): string {
  if (estadoHttp === 401) return MENSAJE_EXPORTACION_SESION_VENCIDA;
  if (estadoHttp === 403) return MENSAJE_EXPORTACION_SIN_PERMISO;
  const mensaje = cuerpo?.mensaje;
  if (typeof mensaje === 'string' && mensaje.trim() !== '') return mensaje;
  return MENSAJE_ERROR_GENERAR_EXCEL;
}
