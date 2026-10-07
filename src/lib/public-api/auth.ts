/**
 * Autenticación por API Key para la API pública (/api/public/v1).
 *
 * - Clave SOLO por header `X-API-Key` (nunca en URL ni query params).
 * - Formato: lcb_<prefijo 12 hex>_<secreto 40 hex>. En BD solo se guarda el
 *   prefijo (lookup) y el SHA-256 hex de la clave completa.
 * - Cada cliente tiene scopes, empresas permitidas y rate limit propios.
 * - Rate limit: ventana fija por minuto en memoria del proceso (el proceso corre
 *   una instancia; si se escala horizontalmente debe migrarse a Postgres/Redis
 *   — documentado en docs/api-publica-indicadores-procesos.md).
 */

import { createHash, timingSafeEqual, randomBytes, randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';

export const SCOPE_INDICADORES = 'procesos:indicadores:read';
export const SCOPE_DETALLE = 'procesos:detalle:read';

export interface ApiClientRegistro {
  id: number;
  nombre: string;
  apiKeyHash: string;
  activo: boolean;
  scopes: string[];
  empresasPermitidas: string[];
  rateLimitPorMinuto: number;
  expiraEn: Date | null;
}

// ─── Clave: generación y hash ────────────────────────────────────────────────

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** Genera una clave nueva. La clave completa se muestra UNA sola vez. */
export function generarApiKey(): { key: string; prefix: string; hash: string } {
  const prefix = randomBytes(6).toString('hex');           // 12 hex
  const secret = randomBytes(20).toString('hex');          // 40 hex
  const key = `lcb_${prefix}_${secret}`;
  return { key, prefix, hash: hashApiKey(key) };
}

/** Extrae el prefijo de una clave con formato válido; null si el formato no coincide. */
export function extraerPrefijo(key: string): string | null {
  const m = /^lcb_([0-9a-f]{12})_[0-9a-f]{40}$/.exec(key);
  return m ? m[1] : null;
}

// ─── Verificación pura (testeable sin BD) ────────────────────────────────────

export type ErrorAuth =
  | 'clave_ausente' | 'clave_invalida' | 'clave_deshabilitada'
  | 'clave_expirada' | 'scope_insuficiente' | 'rate_limit';

export function verificarClaveContraRegistro(
  key: string,
  registro: ApiClientRegistro | null,
  scopeRequerido: string,
  ahora: Date = new Date(),
): { ok: true } | { ok: false; error: ErrorAuth } {
  if (!registro) return { ok: false, error: 'clave_invalida' };

  const hashEntrada = Buffer.from(hashApiKey(key), 'hex');
  const hashGuardado = Buffer.from(registro.apiKeyHash, 'hex');
  if (hashEntrada.length !== hashGuardado.length || !timingSafeEqual(hashEntrada, hashGuardado)) {
    return { ok: false, error: 'clave_invalida' };
  }
  if (!registro.activo) return { ok: false, error: 'clave_deshabilitada' };
  if (registro.expiraEn && registro.expiraEn.getTime() <= ahora.getTime()) {
    return { ok: false, error: 'clave_expirada' };
  }
  if (!registro.scopes.includes(scopeRequerido)) {
    return { ok: false, error: 'scope_insuficiente' };
  }
  return { ok: true };
}

// ─── Rate limit en memoria (ventana fija por minuto) ─────────────────────────

export class RateLimiterMemoria {
  private ventanas = new Map<number, { minuto: number; usos: number }>();

  /** true si el uso está permitido; registra el consumo. */
  permitir(clienteId: number, limitePorMinuto: number, ahoraMs: number = Date.now()): boolean {
    const minuto = Math.floor(ahoraMs / 60_000);
    const v = this.ventanas.get(clienteId);
    if (!v || v.minuto !== minuto) {
      this.ventanas.set(clienteId, { minuto, usos: 1 });
      return true;
    }
    if (v.usos >= limitePorMinuto) return false;
    v.usos++;
    return true;
  }
}

const limiter = new RateLimiterMemoria();

// ─── Respuestas normalizadas ─────────────────────────────────────────────────

const HTTP_POR_ERROR: Record<ErrorAuth, number> = {
  clave_ausente: 401, clave_invalida: 401, clave_deshabilitada: 403,
  clave_expirada: 403, scope_insuficiente: 403, rate_limit: 429,
};

const MENSAJE_POR_ERROR: Record<ErrorAuth, string> = {
  clave_ausente: 'Falta el header X-API-Key',
  clave_invalida: 'API Key inválida',
  clave_deshabilitada: 'API Key deshabilitada',
  clave_expirada: 'API Key expirada',
  scope_insuficiente: 'La API Key no tiene el scope requerido',
  rate_limit: 'Límite de solicitudes por minuto excedido',
};

export function nuevoRequestId(): string {
  return randomUUID();
}

export function respuestaErrorPublica(
  status: number, code: string, message: string, requestId: string,
): NextResponse {
  return NextResponse.json(
    { success: false, error: { code, message }, meta: { version: 'v1', generatedAt: new Date().toISOString(), requestId } },
    { status },
  );
}

// ─── Autenticación de request ────────────────────────────────────────────────

export type ResultadoAuth =
  | { ok: true; client: ApiClientRegistro; requestId: string }
  | { ok: false; response: NextResponse };

const ultimoUsoCache = new Map<number, number>();

export async function autenticarApiKey(req: NextRequest, scopeRequerido: string): Promise<ResultadoAuth> {
  const requestId = nuevoRequestId();

  if (process.env.PUBLIC_API_ENABLED === 'false') {
    return { ok: false, response: respuestaErrorPublica(503, 'api_deshabilitada', 'API pública deshabilitada', requestId) };
  }

  const key = req.headers.get('x-api-key')?.trim() ?? '';
  if (!key) {
    return { ok: false, response: respuestaErrorPublica(401, 'clave_ausente', MENSAJE_POR_ERROR.clave_ausente, requestId) };
  }

  const prefix = extraerPrefijo(key);
  let registro: ApiClientRegistro | null = null;
  if (prefix) {
    registro = await prisma.apiClient.findUnique({
      where: { apiKeyPrefix: prefix },
      select: {
        id: true, nombre: true, apiKeyHash: true, activo: true, scopes: true,
        empresasPermitidas: true, rateLimitPorMinuto: true, expiraEn: true,
      },
    });
  }

  const verif = verificarClaveContraRegistro(key, registro, scopeRequerido);
  if (!verif.ok) {
    return { ok: false, response: respuestaErrorPublica(HTTP_POR_ERROR[verif.error], verif.error, MENSAJE_POR_ERROR[verif.error], requestId) };
  }

  const limite = registro!.rateLimitPorMinuto || Number(process.env.PUBLIC_API_RATE_LIMIT_DEFAULT) || 60;
  if (!limiter.permitir(registro!.id, limite)) {
    return { ok: false, response: respuestaErrorPublica(429, 'rate_limit', MENSAJE_POR_ERROR.rate_limit, requestId) };
  }

  // ultimoUsoEn: actualización fire-and-forget, máx. 1 vez por minuto por cliente
  const ahora = Date.now();
  if ((ultimoUsoCache.get(registro!.id) ?? 0) < ahora - 60_000) {
    ultimoUsoCache.set(registro!.id, ahora);
    void prisma.apiClient.update({
      where: { id: registro!.id },
      data: { ultimoUsoEn: new Date() },
    }).catch(() => {});
  }

  return { ok: true, client: registro!, requestId };
}
