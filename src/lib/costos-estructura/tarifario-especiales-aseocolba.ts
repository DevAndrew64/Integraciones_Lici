/**
 * Ajuste "SERVICIOS NO CONTINUOS — FASE 2 MVP: TARIFARIO ASEOCOLBA" —
 * módulo puro (sin React, sin `fetch`), EXCLUSIVO de la pestaña Servicios
 * no continuos para ASEOCOLBA. Nunca importado por Mano de Obra principal,
 * EPP/Dotación, Exámenes Médicos, Insumos ni Maquinaria y Equipos, y nunca
 * al revés — este archivo no importa nada de esos módulos.
 *
 * PROVEEDOR PROVISIONAL — el catálogo `CATALOGO_PROVISIONAL_ASEOCOLBA` de
 * abajo son los valores reales verificados directamente de la hoja
 * "Tarifas mes 42H" del archivo `TARIFAS SERVICIOS ESPECIALES 2026 II
 * SEM.xlsx`, confirmados numéricamente en las rondas de diagnóstico
 * previas (AIU 10% mensual, AIU 20% día/hora/jornada parcial, HORA y DÍA
 * son columnas independientes — nunca `dia/7` ni `hora*7`). Identificado
 * explícitamente como `fuente:'EXCEL_2026_II_PROVISIONAL'`,
 * `vigenteHasta:'2026-12-31'`. NO se mezcla con Vigicolba ni ninguna otra
 * empresa — este archivo es exclusivo de Aseocolba.
 *
 * RUTA DE REEMPLAZO FUTURO — cuando exista la API oficial de tarifas, el
 * plan es: (1) esta constante deja de ser el proveedor y se reemplaza por
 * una consulta real dentro de `/api/servicios-no-continuos-tarifas` (la
 * UI y el motor de cálculo ya consumen la forma `TarifaCatalogoAseocolba`
 * a través de funciones — `buscarTarifaCatalogoAseocolba`,
 * `resolverTarifaKeyAutomatica` — no de la constante directamente desde
 * fuera de este archivo), (2) `MAPEO_PROVISIONAL_CODIGO_UEN_A_TARIFA` se
 * reemplaza por el mapeo real que entregue negocio/API. Ni la UI
 * (page.tsx) ni `calcularTotalesServicioNoContinuo` necesitan cambiar de
 * forma para ese reemplazo — solo el interior de este archivo.
 */

export type ModalidadTarifaAseocolba = 'MENSUAL' | 'DIA' | 'HORA' | 'JORNADA_6H' | 'JORNADA_4H';
export type CargoTarifaAseocolba = 'OPERARIO' | 'OPERARIO_TODERO' | 'OPERARIO_SERVICIO_ESPECIAL' | 'COORDINADOR_SERVICIO_ESPECIAL';
export type JornadaTarifaAseocolba = 'DIURNA' | 'NOCTURNA';
export type TipoDiaTarifaAseocolba = 'HABIL' | 'DOMINICAL_FESTIVO';

export const FUENTE_TARIFARIO_PROVISIONAL = 'EXCEL_2026_II_PROVISIONAL' as const;
export const VIGENTE_HASTA_TARIFARIO_PROVISIONAL = '2026-12-31' as const;

/** Entrada del catálogo — "proveedor vigente" de tarifas. Nunca se
 * persiste dentro de un `ServicioNoContinuo`; solo se consulta en caliente
 * (ver docblock del archivo, "ruta de reemplazo futuro"). */
export interface TarifaCatalogoAseocolba {
  tarifaKey: string;
  modalidad: ModalidadTarifaAseocolba;
  descripcionTarifa: string;
  cargo: CargoTarifaAseocolba;
  jornada?: JornadaTarifaAseocolba;
  tipoDia?: TipoDiaTarifaAseocolba;
  /** true SOLO en las entradas donde el Excel trae explícitamente una
   * variante "con insumos" (hoy, únicamente Oper Aseo 42h mensual). Nunca
   * se infiere para el resto — ver §"CON INSUMOS/SIN INSUMOS" del ajuste. */
  conInsumos: boolean;
  valorBase: number;
  porcentajeAIU: number;
  valorUnitarioConAIU: number;
  fuente: typeof FUENTE_TARIFARIO_PROVISIONAL;
  vigenteHasta: typeof VIGENTE_HASTA_TARIFARIO_PROVISIONAL;
}

