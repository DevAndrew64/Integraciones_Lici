import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdministradorProcesos } from '@/lib/authz';
import prisma from '@/lib/prisma';


export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * DELETE – elimina TODOS los documentos (base + adenda) de un proceso.
 * Úsese antes de re-sincronizar para empezar desde cero.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession(req);
  const denied = requireAdministradorProcesos(session);
  if (denied) return denied;
  try {
    const { id } = await params;
    const dbId = Number(id);
    if (!Number.isInteger(dbId) || dbId <= 0)
      return NextResponse.json({ ok: false, error: 'ID inválido.' }, { status: 400 });

    const { count } = await prisma.procesoDocumentoSecop.deleteMany({
      where: { procesoId: dbId },
    });

    return NextResponse.json({
      ok: true,
      eliminados: count,
      mensaje: `${count} documento(s) eliminados. Ahora puede re-sincronizar el proceso.`,
    });
  } catch (err) {
    console.error('[DELETE /api/procesos/[id]/limpiar-docs]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error' },
      { status: 500 }
    );
  }
}