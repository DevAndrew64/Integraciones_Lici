// src/lib/costos-mano-obra/exportacion/generar-excel-mano-obra.ts
// Ajuste "IMPLEMENTAR EXPORTACIÓN DE MANO DE OBRA USANDO EXACTAMENTE LA
// PLANTILLA 'Mano de obra.xlsx'" — clona el bloque modelo A1:M52 de la
// plantilla real (una hoja "Mano de Obra") tantas veces como fichas
// existan, dejando 3 filas vacías entre cada una (55 filas de separación
// total), y alimenta únicamente las celdas de datos. Nunca recalcula la
// liquidación laboral — recibe los conceptos ya resueltos en el DTO
// (ver tipos-exportacion.ts) y solo coloca fórmulas de reconciliación
// (sumas y el total×cantidad final), igual que la plantilla original.
import ExcelJS from 'exceljs';
import type { FichaManoObraExportDto } from './tipos-exportacion';
import { sanearTextoExcel } from './validar-dto-exportacion';

const NOMBRE_HOJA = 'Mano de Obra';
const FILAS_POR_FICHA = 52;
const FILAS_SEPARACION = 3;
const DESPLAZAMIENTO_FICHA = FILAS_POR_FICHA + FILAS_SEPARACION; // 55
const COLUMNAS = 13; // A..M

function inicioFicha(indiceFicha: number): number {
  return 1 + indiceFicha * DESPLAZAMIENTO_FICHA;
}

/** Desplaza una referencia de rango tipo "A1:C1" `offset` filas hacia
 * abajo, conservando las columnas — usado para reubicar las 34
 * combinaciones de celdas del bloque modelo en cada ficha clonada. */
function desplazarRango(rango: string, offset: number): string {
  if (offset === 0) return rango;
  const partes = rango.split(':');
  const desplazarCelda = (celda: string) => {
    const m = celda.match(/^([A-Z]+)(\d+)$/);
    if (!m) return celda;
    return `${m[1]}${Number(m[2]) + offset}`;
  };
  return partes.map(desplazarCelda).join(':');
}

/** Formato contable real de la plantilla — SIEMPRE la misma cadena en
 * todas las celdas monetarias del bloque modelo (confirmado leyendo
 * "Mano de obra.xlsx" con ExcelJS). El símbolo € viaja como `_€` — en la
 * sintaxis de formato de Excel, `_<carácter>` es un ESPACIADOR invisible
 * (deja un hueco del ancho de ese carácter, nunca lo imprime), nunca texto
 * literal. Por eso el símbolo nunca se veía, ni antes (€) ni después de
 * la corrección puntual €→$ de un ajuste previo (seguía siendo un
 * espaciador, solo que de otro carácter). */
const FORMATO_CONTABLE_PLANTILLA = '_-* #,##0 _€_-;-* #,##0 _€_-;_-* "-"?? _€_-;_-@_-';
/** Corrección "no tienen formato moneda" — mismo agrupamiento de miles y
 * mismo "-" para cero que ya traía la plantilla, pero con "$ " como texto
 * literal (nunca como espaciador) para que el símbolo SÍ se muestre.
 * Excepción puntual sobre el numFmt, autorizada explícitamente por el
 * usuario — nunca toca fuente, bordes, relleno, alineación ni ninguna
 * otra propiedad de estilo. Se aplica sobre el workbook EN MEMORIA; la
 * plantilla maestra en disco nunca se reescribe. */
const FORMATO_MONETARIO_VISIBLE = '"$ "#,##0;-"$ "#,##0;"$ "-;@';

function corregirSimboloMoneda(numFmt: string | undefined): string | undefined {
  if (numFmt === FORMATO_CONTABLE_PLANTILLA) return FORMATO_MONETARIO_VISIBLE;
  return numFmt;
}

/** Corrección "que los porcentajes tienen 2 decimales" — la plantilla real
 * trae, ella misma, dos formatos de porcentaje distintos según la fila
 * (confirmado leyendo "Mano de obra.xlsx" con ExcelJS): Cesantías/Prima/
 * Vacaciones usan `0.00%` (2 decimales) pero Intereses de cesantías,
 * Salud/Pensión/ARL y Caja/SENA/ICBF usan `0.000%` (3 decimales) — se
 * normaliza a 2 decimales en todas, nunca se toca el resto del formato
 * (signo %, separador decimal). */
function corregirDecimalesPorcentaje(numFmt: string | undefined): string | undefined {
  if (numFmt === '0.000%') return '0.00%';
  return numFmt;
}

