/**
 * Helpers de ROL puros — sin ningún import server-only (nunca `@/lib/prisma`,
 * nunca `next/server`). Vive separado de `src/lib/authz.ts` (que sí importa
 * Prisma y solo puede usarse en Route Handlers/código server) para que
 * componentes cliente (`'use client'`, ej. `src/app/page.tsx`) puedan
 * importar estos mismos helpers sin arrastrar el bundle de Prisma al
 * navegador. `authz.ts` re-exporta todo lo de aquí — los callers server ya
 * existentes (`import {...} from '@/lib/authz'`) no cambian.
 *
 * Ajuste "SEGUIMIENTO DE PROCESO — NAVEGACIÓN RESTRINGIDA PARA MERCADEO" —
 * motivo de esta extracción: el Sidebar (cliente) necesita `esMercadeo` para
 * decidir qué mostrar, con la MISMA fuente de verdad que ya usa el backend
 * en `puedeCerrarSolicitud` (permisos de cierre) — nunca un Set duplicado.
 */

// ── Normalización de roles ────────────────────────────────────────────────────

const ALIAS_ADMIN: Record<string, string> = {
  administrador: 'admin',
};

/** Normaliza un rol a minúsculas y aplica alias conocidos. */
export function normalizeRole(rol: string): string {
  const lower = rol.trim().toLowerCase();
  return ALIAS_ADMIN[lower] ?? lower;
}

const ROLES_ADMIN = new Set(['admin', 'superadmin']);

/** Devuelve true si el rol (normalizado) tiene nivel administrativo GLOBAL
 * (usuarios, roles, TRM, configuración del sistema, y cualquier módulo).
 * NUNCA se amplía con roles de negocio — ver `esAdministradorProcesos` para
 * el concepto separado de "administrador funcional del módulo Procesos". */
export function isAdmin(rol: string): boolean {
  return ROLES_ADMIN.has(normalizeRole(rol));
}

// ── Administrador funcional del módulo Procesos ─────────────────────────────
const ROLES_ADMIN_PROCESOS = new Set(['director comercial', 'coordinador comercial']);

/** Administrador funcional del módulo Procesos/Solicitudes: Administrador
 * global, Director Comercial o Coordinador Comercial. Fuera de Procesos
 * (usuarios, roles, TRM, configuración, otros módulos) este helper NUNCA
 * debe usarse — ahí sigue rigiendo exclusivamente `isAdmin`/`requireAdmin`. */
export function esAdministradorProcesos(rol: string): boolean {
  const norm = normalizeRole(rol);
  return ROLES_ADMIN.has(norm) || ROLES_ADMIN_PROCESOS.has(norm);
}

// ── Mercadeo ─────────────────────────────────────────────────────────────────
// Ajuste "PERMISOS DE CIERRE — PRIVADOS PARA MERCADEO" — Director/Coordinador
// Comercial dejan de ser "administrador funcional" para el cierre de
// procesos Privados; ese privilegio pasa a Mercadeo (ver `puedeCerrarSolicitud`
// en `src/lib/solicitudes/autorizacion-asignacion.ts`). Reutilizado también
// por la navegación lateral de Mercadeo en `page.tsx` (Sidebar).
const ROLES_MERCADEO = new Set(['analista mercadeo', 'asistente mercadeo']);

/** true si el rol (normalizado) es alguno de los roles de Mercadeo
 * (Analista Mercadeo, Asistente Mercadeo). NUNCA incluye Administrador
 * global — para eso sigue usándose `isAdmin` por separado. */
export function esMercadeo(rol: string): boolean {
  return ROLES_MERCADEO.has(normalizeRole(rol));
}

// ── Equipo Comercial ─────────────────────────────────────────────────────────
// Ajuste "PERMISOS DE COSTOS — EQUIPO COMERCIAL" — Costos dentro de la ficha
// deja de depender de `ver_estructura_costos` (permiso de BD reutilizado
// ad-hoc, mezclado con la navegación standalone ya apagada) para la
// EDICIÓN: la escritura pasa a exigir Administrador o Equipo Comercial,
// evaluado aquí de forma centralizada para que backend (rutas de
// costos-estructura) y frontend (`page.tsx`, ModuloEstructuraCostos) usen la
// MISMA fuente — nunca un array duplicado. Roles reales confirmados vía BD
// (`PerfilRol`/`User.rol`): Director Comercial, Coordinador Comercial,
// Analista Comercial. Asistente Comercial no tiene usuarios reales hoy pero
// es parte del vocabulario de roles ya usado en el resto del código (mismo
// patrón Analista/Asistente que Mercadeo) — se incluye por completitud.
// Mercadeo NUNCA pertenece a este conjunto.
const ROLES_EQUIPO_COMERCIAL = new Set([
  'director comercial',
  'coordinador comercial',
  'analista comercial',
  'asistente comercial',
]);

/** true si el rol (normalizado) pertenece al Equipo Comercial (Director,
 * Coordinador, Analista o Asistente Comercial). NUNCA incluye Administrador
 * global ni Mercadeo — para Administrador sigue usándose `isAdmin` por
 * separado (`puedeEditarCostos = isAdmin(rol) || esEquipoComercial(rol)`). */
export function esEquipoComercial(rol: string): boolean {
  return ROLES_EQUIPO_COMERCIAL.has(normalizeRole(rol));
}

// ── Público/Privado por aliasFuente ─────────────────────────────────────────
// Ajuste "CIERRE DE PRIVADOS PARA MERCADEO" / "SEGUIMIENTO — MERCADEO" —
// `Solicitud` no tiene columna `tipoProceso`; el único dato persistido que
// distingue Público de Privado es `aliasFuente` ('S1'/'S2' = SECOP I/II =
// Público; cualquier otro valor, incluido `null`/ausente = Privado). Vive
// aquí (sin imports server-only) para que tanto el backend
// (`autorizacion-asignacion.ts`, vía `esProcesoPrivado`, que delega aquí
// para no duplicar la lista) como el cliente (`page.tsx`, para la UI de
// Seguimiento) usen la MISMA fuente de verdad — nunca una copia paralela.
const ALIAS_FUENTE_PUBLICO = new Set(['S1', 'S2']);

/** true si `aliasFuente` corresponde a una fuente pública conocida (S1/S2 —
 * SECOP I/II). `null`/ausente NO es público — ver `esProcesoPrivadoPorAlias`. */
export function esAliasFuentePublico(aliasFuente: string | null | undefined): boolean {
  return aliasFuente != null && ALIAS_FUENTE_PUBLICO.has(aliasFuente);
}

/** true si el proceso es Privado DETERMINADO: `aliasFuente` presente y
 * distinto de S1/S2. `null`/ausente (legado/manual) es Privado según este
 * helper puro — el criterio de autorización real (`puedeCerrarSolicitud`)
 * trata `null` como "mantener la lógica de Público/legado" para NO
 * autorización; los callers que necesiten esa distinción deben usar
 * `aliasFuente != null && esProcesoPrivadoPorAlias(aliasFuente)` como ya
 * hace `esProcesoPrivado` en `autorizacion-asignacion.ts`. */
export function esProcesoPrivadoPorAlias(aliasFuente: string | null | undefined): boolean {
  return aliasFuente != null && !esAliasFuentePublico(aliasFuente);
}
