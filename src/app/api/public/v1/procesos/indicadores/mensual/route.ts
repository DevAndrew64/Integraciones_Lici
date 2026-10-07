import { NextRequest, NextResponse } from 'next/server';
import { autenticarApiKey, respuestaErrorPublica, SCOPE_INDICADORES } from '@/lib/public-api/auth';
import { parsearFiltros, consultarMensual } from '@/lib/public-api/indicadores';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/v1/procesos/indicadores/mensual?anio=2026
 * Devuelve SIEMPRE los 12 meses (con ceros si no hay registros).
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
    const anio = parsed.filtros.anio ?? new Date().getFullYear();
    const meses = await consultarMensual(parsed.filtros, anio);

    return NextResponse.json({
      success: true,
      data: {
        anio,
        fechaReferencia: parsed.filtros.fechaReferencia,
        meses: meses.map(m => ({ mes: m.mes, totales: m.resumen.totales, indicadores: m.resumen.indicadores })),
      },
      meta: { version: 'v1', generatedAt: new Date().toISOString(), requestId: auth.requestId },
    });
  } catch (e) {
    console.error('[public-api mensual]', e instanceof Error ? e.message.slice(0, 300) : e);
    return respuestaErrorPublica(500, 'error_interno', 'Error interno consultando indicadores', auth.requestId);
  }
}
