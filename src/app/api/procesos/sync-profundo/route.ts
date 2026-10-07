/**
 * GET /api/procesos/sync-profundo
 *
 * Sync rotativo de procesos históricos (ascending=1, oldest first).
 * Complementa el sync principal que cubre los 300 más recientes.
 *
 * Estrategia: sin estado en BD. La página se calcula por día del año,
 * rotando un ciclo de CICLO_PAGINAS días. Con 30 procesos/página y
 * 50 páginas = cubre ~1500 procesos por ciclo (≈50 días).
 *
 * Llamar desde Hostinger Cron Jobs UNA VEZ al día.
 * Ejemplo: GET https://your-domain.example/api/procesos/sync-profundo
 * Expresión cron: 0 4 * * *  (4:00 AM UTC = 11:00 PM Colombia)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdminOrN8N } from '@/lib/authz';
import {
  fachadaSync,
  SyncModoDataApiNoHabilitadoError,
  OperacionMigradaDataApiError,
} from '@/lib/data-api/sync/fachadaSync';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const POR_PAGINA = 30;
const CICLO_PAGINAS = 50; // días antes de volver a página 1

let syncProfundoRunning = false;

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdminOrN8N(req, session);
  if (denied) return denied;

  if (syncProfundoRunning) {
    return NextResponse.json({ ok: true, skipped: true, motivo: 'sync profundo ya en curso' }, { status: 429 });
  }
  syncProfundoRunning = true;
  try {
    // Página explícita vía query param, o auto-calculada por día
    const url = new URL(req.url);
    const paginaParam = url.searchParams.get('pagina');

    let pagina: number;
    if (paginaParam && Number.isInteger(Number(paginaParam)) && Number(paginaParam) >= 1) {
      pagina = Number(paginaParam);
    } else {
      const diasDesdeEpoca = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
      pagina = (diasDesdeEpoca % CICLO_PAGINAS) + 1;
    }

    const offset = (pagina - 1) * POR_PAGINA;

    console.log('[sync-profundo] iniciando', { pagina, offset, porPagina: POR_PAGINA });

    const r = await fachadaSync.sincronizarProcesos(
      {
        maxResultados: POR_PAGINA,
        limitPorPagina: POR_PAGINA,
        forzar: false,
        filtrarNuevos: false,
        ascending: 1,       // oldest first — complementa el sync principal (ascending: 0)
        paginaInicio: pagina,
      },
      // Modo data-api (flag ON): el sync profundo es el full resync programado.
      { fullResync: true },
    );

    if (r.estado === 'deshabilitado') {
      return NextResponse.json(
        { ok: false, deshabilitado: true, mensaje: r.mensaje, modo: 'profundo' },
        { status: 503 }
      );
    }

    const metrics = r.datos;
    return NextResponse.json({
      ...metrics,
      modo: 'profundo',
      parametros: { pagina, offset, porPagina: POR_PAGINA, ciclo: CICLO_PAGINAS },
    }, { status: metrics.ok ? 200 : 500 });

  } catch (error) {
    if (error instanceof OperacionMigradaDataApiError) {
      return NextResponse.json(
        { ok: false, migrado: true, error: error.message, modo: 'profundo' },
        { status: error.httpStatus },
      );
    }
    if (error instanceof SyncModoDataApiNoHabilitadoError) {
      console.error('[GET /api/procesos/sync-profundo] modo data-api no habilitado');
      return NextResponse.json({ ok: false, error: error.message, modo: 'profundo' }, { status: 503 });
    }
    console.error('[GET /api/procesos/sync-profundo]', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error en sync profundo' },
      { status: 500 }
    );
  } finally {
    syncProfundoRunning = false;
  }
}
