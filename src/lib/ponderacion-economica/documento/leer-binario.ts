/**
 * Abstracción de almacenamiento del binario de
 * `DocumentoAnalisisEconomicoProceso` — FASE A.1.
 *
 *   storageBackend = "uploadthing"  → fetch(storageUrl)      (default; blob FUERA de la BD)
 *   storageBackend = "db"           → Buffer.from(archivoBase64)  (solo PDFs pequeños)
 *
 * Cambiar de backend NO requiere cambiar el modelo ni el resto del código:
 * solo esta función.
 */

export interface DocumentoBinarioRef {
  storageBackend: string;
  storageUrl: string | null;
  archivoBase64: string | null;
  nombreArchivo: string;
}

export async function leerBinarioDocumento(doc: DocumentoBinarioRef): Promise<Buffer> {
  if (doc.storageBackend === 'db') {
    if (!doc.archivoBase64) throw new Error(`Documento "${doc.nombreArchivo}": storageBackend=db pero archivoBase64 vacío.`);
    return Buffer.from(doc.archivoBase64, 'base64');
  }
  // uploadthing (u otro backend URL)
  if (!doc.storageUrl) throw new Error(`Documento "${doc.nombreArchivo}": storageBackend=${doc.storageBackend} pero storageUrl vacío.`);
  const res = await fetch(doc.storageUrl);
  if (!res.ok) throw new Error(`No se pudo descargar el documento (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/** Límites recomendados (documentados) para la carga en A.1. */
export const LIMITES_DOCUMENTO = {
  /** máximo aceptado por el endpoint (UploadThing admite hasta 128 MB). */
  MAX_BYTES: 25 * 1024 * 1024,
  /** por encima de esto NO se permite el fallback db (evita filas gigantes). */
  MAX_BYTES_INLINE_DB: 2 * 1024 * 1024,
  /** recomendación operativa: la mayoría de pliegos pesan 2–8 MB. */
  RECOMENDADO_BYTES: 10 * 1024 * 1024,
} as const;
