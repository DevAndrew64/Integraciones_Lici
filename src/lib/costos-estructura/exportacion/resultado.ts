import ExcelJS from 'exceljs';
import { escribirTituloHoja, escribirEncabezados, autoAjustarColumnas, FORMATO_MONEDA } from './estilos-hoja-simple';
import type { AdministrativosPantallaDto, TotalesPantallaDto } from './costos-pantalla';

export interface DatosResultadoExport {
  /** Los mismos valores que muestra el panel de Resumen de la pantalla. */
  totales: TotalesPantallaDto;
  administrativos: AdministrativosPantallaDto;
}

/** Hoja Resultado — escribe los totales de la pantalla tal cual; no suma ni recalcula. */
export function escribirHojaResultado(wb: ExcelJS.Workbook, datos: DatosResultadoExport): void {
  const ws = wb.addWorksheet('Resultado');
  let fila = escribirTituloHoja(ws, 'RESULTADO DEL COSTEO');
  const { totales, administrativos } = datos;

  escribirEncabezados(ws, fila, ['Componente', 'Valor mensual']);
  fila++;
  const filas: [string, number][] = [
    ['Mano de Obra (incl. Turnantes)', totales.manoObra],
    ['Insumos', totales.insumos],
    ['Maquinaria y Equipos', totales.maquinaria],
    ['Servicios no continuos', totales.serviciosNoContinuos],
    ['Valor agregado', totales.valorAgregado],
    ['Variables Administrativas', administrativos.totalVariables],
    ['Pólizas', administrativos.valorMensualPolizas],
    ['Impuestos', administrativos.valorMensualImpuestos],
  ];
  for (const [nombre, valor] of filas) {
    ws.getCell(`A${fila}`).value = nombre;
    const c = ws.getCell(`B${fila}`); c.value = valor; c.numFmt = FORMATO_MONEDA;
    fila++;
  }
  fila++;
  ws.getCell(`A${fila}`).value = 'Total mensual administrativo'; ws.getCell(`A${fila}`).font = { bold: true };
  const ca = ws.getCell(`B${fila}`); ca.value = totales.administrativos; ca.numFmt = FORMATO_MONEDA; ca.font = { bold: true };
  fila++;
  ws.getCell(`A${fila}`).value = 'COSTO MENSUAL GENERAL'; ws.getCell(`A${fila}`).font = { bold: true, size: 12 };
  const cg = ws.getCell(`B${fila}`); cg.value = totales.total; cg.numFmt = FORMATO_MONEDA; cg.font = { bold: true, size: 12 };

  if (totales.otrosCostosEnManoObra > 0) {
    ws.getCell(`A${fila + 2}`).value = 'Nota: Dotación, EPP, Exámenes, Cursos y Vacunas ya están incluidos en Mano de Obra; no se suman al total.';
    ws.getCell(`A${fila + 2}`).font = { italic: true };
  }

  autoAjustarColumnas(ws, [34, 20]);
}
