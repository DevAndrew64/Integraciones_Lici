import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ ok: false, error: 'ID inválido.' }, { status: 400 });

  let body: {
    title?: string; content?: string; priority?: number;
    isActive?: boolean; scope?: string; empresa?: string | null; source?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 }); }

  const memory = await prisma.assistantMemory.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title.trim() } : {}),
      ...(body.content !== undefined ? { content: body.content.trim() } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.scope !== undefined ? { scope: body.scope.toUpperCase() } : {}),
      ...(body.empresa !== undefined ? { empresa: body.empresa ? body.empresa.toUpperCase() : null } : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
    },
  });

  return NextResponse.json({ ok: true, memory });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ ok: false, error: 'ID inválido.' }, { status: 400 });

  await prisma.assistantMemory.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}