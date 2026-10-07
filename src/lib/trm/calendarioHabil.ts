/**
 * Calendario hábil de Colombia para el módulo TRM (server-side).
 * Festivos según Ley 51 de 1983 (Ley Emiliani): fijos, trasladables a lunes
 * y móviles dependientes de Pascua (Meeus/Jones/Butcher).
 *
 * Todas las fechas se manejan como strings 'YYYY-MM-DD' para evitar
 * ambigüedades de zona horaria entre el servidor y Colombia.
 */

/** Domingo de Pascua para un año (algoritmo Meeus/Jones/Butcher). */
function pascua(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, mes - 1, dia, 12));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDias(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/** Traslada al lunes siguiente si no cae lunes (Ley Emiliani). */
function lunesSiguiente(d: Date): Date {
  const delta = (1 - d.getUTCDay() + 7) % 7;
  return addDias(d, delta);
}

const _cacheFestivos = new Map<number, Set<string>>();

/** Conjunto de festivos 'YYYY-MM-DD' de un año. */
export function festivosColombia(y: number): Set<string> {
  const cached = _cacheFestivos.get(y);
  if (cached) return cached;

  const set = new Set<string>();
  const fijo = (mes: number, dia: number) => set.add(ymd(new Date(Date.UTC(y, mes, dia, 12))));
  const emiliani = (mes: number, dia: number) =>
    set.add(ymd(lunesSiguiente(new Date(Date.UTC(y, mes, dia, 12)))));

  fijo(0, 1);    // Año Nuevo
  fijo(4, 1);    // Día del Trabajo
  fijo(6, 20);   // Independencia
  fijo(7, 7);    // Batalla de Boyacá
  fijo(11, 8);   // Inmaculada Concepción
  fijo(11, 25);  // Navidad
  emiliani(0, 6);   // Reyes Magos
  emiliani(2, 19);  // San José
  emiliani(5, 29);  // San Pedro y San Pablo
  emiliani(7, 15);  // Asunción
  emiliani(9, 12);  // Día de la Raza
  emiliani(10, 1);  // Todos los Santos
  emiliani(10, 11); // Independencia de Cartagena

  const P = pascua(y);
  set.add(ymd(addDias(P, -3))); // Jueves Santo
  set.add(ymd(addDias(P, -2))); // Viernes Santo
  set.add(ymd(lunesSiguiente(addDias(P, 39)))); // Ascensión
  set.add(ymd(lunesSiguiente(addDias(P, 60)))); // Corpus Christi
  set.add(ymd(lunesSiguiente(addDias(P, 68)))); // Sagrado Corazón

  _cacheFestivos.set(y, set);
  return set;
}

/** true si la fecha 'YYYY-MM-DD' es día hábil bancario en Colombia (lun–vie no festivo). */
export function esDiaHabil(fecha: string): boolean {
  const d = new Date(fecha + 'T12:00:00Z');
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !festivosColombia(d.getUTCFullYear()).has(fecha);
}

/** Día hábil siguiente estricto (fecha + al menos 1 día). */
export function siguienteDiaHabil(fecha: string): string {
  let d = addDias(new Date(fecha + 'T12:00:00Z'), 1);
  while (!esDiaHabil(ymd(d))) d = addDias(d, 1);
  return ymd(d);
}

/** Último día hábil ≤ fecha. */
export function ultimoDiaHabil(fecha: string): string {
  let d = new Date(fecha + 'T12:00:00Z');
  while (!esDiaHabil(ymd(d))) d = addDias(d, -1);
  return ymd(d);
}

/**
 * Días hábiles estrictamente posteriores a `desde` y hasta `hasta` inclusive.
 * Devuelve 0 si `hasta` ≤ `desde`.
 */
export function contarDiasHabiles(desde: string, hasta: string): number {
  if (hasta <= desde) return 0;
  let d = addDias(new Date(desde + 'T12:00:00Z'), 1);
  const fin = new Date(hasta + 'T12:00:00Z');
  let count = 0;
  while (d <= fin) {
    if (esDiaHabil(ymd(d))) count++;
    d = addDias(d, 1);
  }
  return count;
}
