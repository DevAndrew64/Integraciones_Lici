/**
 * Ajuste "GENERALIZAR LA PRESENTACIÓN UNITARIA DE MANO DE OBRA PARA TODAS
 * LAS POSICIONES" — separación explícita entre el detalle POR TRABAJADOR
 * (nunca cambia con la cantidad) y el costo AGREGADO del cargo (cantidad
 * × unitario). El motor (`resultado-financiero-mensual-linea.ts`) ya
 * calcula todos los conceptos por trabajador — este módulo NO recalcula
 * nada, solo empaqueta el total agregado a partir del unitario YA
 * calculado por el motor (nunca dividiendo el agregado para "reconstruir"
 * el unitario — eso solo es válido como comprobación diagnóstica).
 */

export interface CalculoLaboralUnitario {
  salarioBasico: number;
  bonoPrestacional: number;
  recargosHorasExtras: number;
  auxilioTransporte: number;
  subtotalSalarial: number;
  prestacionesSociales: number;
  seguridadSocial: number;
  aportesParafiscales: number;
  otrosCostos: number;
  bonosNoPrestacionales: number;
  costoMensualTotal: number;
}

export interface CalculoLaboralAgregado {
  cantidadTrabajadores: number;
  costoMensualUnitario: number;
  costoMensualTotalCargo: number;
}

/** costoMensualTotalCargo = costoMensualUnitario × cantidadTrabajadores —
 * SIEMPRE a partir del unitario canónico, nunca al revés. */
export function construirCalculoLaboralAgregado(costoMensualUnitario: number, cantidadTrabajadores: number): CalculoLaboralAgregado {
  return {
    cantidadTrabajadores,
    costoMensualUnitario,
    costoMensualTotalCargo: Math.round(costoMensualUnitario * cantidadTrabajadores),
  };
}
