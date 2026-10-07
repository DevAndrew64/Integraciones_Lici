import { paginar } from '@/lib/costos-mano-obra/motor-distribuido/catalogo-dotacion-dedup';

export const dynamic = 'force-dynamic';

/**
 * Ajuste "REDISEÑAR MAQUINARIA Y EQUIPOS" — mismo contrato de respuesta
 * que /api/insumos-ext (items/total/page/limit/totalPages) para el nuevo
 * selector "Seleccionar desde catálogo", con caché en memoria (TTL 10
 * min) — la API externa no acepta empresa/uen (catálogo único, sin
 * segmentar), así que se cachea bajo una sola entrada global.
 *
 * Diagnóstico confirmado en vivo (grupocolba.com/service/public/api/
 * equipos, GET sin parámetros): 42 filas, campos
 * `codigo,codtipo_c,codstipo_c,descripcion,marca,referencia,serial,
 * vlr_dia` — sin IVA, sin fecha; `vlr_dia` es valor POR DÍA (nunca
 * mensual). Se conserva el método GET (sin body) para el consumidor
 * previo (`ModuloEquipos`/pestaña "Equipos", que no envía filtros) —
 * ambos verbos comparten la misma caché.
 */

interface EntradaCache { datos: Record<string, unknown>[]; obtenidoEn: number }
const TTL_CACHE_MS = 10 * 60 * 1000;
let cacheCatalogoEquipos: EntradaCache | null = null;
let enCursoCatalogoEquipos: Promise<Record<string, unknown>[]> | null = null;

async function obtenerCatalogo(): Promise<Record<string, unknown>[]> {
  if (cacheCatalogoEquipos && Date.now() - cacheCatalogoEquipos.obtenidoEn < TTL_CACHE_MS) return cacheCatalogoEquipos.datos;
  if (enCursoCatalogoEquipos) return enCursoCatalogoEquipos;

  enCursoCatalogoEquipos = (async () => {
    try {
      const res = await fetch('http://grupocolba.com/service/public/api/equipos', {
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`API respondió ${res.status}`);
      const raw = await res.json();
      const datos: Record<string, unknown>[] = Array.isArray(raw) ? raw : (raw?.data ?? raw?.equipos ?? [raw]);
      if (datos.length > 5) cacheCatalogoEquipos = { datos, obtenidoEn: Date.now() };
      return datos;
    } finally {
      enCursoCatalogoEquipos = null;
    }
  })();
  return enCursoCatalogoEquipos;
}

export async function GET() {
  try {
    const data = await obtenerCatalogo();
    return Response.json({ ok: true, data, total: data.length });
  } catch {
    return Response.json({ ok: false, error: 'No se pudo conectar a la API de equipos.' }, { status: 502 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const q: string = (body.q ?? body.busqueda ?? '').trim().toLowerCase();
    const page: number = Number(body.page) > 0 ? Number(body.page) : 1;
    const limit: number = Number(body.limit) > 0 ? Number(body.limit) : 50;

    let datos = await obtenerCatalogo();
    if (q) {
      datos = datos.filter(r => {
        const codigo = String((r as Record<string, unknown>).codigo ?? '').toLowerCase();
        const descripcion = String((r as Record<string, unknown>).descripcion ?? '').toLowerCase();
        const marca = String((r as Record<string, unknown>).marca ?? '').toLowerCase();
        return codigo.includes(q) || descripcion.includes(q) || marca.includes(q);
      });
    }

    const pagina = paginar(datos, page, limit);
    return Response.json({
      ok: true,
      items: pagina.items,
      total: pagina.total,
      page: pagina.page,
      limit: pagina.limit,
      totalPages: pagina.totalPages,
      data: pagina.items,
    });
  } catch {
    return Response.json({ ok: false, error: 'No se pudo conectar a la API de equipos.' }, { status: 502 });
  }
}
