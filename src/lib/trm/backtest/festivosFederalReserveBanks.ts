/**
 * Calendario de festivos de los Federal Reserve Banks (NO el calendario
 * laboral de OPM ni las recomendaciones de cierre de SIFMA/mercado de
 * bonos — son calendarios distintos con reglas de observancia distintas).
 *
 * Fuente normativa/conceptual verificada (26-ago-2026, vía WebSearch/WebFetch):
 *   - Federal Reserve Financial Services, "Federal Reserve System Holiday
 *     Schedule": https://www.frbservices.org/about/holiday-schedules
 *     → confirma los 11 festivos y las reglas de observancia sábado/domingo
 *       usadas aquí, textualmente:
 *       "For holidays falling on Saturday, Federal Reserve Banks and
 *        Branches will be open the preceding Friday."
 *       "For holidays falling on Sunday, Federal Reserve Banks and
 *        Branches will be closed the following Monday."
 *   - Confirmación cruzada de que Juneteenth es festivo Fed desde 2022
 *     (no 2021 — el Fed no lo observó en su primer año de vigencia legal;
 *     2022 fue el primer año con cierre real, domingo 19-jun-2022 →
 *     lunes 20-jun-2022 cerrado).
 *
 * Todas las fechas son 'YYYY-MM-DD', calculadas con Date.UTC + mediodía UTC
 * para evitar cualquier corrimiento por zona horaria (mismo patrón que
 * calendarioHabil.ts, sin tocar ese archivo).
 */

// ─── Utilidades de fecha (inmunes a zona horaria) ────────────────────────────

function fecha(anio: number, mes0: number, dia: number): Date {
  return new Date(Date.UTC(anio, mes0, dia, 12));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDias(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/** N-ésima ocurrencia (1-indexado) de `diaSemana` (0=domingo..6=sábado) en anio/mes0. */
function nEsimoDiaSemana(anio: number, mes0: number, diaSemana: number, n: number): Date {
  let d = fecha(anio, mes0, 1);
  let contador = 0;
  while (true) {
    if (d.getUTCDay() === diaSemana) {
      contador++;
      if (contador === n) return d;
    }
    d = addDias(d, 1);
  }
}

/** Última ocurrencia de `diaSemana` en anio/mes0. */
function ultimoDiaSemana(anio: number, mes0: number, diaSemana: number): Date {
  const ultimoDiaMes = new Date(Date.UTC(anio, mes0 + 1, 0, 12));
  let d = ultimoDiaMes;
  while (d.getUTCDay() !== diaSemana) d = addDias(d, -1);
  return d;
}

/**
 * Regla de observancia Fed para festivos de FECHA FIJA:
 *  - cae sábado → NO se observa (el viernes anterior permanece abierto;
 *    el propio sábado ya es no elegible por ser fin de semana, sin
 *    necesidad de marcar nada);
 *  - cae domingo → se observa el LUNES siguiente (ese lunes queda cerrado);
 *  - cualquier otro día → se observa la fecha exacta.
 * Los festivos de "n-ésimo día de semana" (MLK, Washington, Memorial,
 * Labor, Columbus, Thanksgiving) NUNCA caen sábado/domingo por
 * construcción, así que no pasan por esta función.
 */
function observanciaFechaFija(d: Date): Date | null {
  const dow = d.getUTCDay();
  if (dow === 6) return null; // sábado: sin observancia, viernes queda abierto
  if (dow === 0) return addDias(d, 1); // domingo: se observa el lunes
  return d;
}

// ─── Calendario anual ─────────────────────────────────────────────────────────

const _cache = new Map<number, Set<string>>();

/** Primer año en que el Federal Reserve observó Juneteenth (ver fuente arriba). */
export const JUNETEENTH_PRIMER_ANIO_FED = 2022;

/**
 * Festivos de los Federal Reserve Banks para `anio`, ya con la regla de
 * observancia sábado/domingo aplicada a los festivos de fecha fija.
 */
export function festivosFederalReserveBanks(anio: number): Set<string> {
  const cached = _cache.get(anio);
  if (cached) return cached;

  const set = new Set<string>();
  const agregarFija = (mes0: number, dia: number) => {
    const observada = observanciaFechaFija(fecha(anio, mes0, dia));
    if (observada) set.add(ymd(observada));
  };

  // Fecha fija, con regla de observancia sáb/dom:
  agregarFija(0, 1);   // New Year's Day
  if (anio >= JUNETEENTH_PRIMER_ANIO_FED) {
    agregarFija(5, 19); // Juneteenth National Independence Day
  }
  agregarFija(6, 4);   // Independence Day
  agregarFija(10, 11); // Veterans Day
  agregarFija(11, 25); // Christmas Day

  // N-ésimo día de semana (siempre lunes/jueves, nunca cae fin de semana):
  set.add(ymd(nEsimoDiaSemana(anio, 0, 1, 3)));  // MLK Day: 3er lunes de enero
  set.add(ymd(nEsimoDiaSemana(anio, 1, 1, 3)));  // Washington's Birthday: 3er lunes de febrero
  set.add(ymd(ultimoDiaSemana(anio, 4, 1)));      // Memorial Day: último lunes de mayo
  set.add(ymd(nEsimoDiaSemana(anio, 8, 1, 1)));  // Labor Day: 1er lunes de septiembre
  set.add(ymd(nEsimoDiaSemana(anio, 9, 1, 2)));  // Columbus Day: 2do lunes de octubre
  set.add(ymd(nEsimoDiaSemana(anio, 10, 4, 4))); // Thanksgiving: 4to jueves de noviembre

  _cache.set(anio, set);
  return set;
}

/** true si `fecha` (YYYY-MM-DD) es festivo de los Federal Reserve Banks. */
export function esFestivoFederalReserveBanks(fechaStr: string): boolean {
  const anio = Number(fechaStr.slice(0, 4));
  return festivosFederalReserveBanks(anio).has(fechaStr);
}

// ─── Overrides (Fase 2, punto 4) ───────────────────────────────────────────────

export interface OverridesFestivosFed {
  /** Fechas adicionales a tratar como cierre Fed (cierres extraordinarios,
   *  correcciones futuras) que el calendario algorítmico no predice. */
  cierresFedAdicionales?: string[];
  /** Fechas a forzar como sesión elegible AUNQUE el cálculo algorítmico o
   *  un cierre adicional las marque como festivo. Tiene prioridad sobre
   *  todo lo demás. */
  sesionesFedForzadas?: string[];
}

/**
 * Construye el predicado `esFestivoFed(fecha)` combinando el calendario
 * algorítmico con los overrides. Prioridad: sesionesFedForzadas > cierres
 * (calculados + adicionales). El calendario base NUNCA se reescribe —
 * esto es una capa de corrección explícita y auditable por encima.
 */
export function crearPredicadoFestivoFed(overrides: OverridesFestivosFed = {}): (fecha: string) => boolean {
  const forzadas = new Set(overrides.sesionesFedForzadas ?? []);
  const adicionales = new Set(overrides.cierresFedAdicionales ?? []);
  return (fechaStr: string) => {
    if (forzadas.has(fechaStr)) return false;
    return esFestivoFederalReserveBanks(fechaStr) || adicionales.has(fechaStr);
  };
}
