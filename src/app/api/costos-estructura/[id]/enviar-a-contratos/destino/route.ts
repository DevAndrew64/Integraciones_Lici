import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireEditarCostos } from '@/lib/authz';
import { destinoDeSolicitud } from '@/lib/contratos-puente/destino-solicitud';

/**
 * GET ?solicitudId=N — a dónde iría la oferta en Contratos, sin digitarlo: la empresa (por el perfil de la solicitud), las
 * UEN donde esa empresa tiene contador de ofertas con sus conceptos de facturación, y el origen del proceso. Solo lee.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireEditarCostos(session);
  if (denied) return denied;

  try {
    const solicitudId = Number(new URL(req.url).searchParams.get('solicitudId'));
    if (!Number.isInteger(solicitudId) || solicitudId < 1) {
      return NextResponse.json({ ok: false, error: 'SOLICITUD_REQUERIDA', mensaje: 'Abra los costos desde la ficha de la solicitud para enviarlos a Contratos.' }, { status: 400 });
    }
    const solicitud = await prisma.solicitud.findUnique({
      where: { id: solicitudId },
      select: { perfil: true, aliasFuente: true, linkSecop: true, linkSecopReg: true },
    });
    if (!solicitud) return NextResponse.json({ ok: false, error: 'SOLICITUD_NO_ENCONTRADA', mensaje: 'La solicitud no existe.' }, { status: 404 });
    const r = await destinoDeSolicitud(solicitud);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, mensaje: r.mensaje }, { status: r.estado });
    return NextResponse.json({ ok: true, empresa: r.destino.empresa, uens: r.destino.uens, origenProceso: r.origenProceso });
  } catch (e) {
    console.error('[GET /api/costos-estructura/[id]/enviar-a-contratos/destino]', e);
    // El código del error (p. ej. ER_HOST_IS_BLOCKED) dice la causa sin exponer datos de la conexión.
    const codigo = (e as { code?: unknown })?.code;
    const causa = typeof codigo === 'string' && /^[A-Z0-9_]{1,40}$/.test(codigo) ? ` (código ${codigo})` : '';
    return NextResponse.json({ ok: false, error: 'ERROR_DESTINO_CONTRATOS', mensaje: `No se pudo leer de Contratos la empresa y las UEN${causa}. El detalle está en la consola del servidor.` }, { status: 500 });
  }
}
