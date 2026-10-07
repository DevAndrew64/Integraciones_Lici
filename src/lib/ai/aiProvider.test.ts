import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock del SDK de Anthropic (conserva las clases de error reales) ─────────
const mockAnthropicCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  const Real = actual.default as unknown as Record<string, unknown>;
  class FakeAnthropic {
    messages = { create: mockAnthropicCreate };
  }
  for (const k of [
    'AuthenticationError', 'NotFoundError', 'PermissionDeniedError', 'RateLimitError',
    'APIConnectionError', 'APIConnectionTimeoutError', 'BadRequestError', 'APIError', 'APIStatusError',
  ]) {
    (FakeAnthropic as unknown as Record<string, unknown>)[k] = Real[k];
  }
  return { ...actual, default: FakeAnthropic };
});

// ─── Mock del SDK de Gemini ──────────────────────────────────────────────────
const mockGeminiGenerate = vi.fn();
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: mockGeminiGenerate };
    }
  },
}));

// ─── Mock del registro de uso (evita tocar la BD) ────────────────────────────
vi.mock('@/lib/gemini-usage', () => ({ registrarUso: vi.fn().mockResolvedValue(undefined) }));

import Anthropic from '@anthropic-ai/sdk';
import { analizarConAnthropic, _resetAnthropicClient } from './providers/anthropicProvider';
import { analizarConGemini } from './providers/geminiProvider';
import { analyzeText, resolverProveedor } from './aiProviderFactory';
import { validarSalidaAnalisis } from './analisisGeneralClaude';
import { endpointPruebaHabilitado } from './testEndpoint';
import { HAIKU_MAX_TOKENS, esProveedorValido } from './types';

const CLAVE_FALSA = 'sk-ant-test-clave-falsa-000';

function mensajeOk(text: string, stopReason = 'end_turn') {
  return {
    model: 'claude-haiku-4-5-20251001',
    content: text ? [{ type: 'text', text }] : [],
    stop_reason: stopReason,
    usage: { input_tokens: 25, output_tokens: 10 },
  };
}

/** Instancia un error del SDK con el prototipo real para que instanceof funcione. */
function errorSdk(clase: unknown): Error {
  return Object.create((clase as { prototype: object }).prototype) as Error;
}

const ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_TIMEOUT',
  'ANTHROPIC_MAX_INPUT_CHARS', 'ANTHROPIC_DEFAULT_MAX_TOKENS',
  'AI_DEFAULT_PROVIDER', 'GOOGLE_AI_API_KEY', 'GEMINI_API_KEY',
] as const;
const envBackup: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) { envBackup[k] = process.env[k]; delete process.env[k]; }
  mockAnthropicCreate.mockReset();
  mockGeminiGenerate.mockReset();
  _resetAnthropicClient();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
});

// ─── Proveedor Anthropic ─────────────────────────────────────────────────────

