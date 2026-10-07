/**
 * Modelo temporal de doble offset (Fase 5, cruce de medianoche) — única
 * fuente de verdad para resolver/operar sobre `BloqueHorario` en una línea
 * de tiempo absoluta (minutos enteros, sin envolver a 1440). Reutilizado
 * por `parser-horario.ts` (validación de orden/superposición) y por
 * `src/app/page.tsx` (`bloquesConDescansoAplicado`) — evita reimplementar
 * la misma aritmética en cada archivo (mismo criterio que ya usaba cada
 * uno por separado antes de esta corrección, ahora unificado aquí).
 *
 * Precedente en el repo: `BloqueHorarioNormalizado` (tipos-normalizacion.ts,
 * `inicioDiaOffset`/`finDiaOffset`) ya usaba el mismo concepto de doble
 * offset — este módulo NO depende de ese (evita acoplar el motor activo a
 * `normalizador-horario-legacy.ts`), pero adopta el mismo diseño conceptual
 * ya validado ahí.
 *
 * Regla de inferencia del offset de fin (cuando no viene explícito): un
 * bloque individualmente "envolvente" (fin<=inicio en HH:mm) avanza el
 * día por sí mismo; ADEMÁS, para una SECUENCIA de bloques, cuando la hora
 * de inicio (reloj) de un bloque es menor que la del bloque inmediatamente
 * anterior, se infiere automáticamente que ese bloque continúa al día
 * siguiente — nunca se rechaza solo por "empezar más temprano" (ver
 * `resolverOffsetsSecuencia`, más abajo). Esta inferencia NUNCA es
 * silenciosa: cada bloque cuyo día fue avanzado por esta razón queda
 * marcado (`avanceInferido`) para que el caller pueda mostrar una
 * advertencia informativa — la ambigüedad se resuelve mostrándola, no
 * ocultándola ni bloqueándola.
 */
import type { BloqueHorario } from './tipos';

const MINUTOS_DIA = 1440;

