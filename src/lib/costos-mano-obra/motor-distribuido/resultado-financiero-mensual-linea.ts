/**
 * Ensamblador financiero mensual — resultado visible de Mano de Obra
 * (ETAPA FINAL D/E, cierre financiero correctivo). Recibe exclusivamente
 * el resultado ya CALCULADO de motor-tarifa-mensual.ts y produce el
 * resultado financiero completo por línea (salario, bono, recargos,
 * auxilio, prestaciones, seguridad social, parafiscales, tarifa por
 * trabajador y de línea completa).
 *
 * Corrección del cierre financiero: los PORCENTAJES (vacaciones, pensión,
 * ARL por clase, caja, salud/sena/icbf, cesantías/prima/intereses) ya NO
 * se leen implícitamente de `PARAMETROS_FINANCIEROS_2026_DEFAULT` — viajan
 * explícitos en `entrada.parametrosFinancieros`
 * (parametros-financieros-mano-obra.ts), resueltos en page.tsx a partir de
 * la configuración REAL del usuario (pSalud/pPension/pSena/pIcbf/pCaja),
 * con los predeterminados únicamente como respaldo cuando el valor está
 * genuinamente ausente (`??`, nunca `||` — cero es válido). Este módulo
 * nunca decide la fuente de los porcentajes, solo los aplica.
 *
 * NO se reutiliza `liquidarTrabajador()` completo: esa función calcula sus
 * PROPIOS recargos con una convención de factor total distinta (banderas
 * P1/P2/P3, todavía "pendientes de validación de Nómina" según su propio
 * encabezado) — usarla duplicaría el pago de la hora ordinaria, exactamente
 * el error ya cerrado en motor-tarifa-mensual.ts (§Q: recargo adicional
 * para RN/Dom.Fest./RNF, factor total solo para horas extra genuinas). Este
 * ensamblador aplica los porcentajes ya resueltos de prestaciones/aportes/
 * parafiscales sobre el IBC YA correcto del motor nuevo, sin volver a
 * calcular recargos por una segunda vía.
 *
 * CIERRE DE CONSISTENCIA MONETARIA — política de redondeo (misma ya
 * aprobada y usada por motor-tarifa-mensual.ts: `redondearHalfUp`, sin
 * decimales, moneda COP sin subunidad práctica). Cada concepto monetario
 * HOJA (cesantías, prima, vacaciones, intereses, salud, pensión, ARL,
 * caja, SENA, ICBF) se calcula con precisión completa y se redondea UNA
 * sola vez, a pesos enteros, HALF_UP, al construirse — nunca antes. Los
 * totales (prestacionesSocialesMensuales/seguridadSocialMensual/
 * parafiscalesMensuales) son la SUMA de esos conceptos YA redondeados,
 * nunca el redondeo de una suma en precisión intermedia — así la celda
 * "Total" siempre coincide exactamente con la suma de las celdas visibles
 * (antes de esta corrección, `redondearPeso` redondeaba a CENTAVOS, no a
 * pesos, y el total podía diferir en $1 de la suma visible de sus partes).
 */
import type { ResultadoTarifaMensual, ConceptoMensual } from './tipos-resultado-mensual';
import type { ParametrosFinancierosManoObra } from './parametros-financieros-mano-obra';
import { calcularLimitePagosNoSalarialesIBC } from './limite-no-salarial-ibc';
import type { ResultadoLimitePagosNoSalarialesIBC } from './limite-no-salarial-ibc';

/** Redondeo HALF_UP a pesos enteros (COP no tiene subunidad práctica) —
 * política de redondeo del cierre de consistencia monetaria. `Math.round`
 * ya es HALF_UP para valores positivos (los únicos que existen aquí). */
function redondearPeso(n: number): number { return Math.round(n); }

const CONCEPTOS_EXTRA: ReadonlySet<ConceptoMensual['concepto']> = new Set([
  'extraDiurna', 'extraNocturna', 'extraDiurnaFestiva', 'extraNocturnaFestiva',
]);

