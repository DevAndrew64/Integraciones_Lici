import { detectarPdfEscaneado } from './detectar-pdf-escaneado';
import type { MetodoExtraccion, PaginaExtraida } from '../types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (
  buf: Buffer,
  opts?: Record<string, unknown>
) => Promise<{ text: string; numpages: number }>;

export type ResultadoExtracionPdf = {
  paginas: PaginaExtraida[];
  totalPaginas: number;
  metodo: MetodoExtraccion;
  requiereOcr: boolean;
  advertencias: string[];
};

type PdfTextItem = { str: string; transform?: number[]; width?: number; hasEOL?: boolean };

/**
 * Une los fragmentos de texto de una página respetando la posición real de cada
 * uno, en vez de insertar un espacio fijo entre todos los fragmentos (lo que
 * rompía palabras/números en PDFs con letras espaciadas o justificadas, ej.
 * "pregrado" -> "preg r ado", "2026" -> "202 6").
 * Solo inserta espacio cuando hay una separación horizontal real entre
 * fragmentos consecutivos de la misma línea; si el PDF no expone posiciones,
 * cae de vuelta al join simple con espacios.
 */
function unirFragmentosTexto(items: PdfTextItem[]): string {
  let out = '';
  let prevEndX: number | null = null;
  let prevY: number | null = null;
  for (const it of items) {
    const s = it.str || '';
    if (!s) { if (it.hasEOL) out += '\n'; continue; }
    const transform = it.transform;
    if (!transform || transform.length < 6) {
      // Sin datos de posición: comportamiento anterior (espacio simple)
      out += (out && !out.endsWith(' ') && !out.endsWith('\n') ? ' ' : '') + s;
      continue;
    }
    const x = transform[4];
    const y = transform[5];
    const fontSize = Math.abs(transform[0]) || Math.abs(transform[3]) || 10;
    if (prevEndX !== null && prevY !== null) {
      const mismaLinea = Math.abs(y - prevY) < fontSize * 0.4;
      if (!mismaLinea) {
        out += '\n';
      } else {
        const gap = x - prevEndX;
        if (gap > fontSize * 0.22) out += ' ';
      }
    }
    out += s;
    prevEndX = x + (it.width ?? s.length * fontSize * 0.5);
    prevY = y;
    if (it.hasEOL) { out += '\n'; prevEndX = null; prevY = null; }
  }
  return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Normaliza la variable DOCUMENT_AI_ENABLED — tolera espacios y variantes de case */
function documentAiEnabled(): boolean {
  return String(process.env.DOCUMENT_AI_ENABLED || '')
    .trim()
    .toLowerCase() === 'true';
}

/**
 * Intenta OCR con Document AI si está habilitado.
 * Devuelve el resultado OCR o null (si está deshabilitado o falla).
 * Nunca lanza — registra errores en `advertencias`.
 */
async function intentarOcr(
  buf: Buffer,
  nombreDocumento: string,
  advertencias: string[],
): Promise<ResultadoExtracionPdf | null> {
  const enabled = documentAiEnabled();

  // Log seguro — sin secretos ni contenido del documento
  console.log('[ocr] estado', {
    enabled,
    hasProjectId:    Boolean(process.env.GOOGLE_CLOUD_PROJECT_ID),
    hasLocation:     Boolean(process.env.GOOGLE_CLOUD_LOCATION),
    hasProcessorId:  Boolean(process.env.DOCUMENT_AI_OCR_PROCESSOR_ID),
    hasCredentials:  Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
    maxPages:        process.env.DOCUMENT_AI_MAX_INLINE_PAGES ?? '15',
    maxMb:           process.env.DOCUMENT_AI_MAX_INLINE_MB   ?? '14',
  });

  if (!enabled) {
    advertencias.push(
      'PDF posiblemente escaneado. DOCUMENT_AI_ENABLED=false — OCR no activo. ' +
      'Activar la variable para procesar documentos escaneados con Document AI.',
    );
    return null;
  }

  try {
    // Importación dinámica evita dependencia circular en tiempo de carga
    const { extraerPdfOcr } = await import('./extraer-pdf-ocr');
    const ocr = await extraerPdfOcr(buf, nombreDocumento);

    // Si OCR completó pero no extrajo texto (todos los lotes fallaron)
    const paginasConTexto = ocr.paginas.filter(p => p.texto.trim().length > 0).length;
    if (paginasConTexto === 0) {
      console.error('[ocr] completado pero sin texto extraído:', ocr.advertencias.join(' | ').slice(0, 500));
      advertencias.push(...ocr.advertencias);
      return null; // preserva requiereOcr=true para que el error sea visible
    }

    return { ...ocr, advertencias: [...advertencias, ...ocr.advertencias] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    let mensajeClaro: string;
    if (/credential|CREDENTIALS|JSON no es JSON|no configurada/i.test(msg)) {
      mensajeClaro = `OCR falló — autenticación: ${msg}`;
    } else if (/404|not found/i.test(msg)) {
      mensajeClaro = `OCR falló — procesador no encontrado (verifique DOCUMENT_AI_OCR_PROCESSOR_ID y GOOGLE_CLOUD_LOCATION): ${msg}`;
    } else if (/403|permission|PERMISSION|denied|API.*not.*enabled|has not been used/i.test(msg)) {
      mensajeClaro = `OCR falló — permisos insuficientes o API no habilitada en GCP: ${msg}`;
    } else if (/401|UNAUTHENTICATED|invalid_grant/i.test(msg)) {
      mensajeClaro = `OCR falló — credenciales inválidas o expiradas: ${msg}`;
    } else {
      mensajeClaro = `OCR falló: ${msg}`;
    }

    // Siempre loguear el error real al servidor — sin secretos
    console.error('[ocr] error:', mensajeClaro.slice(0, 600));

    advertencias.push(mensajeClaro);
    return null;
  }
}

/**
 * Extrae texto de un PDF por página usando pdf-parse.
 *
 * Modo 1 (pdf_text): usa el callback pagerender para obtener texto por página real.
 *   - Conserva número de página exacto.
 *   - Detecta PDFs escaneados por densidad de texto.
 *
 * Modo 2 (pdf_aproximado): fallback cuando pagerender falla o devuelve vacío.
 *   - Divide el texto completo proporcionalmente entre el número de páginas.
 *   - La trazabilidad de página es aproximada.
 *
 * Si requiereOcr=true y DOCUMENT_AI_ENABLED=true, aplica OCR como tercer nivel.
 * Nunca imprime contenido del PDF en logs.
 */
export async function extraerPdfTexto(
  buf: Buffer,
  nombreDocumento = 'documento',
): Promise<ResultadoExtracionPdf> {
  const advertencias: string[] = [];
  const pageTexts: string[] = [];

  // ── Modo 1: extracción página a página (texto embebido real) ─────────────────
  try {
    await pdfParse(buf, {
      pagerender: async (pageData: { getTextContent: () => Promise<{ items: PdfTextItem[] }> }) => {
        try {
          const tc = await pageData.getTextContent();
          const text = unirFragmentosTexto(tc.items);
          pageTexts.push(text);
          return text;
        } catch {
          pageTexts.push('');
          return '';
        }
      },
    });

    if (pageTexts.filter(t => t.trim().length > 20).length > 0) {
      const paginas: PaginaExtraida[] = pageTexts.map((texto, i) => ({ pagina: i + 1, texto }));
      const scan = detectarPdfEscaneado(paginas);
      advertencias.push(...scan.advertencias);

      if (scan.requiereOcr) {
        const ocrResult = await intentarOcr(buf, nombreDocumento, advertencias);
        if (ocrResult) return ocrResult;
      }

      return {
        paginas,
        totalPaginas: pageTexts.length,
        metodo: 'pdf_text',
        requiereOcr: scan.requiereOcr,
        advertencias,
      };
    }
    advertencias.push('Extracción página a página devolvió contenido vacío — modo aproximado.');
  } catch (e) {
    advertencias.push(
      `Error en extracción por página: ${e instanceof Error ? e.message : String(e)}. Modo aproximado.`
    );
  }

  // ── Modo 2: texto completo dividido proporcionalmente ─────────────────────────
  let result: { text: string; numpages: number };
  try {
    result = await pdfParse(buf);
  } catch (e2) {
    advertencias.push(`Archivo no procesable como PDF: ${e2 instanceof Error ? e2.message : String(e2)}`);
    const ocrResult = await intentarOcr(buf, nombreDocumento, advertencias);
    if (ocrResult) return ocrResult;
    return { paginas: [], totalPaginas: 0, metodo: 'pdf_aproximado', requiereOcr: true, advertencias };
  }

  const total = result.numpages || 1;
  const full  = result.text || '';

  if (!full.trim()) {
    advertencias.push('PDF sin texto extraíble. Posiblemente escaneado o protegido.');
    const ocrResult = await intentarOcr(buf, nombreDocumento, advertencias);
    if (ocrResult) return ocrResult;
    return { paginas: [], totalPaginas: total, metodo: 'pdf_aproximado', requiereOcr: true, advertencias };
  }

  const cPP = Math.ceil(full.length / total);
  const paginas: PaginaExtraida[] = Array.from({ length: total }, (_, i) => ({
    pagina: i + 1,
    texto:  full.slice(i * cPP, (i + 1) * cPP).trim(),
  }));

  const scan = detectarPdfEscaneado(paginas);
  advertencias.push(...scan.advertencias);

  if (scan.requiereOcr) {
    const ocrResult = await intentarOcr(buf, nombreDocumento, advertencias);
    if (ocrResult) return ocrResult;
  }

  return {
    paginas,
    totalPaginas: total,
    metodo:      'pdf_aproximado',
    requiereOcr: scan.requiereOcr,
    advertencias,
  };
}

/** Exporta la función de normalización para usarla en los route handlers */
export { documentAiEnabled };