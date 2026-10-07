import { PDFDocument } from 'pdf-lib';
import { GoogleAuth } from 'google-auth-library';
import type { MetodoExtraccion, PaginaExtraida } from '../types';
import type { ResultadoExtracionPdf } from './extraer-pdf-texto';

// ── Configuración desde variables de entorno ──────────────────────────────────
const PROJECT_ID  = process.env.GOOGLE_CLOUD_PROJECT_ID          ?? '';
const LOCATION    = process.env.GOOGLE_CLOUD_LOCATION            ?? 'us';
const PROCESSOR   = process.env.DOCUMENT_AI_OCR_PROCESSOR_ID    ?? '';
const MAX_PAGES   = parseInt(process.env.DOCUMENT_AI_MAX_INLINE_PAGES ?? '15', 10);
const MAX_MB      = parseInt(process.env.DOCUMENT_AI_MAX_INLINE_MB   ?? '14', 10);

// ── Tipos del subconjunto de respuesta Document AI ────────────────────────────
type DAISegment = { startIndex?: string; endIndex?: string };
type DAILayout  = { textAnchor?: { textSegments?: DAISegment[] } };
type DAIPage    = { pageNumber?: number; layout?: DAILayout };
type DAIDoc     = { text?: string; pages?: DAIPage[] };
type DAIResp    = { document?: DAIDoc; error?: { message?: string; code?: number } };

// ── Token de autenticación ────────────────────────────────────────────────────

/**
 * Normaliza las credenciales de la cuenta de servicio antes de parsear.
 *
 * Soporta cuatro formatos:
 *   1. JSON crudo             {"type":"service_account",...}
 *   2. JSON con outer quotes  "{"type":...}"   (algunos gestores de entorno)
 *   3. JSON backslash-escaped {\"type\":...}   (doble escape en algunos gestores)
 *   4. Base64 del archivo .json — generado con:
 *      [Convert]::ToBase64String([IO.File]::ReadAllBytes("archivo.json"))
 */
function parseCredentialsJson(raw: string): Record<string, unknown> {
  let s = raw.trim();

  // Quitar outer double-quotes que algunos gestores de entorno agregan
  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      const inner = JSON.parse(s) as string;
      if (typeof inner === 'string') s = inner.trim();
    } catch { /* seguir */ }
  }

  // Quitar outer single-quotes
  if (s.startsWith("'") && s.endsWith("'")) {
    s = s.slice(1, -1).trim();
  }

  // Intento 1: JSON crudo
  try { return JSON.parse(s) as Record<string, unknown>; } catch { /* seguir */ }

  // Intento 2: Desescapar el doble-escape de algunos gestores: \" → "  y  \\n → \n
  try {
    return JSON.parse(s.replace(/\\"/g, '"').replace(/\\n/g, '\n')) as Record<string, unknown>;
  } catch { /* seguir */ }

  // Intento 3: Base64 del archivo .json completo (caracteres solo base64)
  if (/^[A-Za-z0-9+/]+=*$/.test(s)) {
    try {
      const decoded = Buffer.from(s, 'base64').toString('utf-8').trim();
      if (decoded.startsWith('{')) {
        return JSON.parse(decoded) as Record<string, unknown>;
      }
    } catch { /* seguir */ }
  }

  const primerChar = s.charAt(0);
  throw new Error(
    'GOOGLE_APPLICATION_CREDENTIALS_JSON no es válido. ' +
    `Inicia con "${primerChar}" — se esperaba "{" (JSON) o un string base64. ` +
    'Pega el JSON directo o el base64 del archivo .json de la cuenta de servicio.',
  );
}

async function getToken(): Promise<string> {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw?.trim()) {
    throw new Error('Variable GOOGLE_APPLICATION_CREDENTIALS_JSON no configurada.');
  }

  const credentials = parseCredentialsJson(raw);

  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const resp = await client.getAccessToken();
  if (!resp.token) {
    throw new Error(
      'Google Auth no devolvió token de acceso. ' +
      'Verifique que la cuenta de servicio exista, esté habilitada y tenga el rol roles/documentai.apiUser.',
    );
  }
  return resp.token;
}

// ── Parseo de páginas desde respuesta DAI ─────────────────────────────────────
function parsearPaginas(resp: DAIResp, offsetPagina: number): PaginaExtraida[] {
  const doc = resp.document;
  if (!doc) return [];
  const textoCompleto = doc.text ?? '';
  return (doc.pages ?? []).map((p, i) => {
    const segs = p.layout?.textAnchor?.textSegments ?? [];
    const texto = segs
      .map(s => textoCompleto.slice(
        parseInt(s.startIndex ?? '0', 10),
        parseInt(s.endIndex   ?? '0', 10),
      ))
      .join('');
    return { pagina: offsetPagina + (p.pageNumber ?? i + 1), texto };
  });
}

