import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';
import prisma from '@/lib/prisma';


export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;
  const { id } = await params;
  const docId = parseInt(id);
  if (isNaN(docId)) return NextResponse.json({ ok: false, error: 'ID inválido.' }, { status: 400 });

  try {
    await prisma.ragDocumento.delete({ where: { id: docId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}
