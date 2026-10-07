/**
 * Combina una distribución configurada (fuente editable: diasSemana +
 * bloques + excepcionesFecha) con el período del cargo (fechaInicio/
 * fechaFin) para producir el resultado derivado completo. Función pura,
 * minutos enteros. Ningún valor derivado (fechasBase/fechasProgramadas/
 * cantidadDias/minutosDia/minutosPeriodo) se recibe como entrada — todos
 * se recalculan aquí, nunca se confía en uno ya guardado que pueda
 * haberse desincronizado de las fuentes editables.
 */
import { materializarFechasProgramadas } from './materializar-fechas-programadas';
import { calcularHorario as calcularHorarioBloques } from './normalizador-horario';
import type { DistribucionHorarioConfigurada, DistribucionHorarioCalculada, DiasJornada } from './tipos';

const DIAS_JORNADA_DUMMY: DiasJornada = { lun: false, mar: false, mie: false, jue: false, vie: false, sab: false, dom: false, fes: false };

export function calcularDistribucion(
  configuracion: DistribucionHorarioConfigurada,
  fechaInicio: string,
  fechaFin: string,
): DistribucionHorarioCalculada {
  const advertencias: string[] = [];
  if (configuracion.advertencia) advertencias.push(configuracion.advertencia);

  const bloquesReconstruidos = configuracion.bloques.length > 0;
  const minutosDia = bloquesReconstruidos ? calcularHorarioBloques(configuracion.bloques, DIAS_JORNADA_DUMMY).minutosDiarios : 0;
  if (!bloquesReconstruidos) {
    advertencias.push('Esta distribución no tiene bloques horarios válidos — no se puede calcular su duración.');
  }

  const { fechasBase, fechasProgramadas, advertencias: advertenciasMaterializacion } =
    materializarFechasProgramadas(fechaInicio, fechaFin, configuracion.diasSemana, configuracion.excepcionesFecha);
  advertencias.push(...advertenciasMaterializacion);

  const cantidadDias = fechasProgramadas.length;
  const minutosPeriodo = minutosDia * cantidadDias;

  return {
    configuracion,
    fechasBase,
    fechasProgramadas,
    cantidadDias,
    minutosDia,
    minutosPeriodo,
    bloquesReconstruidos,
    advertencias,
  };
}

/** Cantidad de días del cargo = fechas únicas de TODAS sus distribuciones — nunca digitable. */
export function calcularCantidadDiasCargo(distribuciones: DistribucionHorarioCalculada[]): number {
  const fechasUnicas = new Set(distribuciones.flatMap(d => d.fechasProgramadas));
  return fechasUnicas.size;
}

/** Total de minutos del período = suma de minutosPeriodo de todas las distribuciones. */
export function calcularMinutosPeriodoCargo(distribuciones: DistribucionHorarioCalculada[]): number {
  return distribuciones.reduce((s, d) => s + d.minutosPeriodo, 0);
}
