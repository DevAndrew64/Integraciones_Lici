export type ResponseDepth = 'breve' | 'normal' | 'detallada' | 'ejecutiva' | 'tecnica';

function q(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const BREVE = [
  'corto', 'resumido', 'breve', 'en pocas palabras', 'directo', 'solo dime',
  'solo el dato', 'rapido', 'sin tanto', 'no tan extenso', 'no tan largo',
  'dame solo', 'respuesta corta',
];

const DETALLADA = [
  'explicame', 'explica', 'dame todo', 'bien explicado', 'completo',
  'como para entender', 'dame contexto', 'respuesta larga', 'detallado',
  'analiza', 'analisis', 'en detalle', 'desarrolla', 'amplio', 'extenso',
  'quiero entender', 'dame mas', 'profundiza',
];

const EJECUTIVA = [
  'para presentar', 'para exponer', 'para gerencia', 'resumen ejecutivo',
  'ejecutivo', 'para la junta', 'presentacion', 'diapositiva', 'para mostrar',
];

const TECNICA = [
  'codigo', 'api', 'base de datos', 'sql', 'query', 'gemini', 'endpoint',
  'funcion', 'componente', 'react', 'typescript', 'javascript', 'debug',
  'error', 'bug', 'secop', 'estructura de costos', 'costos laborales',
  'formula', 'calculo', 'normativa tecnica', 'decreto', 'resolucion',
];

export function detectResponseDepth(pregunta: string): ResponseDepth {
  const p = q(pregunta);
  if (EJECUTIVA.some(t => p.includes(q(t)))) return 'ejecutiva';
  if (BREVE.some(t => p.includes(q(t)))) return 'breve';
  if (DETALLADA.some(t => p.includes(q(t)))) return 'detallada';
  if (TECNICA.some(t => p.includes(q(t)))) return 'tecnica';
  return 'normal';
}

export const MAX_TOKENS: Record<ResponseDepth, number> = {
  breve:    800,
  normal:   2000,
  detallada: 5000,
  ejecutiva: 2500,
  tecnica:   6000,
};

export const TEMPERATURE: Record<ResponseDepth, number> = {
  breve:     0.3,
  normal:    0.4,
  detallada: 0.5,
  ejecutiva: 0.45,
  tecnica:   0.25,
};

export const DEPTH_INSTRUCTIONS: Record<ResponseDepth, string> = {
  breve: `LONGITUD: Respuesta CORTA. Máximo 2-3 párrafos breves. Sin listas largas, sin secciones. Solo el dato y contexto mínimo imprescindible.`,
  normal: `LONGITUD: Respuesta equilibrada. Incluye el dato, contexto relevante y una acción sugerida si aplica. No extendas si no es necesario.`,
  detallada: `LONGITUD: Respuesta AMPLIA y COMPLETA. Organiza por secciones con encabezados. Incluye contexto, explicación por partes, ejemplos prácticos y recomendaciones. No respondas en una sola frase.`,
  ejecutiva: `LONGITUD: Respuesta en FORMATO EJECUTIVO para presentar a directivos. Empieza con el dato clave, luego contexto estructurado (bullets cortos), cierra con acción recomendada. Lenguaje formal y preciso.`,
  tecnica: `LONGITUD: Respuesta TÉCNICA completa. Incluye diagnóstico, causa, solución, pasos o código si aplica. Sé exhaustivo pero preciso.`,
};