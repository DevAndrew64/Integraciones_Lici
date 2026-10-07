import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * POST /api/notificaciones/limpiar
 *
 * Purga notificaciones que ya no aplican según las reglas actuales:
 * 1. proceso_nuevo: eliminadas del panel (se gestiona en otros módulos)
 * 2. cambio_cronograma sin valorTextoAnterior: falsos positivos del sync anterior
 * 3. documento_nuevo que no son adendas: ruido sin valor informativo
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;

  try {
    const [r1, r2, r3, r4, r5] = await Promise.all([
      // proceso_nuevo: ya no se muestran en el panel
      prisma.$queryRaw<[{ count: bigint }]>(Prisma.sql`
        WITH d AS (DELETE FROM "Notificacion" WHERE tipo = 'proceso_nuevo' RETURNING id)
        SELECT COUNT(*) AS count FROM d
      `),
      // cambio_cronograma sin cambio real de fecha
      prisma.$queryRaw<[{ count: bigint }]>(Prisma.sql`
        WITH d AS (
          DELETE FROM "Notificacion"
          WHERE tipo = 'cambio_cronograma'
            AND (datos->>'valorTextoAnterior') IS NULL
          RETURNING id
        )
        SELECT COUNT(*) AS count FROM d
      `),
      // documento_nuevo que no son adendas
      prisma.$queryRaw<[{ count: bigint }]>(Prisma.sql`
        WITH d AS (
          DELETE FROM "Notificacion"
          WHERE tipo = 'documento_nuevo'
            AND (datos->>'primerAdenda') IS NULL
          RETURNING id
        )
        SELECT COUNT(*) AS count FROM d
      `),
      // cambio_fecha_cierre con título viejo "manualmente" → renombrar
      prisma.$queryRaw<[{ count: bigint }]>(Prisma.sql`
        WITH u AS (
          UPDATE "Notificacion"
          SET titulo = 'Cronograma actualizado'
          WHERE tipo = 'cambio_fecha_cierre'
            AND titulo = 'Cronograma actualizado manualmente'
          RETURNING id
        )
        SELECT COUNT(*) AS count FROM u
      `),
      // cambio_fecha_cierre duplicados: dejar solo el más reciente por proceso
      prisma.$queryRaw<[{ count: bigint }]>(Prisma.sql`
        WITH ranked AS (
          SELECT id,
            ROW_NUMBER() OVER (PARTITION BY "procesoId" ORDER BY "creadoEn" DESC) AS rn
          FROM "Notificacion"
          WHERE tipo = 'cambio_fecha_cierre'
        ),
        d AS (
          DELETE FROM "Notificacion"
          WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
          RETURNING id
        )
        SELECT COUNT(*) AS count FROM d
      `),
    ]);

    const total = Number(r1[0]?.count ?? 0) + Number(r2[0]?.count ?? 0)
                + Number(r3[0]?.count ?? 0) + Number(r5[0]?.count ?? 0);
    const actualizadas = Number(r4[0]?.count ?? 0);

    console.log('[limpiar]', {
      procesoNuevo: Number(r1[0]?.count ?? 0),
      cambioCronogramaFalso: Number(r2[0]?.count ?? 0),
      documentoNoAdenda: Number(r3[0]?.count ?? 0),
      tituloRenombrado: actualizadas,
      duplicadosCronograma: Number(r5[0]?.count ?? 0),
    });

    return NextResponse.json({
      ok: true,
      eliminadas: total,
      actualizadas,
      detalle: {
        procesoNuevo: Number(r1[0]?.count ?? 0),
        cambioCronogramaFalso: Number(r2[0]?.count ?? 0),
        documentoNoAdenda: Number(r3[0]?.count ?? 0),
        tituloRenombrado: actualizadas,
        duplicadosCronograma: Number(r5[0]?.count ?? 0),
      },
    });
  } catch (error) {
    console.error('[POST /api/notificaciones/limpiar]', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 }
    );
  }
}
