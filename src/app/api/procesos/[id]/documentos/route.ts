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

    const documentos = await prisma.procesoDocumentoSecop.findMany({
      where: {
        procesoId: dbId,
        OR: [
          { tipoDocumento: null },
          { tipoDocumento: '' },
          { tipoDocumento: 'base' },
        ],
      },
      orderBy: {
        fechaDetectado: 'asc',
      },
      select: {
        id: true,
        nombre: true,
        urlDocumento: true,
        extension: true,
        tipoDocumento: true,
        fechaDetectado: true,
      },
    });

    return NextResponse.json({
      ok: true,
      documentos,
    });
  } catch (error) {
    console.error('[GET /api/procesos/[id]/documentos]', error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Error consultando documentos.',
      },
      { status: 500 }
    );
  }
}