export interface BasesFinancierasMensualesLinea {
  salarioBaseMensual: number;
  bonoSalarialMensual: number;
  bonoNoSalarialMensual: number;
  recargosSalarialesMensuales: number; // RN, Dom.Fest., RNF — nunca las horas extra
  horasExtrasSalarialesMensuales: number; // HE, HEN, HEDF, HENF
  auxilioTransporteNoSalarialMensual: number; // legalmente NO salarial — nunca entra al IBC
  otrosConceptosSalarialesMensuales: number;
  otrosConceptosNoSalarialesMensuales: number;
}

/** Desglose monetario mensual de Recargos y sobretiempo — corrección
 * visual/funcional: antes solo se exponía `recargosSobretiempoMensual`
 * (el total), sin permitir identificar qué concepto lo compone. La suma
 * de los 7 valores SIEMPRE coincide con `totalRecargosSobretiempoMensual`
 * (= recargosSobretiempoMensual), porque ambos vienen de la misma fuente
 * (`r.conceptos`, ya redondeados por el motor) — nunca se recalcula aquí. */
export interface DesgloseRecargosSobretiempoMensual {
  valorRecargoNocturnoMensual: number;
  valorExtraDiurnaMensual: number;
  valorExtraNocturnaMensual: number;
  valorDominicalFestivoMensual: number;
  valorExtraFestivaDiurnaMensual: number;
  valorExtraFestivaNocturnaMensual: number;
  valorRecargoNocturnoFestivoMensual: number;
  totalRecargosSobretiempoMensual: number;
}

/** Desglose de Prestaciones sociales — incluye base y porcentaje de cada
 * concepto para el tooltip de detalle (§5), ya resueltos, nunca calculados
 * en la UI. */
export interface DesglosePrestacionesSocialesMensuales {
  cesantiasMensuales: number;
  primaMensual: number;
  vacacionesMensuales: number;
  interesesCesantiasMensuales: number;
  prestacionesSocialesMensuales: number;
  porcentajeCesantias: number; baseCesantiasMensual: number;
  porcentajePrima: number; basePrimaMensual: number;
  porcentajeVacaciones: number; baseVacacionesMensual: number;
  porcentajeInteresesCesantias: number; baseInteresesCesantiasMensual: number;
}

/** Desglose de Seguridad social — incluye base y porcentaje de cada
 * concepto (salud puede ser 0%, se conserva explícito).
 *
 * Cierre "APLICAR EL IBC AJUSTADO TAMBIÉN A ARL": `baseSaludMensual`/
 * `basePensionMensual`/`baseArlMensual` reflejan TODAS el mismo IBC
 * ajustado por el exceso de pagos no salariales (Sistema de Seguridad
 * Social Integral completo — salud, pensión y riesgos laborales
 * comparten una única base ajustada, nunca se calcula el exceso más de
 * una vez). Prestaciones/parafiscales quedan fuera, en sus propias bases
 * originales, hasta su propia auditoría (§4/§10). `limitePagosNoSalarialesIBC`
 * expone el detalle completo del cálculo para presentación, sin repetir
 * la fórmula en page.tsx. */
export interface DesgloseSeguridadSocialMensual {
  saludMensual: number;
  pensionMensual: number;
  arlMensual: number;
  seguridadSocialMensual: number;
  porcentajeSalud: number; baseSaludMensual: number;
  porcentajePension: number; basePensionMensual: number;
  porcentajeArl: number; baseArlMensual: number;
  /** Base ORIGINAL del Sistema de Seguridad Social Integral, antes de
   * cualquier ajuste por exceso no salarial — igual para los 3 conceptos
   * antes del ajuste (salario + bono prestacional + recargos, sin
   * auxilio). Se expone explícita para trazabilidad/auditoría, nunca se
   * recalcula fuera de este módulo. */
  baseSeguridadSocialOriginal: number;
  /** Base ÚNICA ya ajustada por el exceso de pagos no salariales —
   * `baseSeguridadSocialOriginal + limitePagosNoSalarialesIBC.excesoNoSalarialIBC`,
   * compartida por salud, pensión y ARL (nunca por prestaciones ni
   * parafiscales en esta fase). */
  baseSeguridadSocialAjustada: number;
  limitePagosNoSalarialesIBC: ResultadoLimitePagosNoSalarialesIBC;
}

