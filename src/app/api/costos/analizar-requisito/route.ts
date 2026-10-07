/**
 * POST /api/costos/analizar-requisito
 *
 * 1. Gemini interpreta el texto operativo → JSON estructurado
 * 2. Backend valida con reglas determinísticas (costos-laborales.ts)
 * 3. Devuelve análisis + alertas + sugerencias SIN aplicar cambios
 *
 * Fuentes normativas: Ley 2101/2021, Ley 2466/2025, CST, Dec.1772/1994
 */

import { NextRequest, NextResponse } from 'next/server';
import { registrarUso } from '@/lib/gemini-usage';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession, resolveSessionUserId } from '@/lib/authz';
import { GEMINI_MODELS } from '@/lib/gemini-models';
import { analizarConAnthropic } from '@/lib/ai/providers/anthropicProvider';
import { HAIKU_MAX_TOKENS } from '@/lib/ai/types';
import {
  calcularResumen,
  type TurnoInput,
  type DiaSemana,
  type FormularioActual,
  type ParamsLaborales,
} from '@/lib/costos-laborales';

export const dynamic = 'force-dynamic';

// ─── Prompt Gemini ────────────────────────────────────────────────────────────

const GEMINI_SYSTEM = `Eres un analizador experto de requisitos operativos laborales en Colombia.
Tu única función es extraer información estructurada de un texto en lenguaje natural.
RESPONDE SOLO con JSON válido y estricto. Sin markdown, sin explicaciones, sin texto adicional.`;

const GEMINI_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    cargoDetectado:    { type: SchemaType.STRING },
    servicioDetectado: { type: SchemaType.STRING },
    jornadaDetectada:  { type: SchemaType.STRING },
    horasSemanalesTexto: { type: SchemaType.NUMBER },
    turnos: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          dias:       { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          horaInicio: { type: SchemaType.STRING },
          horaFin:    { type: SchemaType.STRING },
        },
        required: ['dias', 'horaInicio', 'horaFin'],
      },
    },
    trabajaNocturno:     { type: SchemaType.BOOLEAN },
    trabajaDominicales:  { type: SchemaType.BOOLEAN },
    trabajaFestivos:     { type: SchemaType.BOOLEAN },
    requiereHorasExtra:  { type: SchemaType.BOOLEAN },
    nSedes:              { type: SchemaType.NUMBER },
    observaciones:       { type: SchemaType.STRING },
  },
  required: [
    'cargoDetectado', 'servicioDetectado', 'jornadaDetectada',
    'horasSemanalesTexto', 'turnos',
    'trabajaNocturno', 'trabajaDominicales', 'trabajaFestivos',
    'requiereHorasExtra', 'observaciones',
  ],
};

// Claude no soporta responseSchema de Gemini: el schema va en el system prompt
const CLAUDE_SYSTEM = `${GEMINI_SYSTEM}

Devuelve EXACTAMENTE un objeto JSON con esta forma (todos los campos obligatorios salvo nSedes):
{
  "cargoDetectado": string,
  "servicioDetectado": string,
  "jornadaDetectada": string,
  "horasSemanalesTexto": number,
  "turnos": [{ "dias": [string], "horaInicio": "HH:MM", "horaFin": "HH:MM" }],
  "trabajaNocturno": boolean,
  "trabajaDominicales": boolean,
  "trabajaFestivos": boolean,
  "requiereHorasExtra": boolean,
  "nSedes": number,
  "observaciones": string
}`;

/** Quita fences de markdown que los modelos añaden a veces. */
function limpiarJson(raw: string): string {
  return raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
}

// Mapeo de abreviaturas de días a DiaSemana
const DIA_MAP: Record<string, DiaSemana> = {
  L: 'L', LUN: 'L', LUNES: 'L',
  M: 'M', MAR: 'M', MARTES: 'M',
  X: 'X', MI: 'X', MIE: 'X', MIER: 'X', MIERCOLES: 'X', 'MIÉRCOLES': 'X',
  J: 'J', JUE: 'J', JUEVES: 'J',
  V: 'V', VIE: 'V', VIERNES: 'V',
  S: 'S', SAB: 'S', SABADO: 'S', 'SÁBADO': 'S',
  D: 'D', DOM: 'D', DOMINGO: 'D',
};

