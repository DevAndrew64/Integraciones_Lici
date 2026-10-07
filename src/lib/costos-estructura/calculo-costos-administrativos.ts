/**
 * Ajuste "REDISEÑAR COSTOS ADMINISTRATIVOS" — funciones puras del módulo.
 * Sin React, sin `fetch` — reutilizable en page.tsx y en pruebas.
 *
 * Diagnóstico: el modelo actual (`adminRows={id,desc,vMes}`) es 100%
 * valor fijo manual — no existía ningún concepto de porcentaje/base antes
 * de este ajuste. Por decisión explícita del usuario, se implementa
 * PORCENTAJE como cálculo real (no solo un campo de formulario), con dos
 * bases soportadas:
 *  - 'MANO_OBRA' → tarifaMensualTotalManoObra (ya incluye Mano de Obra +
 *    Turnantes + Dotación/EPP + Exámenes/Cursos/Vacunas, una sola vez).
 *  - 'COSTO_DIRECTO' → tarifaMensualTotalManoObra + maqTotal +
 *    totalMensualInsumos — la "estructura antes de administrativos".
 * Ninguna base incluye jamás el propio `adminTotal` (evita circularidad).
 */

export const PORCENTAJE_ADMINISTRATIVO_DEFECTO = 5;

export type BaseCalculoAdministrativo = 'MANO_OBRA' | 'COSTO_DIRECTO';

export interface EntradaCostoAdministrativo {
  tipoCalculo: 'VALOR_FIJO' | 'PORCENTAJE';
  valorFijo?: number;
  porcentaje?: number;
  baseCalculo?: BaseCalculoAdministrativo;
  baseManoObra: number;
  baseCostoDirecto: number;
}

/**
 * tipoCalculo==='VALOR_FIJO' → valorMensual = valorFijo.
 * tipoCalculo==='PORCENTAJE' → valorMensual = base × porcentaje / 100,
 * donde `base` es `baseManoObra` o `baseCostoDirecto` según `baseCalculo`
 * — NUNCA `adminTotal` ni ninguna suma que incluya administrativos.
 */
export function calcularCostoAdministrativo(entrada: EntradaCostoAdministrativo): number {
  if (entrada.tipoCalculo === 'VALOR_FIJO') return entrada.valorFijo ?? 0;
  const base = entrada.baseCalculo === 'MANO_OBRA' ? entrada.baseManoObra : entrada.baseCostoDirecto;
  return base * (entrada.porcentaje ?? 0) / 100;
}

export interface CostoAdministrativoRowHistorico {
  id?: number; concepto?: string;
  tipoCalculo?: 'VALOR_FIJO' | 'PORCENTAJE';
  baseCalculo?: BaseCalculoAdministrativo;
  porcentaje?: number; valorFijo?: number; valorMensual?: number;
  observacion?: string;
  usuarioRegistro?: string; fechaRegistro?: string;
}

/**
 * Ajuste "REDISEÑAR COSTOS ADMINISTRATIVOS" §20 — adaptación defensiva:
 *  - `tipoCalculo` ausente (todo registro histórico real, previo a este
 *    ajuste) → 'VALOR_FIJO' (única modalidad que existía).
 *  - `valorFijo` ausente pero `valorMensual` histórico presente → se
 *    adopta como `valorFijo`, preservando el importe ya guardado.
 *  - `valorMensual` ausente → se recalcula con `calcularCostoAdministrativo`
 *    (rama VALOR_FIJO, nunca inventa un porcentaje para un registro que
 *    nunca lo tuvo).
 *  - `concepto` ausente → '—'.
 */
export function normalizarCostoAdministrativoHistorico(r: CostoAdministrativoRowHistorico): Required<Pick<CostoAdministrativoRowHistorico,
  'id' | 'concepto' | 'tipoCalculo' | 'valorMensual'
>> & CostoAdministrativoRowHistorico {
  const tipoCalculo = r.tipoCalculo ?? 'VALOR_FIJO';
  const valorFijo = tipoCalculo === 'VALOR_FIJO' ? (r.valorFijo ?? r.valorMensual ?? 0) : r.valorFijo;
  const valorMensual = typeof r.valorMensual === 'number' ? r.valorMensual : calcularCostoAdministrativo({
    tipoCalculo, valorFijo, porcentaje: r.porcentaje, baseCalculo: r.baseCalculo,
    baseManoObra: 0, baseCostoDirecto: 0,
  });
  return {
    ...r,
    id: r.id ?? 0,
    concepto: r.concepto ?? '—',
    tipoCalculo,
    valorFijo,
    valorMensual,
  };
}

/**
 * Ajuste "ESTRUCTURA DEFINITIVA DE COSTOS ADMINISTRATIVOS" — extiende el
 * módulo con Pólizas, Impuestos, Variables administrativas y el consolidado
 * final. El modelo anterior (`adminRows` VALOR_FIJO/PORCENTAJE de arriba) se
 * conserva solo para migrar costeos históricos hacia Variables
 * Administrativas — nunca para capturar datos nuevos.
 */

// ─── Pólizas ─────────────────────────────────────────────────────────────

/**
 * Ajuste "CORREGIR EL CÁLCULO DE PÓLIZAS PARA REPLICAR EXACTAMENTE LA
 * LÓGICA DEL EXCEL" + "AJUSTAR LA TERMINOLOGÍA Y LA PRESENTACIÓN DE
 * VIGENCIAS" — el modelo anterior sumaba el VALOR AMPARADO
 * (valorOferta×porcentaje/100) como si fuera el costo de la póliza. El
 * costo real exige además la TASA que cobra la aseguradora sobre ese valor
 * amparado y la VIGENCIA TOTAL de la cobertura:
 *
 *   valorAmparado    = valorOferta × porcentajeAmparo / 100
 *   factorVigencia   = vigenciaMeses / 12
 *   costoTotalPoliza = valorAmparado × tasaPoliza / 100 × factorVigencia
 *
 * `vigenciaMeses` es SIEMPRE la vigencia TOTAL ya usada en el cálculo (13,
 * 48, 36...) — nunca un número al que se le suma un mes por dentro. Un
 * ajuste anterior sumaba +1 internamente (factorVigencia=(vigencia+1)/12)
 * mientras la UI mostraba el número "digitado" sin ese mes; eso quedó
 * eliminado — ver `migrarFilasPolizasVigenciaTotal` para la migración
 * ÚNICA (guardada con un flag) de los registros que aún guardan el número
 * previo a la suma.
 *
 * `tasaPoliza` se captura como decimal-porcentual (0.2 significa "0,2 %",
 * NUNCA "20 %"). La mensualización deja de prorratearse por fila (no hay
 * "factorMensualPonderado"): ahora es una única división al final,
 * `totalPolizas / numeroMesesContrato` — un campo GLOBAL nuevo, distinto de
 * `vigenciaMeses` (que sigue siendo la vigencia del amparo, por fila).
 */

export const PORCENTAJE_IVA_POLIZAS_DEFECTO = 19;
export const VIGENCIA_MESES_POLIZA_DEFECTO = 12;
export const NUMERO_MESES_CONTRATO_POLIZAS_DEFECTO = 12;