/** Configuración de tarifa PERSISTIDA dentro de `ServicioNoContinuo.tarifas`
 * (0/1/N cargos por servicio, ajuste "FASE A"; `tarifa` singular se
 * conserva solo por retrocompatibilidad de lectura — ver `tarifasServicio`
 * en `servicios-no-continuos.ts`). `tarifaKey` es la identidad estable —
 * nunca `descripcionTarifa` (que es solo texto para mostrar y puede
 * cambiar). Al recalcular, el `tarifaKey` se vuelve a consultar contra el
 * proveedor VIGENTE (`buscarTarifaCatalogoAseocolba`) — los valores
 * económicos (`valorBase`/`porcentajeAIU`/`valorUnitarioConAIU`) NUNCA se
 * guardan aquí, para que un cambio futuro de vigencia/proveedor se refleje
 * automáticamente sin migrar datos (ver "HISTÓRICOS" del ajuste). La única
 * excepción es `valorUnitarioOverride`, exclusivo del fallback provisional
 * de insumos. */
export interface TarifaServicioAseocolba {
  tarifaKey: string;
  /** Reservado para la futura API oficial — no tiene valor todavía. */
  tarifaIdExterna?: string;
  modalidad: ModalidadTarifaAseocolba;
  /** Copia legible al momento de seleccionar (para mostrar sin depender de
   * que el catálogo siga teniendo esa clave — nunca se usa para calcular). */
  descripcionTarifa: string;
  cargo: CargoTarifaAseocolba;
  jornada?: JornadaTarifaAseocolba;
  tipoDia?: TipoDiaTarifaAseocolba;
  conInsumos: boolean;
  cantidadPersonas: number;
  cantidadDias?: number;
  cantidadHoras?: number;
  /** Fallback provisional EXCLUSIVO para cuando `conInsumos===true` pero el
   * catálogo vigente no trae una variante "con insumos" para esta tarifa —
   * ver §"CON INSUMOS/SIN INSUMOS". Nunca se usa para ningún otro caso. */
  valorUnitarioOverride?: number;
  /** Cómo se asignó ESTA tarifa a este servicio (no confundir con
   * `TarifaCatalogoAseocolba.fuente`, que identifica el origen de los
   * VALORES del catálogo). */
  fuenteTarifa: 'MAPEO_AUTOMATICO' | 'SELECCION_MANUAL';
  /** Ajuste "que aca sea un boton editable del AIU... que permita marcar
   * si aplica o no" — el Excel trae AMBAS columnas por tarifa ("VR ... CON
   * AIU"/"VR ... SIN AIU", ver `valorUnitarioConAIU`/`valorBase` del
   * catálogo); por defecto (ausente/`undefined`, nunca se migran datos
   * viejos) se sigue aplicando AIU, igual que siempre. `false` explícito
   * usa `valorBase` (el valor SIN AIU del catálogo) para el total, nunca
   * un porcentaje inventado aparte. */
  aplicaAiu?: boolean;
  /** Ajuste "que me traiga el valor de AIU, pero que yo pueda editar" — por
   * defecto (`undefined`) se usa `porcentajeAIU` del catálogo (el mismo
   * que ya se mostraba); un número explícito aquí lo sobrescribe. Solo
   * tiene efecto si `aplicaAiu!==false` — con AIU desactivado, el % no se
   * usa para nada (el total sale de `valorBase`, sin AIU). */
  porcentajeAiuOverride?: number;
}

const ETIQUETA_CARGO: Record<CargoTarifaAseocolba, string> = {
  OPERARIO: 'Operario',
  OPERARIO_TODERO: 'Operario Todero',
  OPERARIO_SERVICIO_ESPECIAL: 'Operario Servicio Especial',
  COORDINADOR_SERVICIO_ESPECIAL: 'Coordinador Servicio Especial',
};
export function etiquetaCargoTarifaAseocolba(cargo: CargoTarifaAseocolba): string {
  return ETIQUETA_CARGO[cargo];
}

const ETIQUETA_JORNADA: Record<JornadaTarifaAseocolba, string> = { DIURNA: 'Diurna', NOCTURNA: 'Nocturna' };
export function etiquetaJornadaTarifaAseocolba(jornada: JornadaTarifaAseocolba): string {
  return ETIQUETA_JORNADA[jornada];
}

const ETIQUETA_TIPO_DIA: Record<TipoDiaTarifaAseocolba, string> = { HABIL: 'Hábil', DOMINICAL_FESTIVO: 'Dominical/Festivo' };
export function etiquetaTipoDiaTarifaAseocolba(tipoDia: TipoDiaTarifaAseocolba): string {
  return ETIQUETA_TIPO_DIA[tipoDia];
}

const ETIQUETA_MODALIDAD: Record<ModalidadTarifaAseocolba, string> = {
  MENSUAL: 'Mensual', DIA: 'Día', HORA: 'Hora', JORNADA_6H: 'Jornada 6 horas', JORNADA_4H: 'Jornada 4 horas',
};
export function etiquetaModalidadTarifaAseocolba(modalidad: ModalidadTarifaAseocolba): string {
  return ETIQUETA_MODALIDAD[modalidad];
}

