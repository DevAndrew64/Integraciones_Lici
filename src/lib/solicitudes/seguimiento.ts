/**
 * Ajuste "SEGUIMIENTO — MERCADEO" — historial de anotaciones sobre la
 * evolución de un proceso Privado, separado deliberadamente de:
 *  - `observacionRechazo`/`motivoRechazo` (causal de rechazo);
 *  - `asignaciones[].observaciones` (observaciones de REVISIÓN por fila,
 *    atadas a un responsable, cambian `estadoRevision`, con su propio
 *    patrón de Aceptada/No aceptada + tipo de causa — Seguimiento NUNCA
 *    reutiliza esa lógica, solo el DISEÑO visual de tarjeta);
 *  - `resultadoFinal`/`observacionResultado` (resultado del cierre);
 *  - comentarios SQR.
 * Persistido en `Solicitud.observacionesSeguimiento` (JSON array, mismo
 * patrón que `asignaciones`/`docData`/`obsData` — sin tabla relacionada).
 * Cada anotación tiene un `numero` ESTABLE, asignado una sola vez al
 * crearla — nunca se renumera al eliminar otra (mismo espíritu que la
 * numeración de facturas/consecutivos: un hueco es aceptable, un número
 * reutilizado no).
 *
 * ELIMINAR es un SOFT DELETE (`activo:false`, mismo patrón ya usado por
 * `asignaciones[]` en este código — ausencia de `activo` = activa): la
 * anotación deja de mostrarse (`ordenarSeguimientoMasRecientePrimero` la
 * filtra), pero permanece en el JSON. Es deliberado, no un descuido: sin
 * esto, `siguienteNumeroSeguimiento` (que calcula `max(numero)+1` sobre el
 * arreglo persistido) REUTILIZARÍA el número de una anotación eliminada
 * si esa era la de número más alto — un hueco en la numeración es
 * aceptable, un número repetido no. Como `observacionesSeguimiento` ya es
 * JSONB (sin columnas propias), este soft delete no requiere ninguna
 * migración adicional.
 */
import { isAdmin, esMercadeo } from '@/lib/roles';
import { esProcesoPrivado, type SolicitudConAsignaciones } from './autorizacion-asignacion';

export interface AnotacionSeguimiento {
  id: string;
  numero: number;
  texto: string;
  creadoEn: string;
  creadoPor: string;
  rol: string;
  actualizadoEn?: string;
  actualizadoPor?: string;
  /** Soft delete — `false` = eliminada (no se muestra, pero su `numero`
   * queda protegido para siempre). Ausente/`true` = activa. */
  activo?: boolean;
  eliminadoEn?: string;
  eliminadoPor?: string;
}

export const MAX_LONGITUD_TEXTO_SEGUIMIENTO = 2000;

export interface ResultadoAutorizacionSeguimiento {
  autorizado: boolean;
  motivo?: string;
}

/**
 * Autoriza crear/editar/eliminar una anotación de seguimiento — MISMA
 * regla para las 3 operaciones (el enunciado del ajuste no distingue
 * "quien creó" como sí hace `asignaciones[].observaciones`; cualquier
 * Admin o Mercadeo autorizado puede editar/eliminar cualquier anotación,
 * no solo la propia): Administrador global (conserva privilegios
 * globales, igual que en `puedeCerrarSolicitud`) o Mercadeo — y para
 * Mercadeo, SOLO sobre un proceso Privado (mismo criterio `esProcesoPrivado`
 * que ya usa `puedeCerrarSolicitud`, nunca una copia paralela). Mercadeo
 * NUNCA gestiona seguimiento en un proceso Público. Comercial y el resto
 * de roles: sin autorización — solo lectura.
 */
export function puedeGestionarSeguimiento(rol: string, solicitud: SolicitudConAsignaciones): ResultadoAutorizacionSeguimiento {
  if (isAdmin(rol)) return { autorizado: true };
  if (esMercadeo(rol)) {
    if (esProcesoPrivado(solicitud)) return { autorizado: true };
    return { autorizado: false, motivo: 'Mercadeo no puede gestionar seguimiento en un proceso Público.' };
  }
  return { autorizado: false, motivo: 'Solo Mercadeo o un Administrador pueden gestionar seguimiento.' };
}

/** Alias — se conserva el nombre original para no romper callers ya
 * escritos contra "agregar" específicamente; misma función, misma regla
 * (ver `puedeGestionarSeguimiento`). */
export const puedeAgregarSeguimiento = puedeGestionarSeguimiento;

/** Validación del texto — obligatorio, recortado, con límite razonable
 * (mismo orden de magnitud que `MAX_LONGITUD_OBSERVACION_RESULTADO`/
 * `MAX_LONGITUD_MOTIVO_RECHAZO` en `/cerrar/route.ts`, 2000 caracteres). */
export function validarTextoSeguimiento(texto: unknown): { ok: true; valor: string } | { ok: false; error: string } {
  if (typeof texto !== 'string') return { ok: false, error: 'texto es requerido y debe ser texto.' };
  const valor = texto.trim();
  if (!valor) return { ok: false, error: 'texto no puede estar vacío.' };
  if (valor.length > MAX_LONGITUD_TEXTO_SEGUIMIENTO) {
    return { ok: false, error: `texto excede el máximo de ${MAX_LONGITUD_TEXTO_SEGUIMIENTO} caracteres.` };
  }
  return { ok: true, valor };
}

function esAnotacionValida(a: unknown): a is AnotacionSeguimiento {
  if (a == null || typeof a !== 'object') return false;
  const r = a as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.texto === 'string' && typeof r.creadoEn === 'string' && typeof r.creadoPor === 'string';
}

/** Siguiente número estable a asignar — `max(numero existente) + 1`, o `1`
 * si no hay ninguna anotación todavía. Recorre el arreglo COMPLETO,
 * incluidas las anotaciones eliminadas (`activo:false`) — es justamente
 * por eso que el soft delete existe: si se ignoraran las eliminadas aquí,
 * borrar la de número más alto haría que la siguiente reutilizara ese
 * mismo número. Filas sin `numero` (dato histórico anterior a este
 * ajuste, si lo hubiera) no cuentan para el máximo — `Number(r.numero) || 0`. */
export function siguienteNumeroSeguimiento(actuales: unknown): number {
  const arr = Array.isArray(actuales) ? actuales : [];
  let max = 0;
  for (const a of arr) {
    if (a == null || typeof a !== 'object') continue;
    const n = Number((a as Record<string, unknown>).numero);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/** Normaliza el arreglo crudo (JSON persistido, tipo desconocido) a
 * anotaciones ACTIVAS y las ordena MÁS RECIENTE PRIMERO por `numero`
 * descendente — la numeración es estable y monótona creciente, así que
 * ordenar por ella es equivalente a ordenar por fecha de creación pero sin
 * depender del formato de `creadoEn`. Nunca confía en el orden de
 * inserción del arreglo persistido. Excluye `activo:false` (eliminadas) —
 * siguen en el JSON (protegen su `numero` para siempre, ver
 * `siguienteNumeroSeguimiento`), pero nunca se muestran. */
export function ordenarSeguimientoMasRecientePrimero(crudo: unknown): AnotacionSeguimiento[] {
  const arr = Array.isArray(crudo) ? crudo : [];
  return arr.filter(esAnotacionValida).filter((a) => a.activo !== false).slice().sort((a, b) => (Number(b.numero) || 0) - (Number(a.numero) || 0));
}