/** Desglose de Parafiscales — SENA/ICBF pueden ser 0%, se conservan
 * explícitos (nunca sustituidos ni ocultos). */
export interface DesgloseParafiscalesMensual {
  cajaCompensacionMensual: number;
  senaMensual: number;
  icbfMensual: number;
  parafiscalesMensuales: number;
  porcentajeCaja: number; baseCajaMensual: number;
  porcentajeSena: number; baseSenaMensual: number;
  porcentajeIcbf: number; baseIcbfMensual: number;
}

export interface ResultadoFinancieroMensualLinea {
  horasPromedioMensuales: { concepto: string; horas: number }[];
  salarioBaseMensual: number;
  bonoPrestacionalMensual: number;
  // Cierre bonificación no salarial — se suma a tarifaMensualPorTrabajador
  // (pago mensual real al trabajador) pero NUNCA integra
  // basePrestacionesMensual/baseSeguridadSocialMensual/
  // baseParafiscalesMensual ni "otrosCostosMensuales" (Dotación/EPP/etc.):
  // aparece siempre como concepto separado, nunca escondida dentro de otro
  // total.
  bonoNoSalarialMensual: number;
  recargosSobretiempoMensual: number;
  auxilioTransporteMensual: number;
  basePrestacionesMensual: number;
  prestacionesSocialesMensuales: number;
  baseSeguridadSocialMensual: number;
  seguridadSocialMensual: number;
  baseParafiscalesMensual: number;
  parafiscalesMensuales: number;
  otrosCostosMensuales: number;
  // Por trabajador — ALCANCE EXACTO (cierre de consistencia monetaria §2):
  // salarioBaseMensual + bonoPrestacionalMensual + recargosSobretiempoMensual
  // + auxilioTransporteMensual + prestacionesSocialesMensuales +
  // seguridadSocialMensual + parafiscalesMensuales + otrosCostosMensuales
  // (este último SIEMPRE 0 en la práctica actual — ver
  // EntradaResultadoFinancieroMensualLinea.otrosCostosMensualesPorTrabajador:
  // dotación/EPP/exámenes/cursos/vacunas NUNCA se atribuyen por línea, son
  // globales de toda la estructura, ver page.tsx `otrosCostosMensualesTotal`).
  // Es decir: es el COSTO LABORAL mensual por trabajador — NUNCA incluye
  // dotación/EPP/exámenes/cursos/vacunas ni ningún otro costo global.
  tarifaMensualPorTrabajador: number;
  cantidadTrabajadores: number;
  // Por línea completa — MISMO ALCANCE que tarifaMensualPorTrabajador
  // (costo LABORAL, no el costo mensual total), multiplicado UNA sola vez
  // por cantidadTrabajadores. El rótulo visible correspondiente es
  // "COSTO LABORAL MENSUAL DE LA LÍNEA", nunca "COSTO MENSUAL TOTAL DE LA
  // LÍNEA" (ese rótulo solo aplicaría si otrosCostosMensualesPorTrabajador
  // dejara de ser siempre 0, lo cual no ocurre hoy).
  tarifaMensualLinea: number;
  bases: BasesFinancierasMensualesLinea;
  // Corrección visual/funcional — desgloses por concepto para los paneles
  // de detalle (nunca recalculados en page.tsx, siempre expuestos aquí).
  desgloseRecargos: DesgloseRecargosSobretiempoMensual;
  desglosePrestaciones: DesglosePrestacionesSocialesMensuales;
  desgloseSeguridadSocial: DesgloseSeguridadSocialMensual;
  desgloseParafiscales: DesgloseParafiscalesMensual;
}

