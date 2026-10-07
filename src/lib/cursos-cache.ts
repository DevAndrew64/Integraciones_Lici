// src/lib/cursos-cache.ts
// Utilidad compartida entre /api/cursos/grupos y /api/cursos. Mismo patrón
// de caché en memoria que src/lib/examenes-cache.ts, pero la fuente externa
// exige `empresa` (POST) — la llave de caché incluye la empresa consultada.

const FUENTE_CURSOS_URL = 'https://grupocolba.com/service/public/api/cursos';
const FUENTE_GRUPOS_URL = 'https://grupocolba.com/service/public/api/grupo_cursos';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutos
const TIMEOUT_MS = 10 * 1000;

interface EntradaCache {
  data: Record<string, unknown>[];
  ts: number;
}

const _cacheCursos = new Map<string, EntradaCache>();
const _cacheGrupos = new Map<string, EntradaCache>();
const _cacheCursosFiltrados = new Map<string, EntradaCache>();

export function invalidarCacheCursos() {
  _cacheCursos.clear();
  _cacheGrupos.clear();
  _cacheCursosFiltrados.clear();
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
  const obj = raw as { data?: unknown; cursos?: unknown; grupos?: unknown; results?: unknown };
  return (obj?.data ?? obj?.cursos ?? obj?.grupos ?? obj?.results ?? []) as Record<string, unknown>[];
}

// Ajuste "CURSOS — SOLO FILTROS REALMENTE SOPORTADOS POR LA FUENTE"
// (hallazgo confirmado en vivo, probando la fuente parámetro por parámetro):
// `{empresa}` SIN ningún filtro devuelve una MUESTRA PARCIAL del catálogo
// (una consulta trajo 9 filas; la misma empresa filtrando por ciudad/grupo/
// NIT trae conjuntos completamente distintos, algunos más grandes). Esta
// función (`obtenerCursos`, sin filtro) queda SIN USO desde `route.ts` —
// se conserva solo por si algún consumidor futuro necesita explícitamente
// esa muestra parcial documentada como tal, nunca como "catálogo completo".
export async function obtenerCursos(empresa: string): Promise<Record<string, unknown>[]> {
  const key = empresa.trim().toLowerCase();
  const ahora = Date.now();
  const cached = _cacheCursos.get(key);
  if (cached && ahora - cached.ts < CACHE_TTL) return cached.data;

  const raw = await postConTimeout(FUENTE_CURSOS_URL, { empresa });
  const lista = normalizarLista(raw);
  _cacheCursos.set(key, { data: lista, ts: ahora });
  return lista;
}

// Ajuste "CURSOS — SOLO FILTROS REALMENTE SOPORTADOS POR LA FUENTE" — los
// 3 únicos parámetros confirmados en vivo como filtros REALES de
// `/api/cursos` (probados uno por uno contra la fuente, verificando que el
// contenido devuelto respeta el filtro, no solo el status HTTP):
// `cod_grp`, `ciudad`, `nit_proveedor`. `cod_curso`/`descrip_curso` rompen
// el backend de la fuente (500); `descripcion`/`descrip_grp_curso`/
// `vlr_costo_primera` se ignoran en silencio y devuelven la misma muestra
// parcial de siempre. Por eso esta función EXIGE al menos uno de los 3
// reales — nunca se le permite construir un body sin ninguno, que es
// exactamente lo que producía la muestra parcial engañosa.
export async function obtenerCursosFiltrados(
  empresa: string,
  filtros: { codGrupo?: string; ciudad?: string; nitProveedor?: string }
): Promise<Record<string, unknown>[]> {
  const codGrupo = filtros.codGrupo?.trim() || undefined;
  const ciudad = filtros.ciudad?.trim() || undefined;
  const nitProveedor = filtros.nitProveedor?.trim() || undefined;
  if (!codGrupo && !ciudad && !nitProveedor) {
    throw new Error('Se requiere al menos un filtro soportado por la fuente (Cód. grupo, Ciudad o NIT proveedor).');
  }

  const key = [empresa.trim().toLowerCase(), codGrupo?.toLowerCase() ?? '', ciudad?.toLowerCase() ?? '', nitProveedor?.toLowerCase() ?? ''].join('::');
  const ahora = Date.now();
  const cached = _cacheCursosFiltrados.get(key);
  if (cached && ahora - cached.ts < CACHE_TTL) return cached.data;

  const body: Record<string, unknown> = { empresa };
  if (codGrupo) body.cod_grp = codGrupo;
  if (ciudad) body.ciudad = ciudad;
  if (nitProveedor) body.nit_proveedor = nitProveedor;

  const raw = await postConTimeout(FUENTE_CURSOS_URL, body);
  const lista = normalizarLista(raw);
  _cacheCursosFiltrados.set(key, { data: lista, ts: ahora });
  return lista;
}

export async function obtenerGruposCursos(empresa: string): Promise<Record<string, unknown>[]> {
  const key = empresa.trim().toLowerCase();
  const ahora = Date.now();
  const cached = _cacheGrupos.get(key);
  if (cached && ahora - cached.ts < CACHE_TTL) return cached.data;

  const raw = await postConTimeout(FUENTE_GRUPOS_URL, { empresa });
  const lista = normalizarLista(raw);
  _cacheGrupos.set(key, { data: lista, ts: ahora });
  return lista;
}
