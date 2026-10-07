import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const solicitudes = await prisma.solicitud.findMany({
      select: { codigoProceso: true },
      where: { codigoProceso: { not: null } },
    });

    let max = 0;
    for (const s of solicitudes) {
      const raw = (s.codigoProceso ?? '').trim();
      // Acepta "33" o "No 33"
      const match = raw.match(/^(?:No\s+)?(\d+)$/i);
      if (match) {
        const n = Number.parseInt(match[1], 10);
        if (n > max) max = n;
      }
    }

    return NextResponse.json({ ok: true, siguiente: max + 1 });
  } catch (error) {
    console.error('[GET /api/solicitudes/siguiente-numero]', error);
    return NextResponse.json(
      { ok: false, error: 'Error al obtener el siguiente número.' },
      { status: 500 },
    );
  }
}
