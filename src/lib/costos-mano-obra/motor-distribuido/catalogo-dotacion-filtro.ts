/**
 * Ajuste "CATÁLOGO DE DOTACIÓN — FILTRO INTERNO POR CATEGORÍA" — validación
 * DEFENSIVA de los registros ya devueltos por el catálogo externo
 * (grupocolba.com/service/public/api/dotacion, vía /api/dotacion-ext):
 * aunque la consulta ya envía el filtro (empresa/uen/sexo) desde el origen,
 * esta función es la última barrera antes de mostrar la tabla — nunca deja
 * pasar un registro cuya clasificación estructurada contradiga la
 * categoría solicitada. Pura, sin React ni fetch.
 *
 * Diagnóstico (§B del ajuste): el catálogo externo es un proxy sin
 * contrato documentado (`EquipoRow = Record<string, unknown>`, cualquier
 * forma) — no existe un campo único y confiable de "sexo/categoría"
 * verificado contra la API real. Por eso esta función busca, en orden de
 * confianza, un campo ESTRUCTURADO (sexo/genero/categoria/tipo) antes de
 * caer al último recurso de buscar palabras en el nombre — nunca al revés.
 */

export type CategoriaCatalogoDotacion = 'DOTACION_MASCULINA' | 'DOTACION_FEMENINA' | 'EPP';

export type ClasificacionProducto = 'MASCULINO' | 'FEMENINO' | 'AMBOS' | 'EPP' | 'DESCONOCIDO';

export function buscarCampo(registro: Record<string, unknown>, ...claves: string[]): unknown {
  for (const clave of claves) {
    const entrada = Object.entries(registro).find(([k]) => k.toLowerCase() === clave.toLowerCase());
    if (entrada && entrada[1] !== null && entrada[1] !== undefined && String(entrada[1]).trim() !== '') return entrada[1];
  }
  return undefined;
}

/**
 * Clasifica un registro del catálogo — prioridad §5/§6 del ajuste:
 *  1. Campo estructurado de sexo/género (`sexo`, `genero`, `sex`, `gender`).
 *  2. Campo estructurado de categoría/tipo de producto (`categoria`,
 *     `tipoproducto`, `tipo`, `grupoarticulo`) que indique EPP.
 *  3. Último recurso: palabras en el nombre/descripción — NUNCA se usa si
 *     ya existe un campo estructurado con valor.
 * Un registro sin ninguna señal reconocible es 'DESCONOCIDO' — nunca se
 * asume un sexo/categoría por defecto.
 */
export function clasificarProductoCatalogo(registro: Record<string, unknown>): ClasificacionProducto {
  const sexoEstructurado = buscarCampo(registro, 'sexo', 'genero', 'sex', 'gender');
  if (sexoEstructurado !== undefined) {
    const v = String(sexoEstructurado).trim().toUpperCase();
    if (v === 'M' || v === 'MASCULINO' || v === 'HOMBRE') return 'MASCULINO';
    if (v === 'F' || v === 'FEMENINO' || v === 'MUJER') return 'FEMENINO';
    if (v === 'U' || v === 'UNISEX' || v === 'AMBOS') return 'AMBOS';
  }
  const categoriaEstructurada = buscarCampo(registro, 'categoria', 'tipoproducto', 'tipo_producto', 'tipo', 'grupoarticulo');
  if (categoriaEstructurada !== undefined) {
    const v = String(categoriaEstructurada).trim().toUpperCase();
    if (v.includes('EPP') || v.includes('PROTECCION')) return 'EPP';
    if (v.includes('DOTACION') || v.includes('UNIFORME')) return sexoEstructurado !== undefined ? (String(sexoEstructurado).trim().toUpperCase().startsWith('F') ? 'FEMENINO' : 'MASCULINO') : 'DESCONOCIDO';
  }
  // Último recurso — solo cuando NINGÚN campo estructurado existe.
  if (sexoEstructurado === undefined && categoriaEstructurada === undefined) {
    const nombre = String(buscarCampo(registro, 'nombre', 'descripcion', 'description', 'name', 'des_item') ?? '').toLowerCase();
    if (/\b(dama|femenin[oa]|mujer)\b/.test(nombre)) return 'FEMENINO';
    if (/\b(caballero|masculin[oa]|hombre)\b/.test(nombre)) return 'MASCULINO';
  }
  return 'DESCONOCIDO';
}

