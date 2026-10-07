/**
 * Capa de PRESENTACIÓN del intérprete automático de turnos — traduce los
 * valores internos de `ResultadoInterpretacionTurno` (tipos técnicos,
 * booleanos, nombres de propiedad) a lenguaje comercial para la UI.
 *
 * Regla del cierre "MEJORA VISUAL Y DE LENGUAJE": ningún valor interno
 * (COBERTURA_12_7, COBERTURA_24_7, JORNADA_INDIVIDUAL, JORNADA_PARCIAL,
 * requiereTurnantes, brechaCoberturaPendiente, true/false crudos,
 * versionInterpretador) debe imprimirse literalmente en la UI — siempre
 * a través de estas funciones. Módulo puro, sin cálculo ni clasificación
 * — nunca decide nada que `interpretarOperacionTurno` no haya decidido
 * ya; solo formatea texto.
 */
import type { TipoOperacionInterpretada, SignificadoCantidad } from './interprete-turnos';
import { JORNADA_ORDINARIA_SEMANAL_COMERCIAL_DEFAULT } from './derivar-distribucion-comercial';

/** §1 — función de traducción de tipos exigida por el cierre. */
export function etiquetaTipoOperacion(tipo: TipoOperacionInterpretada): string {
  switch (tipo) {
    case 'COBERTURA_12_7': return 'Cobertura diaria de 12 horas, todos los días';
    case 'COBERTURA_24_7': return 'Cobertura permanente de 24 horas';
    case 'TURNO_12_HORAS_INDIVIDUAL': return 'Turno individual de 12 horas';
    case 'JORNADA_PARCIAL': return 'Jornada en días seleccionados';
    default: return 'Jornada individual';
  }
}

/** Título corto para el panel principal (§2/§7) — mismo tipo, forma breve. */
export function tituloPanelCobertura(tipo: TipoOperacionInterpretada): string {
  switch (tipo) {
    case 'COBERTURA_12_7': return 'Cobertura diaria de 12 horas';
    case 'COBERTURA_24_7': return 'Cobertura permanente de 24 horas';
    case 'TURNO_12_HORAS_INDIVIDUAL': return 'Turno de 12 horas';
    case 'JORNADA_PARCIAL': return 'Jornada en días seleccionados';
    default: return 'Jornada individual';
  }
}

/** Badge visual (§7) — texto corto en mayúsculas para el chip de color. */
export function badgeTipoServicio(tipo: TipoOperacionInterpretada): string {
  switch (tipo) {
    case 'COBERTURA_12_7': return 'COBERTURA 12/7';
    case 'COBERTURA_24_7': return 'COBERTURA 24/7';
    case 'TURNO_12_HORAS_INDIVIDUAL': return 'TURNO 12 HORAS';
    case 'JORNADA_PARCIAL': return 'JORNADA PARCIAL';
    default: return 'JORNADA INDIVIDUAL';
  }
}

/** true/false internos nunca se muestran crudos — siempre Sí/No (§3). */
export function formatearBooleano(valor: boolean): 'Sí' | 'No' {
  return valor ? 'Sí' : 'No';
}

/** Estado del cálculo (§3) — nunca "brechaCoberturaPendiente: true" crudo. */
export function estadoCalculoTexto(brechaCoberturaPendiente: boolean): 'Parcial' | 'Completo' {
  return brechaCoberturaPendiente ? 'Parcial' : 'Completo';
}

/** §8.C — "3 posiciones simultáneas de servicio." (null si no aplica, ej. 1 sola posición). */
export function textoMultiplesPosiciones(cantidadPosiciones: number): string | null {
  if (cantidadPosiciones <= 1) return null;
  return `${cantidadPosiciones} posiciones simultáneas de servicio.`;
}

/** §8.D — jornada individual, referenciando la jornada semanal comercial
 * vigente ya centralizada (nunca un literal 42 duplicado aquí). */
export function textoJornadaIndividual(): string {
  return `Jornada individual de ${JORNADA_ORDINARIA_SEMANAL_COMERCIAL_DEFAULT} horas semanales.`;
}

/** §8.E */
export const TEXTO_JORNADA_PARCIAL = 'Jornada configurada únicamente para los días seleccionados.';

/** Advertencia de relevo (§2/§7, corrección "CAMBIO 4" — frase breve, ya
 * no el párrafo largo original) — máximo una línea, solo para posiciones
 * de cobertura. Pensada para el resumen consolidado del grupo, no para
 * repetirse en cada posición individual. */
export function advertenciaCobertura(tipo: TipoOperacionInterpretada): string | null {
  if (tipo === 'COBERTURA_12_7' || tipo === 'COBERTURA_24_7') {
    return 'Requiere relevo: la cobertura supera la jornada individual y opera los siete días.';
  }
  return null;
}

/** §5 — rótulo del total monetario del cargo; nunca "total" mientras el
 * cálculo sea parcial (brechaCoberturaPendiente=true). */
