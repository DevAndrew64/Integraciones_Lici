/**
 * FASE 6 (diagnóstico Aseocolba) — manejo reactivo de sesión expirada.
 *
 * Arquitectura elegida: un wrapper controlado sobre `fetch` (instalado
 * una sola vez, en el punto de entrada del cliente) que OBSERVA la
 * respuesta de cada petición sin alterarla — nunca consume el body,
 * nunca cambia el status ni los headers que recibe el llamador original.
 * No es un monkey-patch "porque requiere menos cambios": se investigó
 * primero la alternativa de un wrapper `fetchAutenticado(...)` migrando
 * cada call-site existente, y se descartó porque `page.tsx` tiene ~198
 * llamadas `fetch(...)` directas sin ningún wrapper compartido — migrar
 * mecánicamente esa cantidad de sitios es precisamente el escenario de
 * mayor riesgo de "quedar un endpoint sin cubrir por olvido" que se
 * busca evitar, y excede el criterio de cambio mínimo de esta fase. El
 * wrapper aquí, en cambio, cubre el 100% de las llamadas por construcción
 * (nadie puede "olvidar" envolver una llamada nueva), sin tocar ningún
 * call-site existente.
 *
 * Todas las funciones de decisión (`esRutaApiSinSesion`,
 * `evaluarRespuestaSesion`) son puras y no dependen de `window` — se
 * prueban directamente. Solo `instalarInterceptorSesion` toca el mundo
 * exterior (el objeto con la propiedad `fetch` a envolver, `globalThis`
 * por defecto — funciona igual en el navegador, donde `globalThis===
 * window`, y en pruebas, inyectando un objeto simulado).
 */
import { esRutaApiSinSesion } from './rutas-api-sesion';

export type ManejadorSesionExpirada = () => void;

// Idempotencia entre respuestas 401 concurrentes — módulo-level a
// propósito: React puede desmontar/remontar el componente que instala el
// interceptor sin que esto se reinicie a mitad de una expiración en
// curso. Se resetea explícitamente tras un login exitoso
// (`marcarSesionEstablecida`), nunca por temporización.
let expiracionEnCurso = false;

/** Debe llamarse cuando se establece una sesión válida (login o
 * restauración desde sessionStorage) — permite que una FUTURA expiración
 * vuelva a disparar el flujo completo tras haber vuelto a iniciar sesión. */
export function marcarSesionEstablecida(): void {
  expiracionEnCurso = false;
}

/** Solo para pruebas — nunca se llama desde código de producción. */
export function resetearParaPruebas(): void {
  expiracionEnCurso = false;
}

export interface ParametrosEvaluacionSesion {
  /** URL exacta pasada a `fetch` (relativa o absoluta). */
  url: string;
  status: number;
  /** `location.origin` del documento — para excluir cualquier URL que no
   * sea del mismo origen (APIs externas, Grupo Colba, etc.). */
  origenActual: string;
  /** true si, al momento de la respuesta, existía una sesión establecida
   * en el cliente (estado React `sesion`/`sessionStorage`) — nunca se
   * dispara el flujo de expiración si el usuario nunca había iniciado
   * sesión (evita el loop de la propia pantalla de login, además de la
   * exclusión explícita de `/api/auth/login` más abajo). */
  huboSesionPrevia: boolean;
}

/**
 * Punto ÚNICO de disparo del flujo de expiración — comparte el mismo
 * flag de idempotencia (`expiracionEnCurso`) entre TODOS los caminos que
 * pueden detectar una sesión expirada (hoy: solo una respuesta 401 del
 * interceptor de `fetch` — el temporizador de inactividad del frontend se
 * retiró, ver "SIN CIERRE AUTOMÁTICO DE SESIÓN" en `page.tsx`). Nunca
 * dispara dos veces hasta la siguiente `marcarSesionEstablecida()`,
 * sin importar cuál camino llegue primero. Retorna `true` si disparó
 * (para pruebas).
 */
export function dispararExpiracionSiCorresponde(onExpirada: ManejadorSesionExpirada): boolean {
  if (expiracionEnCurso) return false;
  expiracionEnCurso = true;
  onExpirada();
  return true;
}

/**
 * Decide si una respuesta debe disparar el flujo de "sesión expirada" y,
 * si corresponde, invoca `onExpirada` a través de
 * `dispararExpiracionSiCorresponde` — como máximo UNA VEZ hasta la
 * siguiente `marcarSesionEstablecida()`, compartiendo esa idempotencia
 * con cualquier otro camino (ver arriba). Función pura salvo por el flag
 * de idempotencia (module-level) y la llamada a `onExpirada`. Retorna
 * `true` si disparó el flujo (para pruebas).
 */
export function evaluarRespuestaSesion(
  params: ParametrosEvaluacionSesion,
  onExpirada: ManejadorSesionExpirada,
): boolean {
  const { url, status, origenActual, huboSesionPrevia } = params;
  if (status !== 401) return false; // 403/500/200/etc. nunca disparan este flujo (ver Fase 6 §12, tests 9/10)
  if (!huboSesionPrevia) return false; // nunca antes de haber iniciado sesión (evita el loop de login)
  let url_: URL;
  try {
    url_ = new URL(url, origenActual);
  } catch {
    return false; // URL irreconocible — nunca se asume sesión expirada por defecto
  }
  if (url_.origin !== origenActual) return false; // cualquier dominio externo, incluido Grupo Colba, queda excluido
  if (!url_.pathname.startsWith('/api/')) return false; // solo backend propio de Licycolba
  if (esRutaApiSinSesion(url_.pathname)) return false; // login/logout/uploadthing/api pública — misma fuente que el proxy
  return dispararExpiracionSiCorresponde(onExpirada);
}

/**
 * Instala el wrapper de `fetch` en `objetivo` (por defecto `globalThis` —
 * en el navegador es exactamente `window`). Retorna una función para
 * desinstalarlo (usada en el cleanup del `useEffect` que lo instala).
 * NUNCA altera la respuesta entregada al llamador original — solo la
 * observa después de resolverse.
 */
export function instalarInterceptorSesion(
  obtenerHuboSesionPrevia: () => boolean,
  onExpirada: ManejadorSesionExpirada,
  obtenerOrigenActual: () => string,
  objetivo: { fetch: typeof fetch } = globalThis as unknown as { fetch: typeof fetch },
): () => void {
  // Sin `.bind(objetivo)`: `fetch` no depende de `this`, y bindearlo aquí
  // crearía una referencia NUEVA — al desinstalar, `objetivo.fetch` quedaría
  // como esa copia bound en vez de la función original exacta.
  const fetchOriginal = objetivo.fetch;
  const fetchEnvuelto = (async (...args: Parameters<typeof fetch>) => {
    const respuesta = await fetchOriginal(...args);
    try {
      const primerArg = args[0];
      const url = typeof primerArg === 'string'
        ? primerArg
        : primerArg instanceof URL
          ? primerArg.toString()
          : (primerArg as Request).url;
      evaluarRespuestaSesion(
        { url, status: respuesta.status, origenActual: obtenerOrigenActual(), huboSesionPrevia: obtenerHuboSesionPrevia() },
        onExpirada,
      );
    } catch {
      // La detección de expiración NUNCA debe poder romper la petición original.
    }
    return respuesta;
  }) as typeof fetch;
  objetivo.fetch = fetchEnvuelto;
  return () => { objetivo.fetch = fetchOriginal; };
}