// ── Llamada REST a Document AI ────────────────────────────────────────────────
async function callDocumentAi(batchBuf: Buffer, token: string): Promise<DAIResp> {
  if (!PROJECT_ID || !PROCESSOR) {
    throw new Error(
      'Faltan variables: GOOGLE_CLOUD_PROJECT_ID y DOCUMENT_AI_OCR_PROCESSOR_ID deben estar configuradas.'
    );
  }
  const url =
    `https://${LOCATION}-documentai.googleapis.com/v1` +
    `/projects/${PROJECT_ID}/locations/${LOCATION}` +
    `/processors/${PROCESSOR}:process`;

  const resp = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    // El contenido base64 no debe aparecer en logs — se envía directo al cuerpo
    body: JSON.stringify({
      rawDocument: {
        content:  batchBuf.toString('base64'),
        mimeType: 'application/pdf',
      },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    // No imprimimos el cuerpo completo — solo los primeros 300 chars del error
    throw new Error(`Document AI HTTP ${resp.status}: ${body.slice(0, 300)}`);
  }

  const data = (await resp.json()) as DAIResp;
  if (data.error) {
    throw new Error(`Document AI error ${data.error.code ?? ''}: ${data.error.message ?? 'desconocido'}`);
  }
  return data;
}

// ── Extractor principal OCR ───────────────────────────────────────────────────
/**
 * Extrae texto de un PDF escaneado usando Google Document AI OCR.
 *
 * Estrategia de batching:
 *   - Divide el PDF en lotes de MAX_INLINE_PAGES páginas con pdf-lib.
 *   - Lotes que superen MAX_INLINE_MB se omiten con advertencia (L3: usar GCS).
 *   - El resultado se reensambla en orden de página original.
 *
 * Nunca imprime: credenciales, token, base64 del PDF ni respuesta completa.
 */
export async function extraerPdfOcr(buf: Buffer, nombreDocumento: string): Promise<ResultadoExtracionPdf> {
  const advertencias: string[] = [];
  const maxBytes = MAX_MB * 1024 * 1024;

  // Cargar para contar páginas y poder dividir
  let srcDoc: PDFDocument;
  try {
    srcDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`No se puede cargar el PDF para OCR: ${msg}`);
  }
  const totalPaginas = srcDoc.getPageCount();
  if (totalPaginas === 0) {
    throw new Error('El PDF no tiene páginas.');
  }

  const token = await getToken();

  const todasLasPaginas: PaginaExtraida[] = [];
  const totalBatches = Math.ceil(totalPaginas / MAX_PAGES);

  for (let batch = 0; batch < totalBatches; batch++) {
    const fromPage = batch * MAX_PAGES;                              // 0-indexed, inclusive
    const toPage   = Math.min(fromPage + MAX_PAGES, totalPaginas);  // exclusive
    const label    = `Lote ${batch + 1}/${totalBatches} (págs. ${fromPage + 1}–${toPage})`;

    // Construir buffer del lote
    let batchBuf: Buffer;
    if (totalPaginas <= MAX_PAGES) {
      // Doc completo cabe en un lote
      batchBuf = buf;
    } else {
      try {
        const newDoc = await PDFDocument.create();
        const indices = Array.from({ length: toPage - fromPage }, (_, i) => fromPage + i);
        const copiadas = await newDoc.copyPages(srcDoc, indices);
        copiadas.forEach(p => newDoc.addPage(p));
        batchBuf = Buffer.from(await newDoc.save());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        advertencias.push(`${label} — no se pudo dividir el PDF: ${msg}. Omitido.`);
        continue;
      }
    }

    // Verificar tamaño
    if (batchBuf.length > maxBytes) {
      advertencias.push(
        `${label} pesa ${Math.round(batchBuf.length / 1024 / 1024)} MB > ${MAX_MB} MB. ` +
        'Omitido. Para PDFs grandes, usar GCS (L3).',
      );
      continue;
    }

    // Llamar Document AI
    try {
      const daiResp = await callDocumentAi(batchBuf, token);
      const paginas = parsearPaginas(daiResp, fromPage);
      todasLasPaginas.push(...paginas);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      advertencias.push(`${label} OCR falló: ${msg}`);
    }
  }

  todasLasPaginas.sort((a, b) => a.pagina - b.pagina);

  const paginasConTexto = todasLasPaginas.filter(p => p.texto.trim().length > 0).length;
  if (paginasConTexto === 0 && advertencias.length === 0) {
    advertencias.push(
      `Document AI OCR no extrajo texto de "${nombreDocumento}". ` +
      'Verifique que el procesador esté configurado para este idioma/tipo de documento.',
    );
  }

  advertencias.push(
    `OCR Document AI completado — ${paginasConTexto}/${totalPaginas} páginas con texto.`,
  );

  return {
    paginas:      todasLasPaginas,
    totalPaginas,
    metodo:       'document_ai_ocr' as MetodoExtraccion,
    requiereOcr:  false,   // OCR ya aplicado
    advertencias,
  };
}