export interface PolizaRow {
  id: number;
  concepto: string;
  activo: boolean;
  /** Porcentaje del amparo — qué parte del valor de oferta queda cubierta (NUNCA el costo). */
  porcentaje: number;
  /** Vigencia TOTAL de la cobertura, en meses — el número REAL usado en factorVigencia=vigenciaMeses/12 (nunca un número al que se le suma un mes internamente). Distinta de numeroMesesContrato (global). */
  vigenciaMeses: number;
  /**
   * Tasa que cobra la aseguradora sobre el valor amparado, en decimal-
   * porcentual (0.2 = "0,2 %", nunca 20%). `undefined`/0 = fila incompleta
   * (nunca se asume una tasa por defecto — ver normalizarPolizaRow).
   */
  tasaPoliza?: number;
  /** true en las 9 filas iniciales — nunca pueden eliminarse, solo desactivarse. */
  esInicial?: boolean;
  /**
   * Únicamente aplica al amparo de Responsabilidad civil extracontractual
   * (id=4, ver `ID_POLIZA_RESPONSABILIDAD_CIVIL`) — cuántos SMLMV componen
   * su base (`baseAmparo = salarioMinimoVigente × cantidadSMLMV`). Ignorado
   * por el resto de los amparos (su base sigue siendo `valorOferta`).
   * `undefined`/0 se normaliza a 1 (ver `normalizarPolizaRow`) — nunca 0
   * SMLMV de base. Ignorado también cuando `tipoBaseRC==='VALOR_SERVICIO'`
   * (ver abajo) — se conserva en memoria para no perder el dato al
   * alternar, pero el cálculo no lo usa en esa modalidad.
   */
  cantidadSMLMV?: number;
  /**
   * Ajuste "PÓLIZA RC CON BASE SMMLV O VALOR DEL SERVICIO" — únicamente
   * aplica a Responsabilidad civil extracontractual (id=4). Discriminador
   * de la base de liquidación:
   *  - 'SMMLV' (histórico, también el DEFECTO cuando el campo está
   *    ausente — nunca una migración destructiva) → mantiene EXACTAMENTE
   *    la fórmula ya vigente: `baseAmparo = salarioMinimoVigente ×
   *    cantidadSMLMV`, luego `valorAmparado = baseAmparo × porcentaje/100`
   *    (ver `calcularFilaPoliza`) — sin cambios.
   *  - 'VALOR_SERVICIO' → RC deja de forzar su base especial y reutiliza
   *    la MISMA fórmula genérica que ya usan todos los demás amparos
   *    (`baseAmparo = valorOferta`), donde `porcentaje` pasa a
   *    representar "% del valor del servicio" — nunca una tercera fórmula
   *    paralela ni una reinterpretación de `cantidadSMLMV` como
   *    porcentaje (son campos siempre distintos).
   * Ignorado por completo en cualquier fila con id≠4.
   */
  tipoBaseRC?: TipoBaseResponsabilidadCivil;
}

/** Ver `PolizaRow.tipoBaseRC`. */
export type TipoBaseResponsabilidadCivil = 'SMMLV' | 'VALOR_SERVICIO';

/**
 * Fuente ÚNICA para resolver la base de liquidación efectiva de RC —
 * reutilizada tanto por `calcularFilaPoliza` (cálculo) como por la UI en
 * `page.tsx` (qué controles mostrar: Cantidad SMMLV vs % del valor del
 * servicio), para que el cálculo y lo que el usuario ve nunca puedan
 * divergir. Cualquier valor ausente o distinto de 'VALOR_SERVICIO' — incluye
 * TODO registro histórico, que nunca tuvo este campo — resuelve a 'SMMLV'.
 */
export function resolverTipoBaseRC(fila: { tipoBaseRC?: string }): TipoBaseResponsabilidadCivil {
  return fila.tipoBaseRC === 'VALOR_SERVICIO' ? 'VALOR_SERVICIO' : 'SMMLV';
}

/**
 * Ajuste "AJUSTAR LOS NOMBRES PREDETERMINADOS DEL MÓDULO DE PÓLIZAS" — 9
 * conceptos (antes 5), alineados con las garantías/amparos contractuales
 * reales de un pliego. Solo los primeros 4 arrancan activos (los que
 * prácticamente siempre exige un pliego); el resto queda disponible pero
 * inactivo — nunca se elimina una fila inicial al desactivarla, solo deja
 * de sumar en los totales (§ calcularPolizas).
 */
export function filasPolizasIniciales(): PolizaRow[] {
  const fila = (id: number, concepto: string, activo: boolean): PolizaRow => (
    // tasaPoliza arranca SIN definir (0) — nunca se asume una tasa; el
    // usuario debe diligenciarla con el dato real de la aseguradora.
    // Ajuste "POR DEFECTO QUE SALGA ACTIVA VALOR DE LA OFERTA" (feedback en
    // vivo) — SOLO afecta filas NUEVAS (un costeo que arranca desde cero,
    // nunca uno ya guardado): tipoBaseRC:'VALOR_SERVICIO' aquí. La
    // retrocompatibilidad histórica (registro YA guardado sin este campo →
    // 'SMMLV') vive exclusivamente en `resolverTipoBaseRC`/
    // `normalizarPolizaRow`, que NO cambian — ambos casos son rutas
    // completamente distintas, nunca se mezclan.
    { id, concepto, activo, porcentaje: 0, vigenciaMeses: VIGENCIA_MESES_POLIZA_DEFECTO, tasaPoliza: 0, esInicial: true, cantidadSMLMV: 1, tipoBaseRC: 'VALOR_SERVICIO' }
  );
  return [
    fila(1, 'Cumplimiento del contrato', true),
    fila(2, 'Calidad del servicio', true),
    fila(3, 'Pago de salarios, prestaciones sociales e indemnizaciones laborales', true),
    fila(4, 'Responsabilidad civil extracontractual', true),
    fila(5, 'Buen manejo y correcta inversión del anticipo', false),
    fila(6, 'Devolución del pago anticipado', false),
    fila(7, 'Calidad y correcto funcionamiento de los bienes', false),
    fila(8, 'Estabilidad y calidad de la obra', false),
    fila(9, 'Otros amparos o garantías', false),
  ];
}

/**
 * Nombres predeterminados anteriores → nuevos, para costeos guardados antes
 * del ajuste "AJUSTAR LOS NOMBRES PREDETERMINADOS DEL MÓDULO DE PÓLIZAS".
 * Solo se remapea si el concepto guardado coincide EXACTAMENTE con uno de
 * los 5 nombres antiguos — un concepto ya editado por el usuario a otro
 * texto nunca se sobrescribe.
 */
const MAPA_CONCEPTOS_POLIZAS_HISTORICO: Record<string, string> = {
  'Cumplimiento': 'Cumplimiento del contrato',
  'Calidad': 'Calidad del servicio',
  'Prestaciones sociales': 'Pago de salarios, prestaciones sociales e indemnizaciones laborales',
  'Responsabilidad civil — R.C.': 'Responsabilidad civil extracontractual',
  'Otros': 'Otros amparos o garantías',
};

/**
 * Compatibilidad con costeos guardados antes de este ajuste. Reglas
 * explícitas (nunca se inventa un dato ausente):
 *  - `porcentaje` (histórico "valorTotal manual") se completa en 0 si falta.
 *  - `vigenciaMeses` se completa con el valor por defecto si falta.
 *  - `tasaPoliza` NUNCA se asume — si el registro no la tiene, queda
 *    ausente (0) y la fila queda "incompleta" (ver `completa` en
 *    `FilaPolizaCalculada`), nunca se le asigna una tasa por defecto.
 *  - el antiguo `valorTotal` (costo manual, o el valorTotal=valorAmparado
 *    del ajuste anterior) NUNCA se reutiliza como costoTotalPoliza — ese
 *    campo simplemente se descarta al normalizar.
 */
export interface PolizaRowHistorico {
  id?: number; concepto?: string; activo?: boolean;
  porcentaje?: number; vigenciaMeses?: number; tasaPoliza?: number;
  valorTotal?: number; esInicial?: boolean; cantidadSMLMV?: number;
  /** Ausente en TODO registro guardado antes de este ajuste — se normaliza a 'SMMLV' (ver `normalizarPolizaRow`), nunca a 'VALOR_SERVICIO'. */
  tipoBaseRC?: string;
}

