import { NextRequest, NextResponse } from 'next/server';
import { esAdjudicada } from '@/lib/solicitudes/adjudicada';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession, isAdmin, canAccessSolicitud, esMercadeo } from '@/lib/authz';
import { auditFromRequest } from '@/lib/audit';
import { nitVerificado, validarNitConDv } from '@/lib/solicitudes/nit-entidad';

/**
 * POST /api/solicitudes/[id]/nit-entidad `{ nit }` — registra el NIT de la entidad contratante de un proceso YA adjudicado
 * que no lo tiene verificado (adjudicado antes de que el cierre lo pidiera, o con un NIT de antes, sin dígito de
 * verificación). Lo normal es registrarlo al marcar Adjudicado (`POST /api/solicitudes/[id]/cerrar`).
 *
 * El NIT llega con su DV, que se comprueba (módulo 11 de la DIAN), y se guarda como «base-DV». Un NIT ya verificado no se
 * cambia desde aquí. No se busca en ninguna fuente externa: el NIT lo digita quien conoce el proceso.
 *
 * Mismo acceso que la ficha (`GET /api/solicitudes/[id]`): administrador o quien participa en la solicitud. Mercadeo
 * solo consulta: no digita.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  try {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id < 1) return NextResponse.json({ ok: false, error: 'Solicitud inválida.' }, { status: 400 });
    const solicitud = await prisma.solicitud.findUnique({
      where: { id },
      select: { id: true, nitContacto: true, resultadoFinal: true, emailRegistro: true, usuarioRegistro: true, asignaciones: true, aprobador: true, revisor: true },
    });
    if (!solicitud) return NextResponse.json({ ok: false, error: 'No encontrada.' }, { status: 404 });
    if (!isAdmin(session!.rol) && !canAccessSolicitud(session!, solicitud)) return NextResponse.json({ ok: false, error: 'Sin acceso.' }, { status: 403 });
    if (esMercadeo(session!.rol)) return NextResponse.json({ ok: false, error: 'Mercadeo no puede digitar el NIT.' }, { status: 403 });
    if (!esAdjudicada(solicitud)) {
      return NextResponse.json({ ok: false, error: 'El NIT de la entidad se registra al marcar el proceso como Adjudicado.' }, { status: 409 });
    }

    const anterior = solicitud.nitContacto?.trim() || null;
    if (nitVerificado(anterior)) return NextResponse.json({ ok: false, error: 'La solicitud ya tiene el NIT verificado.', nit: anterior }, { status: 409 });

    const body = (await req.json().catch(() => null)) as { nit?: unknown } | null;
    const v = validarNitConDv(body?.nit);
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });

    // Compare-and-set sobre el valor leído: si otro usuario lo registró entre medio, no se pisa.
    const r = await prisma.solicitud.updateMany({ where: { id, nitContacto: solicitud.nitContacto }, data: { nitContacto: v.nit } });
    if (r.count === 0) return NextResponse.json({ ok: false, error: 'Otro usuario cambió el NIT. Recargue la ficha.' }, { status: 409 });
    void auditFromRequest(req, session, { accion: 'NIT_ENTIDAD_DIGITADO', recurso: 'solicitud', recursoId: String(id), detalle: { nit: v.nit, anterior } });
    return NextResponse.json({ ok: true, nit: v.nit });
  } catch (e) {
    console.error('[POST /api/solicitudes/[id]/nit-entidad]', e);
    return NextResponse.json({ ok: false, error: 'No se pudo guardar el NIT.' }, { status: 500 });
  }
}
