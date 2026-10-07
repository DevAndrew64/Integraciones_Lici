/**
 * Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — funciones puras del
 * módulo. Sin React, sin `fetch` — reutilizable en page.tsx y en pruebas.
 *
 * Reemplaza el diseño anterior (un segundo arreglo independiente de
 * `ServicioNoContinuo[]`, ver `page.tsx` histórico) por una CONSOLIDACIÓN:
 * Valor Agregado nunca recalcula ni copia las fórmulas de Mano de Obra/
 * Insumos/Maquinaria/Servicios No Continuos — cada recurso ORIGEN se marca
 * `esValorAgregado:true` con una `frecuenciaValorAgregado` obligatoria, y
 * su valor mensual YA CALCULADO por su propio módulo se traslada del
 * subtotal normal de ese módulo al subtotal de Valor Agregado (nunca suma
 * en ambos lugares — ver `particionarPorValorAgregado`). El único tipo
 * que SÍ se crea directamente aquí es Reinversión.
 *
 * Ajuste "REINVERSIÓN POR PORCENTAJE — BASE DE CÁLCULO CONFIRMADA"
 * (requerimiento de auditoría) — la base es el VALOR TOTAL DE OFERTA de
 * la pestaña Tarifa Regulada (`calcularTotalValorOfertaReguladaProceso`,
 * tarifa-regulada-vigicolba.ts): `montoReinversion = totalTarifaRegulada
 * × (porcentaje/100)`. `calcularValorMensualReinversion` recibe ese total
 * como parámetro (nunca lo recalcula ni lo importa — el caller, siempre
 * page.tsx, es quien ya lo tiene memoizado); si el caller no lo pasa
 * (p. ej. procesos que no son Vigicolba, sin pestaña Tarifa Regulada) el
 * default es `0`, nunca `NaN`. Reinversión por VALOR sigue siendo 100%
 * manual — nunca deriva del total de Tarifa Regulada.
 *
 * Ajuste "PERIODICIDAD AFECTA EL VALOR MENSUAL DE VALOR AGREGADO" — tabla
 * oficial de Grupo Colba (confirmada explícitamente, sin reinterpretación):
 * `frecuenciaValorAgregado`/`frecuenciaReinversion` pasan a ser códigos
 * 1-15 (antes: número de días 15|30|60|90|120|180|360, esquema retirado).
 * Auditoría contra los 11 registros reales de `CostoEstructura` en
 * producción confirmó CERO uso histórico del esquema de días — no hace
 * falta remapeo ni versión de esquema; ver `resolverFactorPeriodicidadValorAgregado`.
 * El valor BASE de cada recurso (el que ya calcula su propio módulo) NUNCA
 * se modifica — solo el valor que se traslada al subtotal de Valor
 * Agregado se divide por el factor de esta tabla.
 */

/** Código oficial de periodicidad (tabla Grupo Colba) — 1-15, nunca días.
 * Ver `resolverFactorPeriodicidadValorAgregado` para el divisor exacto de
 * cada código. */
export type FrecuenciaValorAgregado = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

export const FRECUENCIAS_VALOR_AGREGADO: { value: FrecuenciaValorAgregado; label: string }[] = [
  { value: 1, label: 'Mensual' },
  { value: 2, label: 'Bimestral' },
  { value: 3, label: 'Trimestral' },
  { value: 4, label: 'Cuatrimestral' },
  { value: 5, label: 'Cada 5 meses' },
  { value: 6, label: 'Semestral' },
  { value: 7, label: 'Cada 7 meses' },
  { value: 8, label: 'Cada 8 meses' },
  { value: 9, label: 'Cada 9 meses' },
  { value: 10, label: 'Cada 10 meses' },
  { value: 11, label: 'Cada 11 meses' },
  { value: 12, label: 'Anual' },
  { value: 13, label: 'Quincenal' },
  { value: 14, label: 'Semanal' },
  { value: 15, label: 'A solicitud' },
];

export function etiquetaFrecuenciaValorAgregado(f: FrecuenciaValorAgregado | undefined | null): string {
  if (f == null) return '—';
  return FRECUENCIAS_VALOR_AGREGADO.find(x => x.value === f)?.label ?? String(f);
}

/** Divisor oficial exacto por código — tabla Grupo Colba, sin aproximar
 * (13 y 14 son literalmente 0.5 y 0.433, nunca redondeados). */
