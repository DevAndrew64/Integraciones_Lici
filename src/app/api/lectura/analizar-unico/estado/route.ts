import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { isAdmin, resolveSessionUserId } from '@/lib/authz';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 20 * 60 * 1000; // 20 minutos — pliegos grandes (100+ páginas) con el prompt experto ampliado pueden tardar más

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ estado: 'NO_AUTORIZADO' }, { status: 401 });

  const usuarioId = await resolveSessionUserId(session);
  if (usuarioId === null) {
    return NextResponse.json({ ok: false, error: 'Sesión inválida. Inicie sesión nuevamente.' }, { status: 401 });
  }

  const idParam = req.nextUrl.searchParams.get('id');
  if (!idParam || isNaN(Number(idParam))) {
    return NextResponse.json({ estado: 'NO_ENCONTRADO' }, { status: 404 });
  }

  const id = Number(idParam);

  try {
    const registro = await prisma.lecturaAnalisis.findUnique({ where: { id } });
    if (!registro) return NextResponse.json({ estado: 'NO_ENCONTRADO' }, { status: 404 });

    if (!isAdmin(session.rol)) {
      if (registro.usuarioId === null || registro.usuarioId !== usuarioId) {
        return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
      }
    }

    const resultado = registro.resultado as { estado?: string; mensaje?: string } | null;
    const estado = String(resultado?.estado ?? 'COMPLETADO');

    if (estado === 'PROCESANDO') {
      const msElapsed = Date.now() - registro.creadoEn.getTime();
      if (msElapsed > TIMEOUT_MS) {
        return NextResponse.json({ estado: 'ERROR', analisisId: id, error: 'El análisis superó el tiempo límite. Usa "↻ Reanalizar" para intentar de nuevo.' });
      }
      return NextResponse.json({ estado: 'PROCESANDO', analisisId: id });
    }

    if (estado === 'ERROR') {
      return NextResponse.json({ estado: 'ERROR', analisisId: id, error: String(resultado?.mensaje ?? 'Error en el análisis único experto.') });
    }

    return NextResponse.json({
      estado: 'COMPLETADO',
      analisisId: id,
      resultado: registro.resultado,
      tokens: { entrada: registro.tokensEntrada, salida: registro.tokensSalida },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[unico/estado] Error consultando id', id, ':', msg);
    return NextResponse.json({ estado: 'ERROR', error: 'Error consultando estado del análisis.' }, { status: 500 });
  }
}