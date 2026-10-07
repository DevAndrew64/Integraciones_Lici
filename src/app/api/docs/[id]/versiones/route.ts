import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';


const LARAVEL = 'https://grupocolba.com/service/public/api/documentos';

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const body = await req.json();
    const {
      rutaLaravel: rutaLaravelInput,
      nombreArchivo,
      archivoBase64,
      archivoTipo,
      fechaEmision,
      fechaVencimiento,
      subidoPor,
    } = body;

    const docId = Number(id);
    const doc = await prisma.documento.findUnique({
      where: { id: docId },
      include: { versiones: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!doc) return NextResponse.json({ ok: false, error: 'No encontrado' }, { status: 404 });

    const nuevaVersion = (doc.versiones[0]?.version ?? 0) + 1;

    // Si viene base64, intentar subir a Laravel
    let rutaLaravel: string | null = rutaLaravelInput || null;
    let nombreArchivoFinal = nombreArchivo || 'documento.pdf';

    if (archivoBase64 && !rutaLaravel) {
      try {
        const buffer = Buffer.from(archivoBase64, 'base64');
        const blob = new Blob([buffer], { type: archivoTipo || 'application/pdf' });
        const fd = new FormData();
        fd.append('archivo', blob, nombreArchivoFinal);
        if (fechaVencimiento) {
          fd.append('fecha_vencimiento', new Date(fechaVencimiento).toISOString().split('T')[0]);
        }
        const lr = await fetch(LARAVEL, { method: 'POST', body: fd });
        if (lr.ok) {
          const ld = await lr.json();
          rutaLaravel = ld.ruta_archivo || ld.ruta || null;
          nombreArchivoFinal = ld.nombre_archivo || nombreArchivoFinal;
        } else {
          console.error('[Laravel versiones POST]', lr.status, await lr.text());
        }
      } catch (err) {
        console.error('[Laravel versiones upload error]', err);
      }
    }

    const version = await prisma.documentoVersion.create({
      data: {
        documentoId: docId,
        version: nuevaVersion,
        nombreArchivo: nombreArchivoFinal,
        rutaLaravel,
        archivoBase64: rutaLaravel ? null : (archivoBase64 || null),
        archivoTipo: rutaLaravel ? null : (archivoTipo || null),
        fechaEmision: fechaEmision ? new Date(fechaEmision) : null,
        fechaVencimiento: fechaVencimiento ? new Date(fechaVencimiento) : null,
        subidoPor: subidoPor || '',
      },
    });

    return NextResponse.json({ ok: true, version });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}