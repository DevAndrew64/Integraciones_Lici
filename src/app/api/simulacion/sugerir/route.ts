import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSession } from '@/lib/session';
import { resolveSessionUserId } from '@/lib/authz';
import { registrarUso } from '@/lib/gemini-usage';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // ── Autenticación ──────────────────────────────────────────────────────────
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });

  const usuarioId = await resolveSessionUserId(session);

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'Servicio de IA no disponible.' },
      { status: 503 }
    );
  }

  let body: {
    objeto?: string;
    modalidad?: string;
    presupuesto?: number;
    departamento?: string;
    pm?: number;
    numCompetidores?: number;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 });
  }

  const {
    objeto = '',
    modalidad = '',
    presupuesto,
    departamento = '',
    pm = 39.5,
    numCompetidores = 3,
  } = body;

  if (!objeto.trim()) {
    return NextResponse.json(
      { ok: false, error: 'El campo "objeto" es obligatorio.' },
      { status: 400 }
    );
  }

  const presupuestoStr = presupuesto
    ? `$${presupuesto.toLocaleString('es-CO')} COP`
    : 'no especificado';

  const prompt = `Eres un experto en contratación pública colombiana bajo el marco del Decreto 1082/2015 y SECOP II.

Se te describe un proceso licitatorio con las siguientes características:
- Objeto del contrato: ${objeto.trim()}
- Modalidad de contratación: ${modalidad || 'no especificada'}
- Presupuesto oficial: ${presupuestoStr}
- Departamento/ciudad: ${departamento || 'no especificado'}
- Puntaje máximo económico (PM): ${pm}

Debes estimar cuántos competidores típicamente participan en este tipo de proceso y a qué porcentaje del presupuesto oficial suelen presentar sus ofertas. Considera:
- Empresas que ofrecen muy cerca del 100% (98-100%): propuestas conservadoras
- Empresas en rango medio (85-95%): competidores moderados
- Empresas agresivas (70-85%): descuentos significativos
- En Colombia, ofertas bajo el 70% del presupuesto son raras y generalmente indican problemas

Responde ÚNICAMENTE con un objeto JSON válido (sin texto adicional, sin markdown, sin bloques de código) con esta estructura exacta:
{
  "competidores": [
    {"nombre": "Competidor A", "pct": 95.5},
    {"nombre": "Competidor B", "pct": 88.0},
    {"nombre": "Competidor C", "pct": 92.0}
  ],
  "contexto": "Breve explicación de 1-2 oraciones sobre por qué estos rangos son típicos para este tipo de proceso."
}

Genera exactamente ${Math.min(Math.max(numCompetidores, 2), 6)} competidores con porcentajes realistas para Colombia.`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 0.4,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(prompt);
    void registrarUso({
      modelo: 'gemini-2.5-flash-lite',
      endpoint: 'simulacion/sugerir',
      tokensIn: result.response.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: result.response.usageMetadata?.candidatesTokenCount ?? 0,
      usuario: session.email,
      usuarioId,
    });
    const raw = result.response.text().trim();

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[sugerir] Respuesta no JSON:', raw);
      return NextResponse.json(
        { ok: false, error: 'La IA no devolvió un JSON válido.' },
        { status: 502 }
      );
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      competidores?: { nombre: string; pct: number }[];
      contexto?: string;
    };

    const competidores = (parsed.competidores ?? [])
      .filter(c => typeof c.pct === 'number' && c.pct > 0 && c.pct <= 105)
      .map(c => ({
        nombre: String(c.nombre ?? 'Competidor'),
        pct: Math.round(c.pct * 10) / 10,
      }));

    return NextResponse.json({
      ok: true,
      competidores,
      contexto: String(parsed.contexto ?? ''),
    });
  } catch (err) {
    console.error('[POST /api/simulacion/sugerir]', err);
    const msg = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}