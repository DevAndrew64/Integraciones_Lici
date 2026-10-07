/**
 * Helpers de autorización centralizados.
 * Normaliza roles para evitar inconsistencias entre "admin", "Administrador", "superadmin", etc.
 * No modifica la BD — solo normaliza al comparar.
 *
 * Fase C — IDOR: funciones canAccess* para validar propiedad de recursos.
 * LIMITACIÓN CONOCIDA (Fase D): LecturaAnalisis no tiene campo usuarioId.
 * Mientras no se agregue esa columna, el endpoint /estado es accesible a cualquier
 * usuario autenticado, sin poder verificar propiedad del análisis.
 *
 * Fase F — Permisos funcionales: hasPermiso() consulta PerfilRol.permisos para
 * claves como 'busqueda_marcar_no_viable', 'busqueda_revertir_no_viable', etc.
 * Admin siempre tiene todos los permisos sin consultar la BD.
 */

import { NextRequest, NextResponse } from 'next/server';
import { SessionUser } from '@/lib/session';
import prisma from '@/lib/prisma';

// ── Helpers de rol ────────────────────────────────────────────────────────────
// Ajuste "SEGUIMIENTO DE PROCESO — NAVEGACIÓN RESTRINGIDA PARA MERCADEO" —
// `normalizeRole`/`isAdmin`/`esAdministradorProcesos`/`esMercadeo` se
// extrajeron a `src/lib/roles.ts` (sin imports server-only) para que
// `page.tsx` ('use client') pueda importarlos directamente sin arrastrar
// `@/lib/prisma` al bundle del navegador. Re-exportados aquí tal cual —
// ningún caller server existente de `@/lib/authz` cambia.
export { normalizeRole, isAdmin, esAdministradorProcesos, esMercadeo, esEquipoComercial } from '@/lib/roles';
import { normalizeRole, isAdmin, esAdministradorProcesos, esMercadeo, esEquipoComercial } from '@/lib/roles';

// ── Guards de respuesta ───────────────────────────────────────────────────────

/** Devuelve 401 si no hay sesión, null si la sesión es válida. */
export function requireSession(session: SessionUser | null): NextResponse | null {
  if (!session) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 });
  }
  return null;
}

/** Devuelve 401/403 si no tiene nivel admin; null si está autorizado. */
export function requireAdmin(session: SessionUser | null): NextResponse | null {
  if (!session) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 });
  }
  if (!isAdmin(session.rol)) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return null;
}

/** Igual que `requireAdmin`, pero para acciones EXCLUSIVAS del módulo
 * Procesos donde Director/Coordinador Comercial deben tener el mismo nivel
 * que un Administrador global (ver `esAdministradorProcesos`). Úsese SOLO
 * en rutas de `src/app/api/procesos/**` y `src/app/api/solicitudes/**` que
 * no requieran además una verificación de fila/propiedad específica. */
export function requireAdministradorProcesos(session: SessionUser | null): NextResponse | null {
  if (!session) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 });
  }
  if (!esAdministradorProcesos(session.rol)) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return null;
}

/** Ajuste "TRM — NO VISIBLE NI ACCESIBLE PARA MERCADEO" — 401 sin sesión,
 * 403 para Mercadeo (`esMercadeo`, fuente única `@/lib/roles`), null para
 * cualquier otro rol autenticado. Primer uso: `GET /api/trm` y
 * `GET /api/trm/proyeccion-decimal` — genérico por si otro endpoint
 * necesita la misma exclusión sin duplicar el chequeo. */
export function requireNoMercadeo(session: SessionUser | null): NextResponse | null {
  if (!session) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 });
  }
  if (esMercadeo(session.rol)) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
  }
  return null;
}

/** Ajuste "PERMISOS DE COSTOS — EQUIPO COMERCIAL" — 401 sin sesión, 403 salvo
 * Administrador o Equipo Comercial (`esEquipoComercial`, fuente única
 * `@/lib/roles`), null para esos dos casos. Reemplaza el uso de
 * `hasPermiso(session,'ver_estructura_costos')` como gate de ESCRITURA en
 * `POST /api/costos-estructura` y `PUT /api/costos-estructura/[id]` — ese
 * permiso de BD sigue existiendo (reutilizado por la navegación standalone,
 * hoy apagada) pero ya no basta por sí solo para mutar Costos. */
export function requireEditarCostos(session: SessionUser | null): NextResponse | null {
  if (!session) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 });
  }
  if (isAdmin(session.rol) || esEquipoComercial(session.rol)) return null;
  return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
}

// ── Excepción puntual: edición del Maestro de Documentos ────────────────────
// PATCH /api/docs/[id] exige Administrador por defecto — no existe todavía
// un permiso funcional 'maestro_editar_doc' en PerfilRol (ver comentario en
// esa ruta). A pedido explícito del usuario, se habilita esta edición SOLO
// para este usuario puntual (no para todo el rol "Analista Comercial").
// Si en el futuro se necesita abrir a más usuarios, definir el permiso
// funcional real en PerfilRol en vez de seguir agregando nombres aquí.
const USUARIOS_EDITAR_MAESTRO_DOCS = new Set(['nicole.ortiz']);

