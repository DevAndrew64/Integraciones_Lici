/**
 * Metodología comercial parametrizada de 30 días (COMERCIAL_30_DIAS) —
 * motor SEPARADO y AISLADO del motor legal anualizado
 * (motor-tarifa-mensual.ts). Implementa exactamente la metodología de los
 * Excel comerciales suministrados: promedios fijos de 24,08 días
 * ordinarios y 5,92 domingos/festivos por mes (24,08+5,92=30,00), sin
 * calendario real, sin festivos reales, sin materialización anual.
 *
 * Este archivo solo importa TIPOS neutrales (tipos-resultado-mensual.ts,
 * tipos-adaptador-cargo.ts, tipos-linea-calculada.ts — `import type`, se
 * borran en compilación, cero acoplamiento en tiempo de ejecución) para
 * reutilizar la FORMA `ResultadoTarifaMensual`/`ConceptoMensual` que ya
 * consume el ensamblador financiero compartido. Nunca importa ni llama
 * construir-semana.ts, clasificar-segmentos.ts, calendario-festivos-
 * colombia.ts, perfil-mensual-anualizado.ts ni ningún archivo exclusivo
 * del motor legal anualizado (fase dedicada de extracción: el motor legal
 * ya fue eliminado, este es el único motor de Mano de Obra).
 *
 * Reutiliza (sin modificarlo) el ensamblador financiero compartido
 * `construirResultadoFinancieroMensualLinea` (resultado-financiero-
 * mensual-linea.ts) para prestaciones/seguridad social/parafiscales —
 * esa función es agnóstica de cómo se llegó a los montos mensuales, solo
 * exige la forma `ResultadoTarifaMensual`/`ConceptoMensual` ya definida
 * para el motor legal; aquí se construye una instancia "sintética" de esa
 * misma forma, con los 7 conceptos calculados por la fórmula comercial.
 */
import type { ConceptoMensual, ResultadoTarifaMensual, DetalleMetodologiaMensual, DetalleCalculoConcepto } from './tipos-resultado-mensual';
import { construirResultadoFinancieroMensualLinea } from './resultado-financiero-mensual-linea';
import type { ParametrosFinancierosManoObra } from './parametros-financieros-mano-obra';
import type { ResultadoAdaptadorCargo, EstadoAdaptadorCargo } from './tipos-adaptador-cargo';
import type { LineaCalculadaMensual, OpcionesLineaCalculadaMensual } from './tipos-linea-calculada';

/** Único método operativo — el motor legal anualizado fue eliminado por
 * completo (fase dedicada de extracción); `LEGAL_ANUALIZADO` ya NO es un
 * miembro de este tipo, para que ningún código nuevo pueda volver a
 * introducir una selección de motores. Para leer un costeo histórico que
 * pudo haber persistido `'LEGAL_ANUALIZADO'` como string, usar
 * `normalizarMetodoCalculoManoObra` (abajo) — nunca comparar el valor
 * persistido contra este tipo directamente. */
export type MetodoCalculoManoObra = 'COMERCIAL_30_DIAS';

/** Normaliza cualquier valor persistido (histórico o nuevo) al único
 * método operativo — nunca selecciona un motor distinto, nunca lanza.
 * Un costeo guardado con el antiguo `'LEGAL_ANUALIZADO'`, un valor
 * ausente/null/undefined, o cualquier valor desconocido, siempre se
 * recalcula con COMERCIAL_30_DIAS — decisión de negocio ya aprobada
 * (§9 del cierre dedicado), no un fallback accidental. */
export function normalizarMetodoCalculoManoObra(valorPersistido: unknown): MetodoCalculoManoObra {
  void valorPersistido;
  return 'COMERCIAL_30_DIAS';
}

export interface ParametrosMetodoComercial30Dias {
  diasComercialesMes: number;
  diasOrdinariosPromedioMes: number;
  domingosFestivosPromedioMes: number;
  divisorHoraMensual: number;

