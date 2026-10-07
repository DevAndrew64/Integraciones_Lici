/**
 * Festivo colombiano "Día de Nuestra Señora del Rosario de Chiquinquirá"
 * (fecha base: 9 de julio), agregado al calendario nacional mediante la
 * Ley 2578 del 1-jun-2026. NO es un override exclusivo de 2026: se
 * modela como regla algorítmica general (fecha base + traslado Ley
 * Emiliani), vigente desde `CHIQUINQUIRA_PRIMER_ANIO` en adelante, igual
 * que cualquier otro festivo trasladable.
 *
 * NO se agrega a `calendarioHabil.ts` (producción) — es intencionalmente
 * un festivo del calendario EXTENDIDO del harness (ver
 * `esDiaHabilColombiaExtendido`), para no modificar el calendario
 * productivo sin autorización separada. El calendario base colombiano
 * (Ley Emiliani, festivos ya existentes) sigue viniendo de
 * `calendarioHabil.ts` sin tocarlo.
 *
 * Fuente: Ley 2578 del 1 de junio de 2026; Banco de la República —
 * Carta Circular Externa GE-0203-2026 (confirma que el lunes 13-jul-2026,
 * traslado del 9-jul, CUD/DCV/CEDEC/CENIT/SEN no operaron).
 */

import { esDiaHabil } from '../calendarioHabil';

/** Primer año en que rige el festivo (Ley 2578, sancionada 1-jun-2026). */
export const CHIQUINQUIRA_PRIMER_ANIO = 2026;

function fechaUtc(anio: number, mes0: number, dia: number): Date {
  return new Date(Date.UTC(anio, mes0, dia, 12));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Traslado Ley Emiliani: al lunes siguiente si no cae lunes (mismo criterio que calendarioHabil.ts). */
function lunesSiguiente(d: Date): Date {
  const delta = (1 - d.getUTCDay() + 7) % 7;
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + delta);
  return r;
}

/**
 * Fecha (YYYY-MM-DD) del festivo de Chiquinquirá para `anio`, ya con el
 * traslado Ley Emiliani aplicado. Null si `anio` es anterior a la vigencia
 * de la Ley 2578 (nunca se aplica retroactivamente).
 */
export function festivoChiquinquira(anio: number): string | null {
  if (anio < CHIQUINQUIRA_PRIMER_ANIO) return null;
  return ymd(lunesSiguiente(fechaUtc(anio, 6, 9))); // julio = mes índice 6
}

/** true si `fecha` es el festivo de Chiquinquirá trasladado de ese año (o cualquier año ≥ vigencia). */
export function esFestivoChiquinquira(fecha: string): boolean {
  const anio = Number(fecha.slice(0, 4));
  return festivoChiquinquira(anio) === fecha;
}

/**
 * Calendario colombiano EXTENDIDO del harness: `esDiaHabil` (producción,
 * Ley Emiliani, sin tocar) + el festivo de Chiquinquirá desde 2026. Es el
 * calendario que debe usar `esSesionMercadoElegible` — nunca el
 * `esDiaHabil` productivo solo, porque a partir de 2026 le faltaría este
 * festivo.
 */
export function esDiaHabilColombiaExtendido(fecha: string): boolean {
  if (!esDiaHabil(fecha)) return false;
  if (esFestivoChiquinquira(fecha)) return false;
  return true;
}
