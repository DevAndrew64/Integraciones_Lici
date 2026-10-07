import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession, esAdministradorProcesos, matchesIdentity } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  try {
    const usuarioParam = req.nextUrl.searchParams.get('usuario') || '';
    if (!usuarioParam) return NextResponse.json({ count: 0 });

    const admin = esAdministradorProcesos(session!.rol);

    // IDOR guard: usuario normal solo puede consultar sus propias asignaciones.
    // Admin puede consultar cualquier usuario por query param.
    if (!admin && !matchesIdentity(session!.email, usuarioParam, session!.usuario)) {
      return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
    }

    const rows = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>(`
      SELECT COUNT(*) as cnt
      FROM "Solicitud"
      WHERE jsonb_array_length(asignaciones) > 0
        AND asignaciones -> -1 ->> 'analistaAsignado' = $1
        AND asignaciones -> -1 ->> 'estadoRevision' NOT IN (
          'CERRADO_ADJUDICADO','CERRADO_NO_ADJUDICADO','CERRADO_NO_CUMPLIMIENTO',
          'RECHAZADO','CANCELADO'
        )
        AND "estadoSolicitud" NOT IN ('Cerrada','Cancelada','Rechazada')
    `, usuarioParam);

    return NextResponse.json({ count: Number(rows[0]?.cnt ?? 0) });
  } catch (err) {
    return NextResponse.json({ count: 0, error: String(err) });
  }
}