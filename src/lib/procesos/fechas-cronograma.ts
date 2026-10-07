/**
 * Helpers PUROS de fechas de cronograma de procesos contractuales.
 *
 * Sin dependencias de red, BD ni de ningún proveedor: solo parseo y selección
 * de la fecha real de cierre a partir de los eventos del cronograma. Extraído a
 * un módulo neutral para que el runtime (rutas de recálculo de fecha y de
 * actualización de cronograma) no dependa del pipeline de adquisición.
 */

export type CronogramaEvento = {
  nombre: string;
  fecha: string;
};

// Colombia es UTC-5 todo el año (sin horario de verano). Las fechas de
// cronograma llegan en hora local de Bogotá sin sufijo de zona: se suma este
// offset para obtener el instante UTC real.
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

const MESES_ES: Record<string, number> = {
  ene: 1, enero: 1,
  feb: 2, febrero: 2,
  mar: 3, marzo: 3,
  abr: 4, abril: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6,
  jul: 7, julio: 7,
  ago: 8, agosto: 8,
  sep: 9, septiembre: 9, sept: 9,
  oct: 10, octubre: 10,
  nov: 11, noviembre: 11,
  dic: 12, diciembre: 12,
};

function normalizarTexto(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizarTextoKey(value: unknown): string {
  return normalizarTexto(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * Convierte formatos como:
 *   "29/May/2026 - 10:00 am"   → Date UTC
 *   "13/05/2026 - 10:00 AM"    → Date UTC
 *   "2026-05-29T10:00:00"      → Date UTC
 *   "29/Abr/2026 - 06:30 pm"   → Date UTC
 *   "2026-05-29 10:00:00"      → Date UTC
 */
export function parseFechaCronograma(value?: string | null): Date | null {
  if (!value) return null;

  const texto = String(value).trim();
  if (!texto) return null;

  // ── Formato ISO: 2026-05-29T10:00:00 o 2026-05-29 10:00:00
  const isoMatch = texto.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (isoMatch) {
    const [, y, m, d, hh = '00', mm = '00', ss = '00'] = isoMatch;
    const parsed = new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)) + BOGOTA_OFFSET_MS
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // ── Formato DD/MMM/YYYY - HH:MM am/pm  (ej: 29/May/2026 - 10:00 am)
  const textoNorm = texto.toLowerCase().replace(/\s+/g, ' ');
  const mesTextoMatch = textoNorm.match(
    /^(\d{1,2})\/([a-záéíóúüñ]+)\/(\d{4})(?:\s*[-–]\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i
  );
  if (mesTextoMatch) {
    const [, dStr, mesStr, yStr, hhStr = '0', mmStr = '0', ssStr = '0', ampm] = mesTextoMatch;
    const mesNum = MESES_ES[mesStr.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')];
    if (!mesNum) return null;

    let hh = Number(hhStr);
    const mm = Number(mmStr);
    const ss = Number(ssStr);

    if (ampm === 'pm' && hh < 12) hh += 12;
    if (ampm === 'am' && hh === 12) hh = 0;

    const parsed = new Date(
      Date.UTC(Number(yStr), mesNum - 1, Number(dStr), hh, mm, ss) + BOGOTA_OFFSET_MS
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // ── Formato DD/MM/YYYY - HH:MM am/pm  (ej: 13/05/2026 - 10:00 AM)
  const numMatch = textoNorm.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*[-–]\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i
  );
  if (numMatch) {
    const [, dStr, mStr, yStr, hhStr = '0', mmStr = '0', ssStr = '0', ampm] = numMatch;

    let hh = Number(hhStr);
    const mm = Number(mmStr);
    const ss = Number(ssStr);

    if (ampm === 'pm' && hh < 12) hh += 12;
    if (ampm === 'am' && hh === 12) hh = 0;

    const parsed = new Date(
      Date.UTC(Number(yStr), Number(mStr) - 1, Number(dStr), hh, mm, ss) + BOGOTA_OFFSET_MS
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // ── Fallback genérico
  const fallback = new Date(texto);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

// Orden de más específico a más genérico — el genérico "presentacion de ofertas"
// va de último porque es substring de varios patrones anteriores.
const PRIORIDAD_CIERRE = [
  'fecha limite de presentacion de ofertas',
  'fecha limite presentacion de ofertas',
  'fecha limite para presentar ofertas',
  'fecha limite para la presentacion de propuestas',
  'cierre de presentacion de ofertas',
  'entrega de ofertas',
  'recepcion de ofertas',
  'entrega de propuestas',
  'recepcion de propuestas',
  'presentacion de ofertas',
];

const EXCLUSION_CIERRE = [
  'informe de presentacion',
  'publicacion del informe',
  'publicacion informe',
  'informe de evaluacion',
  'informe evaluacion',
  'evaluacion',
  'calificacion',
  'adjudicacion',
  'audiencia de adjudicacion',
  'audiencia adjudicacion',
  'firma del contrato',
  'firma contrato',
  'suscripcion del contrato',
  'suscripcion contrato',
  'garantias',
  'poliza',
  'legalizacion',
  'apertura de ofertas',
  'inicio de ejecucion',
  'ejecucion del contrato',
  'publicacion del procedimiento',
];

/**
 * Busca en el cronograma la fecha real de cierre para ofertar, con lista de
 * prioridad y lista de exclusión explícita (nunca informe/evaluación/
 * adjudicación/firma/garantías).
 */
export function detectarFechaPresentacionOfertas(
  cronogramas: CronogramaEvento[]
): { fecha: Date | null; nombreEvento: string | null } {
  if (!cronogramas || cronogramas.length === 0) {
    return { fecha: null, nombreEvento: null };
  }

  const normalizados = cronogramas.map((c) => ({
    original: c,
    key: normalizarTextoKey(c.nombre),
  }));

  for (const patron of PRIORIDAD_CIERRE) {
    const patronNorm = normalizarTextoKey(patron);

    for (const { original, key } of normalizados) {
      const esExcluido = EXCLUSION_CIERRE.some((excl) => key.includes(normalizarTextoKey(excl)));
      if (esExcluido) continue;

      if (key.includes(patronNorm)) {
        const fecha = parseFechaCronograma(original.fecha);
        if (fecha) {
          return { fecha, nombreEvento: original.nombre };
        }
      }
    }
  }

  return { fecha: null, nombreEvento: null };
}
