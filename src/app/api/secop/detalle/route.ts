import { NextRequest, NextResponse } from 'next/server';
import {
  fachadaSync,
  SyncModoDataApiNoHabilitadoError,
  OperacionMigradaDataApiError,
} from '@/lib/data-api/sync/fachadaSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const url = String(body?.url ?? '').trim();

    if (!url) {
      return NextResponse.json(
        { ok: false, error: 'Debes enviar la URL del proceso en el campo "url".' },
        { status: 400 }
      );
    }

    if (!url.includes('community.secop.gov.co')) {
      return NextResponse.json(
        { ok: false, error: 'La URL enviada no parece ser una ficha pública de SECOP.' },
        { status: 400 }
      );
    }

    const r = await fachadaSync.obtenerDetallePublico(url);

    if (r.estado === 'deshabilitado') {
      return NextResponse.json(
        { ok: false, deshabilitado: true, error: r.mensaje },
        { status: 503 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: r.datos.detalle,
      persisted: r.datos.persisted,
    });
  } catch (error) {
    if (error instanceof OperacionMigradaDataApiError) {
      // Cutover activo: no hay scraping público de SECOP en runtime.
      return NextResponse.json(
        { ok: false, migrado: true, error: error.message },
        { status: error.httpStatus },
      );
    }
    if (error instanceof SyncModoDataApiNoHabilitadoError) {
      console.error('Error en /api/secop/detalle: modo data-api no habilitado');
      return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
    }
    console.error('Error en /api/secop/detalle:', error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 }
    );
  }
}