import { NextRequest, NextResponse } from 'next/server';
import { obtenerExamenes } from '@/lib/examenes-cache';
import { getSession } from '@/lib/session';
import { requireSession, hasPermiso } from '@/lib/authz';
import { consultarExamenesAgrupados, type FiltrosExamenes } from '@/lib/examenes/agrupar-examenes';

function parseIntSafe(v: string | null, fb: number) {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isNaN(n) ? fb : n;
}

function parseFloatSafe(v: string | null): number | undefined {
  if (v === null || v.trim() === '') return undefined;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  // Ajuste "CUALQUIER PERSONA CON ACCESO AL MÓDULO COSTOS PUEDA CREAR Y
  // GUARDAR" — este catálogo también lo consume el selector de exámenes
  // dentro de Mano de Obra (Estructura de costos), así que además de
  // 'ver_examenes' (módulo Exámenes médicos) se acepta 'ver_estructura_costos':
  // quien puede trabajar en Costos no debe quedar bloqueado al adjuntar un
  // examen a una línea de mano de obra.
  if (!(await hasPermiso(session!, 'ver_examenes')) && !(await hasPermiso(session!, 'ver_estructura_costos'))) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const exportAll = searchParams.get('export') === 'true';
    const page  = Math.max(1, parseIntSafe(searchParams.get('page'), 1));
    const limit = exportAll
      ? 999999
      : Math.min(200, Math.max(1, parseIntSafe(searchParams.get('limit'), 30)));

    // Ajuste "CORREGIR SELECTOR DE EXÁMENES MÉDICOS" §1/§5/§9/§12
    // (confirmado explícitamente) — mismos filtros (ciudad incluida) que
    // /api/examenes/por-grupo, aplicados ANTES de agrupar y paginar —
    // reutiliza el mismo punto único `consultarExamenesAgrupados`, nunca
    // una segunda implementación de filtro/agrupación.
    const filtros: FiltrosExamenes = {
      grupoExam: searchParams.get('grupo_exam') ?? undefined,
      codExamen: searchParams.get('cod_examen') ?? undefined,
      nitProveedor: searchParams.get('nit_proveedor') ?? undefined,
      codmun: searchParams.get('codmun') ?? undefined,
      ciudad: searchParams.get('ciudad') ?? undefined,
      q: searchParams.get('q') ?? undefined,
      valMin: parseFloatSafe(searchParams.get('val_min')),
      valMax: parseFloatSafe(searchParams.get('val_max')),
    };

    const todos = await obtenerExamenes();
    const { data, total, totalPages, page: safePage } = consultarExamenesAgrupados(todos, filtros, page, limit, exportAll);

    return NextResponse.json({ ok: true, page: safePage, limit, total, totalPages, data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error consultando exámenes' },
      { status: 500 }
    );
  }
}