function tarifa(base: Omit<TarifaCatalogoAseocolba, 'fuente' | 'vigenteHasta'>): TarifaCatalogoAseocolba {
  return { ...base, fuente: FUENTE_TARIFARIO_PROVISIONAL, vigenteHasta: VIGENTE_HASTA_TARIFARIO_PROVISIONAL };
}

/**
 * Catálogo provisional 2026-II — valores reales verificados del Excel
 * (ver docblock del archivo). 36 entradas: 10 MENSUAL + 12 DIA + 12 HORA +
 * 2 JORNADA parcial (6H/4H, únicos combos de cargo/jornada/tipoDía que el
 * usuario compartió para esas dos tarifas especiales — no se inventan
 * combinaciones adicionales sin evidencia).
 */
export const CATALOGO_PROVISIONAL_ASEOCOLBA: TarifaCatalogoAseocolba[] = [
  // ── MENSUAL — AIU 10% ──
  tarifa({ tarifaKey: 'MENSUAL_OPERARIO_ASEO_42_LS_SIN_INSUMOS', modalidad: 'MENSUAL', cargo: 'OPERARIO', conInsumos: false, descripcionTarifa: 'Oper Aseo 42 horas semanales diurnas L-S hábiles, sin insumos', valorBase: 2791770, porcentajeAIU: 10, valorUnitarioConAIU: 3070947 }),
  tarifa({ tarifaKey: 'MENSUAL_OPERARIO_ASEO_42_LS_CON_INSUMOS', modalidad: 'MENSUAL', cargo: 'OPERARIO', conInsumos: true, descripcionTarifa: 'Oper Aseo 42 horas semanales diurnas L-S hábiles, con insumos', valorBase: 2990717, porcentajeAIU: 10, valorUnitarioConAIU: 3289789 }),
  tarifa({ tarifaKey: 'MENSUAL_OPERARIO_ASEO_7_LDF_SIN_INSUMOS', modalidad: 'MENSUAL', cargo: 'OPERARIO', conInsumos: false, descripcionTarifa: 'Oper Aseo 7 horas diurnas L-D y festivos, sin insumos', valorBase: 4175523, porcentajeAIU: 10, valorUnitarioConAIU: 4593076 }),
  tarifa({ tarifaKey: 'MENSUAL_OPERARIO_ASEO_6_LS_SIN_INSUMOS', modalidad: 'MENSUAL', cargo: 'OPERARIO', conInsumos: false, descripcionTarifa: 'Oper Aseo 6 horas diarias diurnas L-S hábiles, sin insumos', valorBase: 2474428, porcentajeAIU: 10, valorUnitarioConAIU: 2721871 }),
  tarifa({ tarifaKey: 'MENSUAL_OPERARIO_ASEO_4_LS_SIN_INSUMOS', modalidad: 'MENSUAL', cargo: 'OPERARIO', conInsumos: false, descripcionTarifa: 'Oper Aseo 4 horas diarias diurnas L-S hábiles, sin insumos', valorBase: 1839770, porcentajeAIU: 10, valorUnitarioConAIU: 2023747 }),
  tarifa({ tarifaKey: 'MENSUAL_OPERARIO_ASEO_4_LDF_SIN_INSUMOS', modalidad: 'MENSUAL', cargo: 'OPERARIO', conInsumos: false, descripcionTarifa: 'Oper Aseo 4 horas diarias diurnas L-D y festivos, sin insumos', valorBase: 2622308, porcentajeAIU: 10, valorUnitarioConAIU: 2884538 }),
  tarifa({ tarifaKey: 'MENSUAL_OPERARIO_TODERO_42_LS', modalidad: 'MENSUAL', cargo: 'OPERARIO_TODERO', conInsumos: false, descripcionTarifa: 'Oper Todero 42 horas semanales diurnas L-S hábiles', valorBase: 3441172, porcentajeAIU: 10, valorUnitarioConAIU: 3785290 }),
  tarifa({ tarifaKey: 'MENSUAL_OPERARIO_TODERO_7_LDF', modalidad: 'MENSUAL', cargo: 'OPERARIO_TODERO', conInsumos: false, descripcionTarifa: 'Oper Todero 7 horas diurnas L-D y festivos', valorBase: 5162023, porcentajeAIU: 10, valorUnitarioConAIU: 5678225 }),
  tarifa({ tarifaKey: 'MENSUAL_OPERARIO_SERVICIO_ESPECIAL_42_LS', modalidad: 'MENSUAL', cargo: 'OPERARIO_SERVICIO_ESPECIAL', conInsumos: false, descripcionTarifa: 'Oper Servicio Especial 42 horas semanales diurnas L-S hábiles', valorBase: 3980055, porcentajeAIU: 10, valorUnitarioConAIU: 4378060 }),
  tarifa({ tarifaKey: 'MENSUAL_OPERARIO_SERVICIO_ESPECIAL_7_LDF', modalidad: 'MENSUAL', cargo: 'OPERARIO_SERVICIO_ESPECIAL', conInsumos: false, descripcionTarifa: 'Oper Servicio Especial 7 horas diurnas L-D y festivos', valorBase: 5979568, porcentajeAIU: 10, valorUnitarioConAIU: 6577525 }),

  // ── DIA — AIU 20% (3 cargos × 2 jornadas × 2 tipos de día) ──
  tarifa({ tarifaKey: 'DIA_OPERARIO_DIURNA_HABIL', modalidad: 'DIA', cargo: 'OPERARIO', jornada: 'DIURNA', tipoDia: 'HABIL', conInsumos: false, descripcionTarifa: 'Operario · Diurna · Hábil', valorBase: 116324, porcentajeAIU: 20, valorUnitarioConAIU: 139589 }),
  tarifa({ tarifaKey: 'DIA_OPERARIO_SERVICIO_ESPECIAL_DIURNA_HABIL', modalidad: 'DIA', cargo: 'OPERARIO_SERVICIO_ESPECIAL', jornada: 'DIURNA', tipoDia: 'HABIL', conInsumos: false, descripcionTarifa: 'Operario Servicio Especial · Diurna · Hábil', valorBase: 165836, porcentajeAIU: 20, valorUnitarioConAIU: 199003 }),
  tarifa({ tarifaKey: 'DIA_COORDINADOR_SERVICIO_ESPECIAL_DIURNA_HABIL', modalidad: 'DIA', cargo: 'COORDINADOR_SERVICIO_ESPECIAL', jornada: 'DIURNA', tipoDia: 'HABIL', conInsumos: false, descripcionTarifa: 'Coordinador Servicio Especial · Diurna · Hábil', valorBase: 199124, porcentajeAIU: 20, valorUnitarioConAIU: 238949 }),
  tarifa({ tarifaKey: 'DIA_OPERARIO_DIURNA_DOM_FEST', modalidad: 'DIA', cargo: 'OPERARIO', jornada: 'DIURNA', tipoDia: 'DOMINICAL_FESTIVO', conInsumos: false, descripcionTarifa: 'Operario · Diurna · Dominical/Festivo', valorBase: 209383, porcentajeAIU: 20, valorUnitarioConAIU: 251259 }),
  tarifa({ tarifaKey: 'DIA_OPERARIO_SERVICIO_ESPECIAL_DIURNA_DOM_FEST', modalidad: 'DIA', cargo: 'OPERARIO_SERVICIO_ESPECIAL', jornada: 'DIURNA', tipoDia: 'DOMINICAL_FESTIVO', conInsumos: false, descripcionTarifa: 'Operario Servicio Especial · Diurna · Dominical/Festivo', valorBase: 298504, porcentajeAIU: 20, valorUnitarioConAIU: 358205 }),
  tarifa({ tarifaKey: 'DIA_COORDINADOR_SERVICIO_ESPECIAL_DIURNA_DOM_FEST', modalidad: 'DIA', cargo: 'COORDINADOR_SERVICIO_ESPECIAL', jornada: 'DIURNA', tipoDia: 'DOMINICAL_FESTIVO', conInsumos: false, descripcionTarifa: 'Coordinador Servicio Especial · Diurna · Dominical/Festivo', valorBase: 358423, porcentajeAIU: 20, valorUnitarioConAIU: 430107 }),
  tarifa({ tarifaKey: 'DIA_OPERARIO_NOCTURNA_HABIL', modalidad: 'DIA', cargo: 'OPERARIO', jornada: 'NOCTURNA', tipoDia: 'HABIL', conInsumos: false, descripcionTarifa: 'Operario · Nocturna · Hábil', valorBase: 157037, porcentajeAIU: 20, valorUnitarioConAIU: 188444 }),
  tarifa({ tarifaKey: 'DIA_OPERARIO_SERVICIO_ESPECIAL_NOCTURNA_HABIL', modalidad: 'DIA', cargo: 'OPERARIO_SERVICIO_ESPECIAL', jornada: 'NOCTURNA', tipoDia: 'HABIL', conInsumos: false, descripcionTarifa: 'Operario Servicio Especial · Nocturna · Hábil', valorBase: 223878, porcentajeAIU: 20, valorUnitarioConAIU: 268654 }),
  tarifa({ tarifaKey: 'DIA_COORDINADOR_SERVICIO_ESPECIAL_NOCTURNA_HABIL', modalidad: 'DIA', cargo: 'COORDINADOR_SERVICIO_ESPECIAL', jornada: 'NOCTURNA', tipoDia: 'HABIL', conInsumos: false, descripcionTarifa: 'Coordinador Servicio Especial · Nocturna · Hábil', valorBase: 268817, porcentajeAIU: 20, valorUnitarioConAIU: 322581 }),
  tarifa({ tarifaKey: 'DIA_OPERARIO_NOCTURNA_DOM_FEST', modalidad: 'DIA', cargo: 'OPERARIO', jornada: 'NOCTURNA', tipoDia: 'DOMINICAL_FESTIVO', conInsumos: false, descripcionTarifa: 'Operario · Nocturna · Dominical/Festivo', valorBase: 250096, porcentajeAIU: 20, valorUnitarioConAIU: 300115 }),
  tarifa({ tarifaKey: 'DIA_OPERARIO_SERVICIO_ESPECIAL_NOCTURNA_DOM_FEST', modalidad: 'DIA', cargo: 'OPERARIO_SERVICIO_ESPECIAL', jornada: 'NOCTURNA', tipoDia: 'DOMINICAL_FESTIVO', conInsumos: false, descripcionTarifa: 'Operario Servicio Especial · Nocturna · Dominical/Festivo', valorBase: 356547, porcentajeAIU: 20, valorUnitarioConAIU: 427856 }),
  tarifa({ tarifaKey: 'DIA_COORDINADOR_SERVICIO_ESPECIAL_NOCTURNA_DOM_FEST', modalidad: 'DIA', cargo: 'COORDINADOR_SERVICIO_ESPECIAL', jornada: 'NOCTURNA', tipoDia: 'DOMINICAL_FESTIVO', conInsumos: false, descripcionTarifa: 'Coordinador Servicio Especial · Nocturna · Dominical/Festivo', valorBase: 428116, porcentajeAIU: 20, valorUnitarioConAIU: 513739 }),

  // ── HORA — AIU 20% (independiente de DIA, ver docblock) ──
  tarifa({ tarifaKey: 'HORA_OPERARIO_DIURNA_HABIL', modalidad: 'HORA', cargo: 'OPERARIO', jornada: 'DIURNA', tipoDia: 'HABIL', conInsumos: false, descripcionTarifa: 'Operario · Diurna · Hábil', valorBase: 15870, porcentajeAIU: 20, valorUnitarioConAIU: 19043 }),
  tarifa({ tarifaKey: 'HORA_OPERARIO_SERVICIO_ESPECIAL_DIURNA_HABIL', modalidad: 'HORA', cargo: 'OPERARIO_SERVICIO_ESPECIAL', jornada: 'DIURNA', tipoDia: 'HABIL', conInsumos: false, descripcionTarifa: 'Operario Servicio Especial · Diurna · Hábil', valorBase: 22624, porcentajeAIU: 20, valorUnitarioConAIU: 27149 }),
  tarifa({ tarifaKey: 'HORA_COORDINADOR_SERVICIO_ESPECIAL_DIURNA_HABIL', modalidad: 'HORA', cargo: 'COORDINADOR_SERVICIO_ESPECIAL', jornada: 'DIURNA', tipoDia: 'HABIL', conInsumos: false, descripcionTarifa: 'Coordinador Servicio Especial · Diurna · Hábil', valorBase: 27166, porcentajeAIU: 20, valorUnitarioConAIU: 32599 }),
  tarifa({ tarifaKey: 'HORA_OPERARIO_DIURNA_DOM_FEST', modalidad: 'HORA', cargo: 'OPERARIO', jornada: 'DIURNA', tipoDia: 'DOMINICAL_FESTIVO', conInsumos: false, descripcionTarifa: 'Operario · Diurna · Dominical/Festivo', valorBase: 28565, porcentajeAIU: 20, valorUnitarioConAIU: 34278 }),
  tarifa({ tarifaKey: 'HORA_OPERARIO_SERVICIO_ESPECIAL_DIURNA_DOM_FEST', modalidad: 'HORA', cargo: 'OPERARIO_SERVICIO_ESPECIAL', jornada: 'DIURNA', tipoDia: 'DOMINICAL_FESTIVO', conInsumos: false, descripcionTarifa: 'Operario Servicio Especial · Diurna · Dominical/Festivo', valorBase: 40724, porcentajeAIU: 20, valorUnitarioConAIU: 48868 }),
  tarifa({ tarifaKey: 'HORA_COORDINADOR_SERVICIO_ESPECIAL_DIURNA_DOM_FEST', modalidad: 'HORA', cargo: 'COORDINADOR_SERVICIO_ESPECIAL', jornada: 'DIURNA', tipoDia: 'DOMINICAL_FESTIVO', conInsumos: false, descripcionTarifa: 'Coordinador Servicio Especial · Diurna · Dominical/Festivo', valorBase: 48898, porcentajeAIU: 20, valorUnitarioConAIU: 58678 }),
  tarifa({ tarifaKey: 'HORA_OPERARIO_NOCTURNA_HABIL', modalidad: 'HORA', cargo: 'OPERARIO', jornada: 'NOCTURNA', tipoDia: 'HABIL', conInsumos: false, descripcionTarifa: 'Operario · Nocturna · Hábil', valorBase: 21424, porcentajeAIU: 20, valorUnitarioConAIU: 25709 }),
  tarifa({ tarifaKey: 'HORA_OPERARIO_SERVICIO_ESPECIAL_NOCTURNA_HABIL', modalidad: 'HORA', cargo: 'OPERARIO_SERVICIO_ESPECIAL', jornada: 'NOCTURNA', tipoDia: 'HABIL', conInsumos: false, descripcionTarifa: 'Operario Servicio Especial · Nocturna · Hábil', valorBase: 30543, porcentajeAIU: 20, valorUnitarioConAIU: 36651 }),
  tarifa({ tarifaKey: 'HORA_COORDINADOR_SERVICIO_ESPECIAL_NOCTURNA_HABIL', modalidad: 'HORA', cargo: 'COORDINADOR_SERVICIO_ESPECIAL', jornada: 'NOCTURNA', tipoDia: 'HABIL', conInsumos: false, descripcionTarifa: 'Coordinador Servicio Especial · Nocturna · Hábil', valorBase: 36674, porcentajeAIU: 20, valorUnitarioConAIU: 44008 }),
  tarifa({ tarifaKey: 'HORA_OPERARIO_NOCTURNA_DOM_FEST', modalidad: 'HORA', cargo: 'OPERARIO', jornada: 'NOCTURNA', tipoDia: 'DOMINICAL_FESTIVO', conInsumos: false, descripcionTarifa: 'Operario · Nocturna · Dominical/Festivo', valorBase: 34120, porcentajeAIU: 20, valorUnitarioConAIU: 40943 }),
  tarifa({ tarifaKey: 'HORA_OPERARIO_SERVICIO_ESPECIAL_NOCTURNA_DOM_FEST', modalidad: 'HORA', cargo: 'OPERARIO_SERVICIO_ESPECIAL', jornada: 'NOCTURNA', tipoDia: 'DOMINICAL_FESTIVO', conInsumos: false, descripcionTarifa: 'Operario Servicio Especial · Nocturna · Dominical/Festivo', valorBase: 48642, porcentajeAIU: 20, valorUnitarioConAIU: 58371 }),
  tarifa({ tarifaKey: 'HORA_COORDINADOR_SERVICIO_ESPECIAL_NOCTURNA_DOM_FEST', modalidad: 'HORA', cargo: 'COORDINADOR_SERVICIO_ESPECIAL', jornada: 'NOCTURNA', tipoDia: 'DOMINICAL_FESTIVO', conInsumos: false, descripcionTarifa: 'Coordinador Servicio Especial · Nocturna · Dominical/Festivo', valorBase: 58406, porcentajeAIU: 20, valorUnitarioConAIU: 70087 }),

  // ── JORNADA PARCIAL — 6H y 4H, AIU 20%. Modalidad propia (nunca derivada
  // de HORA×horas ni de proporcionalidad de DÍA, ver docblock). Solo se
  // registra la única combinación de cargo/jornada/tipoDía que el usuario
  // compartió con evidencia numérica — no se inventan combinaciones para
  // otros cargos/jornadas de estas dos tarifas especiales. ──
  tarifa({ tarifaKey: 'JORNADA_6H_OPERARIO_DIURNA_HABIL', modalidad: 'JORNADA_6H', cargo: 'OPERARIO', jornada: 'DIURNA', tipoDia: 'HABIL', conInsumos: false, descripcionTarifa: 'Jornada 6 horas · Operario · Diurna · Hábil', valorBase: 103101, porcentajeAIU: 20, valorUnitarioConAIU: 123721 }),
  tarifa({ tarifaKey: 'JORNADA_4H_OPERARIO_DIURNA_HABIL', modalidad: 'JORNADA_4H', cargo: 'OPERARIO', jornada: 'DIURNA', tipoDia: 'HABIL', conInsumos: false, descripcionTarifa: 'Jornada 4 horas · Operario · Diurna · Hábil', valorBase: 76657, porcentajeAIU: 20, valorUnitarioConAIU: 91989 }),
];

