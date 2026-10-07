import { NextRequest, NextResponse } from 'next/server';
import { esRutaApiSinSesion } from '@/lib/rutas-api-sesion';
import { SESION_DURACION_SEG } from '@/lib/duracion-sesion';

export const config = {
  matcher: ['/api/:path*'],
};

/**
 * Rutas que N8N puede llamar con Bearer N8N_SYNC_TOKEN en lugar de cookie de sesión.
 *
 * REPO SHARE-READY (B5): n8n queda FUERA de todo flujo de adquisición de
 * procesos. El token n8n SOLO desbloquea la ingestión RAG
 * (`/api/lectura/rag/ingestar`), que no es adquisición. Las rutas de
 * adquisición/sync exigen sesión de Administrador como cualquier otro
 * endpoint (y, además, responden migrado/deshabilitado según el modo).
 */
const RUTAS_TOKEN_N8N = new Set(['/api/lectura/rag/ingestar']);

/** Alias histórico conservado para compatibilidad de imports/pruebas. */
const RUTAS_TOKEN_N8N_CUTOVER = RUTAS_TOKEN_N8N;

export { RUTAS_TOKEN_N8N, RUTAS_TOKEN_N8N_CUTOVER };

/**
 * Whitelist efectiva del token n8n. En este repositorio es SIEMPRE el set
 * RAG-only, con independencia de `DATA_API_RUNTIME_ENABLED` — n8n nunca
 * desbloquea adquisición de procesos.
 */
export function rutasTokenN8nEfectivas(_env?: NodeJS.ProcessEnv): ReadonlySet<string> {
  return RUTAS_TOKEN_N8N;
}

// ── Verificación HMAC (compatible con Edge Runtime) ───────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function decodeBase64url(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

function encodeBase64url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Duración de sesión (`SESION_DURACION_SEG`, 7 días): se renueva en cada
// request autenticado (ver más abajo), así que vence 7 días después del
// último request, no 7 días después del login.

/** Verifica la firma y vigencia del token; si es válido, retorna el payload decodificado (sin exp). */
async function verificarYDecodificar(token: string): Promise<Record<string, unknown> | null> {
  const secret = process.env.SESSION_SECRET ?? '';
  if (!secret) return null;

  const dotIdx = token.lastIndexOf('.');
  if (dotIdx < 0) return null;

  const payload = token.slice(0, dotIdx);
  const signature = token.slice(dotIdx + 1);

  if (!payload || signature.length !== 64) return null;

  try {
    const keyBytes = new TextEncoder().encode(secret);
    const key = await crypto.subtle.importKey(
      'raw', keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['verify'],
    );

    const valid = await crypto.subtle.verify(
      'HMAC', key,
      hexToBytes(signature).buffer as ArrayBuffer,
      new TextEncoder().encode(payload).buffer as ArrayBuffer,
    );

    if (!valid) return null;

    const data = JSON.parse(decodeBase64url(payload)) as Record<string, unknown> & { exp?: number };
    if (typeof data.exp !== 'number' || data.exp <= Math.floor(Date.now() / 1000)) return null;

    return data;
  } catch {
    return null;
  }
}

/** Re-firma el payload con un exp renovado (sliding session). */
async function firmarToken(payload: Record<string, unknown>): Promise<string> {
  const secret = process.env.SESSION_SECRET ?? '';
  const payloadB64 = encodeBase64url(JSON.stringify(payload));
  const keyBytes = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    'raw', keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const signature = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${payloadB64}.${signature}`;
}

// ── Proxy handler ─────────────────────────────────────────────────────────────

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 0/1. Rutas que nunca dependen de licy_session (fuente única de verdad
  // compartida con el interceptor de sesión del cliente — ver
  // src/lib/rutas-api-sesion.ts): /api/public/* (X-API-Key propia) y las
  // rutas exactas de auth login/logout/uploadthing.
  if (esRutaApiSinSesion(pathname)) return NextResponse.next();

  // 2. Rutas N8N: pasar solo si porta Bearer N8N_SYNC_TOKEN válido.
  //    Si el token está ausente o es inválido, cae a verificación normal de sesión.
  //    Rutas fuera de RUTAS_TOKEN_N8N no pueden ser desbloqueadas con este token.
  if (rutasTokenN8nEfectivas().has(pathname)) {
    const n8nToken = process.env.N8N_SYNC_TOKEN?.trim();
    if (n8nToken && req.headers.get('authorization') === `Bearer ${n8nToken}`) {
      return NextResponse.next();
    }
    // Sin token N8N válido → continuar a verificación de sesión
  }

  // 3. Verificar sesión HMAC
  const token = req.cookies.get('licy_session')?.value ?? '';
  const datos = token ? await verificarYDecodificar(token) : null;
  if (!datos) {
    return NextResponse.json(
      { ok: false, error: 'No autenticado' },
      { status: 401 },
    );
  }

  // Sesión deslizante: cada request autenticado renueva el vencimiento
  // (sliding expiration) — si no hay actividad durante SESION_DURACION_SEG,
  // el token deja de ser válido aunque nunca se haya cerrado sesión explícitamente.
  const res = NextResponse.next();
  const nuevoExp = Math.floor(Date.now() / 1000) + SESION_DURACION_SEG;
  const nuevoToken = await firmarToken({ ...datos, exp: nuevoExp });
  res.cookies.set('licy_session', nuevoToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESION_DURACION_SEG,
  });

  return res;
}