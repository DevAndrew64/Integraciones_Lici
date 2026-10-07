import ExcelJS from 'exceljs';
import { escribirTituloHoja, escribirEncabezados, autoAjustarColumnas, FORMATO_MONEDA } from './estilos-hoja-simple';
import type { AdministrativosPantallaDto } from './costos-pantalla';

/**
 * Hoja Costos Administrativos — escribe los valores que la pantalla ya
 * calculó (variables con su cantidad efectiva, valor mensual de pólizas y de
 * impuestos incluido ICA/Avisos); no usa matrices ni fórmulas propias.
 */
export function escribirHojaCostosAdministrativos(wb: ExcelJS.Workbook, datos: AdministrativosPantallaDto & { total: number }): void {
  const ws = wb.addWorksheet('Costos Administrativos');
  let fila = escribirTituloHoja(ws, 'COSTOS ADMINISTRATIVOS');

  ws.getCell(`A${fila}`).value = 'VARIABLES ADMINISTRATIVAS'; ws.getCell(`A${fila}`).font = { bold: true }; fila++;
  escribirEncabezados(ws, fila, ['Concepto', 'Cantidad', 'Valor unitario', 'Valor mensual']); fila++;
  for (const r of datos.variables) {
    ws.getCell(`A${fila}`).value = r.concepto;
    ws.getCell(`B${fila}`).value = r.cantidad ?? 0;
    const cu = ws.getCell(`C${fila}`); cu.value = r.valorUnitario ?? 0; cu.numFmt = FORMATO_MONEDA;
    const cm = ws.getCell(`D${fila}`); cm.value = r.valorMensual ?? 0; cm.numFmt = FORMATO_MONEDA;
    fila++;
  }
  ws.getCell(`C${fila}`).value = 'Subtotal variables'; ws.getCell(`C${fila}`).font = { bold: true };
  const cv = ws.getCell(`D${fila}`); cv.value = datos.totalVariables; cv.numFmt = FORMATO_MONEDA; cv.font = { bold: true };
  fila += 2;

  ws.getCell(`A${fila}`).value = 'PÓLIZAS'; ws.getCell(`A${fila}`).font = { bold: true }; fila++;
  ws.getCell(`A${fila}`).value = 'Valor mensual de pólizas'; ws.getCell(`A${fila}`).font = { bold: true };
  const cp = ws.getCell(`D${fila}`); cp.value = datos.valorMensualPolizas; cp.numFmt = FORMATO_MONEDA; cp.font = { bold: true };
  fila += 2;

  ws.getCell(`A${fila}`).value = 'IMPUESTOS (incluye ICA/Avisos vía matriz por empresa-municipio)'; ws.getCell(`A${fila}`).font = { bold: true };
  fila++;
  ws.getCell(`A${fila}`).value = 'Valor mensual de impuestos'; ws.getCell(`A${fila}`).font = { bold: true };
  const ci = ws.getCell(`D${fila}`); ci.value = datos.valorMensualImpuestos; ci.numFmt = FORMATO_MONEDA; ci.font = { bold: true };
  fila += 2;

  // El total es el que muestra la pantalla (panel de Resumen); no se vuelve a sumar aquí.
  ws.getCell(`A${fila}`).value = 'TOTAL COSTOS ADMINISTRATIVOS'; ws.getCell(`A${fila}`).font = { bold: true };
  const ct = ws.getCell(`D${fila}`); ct.value = datos.total; ct.numFmt = FORMATO_MONEDA; ct.font = { bold: true };

  autoAjustarColumnas(ws, [34, 12, 18, 18]);
}
