const MIN_CHARS_POR_PAGINA = 80;
const MIN_PORCENTAJE_PAGINAS_OK = 0.30; // al menos 30% de páginas con texto suficiente

export type ResultadoDeteccionEscaneado = {
  requiereOcr: boolean;
  porcentajePaginasConTexto: number;
  paginasVacias: number[];
  advertencias: string[];
};

/**
 * Detecta si un PDF es posiblemente escaneado analizando la densidad de texto por página.
 * Una página se considera "con texto" si tiene al menos MIN_CHARS_POR_PAGINA caracteres.
 * Si menos del 30% de páginas tienen texto suficiente, el PDF requiere OCR.
 */
export function detectarPdfEscaneado(
  paginas: { pagina: number; texto: string }[],
): ResultadoDeteccionEscaneado {
  if (paginas.length === 0) {
    return {
      requiereOcr: true,
      porcentajePaginasConTexto: 0,
      paginasVacias: [],
      advertencias: ['PDF sin páginas detectadas. Posiblemente corrupto o escaneado.'],
    };
  }

  const vacias = paginas.filter(p => p.texto.trim().length < MIN_CHARS_POR_PAGINA);
  const conTexto = paginas.length - vacias.length;
  const porcentaje = conTexto / paginas.length;
  const requiereOcr = porcentaje < MIN_PORCENTAJE_PAGINAS_OK;

  const advertencias: string[] = [];
  if (requiereOcr) {
    advertencias.push(
      `PDF posiblemente escaneado: ${Math.round(porcentaje * 100)}% de páginas con texto suficiente ` +
      `(mínimo ${Math.round(MIN_PORCENTAJE_PAGINAS_OK * 100)}%). ` +
      'Requiere OCR Document AI (disponible en fase L2).'
    );
  } else if (vacias.length > 0) {
    const listaVacias = vacias.map(p => p.pagina).slice(0, 10).join(', ') + (vacias.length > 10 ? '...' : '');
    advertencias.push(
      `${vacias.length} página(s) sin texto suficiente (posiblemente imágenes o tablas escaneadas): ${listaVacias}.`
    );
  }

  return {
    requiereOcr,
    porcentajePaginasConTexto: porcentaje,
    paginasVacias: vacias.map(p => p.pagina),
    advertencias,
  };
}