export function rotuloTotalCargo(nombreCargo: string, brechaCoberturaPendiente: boolean): string {
  return brechaCoberturaPendiente
    ? `Costo parcial calculado — ${nombreCargo}`
    : `Costo mensual total — ${nombreCargo}`;
}

/** Forma mínima de `ResultadoInterpretacionTurno` que necesita la regla de
 * presentación de §1/§2 del cierre "PRESENTACIÓN DE JORNADA INDIVIDUAL". */
export interface InterpretacionParaTituloVisible {
  tipoOperacionInterpretada: TipoOperacionInterpretada;
  significadoCantidad: SignificadoCantidad;
  requiereTurnantes: boolean;
  brechaCoberturaPendiente: boolean;
}

/**
 * Título visible de "Tipo de jornada/servicio" — regla de presentación
 * (cierre "PRESENTACIÓN DE JORNADA INDIVIDUAL", §1/§2). NUNCA cambia el
 * tipo interno (`interpretarOperacionTurno` sigue clasificando
 * JORNADA_PARCIAL sin modificación) — solo la etiqueta visible:
 *
 * A) JORNADA_PARCIAL + significadoCantidad=TRABAJADORES + sin relevo + sin
 *    cálculo pendiente (siempre cierto hoy para JORNADA_PARCIAL, ya que
 *    solo las coberturas 12/7 y 24/7 producen POSICIONES/relevo/cálculo
 *    pendiente) → "Jornada individual".
 * B) JORNADA_INDIVIDUAL → "Jornada individual".
 * C) Las coberturas conservan sus textos ya aprobados.
 */
export function tituloTipoJornadaVisible(i: InterpretacionParaTituloVisible): string {
  switch (i.tipoOperacionInterpretada) {
    case 'COBERTURA_12_7': return 'Cobertura diaria de 12 horas';
    case 'COBERTURA_24_7': return 'Cobertura permanente de 24 horas';
    case 'TURNO_12_HORAS_INDIVIDUAL': return 'Turno individual de 12 horas';
    case 'JORNADA_INDIVIDUAL': return 'Jornada individual';
    case 'JORNADA_PARCIAL':
      return i.significadoCantidad === 'TRABAJADORES' && !i.requiereTurnantes && !i.brechaCoberturaPendiente
        ? 'Jornada individual'
        : 'Jornada individual'; // rama defensiva — hoy JORNADA_PARCIAL siempre cumple la condición anterior.
  }
}

/** §1 — descripción secundaria fija para la jornada individual. */
export const DESCRIPCION_JORNADA_INDIVIDUAL = 'Programada únicamente en los días seleccionados.';

/** §5 — línea discreta del calendario aplicado, solo cuando incluyeFestivos=true. */
export function textoCalendarioAplicado(anio: number): string {
  return `Calendario de festivos aplicado: ${anio}`;
}

/** §6 — encabezados dinámicos de la tabla de detalle por cargo. */
export function encabezadoCantidad(significadoCantidad: SignificadoCantidad | undefined): string {
  return significadoCantidad === 'POSICIONES' ? 'CANT. POSICIONES' : 'CANT. TRABAJADORES';
}
export function encabezadoCoberturaHoras(significadoCantidad: SignificadoCantidad | undefined): string {
  return significadoCantidad === 'POSICIONES' ? 'COBERTURA SEM. / MES' : 'HORAS SEM. / MES';
}

// ─── Corrección "PRESENTACIÓN DEL GRUPO — RESUMEN DE COBERTURA" ────────────
//
// Detección puramente VISUAL de si las posiciones de un mismo grupo
// (cargo) se combinan para cubrir las 24 horas del día sin brechas — NUNCA
// decide nada económico ni de turnantes; solo decide si el badge del
// resumen debe decir "COBERTURA CONSOLIDADA 24/7" en vez de listar cada
// posición por separado con su propia cobertura parcial. No reutiliza
// `interpretarOperacionTurno` (ese clasifica UNA posición a la vez, nunca
// combina varias) — esta es una unión estructural simple sobre minutos del
// día, sin ningún factor legal ni de costeo.

const MINUTOS_POR_DIA = 1440;

/** Forma mínima de un bloque horario que esta función necesita. */
export interface BloqueParaConsolidacion { inicio: string; fin: string }
/** Forma mínima de una posición (línea) que esta función necesita. */
export interface PosicionParaConsolidacion {
  diasSemana: readonly DiaSemanaHorarioLike[];
  bloques: readonly BloqueParaConsolidacion[];
}
/** Evita acoplar este módulo al tipo `DiaSemanaHorario` completo — cualquier string de día sirve. */
export type DiaSemanaHorarioLike = string;

