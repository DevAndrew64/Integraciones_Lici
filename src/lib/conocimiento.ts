import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { generarEmbedding, vecStr, EMBEDDING_MODEL } from '@/lib/embeddings';

export type Conocimiento = {
  id: number;
  empresa: string | null;
  modulo: string | null;
  titulo: string;
  contenido: string;
  tipo: string | null;
  activo: boolean;
  creadoEn: Date;
  actualizadoEn: Date;
  embeddingModel: string | null;
  embeddingAt: Date | null;
  tieneEmbedding?: boolean;
};

export type CreateConocimientoInput = {
  empresa?: string | null;
  modulo?: string | null;
  titulo: string;
  contenido: string;
  tipo?: string | null;
  activo?: boolean;
};

// ── Stopwords + keywords ───────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'de','la','el','los','las','en','con','que','por','para','se','es','un','una',
  'y','a','del','al','no','su','sus','lo','me','te','le','nos','o','si','como',
  'más','pero','hay','este','esta','estos','estas','son','fue','ser','tiene',
  'cuál','cuáles','cuanto','cuánto','dime','cual','qué','quien','quién',
  'the','and','for','are','not','this','that','with','from',
]);

function quitarAcentos(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function extraerKeywords(texto: string): string[] {
  return quitarAcentos(texto)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

// ── CRUD básico ───────────────────────────────────────────────────────────────

export async function crearConocimiento(data: CreateConocimientoInput): Promise<Conocimiento> {
  const item = await prisma.asistenteConocimiento.create({ data });
  return { ...item, embeddingModel: null, embeddingAt: null };
}

export async function actualizarConocimiento(id: number, data: Partial<CreateConocimientoInput>): Promise<Conocimiento> {
  const item = await prisma.asistenteConocimiento.update({ where: { id }, data });
  return { ...item, embeddingModel: item.embeddingModel, embeddingAt: item.embeddingAt };
}

export async function desactivarConocimiento(id: number): Promise<Conocimiento> {
  const item = await prisma.asistenteConocimiento.update({ where: { id }, data: { activo: false } });
  return { ...item, embeddingModel: item.embeddingModel, embeddingAt: item.embeddingAt };
}

export async function eliminarConocimiento(id: number): Promise<void> {
  await prisma.asistenteConocimiento.delete({ where: { id } });
}

export async function listarConocimiento(filtros?: {
  empresa?: string;
  tipo?: string;
  modulo?: string;
  soloActivos?: boolean;
}): Promise<Conocimiento[]> {
  // Include tieneEmbedding via raw query
  const rows = await prisma.$queryRaw<(Conocimiento & { tiene_emb: boolean })[]>(Prisma.sql`
    SELECT id, empresa, modulo, titulo, contenido, tipo, activo,
           "creadoEn", "actualizadoEn", "embeddingModel", "embeddingAt",
           (embedding IS NOT NULL) AS tiene_emb
    FROM   "AsistenteConocimiento"
    WHERE  1=1
      ${filtros?.empresa    ? Prisma.sql`AND empresa    = ${filtros.empresa}`    : Prisma.sql``}
      ${filtros?.tipo       ? Prisma.sql`AND tipo       = ${filtros.tipo}`       : Prisma.sql``}
      ${filtros?.modulo     ? Prisma.sql`AND modulo     = ${filtros.modulo}`     : Prisma.sql``}
      ${filtros?.soloActivos ? Prisma.sql`AND activo = true`                     : Prisma.sql``}
    ORDER BY empresa ASC NULLS LAST, tipo ASC NULLS LAST, titulo ASC
  `);

  return rows.map(r => ({ ...r, tieneEmbedding: r.tiene_emb }));
}

// ── Tipos para búsqueda semántica ─────────────────────────────────────────────

type SemanticRow = {
  id: number;
  titulo: string;
  contenido: string;
  empresa: string | null;
  tipo: string | null;
  modulo: string | null;
  similarity: number;
};

// ── Búsqueda semántica vía pgvector ──────────────────────────────────────────

async function busquedaSemantica(
  queryEmbedding: number[],
  perfil: string | undefined,
  limit: number,
): Promise<SemanticRow[]> {
  const vs = vecStr(queryEmbedding);
  const vr = Prisma.raw(`'${vs}'`);

  const empresaCondition = perfil
    ? Prisma.sql`AND (empresa IS NULL OR empresa = 'GRUPO_COLBA' OR empresa = ${perfil.toUpperCase()})`
    : Prisma.sql`AND (empresa IS NULL OR empresa = 'GRUPO_COLBA')`;

  const rows = await prisma.$queryRaw<SemanticRow[]>(Prisma.sql`
    SELECT id, titulo, contenido, empresa, tipo, modulo,
           (1 - (embedding <=> ${vr}::vector))::float8 AS similarity
    FROM   "AsistenteConocimiento"
    WHERE  activo = true
      AND  embedding IS NOT NULL
      ${empresaCondition}
    ORDER  BY embedding <=> ${vr}::vector
    LIMIT  ${limit}
  `);

  return rows;
}

// ── Búsqueda solo por keywords (fallback) ────────────────────────────────────

async function busquedaPorKeywords(
  pregunta: string,
  perfil: string | undefined,
  limit: number,
): Promise<FragmentoConocimiento[]> {
  const keywords = extraerKeywords(pregunta);
  if (keywords.length === 0) return [];

  const empresaCondition = perfil
    ? Prisma.sql`AND (empresa IS NULL OR empresa = 'GRUPO_COLBA' OR empresa = ${perfil.toUpperCase()})`
    : Prisma.sql`AND (empresa IS NULL OR empresa = 'GRUPO_COLBA')`;

  const candidatos = await prisma.$queryRaw<{ id: number; titulo: string; contenido: string; empresa: string | null; tipo: string | null }[]>(Prisma.sql`
    SELECT id, titulo, contenido, empresa, tipo
    FROM   "AsistenteConocimiento"
    WHERE  activo = true
      ${empresaCondition}
    LIMIT  80
  `);

  const scored = candidatos
    .map(c => {
      const hay = quitarAcentos(`${c.titulo} ${c.contenido}`).toLowerCase();
      const score = keywords.reduce(
        (acc, k) => acc + (hay.includes(k) ? (c.titulo.toLowerCase().includes(k) ? 3 : 1) : 0),
        0,
      );
      return { ...c, score };
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ titulo, contenido, empresa, tipo }) => ({
    titulo,
    contenido: contenido.length > 600 ? contenido.slice(0, 600) + '…' : contenido,
    empresa,
    tipo,
  }));
}

// ── Búsqueda híbrida principal ────────────────────────────────────────────────

export type FragmentoConocimiento = {
  titulo: string;
  contenido: string;
  empresa: string | null;
  tipo: string | null;
};

export async function buscarConocimientoRelevante(
  pregunta: string,
  perfil?: string,
  maxResultados = 8,
): Promise<FragmentoConocimiento[]> {
  // Intentar búsqueda semántica + híbrida
  try {
    const queryEmbedding = await generarEmbedding(pregunta);
    const semanticRows   = await busquedaSemantica(queryEmbedding, perfil, maxResultados * 3);

    if (semanticRows.length > 0) {
      const keywords = extraerKeywords(pregunta);
      const hybrid = semanticRows
        .map(r => {
          const hay    = quitarAcentos(`${r.titulo} ${r.contenido}`).toLowerCase();
          const maxKw  = Math.max(keywords.length, 1);
          const kwHits = keywords.reduce(
            (acc, k) => acc + (hay.includes(k) ? (r.titulo.toLowerCase().includes(k) ? 3 : 1) : 0),
            0,
          );
          const kwScore    = Math.min(kwHits / (maxKw * 3), 1);
          const finalScore = r.similarity * 0.7 + kwScore * 0.3;
          return { ...r, finalScore };
        })
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, maxResultados);

      console.log(`[conocimiento] modo=hybrid fragmentos=${hybrid.length} modelo=${EMBEDDING_MODEL}`);
      return hybrid.map(({ titulo, contenido, empresa, tipo }) => ({
        titulo,
        contenido: contenido.length > 600 ? contenido.slice(0, 600) + '…' : contenido,
        empresa,
        tipo,
      }));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[conocimiento] Embedding falló (${msg.slice(0, 100)}), usando keyword fallback`);
  }

  // Fallback: búsqueda por keywords
  const fallback = await busquedaPorKeywords(pregunta, perfil, maxResultados);
  console.log(`[conocimiento] modo=keyword_fallback fragmentos=${fallback.length}`);
  return fallback;
}

// ── Formatear como contexto para el system prompt ─────────────────────────────

export function formatearConocimientoParaPrompt(fragmentos: FragmentoConocimiento[]): string {
  if (fragmentos.length === 0) return '';
  return fragmentos
    .map(f => `[${f.empresa ?? 'GENERAL'}${f.tipo ? ` · ${f.tipo}` : ''}] ${f.titulo}\n${f.contenido}`)
    .join('\n\n');
}