export function normalizarPolizaRow(r: PolizaRowHistorico): PolizaRow {
  const conceptoGuardado = r.concepto ?? '';
  return {
    id: r.id ?? 0,
    concepto: MAPA_CONCEPTOS_POLIZAS_HISTORICO[conceptoGuardado] ?? conceptoGuardado,
    activo: r.activo ?? true,
    porcentaje: typeof r.porcentaje === 'number' ? r.porcentaje : 0,
    vigenciaMeses: typeof r.vigenciaMeses === 'number' ? r.vigenciaMeses : VIGENCIA_MESES_POLIZA_DEFECTO,
    tasaPoliza: typeof r.tasaPoliza === 'number' ? r.tasaPoliza : 0,
    esInicial: r.esInicial,
    // Registros guardados antes del ajuste "LA BASE PARA RC ES EL SALARIO
    // MÍNIMO..." no traen este campo — se normaliza a 1 SMLMV (nunca 0).
    cantidadSMLMV: typeof r.cantidadSMLMV === 'number' && r.cantidadSMLMV > 0 ? r.cantidadSMLMV : 1,
    // Ajuste "PÓLIZA RC CON BASE SMMLV O VALOR DEL SERVICIO" — TODO
    // registro guardado antes de este ajuste no trae `tipoBaseRC`: se
    // normaliza a 'SMMLV' (la única modalidad que existía), nunca a
    // 'VALOR_SERVICIO' — jamás se reinterpreta "100 SMLMV" como "100% del
    // valor del servicio".
    tipoBaseRC: resolverTipoBaseRC(r),
  };
}

/**
 * Ajuste "LA BASE PARA RC ES EL SALARIO MÍNIMO, NO LA OFERTA" — el amparo
 * "Responsabilidad civil extracontractual" (fila fija id=4, ver
 * `filasPolizasIniciales`) se calcula SIEMPRE sobre el SMLMV vigente, nunca
 * sobre el valor de la oferta — a diferencia de TODOS los demás amparos.
 * Se identifica por `id` (fijo, nunca por el texto del concepto — un
 * concepto ya renombrado por el usuario sigue siendo la misma fila/id).
 */
export const ID_POLIZA_RESPONSABILIDAD_CIVIL = 4;

export interface FilaPolizaCalculada extends PolizaRow {
  /** valorOferta × porcentajeAmparo/100 — SOLO la parte cubierta, nunca el costo. Para RC (id=4), la base es el SMLMV, no valorOferta. */
  valorAmparado: number;
  /** vigenciaMeses / 12 — SIN ninguna suma oculta; vigenciaMeses ya es la vigencia TOTAL. */
  factorVigencia: number;
  /** valorAmparado × tasaPoliza/100 × factorVigencia — el costo REAL de la póliza. */
  costoTotalPoliza: number;
  /** true si porcentaje>0, tasaPoliza>0 y vigenciaMeses>0 — false = "incompleta", costoTotalPoliza forzado a 0. */
  completa: boolean;
}

/**
 * Fórmula EXACTA del Excel (validada con el ejemplo real de Cumplimiento:
 * oferta $3.697.772.552 × 20% × 0,2% × 13/12 ≈ $1.602.368, con
 * vigenciaMeses=13 YA como vigencia total — nunca 12+1 calculado aquí):
 *
 *   valorAmparado    = valorOferta × porcentaje / 100
 *   factorVigencia   = vigenciaMeses / 12
 *   costoTotalPoliza = valorAmparado × tasaPoliza / 100 × factorVigencia
 *
 * Si la fila está incompleta (porcentaje/tasaPoliza/vigenciaMeses faltante
 * o ≤0), costoTotalPoliza se fuerza a 0 — nunca NaN/Infinity — y
 * `completa` queda en false para que la UI lo señale, sin presentar ese
 * cálculo como confirmado.
 *
 * Ajuste "PÓLIZA RC CON BASE SMMLV O VALOR DEL SERVICIO" — RC (id=4) ahora
 * puede liquidarse sobre DOS bases distintas, seleccionadas por
 * `fila.tipoBaseRC` (ver `PolizaRow`):
 *  - 'SMMLV' (histórico/DEFECTO, ausente→'SMMLV') → EXACTAMENTE la misma
 *    rama que existía antes de este ajuste, sin ningún cambio de fórmula:
 *    `baseAmparo = salarioMinimoVigente × cantidadSMLMV`.
 *  - 'VALOR_SERVICIO' → RC deja de forzar su base especial: cae en la
 *    MISMA rama genérica que ya usan todos los demás amparos
 *    (`baseAmparo = valorOferta`), sin duplicar la fórmula — `porcentaje`
 *    pasa a representar "% del valor del servicio" para esta fila.
 */
export function calcularFilaPoliza(fila: PolizaRow, valorOferta: number, salarioMinimoVigente?: number): FilaPolizaCalculada {
  const esResponsabilidadCivil = fila.id === ID_POLIZA_RESPONSABILIDAD_CIVIL;
  const cantidadSMLMV = typeof fila.cantidadSMLMV === 'number' && fila.cantidadSMLMV > 0 ? fila.cantidadSMLMV : 1;
  const usaBaseSMMLV = esResponsabilidadCivil && resolverTipoBaseRC(fila) === 'SMMLV' && typeof salarioMinimoVigente === 'number' && salarioMinimoVigente > 0;
  const baseAmparo = usaBaseSMMLV ? salarioMinimoVigente * cantidadSMLMV : valorOferta;
  const valorAmparado = (baseAmparo || 0) * (fila.porcentaje || 0) / 100;
  const vigenciaValida = Number.isFinite(fila.vigenciaMeses) && fila.vigenciaMeses > 0;
  const factorVigencia = vigenciaValida ? fila.vigenciaMeses / 12 : 0;
  const tasaValida = typeof fila.tasaPoliza === 'number' && fila.tasaPoliza > 0;
  const porcentajeValido = (fila.porcentaje || 0) > 0;
  const completa = porcentajeValido && tasaValida && vigenciaValida;
  const costoTotalPoliza = completa ? valorAmparado * ((fila.tasaPoliza || 0) / 100) * factorVigencia : 0;
  return { ...fila, valorAmparado, factorVigencia, costoTotalPoliza, completa };
}

/**
 * Ajuste "AJUSTAR LA TERMINOLOGÍA Y LA PRESENTACIÓN DE VIGENCIAS" §6 —
 * migración ÚNICA para costeos guardados ANTES de este ajuste, cuando
 * `vigenciaMeses` todavía representaba "el número digitado antes de sumar
 * un mes" (12, 47, 35...) porque `calcularFilaPoliza` sumaba ese mes por
 * dentro. Se suma +1 UNA sola vez — nunca dos — y solo si el propio
 * payload NO trae ya el flag `vigenciaTotalMigrada` en true (ver
 * `polizasConfig` en page.tsx, que persiste ese flag desde el primer
 * guardado posterior a esta migración).
 */
export function migrarFilasPolizasVigenciaTotal(filas: PolizaRow[], vigenciaTotalMigrada: boolean): PolizaRow[] {
  if (vigenciaTotalMigrada) return filas;
  return filas.map((f) => ({ ...f, vigenciaMeses: f.vigenciaMeses + 1 }));
}

