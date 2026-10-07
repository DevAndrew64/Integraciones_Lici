/**
 * Ajuste "REDISEÑAR LA PESTAÑA INSUMOS" — funciones puras del módulo de
 * Insumos. Sin React, sin `fetch` — reutilizable en page.tsx y en pruebas.
 *
 * Ajuste "IVA DIFERENCIAL/EXENTO POR INSUMO" — el diagnóstico anterior
 * ("la fuente no trae IVA") quedó OBSOLETO: confirmado en vivo (llamada
 * real a `grupocolba.com/service/public/api/insumos`, `POST {empresa,uen}`,
 * 1181 filas de muestra) que el proveedor SÍ entrega un campo `iva`
 * (number, columna real `e.iva` de `al_elementos` — nunca null en la
 * muestra observada) con valores reales `0`/`5`/`19` — nunca un único
 * porcentaje general. La fuente NO entrega ningún campo de clasificación
 * fiscal adicional (`exento`/`excluido`/`tipo_iva`) — solo el número; ver
 * `clasificarIvaInsumo` para la etiqueta de PRESENTACIÓN derivada
 * únicamente del porcentaje (nunca una distinción fiscal certificada
 * Exento-vs-Excluido, que la fuente no soporta).
 *
 * `IVA_INSUMOS_PORCENTAJE` (19%) sigue existiendo EXCLUSIVAMENTE como
 * fallback histórico: para insumos manuales (valor sugerido inicial,
 * editable) y para registros históricos que no traen ni `ivaPorcentaje`
 * ni `valorUnitarioConIva` ya persistidos (`normalizarInsumoHistorico`) —
 * nunca se aplica ya como IVA fijo a un insumo traído del catálogo
 * externo (ver `resolverIvaCatalogoInsumo`, usado en `page.tsx` al agregar
 * desde el catálogo).
 *
 * Significado de "Frecuencia" en esta etapa (§10 del ajuste): periodicidad
 * en MESES ("cada N meses"), nunca "veces por mes" — `frecuenciaMeses`.
 */

import type { FrecuenciaValorAgregado } from './valor-agregado';

export const IVA_INSUMOS_PORCENTAJE = 19;

/**
 * Porcentaje de IVA REAL de una fila cruda del catálogo externo
 * (`api/insumos-ext`, campo `iva`) — nunca se ignora a favor de un
 * porcentaje fijo. Solo cae al fallback histórico (`IVA_INSUMOS_PORCENTAJE`)
 * cuando el campo viene ausente/no numérico (fuente incompleta) — nunca
 * se inventa un valor distinto.
 */
export function resolverIvaCatalogoInsumo(ivaCrudo: unknown): number {
  if (ivaCrudo == null) return IVA_INSUMOS_PORCENTAJE;
  const n = Number(ivaCrudo);
  return Number.isFinite(n) && n >= 0 ? n : IVA_INSUMOS_PORCENTAJE;
}

export type ClasificacionIvaInsumo = 'GENERAL' | 'DIFERENCIAL' | 'EXENTO';

/**
 * Clasificación de PRESENTACIÓN derivada ÚNICAMENTE del porcentaje — la
 * fuente (Inventarios) no distingue Exento de Excluido (confirmado en
 * vivo: solo entrega el número `iva`, sin ningún campo de clasificación
 * fiscal) — "Exento" aquí es una etiqueta visual, NUNCA una distinción
 * fiscal certificada. 19% -> General (la tarifa general vigente); 0% ->
 * Exento (etiqueta de presentación, no fiscal); cualquier otro valor
 * (ej. 5%) -> Diferencial.
 */
export function clasificarIvaInsumo(porcentajeIva: number): ClasificacionIvaInsumo {
  if (porcentajeIva === 19) return 'GENERAL';
  if (porcentajeIva === 0) return 'EXENTO';
  return 'DIFERENCIAL';
}

export const ETIQUETA_CLASIFICACION_IVA_INSUMO: Record<ClasificacionIvaInsumo, string> = {
  GENERAL: 'General', DIFERENCIAL: 'Diferencial', EXENTO: 'Exento',
};

/** Redondeo monetario consistente con el resto del módulo (COP sin
 * decimales, mismo criterio que `cop()`/`fmtV()` en page.tsx). */
export function redondearMoneda(valor: number): number {
  return Math.round(valor);
}

/** valorUnitarioConIva = valorUnitarioSinIva × (1 + ivaPorcentaje/100),
 * redondeado — nunca se aplica dos veces (esta es la ÚNICA función que
 * calcula el valor con IVA de un insumo). */
export function calcularValorUnitarioConIva(valorUnitarioSinIva: number, ivaPorcentaje: number): number {
  return redondearMoneda(valorUnitarioSinIva * (1 + ivaPorcentaje / 100));
}

