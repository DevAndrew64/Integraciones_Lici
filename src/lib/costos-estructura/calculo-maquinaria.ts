/**
 * Ajuste "REDISEÑAR MAQUINARIA Y EQUIPOS" (histórico) + "AJUSTAR LA LÓGICA
 * Y PRESENTACIÓN DE MAQUINARIA Y EQUIPOS SEGÚN LAS FÓRMULAS REALES DEL
 * EXCEL" (vigente) — funciones puras del módulo. Sin React, sin `fetch` —
 * reutilizable en page.tsx y en pruebas.
 *
 * Fórmulas canónicas confirmadas contra el Excel real de la estructura de
 * costos (ejemplos de control: brilladora, aspiradora):
 *  - valorConIva = incluyeIva ? valorUnitario : valorUnitario×1.19
 *  - valorMesRequerido = valorConIva×cantidadRequerida/mesesDepreciacion
 *    (informativo, sobre TODA la cantidad requerida — nunca se suma al
 *    total final).
 *  - cantidadComprar = max(cantidadRequerida-cantidadDisponible, 0)
 *  - valorMesComprar = valorConIva×cantidadComprar/mesesDepreciacion
 *    (esto es lo que el Excel llama "Vr Total", pero es en realidad el
 *    costo MENSUAL por depreciación de lo que falta comprar).
 *  - valorMesMantenimiento = valorMantenimientoMensualUnitario×
 *    cantidadRequerida (el mantenimiento se paga sobre TODA la cantidad
 *    que opera en el servicio, disponible o no — nunca sobre
 *    cantidadComprar).
 *  - totalMensualMaquinariaEquipos = Σ valorMesComprar + Σ
 *    valorMesMantenimiento (Vr mes requerido es SOLO informativo).
 */

import type { FrecuenciaValorAgregado } from './valor-agregado';

export interface EntradaCostoMensualMaquinaria {
  cantidad: number;
  valorMensual: number;
}

/** Fórmula del modelo ANTERIOR (cantidad×valorMensual) — conservada
 * únicamente para migrar filas persistidas antes de este ajuste; el
 * modelo nuevo ya no la usa para calcular filas nuevas. */
export function calcularCostoMensualMaquinariaEquipo(entrada: EntradaCostoMensualMaquinaria): number {
  return entrada.cantidad * entrada.valorMensual;
}

export const PORCENTAJE_IVA_MAQUINARIA_EQUIPO = 1.19;

/** valorConIva = valorUnitario tal cual si ya incluye IVA; si no, se le
 * aplica el IVA una sola vez (nunca doble IVA cuando `incluyeIva` es
 * true). */
export function calcularValorConIvaMaquinaria(valorUnitario: number, incluyeIva: boolean): number {
  return incluyeIva ? valorUnitario : valorUnitario * PORCENTAJE_IVA_MAQUINARIA_EQUIPO;
}

/** Ajuste "AGREGAR EL CAMPO VISIBLE 'IVA CALCULADO'" — desglose puramente
 * de PRESENTACIÓN (nunca altera valorConIva/valorMesComprar): valor ANTES
 * de IVA, siempre en la misma base que `valorUnitario` digitado.
 *  - incluyeIva=false → valorUnitario YA es el valor antes de IVA.
 *  - incluyeIva=true → valorUnitario ya es el total con IVA; se separa
 *    dividiendo por 1.19 (nunca se vuelve a multiplicar). */
export function calcularValorAntesIvaMaquinaria(valorUnitario: number, incluyeIva: boolean): number {
  return incluyeIva ? valorUnitario / PORCENTAJE_IVA_MAQUINARIA_EQUIPO : valorUnitario;
}

/** IVA calculado — la diferencia entre el valor final con IVA y el valor
 * antes de IVA; nunca un componente adicional del subtotal (valorConIva ya
 * lo contiene). */
export function calcularIvaCalculadoMaquinaria(valorConIva: number, valorAntesIva: number): number {
  return valorConIva - valorAntesIva;
}

/** Vr mes requerido — valor mensual de TODA la cantidad requerida (no del
 * valor unitario ni de la cantidad a comprar). Puramente informativo. */
export function calcularValorMesRequeridoMaquinaria(valorConIva: number, cantidadRequerida: number, mesesDepreciacion: number): number {
  return mesesDepreciacion > 0 ? (valorConIva * cantidadRequerida) / mesesDepreciacion : 0;
}