export interface ConfiguracionPolizas {
  filas: PolizaRow[];
  /** Valor de la oferta — base única de cálculo del valor amparado de cada fila. */
  valorBase: number;
  /** "OTROS" del bloque de pólizas — distinto de la fila "Otros" de la tabla. */
  otros: number;
  porcentajeIva: number;
  /**
   * Número de meses del CONTRATO (global) — distinto de `vigenciaMeses`
   * (por fila, vigencia del amparo). Se usa EXCLUSIVAMENTE para
   * mensualizar el total ya construido, nunca para dividir cada amparo
   * antes de sumarlo (eso sería mensualizar dos veces).
   */
  numeroMesesContrato: number;
  /**
   * SMLMV vigente — base EXCLUSIVA del amparo "Responsabilidad civil
   * extracontractual" (id=4). Si se omite o es ≤0, esa fila cae de vuelta
   * a `valorBase` (compatibilidad con costeos que aún no lo envían) — ver
   * `calcularFilaPoliza`.
   */
  salarioMinimoVigente?: number;
}

export interface ResultadoPolizas {
  filasCalculadas: FilaPolizaCalculada[];
  /** Suma de costoTotalPoliza de las filas ACTIVAS — nunca de valorAmparado. */
  subtotalPolizas: number;
  subtotalConOtros: number;
  iva: number;
  total: number;
  /** total / numeroMesesContrato — única división final, nunca por fila. */
  valorMensual: number;
  /** true si alguna fila ACTIVA está incompleta (falta %, tasa o vigencia válida). */
  hayFilasIncompletas: boolean;
}

/** Número de meses debe ser mayor que cero — nunca se divide por 0/negativo. Usado por Impuestos y por numeroMesesContrato de Pólizas. */
export function validarNumeroMeses(numeroMeses: number): boolean {
  return Number.isFinite(numeroMeses) && numeroMeses > 0;
}

export function calcularPolizas(cfg: ConfiguracionPolizas): ResultadoPolizas {
  const filasCalculadas = cfg.filas.map((f) => calcularFilaPoliza(f, cfg.valorBase, cfg.salarioMinimoVigente));
  const activas = filasCalculadas.filter((f) => f.activo);
  const subtotalPolizas = activas.reduce((s, f) => s + f.costoTotalPoliza, 0);
  const otros = cfg.otros || 0;
  const subtotalConOtros = subtotalPolizas + otros;
  const iva = (subtotalConOtros * (cfg.porcentajeIva || 0)) / 100;
  const total = subtotalConOtros + iva;
  const valorMensual = validarNumeroMeses(cfg.numeroMesesContrato) ? total / cfg.numeroMesesContrato : 0;
  const hayFilasIncompletas = activas.some((f) => !f.completa);
  return { filasCalculadas, subtotalPolizas, subtotalConOtros, iva, total, valorMensual, hayFilasIncompletas };
}

// ─── Impuestos ───────────────────────────────────────────────────────────

export const NUMERO_MESES_IMPUESTOS_DEFECTO = 12;

export type TipoCalculoImpuesto = 'FIJO' | 'PORCENTAJE';
export type BaseImpuesto = 'COSTO_DIRECTO' | 'MANO_OBRA' | 'VALOR_CONTRACTUAL' | 'SUBTOTAL_SELECCIONADO' | 'VALOR_MANUAL';

export interface ImpuestoRow {
  id: number;
  concepto: string;
  tipoCalculo: TipoCalculoImpuesto;
  porcentaje?: number;
  baseSeleccionada?: BaseImpuesto;
  baseManual?: number;
  valorFijo?: number;
  /** Ajuste "TOGGLE AUTOMÁTICO POR TARIFA, SIN SOBRESCRIBIR OVERRIDE
   * MANUAL" — `undefined`/`null` significa "sin decisión explícita del
   * usuario" (nunca equivale a `false`): en ese caso el valor EFECTIVO se
   * deriva de la tarifa vía `resolverAplicaImpuesto` (0% → no aplica, >0%
   * → aplica). `true`/`false` explícitos son SIEMPRE una decisión válida
   * del usuario y se respetan indefinidamente, sin importar cambios
   * posteriores en `porcentaje`. */
  activo?: boolean | null;
  observacion?: string;
}

/**
 * Valor EFECTIVO de "aplica"/"no aplica" para una fila de impuesto —
 * ÚNICA fuente de verdad, reutilizada por el cálculo (`calcularValorImpuesto`)
 * y por la UI del toggle (nunca dos criterios distintos).
 * Prioridad: (1) decisión explícita guardada (`activo===true|false`);
 * (2) si no existe decisión — `undefined`/`null`, incluye estructuras
 * antiguas sin el campo — se deriva de la tarifa: PORCENTAJE>0 → aplica;
 * PORCENTAJE=0 → no aplica; FIJO conserva el comportamiento histórico
 * (siempre aplica por defecto, no tiene tarifa que evaluar).
 */
export function resolverAplicaImpuesto(row: Pick<ImpuestoRow, 'activo' | 'tipoCalculo' | 'porcentaje'>): boolean {
  if (typeof row.activo === 'boolean') return row.activo;
  if (row.tipoCalculo === 'PORCENTAJE') return (row.porcentaje ?? 0) > 0;
  return true;
}

/**
 * Ajuste "AJUSTAR IMPUESTOS PARA UTILIZAR LA MATRIZ ICA POR EMPRESA Y
 * MUNICIPIO" — ICA/Avisos y tableros/Sobretasa bomberil dejan de ser filas
 * manuales (se calculan SIEMPRE desde la matriz real, ver
 * `calcularImpuestosMatrizIca`); las filas iniciales quedan solo con los
 * impuestos que de verdad se digitan a mano. Ajuste "QUITAR ESO DEL CREE"
 * (feedback en vivo) — CREE se retira por completo de las filas
 * predeterminadas (el usuario puede agregarlo manualmente vía "Agregar
 * impuesto adicional" si alguna vez aplica). Estampillas arranca ACTIVA
 * (se muestra siempre, en $0 hasta que se configure) con PORCENTAJE sobre
 * VALOR_CONTRACTUAL — única fórmula que el Excel define para ella
 * (valorOferta × %).
 */
export function filasImpuestosIniciales(): ImpuestoRow[] {
  return [
    // `activo` se omite a propósito (sin decisión explícita todavía): con
    // porcentaje=0 el valor EFECTIVO por defecto es "no aplica"
    // (`resolverAplicaImpuesto`) — nunca `true` fijo como antes.
    { id: 5, concepto: 'Estampillas', tipoCalculo: 'PORCENTAJE', porcentaje: 0, baseSeleccionada: 'VALOR_CONTRACTUAL' },
  ];
}

/**
 * Costeos guardados ANTES de este ajuste tienen ICA/Avisos y
 * tableros/Sobretasa bomberil como filas manuales de `impuestosFilas` — se
 * descartan al hidratar (ahora se calculan siempre desde la matriz) SOLO si
 * el concepto coincide EXACTAMENTE con uno de los nombres por defecto;
 * un concepto que el usuario ya editó a otro texto nunca se descarta.
 * Ajuste "QUITA EL CREE" (feedback en vivo) — CREE también se retira de
 * costeos ya guardados que aún lo traían como fila fija (dejó de existir
 * en `filasImpuestosIniciales`); si el usuario alguna vez lo necesita, lo
 * agrega de nuevo vía "Agregar impuesto adicional".
 */
const CONCEPTOS_IMPUESTOS_MIGRADOS_A_MATRIZ_ICA = new Set(['ICA', 'Avisos y tableros', 'Sobretasa bomberil', 'CREE']);
export function migrarFilasImpuestosAMatrizIca(filas: ImpuestoRow[]): ImpuestoRow[] {
  return filas.filter((f) => !CONCEPTOS_IMPUESTOS_MIGRADOS_A_MATRIZ_ICA.has((f.concepto ?? '').trim()));
}

/**
 * Bases disponibles para impuestos PORCENTAJE — nunca se asume que todos los
 * impuestos comparten la misma base (cada fila elige la suya).
 * `subtotalSeleccionado` es un valor único configurado a nivel del bloque de
 * Impuestos (no por fila) que representa "el subtotal que el usuario decidió
 * usar como base" cuando ninguna de las otras 4 bases aplica.
 */