export interface EntradaValorMensualInsumo {
  cantidad: number;
  frecuenciaMeses: number;
  valorUnitarioConIva: number;
}

/** valorMensual = cantidad × valorUnitarioConIva / frecuenciaMeses —
 * frecuenciaMeses es periodicidad ("cada N meses"), nunca "veces por
 * mes" (§10/§11 del ajuste). frecuenciaMeses≤0 se trata como 1 (mensual)
 * para no dividir por cero ni producir un costo negativo/infinito. */
export function calcularValorMensualInsumo(entrada: EntradaValorMensualInsumo): number {
  const frecuencia = entrada.frecuenciaMeses > 0 ? entrada.frecuenciaMeses : 1;
  return entrada.cantidad * entrada.valorUnitarioConIva / frecuencia;
}

export interface InsumoRowHistorico {
  id?: number; origen?: 'CATALOGO' | 'MANUAL';
  codigo?: string; nombre?: string; unidad?: string; uen?: string;
  cantidad?: number; frecuenciaMeses?: number;
  valorUnitarioSinIva?: number; ivaPorcentaje?: number; valorUnitarioConIva?: number; valorMensual?: number;
  fechaValor?: string | null;
  sujetoKey?: unknown; lineaManoObraId?: number | null;
  usuarioRegistro?: string; fechaRegistro?: string; cargoCodigo?: string | null;
  // Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — ver docblock análogo
  // en `tipos-cargo.ts`/`valor-agregado.ts`: traslada `valorMensual` del
  // subtotal de Insumos al subtotal de Valor Agregado, nunca ambos.
  // Histórico sin este campo ⇒ `false`.
  esValorAgregado?: boolean;
  frecuenciaValorAgregado?: FrecuenciaValorAgregado;
}

/**
 * Ajuste "REDISEÑAR LA PESTAÑA INSUMOS" ETAPA 3 §10 — adaptación
 * defensiva de un registro histórico (aunque no exista ninguno conocido
 * hoy, §1 de la ETAPA 1 lo confirmó): completa campos ausentes SIN
 * alterar los que ya vienen persistidos.
 *
 *  - `cantidad`/`frecuenciaMeses` ausentes → 1.
 *  - `valorUnitarioConIva` ya presente → se conserva TAL CUAL, nunca se
 *    vuelve a multiplicar por el IVA (evita aplicar el IVA dos veces).
 *  - `valorUnitarioConIva` ausente → se calcula UNA vez con el
 *    `ivaPorcentaje` del registro si lo trae, o `IVA_INSUMOS_PORCENTAJE`
 *    (19%) si no — y ese es el único caso donde `ivaPorcentaje` se
 *    completa con el valor asumido (nunca se inventa un porcentaje
 *    cuando `valorUnitarioConIva` ya existía).
 *  - `valorMensual` ausente → se reconstruye con `calcularValorMensualInsumo`.
 *  - `origen` ausente → 'MANUAL' (mismo criterio que CursoRow histórico
 *    en este proyecto, que tampoco usa un valor 'HISTORICO' separado).
 */
export function normalizarInsumoHistorico(r: InsumoRowHistorico): Required<Pick<InsumoRowHistorico,
  'id' | 'origen' | 'codigo' | 'nombre' | 'cantidad' | 'frecuenciaMeses' | 'valorUnitarioSinIva' | 'valorUnitarioConIva' | 'valorMensual'
>> & InsumoRowHistorico {
  const cantidad = typeof r.cantidad === 'number' && r.cantidad > 0 ? r.cantidad : 1;
  const frecuenciaMeses = typeof r.frecuenciaMeses === 'number' && r.frecuenciaMeses > 0 ? r.frecuenciaMeses : 1;
  const valorUnitarioSinIva = typeof r.valorUnitarioSinIva === 'number' ? r.valorUnitarioSinIva : 0;
  const teniaValorConIva = typeof r.valorUnitarioConIva === 'number';
  const ivaPorcentaje = teniaValorConIva ? r.ivaPorcentaje : (r.ivaPorcentaje ?? IVA_INSUMOS_PORCENTAJE);
  const valorUnitarioConIva = teniaValorConIva
    ? (r.valorUnitarioConIva as number)
    : calcularValorUnitarioConIva(valorUnitarioSinIva, ivaPorcentaje ?? IVA_INSUMOS_PORCENTAJE);
  const valorMensual = typeof r.valorMensual === 'number' ? r.valorMensual : calcularValorMensualInsumo({ cantidad, frecuenciaMeses, valorUnitarioConIva });
  return {
    ...r,
    id: r.id ?? 0,
    origen: r.origen ?? 'MANUAL',
    codigo: r.codigo ?? '',
    nombre: r.nombre ?? '—',
    cantidad, frecuenciaMeses,
    valorUnitarioSinIva, ivaPorcentaje, valorUnitarioConIva, valorMensual,
  };
}
