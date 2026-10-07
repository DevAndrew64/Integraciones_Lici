import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// Clave compuesta para evitar falsos positivos cuando el mismo código
// de proceso lo usan entidades distintas (ej: LP-002-2026 ANM vs LP-002-2026 Alcaldía X)
function compositeKey(codigoProceso: string | null, entidad: string | null): string {
  return `${(codigoProceso ?? '').trim().toLowerCase()}|${(entidad ?? '').trim().toLowerCase()}`;
}

export async function GET() {
  try {
    const registros = await prisma.solicitud.findMany({
      select: { codigoProceso: true, procesoId: true, entidad: true, aliasFuente: true, estadoSolicitud: true, asignaciones: true },
    });

    // ids: claves compuestas codigoProceso|entidad (normalizado)
    const ids = registros
      .filter(s => s.codigoProceso)
      .map(s => compositeKey(s.codigoProceso, s.entidad));

    // mapa: misma clave compuesta → info de navegación
    const mapa: Record<string, { aliasFuente: string; estadoSolicitud: string; tieneAsignaciones: boolean }> = {};
    registros.forEach(s => {
      if (!s.codigoProceso) return;
      const asigs = Array.isArray(s.asignaciones) ? s.asignaciones as unknown[] : [];
      mapa[compositeKey(s.codigoProceso, s.entidad)] = {
        aliasFuente: s.aliasFuente ?? '',
        estadoSolicitud: s.estadoSolicitud ?? '',
        tieneAsignaciones: asigs.length > 0,
      };
    });

    return NextResponse.json({ ok: true, ids, mapa });
  } catch {
    return NextResponse.json({ ok: false, ids: [], mapa: {} });
  }
}