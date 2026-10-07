import { NextRequest, NextResponse } from 'next/server';
import { autenticarApiKey, respuestaErrorPublica, SCOPE_INDICADORES } from '@/lib/public-api/auth';
import { parsearFiltros, consultarResumen } from '@/lib/public-api/indicadores';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/v1/procesos/indicadores/resumen?anio=2026&mes=7
 * Scope: procesos:indicadores:read · Auth: header X-API-Key
 */
export async function GET(req: NextRequest) {
  const auth = await autenticarApiKey(req, SCOPE_INDICADORES);
  if (!auth.ok) return auth.response;

  try {
    const parsed = parsearFiltros(req.nextUrl.searchParams, auth.client.empresasPermitidas);
    if (!parsed.ok) {
      return respuestaErrorPublica(400, 'filtro_invalido', `${parsed.error.campo}: ${parsed.error.mensaje}`, auth.requestId);
    }
    const f = parsed.filtros;
    const { totales, indicadores } = await consultarResumen(f);

    return NextResponse.json({
      success: true,
      data: {
        periodo: {
          anio: f.anio ?? null,
          mes: f.mes ?? null,
          fechaDesde: f.fechaDesde ?? null,
          fechaHasta: f.fechaHasta ?? null,
          fechaReferencia: f.fechaReferencia,
        },
        totales,
        indicadores,
      },
      meta: { version: 'v1', generatedAt: new Date().toISOString(), requestId: auth.requestId },
    });
  } catch (e) {
    console.error('[public-api resumen]', e instanceof Error ? e.message.slice(0, 300) : e);
    return respuestaErrorPublica(500, 'error_interno', 'Error interno consultando indicadores', auth.requestId);
  }
}
