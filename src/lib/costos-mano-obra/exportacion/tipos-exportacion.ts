// src/lib/costos-mano-obra/exportacion/tipos-exportacion.ts
// Ajuste "IMPLEMENTAR EXPORTACIÓN DE MANO DE OBRA USANDO EXACTAMENTE LA
// PLANTILLA 'Mano de obra.xlsx'" — DTO tipado y reutilizable entre cliente
// (construcción desde los objetos canónicos que ya alimentan la pantalla:
// gruposCargoManoObra/calculoLaboralUnitario/gruposTurnantesManoObra) y
// servidor (validación de esquema + reconciliaciones, nunca reconstrucción
// de la liquidación laboral completa).

export interface DetalleUnitarioExportDto {
  salarioBasico: number;
  bonoPrestacional: number;

  recargoNocturno: number;
  horaExtraDiurna: number;
  horaExtraNocturna: number;
  dominicalesFestivos: number;
  horaExtraFestiva: number;
  horaExtraFestivaNocturna: number;
  recargoNocturnoFestivo: number;
  totalRecargos: number;

  auxilioTransporte: number;
  subtotalSalarial: number;

  cesantias: number;
  prima: number;
  vacaciones: number;
  interesesCesantias: number;
  totalPrestaciones: number;

  salud: number;
  pension: number;
  arl: number;
  totalSeguridadSocial: number;

  cajaCompensacion: number;
  sena: number;
  icbf: number;
  totalParafiscales: number;

  // Ajuste "CORRECCIÓN FINAL DE EXPORTACIÓN EXCEL — PORCENTAJES Y
  // FORMATOS" — porcentajes REALES ya resueltos por el motor canónico
  // (ResultadoFinancieroMensualLinea.desglose*), NUNCA calculados aquí
  // como costoMes/base (la base de Vacaciones, por ejemplo, puede ser
  // distinta a la de los demás conceptos). Decimales (0.0833, no 8.33) —
  // el formato de celda 0,00% de la plantilla ya los muestra como
  // porcentaje.
  porcentajeCesantias: number;
  porcentajePrima: number;
  porcentajeVacaciones: number;
  porcentajeInteresesCesantias: number;
  porcentajeSalud: number;
  porcentajePension: number;
  porcentajeArl: number;
  porcentajeCaja: number;
  porcentajeSena: number;
  porcentajeIcbf: number;


  dotacion: number;
  epp: number;
  examenes: number;
  cursos: number;
  vacunas: number;
  totalOtrosCostos: number;

  bonosNoPrestacionales: number;
  costoLaboralUnitario: number;

  // Ajuste "adicional mira aca no me coloca cuantas horas son y como se
  // multiplica" — cantidad de horas mensuales promedio por concepto de
  // recargo/hora extra, tal como el motor las calcula
  // (ResultadoFinancieroMensualLinea.horasPromedioMensuales), NUNCA
  // recalculadas aquí. Alimentan el bloque "LIQUIDACIÓN DE HORAS" de la
  // plantilla (columnas H:M) — la plantilla solo tiene columna para 6 de
  // los 7 conceptos de recargo (no existe columna para "Extra festiva"
  // diurna, tal como viene la plantilla real, sin inventar una). Para
  // fichas TURNANTE no existe una fuente canónica de horas por concepto
  // (g.referenciaUnitaria trae los recargos ya consolidados) — se deja en
  // 0, nunca inventado.
  horasRecargoNocturno: number;
  horasExtraDiurna: number;
  horasExtraNocturna: number;
  horasDominicalesFestivos: number;
  // Ajuste "faltaba tambien extra festivo" — la plantilla real SÍ trae
  // columna propia para este concepto (8 columnas en total en
  // LIQUIDACIÓN DE HORAS, no 6: Horas semanales + 7 conceptos de
  // recargo/hora extra) — se había pasado por alto en un ajuste previo.
  horasExtraFestiva: number;
  horasExtraFestivaNocturna: number;
  horasRecargoNocturnoFestivo: number;

  // Ajuste "las horas tienen formula mira" — para las horas EXTRA
  // (Extra diurna/nocturna/festiva nocturna, nunca los recargos
  // Rec.noct./Dom-Fest/Rec.noct-fest, que el motor calcula directo por
  // mes, sin proyección semanal), el popup de detalle ya muestra
  // "horas extra semanales × 4,33 = horas extra mensuales"
  // (obtenerResumenSemanalLinea, FACTOR_SEMANAS_MES) — se exponen las
  // horas SEMANALES para que el Excel replique esa misma fórmula, nunca
  // un cálculo paralelo. Solo tiene sentido cuando la línea usa la
  // metodología SEMANAL_4_33 (esMetodologiaSemanal=1); con DIARIO_24_08
  // (o fichas TURNANTE, sin este desglose) queda en 0 y el generador usa
  // el valor mensual directo, igual que hoy.
  esMetodologiaSemanal: number;
  horasSemanalesExtraDiurna: number;
  horasSemanalesExtraNocturna: number;
}

export interface TurnanteExportDto {
  coberturaHoras: number;
  diasEquivalentes: number;
  factorNumerador: number;
  factorDenominador: number;
  costoReferencia42Horas: number;
  cantidadTurnantesFisicos: number;
}

export interface FichaManoObraExportDto {
  fichaId: string;
  tipo: 'CARGO' | 'TURNANTE';
  orden: number;

  cargo: string;
  horario: string;
  cantidadTrabajadores: number;
  horasSemanales: number;

  detalleUnitario: DetalleUnitarioExportDto;

  totalCargo: number;

  turnante?: TurnanteExportDto;
}

/**
 * Nota de contrato real (§3 del ajuste) — el esquema de persistencia
 * (`guardado-modular.ts`) NO tiene un contador `version:number`; el token
 * de concurrencia real es `ModuloGuardado.ultimaActualizacion` (ISO 8601,
 * "también sirve como token de concurrencia" — comentario textual del
 * propio archivo). Por eso este DTO usa `ultimaActualizacionManoObra` en
 * vez de inventar un campo `version` que no existe en el sistema — el
 * servidor compara este valor contra `modulos.manoObra.ultimaActualizacion`
 * ya persistido para detectar ediciones concurrentes (§5-A).
 */
export interface ExportacionManoObraDto {
  estructuraCostoId: number | string;
  procesoId: number | string;
  numeroProceso: string;

  ultimaActualizacionManoObra: string;

  fichas: FichaManoObraExportDto[];
}