export interface EntradaResultadoFinancieroMensualLinea {
  resultadoTarifaMensual: ResultadoTarifaMensual; // debe venir con estado === 'CALCULADO'
  claseArl: 'I' | 'II' | 'III' | 'IV' | 'V';
  /** Contrato financiero YA RESUELTO (resolverParametrosFinancierosManoObra)
   * — nunca opcional: si no se tiene configuración real, se resuelve con
   * `undefined` en el resolver, que a su vez marca `fuente:
   * 'VALORES_PREDETERMINADOS'` de forma explícita y trazable. */
  parametrosFinancieros: ParametrosFinancierosManoObra;
  otrosCostosMensualesPorTrabajador?: number; // fuera del alcance de este ensamblador (dotación/EPP/exámenes viven en otros módulos) — 0 por defecto
  /** Cierre "LÍMITE DEL 40% DE PAGOS NO SALARIALES PARA IBC" / "APLICAR EL
   * IBC AJUSTADO TAMBIÉN A ARL" — total mensual genérico de pagos NO
   * salariales de esta línea, por trabajador (hoy: los 4 bonos no
   * prestacionales; el nombre es deliberadamente genérico para admitir
   * otros conceptos no salariales futuros sin reescribir la fórmula, ver
   * §5 del cierre). Se usa EXCLUSIVAMENTE para ajustar la base ÚNICA de
   * salud, pensión y ARL (nunca prestaciones/parafiscales en esta fase)
   * — nunca se suma a tarifaMensualPorTrabajador/tarifaMensualLinea (esos
   * pagos ya se suman aparte en page.tsx). Default 0 (sin ajuste). */
  pagosNoSalarialesMensualesPorTrabajador?: number;
  /** Ajuste "CORRECCIÓN DE BASES — TOTAL_SEMANAL" — corrige el ajuste
   * anterior ("SEPARAR SALARIO PROPORCIONAL Y BASE DE PRESTACIONES"), que
   * hacía que prestaciones/seguridad social/parafiscales consumieran el
   * salario de jornada completa por el solo hecho de ser la referencia de
   * jornada — error conceptual, revertido (§2 del ajuste): prestaciones y
   * parafiscales vuelven a derivarse SIEMPRE de `salarioBaseMensual`
   * (subtotal salarial, el mismo valor que se liquida como salario
   * ordinario), sin ningún override — comportamiento IDÉNTICO al de antes
   * de aquel ajuste, para HORARIO_DETALLADO y TOTAL_SEMANAL por igual.
   *
   * Lo único que SÍ requiere una base distinta es la seguridad social
   * (salud/pensión/ARL): su IBC nunca puede ser inferior a un mínimo
   * (ej. el salario mínimo vigente, o para TOTAL_SEMANAL en esta primera
   * implementación, el salario de jornada completa — conceptualmente
   * distintos, aunque hoy coincidan en valor, ver page.tsx). Si se
   * provee, `baseSeguridadSocialMensual` (antes del ajuste del 40% de
   * pagos no salariales) es
   * `max(basePrestacionesMensual, baseMinimaSeguridadSocialMensual)` —
   * NUNCA se traslada a `baseParafiscalesMensual` (§5: parafiscales no
   * heredan silenciosamente el mínimo de seguridad social). Si se omite
   * (HORARIO_DETALLADO, comportamiento actual sin cambios),
   * `baseSeguridadSocialMensual` sigue siendo exactamente
   * `basePrestacionesMensual`, igual que siempre. */
  baseMinimaSeguridadSocialMensual?: number;
}

/** Único ensamblador autorizado del resultado financiero mensual completo
 * de una línea — nunca se duplica esta fórmula dentro de page.tsx. */
