import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireNoMercadeo } from '@/lib/authz';
import { obtenerHistorial, proyectarDecimalTrm, siguienteDiaHabil } from '@/lib/trm';
import { listarHistorialCache } from '@/lib/trm/trmCache';
import { leerHistorico, maxEventoId, prediccionVigente, guardarPrediccion } from '@/lib/trm/trmStore';
import { jobActualizarTrmHistorico, DIAS_HISTORICO_MODELO, VENTANAS_MODELO } from '@/lib/trm/trmJobs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/trm/proyeccion-decimal?fecha=YYYY-MM-DD
 * GET /api/trm/proyeccion-decimal?fechaCierre=YYYY-MM-DD
 *
 * Devuelve un único dato final: los dos últimos decimales recomendados de la
 * TRM para la fecha objetivo. Motor determinístico (ARIMA sobre eventos
 * efectivos + bootstrap Monte Carlo); sin IA en ejecución.
 *
 * Flujo:
 *   1. Serie diaria desde trm_historico (semilla automática si está vacía).
 *   2. Si la fecha ya existe en el histórico → dato real, sin proyección.
 *   3. Si hay predicción vigente en trm_predicciones (calibrada con el último
 *      evento efectivo) → se sirve la almacenada.
 *   4. Fallback: cálculo en vivo + persistencia del resultado.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireNoMercadeo(session);
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const fecha = searchParams.get('fecha') ?? undefined;
    const fechaCierre = searchParams.get('fechaCierre') ?? undefined;

    if (!fecha && !fechaCierre) {
      return NextResponse.json(
        { ok: false, error: 'Se requiere el parámetro fecha o fechaCierre (YYYY-MM-DD)' },
        { status: 400 },
      );
    }
    const fechaParam = fecha ?? fechaCierre!;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaParam)) {
      return NextResponse.json(
        { ok: false, error: `Fecha inválida: ${fechaParam} (se espera YYYY-MM-DD)` },
        { status: 400 },
      );
    }
    // Regla de negocio: la TRM aplicable es la del día hábil siguiente al cierre
    const fechaObjetivo = fecha ?? siguienteDiaHabil(fechaCierre!);

    // ── 1. Serie diaria desde trm_historico (con semilla automática) ──
    let serie = await leerHistorico(DIAS_HISTORICO_MODELO);
    let fuenteSerie = 'trm_historico';
    if (serie.length < 60) {
      await jobActualizarTrmHistorico();
      serie = await leerHistorico(DIAS_HISTORICO_MODELO);
    }
    if (serie.length < 60) {
      // Fallbacks si las tablas nuevas aún no existen: fetch directo → caché
      serie = await obtenerHistorial(DIAS_HISTORICO_MODELO);
      fuenteSerie = 'datos_gov_co';
    }
    if (serie.length < 60) {
      serie = await listarHistorialCache(DIAS_HISTORICO_MODELO);
      fuenteSerie = 'cache';
    }
    if (serie.length < 60) {
      return NextResponse.json(
        { ok: false, error: 'Histórico TRM insuficiente (sin datos en BD ni conexión a datos.gov.co)' },
        { status: 503 },
      );
    }

    const ultimaFechaSerie = serie[serie.length - 1].fecha;

    // ── 2/3. Predicción almacenada vigente (solo para fechas futuras) ──
    if (fechaObjetivo > ultimaFechaSerie) {
      const eventoActual = await maxEventoId();
      const almacenada = await prediccionVigente(fechaObjetivo, eventoActual);
      if (almacenada) {
        return NextResponse.json({ ok: true, fuenteSerie: 'trm_predicciones', ...almacenada });
      }

      // ── 4. Cálculo en vivo + persistencia ──
      const resultado = proyectarDecimalTrm({ serie, fechaObjetivo, ventanas: VENTANAS_MODELO });
      await guardarPrediccion(resultado, eventoActual);
      return NextResponse.json({ ok: true, fuenteSerie, ...resultado });
    }

    // Fecha ya existente en el histórico → dato real, sin proyección
    const resultado = proyectarDecimalTrm({ serie, fechaObjetivo, ventanas: VENTANAS_MODELO });
    return NextResponse.json({ ok: true, fuenteSerie, ...resultado });
  } catch (error) {
    console.error('[GET /api/trm/proyeccion-decimal]', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error en proyección TRM' },
      { status: 500 },
    );
  }
}
