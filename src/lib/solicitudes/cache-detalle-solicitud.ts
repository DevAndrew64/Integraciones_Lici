/**
 * Caché en memoria (sin librería nueva) del detalle completo de una
 * Solicitud (`GET /api/solicitudes/[id]?sinEvidencias=true`) — evita
 * peticiones duplicadas cuando la ficha y el editor externo piden el mismo
 * `solicitudId` casi al mismo tiempo, y permite precargar el detalle antes
 * de que el usuario abra el editor (hover del ícono de lápiz).
 *
 * Guarda la PROMESA (no solo el resultado) para que dos llamadas
 * simultáneas reutilicen la misma petición en curso — nunca disparan dos
 * `fetch` idénticos.
 *
 * Protección contra la carrera "GET antiguo termina después de un POST más
 * reciente": cada entrada lleva una GENERACIÓN monotónica por
 * `solicitudId`. Un GET dispara con la generación vigente en ese momento;
 * `actualizarCacheConResultado` (llamado tras un guardado exitoso) SIEMPRE
 * avanza la generación. Si un GET viejo resuelve después de que la
 * generación ya avanzó, su resultado se descarta — nunca sobrescribe datos
 * más recientes. El flag `vigente` local de cada componente protege contra
 * cambios de SOLICITUD; esta generación protege la carrera dentro de la
 * MISMA solicitud.
 */

interface EntradaCache {
  promesa: Promise<unknown>;
  timestamp: number;
  generacion: number;
}

const TTL_MS = 30_000;
const cache = new Map<number, EntradaCache>();
const generaciones = new Map<number, number>();

function vigenteEnTTL(entrada: EntradaCache): boolean {
  return Date.now() - entrada.timestamp < TTL_MS;
}

function avanzarGeneracion(id: number): number {
  const siguiente = (generaciones.get(id) ?? 0) + 1;
  generaciones.set(id, siguiente);
  return siguiente;
}

function generacionActual(id: number): number {
  return generaciones.get(id) ?? 0;
}

/** true si `generacion` sigue siendo la más reciente conocida para `id` —
 * úsalo antes de aplicar el resultado de un GET a estado visible/caché. */
export function esGeneracionVigente(id: number, generacion: number): boolean {
  return generacionActual(id) === generacion;
}

/** Devuelve la promesa cacheada (si sigue vigente) o dispara una nueva
 * petición y la guarda. Nunca usa `asignaciones -> -1` — siempre el
 * detalle completo real. */
export function obtenerDetalleSolicitudCacheado(id: number): Promise<unknown> {
  return obtenerDetalleSolicitudCacheadoConGeneracion(id).promesa;
}

/** Igual que `obtenerDetalleSolicitudCacheado`, pero además devuelve la
 * generación con la que se disparó — el llamador debe verificar
 * `esGeneracionVigente(id, generacion)` antes de aplicar el resultado a su
 * propio estado, para no dejar que un GET viejo sobrescriba un guardado más
 * reciente. */
export function obtenerDetalleSolicitudCacheadoConGeneracion(id: number): { promesa: Promise<unknown>; generacion: number } {
  const entrada = cache.get(id);
  if (entrada && vigenteEnTTL(entrada)) return { promesa: entrada.promesa, generacion: entrada.generacion };
  const generacion = avanzarGeneracion(id);
  const promesa = fetch(`/api/solicitudes/${id}?sinEvidencias=true`).then((r) => r.json());
  // Si falla, no deja una promesa rota cacheada — el siguiente consumidor
  // (o un "Reintentar" del usuario) dispara una petición nueva en vez de
  // repetir el mismo rechazo indefinidamente. Solo se limpia si nadie más
  // ya avanzó la generación (ej. un guardado que llegó mientras tanto).
  promesa.catch(() => {
    if (cache.get(id)?.generacion === generacion) cache.delete(id);
  });
  cache.set(id, { promesa, timestamp: Date.now(), generacion });
  return { promesa, generacion };
}

/** Precarga sin esperar el resultado — usar en hover/selección de fila.
 * La limpieza en caso de error ya la hace `obtenerDetalleSolicitudCacheado`. */
export function precargarDetalleSolicitud(id: number): void {
  void obtenerDetalleSolicitudCacheado(id);
}

/** Invalidar tras agregar/retirar/reasignar responsables (respaldo, cuando
 * no se tiene a mano el resultado definitivo del guardado). La próxima
 * lectura vuelve a consultar. */
export function invalidarDetalleSolicitud(id: number): void {
  avanzarGeneracion(id); // cualquier GET en vuelo con la generación anterior queda invalidado
  cache.delete(id);
}

/** Fuente inmediata tras un guardado exitoso — reemplaza la caché con el
 * resultado DEFINITIVO del backend (no solo invalida) y avanza la
 * generación, así cualquier GET más viejo que resuelva después queda
 * marcado obsoleto por `esGeneracionVigente`. */
export function actualizarCacheConResultado(id: number, datos: unknown): void {
  const generacion = avanzarGeneracion(id);
  cache.set(id, { promesa: Promise.resolve(datos), timestamp: Date.now(), generacion });
}

/** Solo para pruebas — limpia toda la caché entre casos. */
export function limpiarCacheDetalleSolicitud(): void {
  cache.clear();
  generaciones.clear();
}