const DIVISOR_PERIODICIDAD_VALOR_AGREGADO: Record<FrecuenciaValorAgregado, number> = {
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: 11, 12: 12, 13: 0.5, 14: 0.433, 15: 1,
};

/**
 * Único punto central de la fórmula `valorMensual = valorBase / divisor`
 * — nunca duplicar esta tabla en otro módulo. Fallback SIEMPRE divisor 1
 * (MENSUAL): tanto para `undefined`/`null` (registro sin frecuencia
 * seleccionada) como para cualquier valor numérico fuera de 1-15 (nunca se
 * intenta reinterpretar un valor no reconocido — ver docblock del
 * archivo, "no remapeo histórico").
 */
export function resolverFactorPeriodicidadValorAgregado(f: FrecuenciaValorAgregado | number | undefined | null): number {
  if (f == null) return 1;
  return (DIVISOR_PERIODICIDAD_VALOR_AGREGADO as Record<number, number>)[f] ?? 1;
}

/** Campo común que cualquier recurso ORIGEN (línea de MO, fila de Insumo,
 * fila de Maquinaria, `ServicioNoContinuo`) agrega para participar de
 * Valor Agregado — histórico sin este campo ⇒ `esValorAgregado:false`
 * (nunca se migra destructivamente; la ausencia del campo YA significa
 * "no es VA", ver `esRecursoValorAgregado`). */
export interface RecursoConValorAgregado {
  esValorAgregado?: boolean;
  frecuenciaValorAgregado?: FrecuenciaValorAgregado;
}

/** `true` únicamente cuando el flag está explícitamente en `true` —
 * histórico/ausente siempre `false`, nunca se infiere de otra cosa. */
export function esRecursoValorAgregado(r: RecursoConValorAgregado | null | undefined): boolean {
  return r?.esValorAgregado === true;
}

/** Validación única para los 4 tipos de recurso ORIGEN — VA=true exige
 * frecuencia; VA=false/ausente nunca la exige (aunque venga persistida de
 * un cambio anterior, no se valida porque ya no participa). */
export function validarFrecuenciaValorAgregado(r: RecursoConValorAgregado): string | null {
  if (r.esValorAgregado && r.frecuenciaValorAgregado == null) {
    return 'Selecciona la frecuencia del Valor Agregado.';
  }
  return null;
}

/**
 * Partición — regla crítica de "no doble conteo": separa un arreglo de
 * recursos en `normales` (suman en el subtotal ORIGINAL del módulo) y
 * `valorAgregado` (suman en el subtotal de Valor Agregado) — un mismo
 * recurso NUNCA cae en ambos grupos. No recalcula ningún valor — solo
 * filtra sobre el arreglo ya calculado por el módulo dueño.
 */
export function particionarPorValorAgregado<T extends RecursoConValorAgregado>(
  filas: readonly T[],
): { normales: T[]; valorAgregado: T[] } {
  const normales: T[] = [];
  const valorAgregado: T[] = [];
  for (const f of filas) {
    (esRecursoValorAgregado(f) ? valorAgregado : normales).push(f);
  }
  return { normales, valorAgregado };
}

/** Entidad Reinversión — único tipo administrado DIRECTAMENTE en la
 * pestaña Valor Agregado (crear/editar/eliminar); los otros 4 tipos son
 * siempre derivados de su módulo de origen (nunca editables aquí). */
export interface ReinversionValorAgregado {
  id: number;
  descripcion?: string;
  tipoReinversion: 'VALOR' | 'PORCENTAJE';
  /** Obligatorio cuando `tipoReinversion==='VALOR'`. */
  valorMensual?: number;
  /** Obligatorio cuando `tipoReinversion==='PORCENTAJE'` — se persiste
   * tal cual; el monto mensual se DERIVA en `calcularValorMensualReinversion`
   * (porcentaje × total de Tarifa Regulada), nunca se persiste ya calculado. */
  porcentaje?: number;
  /** Obligatoria para AMBOS tipos (a diferencia de valorMensual/porcentaje,
   * que son mutuamente excluyentes) — mismo catálogo de frecuencias que
   * los 4 tipos derivados. Divide el resultado de
   * `calcularValorMensualReinversion` (ver `resolverFactorPeriodicidadValorAgregado`),
   * igual para 'VALOR' y 'PORCENTAJE'. */
  frecuenciaReinversion?: FrecuenciaValorAgregado;
}

