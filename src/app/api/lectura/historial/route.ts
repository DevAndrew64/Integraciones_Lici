import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, resolveSessionUserId } from '@/lib/authz';
import prisma from '@/lib/prisma';


export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  const usuarioId = await resolveSessionUserId(session!);
  if (usuarioId === null) {
    return NextResponse.json({ ok: false, error: 'Sesión inválida. Inicie sesión nuevamente.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20'), 50);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const codigoProceso = searchParams.get('codigoProceso')?.trim() || null;

  // Modo rápido: solo URLs analizadas para un proceso (usado para marcar botones)
  if (codigoProceso && searchParams.get('soloUrls') === '1') {
    try {
      const rows = await prisma.lecturaAnalisis.findMany({
        where: {
          codigoProceso,
          modo: { not: 'colba-qa' },
        },
        select: { urlDocumento: true },
      });
      return NextResponse.json({ ok: true, urls: rows.map(r => r.urlDocumento).filter(Boolean) });
    } catch (err) {
      console.error('[GET /api/lectura/historial soloUrls]', err);
      return NextResponse.json({ ok: true, urls: [] });
    }
  }

  try {
    // Cualquier usuario autenticado ve el historial completo de análisis.
    const where = codigoProceso ? { codigoProceso } : {};
    const [items, total] = await Promise.all([
      prisma.lecturaAnalisis.findMany({
        where,
        orderBy: { creadoEn: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          nombreDocumento: true,
          urlDocumento: true,
          codigoProceso: true,
          entidad: true,
          tokensEntrada: true,
          tokensSalida: true,
          creadoEn: true,
          resultado: true,
          modo: true,
          usuarioId: true,
          fechaGestionInterna: true,
          notasTrazabilidad: true,
          checklistEstados: true,
          usuarioGestiona: { select: { usuario: true } },
          usuario: { select: { usuario: true } },
        },
      }),
      prisma.lecturaAnalisis.count({ where }),
    ]);

    // hasPdf: verificar si tiene blob guardado o URL externa
    const hasPdfSet = new Set<number>();
    try {
      const conBlob = await prisma.lecturaAnalisis.findMany({
        where: { id: { in: items.map(i => i.id) }, pdfBlob: { not: null } },
        select: { id: true },
      });
      conBlob.forEach(r => hasPdfSet.add(r.id));
    } catch { /* si pdfBlob aún no existe en BD vieja, ignorar */ }

    const itemsOut = items.map(item => ({
      ...item,
      hasPdf: hasPdfSet.has(item.id) || !!item.urlDocumento,
      usuarioGestionaUsuario: item.usuarioGestiona?.usuario ?? null,
      usuarioGestiona: undefined,
      usuarioEjecutor: item.usuario?.usuario ?? null,
      usuario: undefined,
    }));

    return NextResponse.json({ ok: true, items: itemsOut, total, limit, offset });
  } catch (err) {
    console.error('[GET /api/lectura/historial]', err);
    return NextResponse.json({ ok: false, error: 'Error al obtener historial.' }, { status: 500 });
  }
}