  factorDominicalFestivo: number;
  factorHoraExtraDiurnaNormal: number;
  factorHoraExtraNocturnaNormal: number;
  factorHoraExtraDiurnaFestiva: number;
  factorHoraExtraNocturnaFestiva: number;
  factorRecargoNocturnoNormal: number;
  factorRecargoNocturnoFestivo: number;

  /** Ajuste "AJUSTE DE METODOLOGÍA — FACTOR 4,33 PARA SOBRETIEMPO SEMANAL"
   * — parámetro EMPRESARIAL exacto (4,33, NUNCA 52÷12=4,333...) para
   * mensualizar cantidades que se originan como resultado de una
   * evaluación SEMANAL de jornadas individuales/parciales (exceso sobre la
   * jornada máxima semanal — ej. caso CT 172). Uso exclusivo: sobretiempo
   * (HED/HEN) derivado del acumulador semanal de `derivar-distribucion-
   * comercial.ts` para días de patrón genérico. NUNCA sustituye
   * `diasOrdinariosPromedioMes` (24,08, conceptos de programación diaria
   * ordinaria) ni `domingosFestivosPromedioMes` (5,92, domingos/festivos y
   * coberturas ya aprobadas) — los tres parámetros conviven, cada uno con
   * su propio uso, nunca se mezclan para la misma hora. */
  factorSemanasPromedioMes: number;
}

/** Ajuste "FACTOR 4,33 — UNA SOLA FUENTE DE VERDAD" — única constante del
 * factor semanas-por-mes en todo el proyecto. Motor, `detalleCalculo`,
 * popover y pruebas deben importar este valor, nunca escribir `4.33`/`4,33`
 * de forma literal por su cuenta. */
export const FACTOR_SEMANAS_MES = 4.33;

/** Valores predeterminados exigidos — 24.08 + 5.92 = 30.00 (validado en
 * pruebas). Nunca se sustituyen por valores derivados del calendario real
 * (ej. 24.50) mientras el método activo sea COMERCIAL_30_DIAS. */
export const PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT: ParametrosMetodoComercial30Dias = {
  diasComercialesMes: 30,
  diasOrdinariosPromedioMes: 24.08,
  domingosFestivosPromedioMes: 5.92,
  divisorHoraMensual: 210,

  factorDominicalFestivo: 1.90,
  factorHoraExtraDiurnaNormal: 1.25,
  factorHoraExtraNocturnaNormal: 1.75,
  factorHoraExtraDiurnaFestiva: 2.15,
  factorHoraExtraNocturnaFestiva: 2.65,
  factorRecargoNocturnoNormal: 0.35,
  factorRecargoNocturnoFestivo: 2.25,

  factorSemanasPromedioMes: FACTOR_SEMANAS_MES,
};

/** Horas diarias por concepto, capturadas/configuradas por línea — en
 * este método NUNCA se infieren obligatoriamente por acumulación semanal
 * (eso es exclusivo del motor legal anualizado); son la parametrización
 * comercial directa del cargo. */
export interface DistribucionHorasMetodoComercial {
  horasOrdinariasDiaOrdinario: number;
  horasRecargoNocturnoDiaOrdinario: number;
  horasExtraDiurnaDiaOrdinario: number;
  horasExtraNocturnaDiaOrdinario: number;

  horasDominicalFestivaDiaEspecial: number;
  horasRecargoNocturnoFestivoDiaEspecial: number;
  horasExtraDiurnaFestivaDiaEspecial: number;
  horasExtraNocturnaFestivaDiaEspecial: number;
}

