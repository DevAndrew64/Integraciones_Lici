/**
 * POST /api/costos/mano-obra/[id]/estado
 * Transiciones de estado: aprobar, rechazar, volver_revision
 *
 * Reglas de bloqueo (verificadas en servidor, no solo en UI):
 * - No aprobar si hay alertas CRITICAS sin revisar
 * - No aprobar si hay alertas ALTAS sin comentario
 * - No aprobar si hay preguntas urgentes sin respuesta
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  const { id: idStr } = await context.params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

  const { accion, motivo } = await req.json() as {
    accion: 'aprobar' | 'rechazar' | 'volver_revision';
    motivo?: string;
  };

  if (!['aprobar', 'rechazar', 'volver_revision'].includes(accion)) {
    return NextResponse.json({ error: 'Acción no válida' }, { status: 400 });
  }

  // Validaciones de bloqueo solo para aprobar
  if (accion === 'aprobar') {
    const bloqueantes = await prisma.alertaManoObra.findMany({
      where: { solicitudId: id, revisada: false, severidad: { in: ['CRITICA', 'ALTA'] } },
    });
    const criticas = bloqueantes.filter(a => a.severidad === 'CRITICA');
    if (criticas.length > 0) {
      return NextResponse.json({
        error: `No se puede aprobar: ${criticas.length} alerta(s) CRÍTICA(S) sin revisar`,
        bloqueantes: criticas.map(a => ({ codigo: a.codigo, mensaje: a.mensaje })),
      }, { status: 422 });
    }
    // ALTA sin revisar O revisada sin comentario de justificación
    const altasSinJustificar = await prisma.alertaManoObra.findMany({
      where: {
        solicitudId: id, severidad: 'ALTA',
        OR: [{ revisada: false }, { comentarioValidacion: null }],
      },
    });
    if (altasSinJustificar.length > 0) {
      return NextResponse.json({
        error: `No se puede aprobar: ${altasSinJustificar.length} alerta(s) ALTA(S) sin revisar/justificar`,
        bloqueantes: altasSinJustificar.map(a => ({ codigo: a.codigo, mensaje: a.mensaje })),
      }, { status: 422 });
    }
    const pregUrgentes = await prisma.preguntaPendiente.findMany({
      where: { solicitudId: id, respondida: false, prioridad: 'urgente' },
    });
    if (pregUrgentes.length > 0) {
      return NextResponse.json({
        error: `No se puede aprobar: ${pregUrgentes.length} pregunta(s) urgente(s) sin respuesta`,
      }, { status: 422 });
    }
  }

  const estadoNuevo =
    accion === 'aprobar'         ? 'aprobada' :
    accion === 'rechazar'        ? 'rechazada' :
    /* volver_revision */          'en_revision';

  await prisma.solicitudManoObra.update({
    where: { id },
    data: {
      estado: estadoNuevo,
      ...(accion === 'aprobar' ? { aprobadoEn: new Date() } : {}),
    },
  });

  return NextResponse.json({ ok: true, estadoNuevo, motivo: motivo ?? null });
}