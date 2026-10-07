/**
 * Reconstrucción de bloques a partir del texto ya persistido en
 * HorarioCatalogo.horario (Bloque HORARIOS 2A) — usada por GET /api/horarios
 * (mapLocal/mapDetalle) para que los bloques sobrevivan a una recarga de
 * página sin necesidad de una columna nueva en Prisma. Función pura, sin
 * BD ni red — nunca inventa bloques cuando el texto no es analizable.
 */
import { parsearBloquesHorario } from './parser-horario';
import { calcularHorario, construirResumenPresentable } from './normalizador-horario';
import type { BloqueHorario, CalculoHorario, DiasJornada, ResumenPresentableHorario } from './tipos';

export interface ResultadoReconstruccionHorario {
  bloques: BloqueHorario[];
  bloquesReconstruidos: boolean;
  resumen: ResumenPresentableHorario | null;
  calculo: CalculoHorario | null;
  advertencia: string | null;
}

const ADVERTENCIA_NO_ANALIZABLE =
  'El horario guardado no pudo interpretarse como bloques estructurados; se conservan horaInicio/horaFin como datos legados, sin representar el tiempo continuo trabajado.';

/**
 * Intenta reconstruir bloques desde el texto guardado. Si el texto no es
 * analizable, devuelve `bloques: []`, `bloquesReconstruidos: false` y una
 * advertencia explícita — nunca asume que horaInicio/horaFin representan
 * un intervalo continuo trabajado.
 */
export function reconstruirBloquesDesdeTexto(horario: string, dias: DiasJornada): ResultadoReconstruccionHorario {
  const parseo = parsearBloquesHorario(horario);
  if (!parseo.ok) {
    return { bloques: [], bloquesReconstruidos: false, resumen: null, calculo: null, advertencia: ADVERTENCIA_NO_ANALIZABLE };
  }
  const calculo = calcularHorario(parseo.bloques, dias);
  const resumen = construirResumenPresentable(parseo.bloques, calculo, dias);
  return { bloques: parseo.bloques, bloquesReconstruidos: true, resumen, calculo, advertencia: null };
}
