import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSession } from '@/lib/session';
import { requireSession, puedeVerConsolidadoSimulaciones, normalizarEmpresa } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { registrarUso } from '@/lib/gemini-usage';
import { normalizarPonderacionEconomicaDesdeLecturaAnalisis } from '@/lib/ponderacion-economica/normalizador';
import { buildExtraccionPrompt } from '@/lib/ponderacion-economica/extraccionPrompt';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ── Helpers ────────────────────────────────────────────────────────────────────

function parsearJSONGemini(raw: string): Record<string, unknown> {
  const clean = raw.trim().replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  try { return JSON.parse(clean) as Record<string, unknown>; } catch { /* continuar */ }
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Gemini no devolvió JSON válido en extracción de ponderación');
  try { return JSON.parse(match[0]) as Record<string, unknown>; } catch { /* continuar */ }
  let fixed = match[0];
  let b = 0, br = 0;
  for (const ch of fixed) {
    if (ch === '{') b++; else if (ch === '}') b--;
    else if (ch === '[') br++; else if (ch === ']') br--;
  }
  fixed = fixed.replace(/,\s*([}\]])/, '$1') + ']'.repeat(Math.max(0, br)) + '}'.repeat(Math.max(0, b));
  return JSON.parse(fixed) as Record<string, unknown>;
}

async function llamarGeminiExtraccion(
  apiKey: string,
  texto: string,
  usuarioId: number | null,
  usuarioEmail: string,
  usuarioRol: string,
): Promise<{ resultado: Record<string, unknown>; tokensIn: number; tokensOut: number; modelo: string }> {
  const modelos = ['gemini-2.5-flash', 'gemini-2.5-pro'] as const;
  const prompt = buildExtraccionPrompt(texto);
  const client = new GoogleGenerativeAI(apiKey);
  let lastErr: unknown;

  for (const modelId of modelos) {
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const model = client.getGenerativeModel({
          model: modelId,
          generationConfig: { maxOutputTokens: 4000, responseMimeType: 'application/json', temperature: 0.1 },
        });
        const timeoutP = new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error(`Timeout 60s en ${modelId}`)), 60_000),
        );
        const result = await Promise.race([model.generateContent([prompt]), timeoutP]);
        const text = result.response.text();
        if (!text?.trim()) throw new Error('Gemini devolvió respuesta vacía');
        const resultado = parsearJSONGemini(text);
        const tokensIn = result.response.usageMetadata?.promptTokenCount ?? 0;
        const tokensOut = result.response.usageMetadata?.candidatesTokenCount ?? 0;
        void registrarUso({
          modelo: modelId,
          endpoint: 'ponderacion/extract-from-document',
          tokensIn,
          tokensOut,
          usuario: usuarioEmail,
          perfil: usuarioRol,
          usuarioId,
        });
        return { resultado, tokensIn, tokensOut, modelo: modelId };
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const invalido = msg.includes('404') || msg.includes('not found');
        if (invalido) break;
        await new Promise(r => setTimeout(r, invalido ? 0 : 3_000));
      }
    }
  }
  throw lastErr;
}

