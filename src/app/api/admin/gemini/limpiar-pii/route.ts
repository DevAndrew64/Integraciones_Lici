import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';
import { auditFromRequest } from '@/lib/audit';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Umbral mínimo irrevocable — no parametrizable por body
const MIN_DIAS_EMAIL = 90;

type FilaDryRun = {
  afectados: bigint;
  mas_antiguo: string | null;
  mas_reciente: string | null;
};

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;

  let body: { dryRun?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // dryRun=true por defecto: solo dryRun: false explícito ejecuta la limpieza
  const dryRun = body.dryRun !== false;

  try {
    if (dryRun) {
      const rows = await prisma.$queryRawUnsafe<FilaDryRun[]>(`
        SELECT
          COUNT(*)::bigint                    AS afectados,
          MIN("creadoEn")::text               AS mas_antiguo,
          MAX("creadoEn")::text               AS mas_reciente
        FROM "GeminiUsage"
        WHERE usuario IS NOT NULL
          AND "creadoEn" < NOW() - INTERVAL '${MIN_DIAS_EMAIL} days'
      `);

      const row = rows[0];
      return NextResponse.json({
        ok: true,
        dryRun: true,
        afectados:            Number(row?.afectados ?? 0),
        umbralDias:           MIN_DIAS_EMAIL,
        masAntiguoAfectado:   row?.mas_antiguo  ?? null,
        masRecienteAfectado:  row?.mas_reciente ?? null,
      });
    }

    // ── Ejecución real ────────────────────────────────────────────────────────
    // Solo nulifica el campo `usuario` (email legacy).
    // Nunca toca: id, modelo, endpoint, tokensIn, tokensOut, costUsd, usuarioId, perfil, creadoEn.
    const afectados = await prisma.$executeRawUnsafe(`
      UPDATE "GeminiUsage"
      SET usuario = NULL
      WHERE usuario IS NOT NULL
        AND "creadoEn" < NOW() - INTERVAL '${MIN_DIAS_EMAIL} days'
    `);

    void auditFromRequest(req, session!, {
      accion:    'gemini_limpieza_pii',
      recurso:   'admin/gemini/limpiar-pii',
      detalle: {
        dryRun:     false,
        afectados,
        umbralDias: MIN_DIAS_EMAIL,
      },
    });

    console.log(`[limpiar-pii] Ejecutado: ${afectados} registros GeminiUsage.usuario → NULL`);

    return NextResponse.json({
      ok:         true,
      dryRun:     false,
      afectados,
      umbralDias: MIN_DIAS_EMAIL,
    });
  } catch (err) {
    console.error('[limpiar-pii]', err instanceof Error ? err.message.slice(0, 150) : 'error');
    return NextResponse.json(
      { ok: false, error: 'Error interno al procesar limpieza PII' },
      { status: 500 },
    );
  }
}