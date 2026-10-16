/**
 * Horas semanales y jornada diaria de una línea de cargo para Contratos (`horassem` y `jornada`), sacadas de la programación
 * horaria de la línea (`distribucionesHorario`), que es lo que la pantalla de costos usa para calcular. Los campos de texto
 * `horasSemanal` y `nHoras` de la línea son de la captura vieja: `horasSemanal` arranca en «44» y no se actualiza al
 * programar el horario, así que no sirven.
 *
 * - «Por horas» (TOTAL_SEMANAL): las horas son las digitadas; la jornada solo se conoce si la distribución tiene días.
 * - Horario detallado: minutos del día (bloques) × días de la semana.
 * - Jornada = horas de la semana ÷ días distintos trabajados. Sin días, null (no se inventa).
 */
import { calcularMinutosSemanaDistribucion } from '@/lib/costos-mano-obra/horarios/distribucion-semanal';
import type { DistribucionHorarioConfigurada } from '@/lib/costos-mano-obra/horarios/tipos';

export interface HorasCargo {
  horasSemana: number | null;
  jornada: number | null;
}

export function horasDeProgramacion(distribuciones: readonly DistribucionHorarioConfigurada[] | null | undefined): HorasCargo {
  const lista = distribuciones ?? [];
  let minutos = 0;
  const dias = new Set<string>();
  for (const d of lista) {
    if (d.tipoCapturaHorario === 'TOTAL_SEMANAL') {
      const h = Number(d.horasSemanalesManual);
      if (Number.isFinite(h) && h > 0) minutos += Math.round(h * 60);
    } else {
      minutos += calcularMinutosSemanaDistribucion(d);
    }
    for (const dia of d.diasSemana ?? []) dias.add(dia);
  }
  if (minutos <= 0) return { horasSemana: null, jornada: null };
  const horasSemana = minutos / 60;
  return { horasSemana, jornada: dias.size > 0 ? horasSemana / dias.size : null };
}

