import { NextRequest, NextResponse } from 'next/server';
import { GEMINI_MODELS as CADENA_MODELOS, clasificarErrorGemini, GEMINI_USER_ERROR } from '@/lib/gemini-models';
import { GoogleGenerativeAI } from '@google/generative-ai';
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
import { loadActiveMemories, formatMemoriesForPrompt } from '@/lib/asistente-colba/memory';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Mensaje = { rol: 'user' | 'assistant'; texto: string };

const APP_CONTEXT = `SOBRE EL APLICATIVO LICYCOLBA:
LICYCOLBA es una plataforma tecnológica interna del Grupo Colba para la gestión, análisis y seguimiento de procesos de licitación y contratación pública y privada en Colombia. LICYCOLBA es una herramienta de software, NO una empresa operativa. Sus módulos principales son:

MÓDULO TRM: Consulta la Tasa Representativa del Mercado (COP/USD) del día, historial de hasta 365 días, predicciones con modelos Holt-Winters y promedio móvil, y exportación a Excel. También incluye el panel de Simulación de ponderación económica SECOP II, donde el usuario ingresa las ofertas económicas y calcula automáticamente los puntajes según la fórmula activa (determinada por los centavos de la TRM vigente: media aritmética, media geométrica, mediana, media aritmética alta, etc.).

MÓDULO BÚSQUEDA DE PROCESOS: Permite buscar procesos de SECOP I y II. Subvistas: "Sin gestionar" (procesos encontrados que aún no se han analizado), "Gestionados" (ya analizados y con decisión), "No viables" (descartados), "Histórico de procesos" (todos los registros históricos con filtros), y badge de procesos nuevos del día.

MÓDULO PROCESOS: Gestión del pipeline de licitaciones con estas vistas:
- Procesos por validar (Públicos / Privados): procesos asignados que requieren revisión y validación.
- Procesos en observación: procesos con observaciones pendientes de respuesta.
- Procesos en ejecución: contratos activos en ejecución.
- Procesos en evaluación: propuestas en etapa de evaluación.
- Procesos cerrados (Adjudicados / No adjudicados / No presentados / Cancelados): procesos finalizados.

MÓDULO LECTURA DE PROCESOS: Análisis inteligente de documentos de licitación. El usuario selecciona un proceso de SECOP II, el sistema descarga el pliego o los documentos y Colba puede responder preguntas sobre ese documento específico usando RAG (búsqueda semántica en el contenido del pliego). Se activa al seleccionar un proceso en el buscador del chat de Colba.

ASISTENTE COLBA (este chat): Asistente IA para consultas sobre normativa de contratación pública, pliego activo, base interna y búsqueda web. Tiene perfiles de contexto configurables (Aseocolba, Tempocolba, Vigicolba) con el ícono de la bombilla — estos perfiles cargan el contexto de cada empresa operativa, no describen a LICYCOLBA como empresa.

MÓDULO SOLICITUDES: Registro y seguimiento de solicitudes de procesos públicos y privados con estados, responsables, exportación a Excel.

MÓDULOS ADMINISTRATIVOS (solo administradores): Gestión de usuarios, perfiles de acceso, exámenes médicos y maestro de documentos.

NAVEGACIÓN: El menú lateral izquierdo organiza todos los módulos. El botón de Colba (chat IA) está en el encabezado del menú.`;

