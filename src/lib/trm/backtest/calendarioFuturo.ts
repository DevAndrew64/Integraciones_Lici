/**
 * Calendario de eventos TRM FUTUROS (Fase 2) — para fechas donde todavía no
 * existe vigenciaDesde/vigenciaHasta oficial. Deliberadamente NO se usan
 * reglas hardcodeadas como "sábado = viernes" o "sábado = valor nuevo": el
 * intervalo de vigencia esperado se DERIVA del calendario de sesiones de
 * mercado elegibles.
 *
 * Regla de negocio asumida (a reconciliar contra datos reales — ver
 * reporte de Fase 2 en el mensaje de entrega): la TRM que rige un día D se
 * certifica con base en las operaciones de la sesión de mercado elegible
 * INMEDIATAMENTE ANTERIOR a D, y esa certificación permanece vigente hasta
 * el día de la SIGUIENTE sesión elegible (inclusive) — el día siguiente a
 * esa sesión es cuando empieza a regir la nueva certificación.
 *
 * Festivos Fed: calendario real de los Federal Reserve Banks
 * (`festivosFederalReserveBanks.ts`, fuente frbservices.org — NO OPM, NO
 * SIFMA). Por defecto `esSesionMercadoElegible` ya lo usa; puede
 * sobreescribirse vía `config.esFestivoFed` para tests o overrides.
 *
 * CUD (sistema de pagos de alto valor del Banco de la República): punto de
 * extensión explícito (`config.cierreCudAdicional`), sin calendario propio
 * todavía — hoy solo se usa el calendario colombiano de días hábiles
 * (Ley Emiliani, `calendarioHabil.ts`) más los festivos Fed. Documentado
 * como limitación conocida, no una respuesta silenciosa.
 *
 * Para histórico ya certificado: usar SIEMPRE vigenciaDesde/vigenciaHasta
 * oficial (vigencias.ts) — este módulo es exclusivamente para fechas sin
 * certificación oficial todavía.
 */

import { esDiaHabilColombiaExtendido } from './festivoChiquinquira';
import { crearPredicadoFestivoFed, type OverridesFestivosFed } from './festivosFederalReserveBanks';

export interface ConfiguracionCalendarioFuturo {
  /**
   * Predicado de festivo de los Federal Reserve Banks. Si se omite, se usa
   * el calendario real por defecto (`festivosFederalReserveBanks.ts`).
   * Inyectable para tests o para pasar overrides ya combinados vía
   * `crearPredicadoFestivoFed`.
   */
  esFestivoFed?: (fecha: string) => boolean;
  /**
   * Overrides del calendario Fed (cierres extraordinarios, sesiones
   * forzadas) — se combinan con el calendario algorítmico. Se ignora si
   * ya se pasó `esFestivoFed` explícito.
   */
  overridesFed?: OverridesFestivosFed;
  /**
   * Punto de extensión para cierres adicionales del CUD (Banco de la
   * República) más allá del calendario colombiano de días hábiles. Por
   * defecto siempre false — no hay calendario CUD propio implementado hoy.
   */
  cierreCudAdicional?: (fecha: string) => boolean;
}

function resolverPredicadoFestivoFed(config: ConfiguracionCalendarioFuturo): (fecha: string) => boolean {
  if (config.esFestivoFed) return config.esFestivoFed;
  return crearPredicadoFestivoFed(config.overridesFed);
}

function addDiasStr(fecha: string, n: number): string {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── esSesionMercadoElegible ────────────────────────────────────────────────

/**
 * true si `fecha` es una sesión de mercado elegible para generar una nueva
 * certificación TRM:
 *
 *   esSesionMercadoElegible =
 *     esDiaHabilColombiaExtendido(fecha) && !esFestivoFed(fecha) && !cierreCudAdicional(fecha)
 *
 * Nunca se basa en el día de la semana por sí solo ("sábado/domingo") —
 * delega en `esDiaHabilColombiaExtendido` (Ley Emiliani vía `calendarioHabil.ts`
 * productivo, sin tocarlo, + festivo de Chiquinquirá desde 2026 —
 * `festivoChiquinquira.ts`), en el calendario real de festivos Fed (o el
 * predicado inyectado) y en el punto de extensión CUD.
 */
export function esSesionMercadoElegible(
  fecha: string,
  config: ConfiguracionCalendarioFuturo = {},
): boolean {
  if (!esDiaHabilColombiaExtendido(fecha)) return false;
  if (resolverPredicadoFestivoFed(config)(fecha)) return false;
  if (config.cierreCudAdicional?.(fecha)) return false;
  return true;
}

// ─── resolverSesionOrigenTrm ────────────────────────────────────────────────

/**
 * Sesión de mercado elegible cuyas operaciones determinan la TRM vigente
 * en `fechaObjetivo`: la última sesión elegible ESTRICTAMENTE anterior a
 * `fechaObjetivo`. Nunca asume "el día hábil anterior" a secas — retrocede
 * hasta encontrar una sesión que además cumpla la condición Fed si está
 * configurada.
 */
export function resolverSesionOrigenTrm(
  fechaObjetivo: string,
  config: ConfiguracionCalendarioFuturo = {},
): string {
  let f = addDiasStr(fechaObjetivo, -1);
  // Cota de seguridad: nunca debería hacer falta retroceder más de ~15 días
  // calendario para encontrar una sesión elegible (worst case: puentes largos).
  for (let i = 0; i < 30; i++) {
    if (esSesionMercadoElegible(f, config)) return f;
    f = addDiasStr(f, -1);
  }
  throw new Error(`No se encontró sesión de mercado elegible retrocediendo desde ${fechaObjetivo}`);
}

// ─── resolverIntervaloVigenciaEsperado ──────────────────────────────────────

/**
 * Intervalo [desde, hasta] de vigencia ESPERADA (no oficial) que cubriría
 * `fechaObjetivo`, derivado del calendario de sesiones:
 *   desde = día calendario siguiente a la sesión de origen que certificaría
 *           el valor vigente en fechaObjetivo;
 *   hasta = día de la SIGUIENTE sesión elegible después de esa sesión de
 *           origen (inclusive — ese día todavía rige la certificación
 *           anterior; la nueva certificación de esa sesión empieza a regir
 *           recién al día siguiente).
 *
 * Esto es una PREDICCIÓN del intervalo, no un dato oficial — debe
 * reconciliarse contra vigenciaDesde/vigenciaHasta real en cuanto la
 * certificación se publique (ver nota en `resolverEventoObjetivo`,
 * vigencias.ts).
 */
export function resolverIntervaloVigenciaEsperado(
  fechaObjetivo: string,
  config: ConfiguracionCalendarioFuturo = {},
): { desde: string; hasta: string; sesionOrigen: string } {
  const sesionOrigen = resolverSesionOrigenTrm(fechaObjetivo, config);
  const desde = addDiasStr(sesionOrigen, 1);

  let siguienteSesion = addDiasStr(sesionOrigen, 1);
  for (let i = 0; i < 30; i++) {
    if (esSesionMercadoElegible(siguienteSesion, config)) {
      return { desde, hasta: siguienteSesion, sesionOrigen };
    }
    siguienteSesion = addDiasStr(siguienteSesion, 1);
  }
  throw new Error(`No se encontró la siguiente sesión elegible después de ${sesionOrigen}`);
}
