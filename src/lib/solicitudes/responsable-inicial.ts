/**
 * Regla de negocio ÚNICA para proponer el responsable inicial de una
 * Solicitud según su perfil/empresa — reemplaza las 4 copias que existían
 * dispersas (3 en los puntos de creación de `page.tsx` + 1 en el modal de
 * "Asignar responsable", que además omitía Transcolba por un desajuste
 * entre copias).
 *
 * PURA a propósito: nunca importa Prisma, `@/lib/prisma`, nada `server-only`
 * ni variables de entorno — así puede importarse tanto desde el backend
 * (`crear-solicitud.ts`) como desde `page.tsx` (cliente) sin arrastrar
 * dependencias de servidor al bundle del navegador. Esta función SOLO
 * propone un username por regla de negocio; no valida contra la base de
 * datos si ese usuario existe, está activo o es elegible — esa validación
 * vive exclusivamente en el backend (`validar-responsable.ts`), nunca aquí.
 */

const REGLAS_RESPONSABLE_POR_PERFIL: Record<string, string> = {
  vigicolba: 'nicole.ortiz',
  aseocolba: 'juan.davila',
  tempocolba: 'juan.davila',
  transcolba: 'juan.davila',
};

/** Normalización controlada: minúsculas, sin espacios sobrantes, sin
 * tildes/diacríticos — NUNCA coincidencia parcial (`includes`/`startsWith`)
 * para no confundir empresas distintas que compartan una subcadena. */
function normalizarClavePerfil(perfil: string | null | undefined): string {
  return (perfil ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '');
}

/**
 * Devuelve el username propuesto para el perfil dado, o `null` si el perfil
 * no tiene ninguna regla configurada — nunca inventa un usuario ni retorna
 * una cadena vacía como "sin responsable" ambiguo.
 */
export function resolverResponsableInicialPorPerfil(perfil: string | null | undefined): string | null {
  const clave = normalizarClavePerfil(perfil);
  if (!clave) return null;
  return REGLAS_RESPONSABLE_POR_PERFIL[clave] ?? null;
}