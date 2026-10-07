/**
 * Validación de elegibilidad de un responsable — EXCLUSIVA del backend
 * (consulta la base de datos real). Deliberadamente separada de
 * `responsable-inicial.ts` (que solo PROPONE un username por regla de
 * negocio, sin tocar la BD): esta función es la que confirma que ese
 * username (o cualquier otro recibido de un cliente) corresponde a un
 * usuario real, activo, y con rol/proceso habilitado para gestión
 * comercial — nunca se confía en que el frontend mande datos correctos.
 */
import type { PrismaDb } from './crear-solicitud';

export interface ResponsableElegible {
  id: number;
  usuario: string;
  cargo: string;
  entidadGrupo: string;
  rol: string;
}

function esProcesoOCargoComercial(u: { proceso?: string | null; cargo?: string | null; rol?: string | null }): boolean {
  const proceso = (u.proceso ?? '').toLowerCase();
  const cargo = (u.cargo ?? '').toLowerCase();
  const rol = (u.rol ?? '').toLowerCase();
  return proceso.includes('comercial') || cargo.includes('comercial') || rol.includes('comercial');
}

/**
 * Busca el usuario por su `usuario` (username) exacto y confirma que está
 * Activo y habilitado para gestión comercial. Devuelve `null` (nunca lanza)
 * si no existe, está inactivo, o no es elegible — el llamador decide qué
 * hacer con ese `null` (rechazar la operación, nunca inventar el usuario).
 */
export async function resolverResponsableElegible(db: PrismaDb, usuario: string): Promise<ResponsableElegible | null> {
  const nombre = (usuario ?? '').trim();
  if (!nombre) return null;
  const u = await db.user.findFirst({ where: { usuario: nombre } });
  if (!u) return null;
  if (u.estado !== 'Activo') return null;
  if (!esProcesoOCargoComercial(u)) return null;
  return { id: u.id, usuario: u.usuario, cargo: u.cargo, entidadGrupo: u.entidadGrupo, rol: u.rol };
}