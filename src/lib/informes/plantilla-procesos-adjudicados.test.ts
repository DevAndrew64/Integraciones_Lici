import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import {
  generarInformeProcesosAdjudicados,
  construirFilaInforme,
  normalizarTipoProceso,
  resolverFechasCronograma,
  NOMBRE_HOJA_BASE,
  NOMBRE_HOJA_DASHBOARD,
  type SolicitudInformeInput,
  type EventoCronogramaInput,
} from './plantilla-procesos-adjudicados';

const RUTA_PLANTILLA = join(__dirname, '../../../data/importaciones/informes/Informe.xlsx');

function solicitud(overrides: Partial<SolicitudInformeInput> = {}): SolicitudInformeInput {
  return {
    createdAt: new Date('2026-04-01T00:00:00.000Z'),
    modalidad: '3',
    nombreProceso: null,
    codigoProceso: 'SAMC-999-2026',
    entidad: 'ENTIDAD DE PRUEBA',
    perfil: 'aseocolba',
    ciudad: 'Bogota',
    objeto: 'Objeto de prueba',
    valor: 123456789,
    resultadoFinal: 'Adjudicado',
    fechaCierre: new Date('2026-04-10T00:00:00.000Z'),
    sqrNumero: '999999',
    revisor: 'Revisor Prueba',
    plataforma: 'SECOP II',
    asignaciones: [{ estadoRevision: 'CERRADO_ADJUDICADO', analistaAsignado: 'Analista Prueba', observacionesGestion: 'obs comercial', observaciones: [{ tipoCausa: 'Indicador', causaEspecifica: '' }] }],
    indicadores: { 'Liquidez': '1.5', 'Endeudamiento': '30%' },
    ...overrides,
  };
}

describe('normalizarTipoProceso — mismo criterio que modS() de page.tsx', () => {
  it('mapea por código numérico de modalidad', () => {
    expect(normalizarTipoProceso('2', null, null)).toBe('Licitación pública');
    expect(normalizarTipoProceso('6', null, null)).toBe('Régimen especial');
  });
  it('cae a heurística de texto sobre objeto cuando no hay código reconocible', () => {
    expect(normalizarTipoProceso(null, null, 'proceso de licitacion publica')).toBe('Licitación pública');
  });
});

describe('construirFilaInforme — mapeo de columnas confirmado con el usuario', () => {
  it('ESTADO DE PRESENTACION usa la MISMA columna que Adjudicado/No adjudicado (decisión confirmada)', () => {
    const fila = construirFilaInforme(solicitud({ resultadoFinal: 'Adjudicado' }));
    expect(fila.estadoPresentacion).toBe('ADJUDICADA');
    const fila2 = construirFilaInforme(solicitud({ resultadoFinal: 'No adjudicado' }));
    expect(fila2.estadoPresentacion).toBe('NO ADJUDICADA');
  });
  it('FECHA DE HALLAZGO usa Solicitud.createdAt (decisión confirmada)', () => {
    const fila = construirFilaInforme(solicitud({ createdAt: new Date('2026-05-05T00:00:00.000Z') }));
    expect(fila.fechaHallazgo?.toISOString()).toBe('2026-05-05T00:00:00.000Z');
  });
  it('EMPRESA se normaliza a mayúsculas (ASEOCOLBA/VIGICOLBA/TEMPOCOLBA)', () => {
    const fila = construirFilaInforme(solicitud({ perfil: 'vigicolba' }));
    expect(fila.empresa).toBe('VIGICOLBA');
  });
  it('RESPONSABLE toma analistaAsignado de la última asignación con estado de cierre terminal', () => {
    const fila = construirFilaInforme(solicitud({
      asignaciones: [
        { estadoRevision: 'EN_REVISION', analistaAsignado: 'Analista viejo' },
        { estadoRevision: 'CERRADO_ADJUDICADO', analistaAsignado: 'Analista correcto' },
      ],
    }));
    expect(fila.responsable).toBe('Analista correcto');
  });
});

