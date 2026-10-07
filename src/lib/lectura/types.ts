export type MetodoExtraccion =
  | 'pdf_text'        // pdf-parse con pagerender — texto embebido por página real
  | 'pdf_aproximado'  // pdf-parse fallback — páginas divididas proporcionalmente por chars
  | 'word'            // mammoth DOCX
  | 'excel'           // ExcelJS XLSX
  | 'fallback'        // texto parcial o formato con error
  | 'document_ai_ocr'; // reservado L2 — no implementado

export type FormatoArchivo =
  | 'pdf'
  | 'word_docx'
  | 'word_doc'      // DOC binario antiguo — no soportado
  | 'excel_xlsx'
  | 'excel_xls'     // XLS binario antiguo — no soportado
  | 'imagen'
  | 'otro';

// Página de un documento con su número real
export type PaginaExtraida = {
  pagina: number;
  texto: string;
};

// Hoja de un Excel
export type HojaExtraida = {
  nombreHoja: string;
  texto: string;
};

// Bloque de texto para enviar a Gemini (PDF por página, Word/Excel por chars)
export type BloqueTexto = {
  numeroBloque: number;
  paginaInicial: number;    // 0 = no aplica (Word/Excel)
  paginaFinal: number;      // 0 = no aplica (Word/Excel)
  textoConMarcadores: string;
  tipoFuente: 'pdf' | 'word' | 'excel';
  chars: number;
  hojasIncluidas?: string[];
};

// Resultado unificado de extracción de un documento
export type DocumentoExtraido = {
  nombreDocumento: string;
  formato: FormatoArchivo;
  metodoExtraccion: MetodoExtraccion;
  textoCompleto: string;
  paginas: PaginaExtraida[];
  hojas: HojaExtraida[];
  advertencias: string[];
  requiereOcr: boolean;
  hashContenido: string;    // SHA-256 del buffer completo
  totalPaginas: number;
  totalChars: number;
};