/** Cantidad a comprar — nunca negativa. */
export function calcularCantidadComprarMaquinaria(cantidadRequerida: number, cantidadDisponible: number): number {
  return Math.max(cantidadRequerida - cantidadDisponible, 0);
}

/** Vr mes a comprar — el Excel lo rotula "Vr Total", pero es el costo
 * MENSUAL de depreciación de lo que falta comprar (nunca de toda la
 * cantidad requerida). */
export function calcularValorMesComprarMaquinaria(valorConIva: number, cantidadComprar: number, mesesDepreciacion: number): number {
  return mesesDepreciacion > 0 ? (valorConIva * cantidadComprar) / mesesDepreciacion : 0;
}

/** Mantenimiento mensual total — sobre la cantidad REQUERIDA (disponible
 * o por comprar), nunca sobre cantidadComprar: los equipos ya disponibles
 * también requieren mantenimiento. `null` (sin tarifa encontrada/digitada
 * todavía) se trata como cero SOLO para este cálculo temporal — la fila
 * conserva `null` para que la interfaz nunca lo confunda con una tarifa
 * confirmada en cero. */
export function calcularValorMesMantenimientoMaquinaria(valorMantenimientoMensualUnitario: number | null, cantidadRequerida: number): number {
  return (valorMantenimientoMensualUnitario ?? 0) * cantidadRequerida;
}

export interface EntradaCamposMaquinariaEquipo {
  cantidadRequerida: number;
  mesesDepreciacion: number;
  valorUnitario: number;
  incluyeIva: boolean;
  cantidadDisponible: number;
  valorMantenimientoMensualUnitario: number | null;
}

export interface CamposCalculadosMaquinariaEquipo {
  valorConIva: number;
  valorMesRequerido: number;
  cantidadComprar: number;
  valorMesComprar: number;
  valorMesMantenimiento: number;
}

/** Único punto que deriva TODOS los campos calculados de una fila a
 * partir de sus campos editables — usado tanto al editar en el borrador
 * como al guardar el formulario manual, para que ambos caminos nunca
 * diverjan. */
export function calcularCamposMaquinariaEquipo(entrada: EntradaCamposMaquinariaEquipo): CamposCalculadosMaquinariaEquipo {
  const valorConIva = calcularValorConIvaMaquinaria(entrada.valorUnitario, entrada.incluyeIva);
  const valorMesRequerido = calcularValorMesRequeridoMaquinaria(valorConIva, entrada.cantidadRequerida, entrada.mesesDepreciacion);
  const cantidadComprar = calcularCantidadComprarMaquinaria(entrada.cantidadRequerida, entrada.cantidadDisponible);
  const valorMesComprar = calcularValorMesComprarMaquinaria(valorConIva, cantidadComprar, entrada.mesesDepreciacion);
  const valorMesMantenimiento = calcularValorMesMantenimientoMaquinaria(entrada.valorMantenimientoMensualUnitario, entrada.cantidadRequerida);
  return { valorConIva, valorMesRequerido, cantidadComprar, valorMesComprar, valorMesMantenimiento };
}

/** Subtotal de adquisición — suma exacta de valorMesComprar, redondeada
 * solo al presentar (nunca redondeando cada fila antes de sumar). */
export function calcularSubtotalAdquisicionMaquinaria(filas: { valorMesComprar: number }[]): number {
  return filas.reduce((s, f) => s + f.valorMesComprar, 0);
}

/** Subtotal de mantenimiento — suma exacta de valorMesMantenimiento. */
export function calcularSubtotalMantenimientoMaquinaria(filas: { valorMesMantenimiento: number }[]): number {
  return filas.reduce((s, f) => s + f.valorMesMantenimiento, 0);
}

/** Total mensual de Maquinaria y Equipos — adquisición + mantenimiento;
 * `valorMesRequerido` es SOLO informativo y nunca se suma aquí. */
export function calcularTotalMensualMaquinariaEquipos(filas: { valorMesComprar: number; valorMesMantenimiento: number }[]): number {
  return calcularSubtotalAdquisicionMaquinaria(filas) + calcularSubtotalMantenimientoMaquinaria(filas);
}

