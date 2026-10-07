import ExcelJS from 'exceljs';
import { escribirTituloHoja, escribirEncabezados, escribirBannerNoAplica, autoAjustarColumnas, FORMATO_MONEDA } from './estilos-hoja-simple';
import type { CargoExamenesPantallaDto, FilaExamenPantallaDto } from './costos-pantalla';

export interface DatosExamenesMedicosExport {
  estado: string;
  cargos: CargoExamenesPantallaDto[];
  /** El total que muestra la pestaña Exámenes, Cursos y Vacunas (suma de los totales por cargo). */
  total: number;
}

const arr = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

/**
 * Hoja "Exámenes Médicos" — por cargo, lista exámenes, cursos y vacunas con
 * el valor mensual que ya calculó la pantalla, y el total por cargo tal como
 * lo muestra la pestaña. Aquí no se aplica ningún factor ni frecuencia.
 */
export function escribirHojaExamenesMedicos(wb: ExcelJS.Workbook, datos: DatosExamenesMedicosExport): void {
  const ws = wb.addWorksheet('Exámenes Médicos');
  let fila = escribirTituloHoja(ws, 'EXÁMENES MÉDICOS, CURSOS Y VACUNAS');

  if (datos.estado === 'NO_APLICA') {
    escribirBannerNoAplica(ws, fila, 'Exámenes Médicos, Cursos y Vacunas');
    return;
  }

  for (const cargo of arr(datos.cargos)) {
    ws.getCell(`A${fila}`).value = `${cargo.cargo} — ${cargo.cantidadTrabajadores} trabajador(es)`;
    ws.getCell(`A${fila}`).font = { bold: true, size: 12 };
    fila++;
    const secciones: [string, FilaExamenPantallaDto[]][] = [['Exámenes', arr(cargo.examenes)], ['Cursos', arr(cargo.cursos)], ['Vacunas', arr(cargo.vacunas)]];
    for (const [titulo, filas] of secciones) {
      ws.getCell(`A${fila}`).value = titulo.toUpperCase();
      ws.getCell(`A${fila}`).font = { bold: true };
      fila++;
      escribirEncabezados(ws, fila, ['Concepto', 'Ciudad / proveedor', 'Cantidad', 'Valor', 'Total mensual']);
      fila++;
      for (const f of filas) {
        ws.getCell(`A${fila}`).value = f.concepto || '—';
        ws.getCell(`B${fila}`).value = f.detalle || '—';
        ws.getCell(`C${fila}`).value = f.cantidad ?? 0;
        const cv = ws.getCell(`D${fila}`); cv.value = f.valor ?? 0; cv.numFmt = FORMATO_MONEDA;
        const ct = ws.getCell(`E${fila}`); ct.value = f.valorMensual ?? 0; ct.numFmt = FORMATO_MONEDA;
        fila++;
      }
      fila++;
    }
    ws.getCell(`D${fila}`).value = 'Total por cargo';
    ws.getCell(`D${fila}`).font = { bold: true };
    const cc = ws.getCell(`E${fila}`); cc.value = cargo.totalUnitario ?? 0; cc.numFmt = FORMATO_MONEDA; cc.font = { bold: true };
    fila += 2;
  }

  ws.getCell(`D${fila}`).value = 'TOTAL EXÁMENES/CURSOS/VACUNAS';
  ws.getCell(`D${fila}`).font = { bold: true };
  const ceTot = ws.getCell(`E${fila}`); ceTot.value = datos.total; ceTot.numFmt = FORMATO_MONEDA; ceTot.font = { bold: true };

  autoAjustarColumnas(ws, [30, 26, 10, 14, 30]);
}