function obtenerMergesDelBloqueModelo(ws: ExcelJS.Worksheet): string[] {
  const merges = (ws.model.merges ?? []) as string[];
  return merges.filter(rango => {
    const filas = rango.split(':').map(c => Number(c.match(/\d+/)?.[0]));
    return filas.every(f => f !== undefined && f >= 1 && f <= FILAS_POR_FICHA);
  });
}

/** Aplica la corrección de moneda al bloque modelo (filas 1..52) ANTES de
 * clonar, para que cada clon herede el formato ya corregido — nunca se
 * corrige dos veces ni se toca ninguna otra propiedad del estilo. */
function corregirMonedaBloqueModelo(ws: ExcelJS.Worksheet) {
  for (let r = 1; r <= FILAS_POR_FICHA; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= COLUMNAS; c++) {
      const cell = row.getCell(c);
      const corregido = corregirSimboloMoneda(cell.numFmt);
      // Clonar el estilo antes de tocar numFmt — ver nota en
      // `escribirNumeroConFormato`: varias celdas pueden compartir el
      // mismo objeto de estilo subyacente en ExcelJS; mutarlo in-place
      // filtraría el cambio a celdas que no debían tocarse.
      // Corrección "los valores a la derecha" — mismas celdas monetarias
      // que ya se tocan aquí (columna COSTO MES), se alinean a la
      // derecha (convención estándar para valores numéricos); nunca se
      // toca la alineación de ninguna otra celda de la plantilla.
      if (corregido !== cell.numFmt) cell.style = { ...cell.style, numFmt: corregido!, alignment: { ...cell.style.alignment, horizontal: 'right' } };
      const corregidoPorcentaje = corregirDecimalesPorcentaje(cell.numFmt);
      if (corregidoPorcentaje !== cell.numFmt) cell.style = { ...cell.style, numFmt: corregidoPorcentaje! };
    }
  }
}

const NAVY = { argb: 'FF002060' };
const BLANCO = { argb: 'FFFFFFFF' };

/** Ajuste "ajusta la plantilla y coloca asi" — reestructura el bloque
 * "LIQUIDACIÓN DE HORAS" (E:M, filas 5-8 del bloque modelo) para que,
 * además de la fila de horas ya existente, muestre la fila "Valor de la
 * hora" (horas→$/hora, derivado del propio "Costo mensual" que sigue) y
 * "Costo mensual" (el mismo $ que ya vive en la columna C, referenciado
 * con fórmula — NUNCA un cálculo paralelo). Se ejecuta UNA sola vez sobre
 * el bloque modelo (filas 1-52) antes de clonar, igual que
 * `corregirMonedaBloqueModelo` — nunca toca A:D (tabla principal) ni
 * ninguna otra fila/columna. La fila 7 (antes banner "CANTIDAD", vacía en
 * F:M) y la fila 8 (antes totalmente en blanco en F:M) eran espacio sin
 * usar del bloque modelo — no se insertan filas nuevas ni se desplaza
 * nada del resto de la ficha. */
const BORDE_FINO = { left: { style: 'thin' as const }, right: { style: 'thin' as const }, top: { style: 'thin' as const }, bottom: { style: 'thin' as const } };