// Ajuste "NUEVA API DE MAQUINARIA Y EQUIPOS — DISPONIBILIDAD Y
// MANTENIMIENTO COMO FUENTE DE VERDAD" — 'API_EQUIPOS' identifica una
// tarifa de mantenimiento que vino directo de `equipos/obtener`
// (`valor_mantenimiento`), nunca del Excel — se distingue explícitamente
// de 'CATALOGO_MTTO_2025'/'PLANTILLA_HISTORICA' (fuentes Excel, todavía
// usadas por "Agregar equipo manual" hasta que se confirme su retiro).
export type OrigenMantenimientoMaquinaria = 'API_EQUIPOS' | 'CATALOGO_MTTO_2025' | 'PLANTILLA_HISTORICA' | 'MANUAL' | 'SIN_COINCIDENCIA';

export interface MaquinariaEquipoRowHistorico {
  id?: number; origen?: 'CATALOGO' | 'MANUAL';
  codigo?: string; descripcion?: string; categoria?: string; marca?: string;
  precioReferencia?: string; fuentePrecio?: string;
  // Ajuste "CORREGIR CÓDIGO..." §1 — códigos reales del catálogo en
  // cascada (grupo+subtipo), conservados como STRING para nunca perder
  // ceros iniciales ("004","096").
  codigoGrupo?: string; codigoSubtipo?: string; codigoCatalogoCompuesto?: string;
  // Modelo nuevo (si ya viene persistido así, se respeta tal cual).
  cantidadRequerida?: number; mesesDepreciacion?: number;
  valorUnitario?: number; incluyeIva?: boolean; valorConIva?: number;
  valorMesRequerido?: number;
  cantidadDisponible?: number; cantidadComprar?: number;
  valorMesComprar?: number;
  // Ajuste "CORREGIR CÓDIGO..." §5/§7 — `valorMantenimientoMensualUnitario`
  // es `number|null`: `null` = sin tarifa encontrada/digitada todavía,
  // NUNCA confundido con una tarifa confirmada en cero.
  valorMantenimientoMensualUnitario?: number | null; valorMesMantenimiento?: number;
  valorMantenimientoSugerido?: number; origenMantenimiento?: OrigenMantenimientoMaquinaria;
  referenciaMantenimientoId?: string;
  // Modelo ANTERIOR (histórico, sin depreciación/IVA/mantenimiento).
  cantidad?: number; valorMensual?: number; totalMensual?: number;
  vlrDiaReferencia?: number;
  fechaValor?: string | null;
  usuarioRegistro?: string; fechaRegistro?: string;
  // Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — traslada
  // `valorMesComprar+valorMesMantenimiento` del subtotal de Maquinaria al
  // subtotal de Valor Agregado, nunca ambos. Histórico sin este campo ⇒
  // `false`. Aplica igual a filas de catálogo o manuales.
  esValorAgregado?: boolean;
  frecuenciaValorAgregado?: FrecuenciaValorAgregado;
}

export interface MaquinariaEquipoRowNormalizado {
  id: number; origen: 'CATALOGO' | 'MANUAL';
  codigo?: string; descripcion: string; categoria?: string; marca?: string;
  precioReferencia?: string; fuentePrecio?: string;
  codigoGrupo?: string; codigoSubtipo?: string; codigoCatalogoCompuesto?: string;
  cantidadRequerida: number; mesesDepreciacion: number;
  valorUnitario: number; incluyeIva: boolean; valorConIva: number;
  valorMesRequerido: number;
  cantidadDisponible: number; cantidadComprar: number;
  valorMesComprar: number;
  valorMantenimientoMensualUnitario: number | null; valorMesMantenimiento: number;
  valorMantenimientoSugerido?: number; origenMantenimiento: OrigenMantenimientoMaquinaria;
  referenciaMantenimientoId?: string;
  vlrDiaReferencia?: number;
  fechaValor?: string | null;
  usuarioRegistro?: string; fechaRegistro?: string;
  esValorAgregado?: boolean;
  frecuenciaValorAgregado?: FrecuenciaValorAgregado;
}

