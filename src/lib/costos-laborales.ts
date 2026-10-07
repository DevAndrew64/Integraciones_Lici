/**
 * Motor determinístico de cálculo laboral colombiano
 * Fuentes: Ley 2101/2021, Ley 2466/2025, CST art.168/179, Decreto 1772/1994
 */

export type DiaSemana = 'L' | 'M' | 'X' | 'J' | 'V' | 'S' | 'D';

export interface TurnoInput {
  dias: DiaSemana[];
  horaInicio: string; // "HH:MM" en 24h
  horaFin: string;   // "HH:MM" — si < horaInicio cruza medianoche
}

export interface ParamsLaborales {
  smmlv: number;
  auxilioTransporte: number;
  topeAuxilioSmmlv: number;   // ej. 2.0 → aplica si salario ≤ 2×SMMLV
  horasMaxSemana: number;     // 44 en 2026
  horaInicioNocturna: number; // 19 (Ley 2466/2025)
  horaFinNocturna: number;    // 6
  recargoNocturno: number;    // 0.35
  recargoExtraDiurno: number; // 0.25
  recargoExtraNocturno: number; // 0.75
  recargoDominical: number;   // 0.75
  riesgoArl: number;          // ej. 0.01044 para Riesgo II
}

export interface HorasDesglose {
  /** Ordinaria diurna hábil (sin recargo) */
  ordDiu: number;
  /** Ordinaria nocturna hábil (+35%) */
  ordNoc: number;
  /** Extra diurna hábil (+25%) */
  extDiu: number;
  /** Extra nocturna hábil (+75%) */
  extNoc: number;
  /** Ordinaria dom/fest diurna (+75%) */
  ordDomDiu: number;
  /** Ordinaria dom/fest nocturna (+75%+35%) */
  ordDomNoc: number;
  /** Extra dom/fest diurna (+75%+25%) */
  extDomDiu: number;
  /** Extra dom/fest nocturna (+75%+25%+35%) */
  extDomNoc: number;
  totalSemana: number;
  horasExtra: number;
  horasNocturnas: number; // ordinarias nocturnas con recargo
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** "HH:MM" → decimal (ej. "23:30" → 23.5) */
function parseH(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h + (m ?? 0) / 60;
}

/** Número de horas enteras en [inicio, fin) que caen en rango nocturno */
function countNoc(inicio: number, fin: number, inicNoc: number, finNoc: number): number {
  // inicNoc=19, finNoc=6 → spans midnight
  let n = 0;
  const total = Math.round(fin - inicio); // horas enteras
  for (let i = 0; i < total; i++) {
    const h = (Math.floor(inicio) + i) % 24;
    const esNoc = inicNoc > finNoc
      ? (h >= inicNoc || h < finNoc)   // spans midnight (caso normal 19-6)
      : (h >= inicNoc && h < finNoc);
    if (esNoc) n++;
  }
  return n;
}

// Días dominicales/festivos — D es domingo; festivos deben marcarse también como 'D'
const DOMINICALES = new Set<DiaSemana>(['D']);

// Orden cronológico de días en la semana para respetar el budget de horas ordinarias
const ORDEN_DIAS: DiaSemana[] = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

// ─── Motor principal ──────────────────────────────────────────────────────────

/**
 * Calcula el desglose de horas semanales a partir de los turnos definidos.
 * El presupuesto de horas ordinarias (horasMaxSemana) se agota en orden L→D.
 * Las horas que exceden ese presupuesto son "horas extra".
 */
export function calcularDesgloseSemanal(
  turnos: TurnoInput[],
  params: Pick<ParamsLaborales, 'horasMaxSemana' | 'horaInicioNocturna' | 'horaFinNocturna'>,
): HorasDesglose {
  const { horasMaxSemana: maxH, horaInicioNocturna: inicNoc, horaFinNocturna: finNoc } = params;
  const res: HorasDesglose = {
    ordDiu: 0, ordNoc: 0, extDiu: 0, extNoc: 0,
    ordDomDiu: 0, ordDomNoc: 0, extDomDiu: 0, extDomNoc: 0,
    totalSemana: 0, horasExtra: 0, horasNocturnas: 0,
  };

  let budget = maxH; // horas ordinarias restantes

  for (const dia of ORDEN_DIAS) {
    for (const turno of turnos) {
      if (!turno.dias.includes(dia)) continue;

      const inicio = parseH(turno.horaInicio);
      let fin = parseH(turno.horaFin);
      if (fin <= inicio) fin += 24; // turno cruza medianoche
      const duracion = Math.round(fin - inicio); // horas enteras

      res.totalSemana += duracion;
      const esDom = DOMINICALES.has(dia);

      // Horas ordinarias de este turno
      const horasOrd = Math.min(duracion, budget);
      budget -= horasOrd;
      const horasExt = duracion - horasOrd;

      // Clasificar porción ordinaria (horas cronológicas primeras del turno)
      const nocOrd = countNoc(inicio, inicio + horasOrd, inicNoc, finNoc);
      const diuOrd = horasOrd - nocOrd;

      // Clasificar porción extra (horas cronológicas finales del turno)
      const nocExt = countNoc(inicio + horasOrd, fin, inicNoc, finNoc);
      const diuExt = horasExt - nocExt;

      if (esDom) {
        res.ordDomNoc += nocOrd;
        res.ordDomDiu += diuOrd;
        res.extDomNoc += nocExt;
        res.extDomDiu += diuExt;
      } else {
        res.ordNoc += nocOrd;
        res.ordDiu += diuOrd;
        res.extNoc += nocExt;
        res.extDiu += diuExt;
      }
    }
  }

  res.horasExtra = res.extDiu + res.extNoc + res.extDomDiu + res.extDomNoc;
  res.horasNocturnas = res.ordNoc; // las nocturnas ordinarias que llevan recargo
  return res;
}

/** Factor × 4.333 para convertir horas/semana → horas/mes */
const FACTOR_MENSUAL = 4.333;

/** Redondea a entero más próximo */
const rm = (n: number) => Math.round(n);

/** Convierte desglose semanal a valores mensuales para los inputs del formulario */
export function desgloseAInputsMensuales(d: HorasDesglose) {
  return {
    horasSemanales: 44, // siempre usar el máximo ordinario; las extra se cargan por separado
    hRecNocHabil: rm(d.ordNoc * FACTOR_MENSUAL),
    hExtDiurHabil: rm(d.extDiu * FACTOR_MENSUAL),
    hExtNocHabil: rm(d.extNoc * FACTOR_MENSUAL),
    hOrdDomDiu: rm(d.ordDomDiu * FACTOR_MENSUAL),
    hOrdDomNoc: rm(d.ordDomNoc * FACTOR_MENSUAL),
    hExtDomDiu: rm(d.extDomDiu * FACTOR_MENSUAL),
    hExtDomNoc: rm(d.extDomNoc * FACTOR_MENSUAL),
  } as const;
}

// ─── Validaciones laborales ───────────────────────────────────────────────────

export interface AlertaLaboral {
  tipo: 'error' | 'advertencia' | 'info';
  campo?: string;
  mensaje: string;
  fuente?: string;
}

export interface FormularioActual {
  horasSemanales: number;
  salBase: number;
  conAux: boolean;
  auxValor: number;
  hRecNocHabil: number;
  hExtDiurHabil: number;
  hExtNocHabil: number;
  hOrdDomDiu: number;
  hOrdDomNoc: number;
  hExtDomDiu: number;
  hExtDomNoc: number;
}

/**
 * Genera alertas comparando el texto analizado con los valores del formulario.
 */
export function generarAlertas(
  desglose: HorasDesglose,
  sugeridos: ReturnType<typeof desgloseAInputsMensuales>,
  formulario: FormularioActual,
  params: ParamsLaborales,
): AlertaLaboral[] {
  const alertas: AlertaLaboral[] = [];

  // 1. Horas semanales reales vs límite legal
  if (desglose.totalSemana > params.horasMaxSemana) {
    alertas.push({
      tipo: 'advertencia',
      campo: 'horasSemanales',
      mensaje: `El turno implica ${desglose.totalSemana}h/sem, que superan el máximo ordinario de ${params.horasMaxSemana}h (Ley 2101/2021). Las ${desglose.horasExtra}h adicionales son horas extra y deben pagarse con recargo.`,
      fuente: 'Ley 2101 de 2021 art.2 / CST art.168',
    });
  }

  // 2. Trabajo nocturno detectado pero sin recargo configurado
  if (desglose.ordNoc > 0 && formulario.hRecNocHabil === 0) {
    alertas.push({
      tipo: 'error',
      campo: 'hRecNocHabil',
      mensaje: `Se detectan ${desglose.ordNoc}h/sem de trabajo nocturno ordinario (≈${sugeridos.hRecNocHabil}h/mes), pero el formulario tiene Recargo nocturno = 0. Aplicar 35% adicional. Ley 2466/2025: nocturna inicia a las ${params.horaInicioNocturna}:00 (antes era 21:00).`,
      fuente: 'Ley 2466/2025 art.1 / CST art.168',
    });
  }

  // 3. Horas extra sin configurar
  if (desglose.horasExtra > 0) {
    const faltanExt = (sugeridos.hExtDiurHabil > 0 && formulario.hExtDiurHabil === 0)
      || (sugeridos.hExtNocHabil > 0 && formulario.hExtNocHabil === 0);
    if (faltanExt) {
      alertas.push({
        tipo: 'error',
        campo: 'hExtNocHabil',
        mensaje: `El turno genera ${desglose.horasExtra}h extra/sem (≈${sugeridos.hExtNocHabil}h noc + ${sugeridos.hExtDiurHabil}h diu por mes). El formulario no las refleja. HED +25%, HEN +75% sobre valor/hora.`,
        fuente: 'CST art.168 mod. Ley 50/1990',
      });
    }
  }

  // 4. Salario mínimo
  if (params.smmlv > 0 && formulario.salBase < params.smmlv) {
    alertas.push({
      tipo: 'error',
      campo: 'salBase',
      mensaje: `El salario base ($${formulario.salBase.toLocaleString('es-CO')}) es inferior al SMMLV 2026 ($${params.smmlv.toLocaleString('es-CO')}). Incumple CST art.145.`,
      fuente: 'Decreto 2762/2024 / CST art.145',
    });
  }

  // 5. Auxilio de transporte
  const tope = params.smmlv * params.topeAuxilioSmmlv;
  if (formulario.salBase <= tope && !formulario.conAux) {
    alertas.push({
      tipo: 'advertencia',
      campo: 'conAux',
      mensaje: `El salario ($${formulario.salBase.toLocaleString('es-CO')}) ≤ ${params.topeAuxilioSmmlv}×SMMLV ($${tope.toLocaleString('es-CO')}), por lo que aplica auxilio de transporte ($${params.auxilioTransporte.toLocaleString('es-CO')}). Verificar si la empresa tiene excepción legal.`,
      fuente: 'Ley 15/1959 / Decreto 2763/2024',
    });
  }
  if (formulario.salBase > tope && formulario.conAux) {
    alertas.push({
      tipo: 'advertencia',
      campo: 'conAux',
      mensaje: `El salario ($${formulario.salBase.toLocaleString('es-CO')}) > ${params.topeAuxilioSmmlv}×SMMLV ($${tope.toLocaleString('es-CO')}). El auxilio de transporte NO aplica salvo excepción contractual.`,
      fuente: 'Ley 15/1959 / Decreto 2763/2024',
    });
  }

  // 6. Base de cotización a seguridad social
  if (desglose.horasExtra > 0) {
    alertas.push({
      tipo: 'info',
      mensaje: `Recuerde: las horas extra y recargos salariales INTEGRAN el Ingreso Base de Cotización (IBC) para pensión, ARL y caja. La base debe incluir el valor pagado por HE y recargos, no solo el salario básico.`,
      fuente: 'CST art.127 / Ley 100/1993 art.18 / Dec.1072/2015',
    });
  }

  // 7. Nocturna Ley 2466 — solo informativo si se detectó trabajo nocturno
  if (desglose.ordNoc > 0 || desglose.extNoc > 0) {
    alertas.push({
      tipo: 'info',
      mensaje: `Ley 2466 de 2025 (vigente): jornada nocturna comienza a las 19:00 y termina a las 06:00. Antes de esta ley (Ley 50/1990) iniciaba a las 21:00. Verifique que los cálculos de recargo nocturno usen el horario actualizado.`,
      fuente: 'Ley 2466 de 2025 art.1',
    });
  }

  return alertas;
}

// ─── Resumen del caso ─────────────────────────────────────────────────────────

export interface ResumenCalculo {
  desgloseSemanal: HorasDesglose;
  inputsMensualesSugeridos: ReturnType<typeof desgloseAInputsMensuales>;
  alertas: AlertaLaboral[];
  smmlv: number;
  auxilioTransporte: number;
  aplicaAuxilio: boolean;
  fuentes: Record<string, string>;
}

export function calcularResumen(
  turnos: TurnoInput[],
  formulario: FormularioActual,
  params: ParamsLaborales,
  fuentesNormativas: Record<string, string>,
): ResumenCalculo {
  const desglose = calcularDesgloseSemanal(turnos, params);
  const sugeridos = desgloseAInputsMensuales(desglose);
  const alertas = generarAlertas(desglose, sugeridos, formulario, params);
  const aplicaAuxilio = formulario.salBase <= params.smmlv * params.topeAuxilioSmmlv;

  return {
    desgloseSemanal: desglose,
    inputsMensualesSugeridos: sugeridos,
    alertas,
    smmlv: params.smmlv,
    auxilioTransporte: params.auxilioTransporte,
    aplicaAuxilio,
    fuentes: fuentesNormativas,
  };
}