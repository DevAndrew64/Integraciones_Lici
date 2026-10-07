import { paginar } from '@/lib/costos-mano-obra/motor-distribuido/catalogo-dotacion-dedup';
import { debeExcluirseDeInsumosSNC } from '@/lib/costos-estructura/catalogo-insumos-snc';

export const dynamic = 'force-dynamic';

/**
 * Ajuste "REDISEÑAR LA PESTAÑA INSUMOS" — mismo contrato de respuesta que
 * /api/dotacion-ext y /api/epp-ext (items/total/page/limit/totalPages),
 * caché en memoria por empresa+UEN (TTL 10 min) y filtro/paginación
 * SIEMPRE en el servidor — el navegador nunca recibe más de `limit` filas.
 *
 * Diagnóstico confirmado en vivo (grupocolba.com/service/public/api/
 * insumos, POST {empresa,uen}): 875 filas para aseo/BAQ. La fuente AHORA
 * trae 7 campos por fila (`codigo,coddot,nombre,undmed,undnegocio,valor,
 * fecha_ultima_compra` — verificado 2026-08-08; una revisión anterior de
 * este comentario decía que `coddot`/`fecha_ultima_compra` no existían,
 * eso quedó desactualizado), sin códigos repetidos dentro de una misma
 * combinación empresa+uen (0 duplicados verificados). Sigue sin traer
 * ciudad, estado explícito ni IVA discriminado — el estado ("Vigente"/
 * "Sin valor vigente") que muestra la tabla se DERIVA de `valor>0`, igual
 * que en Dotación/EPP, nunca de un campo propio de la fuente. Por eso, a
 * diferencia de Dotación/EPP, este endpoint NO aplica deduplicación por
 * última compra ni consolidación de familias: con 0 duplicados
 * confirmados no hace falta decidir un "ganador" entre filas del mismo
 * código.
 *
 * Ajuste "INSUMOS — GRUPO 18 (EPP) SOLO EN SERVICIOS NO CONTINUOS" —
 * diagnóstico EN VIVO (2026-08-28, aseo/BAQ) confirmó que `nocontinuo` SÍ
 * es un parámetro real de la fuente y que su semántica es exactamente la
 * pedida: `nocontinuo:false` (u OMITIDO — probado idéntico, 2894/2894
 * mismos códigos) NUNCA trae códigos de grupo "18" (EPP); `nocontinuo:true`
 * sí (272 filas reales, ej. "ARNEZ 4 ARGOLLAS...", "BOTA DE SEGURIDAD
 * T.45"), y es SIEMPRE superset de `false` (nunca un catálogo disjunto:
 * 2888/2888 códigos de `false` reaparecen en `true`, más 1182 nuevos). Por
 * eso Insumos normal sigue enviando `nocontinuo:false` (comportamiento
 * INTACTO, ver `EMPRESAS_VALIDAS`/tests) y Servicios No Continuos pasa
 * `nocontinuo:true` — el parámetro lo decide el CALLER (page.tsx, según
 * `destinoModalInsumos`), nunca una condición de código/grupo aquí. Ver
 * `src/lib/costos-estructura/catalogo-insumos-snc.ts` para el diagnóstico
 * completo y la exclusión de grupo "01" (solo Aseocolba, solo en SNC).
 */

interface EntradaCache { datos: Record<string, unknown>[]; obtenidoEn: number }
const TTL_CACHE_MS = 10 * 60 * 1000; // 10 minutos, mismo TTL que dotacion-ext/epp-ext.
const cacheCatalogoInsumos = new Map<string, EntradaCache>();
// Protección de solicitudes simultáneas — si dos peticiones llegan para la
// misma combinación empresa+uen+nocontinuo mientras la caché está vacía/
// expirada, comparten la MISMA promesa en curso en vez de golpear la API
// externa dos veces.
const enCursoCatalogoInsumos = new Map<string, Promise<Record<string, unknown>[]>>();

