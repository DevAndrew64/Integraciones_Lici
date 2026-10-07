import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const codigoProceso = searchParams.get('codigoProceso')?.trim();

  if (!codigoProceso) {
    return NextResponse.json({ ok: false, error: 'codigoProceso requerido' }, { status: 400 });
  }

  const proceso = await prisma.proceso.findFirst({
    where: { codigoProceso },
    select: {
      id: true,
      codigoProceso: true,
      nombre: true,
      aliasFuente: true,
      totalCronogramas: true,
      totalDocumentos: true,
      lastSyncedAt: true,
      rawJson: true,
      cronogramasSecop: {
        select: { evento: true, valorTexto: true, orden: true },
        orderBy: { orden: 'asc' },
      },
    },
  });

  if (!proceso) {
    return NextResponse.json({ ok: false, error: `Proceso ${codigoProceso} no encontrado` }, { status: 404 });
  }

  let rawParsed: unknown = null;
  try {
    rawParsed = proceso.rawJson
      ? (typeof proceso.rawJson === 'string' ? JSON.parse(proceso.rawJson) : proceso.rawJson)
      : null;
  } catch {
    rawParsed = proceso.rawJson;
  }

  // Detectar qué campos array existen en el raw para diagnóstico
  const camposArray: string[] = [];
  if (rawParsed && typeof rawParsed === 'object') {
    for (const [k, v] of Object.entries(rawParsed as Record<string, unknown>)) {
      if (Array.isArray(v)) camposArray.push(`${k}[${(v as unknown[]).length}]`);
    }
  }

  return NextResponse.json({
    ok: true,
    id: proceso.id,
    codigoProceso: proceso.codigoProceso,
    aliasFuente: proceso.aliasFuente,
    totalCronogramasDB: proceso.totalCronogramas,
    cronogramasEnBD: proceso.cronogramasSecop,
    lastSyncedAt: proceso.lastSyncedAt,
    camposArrayEnRaw: camposArray,
    raw: rawParsed,
  });
}