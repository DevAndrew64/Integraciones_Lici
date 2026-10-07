/**
 * Tipos neutrales del resultado "tarifa mensual" — forma compartida entre
 * cualquier motor que produzca un resultado mensual por línea (hoy: el
 * motor comercial de 30 días, motor-comercial-30-dias.ts) y el ensamblador
 * financiero (resultado-financiero-mensual-linea.ts). Sin funciones, sin
 * dependencia de ningún motor concreto — solo el contrato de datos.
 */
import type { HorasBucketsDistribuido } from './tipos';

/** Ajuste "MEJORA DE TRAZABILIDAD VISUAL — ICONO DE DETALLE DE CÁLCULO"
 * — desglose real (nunca reconstruido desde el texto de la tabla) de
 * cómo se llegó a `horasMensualesPromedio`/`valorMensual` de un
 * concepto. Puramente informativo/presentación: no participa de ningún
 * cálculo, no se usa como entrada de nada — es un espejo de los mismos
 * números que ya calculó `calcularResultadoTarifaMensualComercial30Dias`,
 * expuesto para que la UI los muestre sin volver a derivarlos. */
export interface DetalleCalculoConcepto {
  /** A. Origen de las horas — patrón diario. */
  horasDiaOrdinario: number;
  diasPromedioMes: number;
  horasBaseMensual: number; // horasDiaOrdinario × diasPromedioMes
  /** Ajuste "FACTOR 4,33" — exceso semanal genérico ya mensualizado
   * (0 si este concepto no participa del acumulador semanal). */
  horasSemanalesAcumuladas: number;
  factorMensualizacionSemanal: number; // 4,33 si horasSemanalesAcumuladas>0, si no 0
  horasMensualesSemanales: number; // horasSemanalesAcumuladas × factorMensualizacionSemanal
  /** B. Mensualización total = horasBaseMensual + horasMensualesSemanales
   * (idéntico a `horasMensualesPromedio` del concepto — repetido aquí
   * para que el detalle sea autocontenido). */
  horasMensualesPromedio: number;
  /** C. Cálculo monetario. */
  valorHoraExacto: number; // sin redondear (política de redondeo vigente)
  factor: number;
  factorTipo: 'RECARGO_ADICIONAL' | 'FACTOR_TOTAL';
  valorSinRedondear: number;
  valorMensual: number; // redondeado HALF_UP
  reglaRedondeo: 'HALF_UP';
  /** D. Trazabilidad. */
  origenMensualizacionBase: 'DIARIO_24_08' | 'DOMINGO_FESTIVO_5_92';
  origenMensualizacionSemanal: 'SEMANAL_4_33' | 'NO_APLICA';
}

export interface ConceptoMensual {
  concepto: keyof Omit<HorasBucketsDistribuido, 'ordinariaHabil'>;
  horasMensualesPromedio: number;
  factorTipo: 'RECARGO_ADICIONAL' | 'FACTOR_TOTAL';
  factor: number;
  valorMensual: number; // redondeado HALF_UP
  /** Opcional — solo lo produce el motor comercial de 30 días (único
   * productor de ConceptoMensual hoy). Nunca se reconstruye en la UI. */
  detalleCalculo?: DetalleCalculoConcepto;
}

export interface DetalleMetodologiaMensual {
  anioVigencia: number;
  diasOrdinariosPromedio: number;
  domingosPromedio: number;
  festivosPromedio: number;
  domingosFestivosPromedio: number;
  diasOrdinariosPromedioExacto4: number;
  domingosPromedioExacto4: number;
  festivosPromedioExacto4: number;
  domingosFestivosPromedioExacto4: number;
  cantidadDomingosAnio: number;
  cantidadFestivosAnio: number;
  cantidadCoincidenciasDomingoFestivo: number;
}

export type EstadoTarifaMensual = 'CALCULADO' | 'INCONSISTENTE' | 'REQUIERE_CONFIGURAR_PATRON_CICLICO';

export interface ResultadoTarifaMensual {
  estado: EstadoTarifaMensual;
  mensaje: string | null;
  diasProgramadosPromedioMensual: number;
  diasOrdinariosProgramadosPromedioMensual: number;
  domingosTrabajadosPromedioMensual: number;
  festivosTrabajadosPromedioMensual: number;
  aplicaDomingo: boolean;
  incluyeFestivos: boolean;
  horasOrdinariasMensualesPromedio: number;
  conceptos: ConceptoMensual[];
  recargosSobretiempoMensual: number;
  salarioBaseMensual: number;
  bonoPrestacionalMensual: number;
  bonoNoSalarialMensual: number;
  auxilioTransporteMensual: number;
  tarifaMensualPorTrabajador: number;
  cantidadTrabajadores: number;
  tarifaMensualCargo: number;
  metodologia: DetalleMetodologiaMensual;
  /** Ajuste "FACTOR 4,33 PARA SOBRETIEMPO SEMANAL" — trazabilidad interna
   * de auditoría (nunca se muestra al usuario con este nombre técnico):
   * indica si el sobretiempo de esta línea se mensualizó con
   * `factorSemanasPromedioMes` (4,33, exceso semanal de jornada
   * individual/parcial) o con el mecanismo diario vigente (24,08÷6).
   * Opcional — solo lo produce el motor comercial de 30 días. */
  origenMensualizacionExtra?: 'SEMANAL_4_33' | 'DIARIO_24_08';
}