export function buscarTarifaCatalogoAseocolba(tarifaKey: string | undefined): TarifaCatalogoAseocolba | null {
  if (!tarifaKey) return null;
  return CATALOGO_PROVISIONAL_ASEOCOLBA.find(t => t.tarifaKey === tarifaKey) ?? null;
}

/**
 * Mapeo provisional `codigo+uen` (de `/no_continuos`) → `tarifaKey`.
 * DELIBERADAMENTE VACÍO — no existe todavía evidencia funcional confirmada
 * de qué tarifa corresponde a cada servicio del catálogo (pregunta 1 del
 * cuestionario pendiente al responsable funcional). Inventar una entrada
 * aquí (ej. "JARDINERIA"→tarifa de Operario) sería asumir una regla de
 * negocio no confirmada — prohibido explícitamente por el usuario. Cuando
 * negocio confirme mapeos reales, se agregan aquí como
 * `'{codigo}::{uen}': 'TARIFA_KEY'`; `resolverTarifaKeyAutomatica` ya está
 * lista para consumirlos sin cambiar su forma ni la de sus llamadores.
 */
export const MAPEO_PROVISIONAL_CODIGO_UEN_A_TARIFA: Record<string, string> = {};

export function claveMapeoCodigoUen(codigo: string, uen: string): string {
  return `${codigo}::${uen}`;
}