export interface BasesImpuesto {
  costoDirecto: number;
  manoObra: number;
  valorContractual: number;
  subtotalSeleccionado: number;
}

function resolverBaseImpuesto(row: ImpuestoRow, bases: BasesImpuesto): number {
  switch (row.baseSeleccionada) {
    case 'MANO_OBRA': return bases.manoObra;
    case 'VALOR_CONTRACTUAL': return bases.valorContractual;
    case 'SUBTOTAL_SELECCIONADO': return bases.subtotalSeleccionado;
    case 'VALOR_MANUAL': return row.baseManual ?? 0;
    case 'COSTO_DIRECTO':
    default: return bases.costoDirecto;
  }
}

/** FIJO conserva el valor escrito; PORCENTAJE = base × porcentaje / 100. */
/** Ajuste "LAS ESTAMPILLAS DEBEN TENER ESE BOTÓN DE APLICAR O NO" — una fila inactiva totaliza SIEMPRE 0 (mismo criterio que `calcularValorMensualVariable`), no solo se excluye de la suma. */
export function calcularValorImpuesto(row: ImpuestoRow, bases: BasesImpuesto): number {
  if (!resolverAplicaImpuesto(row)) return 0;
  if (row.tipoCalculo === 'FIJO') return row.valorFijo ?? 0;
  return (resolverBaseImpuesto(row, bases) * (row.porcentaje ?? 0)) / 100;
}

export function calcularTotalImpuestos(rows: ImpuestoRow[], bases: BasesImpuesto): number {
  return rows.filter((r) => resolverAplicaImpuesto(r)).reduce((s, r) => s + calcularValorImpuesto(r, bases), 0);
}

export function calcularValorMensualImpuestos(totalImpuestos: number, numeroMeses: number): number {
  const mesesValidos = validarNumeroMeses(numeroMeses) ? numeroMeses : 1;
  return totalImpuestos / mesesValidos;
}

// ─── Matriz ICA por empresa y municipio ─────────────────────────────────

/**
 * Ajuste "AJUSTAR IMPUESTOS PARA UTILIZAR LA MATRIZ ICA POR EMPRESA Y
 * MUNICIPIO" — reemplaza la tarifa de ICA/Avisos/Bomberil escrita a mano por
 * una consulta a la matriz real del pliego/aseguradora, importada UNA vez
 * desde el Excel fuente hacia un JSON versionado (ver
 * `scripts/importar-matriz-ica.ts`) — nunca se lee el .xlsx en cada request.
 */
export type EmpresaIca = 'ASEOCOLBA' | 'TEMPOCOLBA' | 'VIGICOLBA' | 'TRANSCOLBA';
export type PeriodicidadImpuesto = 'MENSUAL' | 'BIMESTRAL' | 'ANUAL';

/**
 * Ajuste "AJUSTAR LA VISTA SIMPLE DE IMPUESTOS..." (feedback en vivo,
 * captura del Excel real: `=B3*10%*I31`) — el % de base gravable NO es un
 * dato que el usuario digite por contrato: en el Excel viene HARDCODEADO
 * dentro de la fórmula misma, siempre 10 %. Por eso es una constante
 * INTERNA (nunca un campo editable en la UI ni un valor persistido aparte).
 */
export const PORCENTAJE_BASE_GRAVABLE_ICA = 10;

export interface TarifaIcaMunicipio {
  id: string;
  empresa: EmpresaIca;
  /** String SIEMPRE — preserva ceros a la izquierda (ej. "08001"). Ausente en la mayoría de registros del Excel (ver diagnóstico). */
  codigoDane?: string;
  /** Texto original del Excel — SIEMPRE se muestra este, nunca el normalizado. */
  municipio: string;
  /** Núcleo del nombre (sin tildes, sin lo que va entre paréntesis) — SOLO para búsqueda, nunca para mostrar. */
  municipioNormalizado: string;
  /** Informativa ÚNICAMENTE — nunca se usa para dividir el total (eso lo hace exclusivamente la duración del contrato). */
  periodicidad: PeriodicidadImpuesto;
  /** Decimal-porcentual (0.00966 = "0,966 %"). */
  tarifaIca: number;
  tarifaAvisos: number;
  tarifaBomberil: number;
  /** Observación tal cual viene del Excel (ej. tarifas diferenciadas por actividad) — nunca se resume ni se omite si existe. */
  observacion?: string;
  /** true = valor atípico o con matices no capturables en un solo número (ver diagnóstico); la UI debe advertir antes de usarlo. */
  requiereValidacion?: boolean;
}

/**
 * Clave de búsqueda = núcleo del nombre del municipio, sin tildes, sin
 * departamento entre paréntesis y sin espacios duplicados. El truncamiento
 * real detectado en el Excel (ej. "BARRANQUILLA  (DEIP) (Atlantic" cortado
 * antes de "o)") SIEMPRE ocurre dentro o después del primer paréntesis —
 * jamás en el nombre del municipio mismo — por eso basta tomar el texto
 * anterior al primer "(" para obtener una clave estable entre bloques.
 */
