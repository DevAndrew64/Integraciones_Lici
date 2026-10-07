import { filtrarRegistrosPorCategoria, filtrarPorPrefijoGrupoCategoria, codigoGrupoNormalizado, esFiltroSinGrupo, type CategoriaCatalogoDotacion } from '@/lib/costos-mano-obra/motor-distribuido/catalogo-dotacion-filtro';
import { seleccionarUltimaCompraPorProducto, paginar } from '@/lib/costos-mano-obra/motor-distribuido/catalogo-dotacion-dedup';
import { consolidarFamiliasProducto } from '@/lib/costos-mano-obra/motor-distribuido/catalogo-dotacion-familia';

export const dynamic = 'force-dynamic';

/**
 * Ajuste "OPTIMIZAR VELOCIDAD DEL CATÁLOGO" — diagnóstico medido contra la
 * API externa real (grupocolba.com/service/public/api/dotacion, POST
 * {empresa,uen}): UNA sola combinación empresa+uen ya devuelve 12.645
 * filas (~2,5 MB) en ~21 s; no acepta paginación ni filtro por categoría
 * en el origen. Cuando el cliente pedía "Todos" (empresa/uen en blanco),
 * el código anterior consultaba las 9 combinaciones (3 empresas × 3 UEN)
 * y las combinaba — de ahí los ~35.591 registros reportados en el modal.
 *
 * Medición 2026-09-29 (aseo/BAQ, 13.139 filas; el backend PHP lee
 * `empresa`, `uen` [ambos obligatorios], `codgrp`, `descripcion`, `sexo`):
 *  - `sexo` (M/F) SÍ filtra en el origen, por prefijo de `codgrp`, pero
 *    descarta las filas con `codgrp` vacío (206), "0" (14) y "X092" (1) —
 *    filas que la regla de este catálogo conserva en AMBAS categorías y
 *    que alimentan "Sin grupo". Por eso `sexo` NUNCA se reenvía.
 *  - `codgrp` SÍ filtra en el origen: coincidencia EXACTA (no parcial:
 *    "M01" → 0 filas), sin distinguir mayúsculas ni espacios, y responde
 *    en ~0,3 s en vez de ~20-30 s. Filas idénticas, campo por campo, a
 *    filtrar el catálogo completo en local (8 grupos verificados).
 *  - `descripcion` (y `q`) NO filtran nada: la búsqueda sigue siendo local.
 *
 * Estrategia aplicada aquí (§8 del ajuste):
 *  - Caché en memoria del proceso por combinación empresa+uen (TTL 10 min)
 *    — la primera apertura de cada combinación paga el costo real de la
 *    API externa UNA vez; las siguientes (mismo empresa/uen, cualquier
 *    categoría/búsqueda/página) se sirven desde la caché en milisegundos.
 *  - Atajo por `codgrp` con la caché fría: un código de grupo real se pide
 *    directamente al origen (~0,3 s) SIN guardar el resultado en la caché
 *    compartida; con la caché tibia se filtra en local como siempre.
 *  - Filtro de categoría (masculina/femenina/EPP) + búsqueda + código de
 *    grupo, deduplicación (última compra por producto) y paginación
 *    SIEMPRE ocurren en el servidor — el navegador nunca recibe más de
 *    `limit` filas. El filtro local por `codgrp` se reafirma también tras
 *    el atajo, así que el resultado no depende de cómo lo interprete el
 *    origen.
 */

interface EntradaCache { datos: Record<string, unknown>[]; obtenidoEn: number }
const TTL_CACHE_MS = 10 * 60 * 1000; // 10 minutos — el catálogo no cambia segundo a segundo.
const cacheCatalogoDotacion = new Map<string, EntradaCache>();

