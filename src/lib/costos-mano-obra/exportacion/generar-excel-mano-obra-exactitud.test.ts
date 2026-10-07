/**
 * Exactitud de la hoja "Mano de Obra": lo que Excel calcula con sus fórmulas
 * debe ser, al peso, lo que muestra la pantalla. Caso real (RFP No. 002-2026,
 * ASEO Y CAFETERIA): la hoja daba 1.033.359 / 674.904 / 363.179 / 4.188.382
 * mientras la pantalla mostraba 1.033.360 / 674.905 / 363.180 / 4.188.384,
 * porque las fórmulas sumaban valores SIN redondear y la pantalla redondea
 * cada concepto al peso (ahora cada concepto lleva ROUND).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { poblarHojaManoObra } from './generar-excel-mano-obra';
import type { DetalleUnitarioExportDto, FichaManoObraExportDto } from './tipos-exportacion';

const RUTA_PLANTILLA = path.join(process.cwd(), 'data', 'importaciones', 'Mano de obra', 'Mano de obra.xlsx');

/**
 * Evaluador mínimo, SOLO para esta prueba (ExcelJS no calcula fórmulas): traduce
 * a JS lo que escribe el generador — referencias, + - * /, paréntesis,
 * SUM(rango|lista) y ROUND(x,0) con el redondeo de Excel (mitad hacia afuera de cero).
 */