/** Sobretiempo semanal (bruto, sin ponderar ÷6, sin mensualizar) que surge
 * de patrón genérico tras cruzar el acumulador compartido de 42h — ajuste
 * "ACUMULADOR SEMANAL UNIFICADO". Las 4 categorías corresponden 1:1 a los
 * 4 conceptos monetarios de sobretiempo semanal (HED/HEN/HEDF/HENF); TODAS
 * se mensualizan exclusivamente con `factorSemanasPromedioMes` (4,33) —
 * `diurnaFestiva`/`nocturnaFestiva` (día de descanso obligatorio o festivo
 * estadístico) NUNCA se mensualizan con 5,92: el hecho de ser descanso/
 * festivo decide el CONCEPTO (HEDF/HENF en vez de HED/HEN) y el factor
 * monetario, pero no cambia el origen de mensualización del sobretiempo
 * semanal (§6 del ajuste). Definido aquí (no en el derivador) para evitar
 * un ciclo de imports — el derivador importa este tipo desde este mismo
 * archivo, igual que ya hace con `DistribucionHorasMetodoComercial`. */
export interface HorasExtraSemanalesComercial {
  diurna: number;
  nocturna: number;
  diurnaFestiva: number;
  nocturnaFestiva: number;
}

export const DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA: DistribucionHorasMetodoComercial = {
  horasOrdinariasDiaOrdinario: 0,
  horasRecargoNocturnoDiaOrdinario: 0,
  horasExtraDiurnaDiaOrdinario: 0,
  horasExtraNocturnaDiaOrdinario: 0,
  horasDominicalFestivaDiaEspecial: 0,
  horasRecargoNocturnoFestivoDiaEspecial: 0,
  horasExtraDiurnaFestivaDiaEspecial: 0,
  horasExtraNocturnaFestivaDiaEspecial: 0,
};

export interface EntradaMetodoComercial30Dias {
  distribucionHoras: DistribucionHorasMetodoComercial;
  salarioMensual: number;
  bonoPrestacionalMensual?: number;
  bonoNoSalarialMensual?: number;
  auxilioTransporteMensual: number;
  cantidadTrabajadores: number;
  /** Si se omite, se usa PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT —
   * nunca un valor derivado del calendario. */
  parametros?: ParametrosMetodoComercial30Dias;
  /** Ajuste "FACTOR 4,33 PARA SOBRETIEMPO SEMANAL", extendido por
   * "ACUMULADOR SEMANAL UNIFICADO" — sobretiempo semanal BRUTO (sin ÷6)
   * originado en días de patrón genérico (JORNADA_INDIVIDUAL/PARCIAL) que
   * ya cruzaron la jornada semanal configurada, calculado por
   * `derivarDistribucionHorasComercialActivo` (`resultado.
   * horasExtraSemanales`). Se SUMA (nunca reemplaza) a la HED/HEN/HEDF/
   * HENF ya calculada vía `distribucionHoras.horasExtraDiurnaDiaOrdinario`/
   * etc. (que ya EXCLUYEN este sobretiempo — ver derivador), TODAS
   * mensualizadas con `factorSemanasPromedioMes` (4,33), nunca con
   * `diasOrdinariosPromedioMes` (24,08) ni `domingosFestivosPromedioMes`
   * (5,92) — el hecho de ser descanso obligatorio/festivo decide el
   * CONCEPTO (diurnaFestiva→HEDF, nocturnaFestiva→HENF), nunca el origen
   * de mensualización. Si se omite, es 0 para las 4 — comportamiento
   * vigente sin cambios (turnos de 12h fijo, coberturas 12/7 y 24/7,
   * Avianca, y cualquier llamador que no pase este campo). */
  horasExtraSemanales?: HorasExtraSemanalesComercial;
  /** Metadata de auditoría interna (nunca se muestra al usuario con este
   * nombre) — de dónde viene la mensualización del sobretiempo de esta
   * línea. Puramente informativo, no participa del cálculo. */
  origenMensualizacionExtra?: 'SEMANAL_4_33' | 'DIARIO_24_08';
}

/** Redondeo HALF_UP a pesos enteros — misma política ya vigente en el
 * resto del proyecto (resultado-financiero-mensual-linea.ts,
 * motor-tarifa-mensual.ts): `Math.round` ya es HALF_UP para los valores
 * positivos que existen aquí. Se aplica UNA vez por concepto, nunca antes
 * (el valor hora y las horas mensuales viajan con precisión completa
 * hasta este punto). */
