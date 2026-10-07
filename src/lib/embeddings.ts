import { GoogleGenerativeAI } from '@google/generative-ai';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

export const EMBEDDING_MODEL = 'gemini-embedding-001';
export const EMBEDDING_DIMS  = 3072;

// ── Generar embedding ─────────────────────────────────────────────────────────

export async function generarEmbedding(texto: string): Promise<number[]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY no configurada');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model  = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent(texto.slice(0, 8_000)); // límite seguro
  const values = result.embedding?.values;
  if (!values || values.length !== EMBEDDING_DIMS) {
    throw new Error(`Embedding inválido: ${values?.length} dims (esperaba ${EMBEDDING_DIMS})`);
  }
  return values;
}

// ── Cosine similarity (fallback en Node.js) ───────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Texto normalizado para embedding ─────────────────────────────────────────

export function normalizarTextoParaEmbedding(item: {
  titulo: string;
  contenido: string;
  empresa?: string | null;
  tipo?: string | null;
  modulo?: string | null;
}): string {
  const parts: string[] = [];
  if (item.empresa) parts.push(item.empresa);
  if (item.tipo)    parts.push(item.tipo);
  if (item.modulo)  parts.push(item.modulo);
  parts.push(item.titulo);
  parts.push(item.contenido);
  return parts.join('. ');
}

// ── Formatear vector para pgvector ────────────────────────────────────────────

export function vecStr(v: number[]): string {
  return `[${v.join(',')}]`;
}

// ── Guardar embedding en BD via $executeRaw ───────────────────────────────────

export async function guardarEmbedding(id: number, embedding: number[]): Promise<void> {
  const vs = vecStr(embedding);
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "AsistenteConocimiento"
    SET    embedding       = ${Prisma.raw(`'${vs}'`)}::vector,
           "embeddingModel" = ${EMBEDDING_MODEL},
           "embeddingAt"    = NOW()
    WHERE  id = ${id}
  `);
}

// ── Regenerar embedding de un fragmento ──────────────────────────────────────

export async function regenerarEmbeddingConocimiento(id: number): Promise<void> {
  const item = await prisma.asistenteConocimiento.findUnique({
    where: { id },
    select: { titulo: true, contenido: true, empresa: true, tipo: true, modulo: true },
  });
  if (!item) throw new Error(`Fragmento #${id} no encontrado`);
  const texto = normalizarTextoParaEmbedding(item);
  const emb   = await generarEmbedding(texto);
  await guardarEmbedding(id, emb);
}

// ── Regenerar todos los embeddings ───────────────────────────────────────────

export async function regenerarTodosLosEmbeddings(soloSinEmbedding = false): Promise<{ ok: number; error: number }> {
  const items = await prisma.$queryRaw<{ id: number; titulo: string; contenido: string; empresa: string | null; tipo: string | null; modulo: string | null; tiene_emb: boolean }[]>(
    Prisma.sql`
      SELECT id, titulo, contenido, empresa, tipo, modulo,
             (embedding IS NOT NULL) AS tiene_emb
      FROM   "AsistenteConocimiento"
      WHERE  activo = true
      ORDER  BY id
    `
  );

  const pendientes = soloSinEmbedding ? items.filter(i => !i.tiene_emb) : items;
  let ok = 0, error = 0;

  for (const item of pendientes) {
    try {
      const texto = normalizarTextoParaEmbedding(item);
      const emb   = await generarEmbedding(texto);
      await guardarEmbedding(item.id, emb);
      ok++;
    } catch (err) {
      console.error(`[embeddings] Error en #${item.id}:`, err instanceof Error ? err.message : err);
      error++;
    }
    // Pequeño delay para no superar rate limits de Gemini
    await new Promise(r => setTimeout(r, 150));
  }

  return { ok, error };
}