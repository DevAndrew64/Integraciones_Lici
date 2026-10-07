import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';
import { auditFromRequest } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mammoth = require('mammoth') as { extractRawText: (o: { buffer: Buffer }) => Promise<{ value: string }> };

// SSRF guard — URLs provienen de BD (LecturaAnalisis.urlDocumento), pero se validan
// como defensa en profundidad contra registros corruptos o manipulados.
const SSRF_BLOCKED = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|metadata\.google\.internal)/i;

function isUrlSafeToFetch(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return !SSRF_BLOCKED.test(parsed.hostname);
  } catch {
    return false;
  }
}

async function indexarDesdeUrl(url: string, nombre: string, codigoProceso: string): Promise<void> {
  if (!isUrlSafeToFetch(url)) return; // descarta URLs con hosts internos/inválidos

  const existing = await prisma.ragDocumento.findFirst({
    where: { codigoProceso, nombre: { contains: nombre.slice(0, 50) } },
  });
  if (existing) return;

  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LicycolbaBot/1.0)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) return;
  const buf = Buffer.from(await resp.arrayBuffer());

  let texto = '';
  try {
    const isDocx = buf[0] === 0x50 && buf[1] === 0x4B;
    const isPdf  = buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
    if (isPdf) {
      const parsed = await pdfParse(buf);
      texto = parsed.text;
    } else if (isDocx) {
      const result = await mammoth.extractRawText({ buffer: buf });
      texto = result.value;
    } else {
      return;
    }
  } catch { return; }

  const paragraphs = texto.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 30);
  const chunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if (current.length + para.length > 2_500 && current.length > 0) {
      chunks.push(current.trim());
      current = current.slice(-300) + '\n\n' + para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim().length > 30) chunks.push(current.trim());
  if (chunks.length === 0) return;

  await prisma.ragDocumento.create({
    data: {
      nombre,
      codigoProceso,
      totalPaginas: null,
      totalChunks: chunks.length,
      chunks: { create: chunks.map((texto, indice) => ({ indice, texto })) },
    },
  });
}

export async function POST(req: NextRequest) {
  // Solo administradores — ModuloResolverLinks es exclusivo de rol Administrador
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;

  let body: { solicitudId?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 }); }

  const { solicitudId } = body;
  if (!solicitudId || isNaN(solicitudId)) {
    return NextResponse.json({ ok: false, error: 'Se requiere solicitudId.' }, { status: 400 });
  }

  try {
    const sol = await prisma.solicitud.findUnique({
      where: { id: solicitudId },
      select: { id: true, codigoProceso: true, procData: true },
    });

    if (!sol) return NextResponse.json({ ok: false, error: 'Proceso no encontrado.' }, { status: 404 });

    const procData = (sol.procData as Record<string, unknown>) || {};
    const existingIds = Array.isArray(procData.ragDocIds) ? (procData.ragDocIds as number[]) : [];

    if (existingIds.length > 0) {
      const count = await prisma.ragDocumento.count({ where: { id: { in: existingIds } } });
      if (count > 0) {
        void auditFromRequest(req, session!, {
          accion:    'rag_indexacion_solicitudes',
          recurso:   'solicitudes/rag-indexar',
          recursoId: String(solicitudId),
          detalle:   { solicitudId, alreadyIndexed: true, docCount: count },
        });
        return NextResponse.json({ ok: true, docIds: existingIds, alreadyIndexed: true, docCount: count });
      }
    }

    if (!sol.codigoProceso) {
      return NextResponse.json({ ok: true, docIds: [], alreadyIndexed: false, sinDocumentos: true, docCount: 0 });
    }

    const ragDocs = await prisma.ragDocumento.findMany({
      where: { codigoProceso: sol.codigoProceso },
      select: { id: true },
    });

    if (ragDocs.length > 0) {
      const docIds = ragDocs.map(d => d.id);
      await prisma.solicitud.update({
        where: { id: solicitudId },
        data: { procData: { ...procData, ragDocIds: docIds } },
      });
      void auditFromRequest(req, session!, {
        accion:    'rag_indexacion_solicitudes',
        recurso:   'solicitudes/rag-indexar',
        recursoId: String(solicitudId),
        detalle:   { solicitudId, alreadyIndexed: false, docCount: docIds.length },
      });
      return NextResponse.json({ ok: true, docIds, alreadyIndexed: false, docCount: docIds.length });
    }

    const analisisConUrl = await prisma.lecturaAnalisis.findMany({
      where: {
        codigoProceso: sol.codigoProceso,
        urlDocumento: { not: null },
        modo: { not: 'colba-qa' },
      },
      select: { urlDocumento: true, nombreDocumento: true },
      distinct: ['urlDocumento'],
      take: 5,
    });

    if (analisisConUrl.length > 0) {
      const codigoProceso = sol.codigoProceso!;
      const solId = solicitudId;
      (async () => {
        for (const a of analisisConUrl) {
          try {
            await indexarDesdeUrl(a.urlDocumento!, a.nombreDocumento || 'Documento', codigoProceso);
          } catch { /* continuar */ }
        }
        try {
          const nuevosRag = await prisma.ragDocumento.findMany({
            where: { codigoProceso },
            select: { id: true },
          });
          if (nuevosRag.length > 0) {
            await prisma.solicitud.update({
              where: { id: solId },
              data: { procData: { ...procData, ragDocIds: nuevosRag.map(d => d.id) } },
            });
          }
        } catch { /* ignorar */ }
      })();

      void auditFromRequest(req, session!, {
        accion:    'rag_indexacion_solicitudes',
        recurso:   'solicitudes/rag-indexar',
        recursoId: String(solicitudId),
        detalle:   { solicitudId, alreadyIndexed: false, indexando: true, urlsEncontradas: analisisConUrl.length },
      });
      return NextResponse.json({ ok: true, docIds: [], alreadyIndexed: false, indexando: true, docCount: 0 });
    }

    return NextResponse.json({ ok: true, docIds: [], alreadyIndexed: false, sinDocumentos: true, docCount: 0 });

  } catch (err) {
    console.error('[POST /api/solicitudes/rag-indexar]', err instanceof Error ? err.message : 'error');
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 });
  }
}