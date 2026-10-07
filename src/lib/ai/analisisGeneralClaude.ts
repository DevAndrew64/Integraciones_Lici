/**
 * Caso de uso aislado: analisis_general_claude.
 *
 * Análisis general de bajo costo con Claude Haiku (perfil de 600 tokens).
 * NO está conectado a los análisis productivos de licitaciones — es un caso
 * de uso nuevo, para validación separada antes de cualquier adopción.
 */

import { analizarConAnthropic } from './providers/anthropicProvider';
import { HAIKU_MAX_TOKENS, HAIKU_TEMPERATURE } from './types';

export interface AnalisisGeneralInput {
  contenido: string;
  provider?: 'anthropic';
  usuarioId?: number | null;
}

export interface AnalisisGeneralOutput {
  resumen: string;
  hallazgos: string[];
  riesgos: string[];
  datosFaltantes: string[];
  nivelConfianza: 'alto' | 'medio' | 'bajo';
  provider: 'anthropic';
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

const SYSTEM_PROMPT = `Eres un analista de documentos de LICYCOLBA (licitaciones públicas en Colombia).
Analiza el texto que recibas y responde ÚNICAMENTE con un objeto JSON válido, sin markdown ni texto adicional, con esta forma exacta:
{
  "resumen": "<resumen breve en español, máximo 3 frases>",
  "hallazgos": ["<hallazgo relevante>", ...],
  "riesgos": ["<riesgo identificado>", ...],
  "datosFaltantes": ["<dato que falta para un análisis completo>", ...],
  "nivelConfianza": "alto" | "medio" | "bajo"
}
Los arreglos pueden estar vacíos. No inventes datos que no estén en el texto.`;

function esArregloDeStrings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

/** Valida y normaliza el JSON devuelto por el modelo. Lanza si es inválido. */
export function validarSalidaAnalisis(text: string): Omit<AnalisisGeneralOutput, 'provider' | 'model' | 'usage'> {
  // Tolerar fences de markdown que el modelo pueda agregar
  const limpio = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(limpio);
  } catch {
    throw new Error('El modelo no devolvió JSON válido');
  }
  const o = parsed as Record<string, unknown>;
  if (
    typeof o !== 'object' || o === null ||
    typeof o.resumen !== 'string' || !o.resumen.trim() ||
    !esArregloDeStrings(o.hallazgos) ||
    !esArregloDeStrings(o.riesgos) ||
    !esArregloDeStrings(o.datosFaltantes) ||
    !['alto', 'medio', 'bajo'].includes(String(o.nivelConfianza))
  ) {
    throw new Error('El JSON del modelo no cumple el esquema esperado');
  }
  return {
    resumen: o.resumen.trim(),
    hallazgos: o.hallazgos,
    riesgos: o.riesgos,
    datosFaltantes: o.datosFaltantes,
    nivelConfianza: o.nivelConfianza as 'alto' | 'medio' | 'bajo',
  };
}

export async function analisisGeneralClaude(input: AnalisisGeneralInput): Promise<AnalisisGeneralOutput> {
  const contenido = input.contenido?.trim();
  if (!contenido) throw new Error('Contenido vacío');

  const respuesta = await analizarConAnthropic({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: contenido,
    maxTokens: HAIKU_MAX_TOKENS.analisis_general,
    temperature: HAIKU_TEMPERATURE,
  });

  if (!respuesta.success) {
    throw new Error(`Análisis no disponible (${respuesta.errorCode ?? 'error'})`);
  }

  const validado = validarSalidaAnalisis(respuesta.text);
  return {
    ...validado,
    provider: 'anthropic',
    model: respuesta.model,
    usage: {
      inputTokens: respuesta.usage?.inputTokens ?? 0,
      outputTokens: respuesta.usage?.outputTokens ?? 0,
    },
  };
}
