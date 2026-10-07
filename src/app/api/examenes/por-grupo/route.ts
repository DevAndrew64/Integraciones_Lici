import { NextRequest, NextResponse } from 'next/server';
import { obtenerExamenes } from '@/lib/examenes-cache';
import { getSession } from '@/lib/session';
import { requireSession, hasPermiso } from '@/lib/authz';
import { consultarExamenesAgrupados, type FiltrosExamenes } from '@/lib/examenes/agrupar-examenes';

function parseIntSafe(v: unknown, fb: number) {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isNaN(n) ? fb : n;
}

function parseFloatSafe(v: unknown): number | undefined {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  // Ajuste "CUALQUIER PERSONA CON ACCESO AL MÓDULO COSTOS PUEDA CREAR Y
  // GUARDAR" — mismo criterio que /api/examenes: se acepta también
  // 'ver_estructura_costos' (selector de exámenes dentro de Mano de Obra).
  if (!(await hasPermiso(session!, 'ver_examenes')) && !(await hasPermiso(session!, 'ver_estructura_costos'))) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
  }

  try {
    const body = await req.json();

    const {
      grupo_exam,
      cod_examen,
      nit_proveedor,
      codmun,
      ciudad,
      q,
      search,
      val_min,
      val_max,
      page: pageRaw,
      limit: limitRaw,
      export: exportAllRaw,
    } = body;

    const exportAll = exportAllRaw === true;
    const page = Math.max(1, parseIntSafe(pageRaw, 1));
    const limit = exportAll
      ? 999999
      : Math.min(200, Math.max(1, parseIntSafe(limitRaw, 30)));

    // Ajuste "CORREGIR SELECTOR DE EXÁMENES MÉDICOS" §1/§5/§9/§12
    // (confirmado explícitamente) — TODOS los filtros (ciudad incluida)
    // se aplican aquí, en el backend, SOBRE EL CONJUNTO COMPLETO, ANTES
    // de agrupar y paginar — nunca solo sobre la página ya recibida.
    // Se relaja el requisito anterior de "al menos grupo/codmun/q": un
    // filtro de ciudad SOLA (o cualquier combinación) es válido.
    const filtros: FiltrosExamenes = {
      grupoExam: grupo_exam ? String(grupo_exam) : undefined,
      codExamen: cod_examen ? String(cod_examen) : undefined,
      nitProveedor: nit_proveedor ? String(nit_proveedor) : undefined,
      codmun: codmun ? String(codmun) : undefined,
      ciudad: ciudad ? String(ciudad) : undefined,
      q: (q || search) ? String(q || search) : undefined,
      valMin: parseFloatSafe(val_min),
      valMax: parseFloatSafe(val_max),
    };

    const todos = await obtenerExamenes();
    const { data, total, totalPages, page: safePage } = consultarExamenesAgrupados(todos, filtros, page, limit, exportAll);

    return NextResponse.json({
      ok: true,
      page: safePage,
      limit,
      total,
      totalPages,
      data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Error consultando exámenes por grupo',
      },
      { status: 500 }
    );
  }
}