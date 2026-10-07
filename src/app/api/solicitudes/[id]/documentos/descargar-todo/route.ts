/**
 * GET /api/solicitudes/[id]/documentos/descargar-todo — genera un único
 * ZIP con TODOS los documentos disponibles de `Solicitud.docData` (la
 * MISMA fuente que ya alimenta la pestaña "Documentación" en `page.tsx`,
 * `VistFicha`).
 *
 * ARQUITECTURA — Ajuste "DOCUMENTACIÓN — DESCARGAR TODO (ZIP)" (decisión
 * explícita del usuario): el ZIP se arma en BACKEND con `archiver`, nunca
 * en el navegador. Ningún endpoint de descarga existente en este
 * proyecto hace streaming Node-stream→Web-stream real (`pdf-proxy`,
 * `docs/[id]/versiones/[versionId]` bufferan con `arrayBuffer()`/
 * `toBuffer()`) — este endpoint sigue el MISMO patrón: cada documento se
 * descarga completo a memoria, se agrega al `archiver`, y el ZIP final
 * se devuelve como un único `Buffer` (nunca streaming real byte-a-byte
 * de extremo a extremo, que sería la única pieza de esa infraestructura
 * en todo el proyecto).
 *
 * SEGURIDAD — Ajuste "NO CONFIAR EN URLs DEL FRONTEND":
 *  - `docData` se lee EXCLUSIVAMENTE de Prisma (`solicitud.docData`),
 *    nunca de query params/body — el cliente no puede inyectar una URL
 *    arbitraria para que este endpoint la descargue (SSRF).
 *  - Cada URL de `docData` pasa por `validarUrlAntiSSRF` (mismo guard que
 *    ya usa `pdf-proxy`/`docs/[id]/versiones/[versionId]` para fuentes
 *    con sesión) antes de cualquier `fetch`.
 *  - Nombres de archivo saneados contra path traversal (`../`, `\`,
 *    caracteres de control) — ver `sanearNombreEntradaZip`.
 *
 * PERMISOS — MISMA regla de lectura que `GET /api/solicitudes/[id]`
 * (route.ts hermano, sin `soloDocumentos`/`sinEvidencias`): únicamente
 * `requireSession` (cualquier usuario autenticado puede leer una
 * Solicitud completa hoy — `canAccessSolicitud` en ese archivo SOLO se
 * usa en el `PATCH`, nunca en el `GET`). Replicar aquí una restricción
 * más estricta (p.ej. `canAccessSolicitud`) sería AMPLIAR/RESTRINGIR el
 * modelo de permisos actual de forma inconsistente con el resto de la
 * ficha — decisión explícita: no hacerlo. Sin sesión ⇒ 401 (nunca 403,
 * mismo comportamiento que `requireSession` en cualquier otro endpoint).
 *
 * FALLOS PARCIALES — Ajuste "NO TIRAR TODA LA DESCARGA POR 1 DOCUMENTO"
 * (decisión explícita del usuario): un documento que falla (URL caída,
 * SSRF bloqueado, timeout, sin `url` ni `base64`) se omite y se loguea
 * (`console.error`), el ZIP se genera igual con los demás. Solo si
 * NINGÚN documento pudo obtenerse se devuelve un error (502).
 *
 * ARCHIVOS .zip YA EXISTENTES dentro de `docData`: se agregan como
 * archivo binario normal dentro del ZIP general (`archive.append` con el
 * buffer crudo) — NUNCA se descomprimen ni se inspeccionan.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ZipArchive } from 'archiver';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { validarUrlAntiSSRF } from '@/lib/ssrf-guard';
import {
  extraerDocumentosDeDocData, resolverEntradaZipParaDocumento, nombreArchivoZipProceso,
  type DocumentoParaZip,
} from '@/lib/solicitudes/documentos-zip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_POR_DOCUMENTO_MS = 30_000;

/** Obtiene el contenido binario de UN documento — `base64` embebido tiene
 * prioridad (no requiere red); si no, `fetch` a `url` con el mismo guard
 * SSRF y timeout ya usados en `pdf-proxy`. Lanza si no hay forma de
 * obtener el contenido (el llamador decide si eso tumba todo el ZIP o
 * solo se omite ese documento — ver docblock del archivo). */
async function obtenerContenidoDocumento(doc: DocumentoParaZip): Promise<Buffer> {
  if (doc.base64) {
    return Buffer.from(doc.base64, 'base64');
  }
  if (!doc.url) {
    throw new Error('El documento no tiene URL ni contenido embebido.');
  }
  const check = validarUrlAntiSSRF(doc.url);
  if (!check.ok) {
    throw new Error(`URL no permitida: ${check.error}`);
  }
  const resp = await fetch(doc.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LicycolbaBot/1.0)' },
    signal: AbortSignal.timeout(TIMEOUT_POR_DOCUMENTO_MS),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} al descargar el documento.`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  const noAuth = requireSession(session);
  if (noAuth) return noAuth;

  const { id } = await context.params;
  const dbId = Number(id);
  if (isNaN(dbId) || dbId <= 0) {
    return NextResponse.json({ ok: false, error: 'ID inválido.' }, { status: 400 });
  }

  const solicitud = await prisma.solicitud.findUnique({
    where: { id: dbId },
    select: { id: true, codigoProceso: true, docData: true },
  });
  if (!solicitud) {
    return NextResponse.json({ ok: false, error: 'No encontrada.' }, { status: 404 });
  }

  const documentos = extraerDocumentosDeDocData(solicitud.docData);
  if (documentos.length === 0) {
    return NextResponse.json({ ok: false, error: 'Este proceso no tiene documentos disponibles.' }, { status: 404 });
  }

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const archivoListo = new Promise<void>((resolve, reject) => {
    archive.on('end', () => resolve());
    archive.on('error', (err: Error) => reject(err));
  });

  const nombresUsados = new Set<string>();
  let exitosos = 0;
  for (const doc of documentos) {
    try {
      const contenido = await obtenerContenidoDocumento(doc);
      const nombreEntrada = resolverEntradaZipParaDocumento(doc, nombresUsados);
      archive.append(contenido, { name: nombreEntrada });
      exitosos++;
    } catch (error) {
      console.error(`[descargar-todo] documento "${doc.nombre}" de la solicitud ${dbId} falló:`, error instanceof Error ? error.message : error);
    }
  }

  if (exitosos === 0) {
    return NextResponse.json({ ok: false, error: 'Ninguno de los documentos pudo descargarse.' }, { status: 502 });
  }

  await archive.finalize();
  await archivoListo;
  const buffer = Buffer.concat(chunks);

  const nombreZip = nombreArchivoZipProceso(solicitud.codigoProceso, solicitud.id);
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${nombreZip.replace(/"/g, '')}"`,
      'Content-Length': String(buffer.length),
    },
  });
}
