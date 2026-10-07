/**
 * Ajuste "CIERRE DE SQR AL PRESENTAR" §6/§7 (confirmado explícitamente) —
 * fuente ÚNICA de la "Respuesta Previa" que Licycolba remite a GrupoColba
 * al dar cierre a la SQR asociada a un proceso (equivalente funcional al
 * campo "Respuesta Previa" de "Tratamiento SQR Nro. X" → "Dar Cierre a
 * SQR" en el módulo original de GrupoColba). Nunca la escribe el usuario
 * a mano — el sistema la construye siempre a partir de los datos del
 * proceso. Terminología de NEGOCIO deliberada — esto no es un prompt de
 * IA, es la respuesta comercial de cierre de una SQR.
 */
export function construirRespuestaCierreSqrPresentacion(params: {
  codigoProceso?: string | null;
  entidad?: string | null;
}): string {
  const codigo = (params.codigoProceso ?? '').trim();
  const entidad = (params.entidad ?? '').trim();

  let sujeto = 'Se remite respuesta a la SQR asociada';
  if (codigo) sujeto += ` al proceso ${codigo}`;
  if (entidad) sujeto += `${codigo ? ',' : ''} correspondiente a ${entidad}`;
  sujeto += '.';

  return `${sujeto} La gestión comercial requerida fue atendida y se adjunta el soporte correspondiente para su validación y cierre.`;
}

/**
 * Ajuste "PROTEGER CIERRES TERMINALES CONTRA SQR ABIERTA" — respuesta de
 * cierre para SQR asociadas a procesos que terminan por una vía distinta
 * a `PRESENTAR` (Rechazado, Cerrar sin presentar, Cancelado, Adjudicado/
 * No adjudicado directo) — nunca asume que existe un soporte adjunto
 * (`cerrarSqrEnGrupoColba` ya trata `soporte` como opcional para este
 * caso).
 */
export function construirRespuestaCierreSqrTerminal(params: {
  codigoProceso?: string | null;
  entidad?: string | null;
}): string {
  const codigo = (params.codigoProceso ?? '').trim();
  const entidad = (params.entidad ?? '').trim();

  let sujeto = 'Se remite respuesta a la SQR asociada';
  if (codigo) sujeto += ` al proceso ${codigo}`;
  if (entidad) sujeto += `${codigo ? ',' : ''} correspondiente a ${entidad}`;
  sujeto += '.';

  return `${sujeto} El proceso finalizó su gestión comercial sin continuar a la etapa de presentación/evaluación.`;
}