export function normalizarMunicipio(texto: string): string {
  const sinTildes = (texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
  const nucleo = sinTildes.split('(')[0] ?? '';
  return nucleo.replace(/\s+/g, ' ').trim();
}

/** Nunca se busca por DANE solo — la mayoría de registros no lo tienen; la clave siempre es empresa + municipio normalizado. */
export function buscarTarifaIca(
  registros: TarifaIcaMunicipio[],
  empresa: EmpresaIca,
  municipio: string,
): TarifaIcaMunicipio | undefined {
  const clave = normalizarMunicipio(municipio);
  return registros.find((r) => r.empresa === empresa && r.municipioNormalizado === clave);
}

export function municipiosPorEmpresa(registros: TarifaIcaMunicipio[], empresa: EmpresaIca): TarifaIcaMunicipio[] {
  return registros.filter((r) => r.empresa === empresa);
}

/**
 * Formato humano de un decimal-porcentual: 0,00966 → "0,966 %" (nunca
 * "0,00966 %"); 0,15 → "15 %"; 0,03 → "3 %". Redondea a 3 decimales y
 * elimina ceros sobrantes — nunca cambia el valor decimal almacenado.
 */
export function formatearPorcentajeDecimal(valorDecimal: number): string {
  const porcentaje = (valorDecimal || 0) * 100;
  const redondeado = Math.round(porcentaje * 1000) / 1000;
  return `${redondeado.toString().replace('.', ',')} %`;
}

export interface EntradaImpuestoMatrizIca {
  /** Reutiliza SIEMPRE `polizasValorBase` ("Valor de la oferta") — nunca un segundo valor manual independiente. */
  valorContractual: number;
  /** Manual, ej. 10 = "10 %" — nunca se infiere de la matriz. */
  porcentajeBaseGravable: number;
  tarifaIca: number;
  tarifaAvisos: number;
  tarifaBomberil: number;
  /** Sí/No explícito — Avisos y Tableros solo aplica si hay establecimiento comercial con aviso del logo corporativo (ver observación del Excel). */
  aplicaAvisos: boolean;
}

export interface ResultadoImpuestoMatrizIca {
  baseGravable: number;
  /** baseGravable × tarifaIca. */
  valorIca: number;
  /** valorIca × tarifaAvisos (NUNCA sobre baseGravable/valorContractual) — solo si aplicaAvisos. */
  valorAvisos: number;
  /** valorIca × tarifaBomberil (NUNCA sobre baseGravable/valorContractual). */
  valorBomberil: number;
  totalMatrizIca: number;
}

/**
 * Fórmula CANÓNICA (validada con el ejemplo real de Bogotá/ASEOCOLBA: oferta
 * $3.697.772.552 × 10% → base gravable $369.777.255,20; ICA 0,966% ≈
 * $3.572.048; Avisos 15% DE ESE VALOR DE ICA ≈ $535.807; Bomberil 0% → $0):
 *
 *   baseGravable = valorContractual × porcentajeBaseGravable / 100
 *   valorIca     = baseGravable × tarifaIca
 *   valorAvisos  = aplicaAvisos ? valorIca × tarifaAvisos : 0
 *   valorBomberil= valorIca × tarifaBomberil
 *
 * Avisos y Bomberil se calculan SOBRE EL VALOR DE ICA, nunca sobre la base
 * gravable ni sobre el valor contractual — error económico explícitamente
 * señalado y corregido en este ajuste.
 */
/**
 * Valor EFECTIVO de "Aplica"/"No aplica" para Avisos y Tableros — misma
 * doctrina que `resolverAplicaImpuesto`: prioridad a la decisión explícita
 * guardada (`true`/`false`, incluye `false` — nunca se confunde con "sin
 * configurar"); si no existe decisión (`undefined`/`null`, incluye
 * estructuras antiguas) se deriva de `tarifaAvisos` (>0 → aplica, =0 → no
 * aplica). Nunca se sobrescribe una decisión ya tomada por un cambio
 * posterior de empresa/municipio (y por tanto de tarifa).
 */
export function resolverAplicaAvisos(aplicaAvisosGuardado: boolean | null | undefined, tarifaAvisos: number): boolean {
  if (typeof aplicaAvisosGuardado === 'boolean') return aplicaAvisosGuardado;
  return (tarifaAvisos ?? 0) > 0;
}

/**
 * Migración ÚNICA "TOGGLE AUTOMÁTICO POR TARIFA" (confirmada explícitamente
 * por el usuario) — costeos guardados ANTES de este ajuste siempre tenían
 * `activo` como boolean concreto (el campo era obligatorio, nunca
 * `undefined`): un `false` de esa época es AMBIGUO (pudo ser una decisión
 * real del usuario o simplemente el default viejo nunca tocado). Se trata
 * como "sin decisión" para que la tarifa mande — un `true` viejo SÍ se
 * conserva (bajo el modelo anterior solo se llegaba a `true` por acción
 * del usuario o por el default de Estampillas, nunca representa "no
 * aplica"). Nunca se aplica si el payload ya pasó por el modelo nuevo
 * (`yaMigrado`), donde un `false` SIEMPRE es una decisión real que debe
 * respetarse para siempre.
 */
export function migrarActivoImpuestosPorTarifa(filas: ImpuestoRow[], yaMigrado: boolean): ImpuestoRow[] {
  if (yaMigrado) return filas;
  return filas.map((f) => (f.activo === false ? { ...f, activo: undefined } : f));
}

/** Misma migración que `migrarActivoImpuestosPorTarifa`, para el flag único de Avisos y Tableros. */
export function migrarAplicaAvisosPorTarifa(aplicaAvisosGuardado: boolean | undefined, yaMigrado: boolean): boolean | undefined {
  if (yaMigrado) return aplicaAvisosGuardado;
  return aplicaAvisosGuardado === false ? undefined : aplicaAvisosGuardado;
}

export function calcularImpuestosMatrizIca(entrada: EntradaImpuestoMatrizIca): ResultadoImpuestoMatrizIca {
  const baseGravable = (entrada.valorContractual || 0) * (entrada.porcentajeBaseGravable || 0) / 100;
  const valorIca = baseGravable * (entrada.tarifaIca || 0);
  const valorAvisos = entrada.aplicaAvisos ? valorIca * (entrada.tarifaAvisos || 0) : 0;
  const valorBomberil = valorIca * (entrada.tarifaBomberil || 0);
  const totalMatrizIca = valorIca + valorAvisos + valorBomberil;
  return { baseGravable, valorIca, valorAvisos, valorBomberil, totalMatrizIca };
}

// ─── Variables administrativas ──────────────────────────────────────────

export type TipoPeriodicidadVariable = 'MENSUAL' | 'UNICO' | 'TOTAL_CONTRATO' | 'CADA_N_MESES';

/**
 * Ajuste "IMPLEMENTAR EL BLOQUE DE COSTOS ADMINISTRATIVOS CON EL MISMO
 * PATRÓN VISUAL Y FUNCIONAL DE PÓLIZAS CONTRACTUALES" + "AJUSTAR OTROS
 * COSTOS ADMINISTRATIVOS: CANTIDAD AUTOMÁTICA, PAPELERÍA Y FRECUENCIA"
 * (confirmado explícitamente) — origen de la cantidad de una fila:
 *  - 'AUTOMATICA_MANO_OBRA': se recalcula SIEMPRE con `cantidadTrabajadoresServicio`
 *    (headcount físico real de Mano de Obra: cargos principales + turnantes
 *    físicos, NUNCA líneas técnicas/fichas de referencia) — read-only en la
 *    UI, el usuario nunca puede modificarla a mano.
 *  - 'COSTO_FIJO': cantidad SIEMPRE 1 (bloqueada, read-only) — un costo del
 *    contrato que NUNCA se multiplica por trabajadores sin una regla
 *    expresa (ej. desarrollo de un portal/tablero).
 *  - 'MANUAL' ("Cantidad manual" en UI): el usuario la edita libremente —
 *    valor por defecto histórico (ausente/'MANUAL' = digitada por el
 *    usuario), se conserva el string 'MANUAL' tal cual para no romper
 *    compatibilidad con estructuras ya guardadas.
 */
export type CantidadOrigenVariable = 'AUTOMATICA_MANO_OBRA' | 'MANUAL' | 'COSTO_FIJO';

export interface VariableAdministrativaRow {
  id: number;
  categoria: string;
  concepto: string;
  cantidad: number;
  valorUnitario: number;
  tipoPeriodicidad: TipoPeriodicidadVariable;
  /** Requerido para UNICO/TOTAL_CONTRATO. */
  numeroMesesContrato?: number;
  /** Requerido para CADA_N_MESES. */
  frecuenciaMeses?: number;
  observacion?: string;
  activo: boolean;
  /** Solo para filas de transporte por ciudad/sede — opcional. */
  ciudad?: string;
  sede?: string;
  /** true en los 11 conceptos predeterminados — nunca pueden eliminarse, solo desactivarse (mismo patrón que PolizaRow.esInicial). */
  esInicial?: boolean;
  /** Ausente/'MANUAL' = cantidad digitada por el usuario; 'AUTOMATICA_MANO_OBRA' = se sincroniza con el total de trabajadores del servicio. */
  cantidadOrigen?: CantidadOrigenVariable;
}

/** Ajuste "AJUSTAR OTROS COSTOS ADMINISTRATIVOS" §2 — único valor por
 * defecto no-cero de esta plantilla: solo se aplica al CREAR una fila
 * nueva de Papelería (estructura nunca guardada); una vez guardado, el
 * valor queda en manos del usuario para siempre (nunca se resetea a este
 * default, ni siquiera si el usuario lo deja en $0 explícito). */
export const VALOR_UNITARIO_PAPELERIA_POR_DEFECTO = 5000;

/**
 * Ajuste "PARAMETRIZAR CORRECTAMENTE OTROS COSTOS ADMINISTRATIVOS" §4/§5
 * (confirmado explícitamente) — la frecuencia deja de exponerse como un
 * <select> de periodicidades (Mensual/Bimestral/etc.): un ÚNICO campo
 * numérico `frecuenciaMeses` (entero ≥1) cubre todos los casos ("1" =
 * cada mes, "3" = cada 3 meses, etc.), reutilizando SIN cambios la rama
 * `CADA_N_MESES` ya existente de `calcularValorMensualVariable`
 * (`totalMensual = valorUnitario × cantidad / frecuenciaMeses`) — nunca
 * una segunda fórmula. `tipoPeriodicidad` sigue existiendo en el tipo
 * (compatibilidad con datos históricos que pudieran tener MENSUAL/UNICO/
 * TOTAL_CONTRATO), pero el catálogo/UI de "Otros costos administrativos"
 * ahora escribe SIEMPRE `'CADA_N_MESES'` — nunca los otros 3 valores.
 */
export function validarFrecuenciaMeses(n: number): boolean {
  return Number.isInteger(n) && n >= 1;
}

/** Metadata de UN concepto predeterminado — Ajuste "AJUSTAR OTROS COSTOS
 * ADMINISTRATIVOS" §10: fuente ÚNICA y centralizada, nunca condiciones
 * dispersas por nombre (`if(concepto==='Papelería')...`) repetidas en
 * cada lugar que necesite esta clasificación. */
export interface ConceptoAdministrativoCatalogo {
  concepto: string;
  tipoCantidad: CantidadOrigenVariable;
  valorUnitarioDefault: number;
  frecuenciaMesesDefault: number;
}

/**
 * Ajuste "IMPLEMENTAR EL BLOQUE DE COSTOS ADMINISTRATIVOS..." §3 +
 * "AJUSTAR OTROS COSTOS ADMINISTRATIVOS" §1-§11 (confirmado explícitamente,
 * con correcciones tras auditoría de negocio) — catálogo ÚNICO de los 9
 * conceptos predeterminados:
 *  - AUTOMATICA_MANO_OBRA (por trabajador, cantidad READ-ONLY): Papelería
 *    (elemento de oficina consumido por cada persona), Carnet (elemento
 *    individual entregado a cada trabajador), Capacitaciones (capacitación
 *    ADMINISTRATIVA/corporativa — confirmado explícitamente que es un
 *    concepto DISTINTO de "Cursos" de Mano de Obra, que ya cubre la
 *    capacitación operativa por cargo/turnante — nunca doble conteo).
 *  - MANUAL (cantidad editable por el usuario, NUNCA depende del
 *    headcount): Microsoft (licencias), Plan de datos (líneas/dispositivos),
 *    Kontrol ID (confirmado explícitamente: licencia/plataforma
 *    empresarial, no un elemento por persona), Mano de obra administrativa
 *    (corrección confirmada — puede ser 1, 2 o N coordinadores/auxiliares,
 *    NUNCA atado al headcount operativo), Transporte de insumos y
 *    Transporte de personal operativo (viajes/rutas/vehículos/servicios,
 *    no trabajadores).
 *  - COSTO_FIJO: ningún concepto predeterminado hoy cumple la condición
 *    real ("1 unidad del servicio/contrato, sin sentido que el usuario
 *    cambie la cantidad") — se reserva el valor en el tipo para conceptos
 *    futuros que sí la cumplan, nunca se usa "porque normalmente se
 *    compra una unidad" (Ajuste §11).
 * Riesgos de solapamiento auditados y descartados: Carnet/Capacitaciones
 * no se costean en ningún otro módulo (Dotación/EPP es equipo de
 * seguridad, no carnés/identificación); Transporte de insumos podría
 * solaparse conceptualmente con el transporte propio de Insumos si
 * alguna vez se modela ahí — hoy Insumos no tiene ese concepto, sin
 * riesgo actual.
 */
export const CATALOGO_VARIABLES_ADMINISTRATIVAS_INICIALES: ConceptoAdministrativoCatalogo[] = [
  { concepto: 'Papelería', tipoCantidad: 'AUTOMATICA_MANO_OBRA', valorUnitarioDefault: VALOR_UNITARIO_PAPELERIA_POR_DEFECTO, frecuenciaMesesDefault: 1 },
  { concepto: 'Microsoft', tipoCantidad: 'MANUAL', valorUnitarioDefault: 0, frecuenciaMesesDefault: 1 },
  { concepto: 'Plan de datos', tipoCantidad: 'MANUAL', valorUnitarioDefault: 0, frecuenciaMesesDefault: 1 },
  { concepto: 'Kontrol ID', tipoCantidad: 'MANUAL', valorUnitarioDefault: 0, frecuenciaMesesDefault: 1 },
  { concepto: 'Mano de obra administrativa', tipoCantidad: 'MANUAL', valorUnitarioDefault: 0, frecuenciaMesesDefault: 1 },
  { concepto: 'Transporte de insumos', tipoCantidad: 'MANUAL', valorUnitarioDefault: 0, frecuenciaMesesDefault: 1 },
  { concepto: 'Carnet', tipoCantidad: 'AUTOMATICA_MANO_OBRA', valorUnitarioDefault: 0, frecuenciaMesesDefault: 1 },
  { concepto: 'Capacitaciones', tipoCantidad: 'AUTOMATICA_MANO_OBRA', valorUnitarioDefault: 0, frecuenciaMesesDefault: 1 },
  { concepto: 'Transporte de personal operativo', tipoCantidad: 'MANUAL', valorUnitarioDefault: 0, frecuenciaMesesDefault: 1 },
];

export function conceptosVariablesAdministrativasIniciales(): VariableAdministrativaRow[] {
  return CATALOGO_VARIABLES_ADMINISTRATIVAS_INICIALES.map(({ concepto, tipoCantidad, valorUnitarioDefault, frecuenciaMesesDefault }, i) => ({
    id: i + 1, categoria: 'General', concepto,
    cantidad: tipoCantidad === 'AUTOMATICA_MANO_OBRA' ? 0 : 1,
    valorUnitario: valorUnitarioDefault,
    tipoPeriodicidad: 'CADA_N_MESES' as const,
    frecuenciaMeses: frecuenciaMesesDefault,
    activo: true, esInicial: true,
    cantidadOrigen: tipoCantidad,
  }));
}

/**
 * Ajuste "LA CANTIDAD NO DEBE PODER EDITARSE MANUALMENTE" (corrección de
 * seguimiento, confirmada al ver un registro YA guardado ANTES de este
 * ajuste) — filas guardadas antes de que `cantidadOrigen` existiera para
 * un concepto no tienen ese campo (`undefined`), así que quedaban
 * tratadas como 'MANUAL' aunque el concepto (ej. "Papelería") sí esté en
 * el catálogo como AUTOMATICA_MANO_OBRA. Esta migración SOLO completa
 * `cantidadOrigen` cuando está AUSENTE y el `concepto` coincide EXACTO
 * con el catálogo — nunca sobrescribe un `cantidadOrigen` ya explícito
 * (aunque sea 'MANUAL', una decisión real tomada después de este ajuste
 * se respeta siempre). Se aplica en cada carga — idempotente, nunca
 * inventa un valor distinto en cargas sucesivas.
 */
export function migrarCantidadOrigenPorCatalogo(filas: VariableAdministrativaRow[]): VariableAdministrativaRow[] {
  return filas.map((f) => {
    if (f.cantidadOrigen !== undefined) return f;
    const enCatalogo = CATALOGO_VARIABLES_ADMINISTRATIVAS_INICIALES.find((c) => c.concepto === f.concepto);
    return enCatalogo ? { ...f, cantidadOrigen: enCatalogo.tipoCantidad } : f;
  });
}

/**
 * Ajuste "PAPELERÍA DEBE MOSTRAR $5.000 POR DEFECTO" (corrección de
 * seguimiento) — mismo patrón que `migrarActivoImpuestosPorTarifa`: una
 * estructura guardada ANTES de este ajuste tiene Papelería en $0 porque
 * ese era el default viejo, nunca una decisión real del usuario. Se
 * corrige UNA sola vez (`yaMigrado=false`) — de ahí en adelante
 * (`yaMigrado=true`, ver `variablesAdministrativasDecisionesMigradas` en
 * page.tsx) un $0 explícito en Papelería SIEMPRE se respeta, sin excepción.
 */
export function migrarValorUnitarioPapeleria(filas: VariableAdministrativaRow[], yaMigrado: boolean): VariableAdministrativaRow[] {
  if (yaMigrado) return filas;
  return filas.map((f) => (
    f.concepto === 'Papelería' && f.valorUnitario === 0 ? { ...f, valorUnitario: VALOR_UNITARIO_PAPELERIA_POR_DEFECTO } : f
  ));
}

/**
 * cantidad y valorUnitario nunca negativos (se sanean antes de calcular).
 * Ajuste "IMPLEMENTAR EL BLOQUE DE COSTOS ADMINISTRATIVOS..." §7 — una fila
 * inactiva totaliza SIEMPRE 0, incluso si ya tiene cantidad/valorUnitario
 * cargados (nunca solo se excluye de la suma — el propio total por fila
 * debe leerse en $0 en la UI).
 *
 * Ajuste "LA CANTIDAD NO DEBE PODER EDITARSE MANUALMENTE" (confirmado
 * explícitamente) — para una fila `cantidadOrigen:'AUTOMATICA_MANO_OBRA'`,
 * `cantidadTrabajadoresServicio` (si se pasa) es SIEMPRE la fuente de
 * verdad, ignorando `row.cantidad` — nunca se persiste como un dato
 * independiente que pueda quedar desactualizado; se deriva de Mano de
 * Obra en cada cálculo/render. Si no se pasa (compatibilidad con
 * llamadas que aún no conocen el headcount), se usa `row.cantidad` tal
 * cual (mismo comportamiento que antes de este ajuste).
 */
export function calcularValorMensualVariable(row: VariableAdministrativaRow, cantidadTrabajadoresServicio?: number): number {
  if (!row.activo) return 0;
  const cantidadEfectiva = row.cantidadOrigen === 'AUTOMATICA_MANO_OBRA' && cantidadTrabajadoresServicio != null
    ? cantidadTrabajadoresServicio
    : row.cantidad;
  const cantidad = Math.max(0, cantidadEfectiva || 0);
  const valorUnitario = Math.max(0, row.valorUnitario || 0);
  const base = cantidad * valorUnitario;
  switch (row.tipoPeriodicidad) {
    case 'MENSUAL':
      return base;
    case 'UNICO':
    case 'TOTAL_CONTRATO': {
      const meses = row.numeroMesesContrato && row.numeroMesesContrato > 0 ? row.numeroMesesContrato : 1;
      return base / meses;
    }
    case 'CADA_N_MESES': {
      const frecuencia = row.frecuenciaMeses && row.frecuenciaMeses > 0 ? row.frecuenciaMeses : 1;
      return base / frecuencia;
    }
    default:
      return base;
  }
}

export function calcularTotalVariablesAdministrativas(rows: VariableAdministrativaRow[], cantidadTrabajadoresServicio?: number): number {
  return rows.filter((r) => r.activo).reduce((s, r) => s + calcularValorMensualVariable(r, cantidadTrabajadoresServicio), 0);
}

/**
 * Ajuste "IMPLEMENTAR EL BLOQUE DE COSTOS ADMINISTRATIVOS..." §14 +
 * "AJUSTAR OTROS COSTOS ADMINISTRATIVOS" §7/§8/§9 — la cantidad de una
 * fila con `cantidadOrigen:'AUTOMATICA_MANO_OBRA'` se sincroniza SIEMPRE
 * con `cantidadTrabajadoresServicio` (headcount físico real: cargos
 * principales + turnantes físicos, ya calculado por Mano de Obra — NUNCA
 * líneas técnicas/fichas de referencia); una fila `'COSTO_FIJO'` se fija
 * SIEMPRE en 1 (defensivo — el usuario nunca puede desviarla, aunque la
 * UI ya la bloquee); una fila `'MANUAL'` (o ausente = manual, filas
 * históricas/agregadas a mano) NUNCA se toca aquí — el usuario ya decidió
 * su propia cantidad. Se llama automáticamente cada vez que cambia el
 * headcount (ver `page.tsx`), sin exigir reabrir/guardar el módulo.
 */
export function sincronizarCantidadesAutomaticasVariables(
  filas: VariableAdministrativaRow[],
  cantidadTrabajadoresServicio: number,
): VariableAdministrativaRow[] {
  return filas.map((f) => {
    if (f.cantidadOrigen === 'AUTOMATICA_MANO_OBRA') return { ...f, cantidad: Math.max(0, cantidadTrabajadoresServicio || 0) };
    if (f.cantidadOrigen === 'COSTO_FIJO') return { ...f, cantidad: 1 };
    return f;
  });
}

// ─── Migración histórica (adminRows VALOR_FIJO/PORCENTAJE → variables) ──

/**
 * Costeos guardados ANTES de este ajuste tienen `adminRows` (VALOR_FIJO /
 * PORCENTAJE sobre Mano de Obra o Costo Directo) — se migran a Variables
 * Administrativas como filas MENSUAL de solo lectura de su valor ya
 * calculado, para no perder el dato histórico. PORCENTAJE se congela al
 * valor que tenía en el momento de la migración (se resuelve con las bases
 * vigentes en ese momento) — no se re-liga a una base porcentual nueva.
 */
export function migrarAdminRowsHistoricoAVariables(
  adminRows: CostoAdministrativoRowHistorico[],
  bases: { baseManoObra: number; baseCostoDirecto: number },
  siguienteId: () => number,
): VariableAdministrativaRow[] {
  return adminRows.map((r) => {
    const normalizado = normalizarCostoAdministrativoHistorico(r);
    const valorMensual = normalizado.tipoCalculo === 'PORCENTAJE'
      ? calcularCostoAdministrativo({
          tipoCalculo: 'PORCENTAJE', porcentaje: normalizado.porcentaje, baseCalculo: normalizado.baseCalculo,
          baseManoObra: bases.baseManoObra, baseCostoDirecto: bases.baseCostoDirecto,
        })
      : normalizado.valorMensual;
    return {
      id: siguienteId(),
      categoria: 'Migrado (histórico)',
      concepto: normalizado.concepto,
      cantidad: 1,
      valorUnitario: valorMensual,
      tipoPeriodicidad: 'MENSUAL' as const,
      observacion: normalizado.observacion,
      activo: true,
    };
  });
}

// ─── Consolidado final ───────────────────────────────────────────────────

export interface ConsolidadoCostosAdministrativos {
  totalCostosModulos: number;
  totalVariablesAdministrativas: number;
  valorMensualPolizas: number;
  valorMensualImpuestos: number;
  totalMensualAdministrativo: number;
  costoMensualGeneral: number;
}

/**
 * Fórmula CANÓNICA — la misma debe usarse en Costos Administrativos,
 * Resumen y Resultado (nunca una fórmula separada que pueda dar un valor
 * distinto). `totalCostosModulos` NUNCA incluye Costos Administrativos —
 * evita que `totalMensualAdministrativo` termine dentro de su propia base.
 */
export function calcularConsolidadoCostosAdministrativos(input: {
  totalCostosModulos: number;
  totalVariablesAdministrativas: number;
  valorMensualPolizas: number;
  valorMensualImpuestos: number;
}): ConsolidadoCostosAdministrativos {
  const totalMensualAdministrativo =
    input.totalVariablesAdministrativas + input.valorMensualPolizas + input.valorMensualImpuestos;
  const costoMensualGeneral = input.totalCostosModulos + totalMensualAdministrativo;
  return { ...input, totalMensualAdministrativo, costoMensualGeneral };
}
