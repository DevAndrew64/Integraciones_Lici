import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { GoogleSearchRetrievalTool } from '@google/generative-ai';
import { GEMINI_MODELS, clasificarErrorGemini, GEMINI_USER_ERROR } from '@/lib/gemini-models';
import { necesitaBusquedaWeb, clasificarFuente, type WebSource } from '@/lib/asistente-colba/detectarIntentWeb';
import { detectResponseDepth, MAX_TOKENS, TEMPERATURE } from '@/lib/asistente-colba/responseDepth';
import { buildSystemPromptRAG, buildSystemPromptGeneral } from '@/lib/asistente-colba/systemPrompt';
import { detectarInconsistenciaEmpresa } from '@/lib/asistente-colba/empresaContext';
import prisma from '@/lib/prisma';
import { registrarUso } from '@/lib/gemini-usage';
import { getSession } from '@/lib/session';
import { resolveSessionUserId } from '@/lib/authz';
import { checkGeminiRateLimitPg, recordGeminiUsagePg } from '@/lib/rate-limit';
import {
  obtenerEstadisticas, formatearEstadisticas,
  requiereDetalleProcesos, buscarProcesosDetallados,
  requiereDetalleDocumentos, buscarDocumentosMaestro,
  requiereDetalleManifestaciones, buscarManifestaciones,
  requiereDetalleNoViables, buscarProcesosNoViables,
} from '@/lib/colba-stats';
import { buscarConocimientoRelevante, formatearConocimientoParaPrompt } from '@/lib/conocimiento';
import { loadActiveMemories, detectSaveMemoryIntent } from '@/lib/asistente-colba/memory';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

// ── Normalizar pregunta para cache ────────────────────────────────────────────

function normalizarQ(q: string): string {
  return q.toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// ── Stopwords y keywords ──────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'de','la','el','los','las','en','con','que','por','para','se','es','un','una',
  'y','a','del','al','no','su','sus','lo','me','te','le','nos','o','si','como',
  'más','pero','hay','este','esta','estos','estas','son','fue','ser','tiene',
  'puedes','puede','favor','cuál','cuáles','cuanto','cuánto','dime','cual',
]);

const SINONIMOS: Record<string, string[]> = {
  duracion:    ['plazo', 'meses', 'dias', 'vigencia', 'ejecucion'],
  plazo:       ['duracion', 'meses', 'dias', 'vigencia', 'ejecucion'],
  presupuesto: ['valor', 'cuantia', 'precio', 'costo', 'pesos'],
  valor:       ['presupuesto', 'cuantia', 'precio', 'costo', 'pesos'],
  multa:       ['penalidad', 'sancion', 'incumplimiento'],
  experiencia: ['contratos', 'ejecutados', 'acreditada'],
  financiero:  ['capital', 'patrimonio', 'liquidez', 'endeudamiento'],
  tecnico:     ['experiencia', 'personal', 'equipos'],
  cronograma:  ['fechas', 'calendario', 'publicacion', 'apertura', 'cierre'],
  objeto:      ['contratar', 'servicio', 'suministro', 'obra'],
  puntaje:     ['calificacion', 'evaluacion', 'ponderacion', 'criterio'],
};

