import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession, isAdmin, canAccessSolicitud, esMercadeo } from '@/lib/authz';
import { auditFromRequest } from '@/lib/audit';
import { completarNitEntidad, normalizarNitEntidad } from '@/lib/solicitudes/nit-entidad';

/**
 * POST /api/solicitudes/[id]/nit-entidad — NIT de la entidad contratante.
 *
 * - Sin cuerpo (o `{}`): si la solicitud no tiene NIT, lo busca en los datos abiertos de SECOP (I o II, según la fuente) y
 *   lo guarda. Nunca pisa un NIT existente.
 * - `{ nit }`: lo digita el usuario cuando la fuente no lo trae (proceso privado o manual). Solo si la solicitud aún no
 *   tiene NIT; se guarda la base (sin puntos ni dígito de verificación).
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
      select: { id: true, nitContacto: true, emailRegistro: true, usuarioRegistro: true, asignaciones: true, aprobador: true, revisor: true },
    });
    if (!solicitud) return NextResponse.json({ ok: false, error: 'No encontrada.' }, { status: 404 });
    if (!isAdmin(session!.rol) && !canAccessSolicitud(session!, solicitud)) return NextResponse.json({ ok: false, error: 'Sin acceso.' }, { status: 403 });

    const body = (await req.json().catch(() => null)) as { nit?: unknown } | null;
    if (body?.nit !== undefined && body.nit !== null && body.nit !== '') {
      if (esMercadeo(session!.rol)) return NextResponse.json({ ok: false, error: 'Mercadeo no puede digitar el NIT.' }, { status: 403 });
      const nit = normalizarNitEntidad(body.nit);
      if (!nit) return NextResponse.json({ ok: false, error: 'El NIT debe tener entre 5 y 15 dígitos (puede llevar puntos y el dígito de verificación con guion).' }, { status: 400 });
      const r = await prisma.solicitud.updateMany({ where: { id, OR: [{ nitContacto: null }, { nitContacto: '' }] }, data: { nitContacto: nit } });
      if (r.count === 0) return NextResponse.json({ ok: false, error: 'La solicitud ya tiene NIT.', nit: solicitud.nitContacto }, { status: 409 });
      void auditFromRequest(req, session, { accion: 'NIT_ENTIDAD_DIGITADO', recurso: 'solicitud', recursoId: String(id), detalle: { nit } });
      return NextResponse.json({ ok: true, nit, origen: 'digitado' });
    }

    const r = await completarNitEntidad(prisma as unknown as Parameters<typeof completarNitEntidad>[0], id);
    if (r.origen === 'secop') {
      void auditFromRequest(req, session, { accion: 'NIT_ENTIDAD_SECOP', recurso: 'solicitud', recursoId: String(id), detalle: { nit: r.nit, fuente: r.detalle?.fuente, criterio: r.detalle?.criterio } });
    }
    return NextResponse.json({ ok: true, nit: r.nit, origen: r.origen, ...(r.detalle ? { fuente: r.detalle.fuente, criterio: r.detalle.criterio } : {}) });
  } catch (e) {
    console.error('[POST /api/solicitudes/[id]/nit-entidad]', e);
    return NextResponse.json({ ok: false, error: 'No se pudo obtener el NIT.' }, { status: 500 });
  }
}
