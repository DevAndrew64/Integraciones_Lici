import { NextRequest, NextResponse } from 'next/server';
import { obtenerEstadisticas } from '@/lib/colba-stats';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  try {
    const stats = await obtenerEstadisticas();
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}