function normalizarDias(dias: string[]): DiaSemana[] {
  return dias
    .map(d => DIA_MAP[d.toUpperCase().trim()] ?? null)
    .filter((d): d is DiaSemana => d !== null);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  const usuarioId = await resolveSessionUserId(session!);

  try {
    const body = await req.json() as {
      texto: string;
      formulario?: Partial<FormularioActual>;
    };

    const texto = body.texto?.trim();
    if (!texto) {
      return NextResponse.json({ ok: false, error: 'texto requerido' }, { status: 400 });
    }

    // ── 1. Cargar parámetros laborales vigentes ────────────────────────────
    const anioActual = new Date().getFullYear();
    const paramsBD = await prisma.parametrosLaborales.findFirst({
      where: { activo: true },
      orderBy: { anio: 'desc' },
    });

    if (!paramsBD) {
      return NextResponse.json(
        { ok: false, error: 'No hay parámetros laborales configurados en BD.' },
        { status: 500 },
      );
    }

    // ── 2. Interpretar el texto con IA (Claude; respaldo Gemini) ───────────
    const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY;

    const prompt = `Analiza el siguiente requisito operativo laboral colombiano y extrae toda la información relevante.

TEXTO: "${texto}"

Considera:
- Días: L=lunes, M=martes, X=miércoles, J=jueves, V=viernes, S=sábado, D=domingo
- Horarios en formato 24h (HH:MM)
- Ley 2466/2025: jornada nocturna en Colombia es de 19:00 a 06:00
- Ley 2101/2021: máximo ordinario es 44h/semana en 2026
- Si hay más de 44h/sem, hay horas extra
- Para cada turno: horaFin puede ser del día siguiente (ej. 23:00-07:00)`;

    let gemini: Record<string, unknown> | null = null;
    let geminiError = '';
    let proveedorIA: 'anthropic' | 'gemini' | null = null;

    // ── 2a. Anthropic Claude (proveedor conectado al módulo de costos) ─────
    const claude = await analizarConAnthropic({
      systemPrompt: CLAUDE_SYSTEM,
      userPrompt: prompt,
      maxTokens: HAIKU_MAX_TOKENS.analisis_general,
    });
    if (claude.success && claude.errorCode !== 'respuesta_truncada') {
      try {
        gemini = JSON.parse(limpiarJson(claude.text)) as Record<string, unknown>;
        proveedorIA = 'anthropic';
        void registrarUso({
          modelo: claude.model,
          endpoint: 'anthropic:costos/requisito',
          tokensIn: claude.usage?.inputTokens ?? 0,
          tokensOut: claude.usage?.outputTokens ?? 0,
          usuario: session!.email,
          usuarioId,
        });
      } catch {
        geminiError = 'JSON inválido de Claude';
      }
    } else {
      geminiError = `Claude no disponible (${claude.errorCode ?? 'error'})`;
    }
    if (!gemini) console.warn('[analizar-requisito] fallback a Gemini:', geminiError);

    // ── 2b. Respaldo: flujo Gemini previo (sin cambios) ────────────────────
    if (!gemini && !apiKey) {
      return NextResponse.json(
        { ok: false, error: `IA no disponible: ${geminiError}; GOOGLE_API_KEY no configurada.` },
        { status: 500 },
      );
    }
    const genAI = gemini ? null : new GoogleGenerativeAI(apiKey!);
    for (const modelName of GEMINI_MODELS) {
      if (gemini || !genAI) break;
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: GEMINI_SYSTEM,
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: GEMINI_SCHEMA as any,
            temperature: 0,
          },
        });
        const result = await model.generateContent(prompt);
        void registrarUso({
          modelo: modelName,
          endpoint: 'costos/requisito',
          tokensIn: result.response.usageMetadata?.promptTokenCount ?? 0,
          tokensOut: result.response.usageMetadata?.candidatesTokenCount ?? 0,
          usuario: session!.email,
          usuarioId,
        });
        gemini = JSON.parse(result.response.text()) as Record<string, unknown>;
        proveedorIA = 'gemini';
        break;
      } catch (e) {
        geminiError = e instanceof Error ? e.message : String(e);
        // Si es 429 (quota), intentar con el siguiente modelo
        if (!geminiError.includes('429') && !geminiError.includes('quota')) throw e;
      }
    }

    // ── 3. Normalizar turnos ───────────────────────────────────────────────
    const turnosRaw = Array.isArray(gemini?.turnos) ? gemini!.turnos as Array<{
      dias: string[];
      horaInicio: string;
      horaFin: string;
    }> : [];

    const turnos: TurnoInput[] = turnosRaw
      .map(t => ({
        dias: normalizarDias(t.dias ?? []),
        horaInicio: String(t.horaInicio ?? '08:00'),
        horaFin: String(t.horaFin ?? '17:00'),
      }))
      .filter(t => t.dias.length > 0);

    // ── 4. Parámetros laborales para el motor ─────────────────────────────
    const formulario: FormularioActual = {
      horasSemanales: Number(body.formulario?.horasSemanales ?? 44),
      salBase: Number(body.formulario?.salBase ?? paramsBD.smmlv),
      conAux: Boolean(body.formulario?.conAux ?? true),
      auxValor: Number(body.formulario?.auxValor ?? paramsBD.auxilioTransporte),
      hRecNocHabil: Number(body.formulario?.hRecNocHabil ?? 0),
      hExtDiurHabil: Number(body.formulario?.hExtDiurHabil ?? 0),
      hExtNocHabil: Number(body.formulario?.hExtNocHabil ?? 0),
      hOrdDomDiu: Number(body.formulario?.hOrdDomDiu ?? 0),
      hOrdDomNoc: Number(body.formulario?.hOrdDomNoc ?? 0),
      hExtDomDiu: Number(body.formulario?.hExtDomDiu ?? 0),
      hExtDomNoc: Number(body.formulario?.hExtDomNoc ?? 0),
    };

    const params: ParamsLaborales = {
      smmlv: paramsBD.smmlv,
      auxilioTransporte: paramsBD.auxilioTransporte,
      topeAuxilioSmmlv: paramsBD.topeAuxilioSmmlv,
      horasMaxSemana: paramsBD.horasMaxSemanaActual,
      horaInicioNocturna: paramsBD.horaInicioNocturna,
      horaFinNocturna: paramsBD.horaFinNocturna,
      recargoNocturno: paramsBD.recargoNocturno,
      recargoExtraDiurno: paramsBD.recargoExtraDiurno,
      recargoExtraNocturno: paramsBD.recargoExtraNocturno,
      recargoDominical: paramsBD.recargoDominical,
      riesgoArl: paramsBD.riesgoII, // default; el formulario puede especificar otro
    };

    // ── 5. Motor determinístico ────────────────────────────────────────────
    let fuentes: Record<string, string> = {};
    try {
      fuentes = JSON.parse(paramsBD.fuenteNormativa) as Record<string, string>;
    } catch { /* ok */ }

    const resumen = calcularResumen(turnos, formulario, params, fuentes);

    // ── 6. Respuesta ───────────────────────────────────────────────────────
    return NextResponse.json({
      ok: true,
      anio: paramsBD.anio,
      geminiDisponible: gemini !== null,
      proveedorIA,
      geminiError: gemini === null ? geminiError : undefined,
      gemini: {
        cargoDetectado:      gemini?.cargoDetectado ?? '',
        servicioDetectado:   gemini?.servicioDetectado ?? '',
        jornadaDetectada:    gemini?.jornadaDetectada ?? '',
        horasSemanalesTexto: gemini?.horasSemanalesTexto ?? 0,
        turnos,
        trabajaNocturno:     gemini?.trabajaNocturno ?? false,
        trabajaDominicales:  gemini?.trabajaDominicales ?? false,
        trabajaFestivos:     gemini?.trabajaFestivos ?? false,
        requiereHorasExtra:  gemini?.requiereHorasExtra ?? false,
        nSedes:              gemini?.nSedes ?? null,
        observaciones:       gemini === null ? '⚠️ Gemini no disponible (cuota agotada). Solo se muestra el análisis determinístico.' : gemini.observaciones ?? '',
      },
      calculo: {
        desgloseSemanal:          resumen.desgloseSemanal,
        inputsMensualesSugeridos: resumen.inputsMensualesSugeridos,
        smmlv:                    resumen.smmlv,
        auxilioTransporte:        resumen.auxilioTransporte,
        aplicaAuxilio:            resumen.aplicaAuxilio,
      },
      alertas:  resumen.alertas,
      fuentes,
      promptGemini: prompt, // para trazabilidad (E. del enunciado)
    });

  } catch (e) {
    console.error('[analizar-requisito]', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Error interno' },
      { status: 500 },
    );
  }
}