import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { registrarUso } from '@/lib/gemini-usage';
import { getSession } from '@/lib/session';
import { requireSession, resolveSessionUserId } from '@/lib/authz';
import { GEMINI_MODELS } from '@/lib/gemini-models';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EMPRESAS = ['Aseocolba', 'Vigicolba', 'Tempocolba', 'Transcolba'];


const PROMPT = `Eres un asistente que extrae metadatos de documentos corporativos (certificados, contratos, pólizas, permisos, acreditaciones, etc.).

Analiza el documento y responde ÚNICAMENTE con este JSON. No incluyas texto fuera del JSON.

{
  "nombre": "nombre oficial del documento tal como aparece en el encabezado o título",
  "codigo": "código o número del documento (ej: C-01, ISO 9001:2015, CEC-0045) o null si no aparece",
  "empresa": "una de: Aseocolba | Vigicolba | Tempocolba | Transcolba | null",
  "fechaEmision": "YYYY-MM-DD o null",
  "fechaVencimiento": "YYYY-MM-DD o null",
  "vigenciaDias": 365
}

Reglas:
- empresa: identifica cuál empresa del Grupo Colba es titular/beneficiaria. Solo puede ser una de las 4 opciones o null.
- fechaEmision: fecha de expedición/emisión/otorgamiento. Formato YYYY-MM-DD.
- fechaVencimiento: fecha de vencimiento/expiración/caducidad. Formato YYYY-MM-DD.
- vigenciaDias: número entero, solo si el documento dice explícitamente "vigencia de X días" o similar, si no usa null.
- Si un campo no está en el documento, usa null.
- nombre: máximo 120 caracteres.`;

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  const usuarioId = await resolveSessionUserId(session!);

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'Servicio de análisis no configurado (API key ausente).' }, { status: 503 });
  }

  let body: { pdfBase64?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 });
  }

  const { pdfBase64 } = body;
  if (!pdfBase64?.trim()) {
    return NextResponse.json({ ok: false, error: 'Se requiere pdfBase64.' }, { status: 400 });
  }

  // ── Extraer texto del PDF ──────────────────────────────────────────────────
  let texto = '';
  try {
    const buf = Buffer.from(pdfBase64, 'base64');
    const parsed = await pdfParse(buf);
    texto = (parsed.text || '').slice(0, 14_000);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[docs/analizar] pdf-parse error:', msg);
    return NextResponse.json({ ok: false, error: `No se pudo leer el PDF: ${msg.slice(0, 120)}` }, { status: 422 });
  }

  if (!texto.trim() || texto.trim().length < 20) {
    return NextResponse.json({ ok: false, error: 'El PDF no contiene texto extraíble. Puede ser un documento escaneado o estar protegido.' }, { status: 422 });
  }

  // ── Llamar a Gemini con fallback de modelos ────────────────────────────────
  const client = new GoogleGenerativeAI(apiKey);
  const errores: string[] = [];

  for (const modelId of GEMINI_MODELS) {
    try {
      const model = client.getGenerativeModel({
        model: modelId,
        generationConfig: { maxOutputTokens: 600, temperature: 0.1 },
      });

      const result = await model.generateContent(
        `${PROMPT}\n\n---\nDOCUMENTO:\n\n${texto}`
      );
      void registrarUso({
        modelo: modelId,
        endpoint: 'docs/analizar',
        tokensIn: result.response.usageMetadata?.promptTokenCount ?? 0,
        tokensOut: result.response.usageMetadata?.candidatesTokenCount ?? 0,
        usuario: session!.email,
        usuarioId,
      });
      const raw = result.response.text().trim();

      // Parsear JSON de la respuesta
      let datos: Record<string, unknown>;
      try {
        const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const match = clean.match(/\{[\s\S]*\}/);
        datos = JSON.parse(match ? match[0] : clean);
      } catch {
        console.error(`[docs/analizar] ${modelId} JSON parse error. raw:`, raw.slice(0, 300));
        errores.push(`${modelId}: Respuesta de IA no parseable`);
        continue;
      }

      const empresa = EMPRESAS.includes(String(datos.empresa ?? '')) ? String(datos.empresa) : null;
      const toDate = (v: unknown) => {
        if (!v || typeof v !== 'string') return null;
        return /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null;
      };
      const toInt = (v: unknown) => {
        const n = Number(v);
        return Number.isInteger(n) && n > 0 ? n : null;
      };

      console.log(`[docs/analizar] OK con ${modelId}, errores previos:`, errores);
      return NextResponse.json({
        ok: true,
        modelo: modelId,
        nombre: typeof datos.nombre === 'string' ? datos.nombre.slice(0, 120).trim() : null,
        codigo: typeof datos.codigo === 'string' ? datos.codigo.slice(0, 30).trim() : null,
        empresa,
        fechaEmision: toDate(datos.fechaEmision),
        fechaVencimiento: toDate(datos.fechaVencimiento),
        vigenciaDias: toInt(datos.vigenciaDias),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errores.push(`${modelId}: ${msg.slice(0, 200)}`);
      console.error(`[docs/analizar] ${modelId} error:`, msg.slice(0, 300));
      const esQuota = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota');
      if (esQuota) await new Promise(r => setTimeout(r, 2000));
      continue;
    }
  }

  return NextResponse.json({
    ok: false,
    error: `Error al analizar el documento: ${errores[errores.length - 1]?.slice(0, 200) ?? 'error desconocido'}`,
    errores,
  }, { status: 500 });
}