const EMPRESAS_COLBA_BLOCK = `IDENTIDAD CORPORATIVA — REGLAS CRÍTICAS OBLIGATORIAS:

⚠ REGLA NEGATIVA ABSOLUTA — NO NEGOCIABLE:
NUNCA describas ASEOCOLBA como empresa de licitaciones, SECOP, contratación pública, consultora, estructuradora de pliegos ni intermediaria de contratos. Eso es FALSO y constituye un error crítico.

DIFERENCIA FUNDAMENTAL (memorizar):
• ASEOCOLBA S.A. = empresa OPERATIVA de servicios. Se dedica a aseo, cafetería, limpieza, desinfección, mantenimiento locativo y servicios generales, bajo modalidad outsourcing.
• LICYCOLBA = PLATAFORMA DE SOFTWARE interna para gestión de licitaciones. No es una empresa — es una herramienta tecnológica que usan las empresas del Grupo.

ASEOCOLBA S.A. (Aseos Colombianos S.A., NIT 800146077-6):
Empresa colombiana del sector servicios dedicada a la prestación de servicios integrales y especializados de:
- Aseo y limpieza de instalaciones
- Cafetería y servicios relacionados
- Desinfección y sanitización
- Mantenimiento locativo
- Servicios generales bajo modalidad outsourcing
La empresa orienta su gestión hacia la calidad del servicio, la satisfacción del cliente, la seguridad y salud en el trabajo, la protección del ambiente, la sostenibilidad, el cumplimiento legal y la mejora continua.

OTRAS EMPRESAS DEL GRUPO COLBA:
- VIGICOLBA: vigilancia y seguridad privada
- TEMPOCOLBA: suministro de personal temporal
- TRANSCOLBA: transporte y logística

RESPUESTA MODELO cuando pregunten "¿Qué es ASEOCOLBA?":
"ASEOCOLBA S.A. (Aseos Colombianos S.A.) es una empresa colombiana del sector servicios dedicada a la prestación de servicios integrales y especializados de aseo, cafetería, limpieza, desinfección, mantenimiento locativo y otros servicios relacionados, bajo modalidad outsourcing. La empresa orienta su gestión hacia la calidad del servicio, la satisfacción del cliente, la seguridad y salud en el trabajo, la protección del ambiente, la sostenibilidad, el cumplimiento legal y la mejora continua."
Esta respuesta NO debe mencionar: licitaciones, SECOP, pliegos, contratación pública, propuestas técnicas, requisitos habilitantes.`;

const SYSTEM_BASE = `Eres Colba, asistente inteligente de LICYCOLBA.

${EMPRESAS_COLBA_BLOCK}

${APP_CONTEXT}

Conoces: Ley 80/93, Ley 1150/07, Decreto 1082/15, SECOP I y II, modalidades de selección (licitación pública, selección abreviada, concurso de méritos, contratación directa, mínima cuantía), pliegos de condiciones, requisitos habilitantes (jurídicos, financieros, técnicos), criterios de evaluación, fórmulas económicas (media geométrica, mediana, menor valor), TRM, garantías contractuales, impugnaciones y recursos. Este conocimiento es sobre la PLATAFORMA y la normativa colombiana — no define a ASEOCOLBA como empresa de licitaciones.

Cuando te pregunten sobre el aplicativo o sus funciones, guía al usuario con instrucciones claras y concretas sobre cómo usarlo.

Estilo: natural y profesional, español colombiano. Usa markdown cuando mejore la claridad: negritas para términos clave, listas para pasos o enumeraciones, código para valores o fórmulas.`;



function esErrorSobrecarga(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (msg.includes('503') || msg.includes('high demand') || msg.includes('overloaded') || msg.includes('Service Unavailable'))
    && !msg.includes('free_tier') && !msg.includes('QuotaFailure');
}

function esErrorCuota(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('429') || msg.includes('free_tier') || msg.includes('QuotaFailure') || msg.includes('RESOURCE_EXHAUSTED');
}

