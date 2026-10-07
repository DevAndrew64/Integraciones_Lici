/**
 * Resolutor PURO de la fecha aplicable de TRM — FASE A.1.
 *
 * Tres capas separadas:
 *   1. REGLA          (tipoReglaTrm + eventoBaseTrm + offsetDiasHabiles / fechaFijaTrm) — vive en ReglaTrmProceso
 *   2. RESOLUTOR      (esta función) — no escribe BD
 *   3. FECHA RESUELTA (fechaTrmAplicableResuelta) — se CONGELA dentro de cada RecomendacionEconomica
 *
 * Una recomendación histórica NUNCA vuelve a resolver su fecha: se lee la
 * congelada + `insumosResolucionFecha`.
 */

export type TipoReglaTrm = 'RELATIVA_A_EVENTO' | 'FECHA_FIJA' | 'NO_APLICA' | 'OTRA';
export type EventoBaseTrm =
  | 'FECHA_CIERRE' | 'FECHA_PRESENTACION_OFERTAS' | 'FIN_TRASLADO_INFORME_EVALUACION'
  | 'AUDIENCIA_ADJUDICACION' | 'OTRO';
/** SIGUE_CRONOGRAMA: usa la fecha VIGENTE del evento base. CONGELADA_INICIAL:
 *  usa `fechaBaseCongelada` aunque el cronograma haya cambiado después
 *  (caso real: audiencia de adjudicación — se conserva la fecha prevista
 *  en la resolución de apertura). */
export type PoliticaActualizacionFechaTrm = 'SIGUE_CRONOGRAMA' | 'CONGELADA_INICIAL' | 'OTRA';

export interface ReglaTrmParaResolver {
  tipoReglaTrm: TipoReglaTrm;
  eventoBaseTrm: EventoBaseTrm | null;
  fuenteEventoBase: string | null;
  offsetDiasHabiles: number | null;
  politicaActualizacionFecha: PoliticaActualizacionFechaTrm | null;
  /** requerida cuando politicaActualizacionFecha = CONGELADA_INICIAL (YYYY-MM-DD). */
  fechaBaseCongelada: string | null;
  fechaFijaTrm: string | null; // YYYY-MM-DD
  calendarioHabil: string | null;
  zonaHoraria: string | null;
}

export interface CronogramaVigente {
  /** fecha YYYY-MM-DD del evento base, tal como está en el cronograma AHORA. */
  fechaEventoBase: string | null;
  /** identificador/fuente del evento (ProcesoCronogramaSecop.id, "Solicitud.fechaCierre", "manual"). */
  eventoCronogramaRef: unknown;
  /** snapshot suficiente para auditar sin re-resolver. */
  cronogramaSnapshot: unknown;
  cronogramaHash: string;
}

export interface CalendarioHabil {
  id: string;                                   // "colombia_trm"
  hash: string;                                 // hash del contenido de festivos
  esHabil: (fechaISO: string) => boolean;       // inyectable — reutiliza calendarioHabil.ts en producción
}

export interface ResultadoResolucionFecha {
  fechaTrmAplicableResuelta: string;            // YYYY-MM-DD
  insumosResolucionFecha: {
    tipoReglaTrm: TipoReglaTrm;
    eventoBaseTrm: EventoBaseTrm | null;
    fuenteEventoBase: string | null;
    offsetDiasHabiles: number | null;
    politicaActualizacionFecha: PoliticaActualizacionFechaTrm | null;
    fechaEventoBaseUsada: string | null;
    eventoCronogramaRef: unknown;
    cronogramaSnapshot: unknown;
    cronogramaHash: string;
    calendarioHabilId: string;
    calendarioHabilHash: string;
    zonaHoraria: string;
    resueltoEn: string;                          // ISO timestamp
    versionResolutor: string;
  };
}

export const VERSION_RESOLUTOR = 'regla-trm-resolver-1.0.0';

function sumarDiasCalendario(fechaISO: string, n: number): string {
  const d = new Date(fechaISO + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function avanzarDiasHabiles(fechaISO: string, n: number, cal: CalendarioHabil): string {
  let fecha = fechaISO;
  let restantes = n;
  const paso = n >= 0 ? 1 : -1;
  // n=0 => si el día base no es hábil, se mueve al siguiente hábil en la dirección +.
  if (restantes === 0) {
    while (!cal.esHabil(fecha)) fecha = sumarDiasCalendario(fecha, 1);
    return fecha;
  }
  while (restantes !== 0) {
    fecha = sumarDiasCalendario(fecha, paso);
    if (cal.esHabil(fecha)) restantes -= paso;
  }
  return fecha;
}

/**
 * Resuelve la fecha aplicable AL MOMENTO de generar la recomendación.
 * Lanza si falta un insumo obligatorio (la recomendación NO se genera con
 * fecha inventada).
 */
export function resolverFechaTrmAplicable(
  regla: ReglaTrmParaResolver,
  crono: CronogramaVigente,
  cal: CalendarioHabil,
  ahoraISO: string = new Date().toISOString(),
): ResultadoResolucionFecha {
  let fecha: string;
  let fechaEventoBaseUsada: string | null = null;

  if (regla.tipoReglaTrm === 'FECHA_FIJA') {
    if (!regla.fechaFijaTrm) throw new Error('tipoReglaTrm = FECHA_FIJA pero fechaFijaTrm es null.');
    fecha = regla.fechaFijaTrm;
  } else if (regla.politicaActualizacionFecha === 'CONGELADA_INICIAL') {
    // La fecha base NO se recalcula del cronograma vigente aunque haya cambiado
    // después (caso real: audiencia de adjudicación con fecha conservada de la
    // resolución de apertura).
    if (!regla.fechaBaseCongelada) throw new Error('politicaActualizacionFecha = CONGELADA_INICIAL pero fechaBaseCongelada es null.');
    fechaEventoBaseUsada = regla.fechaBaseCongelada;
    const offset = regla.offsetDiasHabiles ?? 0;
    fecha = avanzarDiasHabiles(regla.fechaBaseCongelada, offset, cal);
  } else {
    if (!crono.fechaEventoBase) {
      throw new Error(`No hay fecha del evento base (${regla.eventoBaseTrm ?? 'desconocido'}) en el cronograma vigente. Recomendación bloqueada.`);
    }
    fechaEventoBaseUsada = crono.fechaEventoBase;
    const offset = regla.offsetDiasHabiles ?? 0;
    fecha = avanzarDiasHabiles(crono.fechaEventoBase, offset, cal);
  }

  return {
    fechaTrmAplicableResuelta: fecha,
    insumosResolucionFecha: {
      tipoReglaTrm: regla.tipoReglaTrm,
      eventoBaseTrm: regla.eventoBaseTrm,
      fuenteEventoBase: regla.fuenteEventoBase,
      offsetDiasHabiles: regla.offsetDiasHabiles,
      politicaActualizacionFecha: regla.politicaActualizacionFecha,
      fechaEventoBaseUsada,
      eventoCronogramaRef: crono.eventoCronogramaRef,
      cronogramaSnapshot: crono.cronogramaSnapshot,
      cronogramaHash: crono.cronogramaHash,
      calendarioHabilId: cal.id,
      calendarioHabilHash: cal.hash,
      zonaHoraria: regla.zonaHoraria ?? 'America/Bogota',
      resueltoEn: ahoraISO,
      versionResolutor: VERSION_RESOLUTOR,
    },
  };
}
