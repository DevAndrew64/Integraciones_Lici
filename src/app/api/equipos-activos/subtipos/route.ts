import { NextRequest, NextResponse } from 'next/server';
import { obtenerSubtiposActivo } from '@/lib/equipos-activos-cache';
import { getSession } from '@/lib/session';
import { requireSession, hasPermiso } from '@/lib/authz';

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  if (!(await hasPermiso(session!, 'ver_estructura_costos'))) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const empresa = String(body.empresa ?? '').trim();
    const codigoGrupo = String(body.codigoGrupo ?? '').trim();
    if (!empresa) {
      return NextResponse.json({ ok: false, error: 'Se requiere empresa' }, { status: 400 });
    }
    if (!codigoGrupo) {
      return NextResponse.json({ ok: false, error: 'Se requiere codigoGrupo' }, { status: 400 });
    }

    const subtipos = await obtenerSubtiposActivo(empresa, codigoGrupo);
    // La fuente externa puede repetir el mismo cod_subtipo en varias filas
    // (ej. una por UEN) — se deduplica por código, quedándose con la
    // primera descripción, para nunca romper la unicidad de la lista.
    const vistos = new Set<string>();
    const data: { codigoSubtipo: string; descripcionSubtipo: string }[] = [];
    for (const s of subtipos) {
      const codigoSubtipo = String(s.cod_subtipo ?? '');
      if (vistos.has(codigoSubtipo)) continue;
      vistos.add(codigoSubtipo);
      data.push({ codigoSubtipo, descripcionSubtipo: String(s.descripcion ?? '') });
    }

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error consultando subtipos de activos' },
      { status: 500 }
    );
  }
}
