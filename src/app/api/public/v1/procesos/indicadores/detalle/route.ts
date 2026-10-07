import { NextRequest, NextResponse } from 'next/server';
import { autenticarApiKey, respuestaErrorPublica, SCOPE_DETALLE } from '@/lib/public-api/auth';
import { parsearFiltros, consultarDetalle, normalizarPaginacion } from '@/lib/public-api/indicadores';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/v1/procesos/indicadores/detalle?page=1&pageSize=25&categoria=PRESENTADO
 * Scope: procesos:detalle:read · Auth: header X-API-Key
 * Paginación: page≥1, pageSize 1..100 (default 25).
 */
export async function GET(req: NextRequest) {
  const auth = await autenticarApiKey(req, SCOPE_DETALLE);
  if (!auth.ok) return auth.response;

  try {
    const sp = req.nextUrl.searchParams;
    const parsed = parsearFiltros(sp, auth.client.empresasPermitidas);
    if (!parsed.ok) {
      return respuestaErrorPublica(400, 'filtro_invalido', `${parsed.error.campo}: ${parsed.error.mensaje}`, auth.requestId);
    }
    const { page, pageSize } = normalizarPaginacion(sp.get('page'), sp.get('pageSize'));
    const { filas, total } = await consultarDetalle(parsed.filtros, page, pageSize);

    return NextResponse.json({
      success: true,
      data: {
        items: filas,
        pagination: {
          page, pageSize, total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
        fechaReferencia: parsed.filtros.fechaReferencia,
      },
      meta: { version: 'v1', generatedAt: new Date().toISOString(), requestId: auth.requestId },
    });
  } catch (e) {
    console.error('[public-api detalle]', e instanceof Error ? e.message.slice(0, 300) : e);
    return respuestaErrorPublica(500, 'error_interno', 'Error interno consultando detalle', auth.requestId);
  }
}