function ajustarBloqueLiquidacionHoras(ws: ExcelJS.Worksheet) {
  ws.unMergeCells('E5:E6');

  const etiqueta = (direccion: string, texto: string, navy: boolean, indent = 0) => {
    const cell = ws.getCell(direccion);
    cell.value = texto;
    cell.style = { ...cell.style, fill: { type: 'pattern', pattern: 'solid', fgColor: navy ? NAVY : BLANCO }, font: { ...cell.style.font, color: navy ? BLANCO : undefined, bold: true }, alignment: { ...cell.style.alignment, horizontal: 'left', indent }, border: BORDE_FINO };
  };
  etiqueta('E6', 'Horas', false);
  etiqueta('E7', 'Valor de la hora', false);
  etiqueta('E8', 'Costo mensual', true);

  // Ajuste "elimina eso... mueve las otras celdas a la izquierda" — la
  // columna F ("Salario básico mensual", redundante con la celda C5 de
  // la tabla principal) se elimina del bloque de verdad: todo el
  // contenido de G:M se recorre una columna a la izquierda (F:L), en vez
  // de solo vaciar F y dejar un hueco visible con sus propios bordes.
  // Se hace reescribiendo encabezados/valores en las columnas ya
  // corridas (nunca con spliceColumns, que afectaría TODA la hoja/las 52
  // filas del bloque, incluida la tabla principal A:D) — mismo criterio
  // de "no tocar nada fuera de este bloque" que el resto del ajuste.
  // Ajuste "faltaba tambien extra festivo" — la plantilla real trae 8
  // columnas (Horas semanales + los 7 conceptos de recargo/hora extra,
  // incluida "Extra festiva"/diurna festiva, pasada por alto antes) — con
  // la columna F eliminada, las 8 caben exactamente en F:M, sin dejar
  // ninguna columna vacía.
  const encabezados = ['Horas semanales', 'Rec. noct.', 'Extra diurna', 'Extra nocturna', 'Dom.-Fest.', 'Extra festiva', 'Extra fest. noct.', 'Rec. noct.-fest.'];
  const columnasDestino = ['F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
  columnasDestino.forEach((col, i) => { ws.getCell(`${col}5`).value = encabezados[i]; });

  // Ajuste "ajusta bien las celdas que se vea al descargar y no me salgan
  // asi" — columnas F:M traían de la plantilla un ancho angosto (pensado
  // para mostrar solo horas/enteros cortos), insuficiente para
  // "$ 10.422,06" con el nuevo formato monetario — Excel las mostraba
  // como "########". Se ensanchan a un ancho uniforme.
  for (const col of columnasDestino) {
    const columna = ws.getColumn(col);
    if ((columna.width ?? 0) < 13) columna.width = 13;
  }

  for (const col of columnasDestino) {
    // Corrección "no van centrados esos valores" — igual que ya hace la
    // plantilla en las celdas de COSTO MES/%, se centran horizontalmente.
    const c6 = ws.getCell(`${col}6`);
    c6.style = { ...c6.style, alignment: { ...c6.style.alignment, horizontal: 'center' }, border: BORDE_FINO };
    const c7 = ws.getCell(`${col}7`);
    c7.value = null;
    c7.style = { ...c7.style, fill: { type: 'pattern', pattern: 'solid', fgColor: BLANCO }, font: { ...c7.style.font, color: undefined }, alignment: { ...c7.style.alignment, horizontal: 'center' }, border: BORDE_FINO };
    const c8 = ws.getCell(`${col}8`);
    c8.style = { ...c8.style, fill: { type: 'pattern', pattern: 'solid', fgColor: NAVY }, font: { ...c8.style.font, color: BLANCO, bold: true }, alignment: { ...c8.style.alignment, horizontal: 'center' }, border: BORDE_FINO };
  }
}

/** Clona el bloque modelo (filas 1..52, ya con el símbolo de moneda
 * corregido) hacia `offset` filas más abajo: valores, estilo completo,
 * numFmt, alto de fila y las combinaciones de celdas. `offset=0` no hace
 * nada (la ficha 0 ya vive en su lugar, en las celdas originales de la
 * plantilla cargada en memoria). */
function clonarBloqueFicha(ws: ExcelJS.Worksheet, offset: number, mergesModelo: string[]) {
  if (offset === 0) return;
  for (let r = 1; r <= FILAS_POR_FICHA; r++) {
    const srcRow = ws.getRow(r);
    const destRow = ws.getRow(r + offset);
    destRow.height = srcRow.height;
    for (let c = 1; c <= COLUMNAS; c++) {
      const srcCell = srcRow.getCell(c);
      const destCell = destRow.getCell(c);
      destCell.value = srcCell.value;
      destCell.style = { ...srcCell.style };
      if (srcCell.numFmt) destCell.numFmt = srcCell.numFmt;
    }
  }
  for (const rango of mergesModelo) ws.mergeCells(desplazarRango(rango, offset));
}

/** Redondea a 6 decimales — evita que la división horasMensual÷diasPromedioMes
 * embeba artefactos de punto flotante (ej. "6.999999999999998") como
 * literal dentro de una fórmula de Excel; 6 decimales sobran para que la
 * multiplicación de vuelta reconcilie dentro de la tolerancia de 1 peso/
 * centésima de hora que ya usa el resto del ajuste. */
function redondear(valor: number): number {
  return Math.round(valor * 1e6) / 1e6;
}

function escribirTexto(ws: ExcelJS.Worksheet, direccion: string, texto: string) {
  ws.getCell(direccion).value = sanearTextoExcel(texto);
}

function escribirNumero(ws: ExcelJS.Worksheet, direccion: string, valor: number) {
  ws.getCell(direccion).value = Number.isFinite(valor) ? valor : 0;
}

/** Como `escribirNumero`, pero además fija el numFmt — SOLO para las
 * celdas del bloque "LIQUIDACIÓN DE HORAS" (F:M), que en la plantilla real
 * no traen ningún formato numérico propio (celdas en blanco, formato
 * general) — nunca se usa donde la plantilla ya tiene un numFmt válido.
 * ExcelJS comparte el objeto de estilo subyacente entre celdas que
 * arrancan con el mismo estilo (todas estas, en blanco/formato general
 * en la plantilla): mutar `cell.numFmt` directamente mutaba ese objeto
 * COMPARTIDO, así que la última celda escrita (M) terminaba imponiendo su
 * formato a F:L también. Se clona el estilo (`{...cell.style}`) antes de
 * tocarlo para que cada celda tenga su propio objeto. */
function escribirNumeroConFormato(ws: ExcelJS.Worksheet, direccion: string, valor: number, numFmt: string) {
  const cell = ws.getCell(direccion);
  cell.value = Number.isFinite(valor) ? valor : 0;
  cell.style = { ...cell.style, numFmt };
}

function escribirFormula(ws: ExcelJS.Worksheet, direccion: string, formula: string) {
  ws.getCell(direccion).value = { formula };
}

/** Como `escribirFormula`, pero además fija el numFmt — mismo motivo que
 * `escribirNumeroConFormato` (celdas del bloque "LIQUIDACIÓN DE HORAS" sin
 * numFmt propio en la plantilla). */
function escribirFormulaConFormato(ws: ExcelJS.Worksheet, direccion: string, formula: string, numFmt: string) {
  const cell = ws.getCell(direccion);
  cell.value = { formula };
  cell.style = { ...cell.style, numFmt };
}

/**
 * Escribe una ficha completa (cargo o turnante) en el bloque que inicia
 * en la fila `r`. Mapeo EXACTO confirmado contra la plantilla real
 * (§4-§13 del ajuste) — cada desplazamiento fue verificado leyendo
 * "Mano de obra.xlsx" con ExcelJS antes de implementar.
 */
function escribirFicha(ws: ExcelJS.Worksheet, indiceFicha: number, ficha: FichaManoObraExportDto) {
  const r = inicioFicha(indiceFicha);
  const d = ficha.detalleUnitario;

  // §4 — identificación.
  escribirTexto(ws, `A${r + 1}`, ficha.cargo);
  escribirTexto(ws, `A${r + 3}`, ficha.horario);

  // §5 — detalle salarial unitario (valores canónicos, nunca recalculados
  // aquí). Ajuste "estos de la izquierda deben venir del resultado de la
  // tabla de la derecha" — los 7 conceptos de recargo, TODOS con columna
  // propia en "LIQUIDACIÓN DE HORAS" (G:M, tras eliminar la columna F
  // vacía — incluye "Extra festiva", pasada por alto en un ajuste
  // anterior), ya no traen su $ como número suelto: cada uno es una
  // fórmula que referencia el "Costo mensual" de esa misma columna (fila
  // r+7, ver más abajo) — la tabla de la derecha pasa a ser la fuente, la
  // de la izquierda solo la muestra.
  escribirNumero(ws, `C${r + 5}`, d.salarioBasico);
  escribirNumero(ws, `C${r + 6}`, d.bonoPrestacional);
  escribirFormula(ws, `C${r + 7}`, `ROUND(G${r + 7},0)`);
  escribirFormula(ws, `C${r + 8}`, `ROUND(H${r + 7},0)`);
  escribirFormula(ws, `C${r + 9}`, `ROUND(I${r + 7},0)`);
  escribirFormula(ws, `C${r + 10}`, `ROUND(J${r + 7},0)`);
  escribirFormula(ws, `C${r + 11}`, `ROUND(K${r + 7},0)`);
  escribirFormula(ws, `C${r + 12}`, `ROUND(L${r + 7},0)`);
  escribirFormula(ws, `C${r + 13}`, `ROUND(M${r + 7},0)`);
  // §6 — fórmulas de reconciliación, SIEMPRE relativas al bloque `r`.
  escribirFormula(ws, `C${r + 14}`, `SUM(C${r + 7}:C${r + 13})`);
  escribirNumero(ws, `C${r + 15}`, d.auxilioTransporte);
  escribirFormula(ws, `C${r + 16}`, `SUM(C${r + 5},C${r + 6},C${r + 14},C${r + 15})`);

  // §7 — liquidación de horas (F:M, sin columna vacía: ver
  // ajustarBloqueLiquidacionHoras). Número plano para horas semanales (F).
  escribirNumeroConFormato(ws, `F${r + 5}`, ficha.horasSemanales, '#,##0.00');
  // Ajuste "y el 41,44 de donde sale? debe tener formula igual" — cada
  // concepto de recargo (G, J:M) se descompone como horas de UN SOLO
  // DÍA × días promedio del mes (`horasDia×diasPromedioMes`, igual que
  // el motor construye el total mensual — motor-comercial-30-dias.ts:
  // `{horasDia,diasPromedioMes}` por concepto). horasDia se obtiene
  // dividiendo el total mensual YA canónico (nunca un dato nuevo/
  // inventado) entre la misma constante fija que el motor usa para
  // proyectarlo — es la misma cuenta, solo mostrada como sus dos
  // factores en vez del resultado ya multiplicado. Rec. noct. usa
  // `diasOrdinariosPromedioMes` (24.08, días ORDINARIOS del mes); Dom.-
  // Fest./Extra festiva/Extra fest. noct./Rec. noct.-fest. usan
  // `domingosFestivosPromedioMes` (5.92, domingos/festivos del mes) —
  // dos parámetros fijos y separados, "conviven, cada uno con su propio
  // uso, nunca se mezclan para la misma hora" (motor-comercial-30-dias.ts).
  const formulaHorasDia = (horasMensual: number, diasPromedioMes: number) => `${redondear(horasMensual / diasPromedioMes)}*${diasPromedioMes}`;
  escribirFormulaConFormato(ws, `G${r + 5}`, formulaHorasDia(d.horasRecargoNocturno, 24.08), '#,##0.00');
  // Ajuste "las horas tienen formula mira" — Extra diurna/nocturna (fila
  // de horas de "hora extra" SEMANAL) muestran la MISMA fórmula que ya
  // usa el popup de detalle: horas extra SEMANALES×4,33 — solo cuando la
  // línea usa la metodología SEMANAL_4_33 (d.esMetodologiaSemanal); si
  // no, se deja el valor mensual directo, igual que siempre.
  if (d.esMetodologiaSemanal) {
    escribirFormulaConFormato(ws, `H${r + 5}`, `${d.horasSemanalesExtraDiurna}*4.33`, '#,##0.00');
    escribirFormulaConFormato(ws, `I${r + 5}`, `${d.horasSemanalesExtraNocturna}*4.33`, '#,##0.00');
  } else {
    escribirNumeroConFormato(ws, `H${r + 5}`, d.horasExtraDiurna, '#,##0.00');
    escribirNumeroConFormato(ws, `I${r + 5}`, d.horasExtraNocturna, '#,##0.00');
  }
  escribirFormulaConFormato(ws, `J${r + 5}`, formulaHorasDia(d.horasDominicalesFestivos, 5.92), '#,##0.00');
  escribirFormulaConFormato(ws, `K${r + 5}`, formulaHorasDia(d.horasExtraFestiva, 5.92), '#,##0.00');
  escribirFormulaConFormato(ws, `L${r + 5}`, formulaHorasDia(d.horasExtraFestivaNocturna, 5.92), '#,##0.00');
  escribirFormulaConFormato(ws, `M${r + 5}`, formulaHorasDia(d.horasRecargoNocturnoFestivo, 5.92), '#,##0.00');

  // Ajuste "el valor de las horas seria asi ejemplo la formula ($
  // 1.750.905 ÷ 210) × 1.25" — "Valor de la hora" (fila r+6) ya NO se
  // deriva de la columna C (eso ahora es al revés, ver §5): es
  // independiente, (Salario÷210)×factor legal del concepto — MISMA
  // fórmula y mismos factores que ya usa el motor
  // (motor-comercial-30-dias.ts, PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT:
  // divisorHoraMensual=210, factorRecargoNocturnoNormal=0.35,
  // factorHoraExtraDiurnaNormal=1.25, factorHoraExtraNocturnaNormal=1.75,
  // factorDominicalFestivo=1.90, factorHoraExtraDiurnaFestiva=2.15,
  // factorHoraExtraNocturnaFestiva=2.65, factorRecargoNocturnoFestivo=2.25
  // — constantes legales fijas, nunca configurables por cargo, nunca
  // inventadas aquí) — y por eso puede reconciliar hacia atrás con
  // columna C (§5) sin ninguna referencia circular. "Costo mensual" (fila
  // r+7) multiplica Horas×Valor de la hora (visible, auditable). F no es
  // un concepto de recargo (no tiene "factor"): usa el mismo divisor con
  // factor 1 (valor hora ordinaria) y su "costo mensual" es directamente
  // el salario (C5), no una multiplicación por horas semanales (esas
  // horas no son mensuales).
  const mapaConceptoHoras: { col: string; factor: number }[] = [
    { col: 'G', factor: 0.35 }, // Rec. noct. — factorRecargoNocturnoNormal
    { col: 'H', factor: 1.25 }, // Extra diurna — factorHoraExtraDiurnaNormal
    { col: 'I', factor: 1.75 }, // Extra nocturna — factorHoraExtraNocturnaNormal
    { col: 'J', factor: 1.90 }, // Dom.-Fest. — factorDominicalFestivo
    { col: 'K', factor: 2.15 }, // Extra festiva — factorHoraExtraDiurnaFestiva
    { col: 'L', factor: 2.65 }, // Extra fest. noct. — factorHoraExtraNocturnaFestiva
    { col: 'M', factor: 2.25 }, // Rec. noct.-fest. — factorRecargoNocturnoFestivo
  ];
  escribirFormula(ws, `F${r + 6}`, `C${r + 5}/210`);
  escribirFormula(ws, `F${r + 7}`, `C${r + 5}`);
  for (const { col, factor } of mapaConceptoHoras) {
    escribirFormula(ws, `${col}${r + 6}`, `(C${r + 5}/210)*${factor}`);
    escribirFormula(ws, `${col}${r + 7}`, `${col}${r + 5}*${col}${r + 6}`);
  }
  for (const col of ['F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']) {
    ws.getCell(`${col}${r + 6}`).style = { ...ws.getCell(`${col}${r + 6}`).style, numFmt: '"$ "#,##0.00;-"$ "#,##0.00;"$ "-;@' };
    ws.getCell(`${col}${r + 7}`).style = { ...ws.getCell(`${col}${r + 7}`).style, numFmt: FORMATO_MONETARIO_VISIBLE };
  }

  // §8 — prestaciones sociales. Ajuste "CORRECCIÓN FINAL DE EXPORTACIÓN
  // EXCEL — PORCENTAJES Y FORMATOS" — la columna B recibe el porcentaje
  // REAL ya resuelto por el motor (d.porcentaje*, decimal — nunca
  // costoMes/base), nunca 0 fijo. El formato 0,00%/0,000% ya existe en la
  // plantilla (nunca se toca aquí, solo se escribe el número).
  // Ajuste "ACA LA FORMULA SERIA ASI" / "ESTOS DEBERIAN TENER FORMULAS" —
  // columna C (COSTO MES) ahora es `=B×base`. Cuando la base coincide
  // exactamente con una celda que YA está en la hoja (ej. Cesantías/
  // Prima/Intereses usan la misma base que "Subtotal salarial por
  // trabajador", C{r+16} con auxilio incluido — Vacaciones la excluye,
  // C{r+16}-C{r+15}; Caja suma también Vacaciones, (C{r+16}-C{r+15})+
  // C{r+21}), se referencia esa celda en vivo, nunca un número suelto.
  // Salud/Pensión/ARL usan el IBC ya ajustado por el límite del 40% de
  // pagos no salariales (d.base*, ya resuelto por el motor) — ese ajuste
  // no vive en ninguna celda propia de la plantilla, así que se escribe
  // el valor ya resuelto. Ajuste "OJO EL TURNANTE DEBE TENER LA MISMA
  // FICHA DE LIQUIDACION DE 42H..." / "Y TODAS LAS FICHAS DEBEN TENER
  // FORMULAS Y DEMAS" — ya NO hay excepción por tipo de ficha: TURNANTE
  // ahora trae el desglose real (finRef), con porcentajes/bases reales
  // igual que CARGO, así que ambas usan la MISMA fórmula B×base.
  const escribirCostoConcepto = (direccionCosto: string, direccionPorcentaje: string, _valor: number, baseFormula: string) => {
    escribirFormula(ws, direccionCosto, `ROUND(${direccionPorcentaje}*${baseFormula},0)`);
  };
  const subtotalSalarialConAuxilio = `C${r + 16}`;
  // Ajuste "VACACIONES SERIA ASI" — suma directa de sus componentes
  // (Salario básico C6 + Bono prestacional C7 + Recargos y horas extras
  // C15), en vez de "Subtotal salarial (con auxilio) − Auxilio" —
  // matemáticamente idéntico, pero más legible/auditable: se ve
  // exactamente qué compone la base, en vez de una resta.
  const subtotalSalarialSinAuxilio = `(C${r + 5}+C${r + 6}+C${r + 14})`;
  escribirNumero(ws, `B${r + 19}`, d.porcentajeCesantias); escribirCostoConcepto(`C${r + 19}`, `B${r + 19}`, d.cesantias, subtotalSalarialConAuxilio);
  escribirNumero(ws, `B${r + 20}`, d.porcentajePrima); escribirCostoConcepto(`C${r + 20}`, `B${r + 20}`, d.prima, subtotalSalarialConAuxilio);
  escribirNumero(ws, `B${r + 21}`, d.porcentajeVacaciones); escribirCostoConcepto(`C${r + 21}`, `B${r + 21}`, d.vacaciones, subtotalSalarialSinAuxilio);
  escribirNumero(ws, `B${r + 22}`, d.porcentajeInteresesCesantias); escribirCostoConcepto(`C${r + 22}`, `B${r + 22}`, d.interesesCesantias, subtotalSalarialConAuxilio);
  escribirFormula(ws, `C${r + 23}`, `SUM(C${r + 19}:C${r + 22})`);

  // §9 — seguridad social (porcentaje real, incluye ARL configurado por el
  // cargo — nunca hardcodeado). Ajuste "PENSION ARL SALUD SON ASI IGUAL" —
  // misma base sin auxilio que Vacaciones/SENA/ICBF (salario+bono+
  // recargos), referenciada en vivo.
  escribirNumero(ws, `B${r + 26}`, d.porcentajeSalud); escribirCostoConcepto(`C${r + 26}`, `B${r + 26}`, d.salud, subtotalSalarialSinAuxilio);
  escribirNumero(ws, `B${r + 27}`, d.porcentajePension); escribirCostoConcepto(`C${r + 27}`, `B${r + 27}`, d.pension, subtotalSalarialSinAuxilio);
  escribirNumero(ws, `B${r + 28}`, d.porcentajeArl); escribirCostoConcepto(`C${r + 28}`, `B${r + 28}`, d.arl, subtotalSalarialSinAuxilio);
  escribirFormula(ws, `C${r + 29}`, `SUM(C${r + 26}:C${r + 28})`);

  // §10 — aportes parafiscales (porcentaje real, 0 cuando hay exoneración).
  // Ajuste "ESTE SERIA ASI" — el paréntesis debe envolver TODA la base
  // (salario+bono+recargos+vacaciones), nunca solo la primera parte:
  // multiplicar antes de sumar habría dejado afuera de la multiplicación
  // por B32 al sumando de vacaciones.
  escribirNumero(ws, `B${r + 32}`, d.porcentajeCaja); escribirCostoConcepto(`C${r + 32}`, `B${r + 32}`, d.cajaCompensacion, `(C${r + 5}+C${r + 6}+C${r + 14}+C${r + 21})`);
  escribirNumero(ws, `B${r + 33}`, d.porcentajeSena); escribirCostoConcepto(`C${r + 33}`, `B${r + 33}`, d.sena, subtotalSalarialSinAuxilio);
  escribirNumero(ws, `B${r + 34}`, d.porcentajeIcbf); escribirCostoConcepto(`C${r + 34}`, `B${r + 34}`, d.icbf, subtotalSalarialSinAuxilio);
  escribirFormula(ws, `C${r + 35}`, `SUM(C${r + 32}:C${r + 34})`);

  // §11 — otros costos unitarios (por trabajador, nunca el agregado del módulo).
  escribirNumero(ws, `C${r + 37}`, d.dotacion);
  escribirNumero(ws, `C${r + 38}`, d.epp);
  escribirNumero(ws, `C${r + 39}`, d.examenes);
  escribirNumero(ws, `C${r + 40}`, d.cursos);
  escribirNumero(ws, `C${r + 41}`, d.vacunas);
  escribirFormula(ws, `C${r + 42}`, `SUM(C${r + 37}:C${r + 41})`);

  // §12 — bonos no prestacionales. El DTO trae el total ya consolidado
  // (bonosNoPrestacionales), sin desglose por concepto — se coloca en el
  // primer concepto (Bono Alimentación) y los otros 3 quedan en 0, para
  // que el total siga saliendo de una fórmula SUM auditable como el resto
  // de bloques, en vez de un número suelto sin trazabilidad.
  escribirNumero(ws, `C${r + 44}`, d.bonosNoPrestacionales);
  escribirNumero(ws, `C${r + 45}`, 0);
  escribirNumero(ws, `C${r + 46}`, 0);
  escribirNumero(ws, `C${r + 47}`, 0);
  escribirFormula(ws, `C${r + 48}`, `SUM(C${r + 44}:C${r + 47})`);

  // §13 — costo unitario y total del cargo.
  escribirFormula(ws, `C${r + 49}`, `SUM(C${r + 16},C${r + 23},C${r + 29},C${r + 35},C${r + 42},C${r + 48})`);
  escribirNumero(ws, `C${r + 50}`, ficha.tipo === 'TURNANTE' ? (ficha.turnante?.cantidadTurnantesFisicos ?? 0) : ficha.cantidadTrabajadores);
  // Ajuste "AL FINAL ES QUE SE COLOCA EL FACTOR PARA QUE DE EL VALOR DEL
  // TURNANTE" — la ficha (C5:C48) siempre muestra la referencia COMPLETA
  // de 42h, sin escalar; el factor de cobertura parcial (turnante de
  // HORAS_REALES) se aplica UNA sola vez, aquí, sobre el Costo Total.
  const t = ficha.turnante;
  const tieneFactor = ficha.tipo === 'TURNANTE' && !!t && t.factorDenominador > 0 && t.factorNumerador !== t.factorDenominador;
  escribirFormula(ws, `C${r + 51}`, tieneFactor ? `ROUND(C${r + 49}*C${r + 50}*${redondear(t!.factorNumerador)}/${redondear(t!.factorDenominador)},0)` : `C${r + 49}*C${r + 50}`);
}

export interface OpcionesGeneracionExcel {
  bufferPlantilla: Buffer | ArrayBuffer | Uint8Array;
  fichas: FichaManoObraExportDto[];
}

/**
 * Ajuste "EXPORTAR COSTOS — EXCEL GENERAL CON TODAS LAS PESTAÑAS" — cuerpo
 * real de `generarExcelManoObra` extraído a una función que opera sobre un
 * `ExcelJS.Workbook` YA CARGADO (nunca crea ni carga su propia copia de la
 * plantilla), para que el exportador general (que combina esta hoja con
 * las demás pestañas de la Estructura de Costos en el MISMO workbook)
 * pueda reutilizar exactamente esta lógica sin duplicarla. El exportador
 * individual de Mano de Obra (`generarExcelManoObra`, abajo) sigue
 * teniendo el mismo comportamiento/firma de siempre — solo delega aquí.
 */
export function poblarHojaManoObra(wb: ExcelJS.Workbook, fichas: FichaManoObraExportDto[]): void {
  // Corrección "el excel que descargo me genera este error" — la
  // plantilla real trae ~540 nombres definidos LEGADOS que apuntan a
  // libros externos por índice (`'[4]AIU'!$J$105`, `'[8]Pozos'!...`,
  // etc. — cruft heredado de copiar/pegar celdas desde otras hojas de
  // cálculo corporativas, ninguno usado por la hoja "Mano de Obra").
  // ExcelJS, al reescribir el workbook, SIEMPRE descarta la carpeta
  // `xl/externalLinks/` que esos nombres necesitan para resolverse, pero
  // deja los `<definedName>` apuntando a esos índices ahora inexistentes
  // — esa referencia colgante es exactamente lo que Excel detecta y
  // "repara" al abrir el archivo generado (removiendo el rango con
  // nombre). Se limpian aquí, antes de cualquier otro cambio, para que
  // el archivo abra sin ningún aviso de reparación — nunca se toca
  // ninguna celda/fórmula/estilo de la hoja real.
  wb.definedNames.model = [];
  const ws = wb.getWorksheet(NOMBRE_HOJA);
  if (!ws) throw new Error(`La plantilla no contiene la hoja "${NOMBRE_HOJA}".`);

  corregirMonedaBloqueModelo(ws);
  ajustarBloqueLiquidacionHoras(ws);
  const mergesModelo = obtenerMergesDelBloqueModelo(ws);

  fichas.forEach((ficha, indice) => {
    clonarBloqueFicha(ws, indice * DESPLAZAMIENTO_FICHA, mergesModelo);
    escribirFicha(ws, indice, ficha);
  });

  // §23 — área de impresión cubre todas las fichas generadas (nunca recorta las posteriores).
  const ultimaFila = inicioFicha(fichas.length - 1) + FILAS_POR_FICHA - 1;
  ws.pageSetup.printArea = `A1:M${ultimaFila}`;
}

export async function generarExcelManoObra({ bufferPlantilla, fichas }: OpcionesGeneracionExcel): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bufferPlantilla as ExcelJS.Buffer);
  poblarHojaManoObra(wb, fichas);
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function nombreArchivoExportacion(numeroProceso: string, fecha: Date = new Date()): string {
  const fechaIso = fecha.toISOString().slice(0, 10);
  const numeroSaneado = numeroProceso.replace(/[^a-zA-Z0-9-_]/g, '_');
  return `Mano_de_Obra_${numeroSaneado}_${fechaIso}.xlsx`;
}
