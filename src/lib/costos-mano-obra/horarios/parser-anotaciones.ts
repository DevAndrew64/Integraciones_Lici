/**
 * Etapa 4 — Extracción de anotaciones, alias, días incrustados y marcas de
 * rotación/turnante/descanso, SEPARADAS del texto de horas — para que las
 * etapas de horas (lexer/interpretador) nunca tengan que lidiar con texto
 * no numérico. Nunca elimina "Y" ni "//" (separadores estructurales).
 */
import type { DiaSemanaHorario } from './tipos';
import { extraerDescansoConDuracion, tieneDescansoSinDuracion } from './interpretador-jornada';

const DIA_ABREV: Record<string, DiaSemanaHorario> = {
  L: 'L', LU: 'L', LUN: 'L', LUNES: 'L',
  M: 'M', MA: 'M', MAR: 'M', MARTES: 'M',
  X: 'X', MI: 'X', MIE: 'X', MIERCOLES: 'X',
  J: 'J', JU: 'J', JUE: 'J', JUEVES: 'J',
  V: 'V', VI: 'V', VIE: 'V', VIERNES: 'V',
  S: 'S', SA: 'S', SAB: 'S', SABADO: 'S',
  D: 'D', DO: 'D', DOM: 'D', DOMINGO: 'D', DOMINGOS: 'D',
};
const ORDEN_DIAS: DiaSemanaHorario[] = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const RE_ROTACION = /\bTURNANTE\b|\bTURNO\s+ESPECIAL\b|\bCADA\s+15\s+D[IÍ]AS\b|\bPRIMERA\s+SEMANA\b|\bSEGUNDA\s+SEMANA\b|\bTRES\s+SEMANAS\b|\bUNA\s+SEMANA\s+DE\s+D[IÍ]A\s+Y\s+OTRA\s+DE\s+TARDE\b|\b\d\s?X\s?\d\b/;

export interface ResultadoAnotaciones {
  textoSinAnotaciones: string;
  alias: string | null;
  anotaciones: string[];
  diasDetectados: DiaSemanaHorario[] | null;
  descansoDeclaradoMinutos: number | null;
  descansoSinDuracion: boolean;
  esRotacionOTurnante: boolean;
}

/** "L-V" / "L A V" (rango de días abreviados) → lista de DiaSemanaHorario. */
function extraerRangoDiasAbreviado(texto: string): { dias: DiaSemanaHorario[]; coincidencia: string } | null {
  const m = /\b(L|M|X|J|V|S|D|LU|MA|MI|JU|VI|SA|DO)\s*-\s*(L|M|X|J|V|S|D|LU|MA|MI|JU|VI|SA|DO)\b/.exec(texto);
  if (!m) return null;
  const ini = DIA_ABREV[m[1]];
  const fin = DIA_ABREV[m[2]];
  if (!ini || !fin) return null;
  const iIni = ORDEN_DIAS.indexOf(ini);
  const iFin = ORDEN_DIAS.indexOf(fin);
  if (iIni === -1 || iFin === -1 || iFin < iIni) return null;
  return { dias: ORDEN_DIAS.slice(iIni, iFin + 1), coincidencia: m[0] };
}

export function extraerAnotaciones(textoEntrada: string): ResultadoAnotaciones {
  let texto = textoEntrada;
  const anotaciones: string[] = [];
  let alias: string | null = null;
  let descansoDeclaradoMinutos: number | null = null;
  let descansoSinDuracion = false;
  let diasDetectados: DiaSemanaHorario[] | null = null;
  let esRotacionOTurnante = false;

  // 1) Contenido entre paréntesis — puede ser descanso con duración o un alias.
  texto = texto.replace(/\(([^)]*)\)/g, (_match, contenido: string) => {
    const descanso = extraerDescansoConDuracion(contenido);
    if (descanso) {
      descansoDeclaradoMinutos = descanso.minutos;
    } else if (/^\s*$/.test(contenido)) {
      // paréntesis vacío, nada que extraer
    } else if (alias === null) {
      alias = contenido.trim();
    } else {
      anotaciones.push(contenido.trim());
    }
    return ' ';
  });

  // 2) Descanso con duración FUERA de paréntesis (ej. "08:00-17:00 DOS HORAS DE DESCANSO").
  if (descansoDeclaradoMinutos === null) {
    const descansoFuera = extraerDescansoConDuracion(texto);
    if (descansoFuera) {
      descansoDeclaradoMinutos = descansoFuera.minutos;
      texto = texto.replace(descansoFuera.textoOriginal, ' ');
    }
  }

  // 3) "INCLUIDO EL DESCANSO" / "CON DESCANSO" (sin duración).
  if (descansoDeclaradoMinutos === null && tieneDescansoSinDuracion(texto)) {
    descansoSinDuracion = true;
    texto = texto.replace(/INCLUIDO\s+EL\s+DESCANSO|CON\s+DESCANSO/g, ' ');
  }

  // 4) Rotación / turnante / ciclos (NxN).
  if (RE_ROTACION.test(texto)) {
    esRotacionOTurnante = true;
    const m = RE_ROTACION.exec(texto);
    if (m) anotaciones.push(m[0].trim());
    texto = texto.replace(RE_ROTACION, ' ');
  }

  // 5) Días completos por nombre ("DOMINGOS", "FESTIVOS" sueltos como metadato).
  const mDiaSuelto = /\bDOMINGOS?\b|\bFESTIVOS?\b/.exec(texto);
  if (mDiaSuelto && !/\d/.test(mDiaSuelto[0])) {
    anotaciones.push(mDiaSuelto[0].trim());
    // Festivos es metadato de cobertura, no se interpreta como diasDetectados
    // del patrón individual — se conserva solo como anotación (§7 del bloque).
    if (/^DOMINGOS?$/.test(mDiaSuelto[0].trim())) {
      diasDetectados = ['D'];
    }
    texto = texto.replace(mDiaSuelto[0], ' ');
  }

  // 6) Rango de días abreviado incrustado ("L-V", "L A V").
  const rango = extraerRangoDiasAbreviado(texto);
  if (rango) {
    diasDetectados = rango.dias;
    texto = texto.replace(rango.coincidencia, ' ');
  } else {
    // Día único abreviado suelto, ej. "... S" al final (sábado).
    const mSuelto = /(?:^|\s)(L|M|X|J|V|S|D)(?:$|\s)/.exec(texto);
    if (mSuelto && DIA_ABREV[mSuelto[1]]) {
      diasDetectados = [DIA_ABREV[mSuelto[1]]];
      texto = texto.slice(0, mSuelto.index) + ' ' + texto.slice(mSuelto.index + mSuelto[0].length);
    }
  }

  return {
    textoSinAnotaciones: texto.replace(/\s+/g, ' ').trim(),
    alias,
    anotaciones,
    diasDetectados,
    descansoDeclaradoMinutos,
    descansoSinDuracion,
    esRotacionOTurnante,
  };
}