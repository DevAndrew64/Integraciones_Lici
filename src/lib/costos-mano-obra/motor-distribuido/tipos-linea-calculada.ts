/**
 * Tipos neutrales del resultado "línea calculada mensual" — combina el
 * estado del adaptador de cargo con el resultado financiero ya ensamblado,
 * forma que consume page.tsx para una línea de Mano de Obra o Turnantes,
 * sin importar qué motor la produjo. Sin funciones, sin dependencia de
 * ningún motor concreto.
 */
import type { ResultadoAdaptadorCargo } from './tipos-adaptador-cargo';
import type { ResultadoFinancieroMensualLinea } from './resultado-financiero-mensual-linea';

export interface LineaCalculadaMensual {
  /** Estado/mensaje comercial del adaptador — nunca detalles técnicos. */
  resultadoAdaptador: ResultadoAdaptadorCargo;
  /** null cuando la línea está bloqueada (estadoUI !== 'TARIFA_CALCULADA') —
   * nunca un resultado con ceros que pueda confundirse con un cálculo real. */
  resultadoFinanciero: ResultadoFinancieroMensualLinea | null;
}

export interface OpcionesLineaCalculadaMensual {
  otrosCostosMensualesPorTrabajador?: number;
  /** Cierre "LÍMITE DEL 40% DE PAGOS NO SALARIALES PARA IBC" — total
   * mensual de los 4 bonos no prestacionales de ESTA línea, por
   * trabajador (nunca multiplicado por cantidad aquí). Se usa
   * EXCLUSIVAMENTE para ajustar la base de salud/pensión cuando excede
   * el 40% de la remuneración total — nunca se suma a
   * tarifaMensualPorTrabajador/tarifaMensualLinea (esos 4 bonos ya se
   * suman aparte en page.tsx, sumarlos aquí también los duplicaría). */
  pagosNoSalarialesMensualesPorTrabajador?: number;
  /** Ajuste "CORRECCIÓN DE BASES — TOTAL_SEMANAL" — ver
   * `EntradaResultadoFinancieroMensualLinea.baseMinimaSeguridadSocialMensual`
   * (resultado-financiero-mensual-linea.ts). Si se omite, comportamiento
   * actual sin cambios. */
  baseMinimaSeguridadSocialMensual?: number;
}