/** Capa de asignación CENTRALIZADA — único punto de resolución
 * codigo+uen→tarifaKey en todo el módulo (nunca condicionales repartidos
 * por page.tsx). Devuelve `null` cuando no hay mapping configurado; el
 * llamador debe mostrar el selector de tarifa provisional en ese caso. */
export function resolverTarifaServicioNoContinuo(codigo: string, uen: string): string | null {
  return MAPEO_PROVISIONAL_CODIGO_UEN_A_TARIFA[claveMapeoCodigoUen(codigo, uen)] ?? null;
}

/** Construye la configuración persistida de tarifa a partir de una entrada
 * del catálogo — cantidades en 1/undefined por defecto (el usuario las
 * completa después). Usado tanto por la resolución automática como por la
 * selección manual (mismo constructor, nunca dos caminos distintos).
 *
 * Ajuste "APLICA AIU POR DEFECTO DESACTIVADO" — un cargo NUEVO (agregado
 * desde este constructor) nace con `aplicaAiu:false` explícito (nunca
 * `undefined`) — el usuario debe marcar el checkbox a propósito para que
 * el AIU se aplique; mientras está desmarcado, el % mostrado es 0 (ver
 * `page.tsx`, grilla de cargos). Esto NO cambia el comportamiento de datos
 * YA GUARDADOS: un registro histórico con `aplicaAiu===undefined` sigue
 * tratándose como "aplica AIU" (`aplicaAiu!==false`, ver
 * `calcularTarifaServicioAseocolba`) — el default nuevo solo aplica a
 * partir de aquí, hacia adelante. */
