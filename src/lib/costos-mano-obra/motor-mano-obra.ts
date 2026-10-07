/**
 * Motor determinístico — Estructura de Costo: Mano de Obra
 * Fase 1.1: ajustes finos post-auditoría
 *
 * REGLAS:
 * - Sin efectos secundarios. Sin llamadas a BD. Sin imports Next.js.
 * - Sin valores legales hardcodeados: todo viene de ParamsMotorMO.
 * - Gemini sugiere tipoDiaGemini; este motor calcula tipoDiaCalculado.
 * - Factor mensual, divisorHora y jornadaMax siempre desde ParamsMotorMO.
 *
 * NOTA Fase 2: cuando exista fechaInicioServicio, pasar la fecha a
 * consultarTipoDia() para lookup exacto en CalendarioFestivos.
 * tipoDiaGemini NO debe usarse como fallback cuando hay fecha concreta.
 */

// ─── Tipos básicos ─────────────────────────────────────────────────────────────

export type DiaSemana     = 'L' | 'M' | 'X' | 'J' | 'V' | 'S' | 'D';
export type TipoDia       = 'habil' | 'dominical' | 'festivo' | 'dom_festivo';
export type TipoCobertura = 'persona' | 'puesto' | 'turnante' | 'relevo' | 'eventual';
export type Severidad     = 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAJA';
export type ModoDescanso  = 'exacto' | 'proporcional' | 'no_informado';
export type ModoCosteo    = 'individual' | 'requiere_distribucion_por_rotacion';

// ─── Parámetros del motor (desde ParametrosLaborales en BD) ──────────────────

export interface ParamsMotorMO {
  anio: number;
  jornadaMaxSemana: number;          // horasMaxSemanaActual o Posterior según fecha
  divisorHora: number;               // e.g. 240
  factorMensual: number;             // e.g. 4.333
  metodoPeriodo: 'factor' | 'calendario' | 'dias_mes';
  horaInicioNocturna: number;        // 19 (Ley 2466/2025)
  horaFinNocturna: number;           // 6
  recargoNocturno: number;           // 0.35
  recargoExtraDiurno: number;        // 0.25
  recargoExtraNocturno: number;      // 0.75
  recargoDominical: number;          // 0.75
  recargoDominicalNoc: number;       // 0.75
  recargoFestivoDiu: number;         // 0.75
  recargoFestivoNoc: number;         // 0.75
}

// ─── Entradas al motor ────────────────────────────────────────────────────────

export interface TurnoEntrada {
  dias: DiaSemana[];
  horaInicio: string;                // "HH:MM" 24h
  horaFin: string;                   // "HH:MM" 24h; puede ser del día siguiente
  descansoMinutos: number;
  descansoComputable: boolean;
  // Ajuste #6 Fase 1.1: exactitud del descanso en turnos mixtos
  descansoHoraInicio?: string;       // "HH:MM" si se conoce la hora exacta del descanso
  descansoHoraFin?: string;
  metodoDistribucionDescanso?: ModoDescanso;
  tipoDiaGemini?: TipoDia;           // sugerencia de Gemini — NO es fuente de verdad
  /**
   * Override explícito del requisito operativo: false = el cliente indicó que este
   * turno NO cubre festivos (aunque caiga en un día festivo real). null/undefined =
   * sin override, se usa el calendario real de festivos (comportamiento por defecto).
   */
  festivosIncluidos?: boolean | null;
}

/**
 * Bloque de cobertura continua que abarca más de un día calendario
 * (ej: sábado 12:30 p.m. hasta lunes 08:00 a.m. = 43.5h sin cortes por día).
 * A diferencia de TurnoEntrada (mismo horario repetido en varios días sueltos),
 * un bloque continuo describe UN solo tramo ininterrumpido de diaInicio a diaFin.
 */
export interface BloqueContinuoEntrada {
  diaInicio: DiaSemana;
  horaInicio: string;                // "HH:MM" 24h
  diaFin: DiaSemana;
  horaFin: string;                   // "HH:MM" 24h
  descansoMinutos: number;
  descansoComputable: boolean;
  /** true si el cliente declaró una extensión cuando diaFin cae festivo (ej: "si el lunes es festivo, hasta el martes"). */
  condicionFestivoDiaFin: boolean;
  diaFinExtendido: DiaSemana | null;
  horaFinExtendido: string | null;
}

export interface CargoEntrada {
  cargoNormalizado: string;
  cantidadSolicitada: number;
  tipoCobertura: TipoCobertura;
  jornadaSemanalDeclarada: number | null;
  diaDescansoObligatorio: DiaSemana | null;
  turnos: TurnoEntrada[];
  /** Tramos de cobertura continua multi-día (fin de semana, festivos). Ver BloqueContinuoEntrada. */
  bloquesContinuos?: BloqueContinuoEntrada[];
  claseRiesgoArl: string | null;
  requiereValidacionArl: boolean;
  requiereAlturas: boolean | null;
  esJornadaParcialSinHoras?: boolean;
  esPiscinero?: boolean;
  esSalvavidas?: boolean;
  esPiscineroSalvavidas?: boolean;
}

// ─── Resultados del motor ─────────────────────────────────────────────────────

export interface DesgloseSemanal {
  ordDiu: number;
  ordNoc: number;
  extDiu: number;
  extNoc: number;
  domOrdDiu: number;
  domOrdNoc: number;
  domExtDiu: number;
  domExtNoc: number;
  festOrdDiu: number;
  festOrdNoc: number;
  festExtDiu: number;
  festExtNoc: number;
  totalSemana: number;
  horasExtra: number;
  horasNocturnas: number;
}

