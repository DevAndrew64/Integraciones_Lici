/**
 * Corrección "HORARIO FALTANTE EN EL MODAL REGISTRAR DOTACIÓN Y EPP" —
 * resumen compacto de un cargo (cabecera de tarjeta), reutilizando SIEMPRE
 * `formatearResumenHorarioDistribucion` (la misma función que usa la tabla
 * "Detalle mensual de Mano de Obra") como única fuente de la programación.
 * Pura, sin React — Mano de Obra sigue siendo la fuente de verdad; esta
 * función solo compone el texto, nunca reconstruye días/horas por su cuenta.
 *
 * Corrección "PROGRAMACIÓN POR HORAS" — un cargo capturado en la modalidad
 * "Por horas" (`tipoCapturaHorario==='TOTAL_SEMANAL'`, ver
 * `aplicarHorasSemanalesInline` en page.tsx) SIEMPRE guarda
 * `diasSemana:[]` y `bloques:[]` — nunca días ni franja, por diseño (el
 * usuario solo digita un total de horas semanales). Antes de esta
 * corrección, ese vacío se interpretaba como "sin programación" y mostraba
 * "Horario no definido", ocultando el dato real (`horasSemanalesManual`).
 * Orden de resolución (§7 del ajuste):
 *  1. programación detallada por días/franjas (formatearResumenHorarioDistribucion
 *     devuelve texto no vacío) → se usa tal cual;
 *  2/3. sin días/franjas pero con `tipoCapturaHorario==='TOTAL_SEMANAL'` y
 *     `horasSemanalesManual` → "Programación por horas · X h semanales"
 *     (en este modelo de datos la "modalidad por horas" y el "total de
 *     horas semanales" son el mismo campo, así que ambos casos del ajuste
 *     colapsan en uno solo aquí — nunca se inventan días/horas de inicio
 *     o fin para esta modalidad);
 *  4. ninguna de las anteriores → "Horario no definido".
 */
import type { DistribucionHorarioConfigurada } from './tipos';
import { formatearResumenHorarioDistribucion } from './formato-distribucion';

function formatearHorasSemanales(horas: number): string {
  return horas.toLocaleString('es-CO', { maximumFractionDigits: 2 });
}

function describirProgramacionUnica(d: DistribucionHorarioConfigurada): string | null {
  const detallado = formatearResumenHorarioDistribucion(d).trim();
  if (detallado) return detallado;
  if (d.tipoCapturaHorario === 'TOTAL_SEMANAL' && d.horasSemanalesManual) {
    return `Programación por horas · ${formatearHorasSemanales(d.horasSemanalesManual)} h semanales`;
  }
  return null;
}

export function formatearResumenSujetoDotEpp(
  cantidadTrabajadores: number,
  distribuciones: readonly DistribucionHorarioConfigurada[],
): string {
  const nTrabTexto = `${cantidadTrabajadores} trabajador${cantidadTrabajadores === 1 ? '' : 'es'}`;
  const horarioTexto =
    distribuciones.length === 0
      ? null
      : distribuciones.length === 1
      ? describirProgramacionUnica(distribuciones[0])
      : `${distribuciones.length} horarios`;
  return [nTrabTexto, horarioTexto ?? 'Horario no definido'].filter(Boolean).join(' · ');
}
