/** Construye, para un período [fechaInicio,fechaFin], la lista de fechas
 * cubriendo semanas completas (lunes a domingo) desde la semana que
 * contiene fechaInicio hasta la que contiene fechaFin — incluye días de
 * CONTEXTO anteriores/posteriores al período real (ej. el lunes anterior),
 * necesarios para el acumulado semanal, pero marcados explícitamente para
 * que nunca se costeen. */
import { diaSemanaDeFecha, sumarDias } from './materializar-programacion';

export interface DiaConContexto {
  fecha: string;
  dentroDelPeriodo: boolean;
}

function lunesDeSemana(fecha: string): string {
  const dia = diaSemanaDeFecha(fecha);
  const OFFSET: Record<string, number> = { L: 0, M: 1, X: 2, J: 3, V: 4, S: 5, D: 6 };
  return sumarDias(fecha, -OFFSET[dia]);
}

function domingoDeSemana(fecha: string): string {
  const dia = diaSemanaDeFecha(fecha);
  const OFFSET: Record<string, number> = { L: 6, M: 5, X: 4, J: 3, V: 2, S: 1, D: 0 };
  return sumarDias(fecha, OFFSET[dia]);
}

export function construirSemanasConContexto(fechaInicio: string, fechaFin: string): DiaConContexto[] {
  const inicioVentana = lunesDeSemana(fechaInicio);
  const finVentana = domingoDeSemana(fechaFin);
  const dias: DiaConContexto[] = [];
  let cur = inicioVentana;
  // Límite de seguridad — evita bucles infinitos ante fechas inválidas.
  let salvaguarda = 0;
  while (cur <= finVentana && salvaguarda < 3660) {
    dias.push({ fecha: cur, dentroDelPeriodo: cur >= fechaInicio && cur <= fechaFin });
    cur = sumarDias(cur, 1);
    salvaguarda++;
  }
  return dias;
}
