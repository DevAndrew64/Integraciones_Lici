/**
 * Generador determinístico de festivos oficiales de Colombia — funciona
 * para cualquier año (nunca hardcodeado a 2026), sin dependencia de red ni
 * de BD. Fuente de verdad por defecto cuando `CalendarioFestivos` (BD) no
 * tiene el año cargado o está incompleto — ver resolver-festivos.ts para
 * la fusión con la tabla real.
 *
 * Tres categorías, según Ley 51 de 1983 (Ley Emiliani) y el calendario
 * litúrgico:
 *  - FIJO: fecha fija, nunca se traslada (6 festivos).
 *  - TRASLADADO_LUNES: fecha base fija o derivada de Pascua, observada
 *    siempre el lunes siguiente si no cae ya en lunes (12 festivos).
 *  - MOVIL_PASCUA: derivado de Pascua, se observa en su día real (jueves/
 *    viernes), nunca se traslada (2 festivos: Jueves y Viernes Santo).
 */

export type TipoFestivoColombia = 'FIJO' | 'TRASLADADO_LUNES' | 'MOVIL_PASCUA';

export interface FestivoColombia {
  fecha: string; // "YYYY-MM-DD"
  nombre: string;
  tipo: TipoFestivoColombia;
  fuente: 'CALENDARIO_COLOMBIA';
}

/**
 * Regla adicional creada por una norma posterior a las 18 vigentes desde
 * 1983 (ej. Ley 2578 de 2026) — con fecha base propia y VIGENCIA explícita,
 * para que el generador nunca la aplique retroactivamente a años en que la
 * norma no existía. `vigenteDesde`/`vigenteHasta` se comparan contra la
 * fecha YA trasladada (observada), no contra la fecha base.
 */
interface ReglaFestivoConVigencia {
  mesBase: number;
  diaBase: number;
  nombre: string;
  tipo: 'TRASLADADO_LUNES';
  vigenteDesde: string; // "YYYY-MM-DD"
  vigenteHasta: string | null;
  fundamento: string;
}

const REGLAS_ADICIONALES_CON_VIGENCIA: readonly ReglaFestivoConVigencia[] = [
  {
    mesBase: 7, diaBase: 9,
    nombre: 'Nuestra Señora del Rosario de Chiquinquirá',
    tipo: 'TRASLADADO_LUNES',
    vigenteDesde: '2026-06-02',
    vigenteHasta: null,
    fundamento: 'LEY_2578_2026',
  },
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatearFechaUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Domingo de Pascua (calendario gregoriano) — algoritmo anónimo de Meeus/
 * Jones/Butcher, válido para cualquier año gregoriano. */
function pascuaDomingoUTC(anio: number): Date {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31); // 3=marzo, 4=abril
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(anio, mes - 1, dia));
}

/** Ley Emiliani: si la fecha no cae en lunes, se traslada al lunes siguiente. */
function siguienteLunesUTC(d: Date): Date {
  const dow = d.getUTCDay(); // 0=domingo, 1=lunes, ...
  const diff = (8 - dow) % 7;
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + diff);
  return r;
}

function sumarDiasUTC(d: Date, dias: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + dias);
  return r;
}