export function construirResultadoFinancieroMensualLinea(
  entrada: EntradaResultadoFinancieroMensualLinea,
): ResultadoFinancieroMensualLinea {
  const r = entrada.resultadoTarifaMensual;
  const params = entrada.parametrosFinancieros;

  const salarioBaseMensual = r.salarioBaseMensual;
  const bonoPrestacionalMensual = r.bonoPrestacionalMensual;
  const bonoNoSalarialMensual = r.bonoNoSalarialMensual;
  const recargosSobretiempoMensual = r.recargosSobretiempoMensual;
  const auxilioTransporteMensual = r.auxilioTransporteMensual;
  const otrosCostosMensuales = entrada.otrosCostosMensualesPorTrabajador ?? 0;

  const recargosSalarialesMensuales = redondearPeso(
    r.conceptos.filter(c => !CONCEPTOS_EXTRA.has(c.concepto)).reduce((s, c) => s + c.valorMensual, 0),
  );
  const horasExtrasSalarialesMensuales = redondearPeso(
    r.conceptos.filter(c => CONCEPTOS_EXTRA.has(c.concepto)).reduce((s, c) => s + c.valorMensual, 0),
  );

  const bases: BasesFinancierasMensualesLinea = {
    salarioBaseMensual,
    // Bono prestacional se trata como SALARIAL (integra IBC) — coherente
    // con su nombre ("prestacional") y con que ya se suma dentro de
    // tarifaMensualPorTrabajador en el motor. Auxilio de transporte es
    // legalmente NO salarial (regla ya confirmada en liquidador-mo.ts:
    // "auxilio EXCLUIDO del IBC").
    bonoSalarialMensual: bonoPrestacionalMensual,
    bonoNoSalarialMensual,
    recargosSalarialesMensuales,
    horasExtrasSalarialesMensuales,
    auxilioTransporteNoSalarialMensual: auxilioTransporteMensual,
    otrosConceptosSalarialesMensuales: 0,
    otrosConceptosNoSalarialesMensuales: 0,
  };

  // IBC — salario + bono + TODOS los recargos/extras (sin auxilio), regla
  // ya confirmada y reutilizada en toda la plataforma. Ajuste "CORRECCIÓN
  // DE BASES — TOTAL_SEMANAL" — `basePrestacionesMensual` SIEMPRE se
  // deriva de `salarioBaseMensual` (el salario ORDINARIO liquidado de la
  // línea, ya sea el completo o el proporcional) — nunca de un salario de
  // referencia distinto, sin excepción ni override (§1/§2/§3 del ajuste).
  const basePrestacionesMensual = redondearPeso(salarioBaseMensual + bonoPrestacionalMensual + recargosSobretiempoMensual);
  // Seguridad social — misma base que prestaciones, salvo que el llamador
  // provea un mínimo explícito (`baseMinimaSeguridadSocialMensual`,
  // TOTAL_SEMANAL): entonces nunca puede quedar por debajo de ese mínimo.
  // Si se omite (HORARIO_DETALLADO, sin cambios), es exactamente
  // `basePrestacionesMensual`, igual que siempre.
  const baseSeguridadSocialMensual = entrada.baseMinimaSeguridadSocialMensual != null
    ? Math.max(basePrestacionesMensual, entrada.baseMinimaSeguridadSocialMensual)
    : basePrestacionesMensual;
  // Parafiscales — NUNCA hereda el mínimo de seguridad social (§5): misma
  // base que prestaciones, siempre, sin excepción.
  const baseParafiscalesMensual = basePrestacionesMensual;

  const vacaciones = redondearPeso(basePrestacionesMensual * params.porcentajeVacaciones / 100);
  // Cesantías/prima/intereses SÍ incluyen auxilio en su base — regla ya
  // confirmada (liquidador-mo.ts: "CON auxilio").
  const baseCesantiasEtc = basePrestacionesMensual + auxilioTransporteMensual;
  const cesantias = redondearPeso(baseCesantiasEtc * params.porcentajeCesantias / 100);
  const interesesCesantias = redondearPeso(baseCesantiasEtc * params.porcentajeInteresesCesantias / 100);
  const prima = redondearPeso(baseCesantiasEtc * params.porcentajePrima / 100);
  const prestacionesSocialesMensuales = redondearPeso(vacaciones + cesantias + interesesCesantias + prima);

  // Cierre "APLICAR EL IBC AJUSTADO TAMBIÉN A ARL" (Ley 1393 de 2010, art.
  // 30) — el exceso de pagos no salariales sobre el 40% de la
  // remuneración total se reincorpora a la base ÚNICA del Sistema de
  // Seguridad Social Integral: salud, pensión Y ARL comparten
  // `baseSeguridadSocialAjustadaMensual`. El exceso se calcula UNA sola
  // vez aquí (nunca se repite el cálculo por concepto). Prestaciones y
  // parafiscales quedan con su base original, sin ajuste, hasta su
  // propia auditoría (§4/§10 del cierre) — nunca se asume que el 40%
  // aplica idénticamente a todas las bases.
  const limitePagosNoSalarialesIBC = calcularLimitePagosNoSalarialesIBC({
    baseSalarial: baseSeguridadSocialMensual,
    pagosNoSalariales: entrada.pagosNoSalarialesMensualesPorTrabajador ?? 0,
  });
  const baseSeguridadSocialAjustadaMensual = limitePagosNoSalarialesIBC.ibcAjustado;

  const pension = redondearPeso(baseSeguridadSocialAjustadaMensual * params.porcentajePension / 100);
  // Los porcentajes configurados por línea siguen mandando siempre — el
  // helper del 40% solo decide la BASE, nunca el aporte ni la clase de
  // ARL (params.porcentajeArlPorClase[entrada.claseArl] sigue siendo la
  // única fuente del porcentaje, nunca hardcodeado aquí).
  const arl = redondearPeso(baseSeguridadSocialAjustadaMensual * params.porcentajeArlPorClase[entrada.claseArl] / 100);
  // Salud 0% (exoneración) sigue produciendo $0 exactamente, aunque exista
  // un IBC ajustado por exceso no salarial — el porcentaje configurado
  // manda siempre, el helper del 40% solo decide la BASE, nunca el aporte.
  const salud = params.exoneradoSalud ? 0 : redondearPeso(baseSeguridadSocialAjustadaMensual * params.porcentajeSalud / 100);
  const seguridadSocialMensual = redondearPeso(pension + arl + salud);

  const caja = redondearPeso((baseParafiscalesMensual + vacaciones) * params.porcentajeCajaCompensacion / 100);
  const sena = params.exoneradoSena ? 0 : redondearPeso(baseParafiscalesMensual * params.porcentajeSena / 100);
  const icbf = params.exoneradoIcbf ? 0 : redondearPeso(baseParafiscalesMensual * params.porcentajeIcbf / 100);
  const parafiscalesMensuales = redondearPeso(caja + sena + icbf);

  // Por trabajador — nunca multiplicado por cantidadTrabajadores aquí.
  // bonoNoSalarialMensual se suma aquí (es un pago mensual real al
  // trabajador) pero NUNCA participa en basePrestacionesMensual/
  // baseSeguridadSocialMensual/baseParafiscalesMensual arriba — cierre
  // bonificación no salarial, regla de exclusión de IBC ya usada para el
  // auxilio de transporte, aplicada aquí de forma aún más estricta (tampoco
  // integra la base de cesantías/prima/intereses).
  const tarifaMensualPorTrabajador = redondearPeso(
    salarioBaseMensual + bonoPrestacionalMensual + bonoNoSalarialMensual + recargosSobretiempoMensual + auxilioTransporteMensual
    + prestacionesSocialesMensuales + seguridadSocialMensual + parafiscalesMensuales + otrosCostosMensuales,
  );
  // Por línea completa — la ÚNICA multiplicación por cantidadTrabajadores.
  const tarifaMensualLinea = redondearPeso(tarifaMensualPorTrabajador * r.cantidadTrabajadores);

  // Corrección visual/funcional — desglose de recargos por concepto,
  // tomado DIRECTO de `r.conceptos` (ya redondeado por el motor, misma
  // fuente que `recargosSobretiempoMensual`) — nunca recalculado aquí, por
  // eso la suma de los 7 valores coincide exactamente con el total.
  const valorConcepto = (concepto: ConceptoMensual['concepto']): number =>
    r.conceptos.find(c => c.concepto === concepto)?.valorMensual ?? 0;
  const desgloseRecargos: DesgloseRecargosSobretiempoMensual = {
    valorRecargoNocturnoMensual: valorConcepto('recargoNocturno'),
    valorExtraDiurnaMensual: valorConcepto('extraDiurna'),
    valorExtraNocturnaMensual: valorConcepto('extraNocturna'),
    valorDominicalFestivoMensual: valorConcepto('ordinariaDominical'),
    valorExtraFestivaDiurnaMensual: valorConcepto('extraDiurnaFestiva'),
    valorExtraFestivaNocturnaMensual: valorConcepto('extraNocturnaFestiva'),
    valorRecargoNocturnoFestivoMensual: valorConcepto('recargoNocturnoDominical'),
    totalRecargosSobretiempoMensual: recargosSobretiempoMensual,
  };

  const desglosePrestaciones: DesglosePrestacionesSocialesMensuales = {
    cesantiasMensuales: cesantias,
    primaMensual: prima,
    vacacionesMensuales: vacaciones,
    interesesCesantiasMensuales: interesesCesantias,
    prestacionesSocialesMensuales,
    porcentajeCesantias: params.porcentajeCesantias, baseCesantiasMensual: baseCesantiasEtc,
    porcentajePrima: params.porcentajePrima, basePrimaMensual: baseCesantiasEtc,
    porcentajeVacaciones: params.porcentajeVacaciones, baseVacacionesMensual: basePrestacionesMensual,
    porcentajeInteresesCesantias: params.porcentajeInteresesCesantias, baseInteresesCesantiasMensual: baseCesantiasEtc,
  };

  const desgloseSeguridadSocial: DesgloseSeguridadSocialMensual = {
    saludMensual: salud,
    pensionMensual: pension,
    arlMensual: arl,
    seguridadSocialMensual,
    porcentajeSalud: params.porcentajeSalud, baseSaludMensual: baseSeguridadSocialAjustadaMensual,
    porcentajePension: params.porcentajePension, basePensionMensual: baseSeguridadSocialAjustadaMensual,
    porcentajeArl: params.porcentajeArlPorClase[entrada.claseArl], baseArlMensual: baseSeguridadSocialAjustadaMensual,
    baseSeguridadSocialOriginal: baseSeguridadSocialMensual,
    baseSeguridadSocialAjustada: baseSeguridadSocialAjustadaMensual,
    limitePagosNoSalarialesIBC,
  };

  const desgloseParafiscales: DesgloseParafiscalesMensual = {
    cajaCompensacionMensual: caja,
    senaMensual: sena,
    icbfMensual: icbf,
    parafiscalesMensuales,
    porcentajeCaja: params.porcentajeCajaCompensacion, baseCajaMensual: redondearPeso(baseParafiscalesMensual + vacaciones),
    porcentajeSena: params.porcentajeSena, baseSenaMensual: baseParafiscalesMensual,
    porcentajeIcbf: params.porcentajeIcbf, baseIcbfMensual: baseParafiscalesMensual,
  };

  return {
    horasPromedioMensuales: [
      { concepto: 'ordinariaHabil', horas: r.horasOrdinariasMensualesPromedio },
      ...r.conceptos.map(c => ({ concepto: c.concepto, horas: c.horasMensualesPromedio })),
    ],
    salarioBaseMensual, bonoPrestacionalMensual, bonoNoSalarialMensual, recargosSobretiempoMensual, auxilioTransporteMensual,
    basePrestacionesMensual, prestacionesSocialesMensuales,
    baseSeguridadSocialMensual, seguridadSocialMensual,
    baseParafiscalesMensual, parafiscalesMensuales,
    otrosCostosMensuales,
    tarifaMensualPorTrabajador, cantidadTrabajadores: r.cantidadTrabajadores, tarifaMensualLinea,
    bases,
    desgloseRecargos, desglosePrestaciones, desgloseSeguridadSocial, desgloseParafiscales,
  };
}