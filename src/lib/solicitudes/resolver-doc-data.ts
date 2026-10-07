/**
 * Decisiones puras para completar `Solicitud.docData` en la ficha
 * (`VistFichaAsignacion`) cuando la Solicitud llegó desde un listado liviano
 * (p.ej. "Por validar" → soloParaValidar) que no selecciona ese campo.
 *
 * Ver diagnóstico: la misma Solicitud manual (id=222, "El Grupo Honor &
 * Laurel") mostraba "Sin documentos disponibles" en "Por validar" pero
 * "Documentación: 2" al abrirla desde el buscador global — porque solo la
 * segunda ruta trae `docData` en el fetch inicial. La resolución es siempre
 * por `Solicitud.id`, nunca por `codigoProceso` ni `Proceso.id`.
 */

export type DocumentoSolicitud = Record<string, unknown>;

export interface RespuestaSoloDocumentos {
  ok: boolean;
  solicitud?: { id?: unknown; docData?: unknown } | null;
}

function safeArrayDocs(value: unknown): DocumentoSolicitud[] {
  return Array.isArray(value) ? (value as DocumentoSolicitud[]) : [];
}

/**
 * `undefined`/`null` → todavía no se cargó, hay que pedirlo.
 * `[]` (arreglo real, aunque vacío) → ya se cargó, no repetir el fetch.
 */
export function faltaCargarDocData(docData: unknown[] | null | undefined): boolean {
  return docData === undefined || docData === null;
}

/**
 * Interpreta la respuesta de `GET /api/solicitudes/{id}?soloDocumentos=true`.
 * Devuelve `null` cuando la respuesta debe descartarse (falló, o pertenece a
 * una Solicitud distinta de la que se pidió — respuesta obsoleta tras un
 * cambio de ficha) para que el llamador no la aplique sobre `solLocal`.
 */
export function resolverDocDataComplementario(
  solicitudIdSolicitado: number,
  respuesta: RespuestaSoloDocumentos
): DocumentoSolicitud[] | null {
  if (!respuesta.ok) return null;
  const idRecibido = Number(respuesta.solicitud?.id);
  if (idRecibido !== solicitudIdSolicitado) return null;
  return safeArrayDocs(respuesta.solicitud?.docData);
}
