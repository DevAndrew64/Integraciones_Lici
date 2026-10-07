/**
 * REFERENCIA EXCLUSIVA DE PRUEBAS.
 * NO CONECTAR A PRODUCCIÓN.
 *
 * No es código de producción. No debe ser importada por page.tsx, por
 * ningún endpoint, ni utilizada por motor-mano-obra.ts o liquidador-mo.ts.
 * Existe únicamente para formalizar, como especificación ejecutable, la
 * posición cronológica real de los segmentos de un turno (Etapas 1 y 2
 * del diseño de 5 etapas del Bloque 0.3) — construida desde cero, sin
 * reutilizar ni depender de la lógica proporcional actual de page.tsx
 * ni de motor-mano-obra.ts. Más adelante (Fase 1, fuera de este bloque)
 * servirá como referencia para comparar el motor productivo corregido.
 *
 * Trabaja enteramente en MINUTOS ENTEROS (0-1439 dentro de un día).
 * Nunca usa horas decimales ni redondea minutos.
 * NO clasifica ordinaria/extra. NO asigna recargos económicos.
 *
 * Alcance explícito (para no adivinar sobre entradas ambiguas):
 * - Un turno de UN solo bloque puede cruzar medianoche (fin <= inicio).
 * - Un turno de VARIOS bloques debe estar completo dentro del mismo día
 *   calendario (ninguno puede cruzar medianoche) — si se necesita un
 *   turno con varios bloques Y cruce de medianoche, no está soportado
 *   por esta utilidad de referencia; debe modelarse como dos entradas
 *   separadas (una por día) hasta que ese caso se especifique aparte.
 * - Los huecos entre bloques nunca se procesan ni aparecen en la salida.
 */

export type BloqueHorarioPrueba = {
  inicio: string;
  fin: string;
};

export type EntradaSegmentacionPrueba = {
  fecha: string;
  bloques: readonly BloqueHorarioPrueba[];
  horaInicioNocturna: string;
  horaFinNocturna: string;
};

export type SegmentoCronologicoPrueba = {
  fecha: string;
  inicio: string;
  fin: string;
  minutos: number;
  franja: 'DIURNA' | 'NOCTURNA';
};

export interface ResultadoSegmentacionPrueba {
  segmentos: SegmentoCronologicoPrueba[];
  minutosTrabajados: number;
  minutosNocturnos: number;
  minutosDiurnos: number;
}

const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function parseHM(s: string): number {
  const m = RE_HORA.exec(s);
  if (!m) throw new Error(`FORMATO_HORA_INVALIDO: "${s}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function formatearMinutos(min: number): string {
  // min puede llegar a 1440 (fin de día exacto, p.ej. cierre de un
  // segmento justo antes de medianoche) — se representa como "24:00".
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function validarFecha(fecha: string): void {
  if (!RE_FECHA.test(fecha) || Number.isNaN(new Date(fecha + 'T00:00:00Z').getTime())) {
    throw new Error(`FORMATO_FECHA_INVALIDO: "${fecha}"`);
  }
}

function addDiaISO(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function esNocturno(minuto: number, nocIni: number, nocFin: number): boolean {
  if (nocIni > nocFin) return minuto >= nocIni || minuto < nocFin; // ventana cruza medianoche (caso típico 19:00-06:00)
  return minuto >= nocIni && minuto < nocFin;
}

/** Divide [inicio,fin) de UN día calendario en sub-segmentos diurnos/nocturnos, sin redondear. */
function dividirPorFranja(
  fecha: string,
  inicio: number,
  fin: number,
  nocIni: number,
  nocFin: number,
): SegmentoCronologicoPrueba[] {
  const candidatos = [nocFin, nocIni].filter(p => p > inicio && p < fin).sort((a, b) => a - b);
  const puntos = [inicio, ...candidatos, fin];
  const segmentos: SegmentoCronologicoPrueba[] = [];
  for (let i = 0; i < puntos.length - 1; i++) {
    const ini = puntos[i];
    const end = puntos[i + 1];
    const mid = (ini + end) / 2;
    segmentos.push({
      fecha,
      inicio: formatearMinutos(ini),
      fin: formatearMinutos(end),
      minutos: end - ini,
      franja: esNocturno(mid, nocIni, nocFin) ? 'NOCTURNA' : 'DIURNA',
    });
  }
  return segmentos;
}

export function segmentarTurnoReferencia(entrada: EntradaSegmentacionPrueba): ResultadoSegmentacionPrueba {
  validarFecha(entrada.fecha);
  const nocIni = parseHM(entrada.horaInicioNocturna);
  const nocFin = parseHM(entrada.horaFinNocturna);

  const bloquesParsed = entrada.bloques.map(b => ({ inicioMin: parseHM(b.inicio), finMin: parseHM(b.fin) }));

  for (const b of bloquesParsed) {
    if (b.inicioMin === b.finMin) {
      throw new Error(`BLOQUE_INVALIDO_INICIO_IGUAL_FIN: inicio y fin son el mismo minuto (${b.inicioMin})`);
    }
  }

  const hayCruceMedianoche = bloquesParsed.some(b => b.finMin <= b.inicioMin);
  if (hayCruceMedianoche && bloquesParsed.length > 1) {
    throw new Error(
      'MULTIPLES_BLOQUES_CON_CRUCE_MEDIANOCHE_NO_SOPORTADO: modele cada día como una entrada separada',
    );
  }

  // Validar orden y ausencia de solape entre bloques del mismo día (solo aplica si no hay cruce de medianoche)
  for (let i = 1; i < bloquesParsed.length; i++) {
    if (bloquesParsed[i].inicioMin < bloquesParsed[i - 1].inicioMin) {
      throw new Error('BLOQUES_FUERA_DE_ORDEN: los bloques deben declararse en orden cronológico ascendente');
    }
    if (bloquesParsed[i].inicioMin < bloquesParsed[i - 1].finMin) {
      throw new Error('BLOQUES_SUPERPUESTOS: dos bloques ocupan el mismo intervalo de tiempo');
    }
  }

  const segmentos: SegmentoCronologicoPrueba[] = [];

  for (const b of bloquesParsed) {
    if (b.finMin > b.inicioMin) {
      // Bloque normal, dentro del mismo día calendario
      segmentos.push(...dividirPorFranja(entrada.fecha, b.inicioMin, b.finMin, nocIni, nocFin));
    } else {
      // Cruce de medianoche: se divide en dos piezas de día calendario
      const fechaSiguiente = addDiaISO(entrada.fecha);
      segmentos.push(...dividirPorFranja(entrada.fecha, b.inicioMin, 1440, nocIni, nocFin));
      segmentos.push(...dividirPorFranja(fechaSiguiente, 0, b.finMin, nocIni, nocFin));
    }
  }

  const minutosTrabajados = segmentos.reduce((s, seg) => s + seg.minutos, 0);
  const minutosNocturnos = segmentos.filter(s => s.franja === 'NOCTURNA').reduce((s, seg) => s + seg.minutos, 0);
  const minutosDiurnos = minutosTrabajados - minutosNocturnos;

  return { segmentos, minutosTrabajados, minutosNocturnos, minutosDiurnos };
}
