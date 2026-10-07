import { filtrarRegistrosPorCategoria, buscarCampo } from '@/lib/costos-mano-obra/motor-distribuido/catalogo-dotacion-filtro';
import { seleccionarUltimaCompraPorProducto, paginar } from '@/lib/costos-mano-obra/motor-distribuido/catalogo-dotacion-dedup';
import { consolidarFamiliasProducto } from '@/lib/costos-mano-obra/motor-distribuido/catalogo-dotacion-familia';
import { anotarConResolucion } from '@/lib/costos-mano-obra/motor-distribuido/catalogo-epp-cantidad-frecuencia';
import { normalizarCodigoGrupoEpp, validarCodigoGrupoEpp, filtrarPorGrupoEpp } from '@/lib/costos-mano-obra/motor-distribuido/catalogo-epp-grupo';

export const dynamic = 'force-dynamic';

/**
 * Ajuste "OPTIMIZAR VELOCIDAD DEL CATÁLOGO" — mismo contrato de respuesta
 * que /api/dotacion-ext (items/total/page/limit/totalPages), por
 * consistencia con el modal único. Medido: la API de EPP responde ~72
 * filas en ~5 s para una combinación — no es el cuello de botella (el de
 * Dotación sí, ~12.645 filas/~21 s por combinación), pero se aplica la
 * misma caché y deduplicación para no depender de esa diferencia.
 *
 * Ajuste "TRAER EPP POR CÓDIGO DE GRUPO" — `codgrp` (EP001…EP450) filtra a
 * UN grupo: coincidencia exacta, sin consolidar por familias (el grupo define
 * los códigos exactos; consolidar descartaba 17 productos en 15 de 423
 * grupos) y con la caché fría se pide SOLO ese grupo al origen (mismo atajo
 * que /api/dotacion-ext). El filtro local se reafirma siempre, así el
 * resultado no depende de si el origen ya filtra por `codgrp`.
 */

interface EntradaCache { datos: Record<string, unknown>[]; obtenidoEn: number }
const TTL_CACHE_MS = 10 * 60 * 1000;
const cacheCatalogoEpp = new Map<string, EntradaCache>();

