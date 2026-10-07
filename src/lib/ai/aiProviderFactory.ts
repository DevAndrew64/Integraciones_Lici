/**
 * Selector central de proveedores de IA.
 *
 * Reglas:
 *   1. Se usa request.provider si viene (validado contra la lista permitida).
 *   2. Si no, AI_DEFAULT_PROVIDER (validado).
 *   3. Si no, Gemini — el proveedor principal, para no alterar el
 *      comportamiento actual.
 *   4. Sin fallback automático entre proveedores: si el elegido falla,
 *      la respuesta lleva errorCode y el llamador decide.
 *   5. Nunca se cambia silenciosamente a un modelo más costoso.
 */

import type { AIAnalysisRequest, AIAnalysisResponse, AIProviderName } from './types';
import { esProveedorValido } from './types';
import { analizarConAnthropic } from './providers/anthropicProvider';
import { analizarConGemini } from './providers/geminiProvider';
import { registrarUsoIA } from './aiUsage';

export function resolverProveedor(solicitado?: unknown): AIProviderName {
  if (esProveedorValido(solicitado)) return solicitado;
  const porDefecto = process.env.AI_DEFAULT_PROVIDER?.trim().toLowerCase();
  if (esProveedorValido(porDefecto)) return porDefecto;
  return 'gemini';
}

/**
 * Punto de entrada único para análisis de texto multi-proveedor.
 * `modulo` identifica el llamador para el registro de costos.
 */
export async function analyzeText(
  req: AIAnalysisRequest,
  opciones?: { modulo?: string; usuarioId?: number | null },
): Promise<AIAnalysisResponse> {
  const provider = resolverProveedor(req.provider);
  const inicio = Date.now();

  const respuesta =
    provider === 'anthropic'
      ? await analizarConAnthropic(req)
      : await analizarConGemini(req);

  void registrarUsoIA({
    respuesta,
    modulo: opciones?.modulo ?? String(req.metadata?.modulo ?? 'desconocido'),
    duracionMs: Date.now() - inicio,
    usuarioId: opciones?.usuarioId,
  });

  return respuesta;
}