export function construirTarifaServicioDesdeCatalogo(
  entrada: TarifaCatalogoAseocolba,
  fuenteTarifa: TarifaServicioAseocolba['fuenteTarifa'],
): TarifaServicioAseocolba {
  return {
    tarifaKey: entrada.tarifaKey,
    modalidad: entrada.modalidad,
    descripcionTarifa: entrada.descripcionTarifa,
    cargo: entrada.cargo,
    jornada: entrada.jornada,
    tipoDia: entrada.tipoDia,
    conInsumos: entrada.conInsumos,
    cantidadPersonas: 1,
    aplicaAiu: false,
    fuenteTarifa,
  };
}

export interface ResultadoCalculoTarifaAseocolba {
  valido: boolean;
  valorBase: number;
  porcentajeAIU: number;
  valorUnitarioConAIU: number;
  /** true salvo `tarifaServicio.aplicaAiu===false` — informa a la UI si el
   * `total` de abajo se calculó con `valorUnitarioConAIU` o con `valorBase`. */
  aplicaAiu: boolean;
  /** El valor unitario REALMENTE usado para `total` — `valorUnitarioConAIU`
   * si `aplicaAiu`, `valorBase` si no. Nunca recalculado aparte en la UI. */
  valorUnitarioAplicado: number;
  total: number;
  motivoInvalido?: string;
}

