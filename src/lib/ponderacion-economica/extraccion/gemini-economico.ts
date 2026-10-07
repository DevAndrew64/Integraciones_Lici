/**
 * Llamada a Gemini para extraer criterios económicos de UN documento — FASE A.1.
 * Reutiliza el patrón de `api/ponderacion/extract-from-document`.
 * Gemini solo extrae estructura JSON; el humano ya eligió el PDF.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { registrarUso } from '@/lib/gemini-usage';
import { construirPromptExtraccionEconomica, VERSION_PROMPT } from './prompt-economico';
import { ExtraccionEconomicaSchema, VERSION_EXTRACTOR, type ExtraccionEconomica } from './schema-economico';

function parsearJSON(raw: string): Record<string, unknown> {
  const clean = raw.trim().replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  try { return JSON.parse(clean); } catch { /* continuar */ }
  const m = clean.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Gemini no devolvió JSON válido');
  return JSON.parse(m[0]);
}

export interface ResultadoExtraccionGemini {
  extraccion: ExtraccionEconomica;
  salidaCruda: Record<string, unknown>;
  modelo: string;
  versionExtractor: string;
  versionPrompt: string;
  tokensIn: number;
  tokensOut: number;
  advertencias: ExtraccionEconomica['advertencias'];
}

export async function extraerEconomicoConGemini(params: {
  texto: string;
  usuarioId: number | null;
  usuarioEmail: string;
  usuarioRol: string;
  endpoint: string;
}): Promise<ResultadoExtraccionGemini> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error('Servicio de IA no configurado (GOOGLE_AI_API_KEY)');

  const client = new GoogleGenerativeAI(apiKey);
  const prompt = construirPromptExtraccionEconomica(params.texto);
  const modelos = ['gemini-2.5-flash', 'gemini-2.5-pro'] as const;
  let lastErr: unknown;

  for (const modelId of modelos) {
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const model = client.getGenerativeModel({
          model: modelId,
          generationConfig: { maxOutputTokens: 6000, responseMimeType: 'application/json', temperature: 0.1 },
        });
        const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`Timeout 90s en ${modelId}`)), 90_000));
        const res = await Promise.race([model.generateContent([prompt]), timeout]);
        const text = res.response.text();
        if (!text?.trim()) throw new Error('Gemini devolvió respuesta vacía');
        const salidaCruda = parsearJSON(text);
        const tokensIn = res.response.usageMetadata?.promptTokenCount ?? 0;
        const tokensOut = res.response.usageMetadata?.candidatesTokenCount ?? 0;
        void registrarUso({ modelo: modelId, endpoint: params.endpoint, tokensIn, tokensOut, usuario: params.usuarioEmail, perfil: params.usuarioRol, usuarioId: params.usuarioId });

        const parsed = ExtraccionEconomicaSchema.safeParse(salidaCruda);
        if (!parsed.success) {
          // segundo intento / siguiente modelo si el JSON no cumple el schema
          lastErr = new Error(`Schema inválido: ${parsed.error.issues.map(i => i.message).join('; ')}`);
          continue;
        }
        return {
          extraccion: parsed.data,
          salidaCruda,
          modelo: modelId,
          versionExtractor: VERSION_EXTRACTOR,
          versionPrompt: VERSION_PROMPT,
          tokensIn,
          tokensOut,
          advertencias: parsed.data.advertencias,
        };
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404') || msg.includes('not found')) break;
        await new Promise(r => setTimeout(r, 2_000));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Fallo la extracción con Gemini');
}
