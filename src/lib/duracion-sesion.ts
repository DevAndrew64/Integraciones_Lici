/**
 * Duración de la sesión (`licy_session`) — fuente única para el login
 * (emisión del token/cookie) y `proxy.ts` (renovación deslizante en cada
 * request autenticado). La sesión solo vence tras este plazo SIN ninguna
 * petición al servidor; no existe cierre por inactividad en el frontend.
 * Sin imports: `proxy.ts` corre en el runtime del middleware.
 */
export const SESION_DURACION_SEG = 7 * 24 * 60 * 60; // 7 días
