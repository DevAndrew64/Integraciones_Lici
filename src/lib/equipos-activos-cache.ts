// src/lib/equipos-activos-cache.ts
// Ajuste "AJUSTAR LA LÓGICA Y PRESENTACIÓN DE MAQUINARIA Y EQUIPOS SEGÚN
// LAS FÓRMULAS REALES DEL EXCEL" — nuevo catálogo REAL de activos
// (grupo_activo → subtipo_activo → equipos/obtener), reemplaza el
// catálogo plano que usaba Maquinaria y Equipos (/api/equipos-ext, que
// se conserva SIN CAMBIOS porque `ModuloEquipos` — pestaña "Equipos",
// ajena a Estructura de Costos — sigue dependiendo de él). Mismo patrón
// de caché en memoria por parámetros que src/lib/cursos-cache.ts.

const FUENTE_GRUPOS_URL = 'https://grupocolba.com/service/public/api/grupo_activo';
const FUENTE_SUBTIPOS_URL = 'https://grupocolba.com/service/public/api/subtipo_activo';
const FUENTE_EQUIPOS_URL = 'https://grupocolba.com/service/public/api/equipos/obtener';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutos
const TIMEOUT_MS = 10 * 1000;

interface EntradaCache {
  data: Record<string, unknown>[];
  ts: number;
}

const _cacheGrupos = new Map<string, EntradaCache>();
const _cacheSubtipos = new Map<string, EntradaCache>();
const _cacheEquipos = new Map<string, EntradaCache>();

export function invalidarCacheEquiposActivos() {
  _cacheGrupos.clear();
  _cacheSubtipos.clear();
  _cacheEquipos.clear();
  _cacheConsolidado.clear();
}

async function postConTimeout(url: string, body: Record<string, unknown>): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Error externo: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizarLista(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  const obj = raw as { data?: unknown; items?: unknown; grupos?: unknown; subtipos?: unknown; equipos?: unknown; results?: unknown };
  const lista = obj?.data ?? obj?.items ?? obj?.grupos ?? obj?.subtipos ?? obj?.equipos ?? obj?.results ?? (obj ? [obj] : []);
  return Array.isArray(lista) ? lista as Record<string, unknown>[] : [];
}

export async function obtenerGruposActivo(empresa: string): Promise<Record<string, unknown>[]> {
  const key = empresa.trim().toLowerCase();
  const ahora = Date.now();
  const cached = _cacheGrupos.get(key);
  if (cached && ahora - cached.ts < CACHE_TTL) return cached.data;

  const raw = await postConTimeout(FUENTE_GRUPOS_URL, { empresa });
  const lista = normalizarLista(raw);
  _cacheGrupos.set(key, { data: lista, ts: ahora });
  return lista;
}

export async function obtenerSubtiposActivo(empresa: string, codGrupo: string): Promise<Record<string, unknown>[]> {
  const key = `${empresa.trim().toLowerCase()}::${codGrupo.trim()}`;
  const ahora = Date.now();
  const cached = _cacheSubtipos.get(key);
  if (cached && ahora - cached.ts < CACHE_TTL) return cached.data;

  const raw = await postConTimeout(FUENTE_SUBTIPOS_URL, { empresa, cod_grupo: codGrupo });
  const lista = normalizarLista(raw);
  _cacheSubtipos.set(key, { data: lista, ts: ahora });
  return lista;
}

export async function obtenerEquiposActivo(empresa: string, codGrupo: string, codSubtipo: string): Promise<Record<string, unknown>[]> {
  const key = `${empresa.trim().toLowerCase()}::${codGrupo.trim()}::${codSubtipo.trim()}`;
  const ahora = Date.now();
  const cached = _cacheEquipos.get(key);
  if (cached && ahora - cached.ts < CACHE_TTL) return cached.data;

  const raw = await postConTimeout(FUENTE_EQUIPOS_URL, { empresa, cod_grupo: codGrupo, cod_subtipo: codSubtipo });
  const lista = normalizarLista(raw);
  _cacheEquipos.set(key, { data: lista, ts: ahora });
  return lista;
}

