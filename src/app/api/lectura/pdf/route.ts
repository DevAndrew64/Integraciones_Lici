import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // 1. Autenticación — sessionVersion validado dentro de getSession()
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  const id = parseInt(req.nextUrl.searchParams.get('id') ?? '0', 10);
  if (!id) return NextResponse.json({ error: 'Falta parámetro id' }, { status: 400 });

  try {
    // 2. Cualquier usuario autenticado puede ver/descargar cualquier análisis del historial
    const item = await prisma.lecturaAnalisis.findUnique({
      where: { id },
      select: { urlDocumento: true, pdfBlob: true, usuarioId: true },
    });

    if (!item) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

    // 3. Servir PDF — comportamiento original sin cambios

    // Caso 1: blob guardado (upload local)
    if (item.pdfBlob) {
      const buf = Buffer.from(item.pdfBlob, 'base64');
      return new NextResponse(buf, {
        status: 200,
        headers: {
          'Content-Type':   'application/pdf',
          'Cache-Control':  'private, max-age=3600',
          'Content-Length': buf.length.toString(),
        },
      });
    }

    // Caso 2: URL externa → proxy (SSRF mitigado: URL proviene de BD, no del request)
    if (item.urlDocumento) {
      const resp = await fetch(item.urlDocumento, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LicycolbaBot/1.0)' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) return NextResponse.json({ error: `HTTP ${resp.status}` }, { status: 502 });
      const data = await resp.arrayBuffer();
      return new NextResponse(data, {
        status: 200,
        headers: {
          'Content-Type':  'application/pdf',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    return NextResponse.json({ error: 'PDF no disponible para este análisis' }, { status: 404 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