export function generarFestivosColombia(anio: number): FestivoColombia[] {
  const festivos: FestivoColombia[] = [];

  const fijo = (mes: number, dia: number, nombre: string) => {
    festivos.push({ fecha: formatearFechaUTC(new Date(Date.UTC(anio, mes - 1, dia))), nombre, tipo: 'FIJO', fuente: 'CALENDARIO_COLOMBIA' });
  };
  const trasladadoFijo = (mes: number, dia: number, nombre: string) => {
    festivos.push({ fecha: formatearFechaUTC(siguienteLunesUTC(new Date(Date.UTC(anio, mes - 1, dia)))), nombre, tipo: 'TRASLADADO_LUNES', fuente: 'CALENDARIO_COLOMBIA' });
  };

  const pascua = pascuaDomingoUTC(anio);
  const movilPascua = (offsetDias: number, nombre: string) => {
    festivos.push({ fecha: formatearFechaUTC(sumarDiasUTC(pascua, offsetDias)), nombre, tipo: 'MOVIL_PASCUA', fuente: 'CALENDARIO_COLOMBIA' });
  };
  const trasladadoPascua = (offsetDias: number, nombre: string) => {
    festivos.push({ fecha: formatearFechaUTC(siguienteLunesUTC(sumarDiasUTC(pascua, offsetDias))), nombre, tipo: 'TRASLADADO_LUNES', fuente: 'CALENDARIO_COLOMBIA' });
  };

  // A. Fecha fija, nunca se traslada.
  fijo(1, 1, 'Año Nuevo');
  fijo(5, 1, 'Día del Trabajo');
  fijo(7, 20, 'Día de la Independencia');
  fijo(8, 7, 'Batalla de Boyacá');
  fijo(12, 8, 'Inmaculada Concepción');
  fijo(12, 25, 'Navidad');

  // B. Fecha base fija, trasladada al lunes siguiente.
  trasladadoFijo(1, 6, 'Reyes Magos');
  trasladadoFijo(3, 19, 'San José');
  trasladadoFijo(6, 29, 'San Pedro y San Pablo');
  trasladadoFijo(8, 15, 'Asunción de la Virgen');
  trasladadoFijo(10, 12, 'Día de la Raza');
  trasladadoFijo(11, 1, 'Todos los Santos');
  trasladadoFijo(11, 11, 'Independencia de Cartagena');

  // C. Derivados de Pascua — Jueves/Viernes Santo nunca se trasladan;
  // Ascensión/Corpus Christi/Sagrado Corazón sí, al lunes siguiente.
  movilPascua(-3, 'Jueves Santo');
  movilPascua(-2, 'Viernes Santo');
  trasladadoPascua(39, 'Ascensión del Señor');
  trasladadoPascua(60, 'Corpus Christi');
  trasladadoPascua(68, 'Sagrado Corazón de Jesús');

  // D. Reglas adicionales creadas por norma posterior (ej. Ley 2578 de
  // 2026) — solo se incluyen si la fecha ya trasladada cae dentro de su
  // vigencia; nunca se aplican retroactivamente a años anteriores a la
  // norma, ni después de su derogatoria si alguna vez la tuviera.
  for (const regla of REGLAS_ADICIONALES_CON_VIGENCIA) {
    const fechaTrasladada = formatearFechaUTC(siguienteLunesUTC(new Date(Date.UTC(anio, regla.mesBase - 1, regla.diaBase))));
    if (fechaTrasladada < regla.vigenteDesde) continue;
    if (regla.vigenteHasta && fechaTrasladada > regla.vigenteHasta) continue;
    festivos.push({ fecha: fechaTrasladada, nombre: regla.nombre, tipo: regla.tipo, fuente: 'CALENDARIO_COLOMBIA' });
  }

  return festivos.sort((x, y) => x.fecha.localeCompare(y.fecha));
}

export interface ResultadoEsFestivoColombia {
  esFestivo: boolean;
  nombre: string | null;
  fuente: string | null;
}

/** Consulta puntual — internamente genera el calendario completo del año
 * de la fecha y busca la coincidencia exacta. */
export function esFestivoColombia(fecha: string): ResultadoEsFestivoColombia {
  const anio = Number(fecha.slice(0, 4));
  if (!Number.isFinite(anio)) return { esFestivo: false, nombre: null, fuente: null };
  const encontrado = generarFestivosColombia(anio).find(f => f.fecha === fecha);
  return encontrado
    ? { esFestivo: true, nombre: encontrado.nombre, fuente: encontrado.fuente }
    : { esFestivo: false, nombre: null, fuente: null };
}

/** Lista plana de fechas festivas ("YYYY-MM-DD") cubriendo todos los años
 * que toca un rango [fechaInicio, fechaFin] — para alimentar directamente
 * los `festivos: readonly string[]` que ya esperan clasificarSemanas/
 * calcularCargoDistribuido, sin fijar ningún año de antemano. */
export function festivosColombiaEnRango(fechaInicio: string, fechaFin: string): string[] {
  const anioInicio = Number(fechaInicio.slice(0, 4));
  const anioFin = Number(fechaFin.slice(0, 4));
  if (!Number.isFinite(anioInicio) || !Number.isFinite(anioFin)) return [];
  const fechas: string[] = [];
  for (let anio = Math.min(anioInicio, anioFin); anio <= Math.max(anioInicio, anioFin); anio++) {
    for (const f of generarFestivosColombia(anio)) fechas.push(f.fecha);
  }
  return fechas.sort();
}