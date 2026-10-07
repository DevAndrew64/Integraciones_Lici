/**
 * Rate limiter — Fase E2.3: funciones Postgres persistentes.
 *
 * Las funciones *Pg son la implementación activa (persistentes entre deploys).
 * Las funciones en memoria se conservan como referencia pero ya no se usan en
 * los endpoints principales.
 *
 * Comportamiento ante fallo de BD: fail-open con log de error.
 * No se imprimen tokens, cookies, passwords ni headers sensibles.
 */

import prisma from '@/lib/prisma';

// ── Constantes compartidas ────────────────────────────────────────────────────

const VENTANA_LOGIN_MS  = 15 * 60 * 1000; // 15 minutos
const MAX_INTENTOS_LOGIN = 5;

export type EndpointGemini =
  | 'analizar' | 'profundo' | 'completo'
  | 'chat' | 'rag' | 'colba' | 'costos' | 'turno'
  | 'anthropic_test';

const LIMITES_DIARIOS: Record<EndpointGemini, number> = {
  analizar:  20,
  profundo:  10,
  completo:   5,
  chat:      100,
  rag:       100,
  colba:     100,
  costos:     20,
  turno:      50,
  anthropic_test: 20,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _claveLogin(tipo: 'ip' | 'email', valor: string): string {
  return `${tipo}:${valor.toLowerCase().trim()}`;
}

function _fechaHoy(): string {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' UTC
}

function _fechaHaceNDias(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ── Rate limit de login — Postgres ────────────────────────────────────────────

/**
 * Verifica si la IP o el email están bloqueados por demasiados intentos.
 * Fail-open si la BD falla (permite el intento con log de error).
 */
export async function checkLoginRateLimitPg(
  ip: string,
  email: string,
): Promise<{ bloqueado: boolean; retryAfterMs: number }> {
  try {
    // Limpieza lazy de entradas muy viejas (expiradas hace más de 1 h)
    await prisma.$executeRaw`
      DELETE FROM "LoginAttempt" WHERE "resetAt" < NOW() - INTERVAL '1 hour'
    `;

    const claves = [_claveLogin('ip', ip), _claveLogin('email', email)];
    const rows = await prisma.$queryRaw<{ clave: string; count: number; resetAt: Date }[]>`
      SELECT clave, count, "resetAt"
      FROM "LoginAttempt"
      WHERE clave = ANY(${claves})
        AND "resetAt" > NOW()
    `;

    for (const row of rows) {
      if (row.count >= MAX_INTENTOS_LOGIN) {
        return { bloqueado: true, retryAfterMs: row.resetAt.getTime() - Date.now() };
      }
    }
    return { bloqueado: false, retryAfterMs: 0 };
  } catch (err) {
    console.error('[rate-limit] checkLoginRateLimitPg — fail open:', (err as Error)?.message?.slice(0, 200));
    return { bloqueado: false, retryAfterMs: 0 };
  }
}

/**
 * Registra un intento fallido de login para la IP y el email.
 * UPSERT atómico: crea o incrementa la fila, respetando la ventana activa.
 */
export async function recordLoginFailurePg(ip: string, email: string): Promise<void> {
  const resetAt = new Date(Date.now() + VENTANA_LOGIN_MS);
  try {
    for (const clave of [_claveLogin('ip', ip), _claveLogin('email', email)]) {
      await prisma.$executeRaw`
        INSERT INTO "LoginAttempt" (clave, count, "resetAt", "actualizadoEn")
        VALUES (${clave}, 1, ${resetAt}, NOW())
        ON CONFLICT (clave) DO UPDATE SET
          count = CASE
            WHEN "LoginAttempt"."resetAt" < NOW() THEN 1
            ELSE "LoginAttempt".count + 1
          END,
          "resetAt" = CASE
            WHEN "LoginAttempt"."resetAt" < NOW() THEN ${resetAt}
            ELSE "LoginAttempt"."resetAt"
          END,
          "actualizadoEn" = NOW()
      `;
    }
  } catch (err) {
    console.error('[rate-limit] recordLoginFailurePg error:', (err as Error)?.message?.slice(0, 200));
  }
}

/**
 * Elimina los contadores de la IP y el email tras un login exitoso.
 */
export async function clearLoginAttemptsPg(ip: string, email: string): Promise<void> {
  const claves = [_claveLogin('ip', ip), _claveLogin('email', email)];
  try {
    await prisma.$executeRaw`
      DELETE FROM "LoginAttempt" WHERE clave = ANY(${claves})
    `;
  } catch (err) {
    console.error('[rate-limit] clearLoginAttemptsPg error:', (err as Error)?.message?.slice(0, 200));
  }
}

// ── Rate limit de Gemini / IA — Postgres ──────────────────────────────────────

/**
 * Verifica si el usuario alcanzó su límite diario para el endpoint dado.
 * Fail-open si la BD falla.
 */
export async function checkGeminiRateLimitPg(
  usuarioId: number,
  endpoint: EndpointGemini,
): Promise<{ bloqueado: boolean; limite: number; usos: number }> {
  const limite = LIMITES_DIARIOS[endpoint];
  const fecha  = _fechaHoy();
  try {
    // Limpieza lazy de días anteriores (más de 7 días)
    const fechaLimite = _fechaHaceNDias(7);
    await prisma.$executeRaw`
      DELETE FROM "RateLimitGemini" WHERE fecha < ${fechaLimite}
    `;

    const rows = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count FROM "RateLimitGemini"
      WHERE "usuarioId" = ${usuarioId}
        AND endpoint = ${endpoint}
        AND fecha = ${fecha}
    `;
    const usos = rows[0]?.count ?? 0;
    return { bloqueado: usos >= limite, limite, usos };
  } catch (err) {
    console.error('[rate-limit] checkGeminiRateLimitPg — fail open:', (err as Error)?.message?.slice(0, 200));
    return { bloqueado: false, limite, usos: 0 };
  }
}

/**
 * Registra un uso de Gemini para el usuario y endpoint dados.
 * Llama SOLO cuando Gemini fue efectivamente invocado (no en hits de caché).
 * Fire-and-forget seguro: los errores se loguean pero no interrumpen la respuesta.
 */
export async function recordGeminiUsagePg(
  usuarioId: number,
  endpoint: EndpointGemini,
): Promise<void> {
  const fecha = _fechaHoy();
  try {
    await prisma.$executeRaw`
      INSERT INTO "RateLimitGemini" ("usuarioId", endpoint, fecha, count, "actualizadoEn")
      VALUES (${usuarioId}, ${endpoint}, ${fecha}, 1, NOW())
      ON CONFLICT ("usuarioId", endpoint, fecha)
      DO UPDATE SET
        count = "RateLimitGemini".count + 1,
        "actualizadoEn" = NOW()
    `;
  } catch (err) {
    console.error('[rate-limit] recordGeminiUsagePg error:', (err as Error)?.message?.slice(0, 200));
  }
}

// ── Funciones en memoria (legacy — conservadas como referencia) ───────────────

type EntradaLogin = { count: number; resetAt: number };
const _intentos = new Map<string, EntradaLogin>();

function _limpiarLoginVencidos(): void {
  const ahora = Date.now();
  for (const [k, v] of _intentos) if (ahora > v.resetAt) _intentos.delete(k);
}

export function checkLoginRateLimit(
  ip: string,
  email: string,
): { bloqueado: boolean; retryAfterMs: number } {
  _limpiarLoginVencidos();
  const ahora = Date.now();
  for (const clave of [_claveLogin('ip', ip), _claveLogin('email', email)]) {
    const e = _intentos.get(clave);
    if (e && ahora <= e.resetAt && e.count >= MAX_INTENTOS_LOGIN)
      return { bloqueado: true, retryAfterMs: e.resetAt - ahora };
  }
  return { bloqueado: false, retryAfterMs: 0 };
}

export function recordLoginFailure(ip: string, email: string): void {
  const ahora = Date.now();
  for (const clave of [_claveLogin('ip', ip), _claveLogin('email', email)]) {
    const existing = _intentos.get(clave);
    if (existing && ahora <= existing.resetAt) existing.count++;
    else _intentos.set(clave, { count: 1, resetAt: ahora + VENTANA_LOGIN_MS });
  }
}

export function clearLoginAttempts(ip: string, email: string): void {
  _intentos.delete(_claveLogin('ip', ip));
  _intentos.delete(_claveLogin('email', email));
}

type EntradaGemini = { count: number; fecha: string };
const _usosGemini = new Map<string, EntradaGemini>();

export function checkGeminiRateLimit(
  userId: string | number,
  endpoint: EndpointGemini,
): { bloqueado: boolean; limite: number; usos: number } {
  const clave = `${endpoint}:${userId}`;
  const hoy = _fechaHoy();
  const e = _usosGemini.get(clave);
  const usos = e?.fecha === hoy ? e.count : 0;
  const limite = LIMITES_DIARIOS[endpoint];
  return { bloqueado: usos >= limite, limite, usos };
}

export function recordGeminiUsage(userId: string | number, endpoint: EndpointGemini): void {
  const clave = `${endpoint}:${userId}`;
  const hoy = _fechaHoy();
  const existing = _usosGemini.get(clave);
  if (existing?.fecha === hoy) existing.count++;
  else _usosGemini.set(clave, { count: 1, fecha: hoy });
}