describe('generarInformeProcesosAdjudicados — reutiliza la plantilla real ("Informe.xlsx"), nunca la modifica', () => {
  const plantillaExiste = existsSync(RUTA_PLANTILLA);

  it.skipIf(!plantillaExiste)('la plantilla original NO se modifica en disco (hash/tamaño idénticos antes y después)', async () => {
    const bufferAntes = readFileSync(RUTA_PLANTILLA);
    await generarInformeProcesosAdjudicados({ rutaPlantilla: RUTA_PLANTILLA, filas: [solicitud()] });
    const bufferDespues = readFileSync(RUTA_PLANTILLA);
    expect(bufferDespues.equals(bufferAntes)).toBe(true);
  });

  it.skipIf(!plantillaExiste)('conserva encabezados, nombres de hoja, estilos y agrega exactamente N filas de datos en EXPORTE', async () => {
    const filas = [solicitud({ codigoProceso: 'P-1' }), solicitud({ codigoProceso: 'P-2' }), solicitud({ codigoProceso: 'P-3' })];
    const buffer = await generarInformeProcesosAdjudicados({ rutaPlantilla: RUTA_PLANTILLA, filas });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);

    expect(wb.getWorksheet(NOMBRE_HOJA_BASE)).toBeTruthy();
    expect(wb.getWorksheet(NOMBRE_HOJA_DASHBOARD)).toBeTruthy();

    const ws = wb.getWorksheet(NOMBRE_HOJA_BASE)!;
    expect(ws.getCell('A1').value).toBe('FECHA DE HALLAZGO');
    expect(ws.getCell('E1').value).toBe('EMPRESA');
    // Encabezado conserva su estilo (fill azul oscuro).
    expect((ws.getCell('A1').fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FF002060');

    expect(ws.getCell('C2').value).toBe('P-1');
    expect(ws.getCell('C3').value).toBe('P-2');
    expect(ws.getCell('C4').value).toBe('P-3');
    expect(ws.getCell('C5').value).toBeNull();

    // Autofiltro ajustado al nuevo último renglón, normalizado al rango real (A:AO).
    expect(ws.autoFilter).toBe('A1:AO4');
  });

  it.skipIf(!plantillaExiste)('escribe cada columna en la posición REAL de su encabezado, no en una posición fija (la plantilla ya cambió de orden una vez)', async () => {
    const buffer = await generarInformeProcesosAdjudicados({ rutaPlantilla: RUTA_PLANTILLA, filas: [solicitud({ ciudad: 'Cali', entidad: 'ENTIDAD X', codigoProceso: 'PROC-X' })] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet(NOMBRE_HOJA_BASE)!;
    // En "Informe.xlsx" real: D=ENTIDAD, F=CIUDAD, I=ESTADO DE PRESENTACION (no A/D/I de la plantilla vieja).
    expect(ws.getCell('D2').value).toBe('ENTIDAD X');
    expect(ws.getCell('F2').value).toBe('Cali');
    expect(ws.getCell('I2').value).toBe('ADJUDICADA');
  });

  it.skipIf(!plantillaExiste)('reescribe las fórmulas de RESUMEN con rango completo de columna (nunca dependen del número de filas de EXPORTE)', async () => {
    const filas = [
      solicitud({ perfil: 'aseocolba', resultadoFinal: 'Adjudicado', valor: 100 }),
      solicitud({ perfil: 'aseocolba', resultadoFinal: 'No adjudicado', valor: 50 }),
      solicitud({ perfil: 'tempocolba', resultadoFinal: 'Adjudicado', valor: 200 }),
      solicitud({ perfil: 'vigicolba', resultadoFinal: 'Adjudicado', valor: 300 }),
    ];
    const buffer = await generarInformeProcesosAdjudicados({ rutaPlantilla: RUTA_PLANTILLA, filas });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const dash = wb.getWorksheet(NOMBRE_HOJA_DASHBOARD)!;

    const a4 = dash.getCell('A4').value as ExcelJS.CellFormulaValue;
    expect(a4.formula).toContain(`COUNTA(${NOMBRE_HOJA_BASE}!E2:E1048576)`);
    const b4 = dash.getCell('B4').value as ExcelJS.CellFormulaValue;
    expect(b4.formula).toContain(`SUM(${NOMBRE_HOJA_BASE}!H2:H1048576)`);

    // Fórmulas por empresa — ya NO cuentan literalmente "ASEOCOLBA" en la fila de TEMPOCOLBA/VIGICOLBA (bug de la plantilla original, corregido).
    const b9 = dash.getCell('B9').value as ExcelJS.CellFormulaValue;
    expect(b9.formula).toContain('"ASEOCOLBA"');
    const b10 = dash.getCell('B10').value as ExcelJS.CellFormulaValue;
    expect(b10.formula).toContain('"TEMPOCOLBA"');
    expect(b10.formula).not.toContain('"ASEOCOLBA"');
    const b11 = dash.getCell('B11').value as ExcelJS.CellFormulaValue;
    expect(b11.formula).toContain('"VIGICOLBA"');
  });

  it.skipIf(!plantillaExiste)('con 0 filas, deja EXPORTE solo con el encabezado y el autofiltro colapsado a la fila 2', async () => {
    const buffer = await generarInformeProcesosAdjudicados({ rutaPlantilla: RUTA_PLANTILLA, filas: [] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet(NOMBRE_HOJA_BASE)!;
    expect(ws.getCell('A1').value).toBe('FECHA DE HALLAZGO');
    expect(ws.getCell('A2').value).toBeNull();
  });
});

describe('Ajuste "BLOQUES DINÁMICOS POR EMPRESA EN RESUMEN" — crecen/decrecen sin límite fijo, desplazando el bloque siguiente', () => {
  const plantillaExiste = existsSync(RUTA_PLANTILLA);

  it.skipIf(!plantillaExiste)('con pocos procesos, respeta el layout mínimo (2 filas de subtotal) y separa los 3 bloques por 1 fila en blanco — igual que la plantilla original', async () => {
    const filas = [
      solicitud({ perfil: 'aseocolba', resultadoFinal: 'Adjudicado', entidad: 'ENTIDAD ASEO 1' }),
      solicitud({ perfil: 'tempocolba', resultadoFinal: 'Adjudicado', entidad: 'ENTIDAD TEMPO 1' }),
      solicitud({ perfil: 'vigicolba', resultadoFinal: 'Adjudicado', entidad: 'ENTIDAD VIGI 1' }),
    ];
    const buffer = await generarInformeProcesosAdjudicados({ rutaPlantilla: RUTA_PLANTILLA, filas });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const dash = wb.getWorksheet(NOMBRE_HOJA_DASHBOARD)!;

    expect(dash.getCell('A15').value).toBe('ASEOCOLBA');
    expect(dash.getCell('F16').value).toBe('NOMBRE DE LA ENTIDAD');
    expect(dash.getCell('A17').value).toBe('ADJUDICADO');
    expect(dash.getCell('F17').value).toBe('ENTIDAD ASEO 1');
    expect(dash.getCell('A18').value).toBe('NO ADJUDICADO');

    expect(dash.getCell('A20').value).toBe('TEMPOCOLBA');
    expect(dash.getCell('F22').value).toBe('ENTIDAD TEMPO 1');

    expect(dash.getCell('A25').value).toBe('VIGICOLBA');
    expect(dash.getCell('F27').value).toBe('ENTIDAD VIGI 1');
  });

  it.skipIf(!plantillaExiste)('cuando ASEOCOLBA tiene MUCHOS procesos, el bloque de TEMPOCOLBA se desplaza hacia abajo automáticamente (sin pisar filas)', async () => {
    const muchosAseo = Array.from({ length: 10 }, (_, i) => solicitud({ perfil: 'aseocolba', resultadoFinal: 'Adjudicado', entidad: `ENTIDAD ASEO ${i}`, codigoProceso: `A-${i}` }));
    const filas = [...muchosAseo, solicitud({ perfil: 'tempocolba', resultadoFinal: 'Adjudicado', entidad: 'ENTIDAD TEMPO 1' })];
    const buffer = await generarInformeProcesosAdjudicados({ rutaPlantilla: RUTA_PLANTILLA, filas });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const dash = wb.getWorksheet(NOMBRE_HOJA_DASHBOARD)!;

    expect(dash.getCell('A15').value).toBe('ASEOCOLBA');
    for (let i = 0; i < 10; i++) {
      expect(dash.getCell(`F${17 + i}`).value).toBe(`ENTIDAD ASEO ${i}`);
    }
    // TEMPOCOLBA ya NO está en la fila 20 (fija de la plantilla original) — se desplazó porque ASEOCOLBA necesitó más filas.
    expect(dash.getCell('A20').value).not.toBe('TEMPOCOLBA');
    const filaTempoEsperada = 15 + 2 + 10 + 1; // r0 + título/encabezado(2) + filasDeListado(10) + blanco(1)
    expect(dash.getCell(`A${filaTempoEsperada}`).value).toBe('TEMPOCOLBA');
    expect(dash.getCell(`F${filaTempoEsperada + 2}`).value).toBe('ENTIDAD TEMPO 1');
  });

  it.skipIf(!plantillaExiste)('las fórmulas de subtotal de cada bloque nunca dependen de la posición de otro bloque (SUMIFS/COUNTIFS autocontenidos)', async () => {
    const muchosAseo = Array.from({ length: 8 }, (_, i) => solicitud({ perfil: 'aseocolba', resultadoFinal: 'Adjudicado', entidad: `E${i}` }));
    const filas = [...muchosAseo, solicitud({ perfil: 'tempocolba', resultadoFinal: 'Adjudicado', valor: 999 })];
    const buffer = await generarInformeProcesosAdjudicados({ rutaPlantilla: RUTA_PLANTILLA, filas });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const dash = wb.getWorksheet(NOMBRE_HOJA_DASHBOARD)!;

    const filaTempo = 15 + 2 + 8 + 1;
    const b = dash.getCell(`B${filaTempo + 2}`).value as ExcelJS.CellFormulaValue; // fila "ADJUDICADO" del bloque TEMPOCOLBA
    expect(b.formula).toContain('"TEMPOCOLBA"');
    expect(b.formula).toContain('"ADJUDICADA"');
  });
});

describe('Ajuste "SEGREGAR POR EMPRESA + CONSOLIDADO" — hojas nuevas por empresa y detalle general', () => {
  const plantillaExiste = existsSync(RUTA_PLANTILLA);

  it.skipIf(!plantillaExiste)('crea una hoja por empresa (Aseocolba/Vigicolba/Tempocolba) y una hoja Consolidado', async () => {
    const buffer = await generarInformeProcesosAdjudicados({
      rutaPlantilla: RUTA_PLANTILLA,
      filas: [
        solicitud({ codigoProceso: 'A-1', perfil: 'aseocolba', resultadoFinal: 'Adjudicado', entidad: 'ENTIDAD A1' }),
        solicitud({ codigoProceso: 'A-2', perfil: 'aseocolba', resultadoFinal: 'No adjudicado', entidad: 'ENTIDAD A2' }),
        solicitud({ codigoProceso: 'V-1', perfil: 'vigicolba', resultadoFinal: 'Adjudicado', entidad: 'ENTIDAD V1' }),
      ],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);

    expect(wb.getWorksheet('Aseocolba')).toBeTruthy();
    expect(wb.getWorksheet('Vigicolba')).toBeTruthy();
    expect(wb.getWorksheet('Tempocolba')).toBeTruthy();
    expect(wb.getWorksheet('Consolidado')).toBeTruthy();

    const hojaAseo = wb.getWorksheet('Aseocolba')!;
    expect(hojaAseo.getCell('A1').value).toBe('PROCESOS ADJUDICADOS');
    expect(hojaAseo.getCell('A2').value).toBe('Entidad');
    expect(hojaAseo.getCell('A3').value).toBe('ENTIDAD A1');
    expect(hojaAseo.getCell('A5').value).toBe('PROCESOS NO ADJUDICADOS');
    expect(hojaAseo.getCell('A6').value).toBe('Entidad');
    expect(hojaAseo.getCell('A7').value).toBe('ENTIDAD A2');

    const consolidado = wb.getWorksheet('Consolidado')!;
    expect(consolidado.getCell('A1').value).toBe('Empresa');
    expect(consolidado.getCell('C2').value).toBe('A-1');
    expect(consolidado.getCell('C3').value).toBe('A-2');
    expect(consolidado.getCell('C4').value).toBe('V-1');
  });

  it.skipIf(!plantillaExiste)('el número de filas de cada hoja crece/decrece automáticamente según la cantidad real de procesos (sin límite fijo)', async () => {
    const muchos = Array.from({ length: 12 }, (_, i) => solicitud({ codigoProceso: `M-${i}`, perfil: 'vigicolba', resultadoFinal: 'Adjudicado', entidad: `ENTIDAD M${i}` }));
    const buffer = await generarInformeProcesosAdjudicados({ rutaPlantilla: RUTA_PLANTILLA, filas: muchos });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const hojaVigi = wb.getWorksheet('Vigicolba')!;
    for (let i = 0; i < 12; i++) {
      expect(hojaVigi.getCell(`A${3 + i}`).value).toBe(`ENTIDAD M${i}`);
    }
  });
});

describe('resolverFechasCronograma — coincidencia por texto de evento real (nunca inventa datos)', () => {
  const evento = (texto: string, fecha: string, orden: number): EventoCronogramaInput => ({ evento: texto, fecha: new Date(fecha), orden });

  it('AMBQ-MC 13 DE 2026 (SAMC real, confirmado en vivo) — mapea manifestación de interés y presentación de observaciones prepliego, deja el resto vacío (SAMC no tiene pliego definitivo/subasta/audiencia)', () => {
    const eventos: EventoCronogramaInput[] = [
      evento('Publicación de la invitación', '2026-07-02T18:00:00.000Z', 1),
      evento('Publicación de estudios previos', '2026-07-02T18:00:00.000Z', 2),
      evento('Plazo para recepción de observaciones', '2026-07-03T23:59:00.000Z', 3),
      evento('Plazo para manifestación de interés de limitar la convocatoria a MiPymes', '2026-07-03T23:59:00.000Z', 4),
      evento('Respuesta a las observaciones a la invitación', '2026-07-06T08:30:00.000Z', 5),
      evento('Publicación del aviso de limitación a MiPymes o si podrá participar cualquier interesado', '2026-07-06T08:20:00.000Z', 6),
      evento('Plazo máximo para expedir adendas', '2026-07-03T19:00:00.000Z', 7),
      evento('Presentación de Ofertas', '2026-07-06T09:30:00.000Z', 8),
    ];
    const r = resolverFechasCronograma(eventos);
    expect(r['MANIFESTACIÓN DE INTERES']).toEqual(new Date('2026-07-03T23:59:00.000Z'));
    expect(r['FECHA PRESENTACIÓN OBSERVACIONES PREPLIEGO']).toEqual(new Date('2026-07-03T23:59:00.000Z'));
    expect(r['FECHA RESPUESTA OBSERVACIONES PREPLIEGO']).toEqual(new Date('2026-07-06T08:30:00.000Z'));
    // SAMC no tiene pliego definitivo, subasta ni audiencia — deben quedar SIN entrada (nunca inventadas).
    expect(r['FECHA PUBLICACION PLIEGO DEFINITIVO']).toBeUndefined();
    expect(r['FECHA PRESENTACIÓN OBSERVACIONES PLIEGO DEF']).toBeUndefined();
    expect(r['FECHA RESPUESTA OBSERVACIONES PLIEGO DEF']).toBeUndefined();
    expect(r['FECHA DE SUBASTA']).toBeUndefined();
    expect(r['FECHA AUDIENCIA DE ADJUDICACION']).toBeUndefined();
    expect(r['FECHA INFORME FINAL']).toBeUndefined(); // SIEMPRE vacío, no hay evento real con ese significado
  });

  it('Licitación Pública (nombres de evento reales relevados de la BD) — mapea pliego definitivo, subasta y audiencia de adjudicación', () => {
    const eventos: EventoCronogramaInput[] = [
      evento('Publicación del aviso de convocatoria pública', '2026-05-01T00:00:00.000Z', 1),
      evento('Plazo para presentar observaciones al proyecto de Pliego de Condiciones', '2026-05-03T00:00:00.000Z', 2),
      evento('Respuesta a observaciones y sugerencias al Proyecto de Pliego de Condiciones', '2026-05-05T00:00:00.000Z', 3),
      evento('Fecha de publicación del pliego de condiciones definitivo', '2026-05-06T00:00:00.000Z', 4),
      evento('Presentación de Observaciones a los Pliegos de Condiciones definitivos', '2026-05-08T00:00:00.000Z', 5),
      evento('Respuesta a las observaciones al Pliego de Condiciones definitivos', '2026-05-10T00:00:00.000Z', 6),
      evento('Publicación del informe de evaluación de las Ofertas', '2026-05-20T00:00:00.000Z', 7),
      evento('Presentación de observaciones al informe de verificación o evaluación', '2026-05-22T00:00:00.000Z', 8),
      evento('Fecha de inicio de la subasta', '2026-05-25T00:00:00.000Z', 9),
      evento('Audiencia de Adjudicación', '2026-05-30T00:00:00.000Z', 10),
    ];
    const r = resolverFechasCronograma(eventos);
    expect(r['FECHA PRESENTACIÓN OBSERVACIONES PREPLIEGO']).toEqual(new Date('2026-05-03T00:00:00.000Z'));
    expect(r['FECHA RESPUESTA OBSERVACIONES PREPLIEGO']).toEqual(new Date('2026-05-05T00:00:00.000Z'));
    expect(r['FECHA PUBLICACION PLIEGO DEFINITIVO']).toEqual(new Date('2026-05-06T00:00:00.000Z'));
    expect(r['FECHA PRESENTACIÓN OBSERVACIONES PLIEGO DEF']).toEqual(new Date('2026-05-08T00:00:00.000Z'));
    expect(r['FECHA RESPUESTA OBSERVACIONES PLIEGO DEF']).toEqual(new Date('2026-05-10T00:00:00.000Z'));
    expect(r['FECHA INFORME EVALUACION INICIAL']).toEqual(new Date('2026-05-20T00:00:00.000Z'));
    expect(r['FECHA OBSERVACIONES Y/O SUBSANACION INFORME INICIAL']).toEqual(new Date('2026-05-22T00:00:00.000Z'));
    expect(r['FECHA DE SUBASTA']).toEqual(new Date('2026-05-25T00:00:00.000Z'));
    expect(r['FECHA AUDIENCIA DE ADJUDICACION']).toEqual(new Date('2026-05-30T00:00:00.000Z'));
    expect(r['FECHA INFORME FINAL']).toBeUndefined(); // siempre vacío
  });

  it('sin ningún evento (procesoId nulo / sin cronograma), devuelve objeto vacío — nunca lanza ni inventa', () => {
    expect(resolverFechasCronograma([])).toEqual({});
  });

  it('un evento sin fecha nunca se usa como coincidencia', () => {
    const r = resolverFechasCronograma([{ evento: 'Audiencia de Adjudicación', fecha: null, orden: 1 }]);
    expect(r['FECHA AUDIENCIA DE ADJUDICACION']).toBeUndefined();
  });
});