/**
 * Inputs mensuales compatibles con el tab actual de Mano de Obra.
 * Ajuste #2 Fase 1.1: tres campos de jornada separados (sin ambigüedad).
 * Ajuste #3 Fase 1.1: exportabilidad explícita para puestos 24/7 o rotación.
 */
export interface InputsMensuales {
  // Jornada — tres campos separados
  jornadaBaseLegalSemana: number;    // = params.jornadaMaxSemana; depende de ParametrosLaborales y fechaInicioServicio
  horasServicioSemana: number;       // horas de trabajo efectivo del cargo esta persona/semana
  horasOrdinariasSemana: number;     // horas dentro del presupuesto ordinario (≤ jornadaBase)
  // Horas por categoría (para el tab actual)
  hRecNocHabil: number;
  hExtDiurHabil: number;
  hExtNocHabil: number;
  hOrdDomDiu: number;
  hOrdDomNoc: number;
  hExtDomDiu: number;
  hExtDomNoc: number;
  hFestDiu: number;
  hFestNoc: number;
  hExtFestDiu: number;
  hExtFestNoc: number;
  // Exportabilidad — ajuste #3 Fase 1.1
  modoCosteo: ModoCosteo;
  exportableAlTabActual: boolean;
  motivoNoExportable?: string;
  // Meta
  factorMensual: number;
  metodoPeriodo: string;
}

export interface AlertaMO {
  severidad: Severidad;
  codigo: string;
  mensaje: string;
  campoAfectado?: string;
  fuenteNormativa?: string;
}

export interface PreguntaMO {
  pregunta: string;
  prioridad: 'urgente' | 'normal' | 'opcional';
  contexto: string;
}

export interface ResultadoCargo {
  desgloseSemanal: DesgloseSemanal;
  jornadaCalculada: number;
  jornadaDeclarada: number | null;
  coincideJornada: boolean;
  diferenciaHoras: number;
  // FTE — ajuste #5 Fase 1.1: campos separados con semántica precisa
  fteTeorico: number;
  personasSinHorasExtra: number;       // Math.ceil(fteTeorico) — sin sobretiempo
  personasConHorasExtra: number;       // si se permite sobretiempo legal razonable
  cantidadPersonasCalculadas: number;  // = personasSinHorasExtra (conservador, para costo)
  cantidadPuestosPorTurno: number;     // = cargo.cantidadSolicitada
  requiereValidacionHorasExtra: boolean;
  requiereTurnante: boolean;           // solo obligatorio para 24/7 / dom-a-dom / puesto permanente
  inputsMensuales: InputsMensuales;
  alertas: AlertaMO[];
  preguntas: PreguntaMO[];
}

// ─── Contexto interno de FTE para generarAlertasCargo ────────────────────────

interface ContextoFTE {
  fteTeorico: number;
  personasSinHorasExtra: number;
  personasConHorasExtra: number;
  requiereValidacionHorasExtra: boolean;
  requiereTurnante: boolean;
}

// ─── Constantes de orden de días ──────────────────────────────────────────────

export const ORDEN_DIAS: DiaSemana[] = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const SIGUIENTE_DIA: Record<DiaSemana, DiaSemana> = {
  L: 'M', M: 'X', X: 'J', J: 'V', V: 'S', S: 'D', D: 'L',
};

// ─── 1. Helpers primitivos ────────────────────────────────────────────────────

export function parseHora(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h + (m ?? 0) / 60;
}

