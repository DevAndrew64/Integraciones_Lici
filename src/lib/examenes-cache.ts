// src/lib/examenes-cache.ts
// Utilidad compartida entre /api/examenes y /api/examenes/por-grupo

const FUENTE_URL = 'https://grupocolba.com/service/public/api/examenes';

let _cache: Record<string, unknown>[] | null = null;
let _cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

export function invalidarCache() {
  _cache = null;
  _cacheTs = 0;
}

export async function obtenerExamenes(): Promise<Record<string, unknown>[]> {
  const ahora = Date.now();
  if (_cache && ahora - _cacheTs < CACHE_TTL) return _cache;

  const res = await fetch(FUENTE_URL, { method: 'GET', cache: 'no-store' });
  if (!res.ok) throw new Error(`Error externo: ${res.status}`);

  // Leer como buffer para manejar el encoding correctamente
  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') ?? '';
  const isLatin = contentType.toLowerCase().includes('iso-8859') ||
                  contentType.toLowerCase().includes('latin');

  let text: string;
  if (isLatin) {
    text = new TextDecoder('iso-8859-1').decode(buffer);
  } else {
    // Intentar UTF-8 estricto, si falla usar latin-1
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      text = new TextDecoder('iso-8859-1').decode(buffer);
    }
  }

  const raw = JSON.parse(text);
  const lista: Record<string, unknown>[] = Array.isArray(raw)
    ? raw
    : (raw.data ?? raw.examenes ?? raw.results ?? []);

  _cache = lista;
  _cacheTs = ahora;
  return lista;
}