export async function POST(req: NextRequest) {
  // ── Autenticación ──────────────────────────────────────────────────────────
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'Servicio no disponible.' }, { status: 503 });
  }

  let body: { mensaje?: string; historial?: Mensaje[]; modelo?: string; perfil?: string; archivos?: {base64:string;mimeType:string;nombre:string}[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 }); }

  const { mensaje: mensajeRaw, historial = [], perfil = 'ASEOCOLBA', archivos = [] } = body;
  if (!mensajeRaw?.trim() && archivos.length === 0) {
    return NextResponse.json({ ok: false, error: 'Mensaje vacío.' }, { status: 400 });
  }
  const mensaje = mensajeRaw ?? '';

  const usuarioId = await resolveSessionUserId(session);
  if (usuarioId === null) return NextResponse.json({ ok: false, error: 'Sesión inválida. Inicie sesión nuevamente.' }, { status: 401 });

  // Rate limit por usuario (Postgres persistente)
  const rlChat = await checkGeminiRateLimitPg(usuarioId, 'chat');
  if (rlChat.bloqueado) {
    return NextResponse.json({ ok: false, error: `Límite diario de mensajes alcanzado (${rlChat.usos}/${rlChat.limite}). Intente mañana.` }, { status: 429 });
  }

  // Cargar contexto en paralelo
  let empresaCtx = '';
  let statsCtx = '';
  let procesosCtx = '';
  let docsCtx = '';
  let manifestCtx = '';
  let noViablesCtx = '';
  const necesitaDetalle   = requiereDetalleProcesos(mensaje);
  const necesitaDocs      = requiereDetalleDocumentos(mensaje);
  const necesitaManifest  = requiereDetalleManifestaciones(mensaje);
  const necesitaNoViables = requiereDetalleNoViables(mensaje);
  let conocimientoCtx = '';
  let memoryBlock = '';
  try {
    const [entradas, stats, procDetalle, docsDetalle, manifestDetalle, noViablesDetalle, fragmentos, activeMemories] = await Promise.all([
      prisma.lecturaAnalisis.findMany({
        where: { modo: 'colba-empresa', codigoProceso: perfil.toUpperCase() },
        select: { nombreDocumento: true, resultado: true },
        orderBy: { creadoEn: 'asc' },
      }),
      obtenerEstadisticas(),
      necesitaDetalle   ? buscarProcesosDetallados(mensaje) : Promise.resolve(''),
      necesitaDocs      ? buscarDocumentosMaestro(mensaje)  : Promise.resolve(''),
      necesitaManifest  ? buscarManifestaciones(mensaje)    : Promise.resolve(''),
      necesitaNoViables ? buscarProcesosNoViables(mensaje)  : Promise.resolve(''),
      buscarConocimientoRelevante(mensaje, perfil, 8),
      loadActiveMemories(perfil).catch(() => []),
    ]);
    empresaCtx   = entradas.map(e => { const texto = (e.resultado as { texto?: string })?.texto ?? ''; return e.nombreDocumento !== 'Sin título' ? `${e.nombreDocumento}: ${texto}` : texto; }).filter(Boolean).join('\n');
    statsCtx     = formatearEstadisticas(stats);
    procesosCtx  = procDetalle;
    docsCtx      = docsDetalle;
    manifestCtx  = manifestDetalle;
    noViablesCtx = noViablesDetalle;
    conocimientoCtx = formatearConocimientoParaPrompt(fragmentos);
    memoryBlock = formatMemoriesForPrompt(activeMemories);
  } catch { /* ignorar */ }

  const tieneImagenes = archivos.some(a => a.mimeType.startsWith('image/'));
  const visionBlock = tieneImagenes
    ? `ANÁLISIS VISUAL ACTIVO:
El usuario ha adjuntado una o más imágenes. Analiza cuidadosamente cada imagen adjunta.
Identifica todo el texto visible, tablas, datos, errores, campos, logos, fechas, valores, estados, alertas, gráficos o cualquier elemento relevante.
Si la imagen corresponde a un documento empresarial, contrato, certificado, pantallazo de SECOP I o II, Excel, Power BI, HSEQ, SST, licitación o proceso interno, interpreta su contenido en contexto y entrega una respuesta práctica.
Responde de forma natural: "Veo que en la imagen aparece...", "El error principal parece ser...", "En la tabla se observa...", "El documento muestra...", "No alcanzo a leer con claridad este campo...", "Con base en la imagen, debes revisar...".
Si hay información ilegible o incompleta, indícalo claramente sin inventar datos, nombres, fechas ni valores.
NO guardes automáticamente el contenido de la imagen como memoria permanente, salvo que el usuario lo pida explícitamente.`
    : '';

  const SYSTEM = [
    memoryBlock || '',
    visionBlock || '',
    SYSTEM_BASE,
    conocimientoCtx ? `\nCONOCIMIENTO INTERNO CARGADO (responde con seguridad si la pregunta coincide; si no está aquí, dilo claramente):\n${conocimientoCtx}` : '',
    empresaCtx   ? `\nCONTEXTO DE LA EMPRESA:\n${empresaCtx}` : '',
    statsCtx     ? `\n${statsCtx}` : '',
    procesosCtx  ? `\n${procesosCtx}` : '',
    docsCtx      ? `\n${docsCtx}` : '',
    manifestCtx  ? `\n${manifestCtx}` : '',
    noViablesCtx ? `\n${noViablesCtx}` : '',
    `\nREGLAS CRÍTICAS DE CONOCIMIENTO:
- Si la información está en el CONOCIMIENTO INTERNO CARGADO, responde con seguridad y cita los datos.
- Si no está, di: "No tengo información suficiente cargada sobre ese punto."
- Nunca inventes datos legales, financieros, certificaciones, cargos, clientes, fechas ni valores.
- Diferencia claramente ASEOCOLBA, TEMPOCOLBA y VIGICOLBA.
- Para datos actuales de procesos, solicitudes o TRM, usa exclusivamente la información de PostgreSQL que ya tienes en contexto.`,
  ].filter(Boolean).join('\n');

  const genAI = new GoogleGenerativeAI(apiKey);

  const histRaw = historial.slice(-12).map(m => ({
    role: m.rol === 'user' ? 'user' : 'model',
    parts: [{ text: m.texto }],
  }));
  const histClean: typeof histRaw = [];
  for (const h of histRaw) {
    if (histClean.length === 0 && h.role !== 'user') continue;
    if (histClean.length > 0 && histClean[histClean.length - 1].role === h.role) continue;
    histClean.push(h);
  }

  type Part = { text: string } | { inlineData: { data: string; mimeType: string } };
  const parts: Part[] = [];
  for (const a of archivos) parts.push({ inlineData: { data: a.base64, mimeType: a.mimeType } });
  if (mensaje?.trim()) parts.push({ text: mensaje.trim() });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msgArg: any = parts.length === 1 && 'text' in parts[0] ? (parts[0] as { text: string }).text : parts;

  const encoder = new TextEncoder();

  void recordGeminiUsagePg(usuarioId, 'chat');
    for (const modelId of CADENA_MODELOS) {
    try {
      const gemini = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: SYSTEM,
        generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
      });
      const chat = gemini.startChat({ history: histClean });
      const streamResult = await chat.sendMessageStream(msgArg);

      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of streamResult.stream) {
              const text = chunk.text();
              if (text) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: text })}\n\n`));
            }
            const agg = await streamResult.response;
            const meta = agg.usageMetadata;
            registrarUso({
              modelo: modelId,
              endpoint: 'chat',
              tokensIn: meta?.promptTokenCount ?? 0,
              tokensOut: meta?.candidatesTokenCount ?? 0,
              perfil,
              usuario: session.email,
              usuarioId,
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errMsg.slice(0, 300) })}\n\n`));
          }
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[licy/chat] ${modelId} falló:`, errMsg.slice(0, 200));
      if (esErrorCuota(err) || esErrorSobrecarga(err)) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      return NextResponse.json({ ok: false, error: errMsg.slice(0, 200) }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: false, error: 'Servicio de IA no disponible en este momento. Intenta de nuevo en unos segundos.' }, { status: 503 });
}