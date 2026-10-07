/**
 * Herencia de Dotación/EPP/Exámenes/Vacunas/Cursos del cargo principal
 * hacia sus turnantes físicos — módulo PURO, reutilizable por los 5
 * módulos (page.tsx aporta las filas ya filtradas por posición; este
 * archivo nunca lee estado de React ni conoce `dotGroups`/`examRows`/etc.).
 *
 * Regla de negocio (autorizada explícitamente): un turnante hereda la
 * configuración de TODAS las posiciones de origen que cubre
 * (`grupo.coberturaPorPosicion`), consolidando por identidad — nunca
 * concatenando ciegamente. Dos posiciones con el MISMO elemento y la
 * MISMA configuración se cuentan una sola vez (una persona física no
 * necesita el doble de dotación); dos posiciones con el mismo elemento
 * pero configuración DISTINTA son un CONFLICTO que nunca se resuelve
 * en silencio (nunca sumar/promediar/escoger arbitrariamente) — se
 * reporta para que el usuario decida, y el elemento en conflicto queda
 * fuera del costeo hasta que se resuelva.
 *
 * El costeo resultante se multiplica por `cantidadTurnantesFisicos`
 * (nunca por cantidad de líneas TURNANTE-AUTO, cantOpeFijos, factor
 * laboral 7/42, 21/42, ni cantidad de posiciones de origen) — ver auditoría
 * de modalidades: `cantOpeFijos` de la línea de referencia HORAS_REALES
 * es SIEMPRE '1' independientemente de cuántos turnantes físicos existan
 * realmente, así que nunca puede usarse como base de este costeo.
 */

// ── Consolidación genérica por identidad ────────────────────────────────

export interface FilaConOrigen<T> { posicionId: number; fila: T }

export interface ElementoConsolidado<T> { fila: T; origenPosicionIds: number[] }

export interface ConflictoConsolidacion<T> { identidad: string; filas: FilaConOrigen<T>[] }

export interface ResultadoConsolidacion<T> {
  consolidadas: ElementoConsolidado<T>[];
  conflictos: ConflictoConsolidacion<T>[];
}

/**
 * Agrupa filas de varias posiciones por `identidad` (identidad ESTABLE
 * del elemento — código/oferta/proveedor, nunca descripción textual) y,
 * dentro de cada grupo, verifica que la `configuracion` relevante
 * coincida exactamente:
 *  - todas coinciden → UN solo elemento consolidado, con trazabilidad de
 *    qué posiciones lo originaron (nunca se duplica el costo).
 *  - alguna difiere → CONFLICTO — nunca se resuelve aquí (nunca se suma,
 *    promedia, ni se escoge una posición arbitraria); queda fuera de
 *    `consolidadas`, reportado en `conflictos`.
 */
export function consolidarFilasPorIdentidad<T>(
  filasPorPosicion: FilaConOrigen<T>[],
  identidad: (fila: T) => string,
  configuracion: (fila: T) => string,
): ResultadoConsolidacion<T> {
  const porIdentidad = new Map<string, FilaConOrigen<T>[]>();
  for (const f of filasPorPosicion) {
    const clave = identidad(f.fila);
    const lista = porIdentidad.get(clave);
    if (lista) lista.push(f); else porIdentidad.set(clave, [f]);
  }
  const consolidadas: ElementoConsolidado<T>[] = [];
  const conflictos: ConflictoConsolidacion<T>[] = [];
  for (const [clave, filas] of porIdentidad) {
    const configuraciones = new Set(filas.map(f => configuracion(f.fila)));
    if (configuraciones.size === 1) {
      consolidadas.push({ fila: filas[0].fila, origenPosicionIds: [...new Set(filas.map(f => f.posicionId))] });
    } else {
      conflictos.push({ identidad: clave, filas });
    }
  }
  return { consolidadas, conflictos };
}

// ── Identidad/configuración por módulo ───────────────────────────────────
// Identidad = qué hace que dos filas sean "el mismo elemento" (nunca
// descripción textual). Configuración = campos que DEBEN coincidir para
// poder consolidar; si la identidad coincide pero la configuración no,
// es un conflicto, nunca un promedio/suma/elección arbitraria.

const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();

export interface DotItemRowMin { codigo: string; cant: number; frec: number; vUnit: number; medida: string }
export const identidadDotItem = (r: DotItemRowMin): string => norm(r.codigo);
export const configuracionDotItem = (r: DotItemRowMin): string => `${r.cant}|${r.frec}|${r.vUnit}|${norm(r.medida)}`;

export interface ExamRowMin { codExamen?: string; tipo: string; nitProveedor?: string; codigoMunicipio?: string; cant: number; valor: number; frecuenciaMeses?: number; frecAnios: number; factorExamen?: number }
export const identidadExamen = (r: ExamRowMin): string => `${norm(r.codExamen || r.tipo)}|${norm(r.nitProveedor)}|${norm(r.codigoMunicipio)}`;
export const configuracionExamen = (r: ExamRowMin): string => `${r.cant}|${r.valor}|${r.frecuenciaMeses ?? r.frecAnios}|${r.factorExamen ?? ''}`;

export interface VacunaRowMin { codigo?: string; tipo: string; tipoTarifa?: string; cant: number; valor: number; frecAnios: number; dosisPorTrabajador?: number }
export const identidadVacuna = (r: VacunaRowMin): string => `${norm(r.codigo || r.tipo)}|${norm(r.tipoTarifa)}`;
export const configuracionVacuna = (r: VacunaRowMin): string => `${r.cant}|${r.valor}|${r.frecAnios}|${r.dosisPorTrabajador ?? ''}`;

// Cursos — la identidad incluye proveedor/ciudad/valores (misma doctrina
// ya usada para corregir keys duplicadas del selector de catálogo, ver
// "CORREGIR KEYS DUPLICADAS EN SELECCIONAR CURSOS"): dos ofertas del
// mismo curso con proveedor/ciudad/precio distintos son elementos
// LEGÍTIMAMENTE distintos, nunca se consolidan solo por compartir código.
export interface CursoRowMin { codigoGrupo?: string; codigo?: string; nitProveedor?: string; nombreProveedor?: string; codigoMunicipio?: string; ciudad?: string; valorPrimeraVez?: number | null; valorReentrenamiento?: number | null; cant: number; frecAnios: number; alcance?: string; tipoValorSeleccionado?: string }
export const identidadCurso = (r: CursoRowMin): string => [
  r.codigoGrupo, r.codigo, r.nitProveedor, r.nombreProveedor, r.codigoMunicipio, r.ciudad, r.valorPrimeraVez, r.valorReentrenamiento,
].map(norm).join('|');
export const configuracionCurso = (r: CursoRowMin): string => `${r.cant}|${r.frecAnios}|${norm(r.alcance)}|${norm(r.tipoValorSeleccionado)}`;
