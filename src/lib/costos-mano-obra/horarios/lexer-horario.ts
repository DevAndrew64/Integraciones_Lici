/**
 * Etapas 5-7 — Segmentación estructural del texto (ya sin anotaciones):
 * separar por "//" (distribuciones/rotaciones/alternativas), luego cada
 * distribución por "Y" (bloques del mismo día), y detectar rangos sin "Y"
 * (familia C: cuatro horas sueltas que deberían ser dos bloques).
 * No interpreta horas — solo divide el texto en segmentos.
 */

export type SeparadorDistribucion = 'DOBLE_BARRA' | 'ALTERNATIVA' | 'NINGUNO';

export interface ResultadoSegmentacionDistribuciones {
  segmentos: string[];
  separador: SeparadorDistribucion;
  separadorDegradado: boolean;
  advertencias: string[];
}

/** "Ó"/"O"/"OPCIÓN"/"ALTERNATIVA" como separador de alternativas — solo
 * cuando el token está aislado y no es parte de otra palabra. */
const RE_ALTERNATIVA = /\s+(?:Ó|OPCI[OÓ]N|ALTERNATIVA)\s+|\sO\s+(?=\d)/;

export function segmentarDistribuciones(texto: string): ResultadoSegmentacionDistribuciones {
  const advertencias: string[] = [];

  // ":// " (degradado: probablemente "//" mal digitado) — se revisa ANTES
  // que "//" simple, porque ":// " también contiene "//" y sería capturado
  // por el patrón limpio si se revisara primero.
  const mDegradadoDobleP = /:\/\//.exec(texto);
  if (mDegradadoDobleP) {
    advertencias.push('Se interpretó "://" como separador de distribuciones ("//").');
    return { segmentos: texto.split(/:\/\//).map(s => s.trim()).filter(Boolean), separador: 'DOBLE_BARRA', separadorDegradado: true, advertencias };
  }
  // "//" real.
  if (/\/\//.test(texto)) {
    return { segmentos: texto.split(/\/\//).map(s => s.trim()).filter(Boolean), separador: 'DOBLE_BARRA', separadorDegradado: false, advertencias };
  }

  if (RE_ALTERNATIVA.test(texto)) {
    return { segmentos: texto.split(RE_ALTERNATIVA).map(s => s.trim()).filter(Boolean), separador: 'ALTERNATIVA', separadorDegradado: false, advertencias };
  }

  // "/" suelto (no doble) — posible "//" mal digitado. Se conserva como
  // separador, pero SIEMPRE marcado como degradado (nunca aprobado en
  // silencio, §P).
  if (/[^/]\/[^/]/.test(texto)) {
    advertencias.push('Se interpretó "/" como separador de distribuciones ("//") — verificar, es un separador no estándar.');
    return { segmentos: texto.split(/(?<!\/)\/(?!\/)/).map(s => s.trim()).filter(Boolean), separador: 'DOBLE_BARRA', separadorDegradado: true, advertencias };
  }

  return { segmentos: [texto.trim()], separador: 'NINGUNO', separadorDegradado: false, advertencias };
}

export interface ResultadoSegmentacionBloques {
  segmentosBloque: string[];
  huboSeparadorY: boolean;
}

/** Divide una distribución en segmentos de bloque por "Y" (palabra completa). */
export function segmentarBloquesPorY(textoDistribucion: string): ResultadoSegmentacionBloques {
  const partes = textoDistribucion.split(/\bY\b/).map(s => s.trim()).filter(Boolean);
  return { segmentosBloque: partes, huboSeparadorY: partes.length > 1 };
}

/** Un "token de hora" reconocible en crudo (antes de interpretarHora): dígitos
 * con ":"/"." opcional, sufijo AM/PM/M opcional. Usado para contar cuántas
 * horas sueltas hay en un segmento sin separadores claros (familia C). */
const RE_TOKEN_HORA = /\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:AM|PM|M)?/g;

export interface ResultadoDeteccionSinY {
  horas: string[];
  cantidad: number;
}

/** Cuenta las horas sueltas reconocibles en un segmento sin "Y" — para la
 * heurística de la familia C (cuatro horas → dos bloques implícitos). */
export function detectarHorasSueltas(segmento: string): ResultadoDeteccionSinY {
  const horas = (segmento.match(RE_TOKEN_HORA) ?? []).map(h => h.trim());
  return { horas, cantidad: horas.length };
}