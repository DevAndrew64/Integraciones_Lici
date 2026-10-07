/**
 * Rediseño "EPP y Dotación" — funciones puras para resolver identidad de
 * sujeto, categoría canónica de grupo, tipo de dotación efectivo (explícito
 * o inferido de datos históricos) y qué grupos participan del cálculo.
 * Sin React, sin fetch, sin estado de UI — page.tsx solo las invoca.
 */
import type { FrecuenciaValorAgregado } from '@/lib/costos-estructura/valor-agregado';

export type OrigenSujetoDotacion = 'manoObra' | 'turnante';

/** Clave discriminada `${origen}:${id}` — nunca por nombre/índice/posición. */
export type SujetoDotacionKey = `${OrigenSujetoDotacion}:${string}`;

export type TipoDotacion = 'MASCULINA' | 'FEMENINA' | 'AMBAS' | 'NO_REQUIERE_DOTACION';

/** Ausente = SIN CONFIGURAR (nunca se persiste ese valor explícitamente). */
export type TipoDotacionPorSujeto = Record<SujetoDotacionKey, TipoDotacion>;

export type CategoriaDotGroup = 'DOTACION_MASCULINA' | 'DOTACION_FEMENINA' | 'EPP';

export function construirSujetoDotacionKey(origen: OrigenSujetoDotacion, id: string | number): SujetoDotacionKey {
  return `${origen}:${id}`;
}

export interface DotGroupCategorizable {
  tipo: 'dot' | 'epp';
  nombre: string;
  categoria?: CategoriaDotGroup;
}

/** Ajuste "SERVICIOS NO CONTINUOS — REUTILIZACIÓN REAL DE CATÁLOGOS" —
 * `DotItemRow`/`DotGroup` se exportan aquí (fuente ÚNICA) para que
 * `src/lib/costos-estructura/servicios-no-continuos.ts` reutilice
 * EXACTAMENTE el mismo tipo que `ModalDotacionEpp` en page.tsx (que
 * importa estos mismos tipos desde aquí en vez de declararlos localmente)
 * — nunca dos formas paralelas del mismo dato. */
export interface DotItemRow {
  id: number; codigo: string; desc: string; medida: string;
  cant: number; frec: number; vUnit: number; section: 'dot' | 'epp';
  origen?: 'catalogo' | 'manual';
  vinculoAplicacionAmbosId?: number | null;
  codigoGrupo?: string;
  fechaUltimaCompra?: string;
  /** Ajuste "CANTIDAD Y FRECUENCIA DE EPP DESDE LA API" — de dónde salió
   * `cant`/`frec` al agregar el producto desde el catálogo de EPP: `'api'` =
   * valor de la fila del catálogo (de su grupo de EPP `codigoGrupo`), campo
   * BLOQUEADO; `'no_definido'` = el catálogo trae 0, se ingresa a mano y se avisa.
   * Ausente (filas manuales, de Dotación o históricas) = editable, sin aviso.
   * Ver `catalogo-epp-cantidad-frecuencia.ts`. */
  cantEstadoApi?: 'api' | 'no_definido';
  frecEstadoApi?: 'api' | 'no_definido';
  /** Ajuste "EPP EN VALOR AGREGADO" — mismo par de campos que ya usan
   * `InsumoServicioNoContinuo`/`MaquinariaEquipoRowNormalizado` para marcar
   * un recurso como Valor Agregado (`RecursoConValorAgregado` en
   * valor-agregado.ts). Solo aplica a filas de grupos GLOBALES
   * (`dotGroups`, `tipo==='epp'`) — un `DotItemRow` dentro de
   * `ServicioNoContinuo.dotacionEpp` nunca se marca así (ese EPP participa
   * de Valor Agregado únicamente si se selecciona el Servicio No Continuo
   * completo, para evitar doble conteo). Ausente/`undefined` en histórico
   * ⇒ no seleccionado, nunca se migra. */
  esValorAgregado?: boolean;
  frecuenciaValorAgregado?: FrecuenciaValorAgregado;
}

export interface DotGroup {
  id: number; tipo: 'dot' | 'epp'; nombre: string; rows: DotItemRow[];
  cargoCodigo?: string | null;
  lineaManoObraId?: number | null;
  categoria?: CategoriaDotGroup;
  sujetoKey?: SujetoDotacionKey;
}

/**
 * Categoría canónica de un grupo — prioridad §2: si ya trae `categoria`
 * explícita (grupos nuevos, siempre la escriben) se usa tal cual, nunca se
 * reinterpreta por nombre. Solo los grupos históricos (sin `categoria`) se
 * resuelven por el `nombre` de texto libre — Hombre/Masculino →
 * DOTACION_MASCULINA, Mujer/Femenino → DOTACION_FEMENINA, cualquier grupo
 * `tipo:'epp'` → EPP. Un grupo `tipo:'dot'` histórico con un nombre que no
 * coincide con ninguna variante conocida no se clasifica (`null`) — se
 * conserva en los datos (nunca se pierde ni se migra), pero queda fuera del
 * cálculo hasta que el usuario lo reasigne explícitamente desde el modal.
 */