function valor(ws: ExcelJS.Worksheet, direccion: string): number {
  const v = ws.getCell(direccion).value as unknown;
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'formula' in v) return evaluar(ws, String((v as { formula: string }).formula));
  return 0;
}
function evaluar(ws: ExcelJS.Worksheet, formula: string): number {
  const js = formula
    .replace(/\b([A-Z]+\d+):([A-Z]+\d+)\b/g, (_m, a, b) => `rango('${a}','${b}')`)
    .replace(/(?<!')\b([A-Z]+\d+)\b(?!')/g, (_m, a) => `v('${a}')`)
    .replace(/\bSUM\(/g, 'suma(')
    .replace(/\bROUND\(/g, 'redondear(');
  const rango = (a: string, b: string) => {
    const col = a.replace(/\d+/g, '');
    const [f1, f2] = [Number(a.replace(/\D+/g, '')), Number(b.replace(/\D+/g, ''))];
    return Array.from({ length: f2 - f1 + 1 }, (_x, i) => valor(ws, `${col}${f1 + i}`));
  };
  const suma = (...args: (number | number[])[]) => args.flat().reduce((s, n) => s + n, 0);
  const redondear = (x: number, d: number) => { const f = 10 ** d; return (Math.sign(x) * Math.round(Number((Math.abs(x) * f).toPrecision(15)))) / f; };
  return new Function('v', 'rango', 'suma', 'redondear', `return (${js});`)((d: string) => valor(ws, d), rango, suma, redondear) as number;
}

/** Valores de la pantalla del cargo ASEO Y CAFETERIA (captura 2 del usuario). */
function detalleCasoReal(overrides: Partial<DetalleUnitarioExportDto> = {}): DetalleUnitarioExportDto {
  return {
    salarioBasico: 1750905, bonoPrestacional: 0,
    recargoNocturno: 0, horaExtraDiurna: 270765, horaExtraNocturna: 0, dominicalesFestivos: 656473,
    horaExtraFestiva: 106122, horaExtraFestivaNocturna: 0, recargoNocturnoFestivo: 0, totalRecargos: 1033360,
    auxilioTransporte: 249095, subtotalSalarial: 3033360,
    cesantias: 252679, prima: 252679, vacaciones: 139213, interesesCesantias: 30334, totalPrestaciones: 674905,
    salud: 0, pension: 334112, arl: 29068, totalSeguridadSocial: 363180,
    cajaCompensacion: 116939, sena: 0, icbf: 0, totalParafiscales: 116939,
    dotacion: 0, epp: 0, examenes: 0, cursos: 0, vacunas: 0, totalOtrosCostos: 0,
    bonosNoPrestacionales: 0, costoLaboralUnitario: 4188384,
    porcentajeCesantias: 0.0833, porcentajePrima: 0.0833, porcentajeVacaciones: 0.05, porcentajeInteresesCesantias: 0.01,
    porcentajeSalud: 0, porcentajePension: 0.12, porcentajeArl: 0.01044,
    porcentajeCaja: 0.04, porcentajeSena: 0, porcentajeIcbf: 0,
    // Extra diurna: 6 h semanales × 4,33; Dom.-Fest.: 7 días × 5,92; Extra festiva: 1 día × 5,92.
    horasRecargoNocturno: 0, horasExtraDiurna: 25.98, horasExtraNocturna: 0,
    horasDominicalesFestivos: 41.44, horasExtraFestiva: 5.92, horasExtraFestivaNocturna: 0, horasRecargoNocturnoFestivo: 0,
    esMetodologiaSemanal: 1, horasSemanalesExtraDiurna: 6, horasSemanalesExtraNocturna: 0,
    ...overrides,
  };
}

const fichaCasoReal = (): FichaManoObraExportDto => ({
  fichaId: 'cargo-1', tipo: 'CARGO', orden: 0,
  cargo: 'ASEO Y CAFETERIA', horario: 'Lunes a Domingo · 06:00-14:00 + Incluye festivos',
  cantidadTrabajadores: 1, horasSemanales: 56,
  detalleUnitario: detalleCasoReal(), totalCargo: 4188384,
});

/** Turnante proporcional de 7 horas semanales (factor 1/6), costo laboral de 42 h = 2.742.671 → 457.112 (captura 3). */
const fichaTurnante = (): FichaManoObraExportDto => ({
  fichaId: 'turnante-1', tipo: 'TURNANTE', orden: 1,
  cargo: 'TURNANTE DE ASEO Y CAFETERIA', horario: 'Lunes a Domingo · 06:00-14:00 + Incluye festivos',
  cantidadTrabajadores: 1, horasSemanales: 7,
  detalleUnitario: detalleCasoReal({
    recargoNocturno: 0, horaExtraDiurna: 0, dominicalesFestivos: 0, horaExtraFestiva: 0, totalRecargos: 0,
    subtotalSalarial: 2000000,
    cesantias: 166600, prima: 166600, vacaciones: 87545, interesesCesantias: 20000, totalPrestaciones: 440745,
    pension: 210109, arl: 18279, totalSeguridadSocial: 228388,
    cajaCompensacion: 73538, totalParafiscales: 73538,
    costoLaboralUnitario: 2742671,
    horasExtraDiurna: 0, horasDominicalesFestivos: 0, horasExtraFestiva: 0, esMetodologiaSemanal: 0, horasSemanalesExtraDiurna: 0,
  }),
  totalCargo: 2742671 / 6,
  turnante: { coberturaHoras: 7, diasEquivalentes: 1, factorNumerador: 1, factorDenominador: 6, costoReferencia42Horas: 2742671, cantidadTurnantesFisicos: 1 },
});

describe('Mano de Obra — el Excel calcula exactamente lo que muestra la pantalla', () => {
  let bufferPlantilla: Buffer;
  beforeAll(async () => { bufferPlantilla = await readFile(RUTA_PLANTILLA); });

  async function generar(fichas: FichaManoObraExportDto[]) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bufferPlantilla as unknown as ExcelJS.Buffer);
    poblarHojaManoObra(wb, fichas);
    return wb.getWorksheet('Mano de Obra')!;
  }

  it('causa del desfase: sin redondear, las horas × tarifa suman 1.033.359,2 (no 1.033.360)', async () => {
    const ws = await generar([fichaCasoReal()]);
    // H8/J8/K8 = "Costo mensual" sin redondear de Extra diurna, Dom.-Fest. y Extra festiva (fila r+7 con r=1).
    const sinRedondear = valor(ws, 'H8') + valor(ws, 'J8') + valor(ws, 'K8');
    expect(sinRedondear).toBeGreaterThan(1033358.5);
    expect(sinRedondear).toBeLessThan(1033359.5);
  });

  it('cargo: cada concepto y cada total de la hoja da el valor de la pantalla', async () => {
    const ws = await generar([fichaCasoReal()]);
    expect([valor(ws, 'C9'), valor(ws, 'C11'), valor(ws, 'C12')]).toEqual([270765, 656473, 106122]);
    expect(valor(ws, 'C15')).toBe(1033360);   // Recargos y horas extras por trabajador
    expect(valor(ws, 'C17')).toBe(3033360);   // Subtotal salarial por trabajador
    expect([valor(ws, 'C20'), valor(ws, 'C21'), valor(ws, 'C22'), valor(ws, 'C23')]).toEqual([252679, 252679, 139213, 30334]);
    expect(valor(ws, 'C24')).toBe(674905);    // Total prestaciones
    expect([valor(ws, 'C28'), valor(ws, 'C29')]).toEqual([334112, 29068]);
    expect(valor(ws, 'C30')).toBe(363180);    // Total seguridad social
    expect(valor(ws, 'C33')).toBe(116939);
    expect(valor(ws, 'C36')).toBe(116939);    // Total aportes parafiscales
    expect(valor(ws, 'C50')).toBe(4188384);   // Costo laboral mensual por trabajador
    expect(valor(ws, 'C52')).toBe(4188384);   // Costo mensual total del cargo
  });

  it('turnante proporcional (1/6): el total del cargo da 457.112 como la pantalla, no 457.111,83', async () => {
    const ws = await generar([fichaTurnante()]);
    expect(valor(ws, 'C50')).toBe(2742671);
    expect(valor(ws, 'C52')).toBe(457112);
  });

  it('cargo + turnante: la segunda ficha (bloque desplazado 55 filas) cuadra y la suma es la Mano de Obra del panel (4.645.496)', async () => {
    const ws = await generar([fichaCasoReal(), fichaTurnante()]);
    expect(valor(ws, 'C52')).toBe(4188384);
    expect(valor(ws, 'C107')).toBe(457112);
    expect(valor(ws, 'C52') + valor(ws, 'C107')).toBe(4645496);
  });
});
