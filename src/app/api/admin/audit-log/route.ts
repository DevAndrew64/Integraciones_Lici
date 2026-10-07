import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;

  const { searchParams } = req.nextUrl;

  const page   = Math.max(1, Number(searchParams.get('page')  ?? '1'));
  const limit  = Math.min(200, Math.max(1, Number(searchParams.get('limit') ?? '50')));
  const skip   = (page - 1) * limit;

  const accion   = searchParams.get('accion')   ?? undefined;
  const email    = searchParams.get('email')    ?? undefined;
  const recurso  = searchParams.get('recurso')  ?? undefined;
  const desde    = searchParams.get('desde')    ?? undefined;
  const hasta    = searchParams.get('hasta')    ?? undefined;

  const where: Record<string, unknown> = {};
  if (accion)  where.accion  = accion;
  if (recurso) where.recurso = recurso;
  if (email)   where.email   = { contains: email, mode: 'insensitive' };

  if (desde || hasta) {
    const rango: Record<string, Date> = {};
    if (desde) { const d = new Date(desde); if (!isNaN(d.getTime())) rango.gte = d; }
    if (hasta) { const d = new Date(hasta); if (!isNaN(d.getTime())) rango.lte = d; }
    if (Object.keys(rango).length) where.creadoEn = rango;
  }

  try {
    const [total, registros] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, accion: true, email: true, rol: true,
          recurso: true, recursoId: true, metodo: true,
          ip: true, userAgent: true, detalle: true, creadoEn: true,
          usuarioId: true,
        },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      registros,
    });
  } catch (err) {
    console.error('[GET /api/admin/audit-log]', err instanceof Error ? err.message.slice(0, 100) : 'error');
    return NextResponse.json({ ok: false, error: 'Error interno' }, { status: 500 });
  }
}