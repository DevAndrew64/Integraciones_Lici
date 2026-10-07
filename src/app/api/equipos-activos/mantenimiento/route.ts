import { NextRequest, NextResponse } from 'next/server';
import { resolverMantenimientoSugerido } from '@/lib/costos-estructura/catalogo-mantenimiento-equipos';
import { getSession } from '@/lib/session';
import { requireSession, hasPermiso } from '@/lib/authz';

/**
 * Ajuste "CORREGIR CÓDIGO, CANTIDAD A COMPRAR Y VINCULACIÓN DE
 * MANTENIMIENTO EN MAQUINARIA Y EQUIPOS" §3 — sugerencia de tarifa de
 * mantenimiento por descripción de equipo, a partir de los catálogos
 * reales en `data/importaciones/mantenimiento/` (nunca
 * TarifaMantenimientoEquipo de Prisma). Puede devolver `sugerencia:null`
 * cuando no hay coincidencia única — el cliente debe dejar el campo
 * editable en ese caso, nunca asumir cero.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  if (!(await hasPermiso(session!, 'ver_estructura_costos'))) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const descripcionEquipo = String(body.descripcionEquipo ?? '').trim();
    if (!descripcionEquipo) {
      return NextResponse.json({ ok: false, error: 'Se requiere descripcionEquipo' }, { status: 400 });
    }

    const sugerencia = await resolverMantenimientoSugerido(descripcionEquipo);
    return NextResponse.json({ ok: true, sugerencia });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error consultando el catálogo de mantenimiento' },
      { status: 500 }
    );
  }
}
