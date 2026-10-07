import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get('q')?.trim() || '';

  try {
    // Solo retornar Solicitudes cuyo codigoProceso tiene al menos un RagDocumento indexado
    const BASE = `
       FROM "Solicitud" s
       WHERE s.asignaciones IS NOT NULL
         AND jsonb_array_length(s.asignaciones) > 0
         AND s."estadoSolicitud" NOT IN ('Rechazada', 'Cancelada')
         AND (
           EXISTS (
             SELECT 1 FROM "RagDocumento" rd
             WHERE rd."codigoProceso" = s."codigoProceso"
               AND rd."codigoProceso" IS NOT NULL
           )
           OR EXISTS (
             SELECT 1 FROM "LecturaAnalisis" la
             WHERE la."codigoProceso" = s."codigoProceso"
               AND la.modo != 'colba-qa'
           )
         )`;

    const registros = await (q.length >= 2
      ? prisma.$queryRawUnsafe<{ id: number; codigoProceso: string; nombreProceso: string; entidad: string }[]>(
          `SELECT s.id, s."codigoProceso", s."nombreProceso", s.entidad ${BASE}
           AND (s."codigoProceso" ILIKE $1 OR s."nombreProceso" ILIKE $1 OR s.entidad ILIKE $1 OR s.objeto ILIKE $1)
           ORDER BY s."createdAt" DESC LIMIT 8`,
          `%${q}%`
        )
      : prisma.$queryRawUnsafe<{ id: number; codigoProceso: string; nombreProceso: string; entidad: string }[]>(
          `SELECT s.id, s."codigoProceso", s."nombreProceso", s.entidad ${BASE}
           ORDER BY s."createdAt" DESC LIMIT 8`
        )
    );

    return NextResponse.json({
      items: registros.map(r => ({
        id: r.id,
        codigo: r.codigoProceso || '',
        nombre: r.nombreProceso || '',
        entidad: r.entidad || '',
      }))
    });
  } catch (err) {
    console.error('[buscar-colba]', err);
    return NextResponse.json({ items: [] });
  }
}