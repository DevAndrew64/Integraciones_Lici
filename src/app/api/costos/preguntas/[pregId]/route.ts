/**
 * PATCH /api/costos/preguntas/[pregId]
 * Marca una pregunta como respondida con la respuesta del comercial.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ pregId: string }> },
) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  const { pregId } = await context.params;
  const id = parseInt(pregId, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

  const { respondida, respuesta } = await req.json() as {
    respondida: boolean;
    respuesta?: string;
  };

  const updated = await prisma.preguntaPendiente.update({
    where: { id },
    data: {
      respondida,
      respuesta:    respuesta ?? null,
      respondidaEn: respondida ? new Date() : null,
    },
  });

  return NextResponse.json({ ok: true, id: updated.id, respondida: updated.respondida });
}