function redondearHalfUp(n: number): number { return Math.round(n); }

interface DefinicionConceptoComercial {
  concepto: ConceptoMensual['concepto'];
  horasDia: number;
  diasPromedioMes: number;
  factor: number;
  factorTipo: 'RECARGO_ADICIONAL' | 'FACTOR_TOTAL';
  /** Ajuste "FACTOR 4,33", extendido por "ACUMULADOR SEMANAL UNIFICADO" —
   * horas mensuales YA calculadas (semanal × factorSemanasPromedioMes) que
   * se SUMAN a `horasDia × diasPromedioMes` para este concepto. Solo
   * aplica a `extraDiurna`/`extraNocturna`/`extraDiurnaFestiva`/
   * `extraNocturnaFestiva` — el resto de conceptos no participa del
   * acumulador semanal genérico. Default 0 (comportamiento vigente sin
   * cambios). */
  horasMensualesSemanales?: number;
}

/**
 * Único ensamblador autorizado del resultado "tarifa mensual" bajo la
 * metodología comercial de 30 días — produce una instancia de
 * `ResultadoTarifaMensual` (misma forma que usa el motor legal) para que
 * `construirResultadoFinancieroMensualLinea` (compartido, sin modificar)
 * pueda aplicarle prestaciones/seguridad social/parafiscales sin volver a
 * calcular nada. Los campos de `metodologia` relativos a calendario/año
 * (anioVigencia, cantidadDomingosAnio, cantidadFestivosAnio,
 * cantidadCoincidenciasDomingoFestivo) NO APLICAN en este método — se
 * completan en 0 únicamente por compatibilidad de tipo con el motor
 * legal; page.tsx nunca debe renderizarlos para una línea calculada con
 * este método.
 */