// Ajuste "CACHÉ DEBE DISTINGUIR nocontinuo" — la clave ahora incluye el
// booleano: una consulta de Insumos normal (`false`) y una de Servicios No
// Continuos (`true`) para la MISMA empresa+uen son respuestas DISTINTAS de
// la fuente (ver diagnóstico arriba) — nunca deben compartir entrada de
// caché ni contaminarse entre sí.
async function obtenerCombinacion(empresa: string, uen: string, nocontinuo: boolean): Promise<Record<string, unknown>[]> {
  const clave = `${empresa}::${uen}::${nocontinuo}`;
  const entrada = cacheCatalogoInsumos.get(clave);
  if (entrada && Date.now() - entrada.obtenidoEn < TTL_CACHE_MS) return entrada.datos;
  const enCurso = enCursoCatalogoInsumos.get(clave);
  if (enCurso) return enCurso;

  const promesa = (async () => {
    try {
      // `nocontinuo` solo se agrega al body cuando es `true` — Insumos
      // normal sigue mandando EXACTAMENTE `{empresa,uen}` (sin la clave),
      // idéntico al contrato de antes de este ajuste (confirmado en vivo:
      // omitir el campo y mandar `false` son la misma respuesta, pero no
      // hay razón para cambiar el body de un flujo que ya funcionaba).
      const body: Record<string, unknown> = { empresa, uen };
      if (nocontinuo) body.nocontinuo = true;
      const res = await fetch('http://grupocolba.com/service/public/api/insumos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`API respondió ${res.status}`);
      const raw = await res.json();
      const datos: Record<string, unknown>[] = Array.isArray(raw) ? raw : (raw?.data ?? raw?.insumos ?? [raw]);
      // Nunca cachea una respuesta sospechosamente pequeña (posible error/
      // timeout upstream disfrazado de 200 OK) — mismo resguardo que
      // dotacion-ext (confirmado en vivo: 876 filas para una sola
      // combinación empresa+uen).
      if (datos.length > 20) cacheCatalogoInsumos.set(clave, { datos, obtenidoEn: Date.now() });
      return datos;
    } finally {
      enCursoCatalogoInsumos.delete(clave);
    }
  })();
  enCursoCatalogoInsumos.set(clave, promesa);
  return promesa;
}

// Ajuste "APLICAR LA MISMA LÓGICA DE EMPRESA/PERFIL EN INSUMOS" §5 — mismo
// endurecimiento que /api/dotacion-ext y /api/epp-ext: `empresa` es
// obligatoria y debe ser una de las 3 reconocidas por la fuente externa
// (mismos códigos cortos, confirmado arriba: aseo/tempo/vigi); un proceso
// de una empresa jamás debe poder recibir insumos de otra — antes,
// omitir `empresa` ("Todos") mezclaba las 3 combinaciones en la misma
// respuesta.
const EMPRESAS_VALIDAS = ['aseo', 'tempo', 'vigi'] as const;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const empresa: string = body.empresa ?? '';
    const uen: string = body.uen ?? '';
    const q: string = (body.q ?? body.busqueda ?? '').trim().toLowerCase();
    const codigoF: string = (body.codigo ?? '').trim().toLowerCase();
    // Ajuste "TRAER PRODUCTOS POR CÓDIGO DE GRUPO" — mismo concepto que ya
    // existe en Dotación (`codgrp`, dotacion-ext/route.ts) y en la columna
    // "Cód. grupo" de EPP, pero aquí `codgrps` es un ARRAY (un producto
    // puede pertenecer a varios grupos) — confirmado en vivo contra la
    // fuente real (grupocolba.com/service/public/api/insumos): match por
    // pertenencia al arreglo, nunca igualdad exacta de un campo string.
    const codgrp: string = (body.codgrp ?? '').trim().toLowerCase();
    const page: number = Number(body.page) > 0 ? Number(body.page) : 1;
    const limit: number = Number(body.limit) > 0 ? Number(body.limit) : 50;
    // Ajuste "INSUMOS — GRUPO 18 (EPP) SOLO EN SERVICIOS NO CONTINUOS" —
    // `nocontinuo` es el ÚNICO parámetro que distingue el contexto de
    // consulta (Insumos normal vs. Servicios No Continuos); lo decide
    // exclusivamente el caller (`page.tsx`), nunca se infiere aquí de
    // código/grupo. `=== true` estricto: cualquier otro valor (ausente,
    // `false`, string, etc.) es "Insumos normal", igual que hasta ahora.
    const nocontinuo: boolean = body.nocontinuo === true;

    if (!EMPRESAS_VALIDAS.includes(empresa as typeof EMPRESAS_VALIDAS[number])) {
      return Response.json({ ok: false, error: 'empresa es obligatoria y debe ser una de: aseo, tempo, vigi.' }, { status: 400 });
    }
    const uens = uen ? [uen] : ['BAQ', 'BOG', 'MIN'];
    const empresas = [empresa];
    const combinaciones: [string, string][] = [];
    for (const e of empresas) for (const u of uens) combinaciones.push([e, u]);

    const resultados = await Promise.all(combinaciones.map(([e, u]) => obtenerCombinacion(e, u, nocontinuo)));
    let datos = resultados.flat();

    // Ajuste "ASEOCOLBA SNC EXCLUYE GRUPO 01" — solo aplica en contexto SNC
    // (`nocontinuo===true`) y solo para Aseocolba (`debeExcluirseDeInsumosSNC`
    // ya lo restringe a `empresa==='aseo'`); Insumos normal e
    // Tempocolba/Vigicolba SNC no se tocan. Ver
    // `src/lib/costos-estructura/catalogo-insumos-snc.ts` para el diagnóstico.
    if (nocontinuo) {
      datos = datos.filter(r => !debeExcluirseDeInsumosSNC(empresa, String((r as Record<string, unknown>).codigo ?? '')));
    }

    // Búsqueda por código o nombre (§2/§12) — únicos campos de texto
    // reales que trae la API; nunca se filtra por grupo/ciudad/estado
    // porque esos campos no existen en la respuesta.
    if (q) {
      datos = datos.filter(r => {
        const codigo = String((r as Record<string, unknown>).codigo ?? '').toLowerCase();
        const nombre = String((r as Record<string, unknown>).nombre ?? '').toLowerCase();
        return codigo.includes(q) || nombre.includes(q);
      });
    }
    // Ajuste "FILTRO POR CÓDIGO" — independiente de `q` (que busca en
    // código y nombre a la vez), mismo patrón ya usado en Exámenes/
    // Dotación (Cód. examen/NIT proveedor como filtros propios además del
    // buscador libre). Se aplica EN SERVIDOR, ANDed con `q` si ambos
    // vienen presentes.
    if (codigoF) {
      datos = datos.filter(r => String((r as Record<string, unknown>).codigo ?? '').toLowerCase().includes(codigoF));
    }
    if (codgrp) {
      datos = datos.filter(r => {
        const grupos = (r as Record<string, unknown>).codgrps;
        return Array.isArray(grupos) && grupos.some(g => String(g).toLowerCase() === codgrp);
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
    return Response.json({ ok: false, error: 'No se pudo conectar a la API de Insumos.' }, { status: 502 });
  }
}
