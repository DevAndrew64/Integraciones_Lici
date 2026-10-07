/**
 * Ajuste "FORMATO VISIBLE DE USERNAMES" — fuente ÚNICA y central para
 * transformar un username interno (ej. "andrea.calderin") en el texto que
 * se muestra en UI/exportes ("Andrea Calderin"). SOLO presentación: nunca
 * se usa para login, comparaciones de identidad, permisos, filtros,
 * payloads ni persistencia — el valor real (`sesion.usuario`,
 * `analistaAsignado`, `usuarioRegistro`, `cerradoPor`, `validadoPor`, el
 * campo `usuario` de una observación, etc.) sigue siendo exactamente el
 * mismo dato crudo en todos esos usos.
 *
 * Reutilizada tanto por `src/app/page.tsx` (fichas, tablas, exportes) como
 * por `src/components/licycolba/LicyTopbar.tsx` (perfil de sesión en la
 * esquina superior derecha) — nunca una segunda implementación.
 */
export function formatearUsuarioVisible(usuario: string | null | undefined): string {
  if (!usuario) return '';
  return usuario
    .split('.')
    .map(parte => parte ? parte.charAt(0).toUpperCase() + parte.slice(1).toLowerCase() : parte)
    .join(' ');
}