// Ajuste "AJUSTAR EL CATÁLOGO DE MAQUINARIA Y EQUIPOS PARA CONSULTAR TODA
// LA DATA" — la API externa exige cod_grupo+cod_subtipo por consulta (no
// admite una búsqueda global), así que aquí se recorre TODA la jerarquía
// (grupo_activo → subtipo_activo → equipos/obtener) una sola vez por
// empresa y se consolida en un único arreglo cacheado; grupo/subtipo/UEN
// dejan de ser filtros obligatorios del frontend — el catálogo completo
// ya vive en memoria y la ruta HTTP filtra/pagina sobre él. Cada equipo
// consolidado conserva `codGrupo`/`codSubtipo` (la fuente nunca los
// devuelve por fila) para no perder esa trazabilidad.
// Ajuste "CATÁLOGO SOLO MUESTRA UN GRUPO/SUBTIPO" — bajar la concurrencia y
// espaciar los lotes (ver RETRASO_ENTRE_LOTES_MS) hace el recorrido mucho
// más lento; se sube el TTL de 10 a 60 minutos para que ese costo solo se
// pague una vez por hora por empresa, no cada 10 minutos.
const CACHE_TTL_CONSOLIDADO = 60 * 60 * 1000; // 60 minutos — recorrido caro y ahora más lento (concurrencia reducida)
interface EntradaCacheConsolidado { data: ResultadoCatalogoConsolidado; ts: number }
const _cacheConsolidado = new Map<string, EntradaCacheConsolidado>();

export interface EquipoActivoConsolidado extends Record<string, unknown> {
  codGrupo: string;
  codSubtipo: string;
}

/** Ajuste "DIAGNÓSTICO CATÁLOGO DE SELECCIÓN — SOLO 18 RESULTADOS" —
 * `obtenerCatalogoConsolidadoEmpresa` puede necesitar CIENTOS de llamadas
 * a `equipos/obtener` (confirmado en vivo: el grupo "004 MAQUINARIA Y
 * EQUIPO" por sí solo trae 382 filas de `subtipo_activo`, 217 códigos
 * `cod_subtipo` únicos). Si la fuente externa responde 429/error para
 * algunos pares grupo+subtipo, esos pares se omiten (nunca tumban el
 * resto del recorrido) — pero el catálogo resultante queda INCOMPLETO en
 * silencio. `incompleto`/`paresFallidos`/`paresConsultados` exponen esa
 * incompletitud explícitamente (nunca se oculta), para que el consumidor
 * (ruta HTTP → UI) pueda avisar al usuario en vez de mostrar un conteo
 * que parece definitivo sin serlo. */
export interface ResultadoCatalogoConsolidado {
  data: EquipoActivoConsolidado[];
  incompleto: boolean;
  paresFallidos: number;
  paresConsultados: number;
  // Ajuste "CATÁLOGO SOLO MUESTRA UN GRUPO" — un grupo cuyo `subtipo_activo`
  // falla tras reintentos no aporta NINGÚN par grupo+subtipo (no hay nada
  // que reintentar a nivel de `equipos/obtener`), así que antes ese grupo
  // desaparecía del catálogo SIN sumar a `paresFallidos` ni marcar
  // `incompleto`. Se cuenta aparte para que la incompletitud nunca quede
  // oculta en silencio. (Nombre histórico: cuenta grupos cuyo
  // `subtipo_activo` falló, NO fallos de `grupo_activo` mismo — ver
  // `grupoActivoFallido` para ese caso raíz.)
  gruposFallidos: number;
  // Ajuste "CATÁLOGO DE MAQUINARIA — RECORRIDO COMPLETO Y SEGURO" §16 —
  // `grupo_activo` es la RAÍZ del recorrido: si esa única llamada falla
  // (network/429/500), antes se propagaba como excepción no capturada
  // hasta la ruta HTTP (500 genérico, catálogo vacío sin ningún aviso
  // estructurado). Ahora se captura igual que las demás etapas: catálogo
  // vacío pero `incompleto:true` y `grupoActivoFallido:true`, nunca un
  // crash — el consumidor (ruta HTTP → UI) puede avisar en vez de mostrar
  // un error genérico de conexión.
  grupoActivoFallido: boolean;
}