/**
 * Ajuste "AJUSTAR LA LÓGICA Y PRESENTACIÓN DE MAQUINARIA Y EQUIPOS SEGÚN
 * LAS FÓRMULAS REALES DEL EXCEL" — migración defensiva del modelo
 * anterior (cantidad×valorMensual=totalMensual) al nuevo modelo
 * (depreciación, IVA, cantidad a comprar, mantenimiento):
 *  - Fila YA en el modelo nuevo (tiene `cantidadRequerida`): se conserva
 *    tal cual, completando SOLO los campos calculados que falten.
 *  - Fila del modelo ANTERIOR: se traduce preservando EXACTAMENTE el
 *    mismo total mensual que ya tenía — `mesesDepreciacion=1`,
 *    `cantidadDisponible=0`, `valorConIva=totalMensualHistórico/cantidad`
 *    — nunca se reinterpreta un valor histórico bajo la fórmula nueva de
 *    IVA (evita cambiar silenciosamente un costo ya persistido).
 */
export function normalizarMaquinariaHistorico(r: MaquinariaEquipoRowHistorico): MaquinariaEquipoRowNormalizado {
  const esModeloNuevo = typeof r.cantidadRequerida === 'number';
  if (esModeloNuevo) {
    const cantidadRequerida = r.cantidadRequerida! > 0 ? r.cantidadRequerida! : 1;
    const mesesDepreciacion = typeof r.mesesDepreciacion === 'number' && r.mesesDepreciacion > 0 ? r.mesesDepreciacion : 1;
    const valorUnitario = typeof r.valorUnitario === 'number' ? r.valorUnitario : 0;
    const incluyeIva = r.incluyeIva ?? false;
    const cantidadDisponible = typeof r.cantidadDisponible === 'number' && r.cantidadDisponible >= 0 ? r.cantidadDisponible : 0;
    const valorMantenimientoMensualUnitario = typeof r.valorMantenimientoMensualUnitario === 'number' ? r.valorMantenimientoMensualUnitario : null;
    const origenMantenimiento = r.origenMantenimiento ?? (valorMantenimientoMensualUnitario != null ? 'MANUAL' : 'SIN_COINCIDENCIA');
    const calculados = calcularCamposMaquinariaEquipo({ cantidadRequerida, mesesDepreciacion, valorUnitario, incluyeIva, cantidadDisponible, valorMantenimientoMensualUnitario });
    return {
      ...r,
      id: r.id ?? 0, origen: r.origen ?? 'MANUAL', descripcion: r.descripcion ?? '—',
      cantidadRequerida, mesesDepreciacion, valorUnitario, incluyeIva, cantidadDisponible,
      valorMantenimientoMensualUnitario, origenMantenimiento,
      valorConIva: typeof r.valorConIva === 'number' ? r.valorConIva : calculados.valorConIva,
      valorMesRequerido: typeof r.valorMesRequerido === 'number' ? r.valorMesRequerido : calculados.valorMesRequerido,
      cantidadComprar: typeof r.cantidadComprar === 'number' ? r.cantidadComprar : calculados.cantidadComprar,
      valorMesComprar: typeof r.valorMesComprar === 'number' ? r.valorMesComprar : calculados.valorMesComprar,
      valorMesMantenimiento: typeof r.valorMesMantenimiento === 'number' ? r.valorMesMantenimiento : calculados.valorMesMantenimiento,
    };
  }
  const cantidadRequerida = typeof r.cantidad === 'number' && r.cantidad > 0 ? r.cantidad : 1;
  const valorMensualHistorico = typeof r.valorMensual === 'number' ? r.valorMensual : 0;
  const totalMensualHistorico = typeof r.totalMensual === 'number' ? r.totalMensual : calcularCostoMensualMaquinariaEquipo({ cantidad: cantidadRequerida, valorMensual: valorMensualHistorico });
  const valorConIva = totalMensualHistorico / cantidadRequerida;
  return {
    ...r,
    id: r.id ?? 0, origen: r.origen ?? 'MANUAL', descripcion: r.descripcion ?? '—',
    cantidadRequerida, mesesDepreciacion: 1,
    valorUnitario: valorConIva, incluyeIva: true, valorConIva,
    valorMesRequerido: totalMensualHistorico,
    cantidadDisponible: 0, cantidadComprar: cantidadRequerida,
    valorMesComprar: totalMensualHistorico,
    valorMantenimientoMensualUnitario: null, valorMesMantenimiento: 0, origenMantenimiento: 'SIN_COINCIDENCIA',
  };
}
