import { NextRequest, NextResponse } from 'next/server';
import { autenticarApiKey, respuestaErrorPublica, SCOPE_INDICADORES } from '@/lib/public-api/auth';
import { parsearFiltros, consultarAnual } from '@/lib/public-api/indicadores';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/v1/procesos/indicadores/anual?anioDesde=2025&anioHasta=2026
 * Scope: procesos:indicadores:read · Auth: header X-API-Key
 */
export async function GET(req: NextRequest) {
  const auth = await autenticarApiKey(req, SCOPE_INDICADORES);
  if (!auth.ok) return auth.response;

  try {
    const sp = req.nextUrl.searchParams;
    const hoy = new Date().getFullYear();
    const anioDesde = sp.get('anioDesde') !== null ? Number(sp.get('anioDesde')) : hoy;
    const anioHasta = sp.get('anioHasta') !== null ? Number(sp.get('anioHasta')) : hoy;
    if (!Number.isInteger(anioDesde) || !Number.isInteger(anioHasta) || anioDesde < 2000 || anioHasta > 2100) {
      return respuestaErrorPublica(400, 'filtro_invalido', 'anioDesde/anioHasta inválidos (2000-2100)', auth.requestId);
    }
    if (anioDesde > anioHasta || anioHasta - anioDesde > 20) {
      return respuestaErrorPublica(400, 'filtro_invalido', 'Rango de años inválido (máximo 20 años, desde ≤ hasta)', auth.requestId);
    }

    const parsed = parsearFiltros(sp, auth.client.empresasPermitidas);
    if (!parsed.ok) {
      return respuestaErrorPublica(400, 'filtro_invalido', `${parsed.error.campo}: ${parsed.error.mensaje}`, auth.requestId);
    }
    const anios = await consultarAnual(parsed.filtros, anioDesde, anioHasta);

    return NextResponse.json({
      success: true,
      data: {
        anioDesde, anioHasta,
        fechaReferencia: parsed.filtros.fechaReferencia,
        anios: anios.map(a => ({ anio: a.anio, totales: a.resumen.totales, indicadores: a.resumen.indicadores })),
      },
      meta: { version: 'v1', generatedAt: new Date().toISOString(), requestId: auth.requestId },
    });
  } catch (e) {
    console.error('[public-api anual]', e instanceof Error ? e.message.slice(0, 300) : e);
    return respuestaErrorPublica(500, 'error_interno', 'Error interno consultando indicadores', auth.requestId);
  }
}
