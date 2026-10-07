/**
 * Parser puro de texto de horario → bloques estructurados.
 * Sin efectos secundarios, sin BD, sin red. Trabaja en minutos enteros
 * internamente (nunca horas decimales). No corrige silenciosamente un
 * horario inválido — siempre devuelve errores explícitos.
 *
 * Formatos admitidos inicialmente:
 *   "08:00-12:00 Y 14:00-17:20"
 *   "08:00 - 12:00 y 14:00 - 17:20"
 *   "08:00-17:00"
 */
import type { BloqueHorario, ResultadoParseoHorario, ErrorParseoHorario } from './tipos';
import { resolverOffsetsSecuencia, validarOrdenYSuperposicionSecuencia } from './tiempo-absoluto';

const RE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

function err(codigo: string, mensaje: string): ErrorParseoHorario {
  return { codigo, mensaje };
}

function minutosDesdeMedianoche(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

/** Duración de un bloque en minutos, admitiendo cruce de medianoche (fin <= inicio). */
function duracionBloque(inicio: string, fin: string): number {
  const iMin = minutosDesdeMedianoche(inicio);
  const fMin = minutosDesdeMedianoche(fin);
  return fMin > iMin ? fMin - iMin : (1440 - iMin) + fMin;
}

export function parsearBloquesHorario(textoOriginal: string): ResultadoParseoHorario {
  const texto = (textoOriginal ?? '').trim();
  if (!texto) {
    return { ok: false, errores: [err('HORARIO_VACIO', 'El texto del horario está vacío.')] };
  }

  // Separador "Y"/"y" entre bloques, tolerante a espacios variables alrededor.
  const segmentos = texto.split(/\s+y\s+/i).map(s => s.trim()).filter(s => s.length > 0);
  if (segmentos.length === 0) {
    return { ok: false, errores: [err('HORARIO_VACIO', 'El texto del horario está vacío.')] };
  }

  const errores: ErrorParseoHorario[] = [];
  const bloques: BloqueHorario[] = [];

  segmentos.forEach((segmento, idx) => {
    const orden = idx + 1;
    // Tolerante a espacios alrededor del guion: "08:00 - 12:00", "08:00-12:00".
    const m = /^(\S+)\s*-\s*(\S+)$/.exec(segmento);
    if (!m) {
      errores.push(err('SEGMENTO_IRRECONOCIBLE', `No se reconoce el bloque "${segmento}" — se espera el formato "HH:mm-HH:mm".`));
      return;
    }
    const [, inicio, fin] = m;

    if (!RE_HORA.test(inicio)) {
      errores.push(err('BLOQUE_HORA_INICIO_INVALIDA', `Hora de inicio inválida en el bloque ${orden}: "${inicio}" (se esperaba "HH:mm" entre 00:00 y 23:59).`));
    }
    if (!RE_HORA.test(fin)) {
      errores.push(err('BLOQUE_HORA_FIN_INVALIDA', `Hora de fin inválida en el bloque ${orden}: "${fin}" (se esperaba "HH:mm" entre 00:00 y 23:59; "24:00" no es válido).`));
    }
    if (RE_HORA.test(inicio) && RE_HORA.test(fin) && inicio === fin) {
      errores.push(err('BLOQUE_INICIO_IGUAL_FIN', `El bloque ${orden} tiene la misma hora de inicio y fin ("${inicio}").`));
    }
    if (RE_HORA.test(inicio) && RE_HORA.test(fin) && inicio !== fin) {
      bloques.push({ inicio, fin, orden });
    }
  });

  if (errores.length > 0) {
    return { ok: false, errores };
  }

  // Corrección "MODELO TEMPORAL DE DOBLE OFFSET" (Fase 5, cruce de
  // medianoche) — resuelve los offsets sobre la línea de tiempo absoluta
  // (`tiempo-absoluto.ts`, única fuente de esta aritmética). El día
  // avanza cuando un bloque envuelve medianoche por sí mismo (fin<=inicio)
  // Y TAMBIÉN, para una secuencia de varios bloques, cuando la hora de
  // inicio de un bloque es menor que la del bloque inmediatamente
  // anterior (ej. "20:00-23:00 Y 01:00-06:00": el segundo bloque se
  // interpreta automáticamente como continuación al día siguiente). Esta
  // inferencia nunca es silenciosa: cada bloque cuyo día fue avanzado por
  // esa razón (`avanceInferido`) se reporta como advertencia informativa
  // en el resultado — nunca bloquea el parseo ni se oculta. La validación
  // de superposición real sobre la línea de tiempo absoluta ya resuelta
  // sigue aplicándose siempre después, y esa sí es bloqueante.
  const offsetsResueltos = resolverOffsetsSecuencia(bloques);
  const bloquesConOffset: BloqueHorario[] = bloques.map((b, i) => {
    const { offsetDiaInicio, offsetDiaFin } = offsetsResueltos[i];
    // Compatibilidad exacta con bloques que nunca cruzan medianoche: si
    // AMBOS offsets resuelven a 0, no se adjunta ningún campo nuevo (la
    // forma del objeto queda idéntica a la de siempre). En cuanto
    // cualquiera de los dos es distinto de 0, se adjuntan AMBOS
    // explícitos — nunca solo offsetDiaFin — para que un bloque que
    // heredó un día ya avanzado preserve esa información si se vuelve a
    // resolver de forma aislada más adelante (`resolverOffsetsBloque` en
    // `tiempo-absoluto.ts`), en vez de perderla silenciosamente.
    if (offsetDiaInicio === 0 && offsetDiaFin === 0) return b;
    return { ...b, offsetDiaInicio, offsetDiaFin };
  });
  const validacion = validarOrdenYSuperposicionSecuencia(bloquesConOffset, offsetsResueltos);
  if (!validacion.ok) {
    return { ok: false, errores: [err(validacion.codigo!, validacion.motivo!)] };
  }

  const advertencias = offsetsResueltos
    .map((o, i) => (o.avanceInferido ? `El bloque ${bloques[i].orden} (${bloques[i].inicio}–${bloques[i].fin}) continuará en el día siguiente. Verifica que esta programación sea correcta antes de guardar.` : null))
    .filter((m): m is string => m !== null);

  return advertencias.length > 0
    ? { ok: true, bloques: bloquesConOffset, advertencias }
    : { ok: true, bloques: bloquesConOffset };
}

/** Exportado para que normalizador-horario.ts calcule duraciones sin reimplementar la fórmula. */
export { duracionBloque, minutosDesdeMedianoche };
