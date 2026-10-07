/**
 * Ajuste "EXPORTAR COSTOS — EXCEL GENERAL CON TODAS LAS PESTAÑAS" — estilo
 * compartido MÍNIMO para las hojas nuevas (Resumen/EPP y Dotación/
 * Exámenes Médicos/Insumos/Maquinaria y Equipos/Costos Administrativos/
 * Resultado), que NO existían en ninguna plantilla real (confirmado
 * inspeccionando "Mano de obra.xlsx": solo tiene la hoja "Mano de Obra").
 * Diseño tabular simple y legible (decisión explícita del usuario: "diseño
 * simple/funcional ahora", nunca un diseño corporativo inventado) — nunca
 * se aplica a la hoja "Mano de Obra" (esa conserva exactamente su propio
 * formato real, ver `poblarHojaManoObra`).
 */
import ExcelJS from 'exceljs';

export const COLOR_ENCABEZADO = 'FF1E3A5F';
export const COLOR_TEXTO_ENCABEZADO = 'FFFFFFFF';
export const FORMATO_MONEDA = '$#,##0';

export function escribirEncabezados(ws: ExcelJS.Worksheet, fila: number, encabezados: string[]): void {
  const row = ws.getRow(fila);
  encabezados.forEach((texto, i) => {
    const cell = row.getCell(i + 1);
    cell.value = texto;
    cell.font = { bold: true, color: { argb: COLOR_TEXTO_ENCABEZADO } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ENCABEZADO } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  row.commit();
}

export function escribirTituloHoja(ws: ExcelJS.Worksheet, titulo: string, subtitulo?: string): number {
  ws.getCell('A1').value = titulo;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: COLOR_ENCABEZADO } };
  if (subtitulo) {
    ws.getCell('A2').value = subtitulo;
    ws.getCell('A2').font = { italic: true, color: { argb: 'FF64748B' } };
    return 4;
  }
  return 3;
}

/** Banner "NO APLICA PARA ESTE PROCESO" — mantiene la hoja presente (nunca
 * la oculta ni la deja parecer un error de exportación), con el mismo
 * encabezado de identificación del proceso que las demás hojas. */
export function escribirBannerNoAplica(ws: ExcelJS.Worksheet, filaInicio: number, nombreModulo: string): void {
  const cell = ws.getCell(`A${filaInicio}`);
  cell.value = `${nombreModulo.toUpperCase()} — NO APLICA PARA ESTE PROCESO`;
  cell.font = { bold: true, size: 12, color: { argb: 'FF92400E' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
  ws.mergeCells(`A${filaInicio}:F${filaInicio}`);
}

export function autoAjustarColumnas(ws: ExcelJS.Worksheet, anchos: number[]): void {
  anchos.forEach((ancho, i) => { ws.getColumn(i + 1).width = ancho; });
}
