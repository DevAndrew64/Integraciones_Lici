/**
 * Ajuste "TRAER EPP POR CÓDIGO DE GRUPO" — mismo patrón que Dotación
 * (`traerProductosPorGrupoDot`): el usuario escribe un código de grupo de EPP
 * (EP001…EP450) y se agregan TODOS los productos de ese grupo, cada uno con la
 * cantidad y frecuencia que el catálogo define para ESE grupo (ver
 * `catalogo-epp-cantidad-frecuencia.ts`). El código de grupo es una selección
 * completa y sin ambigüedad, por eso no hay que elegir producto por producto.
 *
 * Pura, sin React ni fetch — la usan la ruta `/api/epp-ext` y `page.tsx`.
 */
import { buscarCampo } from './catalogo-dotacion-filtro';
import { cantidadFrecuenciaInicialEpp } from './catalogo-epp-cantidad-frecuencia';
import type { DotItemRow } from './dotacion-epp-tipo';

/** Todos los grupos de EPP del catálogo real tienen la forma EP + dígitos (423 grupos medidos, EP001…EP450). */
const FORMATO_GRUPO_EPP = /^EP\d+$/;

export function normalizarCodigoGrupoEpp(v: unknown): string {
  return String(v ?? '').trim().toUpperCase();
}

export type ValidacionGrupoEpp = { ok: true; codigo: string } | { ok: false; mensaje: string };

export function validarCodigoGrupoEpp(v: unknown): ValidacionGrupoEpp {
  const codigo = normalizarCodigoGrupoEpp(v);
  if (!codigo) return { ok: false, mensaje: 'Escribe un código de grupo de EPP (por ejemplo EP001).' };
  if (!FORMATO_GRUPO_EPP.test(codigo)) {
    return { ok: false, mensaje: `"${codigo}" no es un código de grupo de EPP válido. Debe empezar por EP seguido de números (por ejemplo EP001).` };
  }
  return { ok: true, codigo };
}

/** Coincidencia EXACTA del código de grupo (sin distinguir mayúsculas ni espacios), nunca por subcadena. */
export function filtrarPorGrupoEpp<T extends Record<string, unknown>>(registros: readonly T[], codigoGrupo: string): T[] {
  const objetivo = normalizarCodigoGrupoEpp(codigoGrupo);
  return registros.filter(r => normalizarCodigoGrupoEpp(buscarCampo(r, 'codgrp')) === objetivo);
}

export type FilaEppDesdeGrupo = Omit<DotItemRow, 'id' | 'section' | 'origen'>;

export interface ResultadoFilasEppDesdeGrupo {
  filas: FilaEppDesdeGrupo[];
  /** Productos del grupo sin valor vigente (valor <= 0): no se agregan. */
  sinValor: number;
  /** Productos que la línea ya tenía (mismo código): no se duplican. */
  yaAgregados: number;
}

/**
 * Convierte los items devueltos por `/api/epp-ext` (con `resolverCantidadFrecuencia`)
 * en filas de EPP. Cantidad/frecuencia salen de `cantidadFrecuenciaInicialEpp`
 * (valor del catálogo bloqueado, o 1 editable si el catálogo trae 0).
 * `codigosExistentes` evita duplicar productos si el grupo se trae dos veces.
 */
export function filasEppDesdeGrupo(
  items: readonly Record<string, unknown>[],
  codigoGrupo: string,
  codigosExistentes: ReadonlySet<string>,
): ResultadoFilasEppDesdeGrupo {
  const filas: FilaEppDesdeGrupo[] = [];
  const vistos = new Set<string>();
  let sinValor = 0;
  let yaAgregados = 0;
  for (const r of items) {
    const vUnit = Number(buscarCampo(r, 'valor', 'precio', 'price', 'vlr', 'value') ?? 0) || 0;
    if (vUnit <= 0) { sinValor++; continue; }
    const codigo = String(buscarCampo(r, 'codigo', 'code', 'ref') ?? '');
    const clave = codigo.trim().toLowerCase();
    if (clave && (codigosExistentes.has(clave) || vistos.has(clave))) { yaAgregados++; continue; }
    if (clave) vistos.add(clave);
    const fUltCompra = buscarCampo(r, 'fecha_ultima_compra', 'fechaultimacompra', 'ultima_compra', 'fecha_compra');
    filas.push({
      codigo,
      desc: String(buscarCampo(r, 'nombre', 'descripcion', 'description', 'name', 'des_item') ?? '—'),
      medida: String(buscarCampo(r, 'undmed', 'medida', 'unidad', 'unit', 'und') ?? 'UND'),
      ...cantidadFrecuenciaInicialEpp(r),
      vUnit,
      codigoGrupo: normalizarCodigoGrupoEpp(codigoGrupo),
      fechaUltimaCompra: fUltCompra !== undefined ? String(fUltCompra) : undefined,
    });
  }
  return { filas, sinValor, yaAgregados };
}
