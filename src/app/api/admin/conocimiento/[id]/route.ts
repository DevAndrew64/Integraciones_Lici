import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';
import { actualizarConocimiento, eliminarConocimiento } from '@/lib/conocimiento';
import { regenerarEmbeddingConocimiento } from '@/lib/embeddings';

export const dynamic = 'force-dynamic';

const CAMPOS_QUE_INVALIDAN_EMBEDDING = new Set(['titulo', 'contenido', 'empresa', 'modulo', 'tipo']);

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ ok: false, error: 'ID inválido.' }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 }); }

  const item = await actualizarConocimiento(id, body as Parameters<typeof actualizarConocimiento>[1]);

  // Si cambió título, contenido, empresa, módulo o tipo → regenerar embedding
  const debeRegenerarEmb = Object.keys(body).some(k => CAMPOS_QUE_INVALIDAN_EMBEDDING.has(k));
  if (debeRegenerarEmb) {
    regenerarEmbeddingConocimiento(id).catch(err =>
      console.error(`[conocimiento] Error regenerando embedding para #${id}:`, err)
    );
  }

  return NextResponse.json({ ok: true, item });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const deniedD = requireAdmin(session);
  if (deniedD) return deniedD;

  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) return NextResponse.json({ ok: false, error: 'ID inválido.' }, { status: 400 });

  await eliminarConocimiento(id);
  return NextResponse.json({ ok: true });
}