function minutosDesdeMedianoche(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Intervalos [inicio,fin) dentro de un día de 1440 minutos — un bloque que
 * cruza medianoche (fin <= inicio) se parte en dos intervalos. */
function intervalosDelBloque(b: BloqueParaConsolidacion): Array<[number, number]> {
  const ini = minutosDesdeMedianoche(b.inicio);
  const fin = minutosDesdeMedianoche(b.fin);
  if (fin > ini) return [[ini, fin]];
  return [[ini, MINUTOS_POR_DIA], [0, fin]];
}

/** true si la unión de intervalos cubre [0,1440) completo, sin ningún hueco. */
function unionCubreDiaCompleto(intervalos: Array<[number, number]>): boolean {
  if (intervalos.length === 0) return false;
  const ordenados = [...intervalos].sort((a, b) => a[0] - b[0]);
  let cubiertoHasta = 0;
  for (const [ini, fin] of ordenados) {
    if (ini > cubiertoHasta) return false; // hueco antes de este intervalo
    cubiertoHasta = Math.max(cubiertoHasta, fin);
  }
  return cubiertoHasta >= MINUTOS_POR_DIA;
}

/**
 * true únicamente cuando, para CADA uno de los 7 días de la semana, la
 * unión de los bloques de TODAS las posiciones del grupo que trabajan ese
 * día cubre las 24 horas sin ningún hueco. Un grupo con un solo hueco
 * horario o un día sin ninguna posición programada NUNCA se marca 24/7.
 */
export function detectarCoberturaConsolidada24x7(posiciones: readonly PosicionParaConsolidacion[]): boolean {
  const TODOS_LOS_DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  for (const dia of TODOS_LOS_DIAS) {
    const intervalosDia = posiciones
      .filter((p) => p.diasSemana.includes(dia))
      .flatMap((p) => p.bloques.flatMap(intervalosDelBloque));
    if (!unionCubreDiaCompleto(intervalosDia)) return false;
  }
  return true;
}

// ─── Corrección "COSTO PRELIMINAR DEL TURNANTE" ────────────────────────────
//
// Los enums internos de calculo-turnantes.ts (EstadoCoberturaTurnantes/
// EstadoCostoTurnantes) NUNCA se imprimen literalmente en la UI — se
// conservan únicamente como dato interno. Estas funciones son la única vía
// de traducción a lenguaje comercial, igual que el resto de este módulo:
// puras, sin cálculo ni clasificación — nunca deciden nada que
// calcularNecesidadTurnantes no haya decidido ya.

/** §2 — "Cobertura incompleta"/"Cobertura completa"/"Sin necesidad de relevo",
 * nunca el enum crudo (COBERTURA_PARCIAL_PENDIENTE_PROGRAMACION, etc.). */
export function textoEstadoCoberturaTurnantes(
  estado: 'SIN_NECESIDAD' | 'COBERTURA_COMPLETA' | 'COBERTURA_PARCIAL_PENDIENTE_PROGRAMACION',
): string {
  switch (estado) {
    case 'COBERTURA_COMPLETA': return 'Cobertura completa';
    case 'COBERTURA_PARCIAL_PENDIENTE_PROGRAMACION': return 'Cobertura incompleta';
    default: return 'Sin necesidad de relevo';
  }
}

/** §2 — "Faltan 6 horas semanales por programar" (horasResiduales=0 → null,
 * no hay nada pendiente que anunciar). */
export function textoHorasPendientesRelevo(horasResiduales: number): string | null {
  if (horasResiduales <= 0) return null;
  return `Faltan ${horasResiduales} horas semanales por programar`;
}

/** §1 — rótulo del costo del turnante: "Costo preliminar..." mientras haya
 * horas de relevo sin programar, "Costo mensual..." cuando la cobertura ya
 * está completa. Nunca se presenta como definitivo mientras exista brecha. */
export function rotuloCostoTurnante(nombrePerfil: string | null, cantidadTurnantesFisicos: number, horasResiduales: number): string {
  const prefijo = horasResiduales > 0 ? 'Costo preliminar' : 'Costo mensual';
  if (!nombrePerfil) return horasResiduales > 0 ? 'Costo preliminar de las líneas de turnante' : 'Costo mensual de las líneas de turnante';
  const singular = cantidadTurnantesFisicos === 1;
  return singular ? `${prefijo} del turnante de ${nombrePerfil}` : `${prefijo} de los turnantes de ${nombrePerfil}`;
}

/** §3 — una única alerta compacta, sin párrafo largo ni código técnico,
 * reemplaza el mensaje duplicado (aviso superior + advertencia inferior). */
export function alertaCoberturaIncompletaTurnante(horasResiduales: number, capacidadOrdinariaHoras: number, horasRelevoRequeridas: number): string | null {
  if (horasResiduales <= 0) return null;
  return `Faltan ${horasResiduales} horas semanales de relevo. El valor mostrado cubre únicamente ${capacidadOrdinariaHoras} de las ${horasRelevoRequeridas} horas requeridas.`;
}