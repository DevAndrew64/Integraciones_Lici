/**
 * Fuente ÚNICA de verdad de qué rutas `/api/*` NO dependen de la cookie
 * de sesión `licy_session` — reutilizada por `src/proxy.ts` (servidor,
 * decide si exige sesión) y por `src/lib/interceptor-sesion.ts` (cliente,
 * decide si un 401 debe disparar el flujo de "sesión expirada"). Antes
 * de esta corrección (Fase 6, diagnóstico Aseocolba) esta lista solo
 * existía inline dentro de `proxy.ts` — se extrae aquí para que ambos
 * lados nunca puedan desincronizarse (un olvido en un solo lugar dejaría
 * una ruta pública disparando el cierre de sesión, o una ruta protegida
 * sin cubrir).
 *
 * Sin dependencias de `next/server` — módulo neutral, importable tanto
 * desde el proxy (Edge Runtime) como desde el cliente (navegador).
 */

/** Rutas exactas que NUNCA requieren `licy_session` — incluye
 * `/api/auth/login` (su propio 401 significa "credenciales incorrectas",
 * nunca "sesión expirada" — no hay sesión previa que pueda haber
 * expirado) y `/api/auth/logout` (debe poder invalidar la cookie aunque
 * ya esté vencida, sin depender circularmente de una sesión válida). */
export const RUTAS_API_SIN_SESION: readonly string[] = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/uploadthing',
];

/** true si esta ruta `/api/*` NUNCA depende de `licy_session` — ni el
 * proxy debe exigirla, ni un 401 de esta ruta debe interpretarse como
 * sesión expirada. `/api/public/*` usa su propio esquema de autenticación
 * (header `X-API-Key`, ver `src/lib/public-api/auth.ts`) — un 401 ahí
 * significa "API key inválida", nunca "sesión de Licycolba expirada". */
export function esRutaApiSinSesion(pathname: string): boolean {
  if (pathname.startsWith('/api/public/')) return true;
  return RUTAS_API_SIN_SESION.includes(pathname);
}
