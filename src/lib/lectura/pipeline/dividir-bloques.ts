import type { BloqueTexto, PaginaExtraida } from '../types';

/**
 * Divide páginas de PDF en bloques de texto con overlap de 1 página.
 *
 * El overlap conserva la última página de cada bloque en el siguiente
 * para no cortar cláusulas contractuales que cruzan el límite.
 *
 * @param paginas  Array de páginas extraídas (con número real de página)
 * @param maxChars Tamaño máximo de cada bloque en caracteres (default 40.000)
 */
export function dividirPaginasEnBloques(
  paginas: PaginaExtraida[],
  maxChars = 40_000,
): BloqueTexto[] {
  const bloques: BloqueTexto[] = [];
  let buffer: PaginaExtraida[] = [];
  let chars = 0;
  let numBloque = 1;

  const flush = () => {
    if (!buffer.length) return;
    const texto = buffer
      .map(p => `[INICIO_PAGINA ${p.pagina}]\n${p.texto}\n[FIN_PAGINA ${p.pagina}]`)
      .join('\n\n');
    bloques.push({
      numeroBloque: numBloque++,
      paginaInicial: buffer[0].pagina,
      paginaFinal: buffer[buffer.length - 1].pagina,
      textoConMarcadores: texto,
      tipoFuente: 'pdf',
      chars: texto.length,
    });
    // Overlap: conservar última página en el siguiente bloque
    if (buffer.length > 1) {
      const lastPage = buffer[buffer.length - 1];
      const lastMarcado = `[INICIO_PAGINA ${lastPage.pagina}]\n${lastPage.texto}\n[FIN_PAGINA ${lastPage.pagina}]`;
      buffer = [lastPage];
      chars = lastMarcado.length;
    } else {
      buffer = [];
      chars = 0;
    }
  };

  for (const p of paginas) {
    const marcado = `[INICIO_PAGINA ${p.pagina}]\n${p.texto}\n[FIN_PAGINA ${p.pagina}]`;
    if (chars + marcado.length > maxChars && buffer.length > 0) flush();
    buffer.push(p);
    chars += marcado.length;
  }
  flush();
  return bloques;
}

/**
 * Divide texto continuo (Word o Excel) en bloques de tamaño máximo.
 * No aplica overlap porque no hay estructura de página.
 *
 * @param texto          Texto completo del documento
 * @param tipoFuente     'word' o 'excel'
 * @param hojasIncluidas Nombres de hojas (solo para Excel)
 * @param maxChars       Tamaño máximo de cada bloque (default 40.000)
 */
export function dividirTextoEnBloques(
  texto: string,
  tipoFuente: 'word' | 'excel',
  hojasIncluidas: string[] = [],
  maxChars = 40_000,
): BloqueTexto[] {
  if (!texto.trim()) return [];
  const bloques: BloqueTexto[] = [];
  let numBloque = 1;
  for (let i = 0; i < texto.length; i += maxChars) {
    const segmento = texto.slice(i, i + maxChars);
    bloques.push({
      numeroBloque: numBloque++,
      paginaInicial: 0,
      paginaFinal: 0,
      textoConMarcadores: segmento,
      tipoFuente,
      chars: segmento.length,
      hojasIncluidas,
    });
  }
  return bloques;
}