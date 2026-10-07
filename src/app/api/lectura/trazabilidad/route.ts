import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, resolveSessionUserId } from '@/lib/authz';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  const usuarioId = await resolveSessionUserId(session!);
  if (usuarioId === null) {
    return NextResponse.json({ ok: false, error: 'Sesión inválida.' }, { status: 401 });
  }

  let body: { analisisId?: number; fechaGestionInterna?: string | null; notasTrazabilidad?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 });
  }

  const { analisisId, fechaGestionInterna, notasTrazabilidad } = body;

  if (!analisisId) {
    return NextResponse.json({ ok: false, error: 'analisisId requerido.' }, { status: 400 });
  }

  const analisis = await prisma.lecturaAnalisis.findUnique({
    where: { id: analisisId },
    select: { id: true },
  });
  if (!analisis) {
    return NextResponse.json({ ok: false, error: 'Análisis no encontrado.' }, { status: 404 });
  }

  try {
    const updated = await prisma.lecturaAnalisis.update({
      where: { id: analisisId },
      data: {
        fechaGestionInterna: fechaGestionInterna ? new Date(fechaGestionInterna) : null,
        usuarioGestionaId: usuarioId,
        notasTrazabilidad: notasTrazabilidad || null,
      },
      select: {
        usuarioGestiona: { select: { usuario: true } },
      },
    });

    return NextResponse.json({
      ok: true,
      usuarioGestionaUsuario: updated.usuarioGestiona?.usuario ?? null,
    });
  } catch (err) {
    console.error('[PATCH /api/lectura/trazabilidad]', err);
    return NextResponse.json({ ok: false, error: 'Error al guardar trazabilidad.' }, { status: 500 });
  }
}