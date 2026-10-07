import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, requireAdmin } from '@/lib/authz';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  const perfil = new URL(req.url).searchParams.get('perfil') || 'ASEOCOLBA';
  try {
    const entries = await prisma.lecturaAnalisis.findMany({
      where: { modo: 'colba-empresa', codigoProceso: perfil },
      select: { id: true, nombreDocumento: true, resultado: true, creadoEn: true },
      orderBy: { creadoEn: 'asc' },
    });
    return NextResponse.json({
      ok: true,
      entradas: entries.map(e => ({
        id: e.id,
        titulo: e.nombreDocumento,
        texto: (e.resultado as { texto?: string })?.texto ?? '',
        fecha: e.creadoEn,
      })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;

  let body: { titulo?: string; texto?: string; perfil?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 }); }

  const titulo = body.titulo?.trim() || 'Sin título';
  const texto = body.texto?.trim() || '';
  const perfil = body.perfil?.trim().toUpperCase() || 'ASEOCOLBA';
  if (!texto) return NextResponse.json({ ok: false, error: 'El texto no puede estar vacío.' }, { status: 400 });

  try {
    const entry = await prisma.lecturaAnalisis.create({
      data: {
        nombreDocumento: titulo.slice(0, 255),
        pdfHash: `colba-empresa-${perfil}-${Date.now()}`,
        modo: 'colba-empresa',
        codigoProceso: perfil,
        resultado: { texto },
      },
    });
    return NextResponse.json({ ok: true, id: entry.id });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;

  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!id) return NextResponse.json({ ok: false, error: 'Se requiere id.' }, { status: 400 });
  try {
    await prisma.lecturaAnalisis.delete({ where: { id, modo: 'colba-empresa' } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}