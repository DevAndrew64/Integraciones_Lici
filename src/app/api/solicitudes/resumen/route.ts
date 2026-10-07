import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const conteos = await prisma.solicitud.groupBy({
      by: ['estadoSolicitud'],
      _count: { id: true },
    });

    const porEstado: Record<string, number> = {};
    let total = 0;
    for (const row of conteos) {
      const estado = row.estadoSolicitud ?? 'Sin estado';
      porEstado[estado] = row._count.id;
      total += row._count.id;
    }

    const [porOrigen, porAlias] = await Promise.all([
      prisma.solicitud.groupBy({ by: ['origenSolicitud'], _count: { id: true } }),
      prisma.solicitud.groupBy({ by: ['aliasFuente'], _count: { id: true } }),
    ]);

    const porOrigenMap: Record<string, number> = {};
    for (const r of porOrigen) porOrigenMap[r.origenSolicitud ?? ''] = r._count.id;

    const publico = porAlias
      .filter(r => r.aliasFuente === 'S1' || r.aliasFuente === 'S2')
      .reduce((s, r) => s + r._count.id, 0);
    const privado = porAlias
      .filter(r => r.aliasFuente !== 'S1' && r.aliasFuente !== 'S2')
      .reduce((s, r) => s + r._count.id, 0);

    return NextResponse.json({ ok: true, total, porEstado, porOrigen: porOrigenMap, publico, privado });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}