export function crearReinversionVacia(id: number): ReinversionValorAgregado {
  return { id, descripcion: '', tipoReinversion: 'VALOR', valorMensual: undefined, porcentaje: undefined, frecuenciaReinversion: undefined };
}

/** Validación — "no exigir ambos" para valor/porcentaje (exactamente el
 * campo correspondiente al `tipoReinversion` elegido), MÁS frecuencia
 * obligatoria siempre, para ambos tipos. */
export function validarReinversion(r: ReinversionValorAgregado): string | null {
  if (r.tipoReinversion === 'VALOR') {
    if (r.valorMensual == null || !(r.valorMensual > 0)) return 'El valor de reinversión mensual es obligatorio.';
  } else {
    if (r.porcentaje == null || !(r.porcentaje > 0)) return 'El porcentaje de reinversión es obligatorio.';
  }
  if (r.frecuenciaReinversion == null) return 'Selecciona la frecuencia de reinversión.';
  return null;
}

/** Valor mensual CUANTIFICABLE de una reinversión.
 * - `VALOR` — el monto ingresado manualmente, tal cual (nunca derivado
 *   de Tarifa Regulada ni de ninguna otra fuente).
 * - `PORCENTAJE` — `totalTarifaRegulada × (porcentaje/100)` (base
 *   confirmada: VALOR TOTAL DE OFERTA de la pestaña Tarifa Regulada, ver
 *   docblock del archivo). `totalTarifaRegulada` es SIEMPRE el total
 *   general del proceso (nunca por posición — evita duplicar el
 *   porcentaje). Sin `totalTarifaRegulada` (default `0`, p. ej. procesos
 *   sin pestaña Tarifa Regulada) o sin `porcentaje`, el resultado es `0`.
 * Nunca lanza ni deja `NaN`. */
export function calcularValorMensualReinversion(r: ReinversionValorAgregado, totalTarifaRegulada = 0): number {
  if (r.tipoReinversion === 'VALOR') return r.valorMensual ?? 0;
  return totalTarifaRegulada * ((r.porcentaje ?? 0) / 100);
}

export function calcularTotalReinversiones(reinversiones: readonly ReinversionValorAgregado[], totalTarifaRegulada = 0): number {
  return reinversiones.reduce((s, r) => s + calcularValorMensualReinversion(r, totalTarifaRegulada), 0);
}

/** Tipo consolidado — una fila por recurso VA (derivada, nunca editable
 * aquí salvo Reinversión) para la tabla de la pestaña Valor Agregado. */
// Ajuste "EPP EN VALOR AGREGADO" — 'EPP' es un 6to tipo derivado, mismo
// patrón que INSUMOS/MAQUINARIA/SNC: fuente = `dotGroups` global
// (`tipo==='epp'`), NUNCA el `dotacionEpp` de un ServicioNoContinuo (ese
// EPP entra a Valor Agregado únicamente vía 'SNC', para no contarlo dos
// veces — ver page.tsx, filasValorAgregadoEpp).
export type TipoFilaValorAgregado = 'REINVERSION' | 'MANO_DE_OBRA' | 'INSUMOS' | 'MAQUINARIA' | 'SNC' | 'EPP';

export interface FilaConsolidadaValorAgregado {
  tipo: TipoFilaValorAgregado;
  /** Clave única para render — nunca se reutiliza como id de escritura
   * (las filas derivadas no son editables desde aquí). */
  claveFila: string;
  descripcion: string;
  /** Valor YA mensualizado (valorBase / divisor de periodicidad) — nunca
   * el valor base sin dividir. Ver `resolverFactorPeriodicidadValorAgregado`. */
  valorMensual: number;
  /** Reinversión SÍ tiene frecuencia (`frecuenciaReinversion`, obligatoria
   * para ambos `tipoReinversion`) — antes no se propagaba a esta fila
   * consolidada (bug corregido); ahora sí. */
  frecuencia?: FrecuenciaValorAgregado;
  origen: string;
}

export function calcularTotalValorAgregado(filas: readonly FilaConsolidadaValorAgregado[]): number {
  return filas.reduce((s, f) => s + f.valorMensual, 0);
}
