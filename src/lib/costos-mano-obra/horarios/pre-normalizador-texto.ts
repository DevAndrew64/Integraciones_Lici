/**
 * Etapa 1 — Pre-normalización tipográfica. Limpieza puramente superficial
 * del texto histórico (espacios, guiones unicode, mayúsculas, variantes de
 * AM/PM) — nunca reinterpreta semántica de horario aquí (eso es tarea de
 * etapas posteriores). No es una regex monolítica: cada transformación es
 * una función independiente y documentada.
 */

function colapsarEspacios(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function normalizarGuiones(s: string): string {
  // En-dash, em-dash, minus sign unicode → guion ASCII.
  return s.replace(/[‐-―−]/g, '-');
}

function normalizarMayusculas(s: string): string {
  return s.toLocaleUpperCase('es-CO');
}

function normalizarAmPm(s: string): string {
  return s
    .replace(/\bA\.?\s*M\.?\b/gi, 'AM')
    .replace(/\bP\.?\s*M\.?\b/gi, 'PM');
}

/** "A LAS"/"A LA"/"HASTA" como separador de rango → "A" (mismo significado que "-"). */
function normalizarConectorRango(s: string): string {
  return s.replace(/\bHASTA\b/g, 'A').replace(/\bA\s+LAS?\b/g, 'A');
}

export interface ResultadoPreNormalizacion {
  textoPreNormalizado: string;
}

export function preNormalizarTexto(textoOriginal: string): ResultadoPreNormalizacion {
  let s = textoOriginal ?? '';
  s = normalizarGuiones(s);
  s = normalizarMayusculas(s);
  s = normalizarAmPm(s);
  s = normalizarConectorRango(s);
  s = colapsarEspacios(s);
  return { textoPreNormalizado: s };
}