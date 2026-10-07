/**
 * Interfaz común de proveedores de IA de LICYCOLBA.
 *
 * Gemini es el proveedor principal (los módulos productivos existentes lo usan
 * directamente y NO fueron migrados). Anthropic Claude es el segundo proveedor,
 * pensado para análisis de bajo costo con Claude Haiku.
 *
 * Solo backend: este módulo nunca debe importarse desde componentes cliente.
 */

export type AIProviderName = 'gemini' | 'anthropic';

/** Lista permitida para validar valores que lleguen del navegador. */
export const AI_PROVIDERS: readonly AIProviderName[] = ['gemini', 'anthropic'];

export function esProveedorValido(v: unknown): v is AIProviderName {
  return typeof v === 'string' && (AI_PROVIDERS as readonly string[]).includes(v);
}

export interface AIAnalysisRequest {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  provider?: AIProviderName;
  /** Metadatos para logging (modulo, usuarioId…). Nunca se envían al proveedor. */
  metadata?: Record<string, unknown>;
}

export interface AIAnalysisResponse {
  success: boolean;
  provider: AIProviderName;
  model: string;
  text: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  stopReason?: string;
  /** Código estable de error (nunca contiene claves ni respuestas crudas). */
  errorCode?: AIErrorCode;
}

export type AIErrorCode =
  | 'clave_ausente'
  | 'clave_invalida'
  | 'permiso_denegado'
  | 'modelo_no_autorizado'
  | 'saldo_insuficiente'
  | 'rate_limit'
  | 'timeout'
  | 'error_red'
  | 'respuesta_vacia'
  | 'respuesta_truncada'
  | 'entrada_demasiado_larga'
  | 'proveedor_invalido'
  | 'error_desconocido';

// ─── Perfil de bajo costo para Claude Haiku ──────────────────────────────────

export type TipoTareaHaiku =
  | 'clasificacion'
  | 'extraccion_breve'
  | 'resumen'
  | 'analisis_general'
  | 'analisis_profundo';

/**
 * Límites de max_tokens por tipo de tarea (perfil Haiku de bajo costo).
 * Una llamada por análisis, sin historial, sin extended thinking,
 * contexto mínimo. No usar Claude para cálculos exactos resolubles en código.
 */
export const HAIKU_MAX_TOKENS: Record<TipoTareaHaiku, number> = {
  clasificacion: 150,
  extraccion_breve: 300,
  resumen: 400,
  analisis_general: 600,
  analisis_profundo: 1200,
};

/** Temperatura por defecto del perfil Haiku (determinístico). */
export const HAIKU_TEMPERATURE = 0;
