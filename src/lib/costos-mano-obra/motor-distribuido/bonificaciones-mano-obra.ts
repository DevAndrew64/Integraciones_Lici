/**
 * Cinco tipos de bono confirmados (cierre "IMPLEMENTACIÓN — CINCO TIPOS
 * DE BONO CONFIRMADOS"): identidad/clasificación y agregación pura de los
 * CUATRO bonos NO prestacionales (Alimentación, Transporte, Productividad,
 * Ocasional) — el Bono Prestacional ya vive en el motor financiero
 * compartido (resultado-financiero-mensual-linea.ts, sin modificar) y NO
 * se toca ni se duplica aquí.
 *
 * Los 4 bonos no prestacionales son ADITIVOS puros: nunca entran al
 * salario básico, al subtotal salarial ni a ninguna base de prestaciones/
 * seguridad social — solo aumentan el costo mensual final de la línea.
 * Este módulo no importa nada del motor comercial (divisor/factores/
 * festivos) ni de Turnantes — es independiente y reutilizable por ambos.
 */

export interface DefinicionBono {
  id: string;
  nombre: string;
}

/** Bono Prestacional — referencia informativa (su cálculo real vive en el
 * motor financiero compartido, este módulo no lo recalcula). */
export const BONO_PRESTACIONAL: DefinicionBono = { id: 'BONO_PRESTACIONAL', nombre: 'Bono Prestacional' };

export type ClaveBonoNoPrestacional = 'alimentacion' | 'transporte' | 'productividad' | 'ocasional';

/** Los 4 bonos no prestacionales — IDs estables e inmutables, nombres
 * empresariales confirmados en FoxPro. `nombreVisible` aclara el Bono
 * Transporte frente al auxilio legal (§5 del cierre) sin cambiar su ID. */
export const BONOS_NO_PRESTACIONALES: Record<ClaveBonoNoPrestacional, DefinicionBono & { nombreVisible: string }> = {
  alimentacion: { id: 'BONO_ALIMENTACION', nombre: 'Bono Alimentación', nombreVisible: 'Bono Alimentación' },
  transporte: { id: 'BONO_TRANSPORTE', nombre: 'Bono Transporte', nombreVisible: 'Bono de transporte adicional' },
  productividad: { id: 'BONO_PRODUCTIVIDAD', nombre: 'Bono Productividad', nombreVisible: 'Bono Productividad' },
  ocasional: { id: 'BONO_OCASIONAL', nombre: 'Bono Ocasional', nombreVisible: 'Bono Ocasional' },
};

export interface ValoresBonosNoPrestacionales {
  alimentacion: number;
  transporte: number;
  productividad: number;
  ocasional: number;
}

export const VALORES_BONOS_NO_PRESTACIONALES_VACIO: ValoresBonosNoPrestacionales = {
  alimentacion: 0, transporte: 0, productividad: 0, ocasional: 0,
};

export interface ResultadoBonosNoPrestacionalesLinea {
  valores: ValoresBonosNoPrestacionales;
  totalPorTrabajador: number;
  cantidadTrabajadores: number;
  totalLinea: number;
}

/**
 * Único constructor autorizado del total de bonos no prestacionales de
 * UNA línea — suma los 4 conceptos por trabajador y multiplica por la
 * cantidad de trabajadores de esa línea UNA sola vez (§4/§13 del cierre).
 * Nunca se llama más de una vez por línea, nunca se vuelve a multiplicar
 * aguas arriba (agregación entre líneas es una suma simple de
 * `totalLinea`, ver `agregarBonosNoPrestacionales`).
 */
export function calcularBonosNoPrestacionalesLinea(
  valores: ValoresBonosNoPrestacionales,
  cantidadTrabajadores: number,
): ResultadoBonosNoPrestacionalesLinea {
  const totalPorTrabajador = valores.alimentacion + valores.transporte + valores.productividad + valores.ocasional;
  return {
    valores,
    totalPorTrabajador,
    cantidadTrabajadores,
    totalLinea: totalPorTrabajador * cantidadTrabajadores,
  };
}

/** Agregación entre líneas (cargo, o toda Mano de Obra) — suma directa de
 * `totalLinea`, ya multiplicado una sola vez por línea; nunca vuelve a
 * multiplicar por cantidad ni por número de posiciones. */
export function agregarBonosNoPrestacionales(resultados: ResultadoBonosNoPrestacionalesLinea[]): number {
  return resultados.reduce((acc, r) => acc + r.totalLinea, 0);
}

/** Detalle para el desplegable (§8) — una fila por concepto CON valor > 0
 * (las filas en 0 se ocultan salvo que el llamador decida mostrarlas
 * durante edición, decisión de UI, no de este módulo puro). */
export interface FilaDetalleBonoNoPrestacional {
  clave: ClaveBonoNoPrestacional;
  nombreVisible: string;
  valorPorTrabajador: number;
  cantidadTrabajadores: number;
  totalLinea: number;
}

export function construirFilasDetalleBonosNoPrestacionales(
  resultado: ResultadoBonosNoPrestacionalesLinea,
): FilaDetalleBonoNoPrestacional[] {
  return (Object.keys(BONOS_NO_PRESTACIONALES) as ClaveBonoNoPrestacional[]).map(clave => ({
    clave,
    nombreVisible: BONOS_NO_PRESTACIONALES[clave].nombreVisible,
    valorPorTrabajador: resultado.valores[clave],
    cantidadTrabajadores: resultado.cantidadTrabajadores,
    totalLinea: resultado.valores[clave] * resultado.cantidadTrabajadores,
  }));
}