export const dynamic = 'force-dynamic';

/**
 * Ajuste "MAQUINARIA Y EQUIPOS SNC — MODELO SERVICIOS ESPECIALIZADOS" —
 * proxy/adaptador de la fuente EXCLUSIVA de "Maquinaria y Equipos" DENTRO
 * de Servicios No Continuos (SNC):
 * `GET https://grupocolba.com/service/public/api/equipos/obtener_espec`.
 *
 * Confirmado en vivo (re-verificado 2026-08-21 tras un ajuste del backend
 * anunciado por el usuario): GET sin parámetros (los ignora si se
 * envían), 45 registros, campos EXACTOS `codigo, descripcion, vlr_dia,
 * codtipo_c, codstipo_c, sub_tipo` — `codigo` es number y ÚNICO en las 45
 * filas (sin colisiones); `marca`/`referencia` YA NO existen en la fuente
 * (los traía una versión anterior de esta misma API, ya retirados). Un
 * `POST` a esta misma URL responde 405.
 *
 * Separación estricta (nunca fallback): esta fuente es EXCLUSIVA del
 * bloque SNC → "Maquinaria y Equipos"; el módulo general "Maquinaria y
 * Equipos" sigue usando ÚNICAMENTE `POST equipos/obtener`
 * (`/api/equipos-ext`, sin cambios) — nunca se mezclan ni se sustituyen
 * entre sí.
 */

interface EntradaCache { datos: Record<string, unknown>[]; obtenidoEn: number }
const TTL_CACHE_MS = 10 * 60 * 1000;
let cacheCatalogo: EntradaCache | null = null;
let enCurso: Promise<Record<string, unknown>[]> | null = null;

async function obtenerCatalogo(): Promise<Record<string, unknown>[]> {
  if (cacheCatalogo && Date.now() - cacheCatalogo.obtenidoEn < TTL_CACHE_MS) return cacheCatalogo.datos;
  if (enCurso) return enCurso;

  enCurso = (async () => {
    try {
      const res = await fetch('http://grupocolba.com/service/public/api/equipos/obtener_espec', {
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`API respondió ${res.status}`);
      const raw = await res.json();
      const datos: Record<string, unknown>[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
      if (datos.length > 0) cacheCatalogo = { datos, obtenidoEn: Date.now() };
      return datos;
    } finally {
      enCurso = null;
    }
  })();
  return enCurso;
}

/** Normaliza `snake_case` de la fuente → el contrato camelCase que
 * consume la UI (`EquipoEspecializadoCatalogoSNC`, ver
 * `equipos-especializados-snc.ts`) — nunca expone los nombres crudos de
 * la API externa fuera de este archivo. Descarta (nunca inventa) filas
 * sin `codigo`/`descripcion`/`sub_tipo` reales (`codigo` es ahora la
 * clave única de la fuente — una fila sin `codigo` válido no es
 * identificable, se descarta en vez de inventar uno); `vlr_dia`
 * inválido/ausente se normaliza a `0` (nunca se confunde con "no
 * informado" — el llamador decide qué hacer con un equipo sin tarifa
 * vigente, ver `equipoEspecializadoTieneTarifaVigente`). */
function normalizarFila(r: Record<string, unknown>): { codigo: number; descripcion: string; subTipo: string; valorDia: number; codigoTipo: string; codigoSubtipo: string } | null {
  const codigoNum = Number(r.codigo);
  const descripcion = String(r.descripcion ?? '').trim();
  const subTipo = String(r.sub_tipo ?? '').trim();
  if (!Number.isFinite(codigoNum) || !descripcion || !subTipo) return null;
  const valorDiaNum = Number(r.vlr_dia);
  return {
    codigo: codigoNum,
    descripcion,
    subTipo,
    valorDia: Number.isFinite(valorDiaNum) && valorDiaNum > 0 ? valorDiaNum : 0,
    codigoTipo: String(r.codtipo_c ?? '').trim(),
    codigoSubtipo: String(r.codstipo_c ?? '').trim(),
  };
}

export async function GET() {
  try {
    const crudo = await obtenerCatalogo();
    const datos = crudo.map(normalizarFila).filter((r): r is NonNullable<ReturnType<typeof normalizarFila>> => r !== null);
    return Response.json({ ok: true, data: datos, total: datos.length });
  } catch {
    return Response.json({ ok: false, error: 'No se pudo conectar a la API de equipos especializados.' }, { status: 502 });
  }
}