/**
 * Validación defensiva final (§6) — excluye cualquier registro cuya
 * clasificación contradiga la categoría solicitada. 'DESCONOCIDO' y
 * 'AMBOS' se conservan para DOTACION_MASCULINA/DOTACION_FEMENINA (unisex
 * o sin clasificar no es lo mismo que "del otro sexo"); para EPP se exige
 * clasificación EPP explícita o desconocida (nunca un producto ya
 * clasificado como dotación masculina/femenina).
 */
export function filtrarRegistrosPorCategoria<T extends Record<string, unknown>>(
  registros: readonly T[],
  categoria: CategoriaCatalogoDotacion,
): T[] {
  return registros.filter(r => {
    const clasificacion = clasificarProductoCatalogo(r);
    if (categoria === 'DOTACION_MASCULINA') return clasificacion !== 'FEMENINO' && clasificacion !== 'EPP';
    if (categoria === 'DOTACION_FEMENINA') return clasificacion !== 'MASCULINO' && clasificacion !== 'EPP';
    return clasificacion !== 'MASCULINO' && clasificacion !== 'FEMENINO';
  });
}

/**
 * Ajuste "CORREGIR FILTRO DE CÓDIGO DE GRUPO PARA DOTACIÓN MASCULINA" —
 * diagnóstico real (2026-08-02, 12.645 filas de Dotación aseo/BAQ, medido
 * contra la API externa): el código de grupo (`codgrp`) SÍ correlaciona
 * fuertemente con el sexo — de las filas cuyo NOMBRE contiene una palabra
 * de género inequívoca, 4012/4033 (99.5%) de las masculinas caen bajo un
 * grupo que empieza por "M", y 1144/1159 (98.7%) de las femeninas bajo uno
 * que empieza por "F". El problema real de "mezcla" no estaba en cómo se
 * guardan/renderizan los grupos (`DotGroup.categoria`, ya separado
 * correctamente en todo el código, ver dotacion-epp-tipo.ts) sino en el
 * FILTRO DE BÚSQUEDA del catálogo externo: `clasificarProductoCatalogo`
 * solo reconoce género por palabras clave en el nombre — el 59% de las
 * filas (7476/12.645) NO tiene ninguna palabra de género en la
 * descripción ("CAMISA TIPO POLO...", sin "hombre"/"dama") y por eso
 * `filtrarRegistrosPorCategoria` las clasifica 'DESCONOCIDO' y las deja
 * pasar en AMBAS categorías — de ahí la mezcla real entre masculina y
 * femenina. El prefijo de `codgrp` se aplica aquí como filtro OBLIGATORIO,
 * server-side, antes de deduplicar/consolidar por familia — nunca en el
 * frontend, nunca después de paginar.
 *
 * Corrección "CHAPUZA DESAPARECE PARA VIGICOLBA" (2026-08-24) — la premisa
 * "100% de las filas de Dotación traen codgrp" NUNCA se verificó contra
 * Vigicolba: medido en vivo contra vigi/BAQ (569 filas), 74 (13%) traen
 * `codgrp` VACÍO — incluidos productos reales (CHAPUZA CON PORTA BALAS,
 * CHAPUZA EN ACERO, CHAPUZA PARA PISTOLA 9MM, botas, camisas). El filtro
 * anterior excluía esas 74 filas de AMBAS categorías (ni `''.startsWith('M')`
 * ni `''.startsWith('F')` son ciertos) — las volvía invisibles sin razón,
 * nunca por pertenecer al otro sexo.
 *
 * Regla FUNCIONAL final confirmada (2026-08-24, reemplaza un intento previo
 * de inferir por nombre/"Sin clasificar"): `codgrp` es la ÚNICA señal para
 * masculina/femenina — nunca se infiere sexo por descripción, código,
 * familia ni ninguna otra heurística.
 *  - `codgrp` empieza por `M` → SOLO masculina.
 *  - `codgrp` empieza por `F` → SOLO femenina.
 *  - `codgrp` vacío/ausente → aparece en AMBAS (masculina y femenina); la
 *    decisión final de a cuál pertenece la toma el usuario al seleccionar
 *    el producto, nunca el sistema. Por eso este filtro (y solo este) es
 *    quien decide masculina/femenina — `filtrarRegistrosPorCategoria`
 *    (clasificación por nombre) YA NO se aplica para estas dos categorías
 *    (sigue aplicándose para EPP, que no tiene codgrp).
 */
