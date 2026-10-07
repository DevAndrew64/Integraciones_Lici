import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/notificaciones/[id] — marcar una notificación como leída
export async function PATCH(req: NextRequest, context: RouteContext) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  try {
    const { id } = await context.params;
    const notifId = Number.parseInt(id, 10);

    if (!Number.isInteger(notifId) || notifId <= 0) {
      return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });
    }

    const updated = await prisma.notificacion.update({
      where: { id: notifId },
      data: { leida: true, leidaEn: new Date() },
    });

    return NextResponse.json({ ok: true, notificacion: updated });
  } catch (error) {
    console.error('Error marcando notificación:', error);
    return NextResponse.json({ error: 'No se pudo actualizar.' }, { status: 500 });
  }
}