import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

/**
 * GET /api/procesos/detalle-unspsc?random=...&dbId=...
 *
 * REPO SHARE-READY (B5): este endpoint YA NO consulta al proveedor de procesos.
 * La clasificación UNSPSC en vivo está migrada a la Data API (llega en el bundle
 * canónico de la sincronización). Aquí solo se sirve la clasificación ya
 * persistida en la base de datos propia (fast-path de caché). Si no hay caché,
 * se responde 409 "migrado" — nunca hay fetch directo a la fuente.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const random = searchParams.get('random');
    const dbId   = searchParams.get('dbId');

    if (!random) {
      return NextResponse.json({ ok: false, error: 'Falta parámetro random' }, { status: 400 });
    }

    // ── Fast-path: clasificación ya persistida en la BD propia ────────────
    if (dbId) {
      try {
        const cached = await prisma.proceso.findUnique({
          where: { id: Number(dbId) },
          select: {
            unspsc: true,
            actividadLicy: true,
            clasificacionAt: true,
            linkDetalle: true,
            linkSecop: true,
            linkSecopReg: true,
            aliasFuente: true,
          },
        });

        if (cached?.unspsc && cached?.clasificacionAt) {
          const fuentes: { label: string; url: string }[] = [];
          const alias = cached.aliasFuente ?? '';
          const labelFuente = alias === 'S2' ? 'SECOP II' : alias === 'S1' ? 'SECOP I' : 'Portal';
          if (cached.linkDetalle) fuentes.push({ label: labelFuente, url: cached.linkDetalle });
          if (cached.linkSecop && cached.linkSecop !== cached.linkDetalle)
            fuentes.push({ label: labelFuente, url: cached.linkSecop });
          if (cached.linkSecopReg)
            fuentes.push({ label: 'Fuente registrados ' + labelFuente, url: cached.linkSecopReg });

          return NextResponse.json({
            ok: true,
            unspsc: cached.unspsc,
            actividad: cached.actividadLicy,
            segmento: null,
            familia: null,
            clase: null,
            grupo: null,
            duracion: null,
            plazoValidez: null,
            fuentes,
            cached: true,
          });
        }
      } catch { /* silencioso */ }
    }

    // ── Sin caché: operación migrada a la Data API (sin equivalente en vivo) ──
    return NextResponse.json(
      {
        ok: false,
        migrado: true,
        error:
          'La clasificación UNSPSC en vivo está migrada a la Data API (bundle canónico). ' +
          'No hay consulta directa al proveedor en runtime.',
      },
      { status: 410 },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 },
    );
  }
}
