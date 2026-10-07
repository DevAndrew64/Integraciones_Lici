import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { resolveSessionUserId } from '@/lib/authz';
import { checkGeminiRateLimitPg, recordGeminiUsagePg } from '@/lib/rate-limit';
import { registrarUso } from '@/lib/gemini-usage';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

// ── Helpers de texto ──────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'de','la','el','los','las','en','con','que','por','para','se','es','un','una',
  'y','a','del','al','no','su','sus','lo','me','te','le','nos','o','si','como',
  'más','pero','hay','este','esta','estos','estas','son','fue','ser','tiene',
  'puedes','puede','favor','cuál','cuáles','cuanto','cuánto','dime','cual',
  'the','and','for','are','not','this','that','with','from',
]);

function quitarAcentos(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function extractKeywords(text: string): string[] {
  return quitarAcentos(text)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w));
}

// ── Búsqueda de chunks ────────────────────────────────────────────────────────

async function buscarChunks(termino: string, docIds: number[]): Promise<{ texto: string; fuentes: string[] }> {
  const keywords = extractKeywords(termino);
  if (keywords.length === 0) return { texto: '(Sin palabras clave en el término)', fuentes: [] };

  const whereDoc = docIds.length ? { documentoId: { in: docIds } } : {};
  const candidatos = await prisma.ragChunk.findMany({
    where: {
      ...whereDoc,
      OR: keywords.map(k => ({ texto: { contains: k, mode: 'insensitive' as const } })),
    },
    include: { documento: { select: { nombre: true } } },
    take: 120,
  });

  if (candidatos.length === 0) {
    return { texto: `(No se encontraron fragmentos para: "${termino}")`, fuentes: [] };
  }

  const scored = candidatos
    .map(c => {
      const lower = quitarAcentos(c.texto).toLowerCase();
      const score = keywords.reduce((a, k) => a + (lower.includes(k) ? 1 : 0), 0);
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const fuentes = [...new Set(scored.map(c => c.documento.nombre))];
  const texto = scored
    .map((c, i) => `[${i + 1}] ${c.documento.nombre}\n${c.texto.slice(0, 1_200)}`)
    .join('\n\n---\n\n');

  return { texto, fuentes };
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM = `Eres Colba, asistente virtual de Licycolba especializado en contratación pública colombiana. Tienes amplio conocimiento en pliegos de condiciones, procesos SECOP, normatividad colombiana de contratación (Ley 80/93, Ley 1150/07, Decreto 1082/15) y buenas prácticas para oferentes.

PERSONALIDAD:
- Habla de forma natural, cercana y profesional — como un colega experto, no como un robot
- Usa un tono cálido pero preciso
- Puedes usar frases cortas, hacer preguntas de aclaración si algo es ambiguo
- Cuando algo no está claro en el pliego, lo dices con naturalidad

INSTRUCCIONES:
- Responde usando el fragmento del pliego cuando se provea
- Para preguntas generales de contratación que puedes responder con tu conocimiento, responde directamente
- Para saludos o charla general, responde naturalmente
- Responde siempre en español. Usa markdown cuando mejore la claridad
- Si algo no está en el pliego di: "En el pliego cargado no encontré esa información, pero puedo decirte que en general..."
- Mantén las respuestas enfocadas y útiles, máximo 3-4 párrafos salvo que se pida más detalle`;

// ── Handler ───────────────────────────────────────────────────────────────────

type MensajeHistorial = { rol: 'user' | 'assistant'; texto: string };

export async function POST(req: NextRequest) {
  // ── Autenticación ──────────────────────────────────────────────────────────
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: 'Servicio de IA no disponible.' }, { status: 503 });

  let body: { pregunta?: string; docIds?: number[]; historial?: MensajeHistorial[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 }); }

  const { pregunta, docIds = [], historial = [] } = body;
  if (!pregunta?.trim()) return NextResponse.json({ ok: false, error: 'Se requiere pregunta.' }, { status: 400 });

  const usuarioId = await resolveSessionUserId(session);
  if (usuarioId === null) return NextResponse.json({ ok: false, error: 'Sesión inválida. Inicie sesión nuevamente.' }, { status: 401 });

  // Rate limit por usuario (Postgres persistente)
  const rlR = await checkGeminiRateLimitPg(usuarioId, 'rag');
  if (rlR.bloqueado) {
    return NextResponse.json({ ok: false, error: `Límite diario de preguntas alcanzado (${rlR.usos}/${rlR.limite}). Intente mañana.` }, { status: 429 });
  }

  try {
    // Buscar chunks relevantes
    const { texto: contexto, fuentes } = await buscarChunks(pregunta, docIds);

    const msgFinal = contexto && !contexto.startsWith('(')
      ? `Fragmentos del pliego:\n\n${contexto}\n\n---\nPregunta: ${pregunta}`
      : pregunta;

    const histGemini = historial.slice(-6).map(m => ({
      role: m.rol === 'user' ? 'user' : 'model',
      parts: [{ text: m.texto }],
    })).filter((h, i, arr) => i === 0 ? h.role === 'user' : arr[i - 1].role !== h.role);

    const genAI = new GoogleGenerativeAI(apiKey);
    const gemini = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: SYSTEM,
      generationConfig: { maxOutputTokens: 2048, temperature: 0.4 },
    });
    const chat = gemini.startChat({ history: histGemini });
    const result = await chat.sendMessage(msgFinal);
    const meta = result.response.usageMetadata;
    void registrarUso({
      modelo: 'gemini-2.5-flash',
      endpoint: 'lectura/rag',
      tokensIn: meta?.promptTokenCount ?? 0,
      tokensOut: meta?.candidatesTokenCount ?? 0,
      usuario: session.email,
      usuarioId,
    });
    const respuesta = result.response.text().trim() || 'No encontré información suficiente en el pliego para responder.';

    void recordGeminiUsagePg(usuarioId, 'rag');
        return NextResponse.json({ ok: true, respuesta, fuentes: [...new Set(fuentes)] });
  } catch (err) {
    console.error('[POST /api/lectura/rag/preguntar]', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 });
  }
}