import { createHash } from 'crypto';
import { detectarTipoArchivo } from '../extractors/detectar-tipo-archivo';
import { extraerPdfTexto } from '../extractors/extraer-pdf-texto';
import { extraerWord } from '../extractors/extraer-word';
import { extraerExcel } from '../extractors/extraer-excel';
import type { DocumentoExtraido, MetodoExtraccion } from '../types';

export const MAX_DESCARGA_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Orquestador de extracción de texto.
 * Detecta el tipo de archivo por magic bytes y nombre, luego llama al extractor apropiado.
 *
 * Nunca lanza excepción — reporta problemas en DocumentoExtraido.advertencias.
 * El caller debe verificar textoCompleto.trim() === '' para detectar fallo total.
 */
export async function extraerDocumento(
  buf: Buffer,
  nombreDocumento: string,
): Promise<DocumentoExtraido> {
  const hashContenido = createHash('sha256').update(buf).digest('hex');
  const tipoDetectado = detectarTipoArchivo(buf, nombreDocumento);

  if (!tipoDetectado.soportado) {
    const advertencia = tipoDetectado.advertencia ?? `Formato "${tipoDetectado.formato}" no soportado.`;
    return {
      nombreDocumento,
      formato: tipoDetectado.formato,
      metodoExtraccion: 'fallback',
      textoCompleto: '',
      paginas: [],
      hojas: [],
      advertencias: [advertencia],
      requiereOcr: false,
      hashContenido,
      totalPaginas: 0,
      totalChars: 0,
    };
  }

  if (tipoDetectado.formato === 'pdf') {
    const res = await extraerPdfTexto(buf);
    const textoCompleto = res.paginas.map(p => p.texto).join('\n');
    return {
      nombreDocumento,
      formato: 'pdf',
      metodoExtraccion: res.metodo,
      textoCompleto,
      paginas: res.paginas,
      hojas: [],
      advertencias: res.advertencias,
      requiereOcr: res.requiereOcr,
      hashContenido,
      totalPaginas: res.totalPaginas,
      totalChars: textoCompleto.length,
    };
  }

  if (tipoDetectado.formato === 'word_docx') {
    const res = await extraerWord(buf, nombreDocumento);
    const metodo: MetodoExtraccion = res.metodo === 'word' ? 'word' : 'fallback';
    return {
      nombreDocumento,
      formato: 'word_docx',
      metodoExtraccion: metodo,
      textoCompleto: res.texto,
      paginas: res.texto.trim() ? [{ pagina: 1, texto: res.texto }] : [],
      hojas: [],
      advertencias: res.advertencias,
      requiereOcr: false,
      hashContenido,
      totalPaginas: res.texto.trim() ? 1 : 0,
      totalChars: res.texto.length,
    };
  }

  if (tipoDetectado.formato === 'excel_xlsx') {
    const res = await extraerExcel(buf, nombreDocumento);
    return {
      nombreDocumento,
      formato: 'excel_xlsx',
      metodoExtraccion: 'excel',
      textoCompleto: res.texto,
      paginas: res.texto.trim() ? [{ pagina: 1, texto: res.texto }] : [],
      hojas: res.hojas.map(h => ({ nombreHoja: h, texto: '' })),
      advertencias: res.advertencias,
      requiereOcr: false,
      hashContenido,
      totalPaginas: 0,
      totalChars: res.texto.length,
    };
  }

  return {
    nombreDocumento,
    formato: tipoDetectado.formato,
    metodoExtraccion: 'fallback',
    textoCompleto: '',
    paginas: [],
    hojas: [],
    advertencias: [tipoDetectado.advertencia ?? 'Formato no soportado.'],
    requiereOcr: false,
    hashContenido,
    totalPaginas: 0,
    totalChars: 0,
  };
}