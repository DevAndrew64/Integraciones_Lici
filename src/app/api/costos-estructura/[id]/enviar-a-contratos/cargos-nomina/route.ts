import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireEditarCostos } from '@/lib/authz';
import { destinoDeSolicitud } from '@/lib/contratos-puente/destino-solicitud';
import { consultarCargosNomina } from '@/lib/contratos-puente/directo';
import { baseNominaValida } from '@/lib/contratos-puente/nomina';

const MAX_CARGOS = 300;

/**
 * POST { solicitudId, undnegocio, baseNomina?, cargos: [{ nombre, codigoNomina? }] } — antes de enviar a Contratos, qué
 * cargo de la nómina de la UEN toma cada cargo de la oferta y el catálogo de cargos de esa nómina, para elegir los que no
 * cruzan por nombre. La empresa sale del perfil de la solicitud (no de la pantalla) y la UEN debe ser una de las suyas en
 * Contratos. Solo lee.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireEditarCostos(session);
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => null)) as { solicitudId?: unknown; undnegocio?: unknown; baseNomina?: unknown; cargos?: unknown } | null;
    const solicitudId = Number(body?.solicitudId);
    if (!Number.isInteger(solicitudId) || solicitudId < 1) {
      return NextResponse.json({ ok: false, error: 'SOLICITUD_REQUERIDA', mensaje: 'Abra los costos desde la ficha de la solicitud para enviarlos a Contratos.' }, { status: 400 });
    }
    const undnegocio = typeof body?.undnegocio === 'string' ? body.undnegocio.trim().toUpperCase() : '';
    const lista = Array.isArray(body?.cargos) ? body.cargos : null;
    if (!undnegocio || !lista || lista.length > MAX_CARGOS) {
      return NextResponse.json({ ok: false, error: 'PEDIDO_INVALIDO', mensaje: 'Faltan la UEN o los cargos.' }, { status: 400 });
    }
    const cargos = lista.map((c) => {
      const x = (typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>;
      const codigo = x.codigoNomina;
      return {
        nombre: typeof x.nombre === 'string' ? x.nombre.slice(0, 200) : '',
        codigoNomina: typeof codigo === 'number' && Number.isInteger(codigo) && codigo > 0 ? codigo : null,
      };
    });

    const solicitud = await prisma.solicitud.findUnique({
      where: { id: solicitudId },
      select: { perfil: true, aliasFuente: true, linkSecop: true, linkSecopReg: true },
    });
    if (!solicitud) return NextResponse.json({ ok: false, error: 'SOLICITUD_NO_ENCONTRADA', mensaje: 'La solicitud no existe.' }, { status: 404 });
    const leido = await destinoDeSolicitud(solicitud);
    if (!leido.ok) return NextResponse.json({ ok: false, error: leido.error, mensaje: leido.mensaje }, { status: leido.estado });
    if (!leido.destino.uens.some((u) => u.codigo.toUpperCase() === undnegocio)) {
      return NextResponse.json({ ok: false, error: 'DESTINO_INVALIDO', mensaje: `La UEN ${undnegocio} no es de la empresa ${leido.destino.empresa.codigo} en Contratos.` }, { status: 422 });
    }

    const r = await consultarCargosNomina({ empresa: leido.destino.empresa.codigo, undnegocio, cargos, baseNomina: baseNominaValida(body?.baseNomina) });
    if (!r.ok) return NextResponse.json({ ok: false, error: 'NOMINA_NO_DISPONIBLE', mensaje: r.mensaje }, { status: 503 });
    return NextResponse.json({ ok: true, ...r.vista });
  } catch (e) {
    console.error('[POST /api/costos-estructura/[id]/enviar-a-contratos/cargos-nomina]', e);
    return NextResponse.json({ ok: false, error: 'ERROR_NOMINA_CONTRATOS', mensaje: 'No se pudo revisar los cargos en la nómina de Contratos.' }, { status: 500 });
  }
}
