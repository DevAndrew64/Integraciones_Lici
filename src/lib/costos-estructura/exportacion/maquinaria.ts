import ExcelJS from 'exceljs';
import { escribirTituloHoja, escribirEncabezados, escribirBannerNoAplica, autoAjustarColumnas, FORMATO_MONEDA } from './estilos-hoja-simple';
import type { FilaMaquinariaPantallaDto } from './costos-pantalla';

export interface DatosMaquinariaExport {
  estado: string;
  filas: FilaMaquinariaPantallaDto[];
  /** Subtotales y total que muestra la pestaña (sin las filas de Valor agregado). */
  subtotalAdquisicion: number;
  subtotalMantenimiento: number;
  total: number;
}

/**
 * Hoja Maquinaria y Equipos — escribe las filas y los subtotales tal como los
 * muestra la pantalla. Las filas marcadas como Valor agregado se listan pero
 * no suman en los subtotales, igual que en pantalla.
 */
export function escribirHojaMaquinaria(wb: ExcelJS.Workbook, datos: DatosMaquinariaExport): void {
  const ws = wb.addWorksheet('Maquinaria y Equipos');
  const fila = escribirTituloHoja(ws, 'MAQUINARIA Y EQUIPOS');

  if (datos.estado === 'NO_APLICA') {
    escribirBannerNoAplica(ws, fila, 'Maquinaria y Equipos');
    return;
  }

  const filas = Array.isArray(datos.filas) ? datos.filas : [];
  escribirEncabezados(ws, fila, ['Código', 'Descripción', 'Categoría', 'Cant. requerida', 'Cant. a comprar', 'Valor unitario', 'Valor mes (compra)', 'Valor mes (mantenimiento)', 'Valor agregado']);
  let f = fila + 1;
  for (const r of filas) {
    ws.getCell(f, 1).value = r.codigo || '—';
    ws.getCell(f, 2).value = r.descripcion || '—';
    ws.getCell(f, 3).value = r.categoria || '—';
    ws.getCell(f, 4).value = r.cantidadRequerida ?? 0;
    ws.getCell(f, 5).value = r.cantidadComprar ?? 0;
    const c6 = ws.getCell(f, 6); c6.value = r.valorUnitario ?? 0; c6.numFmt = FORMATO_MONEDA;
    const c7 = ws.getCell(f, 7); c7.value = r.valorMesComprar ?? 0; c7.numFmt = FORMATO_MONEDA;
    const c8 = ws.getCell(f, 8); c8.value = r.valorMesMantenimiento ?? 0; c8.numFmt = FORMATO_MONEDA;
    ws.getCell(f, 9).value = r.valorAgregado ? 'Sí (no suma aquí)' : '—';
    f++;
  }
  ws.getCell(f, 6).value = 'TOTAL';
  ws.getCell(f, 6).font = { bold: true };
  const c7t = ws.getCell(f, 7); c7t.value = datos.subtotalAdquisicion; c7t.numFmt = FORMATO_MONEDA; c7t.font = { bold: true };
  const c8t = ws.getCell(f, 8); c8t.value = datos.subtotalMantenimiento; c8t.numFmt = FORMATO_MONEDA; c8t.font = { bold: true };
  f++;
  ws.getCell(f, 6).value = 'TOTAL GENERAL';
  ws.getCell(f, 6).font = { bold: true };
  const ct = ws.getCell(f, 7); ct.value = datos.total; ct.numFmt = FORMATO_MONEDA; ct.font = { bold: true };

  autoAjustarColumnas(ws, [14, 32, 16, 14, 14, 16, 18, 20, 18]);
}