export function resolverCategoriaDotGroup(grupo: DotGroupCategorizable): CategoriaDotGroup | null {
  if (grupo.categoria) return grupo.categoria;
  if (grupo.tipo === 'epp') return 'EPP';
  const nombre = (grupo.nombre || '').trim().toLowerCase();
  if (nombre === 'hombre' || nombre === 'masculino' || nombre === 'masculina') return 'DOTACION_MASCULINA';
  if (nombre === 'mujer' || nombre === 'femenino' || nombre === 'femenina') return 'DOTACION_FEMENINA';
  return null;
}

export interface GrupoResumenParaInferencia {
  categoria: CategoriaDotGroup | null;
  tieneItems: boolean;
}

/**
 * Inferencia histórica (§3) — SOLO se usa cuando no hay tipo explícito
 * guardado; nunca se persiste automáticamente (eso lo decide el usuario
 * desde el modal). Reglas exactas del ajuste:
 *  - masculino con ítems, femenino vacío → MASCULINA
 *  - femenino con ítems, masculino vacío → FEMENINA
 *  - ambos con ítems → AMBAS
 *  - ambos vacíos y EPP con ítems → NO_REQUIERE_DOTACION
 *  - todo vacío o grupos ausentes → undefined (SIN CONFIGURAR)
 */
export function resolverTipoDotacionHistorico(grupos: GrupoResumenParaInferencia[]): TipoDotacion | undefined {
  const masculino = grupos.find(g => g.categoria === 'DOTACION_MASCULINA');
  const femenino = grupos.find(g => g.categoria === 'DOTACION_FEMENINA');
  const epp = grupos.find(g => g.categoria === 'EPP');
  const mascActivo = !!masculino?.tieneItems;
  const femActivo = !!femenino?.tieneItems;
  const eppActivo = !!epp?.tieneItems;
  if (mascActivo && femActivo) return 'AMBAS';
  if (mascActivo) return 'MASCULINA';
  if (femActivo) return 'FEMENINA';
  if (eppActivo) return 'NO_REQUIERE_DOTACION';
  return undefined;
}

/** Prioridad §3: tipo explícito primero; si no existe, se infiere. */
export function resolverTipoDotacionEfectivo(params: {
  tipoExplicito?: TipoDotacion;
  grupos: GrupoResumenParaInferencia[];
}): TipoDotacion | undefined {
  if (params.tipoExplicito !== undefined) return params.tipoExplicito;
  return resolverTipoDotacionHistorico(params.grupos);
}

/** Categorías que participan del cálculo/render para cada tipo — EPP
 * siempre incluido salvo "sin configurar" (nada activo). */
export function obtenerCategoriasActivas(tipoEfectivo: TipoDotacion | undefined): CategoriaDotGroup[] {
  switch (tipoEfectivo) {
    case 'MASCULINA': return ['DOTACION_MASCULINA', 'EPP'];
    case 'FEMENINA': return ['DOTACION_FEMENINA', 'EPP'];
    case 'AMBAS': return ['DOTACION_MASCULINA', 'DOTACION_FEMENINA', 'EPP'];
    case 'NO_REQUIERE_DOTACION': return ['EPP'];
    default: return [];
  }
}

/**
 * Filtra los grupos que participan del cálculo/render (§10) — los grupos
 * inactivos (ej. masculino cuando el tipo es FEMENINA) NUNCA se eliminan
 * del arreglo fuente, solo se excluyen de este resultado; se recuperan
 * automáticamente si el tipo vuelve a incluir su categoría.
 */
export function filtrarGruposActivos<T extends DotGroupCategorizable>(
  grupos: readonly T[],
  tipoEfectivo: TipoDotacion | undefined,
): T[] {
  const activas = new Set(obtenerCategoriasActivas(tipoEfectivo));
  return grupos.filter(g => {
    const categoria = resolverCategoriaDotGroup(g);
    return categoria !== null && activas.has(categoria);
  });
}

/** Agrupa cualquier colección por su `SujetoDotacionKey` ya resuelta —
 * agnóstico de si el item es un DotGroup, una línea o cualquier otra
 * estructura; el llamador decide cómo obtener la clave de cada item. */
export function agruparGruposPorSujeto<T>(
  items: readonly T[],
  obtenerSujetoKey: (item: T) => SujetoDotacionKey | null,
): Map<SujetoDotacionKey, T[]> {
  const mapa = new Map<SujetoDotacionKey, T[]>();
  for (const item of items) {
    const key = obtenerSujetoKey(item);
    if (key === null) continue;
    const lista = mapa.get(key);
    if (lista) lista.push(item);
    else mapa.set(key, [item]);
  }
  return mapa;
}

/**
 * Un sujeto tiene "configuración real" (§9, debe mostrarse en el render
 * agrupado) cuando tiene un tipo EXPLÍCITO guardado, o cuando al menos un
 * grupo histórico tiene ítems — nunca solo por existir en el selector ni
 * por tener grupos vacíos (§4/§14).
 */
export function detectarConfiguracionReal(params: {
  tipoExplicito?: TipoDotacion;
  grupos: GrupoResumenParaInferencia[];
}): boolean {
  if (params.tipoExplicito !== undefined) return true;
  return params.grupos.some(g => g.tieneItems);
}
