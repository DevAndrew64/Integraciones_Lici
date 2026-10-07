/**
 * Proveedor Anthropic Claude (segundo proveedor de IA de LICYCOLBA).
 *
 * - Solo backend. La clave viene de ANTHROPIC_API_KEY y nunca se expone.
 * - El modelo se configura con ANTHROPIC_MODEL (Claude Haiku por defecto);
 *   no se fija un modelo distinto en los llamadores.
 * - Devuelve siempre una respuesta normalizada AIAnalysisResponse; nunca
 *   la respuesta cruda del SDK ni detalles internos hacia el frontend.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AIAnalysisRequest, AIAnalysisResponse, AIErrorCode } from '../types';
import { HAIKU_TEMPERATURE } from '../types';

const MODELO_FALLBACK = 'claude-haiku-4-5';

function config() {
  return {
    apiKey: process.env.ANTHROPIC_API_KEY?.trim() || '',
    model: process.env.ANTHROPIC_MODEL?.trim() || MODELO_FALLBACK,
    timeoutMs: (Number(process.env.ANTHROPIC_TIMEOUT) || 45) * 1000,
    maxInputChars: Number(process.env.ANTHROPIC_MAX_INPUT_CHARS) || 20_000,
    defaultMaxTokens: Number(process.env.ANTHROPIC_DEFAULT_MAX_TOKENS) || 600,
  };
}

let _client: Anthropic | null = null;
function getClient(apiKey: string, timeoutMs: number): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  }
  return _client;
}

/** Solo para tests: descarta el cliente cacheado. */
export function _resetAnthropicClient(): void {
  _client = null;
}

function respuestaError(model: string, errorCode: AIErrorCode): AIAnalysisResponse {
  return { success: false, provider: 'anthropic', model, text: '', errorCode };
}

/** Mapea errores del SDK a códigos estables sin filtrar detalles internos. */
function clasificarError(e: unknown): AIErrorCode {
  if (e instanceof Anthropic.AuthenticationError) return 'clave_invalida';
  if (e instanceof Anthropic.NotFoundError) return 'modelo_no_autorizado';
  if (e instanceof Anthropic.PermissionDeniedError) {
    return e.type === 'billing_error' ? 'saldo_insuficiente' : 'permiso_denegado';
  }
  if (e instanceof Anthropic.RateLimitError) return 'rate_limit';
  if (e instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (e instanceof Anthropic.APIConnectionError) return 'error_red';
  if (e instanceof Anthropic.BadRequestError) {
    const msg = String(e.message).toLowerCase();
    if (msg.includes('credit') || msg.includes('billing')) return 'saldo_insuficiente';
    if (msg.includes('model')) return 'modelo_no_autorizado';
    return 'error_desconocido';
  }
  return 'error_desconocido';
}

export async function analizarConAnthropic(req: AIAnalysisRequest): Promise<AIAnalysisResponse> {
  const cfg = config();

  if (!cfg.apiKey) return respuestaError(cfg.model, 'clave_ausente');

  const totalChars = (req.systemPrompt?.length ?? 0) + (req.userPrompt?.length ?? 0);
  if (totalChars > cfg.maxInputChars) {
    return respuestaError(cfg.model, 'entrada_demasiado_larga');
  }

  try {
    const client = getClient(cfg.apiKey, cfg.timeoutMs);
    const message = await client.messages.create({
      model: cfg.model,
      max_tokens: req.maxTokens ?? cfg.defaultMaxTokens,
      temperature: req.temperature ?? HAIKU_TEMPERATURE,
      system: req.systemPrompt || undefined,
      messages: [{ role: 'user', content: req.userPrompt }],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    if (!text) {
      return {
        ...respuestaError(message.model, 'respuesta_vacia'),
        stopReason: message.stop_reason ?? undefined,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
      };
    }

    return {
      success: true,
      provider: 'anthropic',
      model: message.model,
      text,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
      stopReason: message.stop_reason ?? undefined,
      // Respuesta cortada por max_tokens: se marca para que el llamador decida
      ...(message.stop_reason === 'max_tokens' ? { errorCode: 'respuesta_truncada' as const } : {}),
    };
  } catch (e) {
    const errorCode = clasificarError(e);
    console.error('[anthropicProvider]', errorCode, e instanceof Error ? e.message.slice(0, 200) : '');
    return respuestaError(cfg.model, errorCode);
  }
}
