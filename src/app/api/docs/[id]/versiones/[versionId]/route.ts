import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, requireAdmin } from '@/lib/authz';
import prisma from '@/lib/prisma';


const LARAVEL_STORAGE = 'https://grupocolba.com/service/public/storage/';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; versionId: string }> }
) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  try {
    const { id, versionId } = await context.params;
    const docId = Number(id);
    const vId = Number(versionId);

    const version = await prisma.documentoVersion.findUnique({ where: { id: vId } });
    if (!version || version.documentoId !== docId) {
      return NextResponse.json({ ok: false, error: 'Versión no encontrada' }, { status: 404 });
    }

    const filename = (version.nombreArchivo || 'documento.pdf').replace(/"/g, '');
    const download = req.nextUrl.searchParams.get('download') === '1';
    const disposition = download ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`;

    // Caso 1: base64 guardado en DB → servir directamente (sin red)
    if (version.archivoBase64) {
      const buffer = Buffer.from(version.archivoBase64, 'base64');
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': version.archivoTipo || 'application/pdf',
          'Content-Disposition': disposition,
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // Caso 2: rutaLaravel → proxear desde servidor externo
    if (version.rutaLaravel) {
      const url = `${LARAVEL_STORAGE}${version.rutaLaravel}`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LicycolbaBot/1.0)' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) {
        return NextResponse.json({ error: `El servidor devolvió HTTP ${resp.status}` }, { status: 502 });
      }
      const data = await resp.arrayBuffer();
      return new NextResponse(data, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': disposition,
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    return NextResponse.json({ error: 'Archivo no disponible' }, { status: 404 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al descargar';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; versionId: string }> }
) {
  const sessionP = await getSession(req);
  const deniedP = requireAdmin(sessionP);
  if (deniedP) return deniedP;
  try {
    const { id, versionId } = await context.params;
    const docId = Number(id);
    const vId = Number(versionId);

    const version = await prisma.documentoVersion.findUnique({ where: { id: vId } });
    if (!version || version.documentoId !== docId) {
      return NextResponse.json({ ok: false, error: 'Versión no encontrada' }, { status: 404 });
    }

    const body = await req.json();
    const updated = await prisma.documentoVersion.update({
      where: { id: vId },
      data: {
        nombreArchivo:    body.nombreArchivo   ?? version.nombreArchivo,
        fechaEmision:     body.fechaEmision    ? new Date(body.fechaEmision)    : null,
        fechaVencimiento: body.fechaVencimiento ? new Date(body.fechaVencimiento) : null,
      },
    });

    return NextResponse.json({ ok: true, version: updated });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string; versionId: string }> }
) {
  const sessionD = await getSession(req);
  const deniedD = requireAdmin(sessionD);
  if (deniedD) return deniedD;
  try {
    const { id, versionId } = await context.params;
    const docId = Number(id);
    const vId = Number(versionId);

    const version = await prisma.documentoVersion.findUnique({ where: { id: vId } });
    if (!version || version.documentoId !== docId) {
      return NextResponse.json({ ok: false, error: 'Versión no encontrada' }, { status: 404 });
    }

    await prisma.documentoVersion.delete({ where: { id: vId } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}