// ── POST /api/ponderacion/extract-from-document ───────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  let body: {
    procesoId?: number | null;
    codigoProceso?: string | null;
    razonSocial?: string | null;
    empresaGrupo?: string | null;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }); }

  const { procesoId, codigoProceso, razonSocial, empresaGrupo } = body;

  if (!procesoId && !codigoProceso) {
    return NextResponse.json(
      { ok: false, error: 'Se requiere procesoId o codigoProceso' },
      { status: 422 },
    );
  }

  // ── Permisos: aislamiento por empresa (mismo patrón Fase 2B.2) ───────────────
  const consolidado = await puedeVerConsolidadoSimulaciones(session!);
  const userDb = await prisma.user.findUnique({
    where: { id: session!.id },
    select: { entidadGrupo: true },
  });
  const empresaUsuario = normalizarEmpresa(userDb?.entidadGrupo);

  if (!consolidado && empresaUsuario) {
    const empresaSolicitud = normalizarEmpresa(empresaGrupo ?? razonSocial);
    if (empresaSolicitud && empresaSolicitud !== empresaUsuario) {
      return NextResponse.json(
        { ok: false, error: 'No autorizado para acceder a documentos de otra empresa' },
        { status: 403 },
      );
    }
  }

  const empresaFinal = razonSocial ?? empresaGrupo ?? userDb?.entidadGrupo ?? null;
  const grupoFinal = empresaGrupo ?? razonSocial ?? userDb?.entidadGrupo ?? null;

  // ── Paso 1: Buscar LecturaAnalisis existente ──────────────────────────────────
  let lecturaAnalisis: { id: number; resultado: unknown } | null = null;

  if (codigoProceso) {
    // Buscar el análisis más reciente que tenga ponderacion_economica (puede no ser el último)
    const analises = await prisma.lecturaAnalisis.findMany({
      where: { codigoProceso },
      orderBy: { creadoEn: 'desc' },
      take: 10,
      select: { id: true, resultado: true },
    });
    const conPonderacion = analises.find(
      a => !!(a.resultado as Record<string, unknown>)?.ponderacion_economica,
    );
    if (conPonderacion) {
      lecturaAnalisis = { id: conPonderacion.id, resultado: conPonderacion.resultado };
    }
  }

  if (lecturaAnalisis) {
    // ── Camino principal: normalizar desde LecturaAnalisis existente ─────────
    const resultado = lecturaAnalisis.resultado as Record<string, unknown>;
    const ponderacionRaw = resultado.ponderacion_economica ?? null;

    if (!ponderacionRaw) {
      return NextResponse.json({
        ok: false,
        error: 'El análisis existente no contiene datos de ponderación económica. Requiere análisis previo del pliego desde Lectura de Procesos.',
        sugerencia: 'Analiza el pliego desde el módulo "Lectura de Procesos" y vuelve a intentar.',
      }, { status: 422 });
    }

    const resultado_normalizacion = await normalizarPonderacionEconomicaDesdeLecturaAnalisis(
      ponderacionRaw,
      {
        procesoId: procesoId ?? null,
        codigoProceso: codigoProceso ?? null,
        lecturaAnalisisId: lecturaAnalisis.id,
        razonSocial: empresaFinal,
        empresaGrupo: grupoFinal,
        fuenteExtraccion: 'lectura_analisis',
      },
    );

    if (!resultado_normalizacion.ok) {
      return NextResponse.json(
        { ok: false, error: resultado_normalizacion.error ?? 'Error normalizando datos' },
        { status: 422 },
      );
    }

    const metodosGuardados = await prisma.metodoPonderacionProceso.findMany({
      where: {
        lecturaAnalisisId: lecturaAnalisis.id,
        estadoRevision: 'pendiente_revision',
        fuenteExtraccion: 'lectura_analisis',
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, nombreMetodo: true, tipoFormula: true,
        rangoTrmDesde: true, rangoTrmHasta: true,
        puntajeMaximo: true, formulaTexto: true,
        textoFuente: true, confianzaExtraccion: true,
        estadoRevision: true, advertencias: true,
      },
    });

    return NextResponse.json({
      ok: true,
      fuente: 'lectura_analisis',
      lecturaAnalisisId: lecturaAnalisis.id,
      metodosCreados: resultado_normalizacion.metodosCreados,
      presupuestoOficial: resultado_normalizacion.presupuestoOficial,
      puntajeMaximoEconomico: resultado_normalizacion.puntajeMaximoEconomico,
      advertencias: resultado_normalizacion.advertencias,
      metodos: metodosGuardados.map(m => ({
        ...m,
        puntajeMaximo: m.puntajeMaximo != null ? Number(m.puntajeMaximo) : null,
        confianzaExtraccion: m.confianzaExtraccion != null ? Number(m.confianzaExtraccion) : null,
      })),
      mensaje: resultado_normalizacion.metodosCreados > 0
        ? `Se extrajo${resultado_normalizacion.metodosCreados > 1 ? 'ron' : ''} ${resultado_normalizacion.metodosCreados} método(s) de ponderación económica. Requieren revisión antes de usarse en simulación.`
        : 'No se identificaron métodos de ponderación económica en el análisis existente.',
    });
  }

  // ── Paso 2: Fallback — texto de ProcesoDocumentoSecop ────────────────────────
  let textoPliego: string | null = null;

  if (procesoId) {
    const docs = await prisma.procesoDocumentoSecop.findMany({
      where: { procesoId, textoExtraido: { not: null } },
      orderBy: { fechaDetectado: 'asc' },
      select: { textoExtraido: true, nombre: true, tipoDocumento: true },
    });
    // Priorizar pliegos de condiciones sobre otros documentos
    const priorizados = [
      ...docs.filter(d => d.tipoDocumento?.toLowerCase().includes('pliego') || d.nombre?.toLowerCase().includes('pliego')),
      ...docs.filter(d => !d.tipoDocumento?.toLowerCase().includes('pliego') && !d.nombre?.toLowerCase().includes('pliego')),
    ];
    const textos = priorizados
      .map(d => d.textoExtraido)
      .filter(Boolean) as string[];
    if (textos.length > 0) {
      textoPliego = textos.join('\n\n--- DOCUMENTO SIGUIENTE ---\n\n').slice(0, 80_000);
    }
  }

  if (!textoPliego || textoPliego.trim().length < 200) {
    return NextResponse.json({
      ok: false,
      error: 'No hay texto de pliego suficiente para extraer ponderación económica.',
      sugerencia: codigoProceso
        ? 'Analiza el pliego desde el módulo "Lectura de Procesos" y vuelve a intentar.'
        : 'Proporciona el codigoProceso o verifica que el proceso tenga documentos descargados.',
    }, { status: 422 });
  }

  // ── Paso 3: Llamar Gemini con prompt dedicado ─────────────────────────────────
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'Servicio de IA no configurado' },
      { status: 503 },
    );
  }

  let geminiResultado: Record<string, unknown>;
  let tokensIn = 0, tokensOut = 0, modeloUsado = 'gemini-2.5-flash';
  try {
    const gemini = await llamarGeminiExtraccion(
      apiKey, textoPliego, session!.id, session!.email, session!.rol,
    );
    geminiResultado = gemini.resultado;
    tokensIn = gemini.tokensIn;
    tokensOut = gemini.tokensOut;
    modeloUsado = gemini.modelo;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[extract-from-document] Gemini error:', msg.slice(0, 300));
    return NextResponse.json(
      { ok: false, error: 'Error al consultar la IA. Intenta de nuevo.' },
      { status: 502 },
    );
  }

  const resultado_normalizacion = await normalizarPonderacionEconomicaDesdeLecturaAnalisis(
    geminiResultado,
    {
      procesoId: procesoId ?? null,
      codigoProceso: codigoProceso ?? null,
      lecturaAnalisisId: null,
      razonSocial: empresaFinal,
      empresaGrupo: grupoFinal,
      fuenteExtraccion: 'gemini_directo',
    },
  );

  if (!resultado_normalizacion.ok) {
    return NextResponse.json(
      { ok: false, error: resultado_normalizacion.error ?? 'Error normalizando datos de Gemini' },
      { status: 422 },
    );
  }

  const metodosGuardados = await prisma.metodoPonderacionProceso.findMany({
    where: {
      procesoId: procesoId ?? undefined,
      codigoProceso: !procesoId ? (codigoProceso ?? undefined) : undefined,
      estadoRevision: 'pendiente_revision',
      fuenteExtraccion: 'gemini_directo',
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, nombreMetodo: true, tipoFormula: true,
      rangoTrmDesde: true, rangoTrmHasta: true,
      puntajeMaximo: true, formulaTexto: true,
      textoFuente: true, confianzaExtraccion: true,
      estadoRevision: true, advertencias: true,
    },
  });

  return NextResponse.json({
    ok: true,
    fuente: 'gemini_directo',
    modelo: modeloUsado,
    tokens: { entrada: tokensIn, salida: tokensOut },
    metodosCreados: resultado_normalizacion.metodosCreados,
    presupuestoOficial: resultado_normalizacion.presupuestoOficial,
    puntajeMaximoEconomico: resultado_normalizacion.puntajeMaximoEconomico,
    advertencias: resultado_normalizacion.advertencias,
    metodos: metodosGuardados.map(m => ({
      ...m,
      puntajeMaximo: m.puntajeMaximo != null ? Number(m.puntajeMaximo) : null,
      confianzaExtraccion: m.confianzaExtraccion != null ? Number(m.confianzaExtraccion) : null,
    })),
    mensaje: resultado_normalizacion.metodosCreados > 0
      ? `Se extrajo${resultado_normalizacion.metodosCreados > 1 ? 'ron' : ''} ${resultado_normalizacion.metodosCreados} método(s) mediante IA desde el texto del pliego. Requieren revisión antes de usarse en simulación.`
      : 'No se identificaron métodos de ponderación económica en el texto del pliego.',
  });
}