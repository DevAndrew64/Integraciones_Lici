import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, requireAdmin } from '@/lib/authz';
import prisma from '@/lib/prisma';


export const dynamic = 'force-dynamic';

/** Extrae el DocumentId numérico de una URL de SECOP, o null si no aplica. */
function parseDocumentId(url: string | null | undefined): number | null {
  if (!url) return null;
  const m = url.match(/[?&]DocumentId=(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

type Params = { params: Promise<{ id: string }> };

/** GET – lista todos los documentos del proceso con su DocumentId parseado */
export async function GET(req: NextRequest, { params }: Params) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  try {
    const { id } = await params;
    const dbId = Number(id);
    if (!Number.isInteger(dbId) || dbId <= 0)
      return NextResponse.json({ ok: false, error: 'ID inválido.' }, { status: 400 });

    const docs = await prisma.procesoDocumentoSecop.findMany({
      where: { procesoId: dbId },
      orderBy: { fechaDetectado: 'asc' },
      select: { id: true, nombre: true, urlDocumento: true, tipoDocumento: true, fechaDetectado: true },
    });

    const result = docs.map(d => ({
      ...d,
      documentId: parseDocumentId(d.urlDocumento),
      fechaDetectado: d.fechaDetectado?.toISOString() ?? null,
    }));

    const base = result.filter(d => d.tipoDocumento === 'base' || !d.tipoDocumento);
    const adendas = result.filter(d => d.tipoDocumento === 'adenda');
    const baseIds = base.map(d => d.documentId).filter((x): x is number => x !== null);
    const adendaIds = adendas.map(d => d.documentId).filter((x): x is number => x !== null);

    return NextResponse.json({
      ok: true,
      total: docs.length,
      base: base.length,
      adendas: adendas.length,
      rangoBase: baseIds.length ? { min: Math.min(...baseIds), max: Math.max(...baseIds) } : null,
      rangoAdendas: adendaIds.length ? { min: Math.min(...adendaIds), max: Math.max(...adendaIds) } : null,
      documentos: result,
    });
  } catch (err) {
    console.error('[GET /api/procesos/[id]/reclasificar-docs]', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

/**
 * POST – reclasifica adendas como 'base'
 *
 * Body (JSON):
 *   { reclasificarTodo: true }            → todas las adendas pasan a 'base'
 *   { maxDocumentId: 803719389 }          → solo las adendas con DocumentId <= maxDocumentId
 *   { ids: [1, 2, 3] }                    → solo las adendas con esos ids de BD
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const dbId = Number(id);
    if (!Number.isInteger(dbId) || dbId <= 0)
      return NextResponse.json({ ok: false, error: 'ID inválido.' }, { status: 400 });

    const body = await req.json().catch(() => ({})) as {
      reclasificarTodo?: boolean;
      maxDocumentId?: number;
      ids?: number[];
    };

    const adendas = await prisma.procesoDocumentoSecop.findMany({
      where: { procesoId: dbId, tipoDocumento: 'adenda' },
      select: { id: true, urlDocumento: true },
    });

    if (!adendas.length)
      return NextResponse.json({ ok: true, reclasificados: 0, mensaje: 'No hay adendas para reclasificar.' });

    let aReclasificar: number[] = [];

    if (body.reclasificarTodo) {
      aReclasificar = adendas.map(d => d.id);
    } else if (typeof body.maxDocumentId === 'number') {
      aReclasificar = adendas
        .filter(d => {
          const docId = parseDocumentId(d.urlDocumento);
          return docId !== null && docId <= body.maxDocumentId!;
        })
        .map(d => d.id);
    } else if (Array.isArray(body.ids) && body.ids.length) {
      const setIds = new Set(body.ids);
      aReclasificar = adendas.filter(d => setIds.has(d.id)).map(d => d.id);
    } else {
      return NextResponse.json(
        { ok: false, error: 'Debe indicar reclasificarTodo, maxDocumentId o ids.' },
        { status: 400 }
      );
    }

    if (!aReclasificar.length)
      return NextResponse.json({ ok: true, reclasificados: 0, mensaje: 'Ninguna adenda cumple el criterio.' });

    const { count } = await prisma.procesoDocumentoSecop.updateMany({
      where: { id: { in: aReclasificar }, procesoId: dbId },
      data: { tipoDocumento: 'base' },
    });

    return NextResponse.json({
      ok: true,
      reclasificados: count,
      mensaje: `${count} documento(s) reclasificados de 'adenda' a 'base'.`,
    });
  } catch (err) {
    console.error('[POST /api/procesos/[id]/reclasificar-docs]', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}