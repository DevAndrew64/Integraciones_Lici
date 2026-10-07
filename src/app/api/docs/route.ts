import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, requireAdmin } from '@/lib/authz';
import prisma from '@/lib/prisma';

const LARAVEL = 'https://grupocolba.com/service/public/api/documentos';
const LARAVEL_STORAGE = 'https://grupocolba.com/service/public/storage/';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  try {
    const docs = await prisma.documento.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        nombre: true,
        codigo: true,
        empresa: true,
        proceso: true,
        subcarpetaId: true,
        fechaEmision: true,
        frecuenciaDias: true,
        diasTramite: true,
        notas: true,
        correoContacto: true,
        createdAt: true,
        versiones: {
          select: {
            id: true,
            version: true,
            nombreArchivo: true,
            rutaLaravel: true,
            archivoTipo: true,
            fechaEmision: true,
            fechaVencimiento: true,
            subidoPor: true,
            createdAt: true,
          },
          orderBy: { version: 'desc' },
        },
      },
    });
    return NextResponse.json(docs);
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const sessionP = await getSession(req);
  const deniedP = requireSession(sessionP);
  if (deniedP) return deniedP;
  try {
    const body = await req.json();
    const {
      nombre, codigo, empresa, proceso, subcarpetaId,
      fechaEmision, frecuenciaDias, diasTramite, notas,
      fechaVencimiento, subidoPor,
      nombreArchivo, archivoBase64, archivoTipo,
    } = body;

    if (!nombre || !archivoBase64) {
      return NextResponse.json(
        { ok: false, error: 'Nombre y archivo son requeridos' },
        { status: 400 }
      );
    }

    // ── Intentar subir a Laravel ──────────────────────────────────────────
    let rutaLaravel: string | null = null;
    let nombreArchivoFinal = nombreArchivo || 'documento.pdf';

    try {
      const buffer = Buffer.from(archivoBase64, 'base64');
      const blob = new Blob([buffer], { type: archivoTipo || 'application/pdf' });
      const fd = new FormData();
      fd.append('archivo', blob, nombreArchivoFinal);
      if (frecuenciaDias) fd.append('frecuencia', String(frecuenciaDias));
      if (fechaVencimiento) {
        fd.append('fecha_vencimiento', new Date(fechaVencimiento).toISOString().split('T')[0]);
      }
      const lr = await fetch(LARAVEL, { method: 'POST', body: fd });
      if (lr.ok) {
        const ld = await lr.json();
        rutaLaravel = ld.ruta_archivo || ld.ruta || null;
        nombreArchivoFinal = ld.nombre_archivo || nombreArchivoFinal;
      } else {
        const errText = await lr.text();
        console.error('[Laravel docs POST]', lr.status, errText);
      }
    } catch (err) {
      console.error('[Laravel upload error]', err);
    }
    // ─────────────────────────────────────────────────────────────────────

    const doc = await prisma.documento.create({
      data: {
        nombre,
        codigo:        codigo || null,
        empresa:       empresa || null,
        proceso:       proceso || null,
        subcarpetaId:  subcarpetaId || null,
        fechaEmision:  fechaEmision  ? new Date(fechaEmision)  : null,
        frecuenciaDias: frecuenciaDias ? Number(frecuenciaDias) : null,
        diasTramite:   diasTramite   ? Number(diasTramite)   : null,
        notas:         notas || null,
        versiones: {
          create: {
            version:         1,
            nombreArchivo:   nombreArchivoFinal,
            rutaLaravel,
            // Si Laravel falló, guardamos base64 en DB como respaldo
            archivoBase64:   rutaLaravel ? null : archivoBase64,
            archivoTipo:     rutaLaravel ? null : (archivoTipo || 'application/pdf'),
            fechaVencimiento: fechaVencimiento ? new Date(fechaVencimiento) : null,
            subidoPor:       subidoPor || null,
          },
        },
      },
      include: { versiones: true },
    });

    return NextResponse.json({ ok: true, doc });
  } catch (e) {
    console.error('[POST /api/docs]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const sessionPatch = await getSession(req);
  const deniedPatch = requireAdmin(sessionPatch);
  if (deniedPatch) return deniedPatch;
  try {
    const url = new URL(req.url);
    const id = Number(url.pathname.split('/').pop());
    if (!id) return NextResponse.json({ ok: false, error: 'ID requerido' }, { status: 400 });

    const body = await req.json();
    const { nombre, codigo, empresa, proceso, subcarpetaId, fechaEmision, frecuenciaDias, diasTramite, notas, fechaVencimiento } = body;

    if (!nombre) {
      return NextResponse.json({ ok: false, error: 'Nombre es requerido' }, { status: 400 });
    }

    const doc = await prisma.documento.update({
      where: { id },
      data: {
        nombre,
        codigo:        codigo || null,
        empresa:       empresa || null,
        proceso:       proceso || null,
        subcarpetaId:  subcarpetaId || null,
        fechaEmision:  fechaEmision  ? new Date(fechaEmision)  : null,
        frecuenciaDias: frecuenciaDias ? Number(frecuenciaDias) : null,
        diasTramite:   diasTramite   ? Number(diasTramite)   : null,
        notas:         notas || null,
      },
      include: { versiones: { orderBy: { version: 'desc' } } },
    });

    if (fechaVencimiento !== undefined) {
      const latestVersion = await prisma.documentoVersion.findFirst({
        where: { documentoId: id },
        orderBy: { version: 'desc' },
      });
      if (latestVersion) {
        await prisma.documentoVersion.update({
          where: { id: latestVersion.id },
          data: { fechaVencimiento: fechaVencimiento ? new Date(fechaVencimiento) : null },
        });
      }
    }

    return NextResponse.json({ ok: true, doc });
  } catch (e) {
    console.error('[PATCH /api/docs]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const sessionDel = await getSession(req);
  const deniedDel = requireAdmin(sessionDel);
  if (deniedDel) return deniedDel;
  try {
    const url = new URL(req.url);
    const id = Number(url.pathname.split('/').pop());
    if (!id) return NextResponse.json({ ok: false, error: 'ID requerido' }, { status: 400 });

    await prisma.documento.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[DELETE /api/docs]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}