import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdminOrN8N } from '@/lib/authz';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>;

function chunkText(text: string, maxChars = 2500, overlap = 300): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 30);

  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = current.slice(-overlap) + '\n\n' + para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim().length > 30) chunks.push(current.trim());
  return chunks;
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdminOrN8N(req, session);
  if (denied) return denied;

  let body: { pdfBase64?: string; nombre?: string; codigoProceso?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 });
  }

  const { pdfBase64, nombre = 'Documento', codigoProceso } = body;
  if (!pdfBase64?.trim()) {
    return NextResponse.json({ ok: false, error: 'Se requiere pdfBase64.' }, { status: 400 });
  }

  try {
    const buf = Buffer.from(pdfBase64, 'base64');
    const parsed = await pdfParse(buf);
    // Eliminar bytes nulos y caracteres de control que PostgreSQL rechaza en UTF-8
    const textoLimpio = parsed.text
      .replace(/\x00/g, '')
      .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ');
    const chunks = chunkText(textoLimpio);

    const doc = await prisma.ragDocumento.create({
      data: {
        nombre,
        codigoProceso: codigoProceso ?? null,
        totalPaginas: parsed.numpages,
        totalChunks: chunks.length,
        chunks: {
          create: chunks.map((texto, indice) => ({ indice, texto })),
        },
      },
    });

    return NextResponse.json({ ok: true, id: doc.id, totalChunks: chunks.length, totalPaginas: parsed.numpages });
  } catch (err) {
    console.error('[POST /api/lectura/rag/ingestar]', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 });
  }
}