// El grupo "MAQUINARIA Y EQUIPO" de ASEOCOLBA tiene ~381 subtipos — recorrerlo
// uno por uno (secuencial) tarda decenas de minutos y la fuente externa
// falla por timeout en la mayoría de las llamadas. Se recorre en paralelo
// (CONCURRENCIA_EQUIPOS a la vez) con reintentos y backoff exponencial por
// llamada, para terminar en un tiempo razonable aun cuando la fuente
// responda de forma intermitente.
//
// Ajuste "CATÁLOGO SOLO MUESTRA UN GRUPO/SUBTIPO" — confirmado en vivo: con
// concurrencia 8 en `equipos/obtener`, la fuente empieza a rechazar
// solicitudes ("Too Many Requests") desde el segundo lote en adelante, así
// que de cientos de pares grupo+subtipo solo el primer puñado terminaba
// respondiendo y el resto se omitía en silencio (ahora contado, pero la
// causa real es la concurrencia/ráfaga). Se baja la concurrencia y se
// espacian los lotes con un pequeño retraso (`RETRASO_ENTRE_LOTES_MS`) para
// que el recorrido complete muchos más pares reales, aunque tarde más.
const CONCURRENCIA_SUBTIPOS = 3;
const CONCURRENCIA_EQUIPOS = 2;
const REINTENTOS_EQUIPOS = 2;
const RETRASO_ENTRE_LOTES_MS = 250;

async function conReintentos<T>(fn: () => Promise<T>, intentos: number): Promise<T> {
  let ultimoError: unknown;
  for (let intento = 0; intento <= intentos; intento++) {
    try {
      return await fn();
    } catch (e) {
      ultimoError = e;
      if (intento < intentos) await new Promise(r => setTimeout(r, 500 * 2 ** intento));
    }
  }
  throw ultimoError;
}

async function mapConcurrente<T, R>(items: T[], concurrencia: number, fn: (item: T) => Promise<R>, retrasoMs = 0): Promise<R[]> {
  const resultados: R[] = new Array(items.length);
  let siguiente = 0;
  async function trabajador() {
    while (true) {
      const i = siguiente++;
      if (i >= items.length) return;
      // Espacia el INICIO de cada llamada dentro del carril del trabajador
      // (nunca antes de la primera) para no disparar ráfagas que la fuente
      // externa rechaza con "Too Many Requests".
      if (i >= concurrencia && retrasoMs > 0) await new Promise(r => setTimeout(r, retrasoMs));
      resultados[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrencia, items.length) }, trabajador));
  return resultados;
}

// Ajuste "DEMORA MUCHO CARGANDO EL CATÁLOGO — DOS RECORRIDOS EN PARALELO"
// — el precalentado en background (page.tsx, al abrir "Registrar
// maquinaria y equipos") y la consulta real del selector pueden llegar
// aquí casi al mismo tiempo, ANTES de que el primer recorrido termine y
// guarde el resultado en `_cacheConsolidado`. Sin esta protección, cada
// llamada concurrente para la MISMA empresa disparaba su PROPIO recorrido
// completo (grupo_activo→subtipo_activo→equipos/obtener) en paralelo —
// exactamente el doble de carga simultánea sobre el proveedor rate-
// limited, empeorando el riesgo de 429 y el tiempo real de espera en vez
// de mejorarlo. "Single-flight": si ya hay un recorrido en curso para esa
// empresa, cualquier llamada nueva reutiliza la MISMA promesa en vez de
// iniciar un segundo recorrido.
const _promesasEnCursoConsolidado = new Map<string, Promise<ResultadoCatalogoConsolidado>>();

export async function obtenerCatalogoConsolidadoEmpresa(empresa: string): Promise<ResultadoCatalogoConsolidado> {
  const key = empresa.trim().toLowerCase();
  const ahora = Date.now();
  const cached = _cacheConsolidado.get(key);
  if (cached && ahora - cached.ts < CACHE_TTL_CONSOLIDADO) return cached.data;

  const enCurso = _promesasEnCursoConsolidado.get(key);
  if (enCurso) return enCurso;

  const promesa = construirCatalogoConsolidadoEmpresa(empresa, key, ahora);
  _promesasEnCursoConsolidado.set(key, promesa);
  try {
    return await promesa;
  } finally {
    _promesasEnCursoConsolidado.delete(key);
  }
}