export function calcularResultadoTarifaMensualComercial30Dias(
  entrada: EntradaMetodoComercial30Dias,
): ResultadoTarifaMensual {
  const p = entrada.parametros ?? PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT;
  const d = entrada.distribucionHoras;

  // Valor hora — SIN redondear antes de calcular cada concepto (§6).
  const valorHoraExacto = entrada.salarioMensual > 0 ? entrada.salarioMensual / p.divisorHoraMensual : 0;

  const horasOrdinariasMensualesPromedio = d.horasOrdinariasDiaOrdinario * p.diasOrdinariosPromedioMes;

  // Ajuste "FACTOR 4,33" extendido por "ACUMULADOR SEMANAL UNIFICADO" —
  // sobretiempo semanal genérico (JORNADA_INDIVIDUAL/PARCIAL, ej. CT 172),
  // ya mensualizado con `factorSemanasPromedioMes` (nunca con
  // `diasOrdinariosPromedioMes` ni `domingosFestivosPromedioMes`). 0 si no
  // se provee (turnos de 12h fijo, coberturas 12/7 y 24/7, Avianca, o
  // cualquier llamador que no pase este campo — comportamiento vigente sin
  // cambios).
  const horasExtraSemanales = entrada.horasExtraSemanales ?? { diurna: 0, nocturna: 0, diurnaFestiva: 0, nocturnaFestiva: 0 };
  const horasMensualesExtraDiurnaSemanal = horasExtraSemanales.diurna * p.factorSemanasPromedioMes;
  const horasMensualesExtraNocturnaSemanal = horasExtraSemanales.nocturna * p.factorSemanasPromedioMes;
  const horasMensualesExtraDiurnaFestivaSemanal = horasExtraSemanales.diurnaFestiva * p.factorSemanasPromedioMes;
  const horasMensualesExtraNocturnaFestivaSemanal = horasExtraSemanales.nocturnaFestiva * p.factorSemanasPromedioMes;

  // Los 7 conceptos — mismas claves que el motor legal (HorasBucketsDistribuido),
  // para que el ensamblador compartido los consuma sin distinguir el origen.
  const definiciones: DefinicionConceptoComercial[] = [
    { concepto: 'recargoNocturno', horasDia: d.horasRecargoNocturnoDiaOrdinario, diasPromedioMes: p.diasOrdinariosPromedioMes, factor: p.factorRecargoNocturnoNormal, factorTipo: 'RECARGO_ADICIONAL' },
    { concepto: 'extraDiurna', horasDia: d.horasExtraDiurnaDiaOrdinario, diasPromedioMes: p.diasOrdinariosPromedioMes, factor: p.factorHoraExtraDiurnaNormal, factorTipo: 'FACTOR_TOTAL', horasMensualesSemanales: horasMensualesExtraDiurnaSemanal },
    { concepto: 'extraNocturna', horasDia: d.horasExtraNocturnaDiaOrdinario, diasPromedioMes: p.diasOrdinariosPromedioMes, factor: p.factorHoraExtraNocturnaNormal, factorTipo: 'FACTOR_TOTAL', horasMensualesSemanales: horasMensualesExtraNocturnaSemanal },
    { concepto: 'ordinariaDominical', horasDia: d.horasDominicalFestivaDiaEspecial, diasPromedioMes: p.domingosFestivosPromedioMes, factor: p.factorDominicalFestivo, factorTipo: 'FACTOR_TOTAL' },
    { concepto: 'recargoNocturnoDominical', horasDia: d.horasRecargoNocturnoFestivoDiaEspecial, diasPromedioMes: p.domingosFestivosPromedioMes, factor: p.factorRecargoNocturnoFestivo, factorTipo: 'FACTOR_TOTAL' },
    { concepto: 'extraDiurnaFestiva', horasDia: d.horasExtraDiurnaFestivaDiaEspecial, diasPromedioMes: p.domingosFestivosPromedioMes, factor: p.factorHoraExtraDiurnaFestiva, factorTipo: 'FACTOR_TOTAL', horasMensualesSemanales: horasMensualesExtraDiurnaFestivaSemanal },
    { concepto: 'extraNocturnaFestiva', horasDia: d.horasExtraNocturnaFestivaDiaEspecial, diasPromedioMes: p.domingosFestivosPromedioMes, factor: p.factorHoraExtraNocturnaFestiva, factorTipo: 'FACTOR_TOTAL', horasMensualesSemanales: horasMensualesExtraNocturnaFestivaSemanal },
  ];

  const conceptos: ConceptoMensual[] = [];
  let recargosSobretiempoMensual = 0;
  for (const def of definiciones) {
    // horasMensualesPromedio = horasDia × diasPromedioMes + horas ya
    // mensualizadas vía 4,33 (extraDiurna/extraNocturna únicamente) —
    // 24.08/5.92/4.33 son los parámetros comerciales DEFINITIVOS, nunca se
    // redondean aquí (§5).
    const horasBaseMensual = def.horasDia * def.diasPromedioMes;
    const horasSemanalesAcumuladas = def.horasMensualesSemanales ? def.horasMensualesSemanales / p.factorSemanasPromedioMes : 0;
    const horasMensualesPromedio = horasBaseMensual + (def.horasMensualesSemanales ?? 0);
    const valorSinRedondear = horasMensualesPromedio * valorHoraExacto * def.factor;
    const valorMensual = redondearHalfUp(valorSinRedondear);
    // Ajuste "MEJORA DE TRAZABILIDAD VISUAL — ICONO DE DETALLE DE CÁLCULO"
    // — espejo, para presentación, de los mismos números ya calculados
    // arriba (nunca una segunda fuente de verdad).
    const detalleCalculo: DetalleCalculoConcepto = {
      horasDiaOrdinario: def.horasDia,
      diasPromedioMes: def.diasPromedioMes,
      horasBaseMensual,
      horasSemanalesAcumuladas,
      factorMensualizacionSemanal: horasSemanalesAcumuladas > 0 ? p.factorSemanasPromedioMes : 0,
      horasMensualesSemanales: def.horasMensualesSemanales ?? 0,
      horasMensualesPromedio,
      valorHoraExacto,
      factor: def.factor,
      factorTipo: def.factorTipo,
      valorSinRedondear,
      valorMensual,
      reglaRedondeo: 'HALF_UP',
      origenMensualizacionBase: def.diasPromedioMes === p.domingosFestivosPromedioMes ? 'DOMINGO_FESTIVO_5_92' : 'DIARIO_24_08',
      origenMensualizacionSemanal: horasSemanalesAcumuladas > 0 ? 'SEMANAL_4_33' : 'NO_APLICA',
    };
    conceptos.push({ concepto: def.concepto, horasMensualesPromedio, factorTipo: def.factorTipo, factor: def.factor, valorMensual, detalleCalculo });
    recargosSobretiempoMensual += valorMensual;
  }

  const salarioBaseMensual = entrada.salarioMensual;
  const bonoPrestacionalMensual = entrada.bonoPrestacionalMensual ?? 0;
  const bonoNoSalarialMensual = entrada.bonoNoSalarialMensual ?? 0;
  const auxilioTransporteMensual = entrada.auxilioTransporteMensual;
  const tarifaMensualPorTrabajador = salarioBaseMensual + bonoPrestacionalMensual + bonoNoSalarialMensual + recargosSobretiempoMensual + auxilioTransporteMensual;
  const tarifaMensualCargo = tarifaMensualPorTrabajador * entrada.cantidadTrabajadores;

  // Campos de calendario/año — NO APLICAN en este método (§3/§13): se
  // completan en 0 únicamente por compatibilidad de tipo, nunca se
  // renderizan para una línea comercial.
  const metodologia: DetalleMetodologiaMensual = {
    anioVigencia: 0,
    diasOrdinariosPromedio: p.diasOrdinariosPromedioMes,
    domingosPromedio: p.domingosFestivosPromedioMes,
    festivosPromedio: 0,
    domingosFestivosPromedio: p.domingosFestivosPromedioMes,
    diasOrdinariosPromedioExacto4: p.diasOrdinariosPromedioMes,
    domingosPromedioExacto4: p.domingosFestivosPromedioMes,
    festivosPromedioExacto4: 0,
    domingosFestivosPromedioExacto4: p.domingosFestivosPromedioMes,
    cantidadDomingosAnio: 0,
    cantidadFestivosAnio: 0,
    cantidadCoincidenciasDomingoFestivo: 0,
  };

  return {
    estado: 'CALCULADO', mensaje: null,
    diasProgramadosPromedioMensual: p.diasComercialesMes,
    diasOrdinariosProgramadosPromedioMensual: p.diasOrdinariosPromedioMes,
    domingosTrabajadosPromedioMensual: p.domingosFestivosPromedioMes,
    festivosTrabajadosPromedioMensual: 0,
    aplicaDomingo: d.horasDominicalFestivaDiaEspecial > 0,
    incluyeFestivos: true,
    horasOrdinariasMensualesPromedio,
    conceptos, recargosSobretiempoMensual,
    salarioBaseMensual, bonoPrestacionalMensual, bonoNoSalarialMensual, auxilioTransporteMensual,
    tarifaMensualPorTrabajador, cantidadTrabajadores: entrada.cantidadTrabajadores, tarifaMensualCargo,
    metodologia,
  };
}

