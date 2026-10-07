/**
 * PATCH /api/costos/alertas/[alertaId]
 * Marca una alerta como revisada con comentario opcional.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ alertaId: string }> },
) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  const { alertaId } = await context.params;
  const id = parseInt(alertaId, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

  const { revisada, comentarioValidacion } = await req.json() as {
    revisada: boolean;
    comentarioValidacion?: string;
  };

  const updated = await prisma.alertaManoObra.update({
    where: { id },
    data: {
      revisada,
      revisadaEn:          revisada ? new Date() : null,
      revisadaPor:         revisada ? session!.id : null,
      comentarioValidacion: comentarioValidacion ?? null,
    },
  });

  return NextResponse.json({ ok: true, id: updated.id, revisada: updated.revisada, comentarioValidacion: updated.comentarioValidacion ?? null });
}