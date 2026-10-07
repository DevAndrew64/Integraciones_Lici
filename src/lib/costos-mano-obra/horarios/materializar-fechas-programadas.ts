/**
 * Aplica excepciones puntuales (INCLUIR/EXCLUIR) sobre el patrón semanal
 * ya generado por generar-fechas-patron.ts. Función pura. El patrón
 * semanal (diasSemana) nunca se modifica aquí — las excepciones afectan
 * únicamente el resultado derivado (fechasProgramadas), nunca la fuente
 * editable (diasSemana permanece igual entre llamadas).
 */
import { generarFechasPatron } from './generar-fechas-patron';
import type { DiaSemanaHorario, ExcepcionFechaProgramada, AccionExcepcionFecha } from './tipos';

export interface ResultadoMaterializacion {
  fechasBase: string[];
  fechasProgramadas: string[];
  advertencias: string[];
}

export function materializarFechasProgramadas(
  fechaInicio: string,
  fechaFin: string,
  diasSemana: DiaSemanaHorario[],
  excepcionesFecha: ExcepcionFechaProgramada[],
): ResultadoMaterializacion {
  const fechasBase = generarFechasPatron(fechaInicio, fechaFin, diasSemana);
  const advertencias: string[] = [];

  const accionesPorFecha = new Map<string, AccionExcepcionFecha[]>();
  for (const exc of excepcionesFecha) {
    const lista = accionesPorFecha.get(exc.fecha) ?? [];
    lista.push(exc.accion);
    accionesPorFecha.set(exc.fecha, lista);
  }

  const resultado = new Set(fechasBase);

  for (const [fecha, acciones] of accionesPorFecha) {
    // Comparación lexicográfica de strings "YYYY-MM-DD" == comparación cronológica.
    const dentroDelPeriodo = fecha >= fechaInicio && fecha <= fechaFin;
    if (!dentroDelPeriodo) {
      advertencias.push(`La excepción para la fecha ${fecha} está fuera del período (${fechaInicio} a ${fechaFin}) y fue ignorada.`);
      continue;
    }
    const accionesUnicas = new Set(acciones);
    if (accionesUnicas.size > 1) {
      advertencias.push(`La fecha ${fecha} tiene acciones contradictorias (INCLUIR y EXCLUIR a la vez) — se ignoró, prevalece el patrón.`);
      continue;
    }
    if (accionesUnicas.has('EXCLUIR')) resultado.delete(fecha);
    else resultado.add(fecha); // INCLUIR
  }

  return { fechasBase, fechasProgramadas: Array.from(resultado).sort(), advertencias };
}