async function pedirCatalogoExterno(cuerpo: Record<string, string>): Promise<Record<string, unknown>[]> {
  const res = await fetch('http://grupocolba.com/service/public/api/epp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  if (!res.ok) throw new Error(`API respondió ${res.status}`);
  const raw = await res.json();
  return Array.isArray(raw) ? raw : (raw?.data ?? raw?.epp ?? [raw]);
}

function leerCombinacionCacheada(empresa: string, uen: string): Record<string, unknown>[] | null {
  const entrada = cacheCatalogoEpp.get(`${empresa}::${uen}`);
  return entrada && Date.now() - entrada.obtenidoEn < TTL_CACHE_MS ? entrada.datos : null;
}

async function obtenerCombinacion(empresa: string, uen: string): Promise<Record<string, unknown>[]> {
  const enCache = leerCombinacionCacheada(empresa, uen);
  if (enCache) return enCache;
  const datos = await pedirCatalogoExterno({ empresa, uen });
  cacheCatalogoEpp.set(`${empresa}::${uen}`, { datos, obtenidoEn: Date.now() });
  return datos;
}

// Atajo por código de grupo. Con la caché tibia no se toca la red; con la fría
// se pide SOLO ese grupo al origen. El subconjunto de UN grupo JAMÁS se guarda
// en la caché compartida (la envenenaría con un catálogo reducido, ver el
// incidente descrito en /api/dotacion-ext). Si el origen todavía no filtra por
// `codgrp` y devuelve varios grupos, eso SÍ es el catálogo completo y se cachea.
// Si el origen falla con `codgrp`, se cae al camino completo de siempre.
async function obtenerCombinacionParaGrupo(empresa: string, uen: string, codgrp: string): Promise<Record<string, unknown>[]> {
  const enCache = leerCombinacionCacheada(empresa, uen);
  if (enCache) return enCache;
  try {
    const datos = await pedirCatalogoExterno({ empresa, uen, codgrp });
    const grupos = new Set(datos.map(r => normalizarCodigoGrupoEpp(buscarCampo(r, 'codgrp'))));
    if (datos.length > 50 && grupos.size > 1) cacheCatalogoEpp.set(`${empresa}::${uen}`, { datos, obtenidoEn: Date.now() });
    return datos;
  } catch {
    return obtenerCombinacion(empresa, uen);
  }
}

// Ajuste "FILTRO DE EMPRESA EN DOTACIÓN/EPP DEBE SER AUTOMÁTICO" §5 — mismo
// endurecimiento que /api/dotacion-ext: `empresa` es obligatoria y debe
// ser una de las 3 reconocidas por la fuente externa; un proceso de una
// empresa jamás debe poder recibir productos de otra.
const EMPRESAS_VALIDAS = ['aseo', 'tempo', 'vigi'] as const;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const empresa: string = body.empresa ?? '';
    const uen: string = body.uen ?? '';
    const q: string = (body.q ?? body.busqueda ?? '').trim().toLowerCase();
    const page: number = Number(body.page) > 0 ? Number(body.page) : 1;
    const limit: number = Number(body.limit) > 0 ? Number(body.limit) : 50;

    if (!EMPRESAS_VALIDAS.includes(empresa as typeof EMPRESAS_VALIDAS[number])) {
      return Response.json({ ok: false, error: 'empresa es obligatoria y debe ser una de: aseo, tempo, vigi.' }, { status: 400 });
    }
    // `codgrp` vacío/ausente no filtra. Uno escrito pero inválido se rechaza: nunca se reenvía tal cual al origen.
    let codgrp = '';
    if (normalizarCodigoGrupoEpp(body.codgrp) !== '') {
      const v = validarCodigoGrupoEpp(body.codgrp);
      if (!v.ok) return Response.json({ ok: false, error: v.mensaje }, { status: 400 });
      codgrp = v.codigo;
    }
    const uens = uen ? [uen] : ['BAQ', 'BOG', 'MIN'];
    const empresas = [empresa];
    const combinaciones: [string, string][] = [];
    for (const e of empresas) for (const u of uens) combinaciones.push([e, u]);

    const resultados = await Promise.all(combinaciones.map(([e, u]) => codgrp ? obtenerCombinacionParaGrupo(e, u, codgrp) : obtenerCombinacion(e, u)));
    let datos = resultados.flat();
    if (codgrp) datos = filtrarPorGrupoEpp(datos, codgrp);

    datos = filtrarRegistrosPorCategoria(datos, 'EPP');
    // Ajuste "CANTIDAD Y FRECUENCIA DE EPP DESDE LA API" — opt-in: solo el
    // selector del modal de Dotación/EPP lo pide (la tabla genérica de la
    // pestaña Equipos pinta todas las llaves, no debe recibir campos extra).
    // Cada item lleva el valor de SU fila (su grupo de EPP), ver el módulo.
    const resolverCantFrec = body.resolverCantidadFrecuencia === true;
    if (q) datos = datos.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q)));

    const dedup = seleccionarUltimaCompraPorProducto(datos);
    const lista = codgrp ? dedup.productos : consolidarFamiliasProducto(dedup.productos).familias;
    const pagina = paginar(lista, page, limit);
    const items = resolverCantFrec ? pagina.items.map(it => anotarConResolucion(it)) : pagina.items;

    return Response.json({
      ok: true,
      items,
      total: pagina.total,
      page: pagina.page,
      limit: pagina.limit,
      totalPages: pagina.totalPages,
      data: items,
    });
  } catch {
    return Response.json({ ok: false, error: 'No se pudo conectar a la API de EPP.' }, { status: 502 });
  }
}