/** Devuelve 401/403 salvo Administrador o un usuario en la excepción puntual anterior. */
export function requireEditarMaestroDocs(session: SessionUser | null): NextResponse | null {
  if (!session) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 });
  }
  if (isAdmin(session.rol)) return null;
  if (session.usuario && USUARIOS_EDITAR_MAESTRO_DOCS.has(session.usuario)) return null;
  return NextResponse.json(
    { ok: false, error: 'No tienes permiso para editar el maestro de documentos. Contacta a un Administrador.' },
    { status: 403 }
  );
}

// ── Autenticación por token N8N ───────────────────────────────────────────────

/**
 * Verifica si la petición lleva el N8N_SYNC_TOKEN como Bearer.
 * Para rutas de sincronización usadas por automatizaciones externas.
 */
export function isN8NRequest(req: NextRequest): boolean {
  const esperado = process.env.N8N_SYNC_TOKEN?.trim();
  if (!esperado) return false;
  return req.headers.get('authorization') === `Bearer ${esperado}`;
}

/**
 * Guard para rutas de sincronización: permite acceso si:
 * - La petición lleva N8N_SYNC_TOKEN válido (automatizaciones)
 * - La sesión tiene nivel admin (usuarios humanos)
 * Devuelve null si autorizado, o una respuesta 401/403 si no.
 */
export function requireAdminOrN8N(
  req: NextRequest,
  session: SessionUser | null
): NextResponse | null {
  if (isN8NRequest(req)) return null;
  return requireAdmin(session);
}

// ── Helpers de propiedad de recursos (Fase C — IDOR) ─────────────────────────

/** Verifica si el usuario puede acceder a un recurso de otro usuario.
 *  Admin puede acceder a cualquier recurso; otros solo al propio. */
export function canAccessUser(session: SessionUser, targetUserId: number): boolean {
  if (isAdmin(session.rol)) return true;
  return session.id === targetUserId;
}

/**
 * Compara identidad de usuario de forma segura.
 * Acepta: coincidencia exacta de email completo, o de username (parte antes del @).
 * Rechaza: coincidencias parciales tipo substring ("nico" dentro de "nicole.ortiz").
 * Case-insensitive y trim-normalizado.
 *
 * Ejemplos que COINCIDEN: "Nicole.Ortiz" == "nicole.ortiz@emp.com", "nicole.ortiz" == "Nicole.Ortiz"
 * Ejemplos que NO coinciden: "nico" != "nicole.ortiz", "admin" != "administrador"
 */
export function matchesIdentity(
  sessionEmail: string,
  candidate: string,
  sessionUsuario?: string
): boolean {
  const val = candidate.trim().toLowerCase();
  if (!val) return false;
  const email = sessionEmail.trim().toLowerCase();
  if (val === email) return true;
  const atIdx = email.indexOf('@');
  if (atIdx > 0 && val === email.slice(0, atIdx)) return true;
  // Comparar contra el campo usuario real (puede diferir del prefijo del email)
  if (sessionUsuario) {
    const u = sessionUsuario.trim().toLowerCase();
    if (u && val === u) return true;
  }
  return false;
}

/**
 * Resuelve el usuarioId real en BD para la sesión actual.
 *
 * 1. Si session.id es válido: verifica que el User exista por id.
 * 2. Si no existe por id: busca por session.email (sesión con id obsoleto).
 * 3. Si no encuentra: devuelve null → el caller debe responder 401.
 *
 * Regla: solo N8N/sistema guarda usuarioId = null.
 * Usuarios autenticados siempre deben tener un User real en BD.
 */
export async function resolveSessionUserId(session: SessionUser): Promise<number | null> {
  const rawId = Number(session.id);

  if (Number.isFinite(rawId) && rawId > 0) {
    try {
      const user = await prisma.user.findUnique({ where: { id: rawId }, select: { id: true } });
      if (user) return user.id;
    } catch { /* BD no disponible — caer a lookup por email */ }
  }

  if (session.email?.trim()) {
    try {
      const user = await prisma.user.findUnique({ where: { email: session.email.trim() }, select: { id: true } });
      if (user) {
        console.log('[resolveSessionUserId] session_id_recovered_by_email', { email: session.email, sessionId: rawId, dbUserId: user.id });
        return user.id;
      }
    } catch { /* BD no disponible */ }
  }

  return null;
}