export function formatHora(h: number): string {
  const hh = Math.floor(h % 24);
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ─── 2. Horas brutas y cruce de medianoche ────────────────────────────────────

/**
 * Duración total del turno en horas.
 * Ajuste #1 Fase 1.1: 07:00–17:00 = 10h brutas (no 9).
 * El descanso reduce horas NETAS, no brutas.
 */
export function calcularHorasBrutas(horaInicio: string, horaFin: string): number {
  const ini = parseHora(horaInicio);
  const fin = parseHora(horaFin);
  return fin > ini ? fin - ini : 24 - ini + fin;
}

export function detectarCruceMedianoche(horaInicio: string, horaFin: string): boolean {
  const ini = parseHora(horaInicio);
  const fin = parseHora(horaFin);
  return fin > 0 && fin < ini;
}

// ─── 3. División por día calendario ──────────────────────────────────────────

interface SegmentoTurno {
  dias: DiaSemana[];
  inicioH: number;
  durH: number;
}

export function dividirTurnoPorDiaCalendario(turno: TurnoEntrada): SegmentoTurno[] {
  const ini = parseHora(turno.horaInicio);
  const fin = parseHora(turno.horaFin);
  const cruza = detectarCruceMedianoche(turno.horaInicio, turno.horaFin);

  if (!cruza) {
    return [{ dias: turno.dias, inicioH: ini, durH: fin - ini }];
  }

  const diasSig = turno.dias.map(d => SIGUIENTE_DIA[d]);
  return [
    { dias: turno.dias,             inicioH: ini, durH: 24 - ini },
    { dias: diasSig as DiaSemana[], inicioH: 0,   durH: fin },
  ];
}

// ─── 3b. Bloques de cobertura continua (multi-día) ───────────────────────────

/** Camino de días de diaInicio a diaFin (ambos incluidos), avanzando por la semana. */
export function diasEntre(diaInicio: DiaSemana, diaFin: DiaSemana): DiaSemana[] {
  const dias: DiaSemana[] = [diaInicio];
  let cur = diaInicio;
  for (let i = 0; i < 7 && cur !== diaFin; i++) {
    cur = SIGUIENTE_DIA[cur];
    dias.push(cur);
  }
  return dias;
}

/**
 * Expande un bloque de cobertura continua en segmentos por día calendario.
 * Si condicionFestivoDiaFin está activa y diaFinEsFestivo=true, usa diaFinExtendido/horaFinExtendido
 * en lugar de diaFin/horaFin (ej: si el lunes es festivo, la cobertura llega hasta el martes).
 */
export function expandirBloqueContinuo(
  bloque: BloqueContinuoEntrada,
  diaFinEsFestivo: boolean,
): SegmentoTurno[] {
  const usarExtendido = bloque.condicionFestivoDiaFin && diaFinEsFestivo
    && bloque.diaFinExtendido !== null && bloque.horaFinExtendido !== null;
  const diaFinEfectivo  = usarExtendido ? bloque.diaFinExtendido!  : bloque.diaFin;
  const horaFinEfectivo = usarExtendido ? bloque.horaFinExtendido! : bloque.horaFin;

  const dias = diasEntre(bloque.diaInicio, diaFinEfectivo);
  const ini  = parseHora(bloque.horaInicio);
  const fin  = parseHora(horaFinEfectivo);

  if (dias.length === 1) {
    return [{ dias, inicioH: ini, durH: Math.max(0, fin - ini) }];
  }

  const segmentos: SegmentoTurno[] = [{ dias: [dias[0]], inicioH: ini, durH: 24 - ini }];
  for (let i = 1; i < dias.length - 1; i++) {
    segmentos.push({ dias: [dias[i]], inicioH: 0, durH: 24 });
  }
  segmentos.push({ dias: [dias[dias.length - 1]], inicioH: 0, durH: fin });
  return segmentos;
}

/** Duración total en horas de un bloque continuo (ya resuelta la extensión festiva). */
export function calcularHorasBloqueContinuo(bloque: BloqueContinuoEntrada, diaFinEsFestivo: boolean): number {
  return expandirBloqueContinuo(bloque, diaFinEsFestivo).reduce((s, seg) => s + seg.durH, 0);
}

// ─── 4. Descanso ──────────────────────────────────────────────────────────────

export function calcularHorasNetas(
  horasBrutas: number,
  descansoMinutos: number,
  descansoComputable: boolean,
): number {
  if (descansoComputable || descansoMinutos === 0) return horasBrutas;
  return Math.max(0, horasBrutas - descansoMinutos / 60);
}

// ─── 5. Clasificación nocturna ────────────────────────────────────────────────

export function contarHorasNocturnas(
  inicioH: number,
  durH: number,
  nocInicio: number,
  nocFin: number,
): number {
  const total = Math.round(durH);
  let noc = 0;
  for (let i = 0; i < total; i++) {
    const h = (Math.floor(inicioH) + i) % 24;
    const esNoc = nocInicio > nocFin
      ? (h >= nocInicio || h < nocFin)
      : (h >= nocInicio && h < nocFin);
    if (esNoc) noc++;
  }
  return noc;
}

/**
 * Un turno es "mixto" si tiene horas diurnas Y nocturnas en el mismo segmento.
 * Ajuste #6 Fase 1.1: usado para detectar descansos sin hora exacta en turnos mixtos.
 */
export function esTurnoMixto(
  horaInicio: string,
  horaFin: string,
  params: Pick<ParamsMotorMO, 'horaInicioNocturna' | 'horaFinNocturna'>,
): boolean {
  const brutas = calcularHorasBrutas(horaInicio, horaFin);
  const ini = parseHora(horaInicio);
  const noc = contarHorasNocturnas(ini, brutas, params.horaInicioNocturna, params.horaFinNocturna);
  return noc > 0 && noc < Math.round(brutas);
}

// ─── 6. Tipo de día — ajuste #3 arquitectura ─────────────────────────────────

/**
 * Calcula el tipo de día consultando CalendarioFestivos.
 * festivosSet: Set de "YYYY-MM-DD" cargado desde CalendarioFestivos en BD.
 *
 * NOTA Fase 2: siempre pasar fechaEspecifica cuando exista fechaInicioServicio.
 * tipoDiaGemini NO debe usarse como fallback cuando hay fecha concreta.
 */
export function consultarTipoDia(
  dia: DiaSemana,
  festivosSet: Set<string>,
  fechaEspecifica?: Date,
): TipoDia {
  const esDom = dia === 'D';
  let esFestivo = false;

  if (fechaEspecifica) {
    const key = fechaEspecifica.toISOString().slice(0, 10);
    esFestivo = festivosSet.has(key);
  }

  if (esDom && esFestivo) return 'dom_festivo';
  if (esDom)              return 'dominical';
  if (esFestivo)          return 'festivo';
  return 'habil';
}

export function festivosEnDiaSemana(
  diaSemana: DiaSemana,
  festivosSet: Set<string>,
): string[] {
  const MAP_JS: Record<number, DiaSemana> = { 0: 'D', 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S' };
  const resultado: string[] = [];
  festivosSet.forEach(iso => {
    const d = new Date(iso + 'T00:00:00Z');
    if (MAP_JS[d.getUTCDay()] === diaSemana) resultado.push(iso);
  });
  return resultado;
}

// ─── 7. Distribución ordinario/extra ─────────────────────────────────────────

interface AcumDesglose {
  ordDiu: number; ordNoc: number; extDiu: number; extNoc: number;
  domOrdDiu: number; domOrdNoc: number; domExtDiu: number; domExtNoc: number;
  festOrdDiu: number; festOrdNoc: number; festExtDiu: number; festExtNoc: number;
  totalSemana: number;
}

function acumVacio(): AcumDesglose {
  return {
    ordDiu: 0, ordNoc: 0, extDiu: 0, extNoc: 0,
    domOrdDiu: 0, domOrdNoc: 0, domExtDiu: 0, domExtNoc: 0,
    festOrdDiu: 0, festOrdNoc: 0, festExtDiu: 0, festExtNoc: 0,
    totalSemana: 0,
  };
}

export function procesarSegmento(
  inicioH: number,
  horasNetas: number,
  tipoDia: TipoDia,
  budget: number,
  acc: AcumDesglose,
  params: Pick<ParamsMotorMO, 'horaInicioNocturna' | 'horaFinNocturna'>,
): number {
  const consumePresupuesto = tipoDia === 'habil';
  const horasOrd = consumePresupuesto ? Math.min(horasNetas, budget) : horasNetas;
  const horasExt = consumePresupuesto ? horasNetas - horasOrd : 0;
  const nuevoBudget = consumePresupuesto ? budget - horasOrd : budget;

  const { horaInicioNocturna: ni, horaFinNocturna: nf } = params;
  const nocOrd = contarHorasNocturnas(inicioH, horasOrd, ni, nf);
  const diuOrd = horasOrd - nocOrd;
  const nocExt = contarHorasNocturnas(inicioH + horasOrd, horasExt, ni, nf);
  const diuExt = horasExt - nocExt;

  acc.totalSemana += horasNetas;

  switch (tipoDia) {
    case 'dominical':
    case 'dom_festivo':
      acc.domOrdDiu += diuOrd; acc.domOrdNoc += nocOrd;
      acc.domExtDiu += diuExt; acc.domExtNoc += nocExt;
      break;
    case 'festivo':
      acc.festOrdDiu += diuOrd; acc.festOrdNoc += nocOrd;
      acc.festExtDiu += diuExt; acc.festExtNoc += nocExt;
      break;
    default:
      acc.ordDiu += diuOrd; acc.ordNoc += nocOrd;
      acc.extDiu += diuExt; acc.extNoc += nocExt;
  }

  return nuevoBudget;
}

// ─── 8. Desglose semanal ─────────────────────────────────────────────────────

export function calcularDesgloseSemanale(
  cargo: CargoEntrada,
  params: ParamsMotorMO,
  festivosSet: Set<string> = new Set(),
  diasFestivosSemana: Set<DiaSemana> = new Set(),
): DesgloseSemanal {
  const bloques = cargo.bloquesContinuos ?? [];
  if ((!cargo.turnos || cargo.turnos.length === 0) && bloques.length === 0) {
    return { ...acumVacio(), horasExtra: 0, horasNocturnas: 0 };
  }

  const acc = acumVacio();
  let budget = params.jornadaMaxSemana;

  interface SegConMeta {
    seg: SegmentoTurno;
    factorNeto: number;
    tipoDiaGemini?: TipoDia;
    festivosIncluidos?: boolean | null;
  }

  const segmentos: SegConMeta[] = [];
  for (const turno of cargo.turnos) {
    // Ajuste #1 Fase 1.1: brutas = duración completa; netas = brutas − descanso
    const brutas = calcularHorasBrutas(turno.horaInicio, turno.horaFin);
    const netas  = calcularHorasNetas(brutas, turno.descansoMinutos, turno.descansoComputable);
    const factor = brutas > 0 ? netas / brutas : 0;
    for (const seg of dividirTurnoPorDiaCalendario(turno)) {
      segmentos.push({ seg, factorNeto: factor, tipoDiaGemini: turno.tipoDiaGemini, festivosIncluidos: turno.festivosIncluidos });
    }
  }

  for (const bloque of bloques) {
    const diaFinEsFestivo = diasFestivosSemana.has(bloque.diaFin);
    const brutas = calcularHorasBloqueContinuo(bloque, diaFinEsFestivo);
    const netas  = calcularHorasNetas(brutas, bloque.descansoMinutos, bloque.descansoComputable);
    const factor = brutas > 0 ? netas / brutas : 0;
    for (const seg of expandirBloqueContinuo(bloque, diaFinEsFestivo)) {
      segmentos.push({ seg, factorNeto: factor });
    }
  }

  for (const dia of ORDEN_DIAS) {
    for (const { seg, factorNeto, tipoDiaGemini, festivosIncluidos } of segmentos.filter(s => s.seg.dias.includes(dia))) {
      const horasNetasSeg = seg.durH * factorNeto;

      // Ajuste arquitectura #3: backend determina tipoDia.
      // Para 'D' siempre dominical. Festivo real (CalendarioFestivos, aproximado por día de
      // semana sin fecha exacta — ver NOTA Fase 2) tiene prioridad sobre la sugerencia de la IA,
      // salvo que el requisito declare explícitamente festivosIncluidos:false para ese turno.
      let tipoDia: TipoDia;
      if (dia === 'D') {
        tipoDia = 'dominical';
      } else if (cargo.diaDescansoObligatorio === dia && tipoDiaGemini === 'dominical') {
        tipoDia = 'habil'; // descanso pactado en día hábil → no dominical para presupuesto
      } else if (festivosIncluidos === false) {
        tipoDia = 'habil'; // override explícito del requisito: este turno no cubre festivos
      } else if (diasFestivosSemana.has(dia) || tipoDiaGemini === 'festivo' || tipoDiaGemini === 'dom_festivo') {
        tipoDia = 'festivo';
      } else {
        tipoDia = 'habil';
      }

      budget = procesarSegmento(seg.inicioH, horasNetasSeg, tipoDia, budget, acc, params);
    }
  }

  const horasExtra = acc.extDiu + acc.extNoc + acc.domExtDiu + acc.domExtNoc
    + acc.festExtDiu + acc.festExtNoc;
  const horasNocturnas = acc.ordNoc + acc.domOrdNoc + acc.festOrdNoc;

  return { ...acc, horasExtra, horasNocturnas };
}

// ─── 9. FTE y cobertura — ajuste #5 Fase 1.1 ─────────────────────────────────

export function calcularFTE(horasCoberturaSemanal: number, jornadaMax: number): number {
  if (jornadaMax <= 0) return 0;
  return horasCoberturaSemanal / jornadaMax;
}

export function calcularHorasCobertura(
  cargo: CargoEntrada,
  diasFestivosSemana: Set<DiaSemana> = new Set(),
): number {
  const horasTurnos = cargo.turnos.reduce((total, turno) => {
    return total + calcularHorasBrutas(turno.horaInicio, turno.horaFin) * turno.dias.length;
  }, 0);
  const horasBloques = (cargo.bloquesContinuos ?? []).reduce((total, bloque) => {
    return total + calcularHorasBloqueContinuo(bloque, diasFestivosSemana.has(bloque.diaFin));
  }, 0);
  return horasTurnos + horasBloques;
}

/**
 * Calcula campos FTE separados con semántica precisa.
 * Ajuste #5 Fase 1.1: requiereTurnante solo para puestos permanentes / 24/7.
 * Distingue horas de COBERTURA del servicio (lo que exige el requisito operativo)
 * de la JORNADA INDIVIDUAL máxima de un trabajador (params.jornadaMaxSemana):
 * nunca se asume que una sola persona cubre toda la cobertura.
 */
function calcularContextoFTE(
  cargo: CargoEntrada,
  horasCobertura: number,
  params: ParamsMotorMO,
): ContextoFTE {
  const fteTeorico = calcularFTE(horasCobertura, params.jornadaMaxSemana);

  // Personas necesarias sin ningún sobretiempo (conservador → para presupuesto)
  const personasSinHorasExtra = Math.max(1, Math.ceil(fteTeorico));

  // Personas si cada una puede hacer hasta 12h extra/sem (2h/día × 6 días, límite CST)
  const horasMaxConExtra = params.jornadaMaxSemana + 12;
  const personasConHorasExtra = Math.max(1, Math.ceil(horasCobertura / horasMaxConExtra));

  const requiereValidacionHorasExtra = personasConHorasExtra < personasSinHorasExtra;

  // requiereTurnante = true solo cuando es un puesto permanente con cobertura real que
  // supera lo que una persona puede hacer sin sobretiempo estructural, o trabaja domingos
  // (incluye domingos cubiertos por bloques continuos, ej. sábado→lunes).
  const esPuesto = cargo.tipoCobertura === 'puesto';
  const trabajaDomingos =
    cargo.turnos.some(t => t.dias.includes('D')) ||
    (cargo.bloquesContinuos ?? []).some(b => diasEntre(b.diaInicio, b.diaFin).includes('D'));
  const superaCapacidad = horasCobertura > params.jornadaMaxSemana;

  const requiereTurnante = esPuesto && (superaCapacidad || trabajaDomingos);

  return { fteTeorico, personasSinHorasExtra, personasConHorasExtra, requiereValidacionHorasExtra, requiereTurnante };
}

// Mantenido por compatibilidad (tests Fase 1)
export function detectarNecesidadTurnante(fteTeorico: number, cantidadSolicitada: number): boolean {
  return fteTeorico > cantidadSolicitada + 0.001;
}

// ─── 10. Validación jornada declarada vs calculada ────────────────────────────

export function validarJornadaDeclaradaVsCalculada(
  declarada: number | null,
  calculada: number,
  params: ParamsMotorMO,
): AlertaMO[] {
  const alertas: AlertaMO[] = [];

  if (declarada === null) {
    alertas.push({
      severidad: 'MEDIA',
      codigo: 'JORNADA_NO_DECLARADA',
      mensaje: 'No se declaró jornada semanal. Se usará la jornada calculada de los turnos.',
      campoAfectado: 'jornadaSemanalDeclarada',
    });
    return alertas;
  }

  const diff = Math.abs(calculada - declarada);
  if (diff < 0.1) return alertas;

  const excedeLegal = calculada > params.jornadaMaxSemana;

  if (excedeLegal) {
    alertas.push({
      severidad: 'CRITICA',
      codigo: 'EXCEDE_JORNADA_LEGAL',
      mensaje: `Los turnos calculan ${calculada.toFixed(1)}h/sem. Supera el máximo legal de ${params.jornadaMaxSemana}h (Ley 2101/2021). Las horas de exceso son EXTRA.`,
      campoAfectado: 'jornadaSemanalDeclarada',
      fuenteNormativa: 'Ley 2101/2021, CST art. 159',
    });
  }

  if (diff >= 4) {
    alertas.push({
      severidad: 'ALTA',
      codigo: 'JORNADA_INCONSISTENTE',
      mensaje: `Jornada declarada: ${declarada}h/sem. Calculada desde turnos: ${calculada.toFixed(1)}h/sem. Diferencia: ${diff.toFixed(1)}h.`,
      campoAfectado: 'jornadaSemanalDeclarada',
    });
  } else if (diff >= 1) {
    alertas.push({
      severidad: 'MEDIA',
      codigo: 'JORNADA_APROXIMADA',
      mensaje: `Jornada declarada (${declarada}h) difiere de la calculada (${calculada.toFixed(1)}h) en ${diff.toFixed(1)}h. Revisar.`,
      campoAfectado: 'jornadaSemanalDeclarada',
    });
  }

  return alertas;
}

// ─── 11. Inputs mensuales — ajustes #2 y #3 Fase 1.1 ────────────────────────

/**
 * Convierte desglose semanal → inputs mensuales.
 * Ajuste #2: tres campos de jornada separados (sin "horasSemanales" ambiguo).
 * Ajuste #3: exportableAlTabActual=false para puestos 24/7 o rotación.
 */
export function generarInputsMensuales(
  desglose: DesgloseSemanal,
  params: ParamsMotorMO,
  cargo: CargoEntrada,
  diasFestivosSemana: Set<DiaSemana> = new Set(),
): InputsMensuales {
  let factor: number;
  switch (params.metodoPeriodo) {
    case 'dias_mes':   factor = 30 / 7; break;
    default:           factor = params.factorMensual;
  }
  const m = (h: number) => Math.round(h * factor * 100) / 100;

  // Ajuste #2: horasServicioSemana = lo que esta persona/cargo trabaja (no cobertura total)
  const esPuesto = cargo.tipoCobertura === 'puesto';
  const horasServicioSemana = esPuesto
    ? params.jornadaMaxSemana                         // cada persona trabaja su jornada base
    : desglose.totalSemana;                            // la persona tiene exactamente este horario

  const horasOrdinariasSemana = desglose.ordDiu + desglose.ordNoc;

  // Ajuste #3: exportabilidad — puestos con cobertura real > jornadaMax requieren distribución
  const horasCoberturaPuesto = calcularHorasCobertura(cargo, diasFestivosSemana);
  const esCoberturaRotativa  = esPuesto && horasCoberturaPuesto > params.jornadaMaxSemana;
  const exportableAlTabActual = !esCoberturaRotativa;
  const modoCosteo: ModoCosteo = esCoberturaRotativa
    ? 'requiere_distribucion_por_rotacion'
    : 'individual';

  return {
    jornadaBaseLegalSemana:  params.jornadaMaxSemana,
    horasServicioSemana,
    horasOrdinariasSemana,
    hRecNocHabil:  m(desglose.ordNoc),
    hExtDiurHabil: m(desglose.extDiu),
    hExtNocHabil:  m(desglose.extNoc),
    hOrdDomDiu:    m(desglose.domOrdDiu),
    hOrdDomNoc:    m(desglose.domOrdNoc),
    hExtDomDiu:    m(desglose.domExtDiu),
    hExtDomNoc:    m(desglose.domExtNoc),
    hFestDiu:      m(desglose.festOrdDiu),
    hFestNoc:      m(desglose.festOrdNoc),
    hExtFestDiu:   m(desglose.festExtDiu),
    hExtFestNoc:   m(desglose.festExtNoc),
    modoCosteo,
    exportableAlTabActual,
    motivoNoExportable: !exportableAlTabActual
      ? `Puesto con ${horasCoberturaPuesto}h/sem de cobertura total requiere distribución entre ${Math.ceil(horasCoberturaPuesto / params.jornadaMaxSemana)} personas. Costear por persona individualmente.`
      : undefined,
    factorMensual:  factor,
    metodoPeriodo:  params.metodoPeriodo,
  };
}

// ─── 12. Alertas del cargo ────────────────────────────────────────────────────

export function generarAlertasCargo(
  cargo: CargoEntrada,
  desglose: DesgloseSemanal,
  params: ParamsMotorMO,
  preguntas: PreguntaMO[],
  fte: ContextoFTE,
): AlertaMO[] {
  const alertas: AlertaMO[] = [];

  // Sin turnos ni bloques continuos
  if ((!cargo.turnos || cargo.turnos.length === 0) && (cargo.bloquesContinuos ?? []).length === 0) {
    if (cargo.esJornadaParcialSinHoras) {
      alertas.push({
        severidad: 'ALTA',
        codigo: 'JORNADA_PARCIAL_SIN_HORAS',
        mensaje: `"${cargo.cargoNormalizado}" tiene jornada parcial declarada pero sin horario específico. No es posible calcular recargos ni FTE.`,
        campoAfectado: 'turnos',
      });
      preguntas.push({
        pregunta: `¿Cuáles son los días y horarios de trabajo para el ${cargo.cargoNormalizado} de tiempo parcial?`,
        prioridad: 'urgente',
        contexto: 'Necesario para calcular recargos nocturnos, dominicales y FTE exacto.',
      });
    } else {
      alertas.push({
        severidad: 'ALTA',
        codigo: 'FALTA_HORARIO',
        mensaje: `"${cargo.cargoNormalizado}": no se definieron turnos. No se puede calcular jornada real.`,
        campoAfectado: 'turnos',
      });
    }
    return alertas;
  }

  // Jornada declarada vs calculada
  alertas.push(...validarJornadaDeclaradaVsCalculada(
    cargo.jornadaSemanalDeclarada,
    desglose.totalSemana,
    params,
  ));

  // Ajuste #4 Fase 1.1: alerta explícita de cobertura insuficiente por FTE
  if (cargo.tipoCobertura === 'puesto' && fte.personasSinHorasExtra > cargo.cantidadSolicitada) {
    alertas.push({
      severidad: 'ALTA',
      codigo: 'COBERTURA_INSUFICIENTE_FTE',
      mensaje: `Este puesto requiere mínimo ${fte.personasSinHorasExtra} personas según FTE ${fte.fteTeorico.toFixed(2)}. No debe costearse como una sola persona.`,
      campoAfectado: 'cantidadSolicitada',
      fuenteNormativa: 'CST art. 167',
    });
  }

  // Requiere turnante: la cantidad propuesta es un cálculo pendiente de confirmar, no un dato cerrado
  if (fte.requiereTurnante) {
    alertas.push({
      severidad: 'MEDIA',
      codigo: 'COBERTURA_REQUIERE_TURNANTE',
      mensaje: 'La cobertura requiere múltiples trabajadores y turnante; la cantidad debe ser calculada y confirmada.',
      campoAfectado: 'cantidadSolicitada',
    });
  }

  // Validación horas extra: si se puede resolver con sobretiempo pero se necesita confirmación
  if (fte.requiereValidacionHorasExtra && cargo.tipoCobertura !== 'puesto') {
    alertas.push({
      severidad: 'MEDIA',
      codigo: 'VALIDAR_HORAS_EXTRA',
      mensaje: `Con ${fte.personasConHorasExtra} persona(s) se cubren las horas con sobretiempo legal. Con ${fte.personasSinHorasExtra} persona(s) no hay sobretiempo. Confirmar modalidad.`,
    });
  }

  // Horas extra estructurales elevadas
  if (desglose.horasExtra > 2 && cargo.tipoCobertura === 'persona') {
    alertas.push({
      severidad: desglose.horasExtra > 12 ? 'ALTA' : 'MEDIA',
      codigo: 'HORAS_EXTRA_ELEVADAS',
      mensaje: `Se detectan ${desglose.horasExtra.toFixed(1)}h/sem de horas extra. Verificar si es estructural o eventual. Máximo legal 2h/día (CST art. 159).`,
      fuenteNormativa: 'CST art. 159, Ley 2101/2021',
    });
  }

  // Horas extra en puesto (informativa, no duplicar con COBERTURA_INSUFICIENTE)
  if (desglose.horasExtra > 2 && cargo.tipoCobertura === 'puesto') {
    alertas.push({
      severidad: 'ALTA',
      codigo: 'HORAS_EXTRA_ELEVADAS',
      mensaje: `El puesto genera ${desglose.horasExtra.toFixed(1)}h/sem de horas extra en el desglose. Distribuir entre ${fte.personasSinHorasExtra} personas elimina el sobretiempo estructural.`,
      fuenteNormativa: 'CST art. 159, Ley 2101/2021',
    });
  }

  // Ajuste #6 Fase 1.1: descanso en turno mixto sin hora exacta definida
  for (const turno of cargo.turnos) {
    if (
      turno.descansoMinutos > 0 &&
      !turno.descansoComputable &&
      turno.metodoDistribucionDescanso !== 'exacto' &&
      esTurnoMixto(turno.horaInicio, turno.horaFin, params)
    ) {
      alertas.push({
        severidad: 'MEDIA',
        codigo: 'DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO',
        mensaje: `Turno ${turno.horaInicio}–${turno.horaFin} mezcla horas diurnas y nocturnas con descanso de ${turno.descansoMinutos}min sin hora exacta. La distribución proporcional puede subclasificar recargos nocturnos.`,
        campoAfectado: 'descansoHoraInicio',
      });
      break; // Una alerta por cargo es suficiente
    }
  }

  // ARL no validada
  if (cargo.requiereValidacionArl || !cargo.claseRiesgoArl) {
    alertas.push({
      severidad: 'ALTA',
      codigo: 'ARL_SIN_VALIDAR',
      mensaje: `La clase de riesgo ARL para "${cargo.cargoNormalizado}" debe confirmarse antes de costear.`,
      campoAfectado: 'claseRiesgoArl',
      fuenteNormativa: 'Decreto 1772/1994',
    });
  }

  // Todero / Alturas
  if (cargo.requiereAlturas === null && cargo.cargoNormalizado.toLowerCase().includes('todero')) {
    alertas.push({
      severidad: 'ALTA',
      codigo: 'ALTURAS_SIN_CONFIRMAR',
      mensaje: `Todero: confirmar si requiere trabajo en alturas (>1.5m). Cambia clase ARL y EPP obligatorio.`,
      campoAfectado: 'requiereAlturas',
      fuenteNormativa: 'Resolución 4272/2021 Min. Trabajo',
    });
    preguntas.push({
      pregunta: `¿El Todero realizará trabajos en alturas (>1.5m, escaleras, fachadas, cubiertas)?`,
      prioridad: 'urgente',
      contexto: 'Determina clase ARL III o mayor, y obliga a examen médico de alturas.',
    });
  }

  // Piscinero / Salvavidas
  if (cargo.esPiscinero && !cargo.esSalvavidas && !cargo.esPiscineroSalvavidas) {
    preguntas.push({
      pregunta: `¿El Piscinero también cumple funciones de Salvavidas certificado?`,
      prioridad: 'normal',
      contexto: 'Si sí, debe tener certificación vigente y el cargo cambia a Piscinero/Salvavidas (ARL IV).',
    });
  }

  return alertas;
}

// ─── 13. Orquestador principal ────────────────────────────────────────────────

export function procesarCargo(
  cargo: CargoEntrada,
  params: ParamsMotorMO,
  festivosSet: Set<string> = new Set(),
  diasFestivosSemana: Set<DiaSemana> = new Set(),
): ResultadoCargo {
  const preguntas: PreguntaMO[] = [];

  const desglose          = calcularDesgloseSemanale(cargo, params, festivosSet, diasFestivosSemana);
  const jornadaCalculada  = desglose.totalSemana;
  const jornadaDeclarada  = cargo.jornadaSemanalDeclarada;
  const diferenciaHoras   = jornadaDeclarada !== null ? jornadaCalculada - jornadaDeclarada : 0;

  // FTE con campos separados (ajuste #5)
  const horasCobertura = calcularHorasCobertura(cargo, diasFestivosSemana);
  const fte            = calcularContextoFTE(cargo, horasCobertura, params);

  // Inputs mensuales (ajustes #2 y #3)
  const inputsMensuales = generarInputsMensuales(desglose, params, cargo, diasFestivosSemana);

  // Alertas (ajustes #4 y #6)
  const alertas = generarAlertasCargo(cargo, desglose, params, preguntas, fte);

  return {
    desgloseSemanal: desglose,
    jornadaCalculada,
    jornadaDeclarada,
    coincideJornada: Math.abs(diferenciaHoras) < 0.5,
    diferenciaHoras,
    fteTeorico:                  fte.fteTeorico,
    personasSinHorasExtra:       fte.personasSinHorasExtra,
    personasConHorasExtra:       fte.personasConHorasExtra,
    cantidadPersonasCalculadas:  fte.personasSinHorasExtra,
    cantidadPuestosPorTurno:     cargo.cantidadSolicitada,
    requiereValidacionHorasExtra: fte.requiereValidacionHorasExtra,
    requiereTurnante:            fte.requiereTurnante,
    inputsMensuales,
    alertas,
    preguntas,
  };
}

// ─── 14. Distribución por trabajador ──────────────────────────────────────────

/**
 * Buckets mensuales de horas por trabajador — dominical y festivo combinados
 * bajo una sola etiqueta "dominical/festiva" (ver docs/plan-implementacion-mano-obra.md
 * y el objeto de mapeo pedido para conectar el análisis operativo con la liquidación).
 */
export interface HorasMensualesTrabajadorMotor {
  ordinarias: number;
  recargoNocturnoHabil: number;
  extraDiurnaHabil: number;
  extraNocturnaHabil: number;
  ordinariaDominicalDiurna: number;
  ordinariaDominicalNocturna: number;
  extraDominicalDiurna: number;
  extraDominicalNocturna: number;
}

export interface TrabajadorAsignadoMotor {
  identificador: string;
  horasMensuales: HorasMensualesTrabajadorMotor;
  origen: 'calculado';
}

export interface DistribucionCargoMotor {
  cargoId: string;
  cantidadPersonasCalculada: number;
  trabajadores: TrabajadorAsignadoMotor[];
  consolidadoCargo: { horasMensuales: HorasMensualesTrabajadorMotor };
}

function round2Motor(n: number): number { return Math.round(n * 100) / 100; }

/**
 * Consolida los 11 buckets del motor (dominical y festivo separados) en los 8
 * buckets del objeto de distribución (dominical/festiva combinados), y mensualiza
 * "ordinarias" con el mismo factorMensual que ya usan los demás buckets.
 */
export function consolidarHorasMensualesTrabajador(im: InputsMensuales): HorasMensualesTrabajadorMotor {
  return {
    ordinarias: Math.round(im.horasOrdinariasSemana * im.factorMensual * 100) / 100,
    recargoNocturnoHabil: im.hRecNocHabil,
    extraDiurnaHabil: im.hExtDiurHabil,
    extraNocturnaHabil: im.hExtNocHabil,
    ordinariaDominicalDiurna: round2Motor(im.hOrdDomDiu + im.hFestDiu),
    ordinariaDominicalNocturna: round2Motor(im.hOrdDomNoc + im.hFestNoc),
    extraDominicalDiurna: round2Motor(im.hExtDomDiu + im.hExtFestDiu),
    extraDominicalNocturna: round2Motor(im.hExtDomNoc + im.hExtFestNoc),
  };
}

function dividirBuckets(h: HorasMensualesTrabajadorMotor, n: number): HorasMensualesTrabajadorMotor {
  const d = (v: number) => round2Motor(v / n);
  return {
    ordinarias: d(h.ordinarias),
    recargoNocturnoHabil: d(h.recargoNocturnoHabil),
    extraDiurnaHabil: d(h.extraDiurnaHabil),
    extraNocturnaHabil: d(h.extraNocturnaHabil),
    ordinariaDominicalDiurna: d(h.ordinariaDominicalDiurna),
    ordinariaDominicalNocturna: d(h.ordinariaDominicalNocturna),
    extraDominicalDiurna: d(h.extraDominicalDiurna),
    extraDominicalNocturna: d(h.extraDominicalNocturna),
  };
}

/**
 * Distribuye la cobertura mensual del cargo entre los N trabajadores calculados
 * (personasSinHorasExtra / cantidadPersonasCalculadas). Reparto EQUITATIVO por
 * ausencia de información de qué persona específica cubre cada turno — evita el
 * error de liquidar toda la cobertura como si fuera de 1 sola persona y multiplicar
 * por N. El usuario puede sobre-escribir cada trabajador en la UI antes de confirmar
 * (el "origen" se marca "manual" en ese punto, fuera de este motor puro).
 *
 * Σ trabajadores ≈ consolidadoCargo (puede diferir en centésimas por redondeo a 2 decimales
 * por trabajador cuando la división no es exacta).
 */
export function distribuirCargoEntreTrabajadores(
  cargoId: string,
  resultado: ResultadoCargo,
): DistribucionCargoMotor {
  const n = Math.max(1, resultado.cantidadPersonasCalculadas);
  const totalCargo = consolidarHorasMensualesTrabajador(resultado.inputsMensuales);
  const porTrabajador = dividirBuckets(totalCargo, n);

  const trabajadores: TrabajadorAsignadoMotor[] = Array.from({ length: n }, (_, i) => ({
    identificador: `trabajador-${i + 1}`,
    horasMensuales: { ...porTrabajador },
    origen: 'calculado' as const,
  }));

  return {
    cargoId,
    cantidadPersonasCalculada: n,
    trabajadores,
    consolidadoCargo: { horasMensuales: totalCargo },
  };
}