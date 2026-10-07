/**
 * Valida que un conjunto de días propuesto para una distribución no choque
 * con los días ya cubiertos por otras distribuciones del mismo cargo.
 * Función pura — no conoce fechas concretas, solo el patrón semanal
 * (diasSemana). El choque de fechas puntuales (excepciones) se valida por
 * separado si llega a necesitarse; aquí solo se bloquea el patrón ordinario.
 */
import type { DiaSemanaHorario, DistribucionHorarioConfigurada } from './tipos';

const NOMBRE_DIA: Record<DiaSemanaHorario, string> = {
  L: 'lunes', M: 'martes', X: 'miércoles', J: 'jueves', V: 'viernes', S: 'sábado', D: 'domingo',
};

export interface ResultadoValidacionSolapeDias {
  ok: boolean;
  diasSolapados: DiaSemanaHorario[];
  error: string | null;
}

function construirMensaje(dias: DiaSemanaHorario[]): string {
  const nombres = dias.map(d => NOMBRE_DIA[d]);
  if (nombres.length === 1) {
    return `El ${nombres[0]} ya está asignado a otra distribución horaria`;
  }
  const todosMenosUltimo = nombres.slice(0, -1).join(', ');
  const ultimo = nombres[nombres.length - 1];
  return `El ${todosMenosUltimo} y el ${ultimo} ya están asignados a otra distribución horaria`;
}

/**
 * `idClienteExcluir` — al editar una distribución existente, se excluye a sí
 * misma de la comparación (no se compara contra sus propios días previos).
 */
export function validarDiasSinSolape(
  diasPropuestos: DiaSemanaHorario[],
  distribucionesExistentes: DistribucionHorarioConfigurada[],
  idClienteExcluir?: string,
): ResultadoValidacionSolapeDias {
  const diasOcupados = new Set<DiaSemanaHorario>();
  for (const dist of distribucionesExistentes) {
    if (idClienteExcluir && dist.idCliente === idClienteExcluir) continue;
    for (const d of dist.diasSemana) diasOcupados.add(d);
  }
  const diasSolapados = diasPropuestos.filter(d => diasOcupados.has(d));
  if (diasSolapados.length === 0) {
    return { ok: true, diasSolapados: [], error: null };
  }
  return { ok: false, diasSolapados, error: construirMensaje(diasSolapados) };
}