const RESULTADO_INVALIDO_BASE = { valorBase: 0, porcentajeAIU: 0, valorUnitarioConAIU: 0, aplicaAiu: true, valorUnitarioAplicado: 0, total: 0 } as const;

/**
 * Cálculo puro de una línea tarifaria ASEOCOLBA — recibe la configuración
 * persistida (`tarifa`) y el resultado de consultar el proveedor VIGENTE
 * por `tarifa.tarifaKey` (`tarifaVigente`, `null` si ya no existe en el
 * catálogo actual). NUNCA usa un valor guardado como fuente de verdad
 * económica (ver "HISTÓRICOS" del ajuste) — solo `tarifaVigente` (o el
 * override manual, exclusivo del fallback de insumos).
 *
 * NUNCA devuelve `total` como "$0 silencioso" disfrazado de resultado
 * válido: cuando no hay tarifa resoluble, `valido:false` y `motivoInvalido`
 * explica por qué — el llamador (page.tsx) debe bloquear el guardado de
 * ESE servicio, nunca tratar el 0 como una cotización real.
 */
export function calcularTarifaServicioAseocolba(
  tarifaServicio: TarifaServicioAseocolba | undefined,
  tarifaVigente: TarifaCatalogoAseocolba | null,
): ResultadoCalculoTarifaAseocolba {
  if (!tarifaServicio) {
    return { valido: false, ...RESULTADO_INVALIDO_BASE, motivoInvalido: 'Servicio sin tarifa asignada — pendiente de parametrización.' };
  }
  if (!tarifaVigente && tarifaServicio.valorUnitarioOverride == null) {
    return { valido: false, ...RESULTADO_INVALIDO_BASE, motivoInvalido: 'La tarifa seleccionada no existe en el catálogo vigente.' };
  }
  // §"CON INSUMOS/SIN INSUMOS" — si se pidió con insumos y la tarifa vigente
  // no trae esa variante explícita, el override es OBLIGATORIO; nunca se
  // inventa un incremento porcentual ni se calcula solo.
  const requiereOverrideInsumos = tarifaServicio.conInsumos && tarifaVigente != null && !tarifaVigente.conInsumos;
  if (requiereOverrideInsumos && tarifaServicio.valorUnitarioOverride == null) {
    return { valido: false, ...RESULTADO_INVALIDO_BASE, motivoInvalido: 'Falta el valor unitario "con insumos" (no existe variante explícita en el catálogo) — complete el campo provisional.' };
  }

  let valorBase: number, porcentajeAIU: number, valorUnitarioConAIU: number;
  if (tarifaServicio.valorUnitarioOverride != null) {
    valorUnitarioConAIU = tarifaServicio.valorUnitarioOverride;
    valorBase = tarifaVigente?.valorBase ?? 0;
    porcentajeAIU = tarifaVigente?.porcentajeAIU ?? 0;
  } else {
    valorBase = tarifaVigente!.valorBase;
    porcentajeAIU = tarifaVigente!.porcentajeAIU;
    valorUnitarioConAIU = tarifaVigente!.valorUnitarioConAIU;
    // Ajuste "que me traiga el valor de AIU, pero que yo pueda editar" —
    // solo aplica sobre la ruta de catálogo (nunca sobre el override "con
    // insumos" de arriba, que ya es un valor manual fijo en pesos): un %
    // editado recalcula `valorUnitarioConAIU` desde `valorBase`, nunca
    // reutiliza el valor fijo del catálogo con el % viejo.
    if (tarifaServicio.porcentajeAiuOverride != null) {
      porcentajeAIU = tarifaServicio.porcentajeAiuOverride;
      valorUnitarioConAIU = Math.round(valorBase * (1 + porcentajeAIU / 100));
    }
  }

  // Ajuste "que aca sea un boton editable del AIU... que permita marcar si
  // aplica o no para que cuando no aplique no tome el valor con el AIU" —
  // sin decisión explícita (`undefined`, nunca migra datos viejos), sigue
  // aplicando AIU igual que siempre. `false` explícito usa `valorBase`
  // (columna "SIN AIU" del Excel) — nunca el override "con insumos", que
  // solo tiene sentido cuando SÍ se aplica AIU.
  const aplicaAiu = tarifaServicio.aplicaAiu !== false;
  const valorUnitarioAplicado = aplicaAiu ? valorUnitarioConAIU : valorBase;

  const modalidad = tarifaVigente?.modalidad ?? tarifaServicio.modalidad;
  const personas = tarifaServicio.cantidadPersonas > 0 ? tarifaServicio.cantidadPersonas : 0;
  let total: number;
  switch (modalidad) {
    case 'MENSUAL':
      // Confirmado: sin cantidad de meses en este MVP — la pestaña trabaja
      // el valor mensual del servicio (ver ajuste, "CÁLCULO MENSUAL").
      total = valorUnitarioAplicado * personas;
      break;
    case 'DIA':
    case 'JORNADA_6H':
    case 'JORNADA_4H':
      total = valorUnitarioAplicado * personas * (tarifaServicio.cantidadDias ?? 0);
      break;
    case 'HORA':
      total = valorUnitarioAplicado * personas * (tarifaServicio.cantidadHoras ?? 0);
      break;
  }

  return { valido: true, valorBase, porcentajeAIU, valorUnitarioConAIU, aplicaAiu, valorUnitarioAplicado, total };
}
