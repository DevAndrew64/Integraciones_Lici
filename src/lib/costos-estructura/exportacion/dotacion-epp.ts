import ExcelJS from 'exceljs';
import { escribirTituloHoja, escribirEncabezados, escribirBannerNoAplica, autoAjustarColumnas, FORMATO_MONEDA } from './estilos-hoja-simple';
import type { CargoDotacionEppPantallaDto } from './costos-pantalla';

export interface DatosDotacionEppExport {
  estado: string;
  cargos: CargoDotacionEppPantallaDto[];
  /** El total que muestra la pestaña EPP y Dotación (suma de los valores únicos por cargo). */
  total: number;
}

const arr = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

/**
 * Hoja "EPP y Dotación" — por cargo, lista los productos de los grupos que
 * participan del costeo y el "valor único por cargo" tal como lo muestra la
 * pestaña (dotación promediada entre Masculino/Femenino + EPP). Todos los
 * valores vienen calculados de la pantalla; aquí no se suma ni se promedia.
 */
export function escribirHojaDotacionEpp(wb: ExcelJS.Workbook, datos: DatosDotacionEppExport): void {
  const ws = wb.addWorksheet('EPP y Dotación');
  let fila = escribirTituloHoja(ws, 'EPP Y DOTACIÓN');

  if (datos.estado === 'NO_APLICA') {
    escribirBannerNoAplica(ws, fila, 'EPP y Dotación');
    return;
  }

  for (const cargo of arr(datos.cargos)) {
    ws.getCell(fila, 1).value = `${cargo.cargo} — ${cargo.cantidadTrabajadores} trabajador(es)`;
    ws.getCell(fila, 1).font = { bold: true };
    fila++;
    escribirEncabezados(ws, fila, ['Grupo', 'Tipo', 'Código', 'Descripción', 'Unidad', 'Cantidad', 'Frecuencia', 'Valor unitario', 'Valor mensual']);
    fila++;
    for (const r of arr(cargo.filas)) {
      ws.getCell(fila, 1).value = r.grupo || '—';
      ws.getCell(fila, 2).value = r.tipo;
      ws.getCell(fila, 3).value = r.codigo || '—';
      ws.getCell(fila, 4).value = r.descripcion || '—';
      ws.getCell(fila, 5).value = r.unidad || '—';
      ws.getCell(fila, 6).value = r.cantidad ?? 0;
      ws.getCell(fila, 7).value = r.frecuencia ?? 0;
      const celdaVU = ws.getCell(fila, 8); celdaVU.value = r.valorUnitario ?? 0; celdaVU.numFmt = FORMATO_MONEDA;
      const celdaVM = ws.getCell(fila, 9); celdaVM.value = r.valorMensual ?? 0; celdaVM.numFmt = FORMATO_MONEDA;
      fila++;
    }
    ws.getCell(fila, 8).value = 'Valor único por cargo';
    ws.getCell(fila, 8).font = { bold: true };
    const celdaCargo = ws.getCell(fila, 9); celdaCargo.value = cargo.totalUnitario ?? 0; celdaCargo.numFmt = FORMATO_MONEDA; celdaCargo.font = { bold: true };
    fila += 2;
  }

  ws.getCell(fila, 8).value = 'TOTAL';
  ws.getCell(fila, 8).font = { bold: true };
  const celdaTotal = ws.getCell(fila, 9);
  celdaTotal.value = datos.total;
  celdaTotal.numFmt = FORMATO_MONEDA;
  celdaTotal.font = { bold: true };

  autoAjustarColumnas(ws, [16, 12, 10, 34, 10, 10, 12, 20, 16]);
}
