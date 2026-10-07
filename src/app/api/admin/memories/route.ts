import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { resolveSessionUserId } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get('scope') ?? undefined;
  const empresa = searchParams.get('empresa') ?? undefined;
  const source = searchParams.get('source') ?? undefined;
  const onlyActive = searchParams.get('active') !== 'false';

  const memories = await prisma.assistantMemory.findMany({
    where: {
      ...(onlyActive ? { isActive: true } : {}),
      ...(scope ? { scope } : {}),
      ...(empresa ? { empresa: empresa.toUpperCase() } : {}),
      ...(source ? { source } : {}),
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });

  return NextResponse.json({ ok: true, memories });
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });

  const usuarioId = await resolveSessionUserId(session);
  if (usuarioId === null) return NextResponse.json({ ok: false, error: 'Sesión inválida.' }, { status: 401 });

  let body: {
    key?: string; scope?: string; empresa?: string | null;
    title?: string; content?: string; priority?: number; source?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 }); }

  const { key, scope = 'GLOBAL', empresa = null, title, content, priority = 50, source = 'manual' } = body;
  if (!key?.trim() || !title?.trim() || !content?.trim()) {
    return NextResponse.json({ ok: false, error: 'key, title y content son requeridos.' }, { status: 400 });
  }

  const memory = await prisma.assistantMemory.create({
    data: {
      key: key.trim().toLowerCase().replace(/\s+/g, '-'),
      scope: scope.toUpperCase(),
      empresa: empresa ? empresa.toUpperCase() : null,
      title: title.trim(),
      content: content.trim(),
      priority,
      source,
      isActive: true,
      createdBy: String(usuarioId),
    },
  });

  return NextResponse.json({ ok: true, memory }, { status: 201 });
}