describe('anthropicProvider', () => {
  it('clave ausente → errorCode clave_ausente, sin llamar al SDK', async () => {
    const r = await analizarConAnthropic({ systemPrompt: 's', userPrompt: 'u' });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('clave_ausente');
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  it('respuesta exitosa simulada → normalizada con usage', async () => {
    process.env.ANTHROPIC_API_KEY = CLAVE_FALSA;
    mockAnthropicCreate.mockResolvedValue(mensajeOk('hola'));
    const r = await analizarConAnthropic({ systemPrompt: 's', userPrompt: 'u' });
    expect(r).toMatchObject({
      success: true,
      provider: 'anthropic',
      text: 'hola',
      usage: { inputTokens: 25, outputTokens: 10 },
      stopReason: 'end_turn',
    });
    expect(r.model).toContain('haiku');
  });

  it('usa ANTHROPIC_MODEL de entorno (no hardcodeado)', async () => {
    process.env.ANTHROPIC_API_KEY = CLAVE_FALSA;
    process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5';
    mockAnthropicCreate.mockResolvedValue(mensajeOk('x'));
    await analizarConAnthropic({ systemPrompt: '', userPrompt: 'u' });
    expect(mockAnthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5', temperature: 0 }),
    );
  });

  it('modelo no autorizado (404) → modelo_no_autorizado', async () => {
    process.env.ANTHROPIC_API_KEY = CLAVE_FALSA;
    mockAnthropicCreate.mockRejectedValue(errorSdk(Anthropic.NotFoundError));
    const r = await analizarConAnthropic({ systemPrompt: '', userPrompt: 'u' });
    expect(r.errorCode).toBe('modelo_no_autorizado');
  });

  it('clave inválida (401) → clave_invalida', async () => {
    process.env.ANTHROPIC_API_KEY = CLAVE_FALSA;
    mockAnthropicCreate.mockRejectedValue(errorSdk(Anthropic.AuthenticationError));
    const r = await analizarConAnthropic({ systemPrompt: '', userPrompt: 'u' });
    expect(r.errorCode).toBe('clave_invalida');
  });

  it('timeout → timeout', async () => {
    process.env.ANTHROPIC_API_KEY = CLAVE_FALSA;
    mockAnthropicCreate.mockRejectedValue(errorSdk(Anthropic.APIConnectionTimeoutError));
    const r = await analizarConAnthropic({ systemPrompt: '', userPrompt: 'u' });
    expect(r.errorCode).toBe('timeout');
  });

  it('rate limit (429) → rate_limit', async () => {
    process.env.ANTHROPIC_API_KEY = CLAVE_FALSA;
    mockAnthropicCreate.mockRejectedValue(errorSdk(Anthropic.RateLimitError));
    const r = await analizarConAnthropic({ systemPrompt: '', userPrompt: 'u' });
    expect(r.errorCode).toBe('rate_limit');
  });

  it('respuesta vacía → respuesta_vacia', async () => {
    process.env.ANTHROPIC_API_KEY = CLAVE_FALSA;
    mockAnthropicCreate.mockResolvedValue(mensajeOk(''));
    const r = await analizarConAnthropic({ systemPrompt: '', userPrompt: 'u' });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe('respuesta_vacia');
  });

  it('respuesta cortada por max_tokens → success con respuesta_truncada', async () => {
    process.env.ANTHROPIC_API_KEY = CLAVE_FALSA;
    mockAnthropicCreate.mockResolvedValue(mensajeOk('parcial', 'max_tokens'));
    const r = await analizarConAnthropic({ systemPrompt: '', userPrompt: 'u' });
    expect(r.success).toBe(true);
    expect(r.errorCode).toBe('respuesta_truncada');
  });

  it('límite de caracteres de entrada → entrada_demasiado_larga, sin llamar al SDK', async () => {
    process.env.ANTHROPIC_API_KEY = CLAVE_FALSA;
    process.env.ANTHROPIC_MAX_INPUT_CHARS = '100';
    const r = await analizarConAnthropic({ systemPrompt: '', userPrompt: 'x'.repeat(101) });
    expect(r.errorCode).toBe('entrada_demasiado_larga');
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  it('no expone secretos en la respuesta normalizada', async () => {
    process.env.ANTHROPIC_API_KEY = CLAVE_FALSA;
    mockAnthropicCreate.mockResolvedValue(mensajeOk('ok'));
    const r = await analizarConAnthropic({ systemPrompt: 's', userPrompt: 'u' });
    expect(JSON.stringify(r)).not.toContain(CLAVE_FALSA);
  });
});

// ─── Adaptador Gemini (sin tocar los módulos productivos) ────────────────────

describe('geminiProvider (adaptador)', () => {
  it('respuesta exitosa simulada → normalizada', async () => {
    process.env.GOOGLE_AI_API_KEY = 'clave-gemini-falsa';
    mockGeminiGenerate.mockResolvedValue({
      response: {
        text: () => 'respuesta gemini',
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7 },
      },
    });
    const r = await analizarConGemini({ systemPrompt: 's', userPrompt: 'u' });
    expect(r).toMatchObject({
      success: true,
      provider: 'gemini',
      text: 'respuesta gemini',
      usage: { inputTokens: 5, outputTokens: 7 },
    });
  });

  it('clave ausente → clave_ausente', async () => {
    const r = await analizarConGemini({ systemPrompt: '', userPrompt: 'u' });
    expect(r.errorCode).toBe('clave_ausente');
  });
});

// ─── Selector de proveedor ───────────────────────────────────────────────────

describe('aiProviderFactory', () => {
  it('sin provider ni AI_DEFAULT_PROVIDER → gemini (comportamiento actual)', () => {
    expect(resolverProveedor(undefined)).toBe('gemini');
  });

  it('AI_DEFAULT_PROVIDER=gemini → gemini', () => {
    process.env.AI_DEFAULT_PROVIDER = 'gemini';
    expect(resolverProveedor(undefined)).toBe('gemini');
  });

  it('AI_DEFAULT_PROVIDER=anthropic → anthropic solo si no hay provider explícito', () => {
    process.env.AI_DEFAULT_PROVIDER = 'anthropic';
    expect(resolverProveedor(undefined)).toBe('anthropic');
    expect(resolverProveedor('gemini')).toBe('gemini');
  });

  it('valores fuera de la lista permitida se ignoran (sin fallback silencioso)', () => {
    expect(resolverProveedor('openai')).toBe('gemini');
    expect(resolverProveedor({ hack: true })).toBe('gemini');
    expect(esProveedorValido('anthropic')).toBe(true);
    expect(esProveedorValido('openai')).toBe(false);
  });

  it('elección explícita provider=anthropic invoca a Anthropic', async () => {
    process.env.ANTHROPIC_API_KEY = CLAVE_FALSA;
    mockAnthropicCreate.mockResolvedValue(mensajeOk('desde claude'));
    const r = await analyzeText(
      { systemPrompt: 's', userPrompt: 'u', provider: 'anthropic' },
      { modulo: 'test' },
    );
    expect(r.provider).toBe('anthropic');
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    expect(mockGeminiGenerate).not.toHaveBeenCalled();
  });

  it('por defecto invoca a Gemini y NO a Anthropic (sin fallback entre proveedores)', async () => {
    process.env.GOOGLE_AI_API_KEY = 'clave-gemini-falsa';
    mockGeminiGenerate.mockResolvedValue({
      response: { text: () => 'gemini ok', usageMetadata: undefined },
    });
    const r = await analyzeText({ systemPrompt: 's', userPrompt: 'u' }, { modulo: 'test' });
    expect(r.provider).toBe('gemini');
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });
});

// ─── Caso de uso analisis_general_claude ─────────────────────────────────────

describe('validarSalidaAnalisis', () => {
  const valido = {
    resumen: 'Texto de prueba.',
    hallazgos: ['a'],
    riesgos: [],
    datosFaltantes: ['b'],
    nivelConfianza: 'medio',
  };

  it('acepta JSON válido (incluso con fences de markdown)', () => {
    expect(validarSalidaAnalisis(JSON.stringify(valido)).nivelConfianza).toBe('medio');
    expect(validarSalidaAnalisis('```json\n' + JSON.stringify(valido) + '\n```').resumen)
      .toBe('Texto de prueba.');
  });

  it('rechaza JSON inválido', () => {
    expect(() => validarSalidaAnalisis('no es json')).toThrow(/JSON válido/);
  });

  it('rechaza JSON que no cumple el esquema', () => {
    expect(() => validarSalidaAnalisis(JSON.stringify({ ...valido, nivelConfianza: 'altísimo' })))
      .toThrow(/esquema/);
    expect(() => validarSalidaAnalisis(JSON.stringify({ ...valido, hallazgos: 'no-array' })))
      .toThrow(/esquema/);
  });
});

// ─── Perfil Haiku y guardia del endpoint ─────────────────────────────────────

describe('perfil Haiku y endpoint de prueba', () => {
  it('límites de tokens por tipo de tarea', () => {
    expect(HAIKU_MAX_TOKENS).toEqual({
      clasificacion: 150,
      extraccion_breve: 300,
      resumen: 400,
      analisis_general: 600,
      analisis_profundo: 1200,
    });
  });

  it('endpoint de prueba deshabilitado en producción salvo habilitación explícita', () => {
    expect(endpointPruebaHabilitado({ NODE_ENV: 'production' })).toBe(false);
    expect(endpointPruebaHabilitado({ NODE_ENV: 'production', ANTHROPIC_TEST_ENDPOINT_ENABLED: '1' })).toBe(true);
    expect(endpointPruebaHabilitado({ NODE_ENV: 'development' })).toBe(true);
    expect(endpointPruebaHabilitado({ NODE_ENV: 'test' })).toBe(true);
  });
});
