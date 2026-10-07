import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';
import { auditFromRequest } from '@/lib/audit';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Umbrales mínimos irrevocables (días)
const MIN_DIAS_BLOB_CON_URL = 30;
const MIN_DIAS_BLOB_TODOS   = 90;
const MIN_DIAS_DELETE        = 180;

// Modos que NUNCA se pueden eliminar completamente
const MODOS_PROTEGIDOS = ['profundo', 'completo', 'proceso_completo', 'basico'];

type Conteos = {
  blobs_30d_con_url: number;
  blobs_90d_todos:   number;
  colba_qa_180d:     number;
  errores_180d:      number;
};

type FilaCount = { count: bigint };
type FilaSize  = { bytes: bigint };

async function contarAfectados(): Promise<{ conteos: Conteos; bytesBlob: bigint }> {
  const [r1, r2, r3, r4, rSize] = await Promise.all([
    // blobs con URL, >30 días
    prisma.$queryRawUnsafe<FilaCount[]>(`
      SELECT COUNT(*) AS count FROM "LecturaAnalisis"
      WHERE "pdfBlob" IS NOT NULL AND length("pdfBlob") > 0
        AND "urlDocumento" IS NOT NULL
        AND "creadoEn" < NOW() - INTERVAL '${MIN_DIAS_BLOB_CON_URL} days'
    `),
    // blobs de cualquier tipo, >90 días
    prisma.$queryRawUnsafe<FilaCount[]>(`
      SELECT COUNT(*) AS count FROM "LecturaAnalisis"
      WHERE "pdfBlob" IS NOT NULL AND length("pdfBlob") > 0
        AND "creadoEn" < NOW() - INTERVAL '${MIN_DIAS_BLOB_TODOS} days'
    `),
    // modo colba-qa, >180 días
    prisma.$queryRawUnsafe<FilaCount[]>(`
      SELECT COUNT(*) AS count FROM "LecturaAnalisis"
      WHERE modo = 'colba-qa'
        AND "creadoEn" < NOW() - INTERVAL '${MIN_DIAS_DELETE} days'
    `),
    // estado ERROR, >180 días (excluye modos protegidos)
    prisma.$queryRawUnsafe<FilaCount[]>(`
      SELECT COUNT(*) AS count FROM "LecturaAnalisis"
      WHERE (resultado->>'estado') = 'ERROR'
        AND modo NOT IN (${MODOS_PROTEGIDOS.map(m => `'${m}'`).join(',')})
        AND "creadoEn" < NOW() - INTERVAL '${MIN_DIAS_DELETE} days'
    `),
    // bytes totales recuperables (unión de blob_30d + blob_90d, sin duplicar)
    prisma.$queryRawUnsafe<FilaSize[]>(`
      SELECT COALESCE(SUM(octet_length("pdfBlob")), 0) AS bytes FROM "LecturaAnalisis"
      WHERE "pdfBlob" IS NOT NULL AND length("pdfBlob") > 0
        AND (
          ("urlDocumento" IS NOT NULL AND "creadoEn" < NOW() - INTERVAL '${MIN_DIAS_BLOB_CON_URL} days')
          OR "creadoEn" < NOW() - INTERVAL '${MIN_DIAS_BLOB_TODOS} days'
        )
    `),
  ]);

  return {
    conteos: {
      blobs_30d_con_url: Number(r1[0].count),
      blobs_90d_todos:   Number(r2[0].count),
      colba_qa_180d:     Number(r3[0].count),
      errores_180d:      Number(r4[0].count),
    },
    bytesBlob: BigInt(rSize[0].bytes),
  };
}

function formatBytes(bytes: bigint): string {
  const n = Number(bytes);
  if (n < 1024)       return `${n} bytes`;
  if (n < 1048576)    return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;

  let body: {
    dryRun?: unknown;
    limpiarBlobs30dConUrl?: unknown;
    limpiarBlobsTodos90d?: unknown;
    eliminarColbaQa180d?: unknown;
    eliminarErrores180d?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON inválido' }, { status: 400 });
  }

  // dryRun por defecto si no se especifica
  const dryRun              = body.dryRun              !== false;
  const limpiarBlobs30dConUrl = body.limpiarBlobs30dConUrl === true;
  const limpiarBlobsTodos90d  = body.limpiarBlobsTodos90d  === true;
  const eliminarColbaQa180d   = body.eliminarColbaQa180d   === true;
  const eliminarErrores180d   = body.eliminarErrores180d   === true;

  try {
    // Siempre se cuentan los afectados (para dryRun y para el informe del real)
    const { conteos, bytesBlob } = await contarAfectados();
    const espacioRecuperable = formatBytes(bytesBlob);

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        afectados: conteos,
        espacioRecuperable,
      });
    }

    // ── Ejecución real ────────────────────────────────────────────────────────
    const ejecutados: Conteos = { blobs_30d_con_url: 0, blobs_90d_todos: 0, colba_qa_180d: 0, errores_180d: 0 };

    if (limpiarBlobs30dConUrl) {
      const res = await prisma.$executeRawUnsafe(`
        UPDATE "LecturaAnalisis"
        SET "pdfBlob" = NULL
        WHERE "pdfBlob" IS NOT NULL AND length("pdfBlob") > 0
          AND "urlDocumento" IS NOT NULL
          AND "creadoEn" < NOW() - INTERVAL '${MIN_DIAS_BLOB_CON_URL} days'
      `);
      ejecutados.blobs_30d_con_url = res;
    }

    if (limpiarBlobsTodos90d) {
      const res = await prisma.$executeRawUnsafe(`
        UPDATE "LecturaAnalisis"
        SET "pdfBlob" = NULL
        WHERE "pdfBlob" IS NOT NULL AND length("pdfBlob") > 0
          AND "creadoEn" < NOW() - INTERVAL '${MIN_DIAS_BLOB_TODOS} days'
      `);
      ejecutados.blobs_90d_todos = res;
    }

    if (eliminarColbaQa180d) {
      const res = await prisma.$executeRawUnsafe(`
        DELETE FROM "LecturaAnalisis"
        WHERE modo = 'colba-qa'
          AND "creadoEn" < NOW() - INTERVAL '${MIN_DIAS_DELETE} days'
      `);
      ejecutados.colba_qa_180d = res;
    }

    if (eliminarErrores180d) {
      const res = await prisma.$executeRawUnsafe(`
        DELETE FROM "LecturaAnalisis"
        WHERE (resultado->>'estado') = 'ERROR'
          AND modo NOT IN (${MODOS_PROTEGIDOS.map(m => `'${m}'`).join(',')})
          AND "creadoEn" < NOW() - INTERVAL '${MIN_DIAS_DELETE} days'
      `);
      ejecutados.errores_180d = res;
    }

    void auditFromRequest(req, session!, {
      accion: 'lectura_limpieza_blobs',
      recurso: 'admin/lectura/limpiar-blobs',
      detalle: {
        dryRun: false,
        opciones: { limpiarBlobs30dConUrl, limpiarBlobsTodos90d, eliminarColbaQa180d, eliminarErrores180d },
        afectadosPrevisto: conteos,
        ejecutados,
        espacioRecuperable,
      },
    });

    return NextResponse.json({
      ok: true,
      dryRun: false,
      afectados: ejecutados,
      espacioRecuperable,
    });
  } catch (err) {
    console.error('[limpiar-blobs]', err instanceof Error ? err.message.slice(0, 150) : 'error');
    return NextResponse.json({ ok: false, error: 'Error interno al procesar limpieza' }, { status: 500 });
  }
}