async function pedirCatalogoExterno(cuerpo: Record<string, string>): Promise<Record<string, unknown>[]> {
  const res = await fetch('http://grupocolba.com/service/public/api/dotacion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  if (!res.ok) throw new Error(`API respondió ${res.status}`);
  const raw = await res.json();
  return Array.isArray(raw) ? raw : (raw?.data ?? raw?.dotacion ?? [raw]);
}

function leerCombinacionCacheada(empresa: string, uen: string): Record<string, unknown>[] | null {
  const entrada = cacheCatalogoDotacion.get(`${empresa}::${uen}`);
  return entrada && Date.now() - entrada.obtenidoEn < TTL_CACHE_MS ? entrada.datos : null;
}

// Ajuste "OJO ESTÁS AJUSTANDO UNA Y SE DESCONFIGURA LA OTRA" — causa raíz
// real: esta función cacheaba bajo la clave `empresa::uen` (sin
// codgrp/sexo) la respuesta de CUALQUIER fetch, incluida una ya filtrada
// por `codgrp` en el cuerpo de la petición externa (usada por el
// selector "traer por grupo"). La primera consulta que llegaba con un
// codgrp (p. ej. "M001") dejaba cacheado ese subconjunto REDUCIDO como si
// fuera el catálogo COMPLETO de esa empresa+uen — todas las categorías
// siguientes (masculina/femenina/EPP, con o sin codgrp) leían de ese
// mismo caché envenenado y veían "no se encontraron productos" hasta que
// expirara el TTL. `sexo`/`codgrp` NUNCA deben viajar en el fetch que
// alimenta este caché compartido — el filtrado por categoría/código de
// grupo ya ocurre DESPUÉS, sobre los datos cacheados (ver el `POST`
// principal más abajo); esta función siempre trae/cachea el catálogo
// COMPLETO de la combinación empresa+uen, sin excepción.
async function obtenerCombinacion(empresa: string, uen: string): Promise<Record<string, unknown>[]> {
  const clave = `${empresa}::${uen}`;
  const enCache = leerCombinacionCacheada(empresa, uen);
  if (enCache) return enCache;
  const datos = await pedirCatalogoExterno({ empresa, uen });
  // Nunca cachea una respuesta sospechosamente pequeña (posible error/
  // timeout upstream disfrazado de 200 OK) — un catálogo real de una sola
  // combinación empresa+uen siempre trae miles de filas (confirmado en
  // vivo: 12.645). Esto evita además que una respuesta parcial quede
  // envenenando el caché compartido para las próximas 10 minutos.
  if (datos.length > 50) cacheCatalogoDotacion.set(clave, { datos, obtenidoEn: Date.now() });
  return datos;
}

// Atajo por código de grupo real (mismo criterio que el filtro local:
// exacto, sin distinguir mayúsculas). Con la caché tibia no se toca la red;
// con la fría se pide SOLO ese grupo al origen (~0,3 s frente a ~20-30 s) y
// el subconjunto se descarta tras responder — JAMÁS se escribe en
// `cacheCatalogoDotacion` (ver el envenenamiento descrito arriba). Si el
// origen falla con `codgrp`, se cae al camino completo de siempre.
async function obtenerCombinacionParaGrupo(empresa: string, uen: string, codgrp: string): Promise<Record<string, unknown>[]> {
  const enCache = leerCombinacionCacheada(empresa, uen);
  if (enCache) return enCache;
  try {
    return await pedirCatalogoExterno({ empresa, uen, codgrp });
  } catch {
    return obtenerCombinacion(empresa, uen);
  }
}

// Ajuste "FILTRO DE EMPRESA EN DOTACIÓN/EPP DEBE SER AUTOMÁTICO" §5 — la
// protección por empresa NUNCA puede ser solo un filtro visual del
// frontend: este backend ahora EXIGE `empresa` (una de las 3 reconocidas
// por la fuente externa) en cada solicitud. Un proceso de una empresa
// jamás debe poder recibir productos de otra — antes, omitir `empresa`
// ("Todos") mezclaba las 3 combinaciones en la misma respuesta.
const EMPRESAS_VALIDAS = ['aseo', 'tempo', 'vigi'] as const;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const empresa: string = body.empresa ?? '';
    const uen: string = body.uen ?? '';
    const codgrp: string = body.codgrp ?? '';
    const q: string = (body.q ?? body.busqueda ?? '').trim().toLowerCase();
    const categoria: CategoriaCatalogoDotacion | undefined = body.categoria;
    const page: number = Number(body.page) > 0 ? Number(body.page) : 1;
    const limit: number = Number(body.limit) > 0 ? Number(body.limit) : 50;

    if (!EMPRESAS_VALIDAS.includes(empresa as typeof EMPRESAS_VALIDAS[number])) {
      return Response.json({ ok: false, error: 'empresa es obligatoria y debe ser una de: aseo, tempo, vigi.' }, { status: 400 });
    }
    const uens = uen ? [uen] : ['BAQ', 'BOG', 'MIN'];
    const empresas = [empresa];
    const combinaciones: [string, string][] = [];
    for (const e of empresas) for (const u of uens) combinaciones.push([e, u]);

    // "Sin grupo" no es un código real (nunca existe como `codgrp` en el
    // origen) y un campo vacío no filtra: solo un código real usa el atajo.
    const codgrpReal = codgrp.trim() && !esFiltroSinGrupo(codgrp) ? codgrp.trim() : '';
    const resultados = await Promise.all(combinaciones.map(([e, u]) => codgrpReal ? obtenerCombinacionParaGrupo(e, u, codgrpReal) : obtenerCombinacion(e, u)));
    let datos = resultados.flat();

    // Filtro (§5 orden correcto — categoría antes de paginar). Con la caché
    // fría, un código real ya se pidió al origen (atajo); con la tibia no.
    // En ambos casos se aplica aquí, así el resultado no depende de cómo
    // lo interprete el origen. `sexo` no se reenvía (ver el encabezado).
    // Ajuste "SIN GRUPO" (§6/§7) — valor especial reservado: filtra a
    // ÚNICAMENTE las filas con codgrp vacío, en cualquier categoría, sin
    // disparar la validación de prefijo M/F (esa validación vive en
    // `validarCodigoGrupoParaCategoria`, ya la aplicó el frontend antes de
    // llegar aquí). Un campo vacío (§7) sigue sin filtrar nada.
    if (esFiltroSinGrupo(codgrp)) {
      datos = datos.filter(r => codigoGrupoNormalizado(r as Record<string, unknown>) === '');
    } else if (codgrp.trim()) {
      const codgrpNorm = codgrp.trim().toLowerCase();
      datos = datos.filter(r => String((r as Record<string, unknown>).codgrp ?? '').toLowerCase() === codgrpNorm);
    }
    // Ajuste "CORREGIR FILTRO DE CÓDIGO DE GRUPO PARA DOTACIÓN MASCULINA" +
    // "CHAPUZA DESAPARECE PARA VIGICOLBA" — para DOTACION_MASCULINA/
    // DOTACION_FEMENINA, `codgrp` es la ÚNICA señal (nunca el nombre):
    // `filtrarRegistrosPorCategoria` (clasificación por nombre) YA NO se
    // aplica para estas dos categorías — solo para EPP, que no tiene
    // codgrp y por eso necesita clasificarse por nombre/campo estructurado.
    if (categoria === 'EPP') datos = filtrarRegistrosPorCategoria(datos, categoria);
    if (categoria) datos = filtrarPorPrefijoGrupoCategoria(datos, categoria);
    if (q) datos = datos.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q)));

    // NIVEL 1 (§2) — deduplicación por código: un producto, la fila de su
    // compra vigente.
    const dedup = seleccionarUltimaCompraPorProducto(datos);

    // NIVEL 2 (§2/§3) — consolidación por familia (variantes de talla del
    // mismo producto): se aplica SIEMPRE sobre el resultado del NIVEL 1,
    // nunca sobre el historial crudo, y SIEMPRE antes de paginar (§12) —
    // la misma familia nunca reaparece en otra página.
    const familias = consolidarFamiliasProducto(dedup.productos);

    // Paginación (§9/§12) — el navegador nunca recibe más de `limit`
    // filas; `total`/`totalPages` representan FAMILIAS únicas, no códigos
    // ni filas históricas.
    const pagina = paginar(familias.familias, page, limit);

    return Response.json({
      ok: true,
      items: pagina.items,
      total: pagina.total,
      page: pagina.page,
      limit: pagina.limit,
      totalPages: pagina.totalPages,
      // Compatibilidad con el consumidor anterior (data/total planos) —
      // se retira en cuanto el cliente termine de migrar a items/total.
      data: pagina.items,
    });
  } catch {
    return Response.json({ ok: false, error: 'No se pudo conectar a la API de Dotación.' }, { status: 502 });
  }
}
