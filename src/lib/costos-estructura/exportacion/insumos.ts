import ExcelJS from 'exceljs';
import { escribirTituloHoja, escribirEncabezados, escribirBannerNoAplica, autoAjustarColumnas, FORMATO_MONEDA } from './estilos-hoja-simple';
import type { FilaInsumoPantallaDto } from './costos-pantalla';

export interface DatosInsumosExport {
  estado: string;
  filas: FilaInsumoPantallaDto[];
  /** El total que muestra la pestaña Insumos (sin las filas de Valor agregado). */
  total: number;
}

/**
 * Hoja Insumos — escribe las filas y el total tal como los muestra la
 * pantalla. Las filas marcadas como Valor agregado se listan (están en la
 * pestaña) pero no suman en este total, igual que en pantalla.
 */
export function escribirHojaInsumos(wb: ExcelJS.Workbook, datos: DatosInsumosExport): void {
  const ws = wb.addWorksheet('Insumos');
  const fila = escribirTituloHoja(ws, 'INSUMOS');

  if (datos.estado === 'NO_APLICA') {
    escribirBannerNoAplica(ws, fila, 'Insumos');
    return;
  }

  const filas = Array.isArray(datos.filas) ? datos.filas : [];
  escribirEncabezados(ws, fila, ['Código', 'Descripción', 'Unidad', 'Cantidad', 'Frecuencia (meses)', 'Valor unitario sin IVA', 'Valor unitario con IVA', 'Valor mensual', 'Valor agregado']);
  let f = fila + 1;
  for (const r of filas) {
    ws.getCell(f, 1).value = r.codigo || '—'; // insumo manual puede no tener código — nunca se fuerza uno
    ws.getCell(f, 2).value = r.nombre || '—';
    ws.getCell(f, 3).value = r.unidad || '—';
    ws.getCell(f, 4).value = r.cantidad ?? 0;
    ws.getCell(f, 5).value = r.frecuenciaMeses ?? 0;
    const c6 = ws.getCell(f, 6); c6.value = r.valorUnitarioSinIva ?? 0; c6.numFmt = FORMATO_MONEDA;
    const c7 = ws.getCell(f, 7); c7.value = r.valorUnitarioConIva ?? 0; c7.numFmt = FORMATO_MONEDA;
    const c8 = ws.getCell(f, 8); c8.value = r.valorMensual ?? 0; c8.numFmt = FORMATO_MONEDA;
    ws.getCell(f, 9).value = r.valorAgregado ? 'Sí (no suma aquí)' : '—';
    f++;
  }
  ws.getCell(f, 7).value = 'TOTAL';
  ws.getCell(f, 7).font = { bold: true };
  const ct = ws.getCell(f, 8); ct.value = datos.total; ct.numFmt = FORMATO_MONEDA; ct.font = { bold: true };

  autoAjustarColumnas(ws, [14, 34, 10, 10, 16, 18, 18, 16, 18]);
}
