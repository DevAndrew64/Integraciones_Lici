/**
 * Presentación pura de una `DistribucionHorarioConfigurada` — ajuste
 * "CREAR UN MODO EXPLÍCITO DE CAPTURA". Extraído de page.tsx para poder
 * probarse sin React/jsdom: son funciones puras, sin estado, sin DOM.
 */
import type { DiaSemanaHorario, DistribucionHorarioConfigurada, BloqueHorario } from './tipos';
import { formatearMinutosComoHoras } from './normalizador-horario';

const NOMBRE_DIA_LARGO: Record<DiaSemanaHorario, string> = {
  L: 'Lunes', M: 'Martes', X: 'Miércoles', J: 'Jueves', V: 'Viernes', S: 'Sábado', D: 'Domingo',
};

export function describirDiasDistribucion(dias: DiaSemanaHorario[]): string {
  const orden: DiaSemanaHorario[] = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const seleccionados = orden.filter(d => dias.includes(d));
  const idxs = seleccionados.map(d => orden.indexOf(d));
  const esConsecutivo = idxs.length > 1 && idxs.every((v, i) => i === 0 || v === idxs[i - 1] + 1);
  if (esConsecutivo) return `${NOMBRE_DIA_LARGO[seleccionados[0]]} a ${NOMBRE_DIA_LARGO[seleccionados[seleccionados.length - 1]]}`;
  return seleccionados.map(d => NOMBRE_DIA_LARGO[d]).join(', ');
}

function formatearBloquesExactos(bloques: BloqueHorario[]): string {
  return bloques.map(b => `${b.inicio}-${b.fin}`).join(' / ');
}

export interface ModoCapturaResuelto {
  modo: 'RANGO_CON_DESCANSO' | 'BLOQUES_INDEPENDIENTES';
  rangoOriginal: { inicio: string; fin: string } | null;
  descansoAplicadoMinutos: number;
}

/** Ajuste "COMPATIBILIDAD HISTÓRICA" (§F): un registro sin
 * `modoCapturaHorario` (guardado antes de este ajuste) SIEMPRE resuelve
 * como BLOQUES_INDEPENDIENTES — nunca se adivina un descanso centrado a
 * partir del hueco entre bloques, para no alterar silenciosamente el
 * corte exacto que el usuario ya tenía guardado. */
export function resolverModoCapturaHorario(d: DistribucionHorarioConfigurada): ModoCapturaResuelto {
  if (d.modoCapturaHorario === 'RANGO_CON_DESCANSO' && d.rangoOriginal) {
    return { modo: 'RANGO_CON_DESCANSO', rangoOriginal: d.rangoOriginal, descansoAplicadoMinutos: d.descansoAplicadoMinutos ?? 0 };
  }
  return { modo: 'BLOQUES_INDEPENDIENTES', rangoOriginal: null, descansoAplicadoMinutos: 0 };
}

/** "Lunes a sábado · 06:00-14:20" (RANGO_CON_DESCANSO) o "Lunes a sábado
 * · 08:00-12:30 / 14:00-18:00" (BLOQUES_INDEPENDIENTES, incluye siempre
 * el caso histórico sin modo explícito) — nunca colapsa dos bloques
 * genuinamente independientes en un solo rango (§D del ajuste). */
export function formatearResumenHorarioDistribucion(d: DistribucionHorarioConfigurada): string {
  const diasTexto = describirDiasDistribucion(d.diasSemana);
  if (d.bloques.length === 0) return diasTexto;
  const modo = resolverModoCapturaHorario(d);
  if (modo.modo === 'RANGO_CON_DESCANSO' && modo.rangoOriginal) {
    return `${diasTexto} · ${modo.rangoOriginal.inicio}-${modo.rangoOriginal.fin}`;
  }
  return `${diasTexto} · ${formatearBloquesExactos(d.bloques)}`;
}

/** "1 h 30 min" — SOLO cuando el modo de captura es RANGO_CON_DESCANSO
 * con descanso mayor que cero; `null` en cualquier otro caso (incluye
 * BLOQUES_INDEPENDIENTES, donde el hueco entre bloques nunca se etiqueta
 * como descanso). */
export function formatearDescansoAplicadoDistribucion(d: DistribucionHorarioConfigurada): string | null {
  const modo = resolverModoCapturaHorario(d);
  if (modo.modo !== 'RANGO_CON_DESCANSO' || modo.descansoAplicadoMinutos <= 0) return null;
  return formatearMinutosComoHoras(modo.descansoAplicadoMinutos);
}

const TODOS_LOS_DIAS: readonly DiaSemanaHorario[] = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export type OrigenDiaDescanso = 'AUTOMATICO_POR_DEFECTO' | 'INFERIDO_POR_PROGRAMACION';

export interface DiaDescansoInferido {
  dia: DiaSemanaHorario;
  origen: OrigenDiaDescanso;
}

/** Ajuste "OCULTAR COMPLETAMENTE EL DÍA DE DESCANSO" — el día de
 * descanso obligatorio se infiere SIEMPRE de la programación real,
 * nunca lo captura el usuario (§2/§3 del ajuste):
 *
 * - Jornada normal L-V o L-S (falta más de un día, o falta domingo
 *   junto con otros): domingo por defecto (`AUTOMATICO_POR_DEFECTO`).
 * - Programación de 6 días con exactamente UN día no programado: ese
 *   día se infiere como descanso (`INFERIDO_POR_PROGRAMACION`) — ej.
 *   martes a domingo programados → lunes inferido.
 * - Programación de 7 días (todos programados): domingo por defecto
 *   también aquí — NUNCA se asume que una sola persona cubre los 7
 *   días; `advertenciaProgramacion` (derivar-distribucion-comercial.ts)
 *   es la señal correcta para ese caso, no este campo. */
export function inferirDiaDescansoObligatorio(distribuciones: DistribucionHorarioConfigurada[]): DiaDescansoInferido {
  const programados = new Set<DiaSemanaHorario>();
  for (const dist of distribuciones) for (const dia of dist.diasSemana) programados.add(dia);
  const noProgramados = TODOS_LOS_DIAS.filter(d => !programados.has(d));
  if (noProgramados.length === 1) {
    return { dia: noProgramados[0], origen: 'INFERIDO_POR_PROGRAMACION' };
  }
  return { dia: 'D', origen: 'AUTOMATICO_POR_DEFECTO' };
}