function quitarAcentos(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function extractKeywords(text: string): string[] {
  const base = quitarAcentos(text).toLowerCase()
    .replace(/[^\w\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w));
  const extras = new Set<string>();
  for (const kw of base) (SINONIMOS[kw] ?? []).forEach(s => extras.add(s));
  return [...new Set([...base, ...extras])];
}

// ── Selección inteligente de chunks (minimiza tokens) ─────────────────────────

async function buscarChunks(termino: string, docIds: number[]): Promise<{ texto: string; fuentes: string[] }> {
  if (docIds.length === 0) return { texto: '', fuentes: [] };

  const todos = await prisma.ragChunk.findMany({
    where: { documentoId: { in: docIds } },
    include: { documento: { select: { nombre: true } } },
    orderBy: [{ documentoId: 'asc' }, { indice: 'asc' }],
  });

  if (todos.length === 0) return { texto: '', fuentes: [] };

  const fuentes = [...new Set(todos.map(c => c.documento.nombre.replace(/^\[SOL-\d+\]\s*/, '')))];

  // Doc pequeño: enviar todo sin filtrar
  if (todos.length <= 20) {
    return { texto: todos.map(c => c.texto).join('\n\n'), fuentes };
  }

  // Doc grande: primeros 3 chunks (intro/objeto) + hasta 12 por relevancia
  const primeros = todos.slice(0, 3);
  const resto = todos.slice(3);
  const keywords = extractKeywords(termino);

  const relevantes = resto
    .map(c => {
      const lower = quitarAcentos(c.texto).toLowerCase();
      const score = keywords.reduce((a, k) => a + (lower.includes(k) ? 2 : 0) + (lower.includes(k.slice(0, 4)) ? 1 : 0), 0);
      return { ...c, score };
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const seleccionados = [...primeros, ...relevantes]
    .filter((c, i, arr) => arr.findIndex(x => x.id === c.id) === i)
    .sort((a, b) => a.indice - b.indice);

  return { texto: seleccionados.map(c => c.texto).join('\n\n'), fuentes };
}

// ── Handler principal ─────────────────────────────────────────────────────────

type Mensaje = { rol: 'user' | 'assistant'; texto: string };

export async function POST(req: NextRequest) {
  // ── Autenticación ──────────────────────────────────────────────────────────
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });

  let body: {
    pregunta?: string;
    solicitudId?: number;
    codigoProceso?: string;
    docIds?: number[];
    historial?: Mensaje[];
    modelo?: string;
    perfil?: string;
    archivos?: {base64:string;mimeType:string;nombre:string}[];
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 }); }

  const { pregunta: preguntaRaw, solicitudId, codigoProceso, docIds = [], historial = [], perfil = 'ASEOCOLBA', archivos = [] } = body;
  if (!preguntaRaw?.trim() && archivos.length === 0) return NextResponse.json({ ok: false, error: 'Se requiere pregunta.' }, { status: 400 });
  const pregunta = preguntaRaw ?? '';

  const usuarioId = await resolveSessionUserId(session);
  if (usuarioId === null) return NextResponse.json({ ok: false, error: 'Sesión inválida. Inicie sesión nuevamente.' }, { status: 401 });

  // Rate limit (Postgres persistente) — el cache no consume cupo
  const qNorm = normalizarQ(pregunta);
  const cacheKey = solicitudId ? `colba-qa:${solicitudId}:${qNorm}` : null;


  // ── Cache (solo sin docIds disponibles) ──────────────────────────────────────
  if (cacheKey && docIds.length === 0) {
    try {
      const cached = await prisma.lecturaAnalisis.findFirst({
        where: { pdfHash: cacheKey, modo: 'colba-qa' },
        select: { resultado: true },
      });
      if (cached?.resultado) {
        const r = cached.resultado as { respuesta?: string; fuentes?: string[] };
        if (r.respuesta) {
          return NextResponse.json({ ok: true, respuesta: r.respuesta, fuentes: r.fuentes ?? [], fromCache: true });
        }
      }
    } catch { /* ignorar */ }
  }

  // ── Rate limit check — solo si no hay cache ──────────────────────────────────
  const rlColba = await checkGeminiRateLimitPg(usuarioId, 'colba');
  if (rlColba.bloqueado) {
    return NextResponse.json({ ok: false, error: `Límite diario del Asistente Colba alcanzado (${rlColba.usos}/${rlColba.limite}). Intente mañana.` }, { status: 429 });
  }

  // ── Preparar contexto y mensaje ───────────────────────────────────────────────
  const necesitaDetalle   = requiereDetalleProcesos(pregunta);
  const necesitaDocs      = requiereDetalleDocumentos(pregunta);
  const necesitaManifest  = requiereDetalleManifestaciones(pregunta);
  const necesitaNoViables = requiereDetalleNoViables(pregunta);
  const sinPliego = docIds.length === 0;
  const usarWeb = sinPliego && necesitaBusquedaWeb(pregunta);
  const depth = detectResponseDepth(pregunta);
  const maxTokens = MAX_TOKENS[depth];
  const temperature = TEMPERATURE[depth];
  const inconsistenciaEmpresa = detectarInconsistenciaEmpresa(pregunta);

  const [{ texto: contexto, fuentes }, empresaEntradas, stats, procesosDetalle, docsDetalle, manifestDetalle, noViablesDetalle, fragmentosConocimiento, memories] = await Promise.all([
    docIds.length > 0 ? buscarChunks(pregunta, docIds) : Promise.resolve({ texto: '', fuentes: [] }),
    prisma.lecturaAnalisis.findMany({
      where: { modo: 'colba-empresa', codigoProceso: perfil.toUpperCase() },
      select: { nombreDocumento: true, resultado: true },
      orderBy: { creadoEn: 'asc' },
    }),
    obtenerEstadisticas().catch(() => null),
    (necesitaDetalle   && sinPliego) ? buscarProcesosDetallados(pregunta).catch(() => '') : Promise.resolve(''),
    (necesitaDocs      && sinPliego) ? buscarDocumentosMaestro(pregunta).catch(() => '')  : Promise.resolve(''),
    (necesitaManifest  && sinPliego) ? buscarManifestaciones(pregunta).catch(() => '')    : Promise.resolve(''),
    (necesitaNoViables && sinPliego) ? buscarProcesosNoViables(pregunta).catch(() => '')  : Promise.resolve(''),
    buscarConocimientoRelevante(pregunta, perfil, 8).catch(() => []),
    loadActiveMemories(perfil).catch(() => []),
  ]);

  const empresaCtx = empresaEntradas
    .map(e => {
      const texto = (e.resultado as { texto?: string })?.texto ?? '';
      return e.nombreDocumento !== 'Sin título' ? `${e.nombreDocumento}: ${texto}` : texto;
    })
    .filter(Boolean)
    .join('\n\n');

  // En modo RAG (con documento) no inyectar estadísticas globales — reducir tokens de entrada
  const statsCtx = (!sinPliego) ? '' : (stats ? formatearEstadisticas(stats) : '');
  const conocimientoCtx = formatearConocimientoParaPrompt(fragmentosConocimiento);
  const systemBase = docIds.length > 0
    ? buildSystemPromptRAG(empresaCtx, depth, memories)
    : buildSystemPromptGeneral(empresaCtx, depth, memories);
  const reglasConocimiento = `REGLAS CRÍTICAS DE CONOCIMIENTO:
- Si la información está en el CONOCIMIENTO INTERNO CARGADO, responde con seguridad y cita los datos.
- Si no está, di: "No tengo información suficiente cargada sobre ese punto."
- Nunca inventes datos legales, financieros, certificaciones, cargos, clientes, fechas ni valores.
- Diferencia claramente ASEOCOLBA, TEMPOCOLBA y VIGICOLBA.
- Para datos actuales de procesos o TRM, usa exclusivamente la información de PostgreSQL que ya tienes en contexto.`;
  const today = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
  const systemWeb = usarWeb
    ? `\nBÚSQUEDA WEB HABILITADA:\nTienes acceso a Google Search en tiempo real. Reglas:\n1. Cita la fuente con su URL completa.\n2. Indica si es fuente oficial colombiana (.gov.co) o secundaria.\n3. Fecha de consulta: ${today}.\n4. Prioriza fuentes oficiales (.gov.co, entidades del Estado colombiano).\n5. Si no encuentras fuente oficial suficiente, responde exactamente: "No encontré una fuente oficial suficiente para confirmarlo" y explica qué buscaste.\n6. No inventes datos ni fechas. Usa solo lo encontrado en la búsqueda.`
    : '';
  const advertenciaEmpresa = inconsistenciaEmpresa
    ? `⚠ ADVERTENCIA AUTOMÁTICA: ${inconsistenciaEmpresa.advertencia}`
    : '';
  const tieneImagenes = archivos.some((a: {mimeType:string}) => a.mimeType.startsWith('image/'));
  const visionBlock = tieneImagenes
    ? `ANÁLISIS VISUAL ACTIVO:
El usuario ha adjuntado una o más imágenes. Analiza cuidadosamente cada imagen adjunta.
Identifica todo el texto visible, tablas, datos, errores, campos, logos, fechas, valores, estados, alertas, gráficos o cualquier elemento relevante.
Si la imagen corresponde a un documento empresarial, contrato, certificado, pantallazo de SECOP I o II, Excel, Power BI, HSEQ, SST, licitación o proceso interno, interpreta su contenido en contexto y entrega una respuesta práctica.
Responde de forma natural: "Veo que en la imagen aparece...", "El error principal parece ser...", "En la tabla se observa...", "El documento muestra...", "No alcanzo a leer con claridad este campo...", "Con base en la imagen, debes revisar...".
Si hay información ilegible o incompleta, indícalo claramente sin inventar datos, nombres, fechas ni valores.
NO guardes automáticamente el contenido de la imagen como memoria permanente, salvo que el usuario lo pida explícitamente.`
    : '';

  const system = [
    systemBase,
    visionBlock || '',
    conocimientoCtx ? `CONOCIMIENTO INTERNO CARGADO:\n${conocimientoCtx}` : '',
    statsCtx, procesosDetalle, docsDetalle, manifestDetalle, noViablesDetalle,
    reglasConocimiento,
    systemWeb,
    advertenciaEmpresa,
  ].filter(Boolean).join('\n\n');
  const msgFinal = docIds.length > 0 && contexto
    ? `Pliego de condiciones:\n\n${contexto}\n\n---\nPregunta: ${pregunta}`
    : (codigoProceso ? `[Proceso: ${codigoProceso}]\n\n${pregunta}` : pregunta);

  const histGemini = historial.slice(-10).map(m => ({
    role: m.rol === 'user' ? 'user' : 'model',
    parts: [{ text: m.texto }],
  })).filter((h, i, arr) => i === 0 ? h.role === 'user' : arr[i - 1].role !== h.role);

  // ── Streaming SSE ─────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      let respuestaCompleta = '';
      let webSources: WebSource[] = [];

      try {
        const googleKey = process.env.GOOGLE_AI_API_KEY;

        // Intentar Gemini primero
        if (googleKey) {
          const genAI = new GoogleGenerativeAI(googleKey);
          for (const modelId of GEMINI_MODELS) {
            try {
              const webTool: GoogleSearchRetrievalTool = { googleSearchRetrieval: {} };
              const gemini = genAI.getGenerativeModel({
                model: modelId,
                systemInstruction: system,
                generationConfig: { maxOutputTokens: maxTokens, temperature },
                ...(usarWeb ? { tools: [webTool] } : {}),
              });
              const chat = gemini.startChat({ history: histGemini });
              type GPart = { text: string } | { inlineData: { data: string; mimeType: string } };
              const gParts: GPart[] = [];
              for (const a of archivos) gParts.push({ inlineData: { data: a.base64, mimeType: a.mimeType } });
              gParts.push({ text: msgFinal });
              const result = await chat.sendMessageStream(gParts as Parameters<typeof chat.sendMessageStream>[0]);
              let tokensIn = 0, tokensOut = 0;
              for await (const chunk of result.stream) {
                const raw = chunk.text();
                if (raw) { respuestaCompleta += raw; send({ delta: raw }); }
                const meta = chunk.usageMetadata;
                if (meta) { tokensIn = meta.promptTokenCount ?? tokensIn; tokensOut = meta.candidatesTokenCount ?? tokensOut; }
              }
              registrarUso({ modelo: modelId, endpoint: 'preguntar', tokensIn, tokensOut, perfil, usuario: session.email, usuarioId });
              void recordGeminiUsagePg(usuarioId, 'colba');
              // Extraer fuentes web del grounding (si se activó)
              if (usarWeb) {
                try {
                  const finalResp = await result.response;
                  const chunks = finalResp.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
                  const fetchedAt = new Date().toISOString();
                  webSources = chunks
                    .filter((ch: { web?: { uri?: string } }) => ch.web?.uri)
                    .map((ch: { web?: { uri?: string; title?: string } }) => ({
                      title: ch.web?.title ?? ch.web?.uri ?? '',
                      url:   ch.web?.uri ?? '',
                      sourceType: clasificarFuente(ch.web?.uri ?? ''),
                      fetchedAt,
                    }));
                } catch { /* grounding metadata no disponible */ }
              }
              break;
            } catch (err) {
              if (respuestaCompleta) break;
              console.error(`[preguntar] ${modelId} falló:`, String(err).slice(0, 200));
              const tipo = clasificarErrorGemini(err);
              if (tipo === 'break') break;
              if (tipo === 'skip' || tipo === 'unknown') continue;
              // retry (429/503): espera y prueba el siguiente
              await new Promise(r => setTimeout(r, 5000));
              continue;
            }
          }
        }

        if (!respuestaCompleta) {
          console.error('[preguntar] Todos los modelos fallaron.');
          send({ error: GEMINI_USER_ERROR });
          return;
        }

        send({ done: true, fuentes, ...(webSources.length > 0 ? { webSources } : {}) });

        // Guardar en cache async (solo si usó conocimiento general, sin pliego)
        if (cacheKey && respuestaCompleta && docIds.length === 0) {
          prisma.lecturaAnalisis.create({
            data: {
              nombreDocumento: pregunta.slice(0, 255),
              pdfHash: cacheKey,
              modo: 'colba-qa',
              codigoProceso: codigoProceso ?? null,
              resultado: { respuesta: respuestaCompleta, fuentes: [] },
              usuarioId: session?.id ?? null,
            },
          }).catch(() => {});
        }

      } catch (err) {
        send({ error: err instanceof Error ? err.message : 'Error interno' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}