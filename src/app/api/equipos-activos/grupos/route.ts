import { NextRequest, NextResponse } from 'next/server';
import { obtenerGruposActivo } from '@/lib/equipos-activos-cache';
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
    if (!empresa) {
      return NextResponse.json({ ok: false, error: 'Se requiere empresa' }, { status: 400 });
    }

    const grupos = await obtenerGruposActivo(empresa);
    // La fuente externa puede repetir el mismo cod_grupo en varias filas
    // (ej. una por UEN) — se deduplica por código, quedándose con la
    // primera descripción, para nunca romper la unicidad de la lista.
    const vistos = new Set<string>();
    const data: { codigoGrupo: string; descripcionGrupo: string }[] = [];
    for (const g of grupos) {
      const codigoGrupo = String(g.cod_grupo ?? '');
      if (vistos.has(codigoGrupo)) continue;
      vistos.add(codigoGrupo);
      data.push({ codigoGrupo, descripcionGrupo: String(g.descripcion ?? '') });
    }

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error consultando grupos de activos' },
      { status: 500 }
    );
  }
}
