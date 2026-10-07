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

  let body: { analisisId?: number; checklistEstados?: Record<string, { estado: string; observacion: string }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 });
  }

  const { analisisId, checklistEstados } = body;

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
    await prisma.lecturaAnalisis.update({
      where: { id: analisisId },
      data: { checklistEstados: checklistEstados ?? {} },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /api/lectura/checklist]', err);
    return NextResponse.json({ ok: false, error: 'Error al guardar checklist.' }, { status: 500 });
  }
}