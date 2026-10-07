// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExcelJS = require('exceljs') as typeof import('exceljs');

export type ResultadoExtracionExcel = {
  texto: string;
  hojas: string[];
  advertencias: string[];
};

/**
 * Extrae texto de archivos Excel XLSX usando ExcelJS.
 *
 * - XLSX / XLSM / XLSB: soportados.
 * - XLS binario antiguo (OLE2): detectado por error de ExcelJS,
 *   devuelve error claro en advertencias.
 *
 * Formato de salida:
 *   [INICIO_DOCUMENTO nombre]
 *   [INICIO_HOJA NombreHoja]
 *   col1 | col2 | col3
 *   [FIN_HOJA NombreHoja]
 *   [FIN_DOCUMENTO nombre]
 *
 * No lanza error — reporta problemas en advertencias y retorna texto vacío si falla.
 */
export async function extraerExcel(buf: Buffer, nombreDocumento: string): Promise<ResultadoExtracionExcel> {
  const advertencias: string[] = [];
  try {
    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buf as any);

    const hojas: string[] = workbook.worksheets.map((ws: { name: string }) => ws.name);
    if (hojas.length === 0) {
      return { texto: '', hojas: [], advertencias: [`Excel "${nombreDocumento}" sin hojas visibles.`] };
    }

    let textoFull = `[INICIO_DOCUMENTO ${nombreDocumento}]\n`;
    for (const ws of workbook.worksheets) {
      const nombreHoja = ws.name;
      textoFull += `\n[INICIO_HOJA ${nombreHoja}]\n`;
      let filasConDatos = 0;
      ws.eachRow((row: { values: unknown }) => {
        const vals = Array.isArray(row.values) ? (row.values as unknown[]).slice(1) : [];
        const cells = vals.map((c: unknown) => String(c ?? '').trim()).filter(Boolean);
        if (cells.length) {
          textoFull += cells.join(' | ') + '\n';
          filasConDatos++;
        }
      });
      if (filasConDatos === 0) {
        advertencias.push(`Hoja "${nombreHoja}" en "${nombreDocumento}" está vacía.`);
      }
      textoFull += `[FIN_HOJA ${nombreHoja}]\n`;
    }
    textoFull += `\n[FIN_DOCUMENTO ${nombreDocumento}]\n`;

    return { texto: textoFull, hojas, advertencias };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const esLegacy = /BIFF|WorkBook|OLE2|CFB|xls|magic/i.test(msg) || msg.includes('End of Central Directory');
    if (esLegacy) {
      return {
        texto: '',
        hojas: [],
        advertencias: [`FORMATO_EXCEL_NO_SOPORTADO: "${nombreDocumento}" es XLS binario antiguo. Convertir a .xlsx para procesar.`],
      };
    }
    return {
      texto: '',
      hojas: [],
      advertencias: [`Error extrayendo Excel "${nombreDocumento}": ${msg}`],
    };
  }
}