/** Datos mínimos de UNA línea bajo el método comercial — equivalente
 * comercial de `DatosLineaParaTarifaMensual` (adaptador-cargo-tarifa-
 * mensual.ts), pero sin `distribucionesHorario`/`incluyeFestivos` (esos
 * conceptos son exclusivos del motor legal anualizado; aquí la
 * programación es la parametrización comercial directa, §4). */
export interface DatosLineaComercial30Dias {
  distribucionHoras: DistribucionHorasMetodoComercial;
  salarioMensual: number;
  cantidadTrabajadores: number;
  bonoPrestacionalMensual?: number;
  bonoNoSalarialMensual?: number;
  parametros?: ParametrosMetodoComercial30Dias;
  /** Sobretiempo semanal (bruto, sin mensualizar) originado en días de
   * patrón genérico con exceso sobre la jornada semanal — ajuste "FACTOR
   * 4,33 PARA SOBRETIEMPO SEMANAL", extendido por "ACUMULADOR SEMANAL
   * UNIFICADO" (4 categorías: HED/HEN/HEDF/HENF). Se obtiene de
   * `derivarDistribucionHorasComercialActivo(...).horasExtraSemanales`
   * — page.tsx debe pasarlo siempre que lo tenga disponible; si se omite,
   * ese sobretiempo semanal queda sin valorizar (contribución 0). */
  horasExtraSemanales?: HorasExtraSemanalesComercial;
  origenMensualizacionExtra?: 'SEMANAL_4_33' | 'DIARIO_24_08';
}

