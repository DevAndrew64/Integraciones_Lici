import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';
import { auditFromRequest } from '@/lib/audit';
import prisma from '@/lib/prisma';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;

  const { id } = await context.params;
  const targetId = Number.parseInt(id, 10);

  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ ok: false, error: 'ID de usuario inválido.' }, { status: 400 });
  }

  try {
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, email: true },
    });

    if (!target) {
      return NextResponse.json({ ok: false, error: 'Usuario no encontrado.' }, { status: 404 });
    }

    await prisma.user.update({
      where: { id: targetId },
      data: { sessionVersion: { increment: 1 } },
    });

    void auditFromRequest(req, session!, {
      accion: 'user_sessions_revoked',
      recurso: 'user',
      recursoId: String(targetId),
      detalle: { targetUserId: targetId },
    });

    return NextResponse.json({ ok: true, message: 'Sesiones revocadas correctamente.' });
  } catch (err) {
    console.error('[POST /api/users/[id]/revocar-sesiones]', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'Error interno del servidor.' }, { status: 500 });
  }
}