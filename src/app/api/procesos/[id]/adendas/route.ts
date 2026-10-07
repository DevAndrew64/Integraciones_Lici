import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const dbId = Number(id);

    if (!Number.isInteger(dbId) || dbId <= 0) {
      return NextResponse.json(
        { ok: false, error: 'ID inválido.' },
        { status: 400 }
      );
    }

    const adendas = await prisma.procesoDocumentoSecop.findMany({
      where: {
        procesoId: dbId,
        tipoDocumento: 'adenda',
      },
      orderBy: {
        fechaDetectado: 'desc',
      },
      select: {
        id: true,
        nombre: true,
        urlDocumento: true,
        tipoDocumento: true,
        fechaDetectado: true,
      },
    });

    return NextResponse.json({
      ok: true,
      adendas,
      data: adendas,
    });
  } catch (error) {
    console.error('[GET /api/procesos/[id]/adendas]', error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Error consultando adendas.',
      },
      { status: 500 }
    );
  }
}