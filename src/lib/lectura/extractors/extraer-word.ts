// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const mammoth: any = require('mammoth');

export type ResultadoExtracionWord = {
  texto: string;
  metodo: 'word' | 'word_no_soportado';
  advertencias: string[];
};

/**
 * Extrae texto plano de documentos Word usando mammoth.
 *
 * - DOCX (ZIP-based): soportado completamente.
 * - DOC binario antiguo (OLE2): detectado por mensaje de error de mammoth,
 *   devuelve error claro en advertencias sin lanzar excepción.
 *
 * No lanza error — reporta problemas en advertencias y retorna texto vacío si falla.
 */
export async function extraerWord(buf: Buffer, nombreDocumento: string): Promise<ResultadoExtracionWord> {
  const advertencias: string[] = [];
  try {
    const result = await mammoth.extractRawText({ buffer: buf }) as {
      value: string;
      messages: { type: string; message: string }[];
    };
    const texto = result.value || '';
    const warns = result.messages
      .filter((m: { type: string }) => m.type !== 'warning')
      .map((m: { message: string }) => `mammoth: ${m.message}`);
    advertencias.push(...warns);
    if (!texto.trim()) {
      return {
        texto: '',
        metodo: 'word',
        advertencias: [...advertencias, `DOCX "${nombreDocumento}" sin texto extraíble.`],
      };
    }
    return { texto, metodo: 'word', advertencias };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const esLegacy = /End of Central Directory|magic number|Not a ZIP|corrupt|invalid/i.test(msg);
    const advertencia = esLegacy
      ? `FORMATO_WORD_NO_SOPORTADO: "${nombreDocumento}" es DOC binario antiguo. Convertir a .docx para procesar.`
      : `Error extrayendo Word "${nombreDocumento}": ${msg}`;
    return { texto: '', metodo: 'word_no_soportado', advertencias: [advertencia] };
  }
}