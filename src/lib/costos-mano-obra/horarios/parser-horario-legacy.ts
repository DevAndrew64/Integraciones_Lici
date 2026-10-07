/**
 * Etapas 6-11 (parcial) — construye los bloques reales (con offsets de día
 * y minutos) de UNA distribución a partir de su texto ya segmentado por
 * "Y" (o detectado sin "Y", familia C). No decide días de la semana ni
 * estado global — eso lo hace normalizador-horario-legacy.ts.
 */
import { interpretarHora } from './interpretador-jornada';
import { segmentarBloquesPorY, detectarHorasSueltas } from './lexer-horario';
import type { BloqueHorarioNormalizado } from './tipos-normalizacion';

function dividirRango(segmento: string): [string, string] | null {
  const conGuion = /^(.+?)-(.+)$/.exec(segmento);
  if (conGuion) return [conGuion[1].trim(), conGuion[2].trim()];
  const conA = /^(.+?)\bA\b(.+)$/.exec(segmento);
  if (conA) return [conA[1].trim(), conA[2].trim()];
  return null;
}

export interface ResultadoConstruccionBloques {
  ok: boolean;
  bloques: BloqueHorarioNormalizado[];
  advertencias: string[];
  requiereConfirmarSeparadores: boolean;
  requiereConfirmarHora: boolean;
  sugerenciaHora: string | null;
  motivoFallo: string | null;
}

function fallaConstruccion(motivo: string): ResultadoConstruccionBloques {
  return { ok: false, bloques: [], advertencias: [], requiereConfirmarSeparadores: false, requiereConfirmarHora: false, sugerenciaHora: null, motivoFallo: motivo };
}

export function construirBloquesDistribucion(textoDistribucion: string): ResultadoConstruccionBloques {
  const { segmentosBloque, huboSeparadorY } = segmentarBloquesPorY(textoDistribucion);
  const advertencias: string[] = [];

  let segmentosParaBloques: string[];
  if (huboSeparadorY) {
    segmentosParaBloques = segmentosBloque;
  } else {
    const unico = segmentosBloque[0] ?? textoDistribucion.trim();
    const rango = dividirRango(unico);
    // Un solo rango simple ("06:00-13:20") — familia A/B de un bloque.
    if (rango && rango[0].split(/\s+/).length <= 2 && rango[1].split(/\s+/).length <= 2) {
      // Confirmar que no hay un segundo rango pegado sin "Y" (familia C):
      // eso se detecta contando tokens de hora sueltos en todo el segmento.
      const { cantidad } = detectarHorasSueltas(unico);
      if (cantidad === 2) {
        segmentosParaBloques = [unico];
      } else if (cantidad === 4) {
        segmentosParaBloques = null as unknown as string[]; // marcador, se resuelve abajo
      } else {
        return fallaConstruccion(`No se reconoce "${unico}" como uno o dos bloques de horario.`);
      }
    } else {
      const { horas, cantidad } = detectarHorasSueltas(unico);
      if (cantidad === 4) {
        // Familia C: cuatro horas sueltas sin separador "Y" explícito —
        // se proponen dos bloques (0,1) y (2,3), nunca se corrige en
        // silencio: se advierte explícitamente.
        advertencias.push(`Faltaba el separador "Y" entre bloques en "${unico}" — se interpretaron dos bloques: "${horas[0]}-${horas[1]}" y "${horas[2]}-${horas[3]}".`);
        segmentosParaBloques = [`${horas[0]}-${horas[1]}`, `${horas[2]}-${horas[3]}`];
      } else {
        return fallaConstruccion(`No se reconoce "${unico}" como uno o dos bloques de horario.`);
      }
    }
  }

  // Familia C detectada dentro de la rama "rango simple" de arriba.
  if (segmentosParaBloques === null) {
    const unico = segmentosBloque[0] ?? textoDistribucion.trim();
    const { horas } = detectarHorasSueltas(unico);
    advertencias.push(`Faltaba el separador "Y" entre bloques en "${unico}" — se interpretaron dos bloques: "${horas[0]}-${horas[1]}" y "${horas[2]}-${horas[3]}".`);
    segmentosParaBloques = [`${horas[0]}-${horas[1]}`, `${horas[2]}-${horas[3]}`];
  }

  const bloques: BloqueHorarioNormalizado[] = [];
  let diaOffsetActual = 0;
  for (let i = 0; i < segmentosParaBloques.length; i++) {
    const rango = dividirRango(segmentosParaBloques[i]);
    if (!rango) return fallaConstruccion(`No se reconoce "${segmentosParaBloques[i]}" como un rango "HH:mm-HH:mm".`);
    const [tokenInicio, tokenFin] = rango;
    const resInicio = interpretarHora(tokenInicio);
    const resFin = interpretarHora(tokenFin);
    if (!resInicio.ok) {
      return { ok: false, bloques: [], advertencias, requiereConfirmarSeparadores: false, requiereConfirmarHora: resInicio.requiereConfirmacion, sugerenciaHora: resInicio.sugerenciaConfirmacion, motivoFallo: resInicio.motivoFallo };
    }
    if (!resFin.ok) {
      return { ok: false, bloques: [], advertencias, requiereConfirmarSeparadores: false, requiereConfirmarHora: resFin.requiereConfirmacion, sugerenciaHora: resFin.sugerenciaConfirmacion, motivoFallo: resFin.motivoFallo };
    }
    advertencias.push(...resInicio.advertencias, ...resFin.advertencias);

    const inicioDiaOffset = diaOffsetActual;
    const minInicio = inicioDiaOffset * 1440 + horaAMinutos(resInicio.horaCanonica!);
    let finDiaOffset = inicioDiaOffset + resFin.diaOffsetSugerido;
    let minFin = finDiaOffset * 1440 + horaAMinutos(resFin.horaCanonica!);
    // Cruce de medianoche implícito (fin <= inicio del mismo bloque, sin que
    // "24:00" lo haya marcado ya explícitamente).
    if (minFin <= minInicio && resFin.diaOffsetSugerido === 0) {
      finDiaOffset += 1;
      minFin += 1440;
    }
    const minutos = minFin - minInicio;
    bloques.push({ inicio: resInicio.horaCanonica!, fin: resFin.horaCanonica!, inicioDiaOffset, finDiaOffset, minutos, orden: i + 1 });
    diaOffsetActual = finDiaOffset;
  }

  return { ok: true, bloques, advertencias, requiereConfirmarSeparadores: false, requiereConfirmarHora: false, sugerenciaHora: null, motivoFallo: null };
}

function horaAMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}