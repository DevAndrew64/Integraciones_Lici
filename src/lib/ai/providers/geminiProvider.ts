/**
 * Adaptador de Gemini a la interfaz común de proveedores.
 *
 * IMPORTANTE: los módulos productivos existentes siguen llamando a Gemini
 * directamente (no fueron migrados). Este adaptador existe para que el
 * selector de proveedores pueda ofrecer Gemini con la misma firma que
 * Anthropic en casos de uso NUEVOS.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_MODEL_DEFAULT, clasificarErrorGemini } from '@/lib/gemini-models';
import type { AIAnalysisRequest, AIAnalysisResponse, AIErrorCode } from '../types';

function respuestaError(model: string, errorCode: AIErrorCode): AIAnalysisResponse {
  return { success: false, provider: 'gemini', model, text: '', errorCode };
}

export async function analizarConGemini(req: AIAnalysisRequest): Promise<AIAnalysisResponse> {
  const apiKey = process.env.GOOGLE_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || '';
  const modelo = GEMINI_MODEL_DEFAULT;

  if (!apiKey) return respuestaError(modelo, 'clave_ausente');

  const maxInputChars = Number(process.env.ANTHROPIC_MAX_INPUT_CHARS) || 12_000;
  const totalChars = (req.systemPrompt?.length ?? 0) + (req.userPrompt?.length ?? 0);
  if (totalChars > maxInputChars) return respuestaError(modelo, 'entrada_demasiado_larga');

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelo,
      systemInstruction: req.systemPrompt || undefined,
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 600,
        temperature: req.temperature ?? 0,
      },
    });
    const result = await model.generateContent(req.userPrompt);
    const text = result.response.text().trim();
    const usage = result.response.usageMetadata;

    if (!text) return respuestaError(modelo, 'respuesta_vacia');

    return {
      success: true,
      provider: 'gemini',
      model: modelo,
      text,
      usage: {
        inputTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
      },
    };
  } catch (e) {
    const tipo = clasificarErrorGemini(e);
    const errorCode: AIErrorCode =
      tipo === 'break' ? 'clave_invalida' :
      tipo === 'retry' ? 'rate_limit' :
      tipo === 'skip' ? 'modelo_no_autorizado' :
      'error_desconocido';
    console.error('[geminiProvider]', errorCode, e instanceof Error ? e.message.slice(0, 200) : '');
    return respuestaError(modelo, errorCode);
  }
}
