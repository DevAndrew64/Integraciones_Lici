/**
 * Fuente de festivos — lista estática mínima mientras no se conecte
 * `CalendarioFestivos` (BD, ver auditoría §G del plan de Mano de Obra:
 * la tabla real existe pero no se consulta desde ningún módulo puro
 * todavía). Se aísla en este archivo para que reemplazarla por una
 * consulta real sea un cambio de una sola función, sin tocar el motor.
 *
 * 2026-07-20 = Batalla de Boyacá (festivo nacional fijo, Colombia).
 */
export const FESTIVOS_COLOMBIA_2026: readonly string[] = [
  '2026-07-20',
];

/** Sin `festivos` explícito, NINGUNA fecha se trata como festiva (nunca se
 * asume la lista real en silencio) — quien quiera el calendario real debe
 * importar y pasar FESTIVOS_COLOMBIA_2026 explícitamente. */
export function esFechaFestiva(fecha: string, festivos: readonly string[] = []): boolean {
  return festivos.includes(fecha);
}