/**
 * Verifica si el usuario tiene un permiso funcional asignado en su PerfilRol.
 * Admin siempre devuelve true sin consultar la BD.
 * Claves disponibles: 'busqueda_marcar_no_viable', 'busqueda_revertir_no_viable',
 * 'asig_gestionar', 'asig_validar_elaboracion', etc. (ver TODOS_PERMISOS en page.tsx).
 */
export async function hasPermiso(session: SessionUser, clave: string): Promise<boolean> {
  if (isAdmin(session.rol)) return true;
  try {
    const perfil = await prisma.perfilRol.findFirst({ where: { nombre: session.rol } });
    const permisos = (perfil?.permisos ?? {}) as Record<string, unknown>;
    return permisos[clave] === true;
  } catch {
    return false;
  }
}

/**
 * Verifica si el usuario tiene relación con una solicitud.
 * Campos directos: emailRegistro, usuarioRegistro, aprobador, revisor.
 * Asignaciones (JSON): email, usuario, analistaAsignado, gestionadoPor, asignadoPor.
 * Administrador funcional de Procesos (Administrador global, Director
 * Comercial o Coordinador Comercial) siempre puede — sus 3 únicos
 * consumidores (`src/app/api/solicitudes/[id]/route.ts`,
 * `cerrar-sqr/route.ts`, `route.ts` PATCH) son exclusivamente del módulo
 * Procesos/Solicitudes, así que ampliar aquí no afecta ningún otro módulo.
 */
export function canAccessSolicitud(
  session: SessionUser,
  solicitud: {
    emailRegistro?: string | null;
    usuarioRegistro?: string | null;
    asignaciones?: unknown;
    aprobador?: string | null;
    revisor?: string | null;
  }
): boolean {
  if (esAdministradorProcesos(session.rol)) return true;

  const email = session.email;
  const usr   = session.usuario;  // puede diferir del prefijo del email

  const mi = (candidate: string) => matchesIdentity(email, candidate, usr);

  if (mi(solicitud.emailRegistro   ?? '')) return true;
  if (mi(solicitud.usuarioRegistro ?? '')) return true;
  if (mi(solicitud.aprobador       ?? '')) return true;
  if (mi(solicitud.revisor         ?? '')) return true;

  // asignaciones: array de strings o de objetos con distintos campos de identidad
  const asigs = Array.isArray(solicitud.asignaciones) ? solicitud.asignaciones : [];
  return asigs.some((a: unknown) => {
    if (typeof a === 'string') return mi(a);
    if (a && typeof a === 'object') {
      const o = a as Record<string, unknown>;
      return (
        mi(String(o.email                  ?? '')) ||
        mi(String(o.usuario                ?? '')) ||
        mi(String(o.analistaAsignado        ?? '')) ||
        mi(String(o.gestionadoPor           ?? '')) ||
        mi(String(o.asignadoPor             ?? '')) ||
        mi(String(o.responsableElaboracion  ?? ''))
      );
    }
    return false;
  });
}

// ── Helpers de acceso — Simulaciones de ponderación (Fase 2B.2) ─────────────

/** Normaliza un nombre de empresa/razón social para comparar sin distinguir mayúsculas/espacios. */
export function normalizarEmpresa(s?: string | null): string {
  return (s ?? '').trim().toUpperCase();
}

/**
 * Determina si el usuario puede ver el listado consolidado de simulaciones
 * (todas las empresas, no solo la propia). Admin siempre puede.
 * No-admin: requiere el permiso funcional 'sim_ver_consolidado' en su PerfilRol.
 */
export async function puedeVerConsolidadoSimulaciones(session: SessionUser): Promise<boolean> {
  if (isAdmin(session.rol)) return true;
  return hasPermiso(session, 'sim_ver_consolidado');
}

/**
 * Verifica si el usuario puede ver/modificar una simulación de ponderación puntual.
 * Reglas (Fase 2B.2):
 * - Si tiene acceso consolidado (admin o permiso 'sim_ver_consolidado'): acceso total.
 * - Si es el creador (creadoPorId === session.id): acceso siempre, sin importar empresa.
 * - Si el usuario tiene empresaGrupo/entidadGrupo y coincide (case-insensitive) con
 *   empresaGrupo o razonSocial de la simulación: acceso permitido.
 * - Si el usuario no tiene empresa asignada: solo accede a lo propio (regla anterior).
 */
export function canAccessSimulacionPonderacion(
  session: SessionUser,
  sim: { creadoPorId: number | null; empresaGrupo: string | null; razonSocial: string | null },
  userEntidadGrupo: string | null,
  consolidado: boolean,
): boolean {
  if (consolidado) return true;
  if (sim.creadoPorId != null && sim.creadoPorId === session.id) return true;

  const empresaUsuario = normalizarEmpresa(userEntidadGrupo);
  if (!empresaUsuario) return false;

  if (normalizarEmpresa(sim.empresaGrupo) === empresaUsuario) return true;
  if (normalizarEmpresa(sim.razonSocial) === empresaUsuario) return true;

  return false;
}