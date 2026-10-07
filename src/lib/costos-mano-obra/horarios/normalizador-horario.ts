/**
 * Cálculo automático de minutos/horas a partir de bloques ya parseados
 * (parser-horario.ts). Función pura, minutos enteros internamente; las
 * horas decimales solo se producen como salida, para el payload externo
 * y para presentación.
 */
import type { BloqueHorario, CalculoHorario, DiasJornada, ResumenPresentableHorario } from './tipos';
import { duracionBloque } from './parser-horario';
import { resolverOffsetsBloque, minutoAbsoluto } from './tiempo-absoluto';

/**
 * Cantidad de días de la semana seleccionados — SOLO lunes a domingo.
 * `fes` (sn_jorn_fes) se conserva como indicador de operación en
 * festivos, pero NUNCA suma como un octavo día ordinario (confirmado
 * contra el uso actual del proyecto: `jornFes`/`sn_jorn_fes` solo se usa
 * hoy como checkbox informativo en la UI, sin participar en ningún
 * cálculo de horas — ver auditoría previa a este bloque).
 */
export function contarDiasSemana(dias: DiasJornada): number {
  return [dias.lun, dias.mar, dias.mie, dias.jue, dias.vie, dias.sab, dias.dom].filter(Boolean).length;
}

export function calcularHorario(bloques: BloqueHorario[], dias: DiasJornada): CalculoHorario {
  const minutosPorBloque = bloques.map(b => duracionBloque(b.inicio, b.fin));
  const minutosDiarios = minutosPorBloque.reduce((s, m) => s + m, 0);

  // Corrección Fase 5 (cierre) — hueco entre bloques consecutivos calculado
  // sobre la línea de tiempo ABSOLUTA (`tiempo-absoluto.ts`, misma fuente
  // que el parser y la validación de superposición), nunca por una resta
  // ingenua de HH:mm: un bloque que cruza medianoche (ej. "20:00-23:00" Y
  // "01:00-06:00") con esa resta ingenua daría un hueco negativo
  // (60-1380=-1320) en vez de las 2h reales. `gap<=0` nunca resta —
  // los bloques ya llegan validados sin superposición real (el gap
  // negativo, si existiera, sería un error bloqueante detectado antes,
  // en `validarOrdenYSuperposicionSecuencia`, nunca aquí).
  let descansoMinutos = 0;
  for (let i = 1; i < bloques.length; i++) {
    const finAbsAnterior = minutoAbsoluto(bloques[i - 1].fin, resolverOffsetsBloque(bloques[i - 1]).offsetDiaFin);
    const inicioAbsActual = minutoAbsoluto(bloques[i].inicio, resolverOffsetsBloque(bloques[i]).offsetDiaInicio);
    const gap = inicioAbsActual - finAbsAnterior;
    if (gap > 0) descansoMinutos += gap;
  }

  const cantidadDiasSemana = contarDiasSemana(dias);
  const minutosSemanales = minutosDiarios * cantidadDiasSemana;

  return {
    bloques,
    minutosPorBloque,
    minutosDiarios,
    descansoMinutos,
    cantidadDiasSemana,
    minutosSemanales,
    horasDiariasDecimal: minutosDiarios / 60,
    horasSemanalesDecimal: minutosSemanales / 60,
    horaInicial: bloques[0]?.inicio ?? '',
    horaFinal: bloques[bloques.length - 1]?.fin ?? '',
  };
}

/** "440" → "7 h 20 min"; "2640" (múltiplo exacto de 60) → "44 h". Nunca decimales. */
export function formatearMinutosComoHoras(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

const ORDEN_DIAS: (keyof Omit<DiasJornada, 'fes'>)[] = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
const NOMBRE_DIA: Record<(typeof ORDEN_DIAS)[number], string> = {
  lun: 'Lunes', mar: 'Martes', mie: 'Miércoles', jue: 'Jueves', vie: 'Viernes', sab: 'Sábado', dom: 'Domingo',
};

/**
 * Descripción legible de los días seleccionados. Si son consecutivos desde
 * lunes ("Lunes a sábado"), usa esa forma; si no, lista los días. No asume
 * "Lunes a domingo" cuando en realidad no todos los días están marcados.
 */
function describirDias(dias: DiasJornada): string {
  const activos = ORDEN_DIAS.filter(d => dias[d]);
  if (activos.length === 0) return 'Sin días seleccionados';
  if (activos.length === 7) return 'Lunes a domingo';
  // Consecutivos desde el primero activo hasta el último activo, sin huecos.
  const indices = activos.map(d => ORDEN_DIAS.indexOf(d));
  const esConsecutivo = indices.every((v, i) => i === 0 || v === indices[i - 1] + 1);
  if (esConsecutivo) {
    const nombreFinal = NOMBRE_DIA[ORDEN_DIAS[indices[indices.length - 1]]];
    const nombreFinalMinuscula = nombreFinal.charAt(0).toLowerCase() + nombreFinal.slice(1);
    return `${NOMBRE_DIA[ORDEN_DIAS[indices[0]]]} a ${nombreFinalMinuscula}`;
  }
  return activos.map(d => NOMBRE_DIA[d]).join(', ');
}

export function construirResumenPresentable(bloques: BloqueHorario[], calculo: CalculoHorario, dias: DiasJornada): ResumenPresentableHorario {
  return {
    horarioTexto: bloques.map(b => `${b.inicio}-${b.fin}`).join(' / '),
    horasPorDiaTexto: formatearMinutosComoHoras(calculo.minutosDiarios),
    horasPorSemanaTexto: formatearMinutosComoHoras(calculo.minutosSemanales),
    cantidadBloques: bloques.length,
    descansoTexto: calculo.descansoMinutos > 0 ? formatearMinutosComoHoras(calculo.descansoMinutos) : '—',
    diasTexto: describirDias(dias),
  };
}
