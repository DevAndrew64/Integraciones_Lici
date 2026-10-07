/**
 * Registro seguro de uso de IA multi-proveedor (Fase de costos).
 *
 * Registra únicamente: proveedor, modelo, tokens, costo estimado, módulo,
 * duración y éxito/errorCode. NUNCA registra prompts ni respuestas
 * (pueden contener datos sensibles de licitaciones).
 *
 * Persiste en la tabla existente "GeminiUsage" (histórica de uso de IA),
 * prefijando el endpoint con el proveedor para distinguirlos, evitando
 * así una tabla y migración duplicadas.
 */

import { registrarUso } from '@/lib/gemini-usage';
import type { AIAnalysisResponse } from './types';

// Precios USD por 1M tokens (entrada / salida) — julio 2026
const PRECIOS_ANTHROPIC: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 1.0, out: 5.0 },
};

export function costoEstimadoUsd(provider: string, model: string, tokensIn: number, tokensOut: number): number {
  if (provider !== 'anthropic') return 0; // Gemini calcula su costo en gemini-usage
  const base = Object.keys(PRECIOS_ANTHROPIC).find(k => model.startsWith(k));
  const precio = base ? PRECIOS_ANTHROPIC[base] : { in: 1.0, out: 5.0 };
  return (tokensIn / 1_000_000) * precio.in + (tokensOut / 1_000_000) * precio.out;
}

/**
 * Registra un uso de IA. Fire-and-forget: nunca lanza.
 * `modulo` identifica el llamador (ej: 'analisis_general_claude', 'anthropic_test').
 */
export async function registrarUsoIA(params: {
  respuesta: AIAnalysisResponse;
  modulo: string;
  duracionMs: number;
  usuarioId?: number | null;
}): Promise<void> {
  const { respuesta, modulo, duracionMs, usuarioId } = params;
  try {
    await registrarUso({
      modelo: respuesta.model,
      endpoint: `${respuesta.provider}:${modulo}`,
      tokensIn: respuesta.usage?.inputTokens ?? 0,
      tokensOut: respuesta.usage?.outputTokens ?? 0,
      perfil: respuesta.success ? 'ok' : `error:${respuesta.errorCode ?? 'desconocido'}`,
      usuarioId: usuarioId ?? null,
    });
    console.log(
      `[aiUsage] ${respuesta.provider} ${respuesta.model} modulo=${modulo} ` +
      `in=${respuesta.usage?.inputTokens ?? 0} out=${respuesta.usage?.outputTokens ?? 0} ` +
      `${duracionMs}ms exito=${respuesta.success}${respuesta.errorCode ? ` error=${respuesta.errorCode}` : ''}`,
    );
  } catch (e) {
    console.error('[aiUsage] registro falló:', e instanceof Error ? e.message.slice(0, 100) : 'error');
  }
}
