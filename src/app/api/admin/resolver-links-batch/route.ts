/**
 * GET /api/admin/resolver-links-batch
 *
 * Endpoint SSE del panel de admin.
 *
 * REPO SHARE-READY (B5): la resolución de `linkDetalle` por scraping legacy YA
 * NO es alcanzable. El `linkDetalle` llega resuelto (o `null`) dentro del bundle
 * canónico de la sincronización por la Data API. Este endpoint se conserva por
 * compatibilidad del panel, pero solo informa el estado (deshabilitado / migrado)
 * y cierra el stream — nunca ejecuta resolución ni toca la base de datos.
 *
 * Solo accesible para rol Administrador (sesión de LICYCOLBA).
 */

import { NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';
import { MENSAJE_SYNC_DESHABILITADO } from '@/lib/data-api/sync/fachadaSync';
import { modoSyncRuntime } from '@/lib/data-api/sync/modo';

export const dynamic = 'force-dynamic';

type SseEvento = { tipo: 'error'; mensaje: string };

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return new Response(denied.status === 401 ? 'No autenticado.' : 'No autorizado.', { status: denied.status });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (evt: SseEvento) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
        } catch { /* cliente desconectado */ }
      };

      try {
        const modo = modoSyncRuntime();
        send({
          tipo: 'error',
          mensaje:
            modo === 'disabled'
              ? MENSAJE_SYNC_DESHABILITADO
              : 'Adquisición vía Data API: la resolución de enlaces está migrada — el linkDetalle llega en ' +
                'el bundle canónico de la sincronización. No hay resolución legacy.',
        });
      } catch (e) {
        send({ tipo: 'error', mensaje: e instanceof Error ? e.message : String(e) });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
