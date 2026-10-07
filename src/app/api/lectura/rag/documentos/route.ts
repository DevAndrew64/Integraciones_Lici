import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  try {
    const docs = await prisma.ragDocumento.findMany({
      orderBy: { creadoEn: 'desc' },
      select: { id: true, nombre: true, totalPaginas: true, totalChunks: true, creadoEn: true },
    });
    return NextResponse.json({ ok: true, docs });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}