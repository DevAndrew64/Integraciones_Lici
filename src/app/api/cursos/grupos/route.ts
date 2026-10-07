import { NextRequest, NextResponse } from 'next/server';
import { obtenerGruposCursos } from '@/lib/cursos-cache';
import { getSession } from '@/lib/session';
import { requireSession, hasPermiso } from '@/lib/authz';

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  // Ajuste "CUALQUIER PERSONA CON ACCESO AL MÓDULO COSTOS PUEDA CREAR Y
  // GUARDAR" — mismo criterio que /api/cursos: se acepta también
  // 'ver_estructura_costos' (selector de cursos dentro de Mano de Obra).
  if (!(await hasPermiso(session!, 'ver_examenes')) && !(await hasPermiso(session!, 'ver_estructura_costos'))) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const empresa = String(body.empresa ?? '').trim();
    if (!empresa) {
      return NextResponse.json({ ok: false, error: 'Se requiere empresa' }, { status: 400 });
    }

    const grupos = await obtenerGruposCursos(empresa);
    const data = grupos.map(g => ({
      codigoGrupo: String(g.cod_grp ?? ''),
      nombreGrupo: String(g.descripcion ?? ''),
    }));

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error consultando grupos de cursos' },
      { status: 500 }
    );
  }
}
