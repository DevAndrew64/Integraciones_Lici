import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireNoMercadeo } from '@/lib/authz';
import { obtenerTrmActual, obtenerHistorial } from '@/lib/trm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/trm?dias=30
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireNoMercadeo(session);
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const dias = Math.min(Math.max(Number(searchParams.get('dias') ?? '30'), 1), 15000);

    // Obtener valor actual con caché (primer intento desde BD, luego fetch)
    const trmActual = await obtenerTrmActual();

    // Historial: fetch externo (también puebla caché como efecto secundario)
    const historialEntries = await obtenerHistorial(dias);

    // Backward-compatible: mantener la forma exacta que usa el frontend (Highcharts)
    // + agregar campos opcionales de trazabilidad
    return NextResponse.json({
      ok: true,
      actual: {
        // Campos existentes — sin cambios
        valor: trmActual.valor,
        unidad: 'COP',
        vigencia: trmActual.vigenciaHasta ?? trmActual.fecha,
        // Campos nuevos (Fase 2A) — el frontend puede ignorarlos si no los usa aún
        centavos: trmActual.centavos,
        fuente: trmActual.fuente,
        esOficial: trmActual.esOficial,
        vigenciaDesde: trmActual.vigenciaDesde,
        vigenciaHasta: trmActual.vigenciaHasta,
        desdeCache: trmActual.desdeCache,
        consultadoEn: trmActual.consultadoEn,
        advertencia: trmActual.advertencia,
      },
      historial: historialEntries,
    });
  } catch (error) {
    console.error('[GET /api/trm]', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error TRM' },
      { status: 500 },
    );
  }
}