import { describe, expect, it, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { generarExcelManoObra, nombreArchivoExportacion } from './generar-excel-mano-obra';
import type { FichaManoObraExportDto, DetalleUnitarioExportDto } from './tipos-exportacion';

const RUTA_PLANTILLA = path.join(process.cwd(), 'data', 'importaciones', 'Mano de obra', 'Mano de obra.xlsx');


function detalle(overrides: Partial<DetalleUnitarioExportDto> = {}): DetalleUnitarioExportDto {
  return {
    salarioBasico: 1750905, bonoPrestacional: 0,
    recargoNocturno: 50000, horaExtraDiurna: 20000, horaExtraNocturna: 15000, dominicalesFestivos: 300000,
    horaExtraFestiva: 10000, horaExtraFestivaNocturna: 5000, recargoNocturnoFestivo: 8000, totalRecargos: 408000,
    auxilioTransporte: 249095, subtotalSalarial: 2408000,
    cesantias: 100000, prima: 100000, vacaciones: 60000, interesesCesantias: 12000, totalPrestaciones: 272000,
    salud: 0, pension: 150000, arl: 30000, totalSeguridadSocial: 180000,
    cajaCompensacion: 80000, sena: 0, icbf: 0, totalParafiscales: 80000,
    dotacion: 40000, epp: 30000, examenes: 5000, cursos: 3000, vacunas: 2000, totalOtrosCostos: 80000,
    bonosNoPrestacionales: 15000, costoLaboralUnitario: 3035000,
    porcentajeCesantias: 0.0833, porcentajePrima: 0.0833, porcentajeVacaciones: 0.05, porcentajeInteresesCesantias: 0.01,
    porcentajeSalud: 0, porcentajePension: 0.12, porcentajeArl: 0.00522,
    porcentajeCaja: 0.04, porcentajeSena: 0, porcentajeIcbf: 0,
    horasRecargoNocturno: 10, horasExtraDiurna: 4, horasExtraNocturna: 3,
    horasDominicalesFestivos: 8, horasExtraFestiva: 1.5, horasExtraFestivaNocturna: 2, horasRecargoNocturnoFestivo: 1,
    esMetodologiaSemanal: 0, horasSemanalesExtraDiurna: 0, horasSemanalesExtraNocturna: 0,
    ...overrides,
  };
}

function ficha(overrides: Partial<FichaManoObraExportDto> = {}): FichaManoObraExportDto {
  return {
    fichaId: 'f1', tipo: 'CARGO', orden: 0,
    cargo: 'ASEADOR', horario: 'Lunes a Domingo · 06:00-14:00 + Incluye festivos',
    cantidadTrabajadores: 4, horasSemanales: 56,
    detalleUnitario: detalle(),
    totalCargo: 3035000 * 4,
    ...overrides,
  };
}

async function cargarHoja(buf: Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb.getWorksheet('Mano de Obra')!;
}

describe('generarExcelManoObra', () => {
  let bufferPlantilla: Buffer;
  beforeAll(async () => { bufferPlantilla = await readFile(RUTA_PLANTILLA); });

  it('1) un cargo genera una ficha en A1:M52', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    const ws = await cargarHoja(out);
    expect(ws.rowCount).toBe(52);
  });

  it('2) dos cargos generan la segunda ficha en A56:M107', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha({ fichaId: 'f1' }), ficha({ fichaId: 'f2', cargo: 'TODERO' })] });
    const ws = await cargarHoja(out);
    expect(ws.getCell('A57').value).toBe('TODERO');
    expect(ws.rowCount).toBe(107);
  });

  it('3) existen tres filas vacías entre fichas', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha(), ficha({ fichaId: 'f2' })] });
    const ws = await cargarHoja(out);
    for (const fila of [53, 54, 55]) {
      for (let c = 1; c <= 13; c++) expect(ws.getRow(fila).getCell(c).value).toBeNull();
    }
  });

  it('4) tres cargos generan la tercera ficha en A111:M162', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha({ fichaId: 'f1' }), ficha({ fichaId: 'f2' }), ficha({ fichaId: 'f3', cargo: 'JARDINERO' })] });
    const ws = await cargarHoja(out);
    expect(ws.getCell('A112').value).toBe('JARDINERO');
    expect(ws.rowCount).toBe(162);
  });

  it('5/6/7/8/9) se conservan colores, bordes, fuentes, formatos numéricos y celdas combinadas entre la primera ficha y la clonada', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha({ fichaId: 'f1' }), ficha({ fichaId: 'f2' })] });
    const ws = await cargarHoja(out);
    const a1 = ws.getCell('A1'); const a56 = ws.getCell('A56');
    expect(JSON.stringify(a56.fill)).toBe(JSON.stringify(a1.fill));
    expect(JSON.stringify(a56.font)).toBe(JSON.stringify(a1.font));
    expect(JSON.stringify(a56.border)).toBe(JSON.stringify(a1.border));
    expect(ws.getCell('C6').numFmt).toBe(ws.getCell('C61').numFmt);
    const merges = ws.model.merges as string[];
    expect(merges).toContain('A57:C57'); // A2:C2 desplazado 55 filas
    expect(merges).toContain('A59:C59'); // A4:C4 desplazado 55 filas
  });

  it('10/11) cargo se escribe en A2:C2 y horario en A4:C4 de su bloque', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha({ cargo: 'ASEADOR', horario: 'Lunes a Domingo · 06:00-14:00' })] });
    const ws = await cargarHoja(out);
    expect(ws.getCell('A2').value).toBe('ASEADOR');
    expect(ws.getCell('A4').value).toBe('Lunes a Domingo · 06:00-14:00');
  });

  it('12) los valores unitarios se ubican correctamente (C6:C16)', async () => {
    const d = detalle();
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha({ detalleUnitario: d })] });
    const ws = await cargarHoja(out);
    expect(ws.getCell('C6').value).toBe(d.salarioBasico);
    expect(ws.getCell('C7').value).toBe(d.bonoPrestacional);
    // Ajuste "estos de la izquierda deben venir del resultado de la tabla
    // de la derecha" — Rec. noct. (C8) ya no es un valor suelto, es una
    // fórmula que referencia el "Costo mensual" de la columna G (ver
    // bloque LIQUIDACIÓN DE HORAS).
    expect(ws.getCell('C8').value).toEqual({ formula: 'ROUND(G8,0)' });
    expect(ws.getCell('C16').value).toBe(d.auxilioTransporte);
  });

  it('§1/§2/§3 — los porcentajes reales (B20:B23, B27:B29, B33:B35) se escriben como números decimales, nunca 0 fijo ni texto', async () => {
    const d = detalle({ porcentajeCesantias: 0.0833, porcentajeArl: 0.0696, porcentajeCaja: 0.04, porcentajeSena: 0, porcentajeIcbf: 0 });
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha({ detalleUnitario: d })] });
    const ws = await cargarHoja(out);
    expect(ws.getCell('B20').value).toBe(0.0833); // Cesantías
    expect(typeof ws.getCell('B20').value).toBe('number');
    expect(ws.getCell('B29').value).toBe(0.0696); // ARL real, no hardcodeado
    expect(ws.getCell('B33').value).toBe(0.04); // Caja de compensación
    expect(ws.getCell('B34').value).toBe(0); // SENA exonerado
    expect(ws.getCell('B20').numFmt).toContain('%'); // formato de la plantilla, sin tocar
  });

  it('Ajuste "ACA LA FORMULA SERIA ASI" / "ESTOS DEBERIAN TENER FORMULAS" — Prestaciones/Seguridad Social/Parafiscales (C20:C23, C27:C29, C33:C35) son fórmulas B×base en fichas CARGO, referenciando en vivo las celdas de Salario/Bono/Recargos/Vacaciones ya escritas — nunca un número suelto. Cesantías/Prima/Intereses incluyen Auxilio de transporte (=Subtotal salarial, C17); el resto lo excluye (Salario+Bono+Recargos, C6+C7+C15); Caja suma también Vacaciones (C22)', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    const ws = await cargarHoja(out);
    expect(ws.getCell('C20').value).toEqual({ formula: 'ROUND(B20*C17,0)' }); // Cesantías — con auxilio
    expect(ws.getCell('C21').value).toEqual({ formula: 'ROUND(B21*C17,0)' }); // Prima — con auxilio
    expect(ws.getCell('C22').value).toEqual({ formula: 'ROUND(B22*(C6+C7+C15),0)' }); // Vacaciones — sin auxilio
    expect(ws.getCell('C23').value).toEqual({ formula: 'ROUND(B23*C17,0)' }); // Intereses de cesantías — con auxilio
    expect(ws.getCell('C27').value).toEqual({ formula: 'ROUND(B27*(C6+C7+C15),0)' }); // Salud
    expect(ws.getCell('C28').value).toEqual({ formula: 'ROUND(B28*(C6+C7+C15),0)' }); // Pensión
    expect(ws.getCell('C29').value).toEqual({ formula: 'ROUND(B29*(C6+C7+C15),0)' }); // ARL
    expect(ws.getCell('C33').value).toEqual({ formula: 'ROUND(B33*(C6+C7+C15+C22),0)' }); // Caja — incluye Vacaciones
    expect(ws.getCell('C34').value).toEqual({ formula: 'ROUND(B34*(C6+C7+C15),0)' }); // SENA
    expect(ws.getCell('C35').value).toEqual({ formula: 'ROUND(B35*(C6+C7+C15),0)' }); // ICBF
  });

  it('en fichas TURNANTE, Prestaciones/Seguridad Social/Parafiscales usan la MISMA fórmula B×base que CARGO (ficha completa de 42h, con porcentajes reales — nunca 0%)', async () => {
    const d = detalle({ cesantias: 474376, porcentajeCesantias: 8.33 });
    const out = await generarExcelManoObra({
      bufferPlantilla,
      fichas: [{ fichaId: 't1', tipo: 'TURNANTE', orden: 0, cargo: 'TURNANTE', horario: 'x', cantidadTrabajadores: 1, horasSemanales: 7, detalleUnitario: d, totalCargo: 474376, turnante: { coberturaHoras: 7, diasEquivalentes: 1, factorNumerador: 1, factorDenominador: 6, costoReferencia42Horas: d.costoLaboralUnitario, cantidadTurnantesFisicos: 1 } }],
    });
    const ws = await cargarHoja(out);
    expect(ws.getCell('C20').value).toEqual({ formula: 'ROUND(B20*C17,0)' });
  });

  it('en fichas TURNANTE con cobertura parcial (HORAS_REALES), el Costo Total (C52) aplica el factor proporcional UNA sola vez, al final — la ficha (C6:C49) muestra la referencia completa sin escalar', async () => {
    const d = detalle();
    const out = await generarExcelManoObra({
      bufferPlantilla,
      fichas: [{ fichaId: 't1', tipo: 'TURNANTE', orden: 0, cargo: 'TURNANTE', horario: 'x', cantidadTrabajadores: 1, horasSemanales: 7, detalleUnitario: d, totalCargo: Math.round((d.costoLaboralUnitario * 1) / 6), turnante: { coberturaHoras: 7, diasEquivalentes: 1, factorNumerador: 1, factorDenominador: 6, costoReferencia42Horas: d.costoLaboralUnitario, cantidadTurnantesFisicos: 1 } }],
    });
    const ws = await cargarHoja(out);
    expect(ws.getCell('C52').value).toEqual({ formula: 'ROUND(C50*C51*1/6,0)' });
  });

  it('Ajuste "que los porcentajes tienen 2 decimales" — la plantilla real mezcla 0.00% y 0.000% según la fila; se normalizan todas a 2 decimales', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    const ws = await cargarHoja(out);
    // B23/B27:B29/B33:B35 traían 0.000% (3 decimales) en la plantilla real.
    for (const addr of ['B20', 'B21', 'B22', 'B23', 'B27', 'B28', 'B29', 'B33', 'B34', 'B35']) {
      expect(ws.getCell(addr).numFmt).toBe('0.00%');
    }
  });

  it('en varias fichas (no solo la primera) los porcentajes se ubican en el bloque desplazado correcto', async () => {
    const out = await generarExcelManoObra({
      bufferPlantilla,
      fichas: [ficha({ fichaId: 'f1', detalleUnitario: detalle({ porcentajePension: 0.12 }) }), ficha({ fichaId: 'f2', detalleUnitario: detalle({ porcentajePension: 0.16 }) })],
    });
    const ws = await cargarHoja(out);
    expect(ws.getCell('B28').value).toBe(0.12); // ficha 1: B(1+27)=B28
    expect(ws.getCell('B83').value).toBe(0.16); // ficha 2 (offset 55): B(56+27)=B83
  });

  it('13) C15 suma C8:C14', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    const ws = await cargarHoja(out);
    expect((ws.getCell('C15').value as ExcelJS.CellFormulaValue).formula).toBe('SUM(C8:C14)');
  });

  it('14) C24 suma prestaciones (C20:C23)', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    const ws = await cargarHoja(out);
    expect((ws.getCell('C24').value as ExcelJS.CellFormulaValue).formula).toBe('SUM(C20:C23)');
  });

  it('15) C30 suma seguridad social (C27:C29)', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    const ws = await cargarHoja(out);
    expect((ws.getCell('C30').value as ExcelJS.CellFormulaValue).formula).toBe('SUM(C27:C29)');
  });

  it('16) C36 suma parafiscales (C33:C35)', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    const ws = await cargarHoja(out);
    expect((ws.getCell('C36').value as ExcelJS.CellFormulaValue).formula).toBe('SUM(C33:C35)');
  });

  it('17) C43 suma otros costos (C38:C42)', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    const ws = await cargarHoja(out);
    expect((ws.getCell('C43').value as ExcelJS.CellFormulaValue).formula).toBe('SUM(C38:C42)');
  });

  it('18) C49 suma bonos no prestacionales (C45:C48)', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    const ws = await cargarHoja(out);
    expect((ws.getCell('C49').value as ExcelJS.CellFormulaValue).formula).toBe('SUM(C45:C48)');
  });

  it('19) C50 suma el costo unitario completo (C17,C24,C30,C36,C43,C49)', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    const ws = await cargarHoja(out);
    expect((ws.getCell('C50').value as ExcelJS.CellFormulaValue).formula).toBe('SUM(C17,C24,C30,C36,C43,C49)');
  });

  it('20) C52 multiplica C50 por C51', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha({ cantidadTrabajadores: 4 })] });
    const ws = await cargarHoja(out);
    expect((ws.getCell('C52').value as ExcelJS.CellFormulaValue).formula).toBe('C50*C51');
    expect(ws.getCell('C51').value).toBe(4);
  });

  it('21) las fórmulas de la segunda ficha apuntan a su propio bloque (nunca a C6:C52 de la primera)', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha({ fichaId: 'f1' }), ficha({ fichaId: 'f2' })] });
    const ws = await cargarHoja(out);
    expect((ws.getCell('C70').value as ExcelJS.CellFormulaValue).formula).toBe('SUM(C63:C69)');
    expect((ws.getCell('C105').value as ExcelJS.CellFormulaValue).formula).toBe('SUM(C72,C79,C85,C91,C98,C104)');
    expect((ws.getCell('C107').value as ExcelJS.CellFormulaValue).formula).toBe('C105*C106');
  });

  it('22) los turnantes se exportan como fichas separadas (tipo TURNANTE)', async () => {
    const turnante = ficha({
      fichaId: 't1', tipo: 'TURNANTE', cargo: 'TURNANTE DE ASEADOR', cantidadTrabajadores: 1,
      turnante: { coberturaHoras: 7, diasEquivalentes: 1, factorNumerador: 1, factorDenominador: 6, costoReferencia42Horas: 2846255, cantidadTurnantesFisicos: 1 },
    });
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha({ fichaId: 'f1' }), turnante] });
    const ws = await cargarHoja(out);
    expect(ws.getCell('A57').value).toBe('TURNANTE DE ASEADOR');
    expect(ws.getCell('C106').value).toBe(1); // cantidadTurnantesFisicos en la celda de "cantidad"
  });

  it('25) la plantilla original en disco no se modifica (el buffer leído no se reescribe)', async () => {
    const antes = await readFile(RUTA_PLANTILLA);
    await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    const despues = await readFile(RUTA_PLANTILLA);
    expect(Buffer.compare(antes, despues)).toBe(0);
  });

  it('26) el archivo resultante puede volver a abrirse con ExcelJS sin errores', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    await expect(cargarHoja(out)).resolves.not.toThrow();
  });

  it('28) el área de impresión incluye todas las fichas generadas', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha({ fichaId: 'f1' }), ficha({ fichaId: 'f2' }), ficha({ fichaId: 'f3' })] });
    const ws = await cargarHoja(out);
    expect(ws.pageSetup.printArea).toBe('A1:M162');
  });

  it('el símbolo de moneda € se corrige a $ en las celdas monetarias clonadas (excepción autorizada)', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha({ fichaId: 'f1' }), ficha({ fichaId: 'f2' })] });
    const ws = await cargarHoja(out);
    expect(ws.getCell('C6').numFmt).toContain('$');
    expect(ws.getCell('C6').numFmt).not.toContain('€');
    expect(ws.getCell('C61').numFmt).toContain('$');
  });

  it('Ajuste "no tienen formato moneda" — el símbolo $ es texto literal (nunca un espaciador "_$"), así que sí se muestra', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    const ws = await cargarHoja(out);
    const numFmt = ws.getCell('C6').numFmt!;
    expect(numFmt).toMatch(/"\$ "/);
    expect(numFmt).not.toMatch(/_\$/);
  });

  it('Ajuste "los valores a la derecha" — las celdas monetarias de COSTO MES quedan alineadas a la derecha', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha({ fichaId: 'f1' }), ficha({ fichaId: 'f2' })] });
    const ws = await cargarHoja(out);
    expect(ws.getCell('C6').style.alignment?.horizontal).toBe('right');
    expect(ws.getCell('C61').style.alignment?.horizontal).toBe('right'); // ficha 2, offset 55
  });

  it('Ajuste "no van centrados esos valore" — las celdas del bloque LIQUIDACIÓN DE HORAS (G:M, filas 6/7/8) quedan centradas; las etiquetas (E) quedan a la izquierda', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    const ws = await cargarHoja(out);
    for (const col of ['G', 'H', 'I', 'J', 'K', 'L', 'M']) {
      for (const fila of [6, 7, 8]) {
        expect(ws.getCell(`${col}${fila}`).style.alignment?.horizontal).toBe('center');
      }
    }
    for (const fila of [6, 7, 8]) {
      expect(ws.getCell(`E${fila}`).style.alignment?.horizontal).toBe('left');
    }
  });

  it('Ajuste "elimina eso... mueve las otras celdas a la izquierda" — la columna F vacía se elimina de verdad: F:M quedan ocupadas con Horas semanales + los 7 conceptos de recargo, sin ninguna columna vacía', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    const ws = await cargarHoja(out);
    expect(ws.getCell('F5').value).toBe('Horas semanales');
    expect(ws.getCell('G5').value).toBe('Rec. noct.');
    expect(ws.getCell('H5').value).toBe('Extra diurna');
    expect(ws.getCell('I5').value).toBe('Extra nocturna');
    expect(ws.getCell('J5').value).toBe('Dom.-Fest.');
    expect(ws.getCell('K5').value).toBe('Extra festiva');
    expect(ws.getCell('L5').value).toBe('Extra fest. noct.');
    expect(ws.getCell('M5').value).toBe('Rec. noct.-fest.');
  });

  it('Ajuste "ajusta bien las celdas que se vea al descargar" — las columnas F:M del bloque de horas tienen ancho suficiente para no truncar el formato monetario', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    const ws = await cargarHoja(out);
    for (const col of ['F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) {
      expect(ws.getColumn(col).width).toBeGreaterThanOrEqual(13);
    }
  });

  it('Ajuste "debe verse asi y con todos los bordes" — el bloque LIQUIDACIÓN DE HORAS (E:M, filas 6-8) tiene borde fino en todas sus celdas', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    const ws = await cargarHoja(out);
    for (const col of ['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) {
      for (const fila of [6, 7, 8]) {
        const border = ws.getCell(`${col}${fila}`).style.border;
        expect(border?.left?.style).toBe('thin');
        expect(border?.right?.style).toBe('thin');
        expect(border?.top?.style).toBe('thin');
        expect(border?.bottom?.style).toBe('thin');
      }
    }
  });

  it('Ajuste "y el 41,44 de donde sale? debe tener formula igual" — G/J/K/L/M de LIQUIDACIÓN DE HORAS descomponen el total mensual como horasDia×diasPromedioMes (fórmula, nunca un valor suelto)', async () => {
    const d = detalle({ horasRecargoNocturno: 10, horasExtraDiurna: 4.5, horasExtraNocturna: 3, horasDominicalesFestivos: 41.44, horasExtraFestiva: 5.92, horasExtraFestivaNocturna: 2, horasRecargoNocturnoFestivo: 1 });
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha({ detalleUnitario: d, horasSemanales: 56 })] });
    const ws = await cargarHoja(out);
    expect(ws.getCell('F6').value).toBe(56);
    expect(ws.getCell('G6').value).toEqual({ formula: '0.415282*24.08' }); // 10/24.08, Rec. noct.
    expect(ws.getCell('H6').value).toBe(4.5);
    expect(ws.getCell('I6').value).toBe(3);
    expect(ws.getCell('J6').value).toEqual({ formula: '7*5.92' }); // 41.44/5.92, Dom.-Fest.
    expect(ws.getCell('K6').value).toEqual({ formula: '1*5.92' }); // 5.92/5.92, Extra festiva
    expect(ws.getCell('L6').value).toEqual({ formula: '0.337838*5.92' }); // 2/5.92, Extra fest. noct.
    expect(ws.getCell('M6').value).toEqual({ formula: '0.168919*5.92' }); // 1/5.92, Rec. noct.-fest.
    for (const col of ['F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) expect(ws.getCell(`${col}6`).numFmt).toBe('#,##0.00');
  });

  it('Ajuste "las horas tienen formula mira" — con metodología SEMANAL_4_33, SOLO Extra diurna/nocturna muestran horas semanales×4,33 (igual que el popup: "6.00 h × 4,33 = 25.98 h")', async () => {
    const d = detalle({
      esMetodologiaSemanal: 1, horasSemanalesExtraDiurna: 6, horasSemanalesExtraNocturna: 4,
    });
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha({ detalleUnitario: d })] });
    const ws = await cargarHoja(out);
    expect(ws.getCell('H6').value).toEqual({ formula: '6*4.33' }); // Extra diurna
    expect(ws.getCell('I6').value).toEqual({ formula: '4*4.33' }); // Extra nocturna
  });

  it('Ajuste "revisa el calculo... no era como la extra diurna" — Extra festiva/Extra fest. noct. NUNCA usan ×4,33, ni siquiera con metodología SEMANAL_4_33 (van por horasDia×5,92, como el popup "Hora extra diurna festiva" que solo muestra el valor mensual directo, sin ×4,33)', async () => {
    const d = detalle({ esMetodologiaSemanal: 1, horasSemanalesExtraDiurna: 6, horasSemanalesExtraNocturna: 4, horasExtraFestiva: 5.92, horasExtraFestivaNocturna: 2 });
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha({ detalleUnitario: d })] });
    const ws = await cargarHoja(out);
    expect(ws.getCell('K6').value).toEqual({ formula: '1*5.92' });
    expect(ws.getCell('L6').value).toEqual({ formula: '0.337838*5.92' });
  });

  it('sin metodología SEMANAL_4_33 (esMetodologiaSemanal=0), Extra diurna/nocturna siguen con el valor mensual directo, igual que antes', async () => {
    const d = detalle({ esMetodologiaSemanal: 0, horasExtraDiurna: 25.98 });
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha({ detalleUnitario: d })] });
    const ws = await cargarHoja(out);
    expect(ws.getCell('H6').value).toBe(25.98);
  });

  it('Ajuste "estos de la izquierda deben venir del resultado de la tabla de la derecha" — el bloque LIQUIDACIÓN DE HORAS tiene 3 filas (Horas/Valor de la hora/Costo mensual); "Valor de la hora" es independiente ((Salario÷210)×factor legal, nunca derivada de columna C) y "Costo mensual" multiplica Horas×Valor de la hora; la columna C referencia ese resultado, nunca al revés', async () => {
    const d = detalle({
      horasExtraDiurna: 25.98, horasDominicalesFestivos: 41.44, horasRecargoNocturno: 0, horasExtraNocturna: 0, horasExtraFestivaNocturna: 0, horasRecargoNocturnoFestivo: 0,
    });
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha({ detalleUnitario: d, horasSemanales: 56 })] });
    const ws = await cargarHoja(out);
    expect(ws.getCell('E6').value).toBe('Horas');
    expect(ws.getCell('E7').value).toBe('Valor de la hora');
    expect(ws.getCell('E8').value).toBe('Costo mensual');
    // "Valor de la hora" — (Salario÷210)×factor legal del concepto, MISMOS
    // factores que ya usa el motor (motor-comercial-30-dias.ts), nunca
    // derivada de columna C.
    expect(ws.getCell('G7').value).toEqual({ formula: '(C6/210)*0.35' }); // Rec. noct.
    expect(ws.getCell('H7').value).toEqual({ formula: '(C6/210)*1.25' }); // Extra diurna
    expect(ws.getCell('J7').value).toEqual({ formula: '(C6/210)*1.9' }); // Dom.-Fest.
    expect(ws.getCell('K7').value).toEqual({ formula: '(C6/210)*2.15' }); // Extra festiva
    // "Costo mensual" — MULTIPLICA Horas×Valor de la hora (visible, auditable).
    expect(ws.getCell('G8').value).toEqual({ formula: 'G6*G7' });
    expect(ws.getCell('H8').value).toEqual({ formula: 'H6*H7' });
    // Columna C (tabla principal) — referencia el "Costo mensual" de la
    // columna correspondiente, la tabla de la derecha es la fuente.
    expect(ws.getCell('C8').value).toEqual({ formula: 'ROUND(G8,0)' }); // Rec. noct.
    expect(ws.getCell('C9').value).toEqual({ formula: 'ROUND(H8,0)' }); // Extra diurna
    expect(ws.getCell('C10').value).toEqual({ formula: 'ROUND(I8,0)' }); // Extra nocturna
    expect(ws.getCell('C11').value).toEqual({ formula: 'ROUND(J8,0)' }); // Dom.-Fest.
    expect(ws.getCell('C12').value).toEqual({ formula: 'ROUND(K8,0)' }); // Extra festiva
    expect(ws.getCell('C13').value).toEqual({ formula: 'ROUND(L8,0)' }); // Extra fest. noct.
    expect(ws.getCell('C14').value).toEqual({ formula: 'ROUND(M8,0)' }); // Rec. noct.-fest.
  });

  it('en varias fichas, el bloque de "Valor de la hora"/"Costo mensual" se ubica en el bloque desplazado correcto (nunca reutiliza celdas de la ficha anterior)', async () => {
    const out = await generarExcelManoObra({
      bufferPlantilla,
      fichas: [ficha({ fichaId: 'f1' }), ficha({ fichaId: 'f2', detalleUnitario: detalle({ horaExtraDiurna: 999 }) })],
    });
    const ws = await cargarHoja(out);
    expect(ws.getCell('I8').value).toEqual({ formula: 'I6*I7' }); // ficha 1
    expect(ws.getCell('I63').value).toEqual({ formula: 'I61*I62' }); // ficha 2 (offset 55)
  });

  it('Ajuste "el excel que descargo me genera este error" — se eliminan los nombres definidos legados que apuntan a libros externos (la plantilla real trae ~540, ExcelJS descarta xl/externalLinks al reescribir y deja referencias colgantes que Excel reporta como "reparación")', async () => {
    const out = await generarExcelManoObra({ bufferPlantilla, fichas: [ficha()] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out as unknown as ExcelJS.Buffer);
    expect(wb.definedNames.model.length).toBe(0);
  });
});

describe('nombreArchivoExportacion', () => {
  it('genera el nombre con el patrón Mano_de_Obra_<numeroProceso>_<fecha>.xlsx', () => {
    const nombre = nombreArchivoExportacion('SED-LP-2026-0091', new Date('2026-08-06T12:00:00Z'));
    expect(nombre).toBe('Mano_de_Obra_SED-LP-2026-0091_2026-08-06.xlsx');
  });
  it('sanitiza caracteres inválidos del número de proceso', () => {
    const nombre = nombreArchivoExportacion('SED/LP 2026 #0091', new Date('2026-08-06T12:00:00Z'));
    expect(nombre).not.toMatch(/[/#\s]/);
  });
});