export function resolverPrefijoGrupoObligatorio(categoria: CategoriaCatalogoDotacion): 'M' | 'F' | null {
  if (categoria === 'DOTACION_MASCULINA') return 'M';
  if (categoria === 'DOTACION_FEMENINA') return 'F';
  return null; // EPP nunca usa código de grupo (confirmado: la API de EPP no trae este campo).
}

export function codigoGrupoNormalizado(registro: Record<string, unknown>): string {
  return String(buscarCampo(registro, 'codgrp', 'codigogrupo', 'codgrupo', 'grupo', 'grupocodigo') ?? '').trim().toUpperCase();
}

/**
 * Filtro OBLIGATORIO por prefijo de grupo (§1/§8) — para EPP (prefijo
 * `null`) no filtra nada. Para masculina/femenina, excluye cualquier fila
 * cuyo código de grupo SÍ está presente pero no empieza por la letra
 * correspondiente (señal positiva de que pertenece a otro grupo — nunca
 * se ignora). Una fila con `codgrp` vacío/ausente ("sin señal de grupo",
 * ver ajuste "CHAPUZA DESAPARECE PARA VIGICOLBA") NUNCA se excluye — se
 * conserva y aparece en AMBAS categorías (masculina y femenina), sin
 * ninguna heurística adicional (nunca por nombre/código/familia) — la
 * decisión final es del usuario, nunca del sistema.
 */
export function filtrarPorPrefijoGrupoCategoria<T extends Record<string, unknown>>(
  registros: readonly T[],
  categoria: CategoriaCatalogoDotacion,
): T[] {
  const prefijo = resolverPrefijoGrupoObligatorio(categoria);
  if (prefijo === null) return registros.slice();
  return registros.filter(r => {
    const codgrp = codigoGrupoNormalizado(r);
    if (codgrp === '') return true;
    return codgrp.startsWith(prefijo);
  });
}

export interface ResultadoValidacionCodigoGrupo {
  ok: boolean;
  mensaje?: string;
}

/** Valor especial reservado del campo "Cód. grupo" — nunca puede coincidir
 * con un código real (los códigos reales son alfanuméricos cortos tipo
 * "M013"). Case-insensitive, sin importar espacios extra. */
export const TEXTO_FILTRO_SIN_GRUPO = 'SIN GRUPO';

/**
 * `true` cuando el texto escrito es el valor especial "SIN GRUPO" (§6) —
 * el usuario pide ver ÚNICAMENTE los productos sin código de grupo, en
 * cualquiera de las dos categorías. Nunca se confunde con el campo vacío
 * (§7: vacío = "no filtrar por grupo", un conjunto mucho más amplio).
 */
export function esFiltroSinGrupo(codigoGrupoEscrito: string): boolean {
  return codigoGrupoEscrito.trim().toUpperCase() === TEXTO_FILTRO_SIN_GRUPO;
}

/**
 * Validación del campo ESPECÍFICO que el usuario escribe (§3.B/§4) — nunca
 * confunde el prefijo obligatorio (interno, invisible) con un código
 * completo escrito por el usuario. Un campo vacío siempre es válido
 * (consulta "todos los grupos de esa categoría"); si escribe algo, debe
 * respetar el prefijo — nunca se corrige en silencio (p. ej. "F001"→"M001").
 * Ajuste "SIN GRUPO" (§6) — el valor especial `esFiltroSinGrupo` SIEMPRE es
 * válido, en ambas categorías: nunca dispara la validación de prefijo M/F
 * (no es un código de grupo, es una vista distinta — productos SIN grupo).
 */
export function validarCodigoGrupoParaCategoria(
  codigoGrupoEscrito: string,
  categoria: CategoriaCatalogoDotacion,
): ResultadoValidacionCodigoGrupo {
  const normalizado = codigoGrupoEscrito.trim().toUpperCase();
  if (normalizado === '') return { ok: true };
  if (esFiltroSinGrupo(normalizado)) return { ok: true };
  const prefijo = resolverPrefijoGrupoObligatorio(categoria);
  if (prefijo === null) return { ok: true };
  if (!normalizado.startsWith(prefijo)) {
    const etiqueta = categoria === 'DOTACION_MASCULINA' ? 'masculina' : 'femenina';
    return { ok: false, mensaje: `Para dotación ${etiqueta}, el código de grupo debe comenzar por ${prefijo}.` };
  }
  return { ok: true };
}