export function minutosDesdeMedianoche(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function formatearMinutosComoHHmm(minutosDelDia: number): string {
  const m = ((minutosDelDia % MINUTOS_DIA) + MINUTOS_DIA) % MINUTOS_DIA;
  const hh = Math.floor(m / 60).toString().padStart(2, '0');
  const mm = (m % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export interface OffsetsBloque {
  offsetDiaInicio: number;
  offsetDiaFin: number;
}

/**
 * Resuelve los offsets de UN bloque de forma AISLADA (sin conocer a sus
 * vecinos en la secuencia) — usada cuando el bloque ya viene con offsets
 * explícitos (se respetan tal cual) o es el ÚNICO bloque de la
 * distribución (caso ya soportado: 20:00–06:00 → offsetDiaFin=1,
 * inferido de forma inequívoca porque fin<=inicio en el mismo bloque).
 */
export function resolverOffsetsBloque(b: Pick<BloqueHorario, 'inicio' | 'fin' | 'offsetDiaInicio' | 'offsetDiaFin'>): OffsetsBloque {
  const offsetDiaInicio = b.offsetDiaInicio ?? 0;
  if (b.offsetDiaFin !== undefined) return { offsetDiaInicio, offsetDiaFin: b.offsetDiaFin };
  const inicioMin = minutosDesdeMedianoche(b.inicio);
  const finMin = minutosDesdeMedianoche(b.fin);
  const envuelve = finMin <= inicioMin;
  return { offsetDiaInicio, offsetDiaFin: envuelve ? offsetDiaInicio + 1 : offsetDiaInicio };
}

export interface OffsetsBloqueInferido extends OffsetsBloque {
  /** true si el offset de inicio de ESTE bloque fue avanzado un día por
   * inferencia automática de secuencia (nunca para el primer bloque, y
   * nunca cuando el bloque ya traía offsets propios explícitos). Señal
   * para la UI: cuando es true, el caller debe mostrar una advertencia
   * informativa NO bloqueante ("el bloque continuará en el día
   * siguiente. Verifica que esta programación sea correcta antes de
   * guardar."), nunca ocultarlo ni bloquear el guardado por esto. */
  avanceInferido: boolean;
}

/**
 * Resuelve los offsets de una SECUENCIA ordenada de bloques (mismo día
 * operativo). Reglas de avance de día, en orden de precedencia:
 *   1. Un bloque con offsets YA explícitos se respeta tal cual.
 *   2. Un bloque, tomado de forma AISLADA, que envuelve medianoche
 *      (fin<=inicio) avanza su propio offsetDiaFin — sin ambigüedad.
 *   3. Para el resto: si la hora de inicio (reloj) del bloque es MENOR
 *      que la hora de inicio (reloj) del bloque inmediatamente anterior,
 *      se infiere que este bloque continúa al día siguiente respecto del
 *      anterior (offset mínimo necesario: +1 día) — nunca se rechaza por
 *      "empezar más temprano".
 * `avanceInferido` (por bloque) marca específicamente el caso 3 — un
 * avance que NO estaba ya justificado por el propio cruce de medianoche
 * del bloque anterior (caso 2, "cadena segura": ej. 22:00-06:00 Y
 * 08:00-10:00, donde el segundo bloque hereda un avance ya inequívoco y
 * NO se marca) — es la señal para que el caller muestre la advertencia
 * informativa NO bloqueante ("continuará en el día siguiente..."),
 * reservada para el caso genuinamente ambiguo. La validación de
 * superposición real (`validarOrdenYSuperposicionSecuencia`) sigue
 * aplicándose SIEMPRE después, sobre la línea de tiempo absoluta ya
 * resuelta — esta función nunca decide si la secuencia es válida, solo
 * cómo interpretarla.
 */
export function resolverOffsetsSecuencia(bloques: readonly Pick<BloqueHorario, 'inicio' | 'fin' | 'orden' | 'offsetDiaInicio' | 'offsetDiaFin'>[]): OffsetsBloqueInferido[] {
  const ordenados = [...bloques].sort((a, b) => a.orden - b.orden);
  const resultado: OffsetsBloqueInferido[] = [];
  let cursorInicioAnterior = 0;
  let inicioClockAnterior: number | null = null;
  let anteriorEnvuelveIndividual = false;
  ordenados.forEach((b, i) => {
    const tieneOffsetsPropios = b.offsetDiaInicio !== undefined || b.offsetDiaFin !== undefined;
    const inicioClockActual = minutosDesdeMedianoche(b.inicio);
    const finClockActual = minutosDesdeMedianoche(b.fin);
    const envuelveIndividual = finClockActual <= inicioClockActual;
    let avanceInferido = false;
    let offsetDiaInicio: number;
    if (tieneOffsetsPropios) {
      offsetDiaInicio = b.offsetDiaInicio ?? 0;
    } else if (i === 0) {
      offsetDiaInicio = 0;
    } else {
      const necesitaAvanzar = inicioClockAnterior !== null && inicioClockActual < inicioClockAnterior;
      offsetDiaInicio = cursorInicioAnterior + (necesitaAvanzar ? 1 : 0);
      avanceInferido = necesitaAvanzar && !anteriorEnvuelveIndividual;
    }
    anteriorEnvuelveIndividual = envuelveIndividual;
    const offsets = resolverOffsetsBloque({ ...b, offsetDiaInicio });
    resultado.push({ ...offsets, avanceInferido });
    cursorInicioAnterior = offsets.offsetDiaInicio;
    inicioClockAnterior = inicioClockActual;
  });
  return resultado;
}

export function minutoAbsoluto(hhmm: string, offsetDia: number): number {
  return offsetDia * MINUTOS_DIA + minutosDesdeMedianoche(hhmm);
}

export interface RangoAbsoluto {
  inicioAbs: number;
  finAbs: number;
}

/** Rango absoluto [inicioAbs, finAbs) de un bloque, con sus offsets ya
 * resueltos (nunca negativo — `finAbs` siempre > `inicioAbs` cuando los
 * offsets están correctamente resueltos). */
export function rangoAbsolutoBloque(b: Pick<BloqueHorario, 'inicio' | 'fin'>, offsets: OffsetsBloque): RangoAbsoluto {
  return {
    inicioAbs: minutoAbsoluto(b.inicio, offsets.offsetDiaInicio),
    finAbs: minutoAbsoluto(b.fin, offsets.offsetDiaFin),
  };
}

export function duracionAbsoluta(rango: RangoAbsoluto): number {
  return rango.finAbs - rango.inicioAbs;
}

/** true si dos rangos absolutos [inicioAbs,finAbs) se superponen. */
export function seSuperponenRangos(a: RangoAbsoluto, b: RangoAbsoluto): boolean {
  return a.inicioAbs < b.finAbs && b.inicioAbs < a.finAbs;
}

export interface ResultadoValidacionSecuencia {
  ok: boolean;
  codigo: string | null;
  motivo: string | null;
}

/**
 * Valida orden y superposición de una secuencia de bloques CON SUS
 * OFFSETS YA RESUELTOS (por `resolverOffsetsSecuencia`, arriba). Única
 * fuente de esta validación — reutilizada tanto por `parser-horario.ts`
 * (texto plano) como por la UI de captura de bloques en `page.tsx`, para
 * que ambos caminos apliquen exactamente la misma regla. Con la inferencia
 * automática de secuencia, `BLOQUES_FUERA_DE_ORDEN` queda estructuralmente
 * inalcanzable para offsets producidos por `resolverOffsetsSecuencia` (el
 * offset mínimo inferido siempre garantiza inicioAbs no decreciente) — se
 * conserva como guarda defensiva para offsets construidos por otra vía.
 * Una superposición REAL (mismo minuto absoluto ocupado dos veces) sigue
 * siendo siempre inválida, sin excepción.
 */
export function validarOrdenYSuperposicionSecuencia(
  bloques: readonly Pick<BloqueHorario, 'inicio' | 'fin' | 'orden'>[],
  offsets: readonly OffsetsBloque[],
): ResultadoValidacionSecuencia {
  const rangos = bloques.map((b, i) => rangoAbsolutoBloque(b, offsets[i]));
  for (let i = 1; i < rangos.length; i++) {
    const anterior = rangos[i - 1];
    const actual = rangos[i];
    const bAnterior = bloques[i - 1];
    const bActual = bloques[i];
    if (actual.inicioAbs < anterior.inicioAbs) {
      return {
        ok: false, codigo: 'BLOQUES_FUERA_DE_ORDEN',
        motivo: `El bloque ${bActual.orden} ("${bActual.inicio}-${bActual.fin}") inicia antes que el bloque ${bAnterior.orden} ("${bAnterior.inicio}-${bAnterior.fin}").`,
      };
    }
    if (seSuperponenRangos(anterior, actual)) {
      return {
        ok: false, codigo: 'BLOQUES_SUPERPUESTOS',
        motivo: `El bloque ${bActual.orden} ("${bActual.inicio}-${bActual.fin}") se superpone con el bloque ${bAnterior.orden} ("${bAnterior.inicio}-${bAnterior.fin}").`,
      };
    }
  }
  return { ok: true, codigo: null, motivo: null };
}

/**
 * Aplica un descanso de `minDescanso` minutos CENTRADO dentro de un rango
 * absoluto continuo [inicioAbs,finAbs) — misma regla de negocio ya
 * vigente (descanso centrado, mitad del tiempo trabajado a cada lado),
 * ahora expresada en minutos absolutos para que funcione igual sin
 * importar si el rango cruza medianoche. Si el descanso no cabe
 * (duración total <= descanso), retorna el rango original sin dividir
 * (mismo comportamiento histórico del caso de un solo día).
 */
export function aplicarDescansoRangoAbsoluto(rango: RangoAbsoluto, minDescanso: number): RangoAbsoluto[] {
  const totalMin = duracionAbsoluta(rango);
  if (minDescanso <= 0 || totalMin <= minDescanso) return [rango];
  const trabajado = totalMin - minDescanso;
  const finBloque1Abs = rango.inicioAbs + Math.floor(trabajado / 2);
  const inicioBloque2Abs = finBloque1Abs + minDescanso;
  return [
    { inicioAbs: rango.inicioAbs, finAbs: finBloque1Abs },
    { inicioAbs: inicioBloque2Abs, finAbs: rango.finAbs },
  ];
}

/** Convierte un rango absoluto de vuelta a un `BloqueHorario` (sin
 * `orden`, el caller lo asigna) — el offset de día se deriva de dividir
 * el minuto absoluto entre 1440, nunca reimplementado inline. */
export function bloqueDesdeRangoAbsoluto(rango: RangoAbsoluto): Omit<BloqueHorario, 'orden'> {
  return {
    inicio: formatearMinutosComoHHmm(rango.inicioAbs),
    fin: formatearMinutosComoHHmm(rango.finAbs),
    offsetDiaInicio: Math.floor(rango.inicioAbs / MINUTOS_DIA),
    // Minuto absoluto múltiplo exacto de 1440 = medianoche = "00:00" del
    // día siguiente (Math.floor ya lo resuelve correctamente sin caso
    // especial: 1440/1440=1 → offsetDiaFin=1, formateado "00:00").
    offsetDiaFin: Math.floor(rango.finAbs / MINUTOS_DIA),
  };
}