/**
 * Único punto de entrada por línea para el método comercial — combina
 * `calcularResultadoTarifaMensualComercial30Dias` (arriba) con el
 * ensamblador financiero compartido, sin modificarlo, produciendo la
 * MISMA forma `LineaCalculadaMensual` que ya consume page.tsx para el
 * motor legal — page.tsx solo decide, por línea, cuál de los dos
 * constructores llamar según `metodoCalculoManoObra`, nunca mezcla ambos
 * dentro de un mismo resultado.
 */
export function construirLineaCalculadaMensualComercial30Dias(
  datos: DatosLineaComercial30Dias,
  auxilioTransporteMensual: number,
  claseArl: 'I' | 'II' | 'III' | 'IV' | 'V',
  parametrosFinancieros: ParametrosFinancierosManoObra,
  opciones?: OpcionesLineaCalculadaMensual,
): LineaCalculadaMensual {
  if (!(datos.salarioMensual > 0)) {
    const estadoUI: EstadoAdaptadorCargo = 'PROGRAMACION_INCOMPLETA';
    const resultadoAdaptador: ResultadoAdaptadorCargo = {
      estadoUI, mensajeUsuario: 'Indique el salario mensual del cargo.', resultado: null, previewComercial: null,
    };
    return { resultadoAdaptador, resultadoFinanciero: null };
  }
  const resultado = calcularResultadoTarifaMensualComercial30Dias({
    distribucionHoras: datos.distribucionHoras,
    salarioMensual: datos.salarioMensual,
    bonoPrestacionalMensual: datos.bonoPrestacionalMensual,
    bonoNoSalarialMensual: datos.bonoNoSalarialMensual,
    auxilioTransporteMensual,
    cantidadTrabajadores: datos.cantidadTrabajadores,
    parametros: datos.parametros,
    horasExtraSemanales: datos.horasExtraSemanales,
    origenMensualizacionExtra: datos.origenMensualizacionExtra,
  });
  const resultadoConTrazabilidad: ResultadoTarifaMensual = datos.origenMensualizacionExtra
    ? { ...resultado, origenMensualizacionExtra: datos.origenMensualizacionExtra }
    : resultado;
  const resultadoFinanciero = construirResultadoFinancieroMensualLinea({
    resultadoTarifaMensual: resultadoConTrazabilidad,
    claseArl,
    parametrosFinancieros,
    otrosCostosMensualesPorTrabajador: opciones?.otrosCostosMensualesPorTrabajador,
    pagosNoSalarialesMensualesPorTrabajador: opciones?.pagosNoSalarialesMensualesPorTrabajador,
    baseMinimaSeguridadSocialMensual: opciones?.baseMinimaSeguridadSocialMensual,
  });
  const estadoUI: EstadoAdaptadorCargo = 'TARIFA_CALCULADA';
  const resultadoAdaptador: ResultadoAdaptadorCargo = { estadoUI, mensajeUsuario: null, resultado: resultadoConTrazabilidad, previewComercial: null };
  return { resultadoAdaptador, resultadoFinanciero };
}