import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';
import { crearConocimiento, listarConocimiento } from '@/lib/conocimiento';
import { regenerarEmbeddingConocimiento, regenerarTodosLosEmbeddings, normalizarTextoParaEmbedding } from '@/lib/embeddings';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);

  // Acción especial: regenerar todos los embeddings
  if (searchParams.get('accion') === 'regenerar-todos') {
    const soloSinEmbedding = searchParams.get('soloVacios') !== 'false';
    const result = await regenerarTodosLosEmbeddings(soloSinEmbedding);
    return NextResponse.json({ ok: true, regenerados: result.ok, errores: result.error });
  }

  const empresa    = searchParams.get('empresa')  ?? undefined;
  const tipo       = searchParams.get('tipo')     ?? undefined;
  const modulo     = searchParams.get('modulo')   ?? undefined;
  const soloActivos = searchParams.get('activos') !== 'false';

  const items = await listarConocimiento({ empresa, tipo, modulo, soloActivos });
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const dp = requireAdmin(session);
  if (dp) return dp;

  let body: { empresa?: string; modulo?: string; titulo?: string; contenido?: string; tipo?: string; activo?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 }); }

  const { titulo, contenido, empresa, modulo, tipo, activo } = body;
  if (!titulo?.trim() || !contenido?.trim()) {
    return NextResponse.json({ ok: false, error: 'titulo y contenido son obligatorios.' }, { status: 400 });
  }

  const item = await crearConocimiento({
    titulo: titulo.trim(), contenido: contenido.trim(),
    empresa: empresa ?? null, modulo: modulo ?? null, tipo: tipo ?? null, activo: activo ?? true,
  });

  // Generar embedding en background (no bloquear la respuesta)
  regenerarEmbeddingConocimiento(item.id).catch(err =>
    console.error(`[conocimiento] Error generando embedding para #${item.id}:`, err)
  );

  return NextResponse.json({ ok: true, item }, { status: 201 });
}