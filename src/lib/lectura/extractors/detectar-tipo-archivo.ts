import type { FormatoArchivo } from '../types';

export type TipoArchivoDetectado = {
  formato: FormatoArchivo;
  soportado: boolean;
  advertencia?: string;
};

/**
 * Detecta el tipo de archivo por magic bytes, luego por extensión del nombre.
 * Retorna `soportado: false` para formatos no procesables (DOC, XLS, imágenes).
 */
export function detectarTipoArchivo(buf: Buffer, nombreArchivo?: string): TipoArchivoDetectado {
  if (buf.length >= 4) {
    // PDF: %PDF (25 50 44 46)
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
      return { formato: 'pdf', soportado: true };
    }

    // ZIP-based: DOCX, XLSX, PPTX (50 4B 03 04)
    if (buf[0] === 0x50 && buf[1] === 0x4B) {
      const sniff = buf.slice(0, 2000).toString('utf8', 0, 2000);
      if (sniff.includes('word/')) return { formato: 'word_docx', soportado: true };
      if (sniff.includes('xl/') || sniff.includes('xl\\')) return { formato: 'excel_xlsx', soportado: true };
      // Fallback por extensión para ZIP desconocido
      const ext = (nombreArchivo ?? '').toLowerCase().split('.').pop() ?? '';
      if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xlsb') return { formato: 'excel_xlsx', soportado: true };
      if (ext === 'docx') return { formato: 'word_docx', soportado: true };
      // ZIP desconocido sin extensión clara — intentar como DOCX
      return { formato: 'word_docx', soportado: true };
    }

    // OLE2 / CFB — DOC o XLS binario antiguo (D0 CF 11 E0)
    if (buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0) {
      const ext = (nombreArchivo ?? '').toLowerCase().split('.').pop() ?? '';
      if (ext === 'xls') {
        return { formato: 'excel_xls', soportado: false, advertencia: 'Archivo .xls binario antiguo no soportado. Convertir a .xlsx para procesar.' };
      }
      return { formato: 'word_doc', soportado: false, advertencia: 'Documento .doc binario antiguo no soportado. Convertir a .docx para procesar.' };
    }

    // PNG: 89 50 4E 47
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      return { formato: 'imagen', soportado: false, advertencia: 'Imágenes PNG no son procesables directamente. Requiere OCR (disponible en fase L2).' };
    }

    // JPEG: FF D8 FF
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
      return { formato: 'imagen', soportado: false, advertencia: 'Imágenes JPEG no son procesables directamente. Requiere OCR (disponible en fase L2).' };
    }
  }

  // Fallback por extensión del nombre de archivo
  const ext = (nombreArchivo ?? '').toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return { formato: 'pdf', soportado: true };
  if (ext === 'docx') return { formato: 'word_docx', soportado: true };
  if (ext === 'doc') return { formato: 'word_doc', soportado: false, advertencia: 'Documento .doc binario antiguo no soportado. Convertir a .docx para procesar.' };
  if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xlsb') return { formato: 'excel_xlsx', soportado: true };
  if (ext === 'xls') return { formato: 'excel_xls', soportado: false, advertencia: 'Archivo .xls binario antiguo no soportado. Convertir a .xlsx para procesar.' };
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'tiff' || ext === 'bmp') {
    return { formato: 'imagen', soportado: false, advertencia: 'Imágenes no son procesables directamente. Requiere OCR (disponible en fase L2).' };
  }

  return { formato: 'otro', soportado: false, advertencia: 'Formato de archivo no reconocido. Solo se soportan PDF, DOCX y XLSX.' };
}