async function construirCatalogoConsolidadoEmpresa(empresa: string, key: string, ahora: number): Promise<ResultadoCatalogoConsolidado> {
  // Ajuste §16 — `grupo_activo` es la raíz del recorrido completo (empresa
  // → grupo_activo → subtipo_activo → equipos/obtener); si falla incluso
  // tras reintentos, el catálogo queda vacío pero NUNCA se propaga como
  // excepción no capturada (eso convertiría un fallo transitorio del
  // proveedor en un 500 genérico para el usuario, sin poder distinguirlo
  // de un error real de la aplicación).
  let grupoActivoFallido = false;
  let grupos: Record<string, unknown>[] = [];
  try {
    grupos = await conReintentos(() => obtenerGruposActivo(empresa), REINTENTOS_EQUIPOS);
  } catch {
    grupoActivoFallido = true;
  }
  const codigosGrupo = grupos.map(g => String(g.cod_grupo ?? '').trim()).filter(Boolean);

  // Un grupo cuyo subtipo_activo falle (ej. 500 intermitente de la fuente)
  // no debe tumbar el recorrido completo — se reintenta y, si sigue
  // fallando, ese grupo se omite y el resto de grupos continúa igual, pero
  // se CUENTA (gruposFallidos) para que la incompletitud nunca quede oculta.
  let gruposFallidos = 0;
  const paresGrupoSubtipoConDuplicados = (await mapConcurrente(codigosGrupo, CONCURRENCIA_SUBTIPOS, async codGrupo => {
    try {
      const subtipos = await conReintentos(() => obtenerSubtiposActivo(empresa, codGrupo), REINTENTOS_EQUIPOS);
      return subtipos
        .map(s => String(s.cod_subtipo ?? '').trim())
        .filter(Boolean)
        .map(codSubtipo => ({ codGrupo, codSubtipo }));
    } catch {
      gruposFallidos++;
      return [] as { codGrupo: string; codSubtipo: string }[];
    }
  }, RETRASO_ENTRE_LOTES_MS)).flat();

  // Ajuste "DIAGNÓSTICO CATÁLOGO DE SELECCIÓN — SOLO 18 RESULTADOS" §10/§K
  // — `subtipo_activo` puede repetir el MISMO `cod_subtipo` con distinta
  // `descripcion` (confirmado en vivo: grupo 004 trae 382 filas pero solo
  // 217 códigos únicos) — consultar `equipos/obtener` una vez POR FILA
  // desperdiciaba ~43% de las llamadas en pares grupo+subtipo idénticos,
  // agravando el riesgo de "Too Many Requests" de la fuente externa sin
  // aportar ningún equipo adicional (la respuesta de un mismo cod_grupo+
  // cod_subtipo es la misma sin importar cuántas descripciones distintas
  // tenga en subtipo_activo). Nunca deduplica por `nombre_c` (eso SÍ
  // perdería referencias reales, confirmado con el caso 006|010 = varios
  // modelos de radio) — solo colapsa pares grupo+subtipo repetidos.
  const vistosParGrupoSubtipo = new Set<string>();
  const paresGrupoSubtipo = paresGrupoSubtipoConDuplicados.filter(({ codGrupo, codSubtipo }) => {
    const clave = `${codGrupo}|${codSubtipo}`;
    if (vistosParGrupoSubtipo.has(clave)) return false;
    vistosParGrupoSubtipo.add(clave);
    return true;
  });

  let paresFallidos = 0;
  const equiposPorPar = await mapConcurrente(paresGrupoSubtipo, CONCURRENCIA_EQUIPOS, async ({ codGrupo, codSubtipo }) => {
    try {
      const equipos = await conReintentos(() => obtenerEquiposActivo(empresa, codGrupo, codSubtipo), REINTENTOS_EQUIPOS);
      return equipos.map(eq => ({ ...eq, codGrupo, codSubtipo }));
    } catch {
      // Un subtipo que sigue fallando tras los reintentos no debe tumbar
      // todo el catálogo — se omite y el resto del recorrido continúa,
      // pero se CUENTA (nunca se oculta) para poder avisar que el
      // catálogo quedó incompleto.
      paresFallidos++;
      return [] as EquipoActivoConsolidado[];
    }
  }, RETRASO_ENTRE_LOTES_MS);

  const resultado: ResultadoCatalogoConsolidado = {
    data: equiposPorPar.flat(),
    incompleto: paresFallidos > 0 || gruposFallidos > 0 || grupoActivoFallido,
    paresFallidos,
    paresConsultados: paresGrupoSubtipo.length,
    gruposFallidos,
    grupoActivoFallido,
  };
  _cacheConsolidado.set(key, { data: resultado, ts: ahora });
  return resultado;
}
