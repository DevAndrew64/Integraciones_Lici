/**
 * Generación del "INFORME PROCESOS ADJUDICADOS Y NO ADJUDICADOS" REUTILIZANDO
 * la plantilla maestra del cliente (nunca se crea un Excel desde cero).
 *
 * Plantilla vigente: "Informe.xlsx" (hojas "EXPORTE" y "RESUMEN") — sustituyó
 * a la plantilla original "INFORME PROCESOS ADJUDICADOS Y NO ADJUDICADOS.xlsx"
 * (hojas "BASE DE DATOS"/"DASHBOARD GENERAL"). Las columnas de EXPORTE YA
 * cambiaron de posición una vez entre plantillas — por eso este módulo
 * resuelve TODAS las columnas por el TEXTO del encabezado (fila 1), nunca
 * por número de columna fijo, para no depender de que el orden se mantenga.
 *
 * Diagnóstico de "Informe.xlsx" (confirmado leyendo el archivo real):
 *  - Las fórmulas de "RESUMEN" venían YA ROTAS en la plantilla: referencian
 *    `EXPORTE!#REF!` (columnas borradas en algún momento) y además tienen
 *    bugs de copiar/pegar sin actualizar (TEMPOCOLBA/VIGICOLBA cuentan
 *    literalmente "ASEOCOLBA"). No se "preservan" esas fórmulas — se
 *    reescriben correctamente aquí.
 *  - No hay tabla de Excel (ListObject) ni gráfico en esta plantilla.
 *
 * Diseño de "RESUMEN": la sección de KPIs (filas 1-12, fija en su
 * posición) usa fórmulas de RANGO COMPLETO DE COLUMNA (ej.
 * `SUMIFS(EXPORTE!H2:H1048576,...)`) — nunca necesitan ajustarse aunque
 * EXPORTE crezca o se reduzca. Los 3 bloques por empresa (encabezado +
 * tabla de subtotales + listas de entidades adjudicadas/no adjudicadas) se
 * regeneran COMPLETOS en cada informe, empezando siempre en la fila 15 y
 * calculando dinámicamente dónde empieza cada bloque siguiente según cuántas
 * filas necesitó el bloque anterior — así crecen/decrecen sin límite fijo y
 * nunca se pisan entre sí. Esto es seguro porque ninguna fórmula de un
 * bloque referencia celdas de otro bloque ni de la sección de KPIs.
 *
 * Decisiones de mapeo confirmadas explícitamente por el usuario:
 *  - FECHA DE HALLAZGO         → Solicitud.createdAt
 *  - ESTADO DE PRESENTACION    → misma columna que "Adjudicado/No adjudicado"
 *                                 (derivado del estadoRevision de cierre, ver route.ts)
 *  - Columnas de cronograma (10 de 11 conceptos, sin "informe final") → SÍ
 *    se completan, por coincidencia de texto del `evento` de
 *    `ProcesoCronogramaSecop` contra palabras clave construidas sobre 119
 *    nombres de evento reales relevados de la BD. Cuando no hay coincidencia
 *    o el proceso no tiene `procesoId`, la celda queda en blanco.
 */
import ExcelJS from 'exceljs';

export const NOMBRE_HOJA_BASE = 'EXPORTE';
export const NOMBRE_HOJA_DASHBOARD = 'RESUMEN';
const PRIMERA_FILA_DATOS = 2;
const ULTIMA_FILA_EXCEL = 1048576;

function safeArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function safeString(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

/** Convierte un número de columna 1-based a letra de Excel (1→A, 27→AA, ...). */
function letraColumna(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function normalizarEncabezado(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Lee la fila 1 de una hoja y devuelve un mapa TEXTO_ENCABEZADO_NORMALIZADO → número de columna. */
function construirMapaColumnas(hoja: ExcelJS.Worksheet): Map<string, number> {
  const mapa = new Map<string, number>();
  const header = hoja.getRow(1);
  header.eachCell({ includeEmpty: false }, (cell, col) => {
    const texto = normalizarEncabezado(safeString(cell.value));
    if (texto) mapa.set(texto, col);
  });
  return mapa;
}

const MMAP_MODALIDAD: Record<string, string> = {
  '1': 'Contratación directa', '2': 'Licitación pública', '3': 'Selección abreviada',
  '4': 'Concurso de méritos', '5': 'Mínima cuantía', '6': 'Régimen especial',
};

/** Mismo criterio que `modS()` de page.tsx:2138 — mapeo por código + heurística de texto. */
export function normalizarTipoProceso(modalidad: string | null | undefined, nombreProceso: string | null | undefined, objeto: string | null | undefined): string {
  const m = MMAP_MODALIDAD[modalidad ?? ''] ?? modalidad ?? '';
  if (m) return m;
  const n = (nombreProceso || objeto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (n.includes('minima cuantia')) return 'Mínima cuantía';
  if (n.includes('licitacion')) return 'Licitación pública';
  if (n.includes('seleccion abreviada')) return 'Selección abreviada';
  if (n.includes('contratacion directa')) return 'Contratación directa';
  if (n.includes('concurso de meritos')) return 'Concurso de méritos';
  if (n.includes('regimen especial')) return 'Régimen especial';
  return '';
}

/** Última fila de `asignaciones` con estadoRevision terminal — mismo criterio que getUACierre() de page.tsx:2131. */
const ESTADOS_CIERRE = new Set(['CERRADO_ADJUDICADO', 'CERRADO_NO_ADJUDICADO', 'CERRADO_NO_CUMPLIMIENTO', 'CANCELADO', 'RECHAZADO']);
function obtenerAsignacionDeCierre(asignaciones: unknown): Record<string, unknown> {
  const a = safeArray<Record<string, unknown>>(asignaciones);
  for (let i = a.length - 1; i >= 0; i--) {
    if (ESTADOS_CIERRE.has(safeString(a[i].estadoRevision))) return a[i];
  }
  return a[a.length - 1] || {};
}

/** Mismo criterio que obsDetalle() de page.tsx:2150-2168, sin la parte de "revisión" (no aplica aquí). */
function obtenerCausalNoAdjudicacion(ua: Record<string, unknown>): string {
  const obs = safeArray<Record<string, unknown>>(ua.observaciones);
  let causa = '';
  let especifica = '';
  if (obs.length === 0) {
    causa = safeString(ua.tipoCausa);
    especifica = safeString(ua.causaEspecifica);
  } else {
    const tSet = new Set<string>();
    const eArr: string[] = [];
    for (const o of obs) {
      const t = safeString(o.tipoCausa);
      if (t) tSet.add(t);
      const e = safeString(o.causaEspecifica);
      if (e) eArr.push(e);
    }
    causa = Array.from(tSet).join(', ');
    especifica = eArr.join(', ');
  }
  return [causa, especifica].filter(Boolean).join(' — ');
}

const RESULTADO_A_ESTADO_PRESENTACION: Record<string, string> = {
  'Adjudicado': 'ADJUDICADA',
  'No adjudicado': 'NO ADJUDICADA',
};

function normalizarTextoEvento(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export interface EventoCronogramaInput {
  evento: string;
  fecha: Date | null;
  orden: number | null;
}

/**
 * Encabezados de las 10 columnas de cronograma que sí se completan
 * (idéntico a las 11 columnas del Excel salvo "FECHA INFORME FINAL", que
 * queda siempre vacía) y las palabras clave que las identifican —
 * construidas sobre los 119 nombres de evento DISTINTOS realmente
 * presentes en `ProcesoCronogramaSecop` (no un catálogo inventado).
 */
const PALABRAS_CRONOGRAMA: { encabezado: string; palabras: string[] }[] = [
  { encabezado: 'MANIFESTACIÓN DE INTERES', palabras: [
    'manifestacion de interes', 'manifestar interes', 'manifestacion interes', 'expresion de interes',
  ] },
  { encabezado: 'FECHA PRESENTACIÓN OBSERVACIONES PREPLIEGO', palabras: [
    'observaciones al proyecto de pliego', 'plazo para recepcion de observaciones', 'plazo para solicitar aclaraciones',
  ] },
  { encabezado: 'FECHA RESPUESTA OBSERVACIONES PREPLIEGO', palabras: [
    'respuesta a las observaciones a la invitacion', 'respuesta a observaciones y sugerencias al proyecto de pliego',
    'respuesta a las observaciones al proyecto de pliego', 'respuesta a observaciones al proyecto de pliego',
  ] },
  { encabezado: 'FECHA PUBLICACION PLIEGO DEFINITIVO', palabras: [
    'pliego de condiciones definitivo', 'publicacion del pliego de condiciones definitivo',
  ] },
  { encabezado: 'FECHA PRESENTACIÓN OBSERVACIONES PLIEGO DEF', palabras: [
    'observaciones a los pliegos de condiciones definitivos', 'observaciones al pliego de condiciones definitivo',
    'observaciones a los pliego de condiciones definitivos',
  ] },
  { encabezado: 'FECHA RESPUESTA OBSERVACIONES PLIEGO DEF', palabras: [
    'respuesta a las observaciones al pliego de condiciones definitivo',
    'respuesta a las observaciones a los pliegos de condiciones definitivos',
  ] },
  { encabezado: 'FECHA INFORME EVALUACION INICIAL', palabras: [
    'publicacion del informe de evaluacion de las ofertas', 'publicacion del informe de verificacion o evaluacion',
  ] },
  { encabezado: 'FECHA OBSERVACIONES Y/O SUBSANACION INFORME INICIAL', palabras: [
    'presentacion de observaciones al informe de verificacion o evaluacion',
    'presentacion de observaciones al informe de evaluacion',
  ] },
  { encabezado: 'FECHA DE SUBASTA', palabras: [
    'fecha de inicio de la subasta', 'fecha de inicio de subasta', 'inicio de la subasta',
  ] },
  { encabezado: 'FECHA AUDIENCIA DE ADJUDICACION', palabras: [
    'audiencia de adjudicacion',
  ] },
  // "FECHA INFORME FINAL" NO tiene entrada a propósito: no existe ningún
  // evento real con ese significado en los 119 nombres relevados.
];

/**
 * Resuelve, para un proceso, la primera fecha que coincide con cada
 * encabezado de cronograma — nunca fuerza una coincidencia: si ningún
 * evento del proceso contiene ninguna de las palabras clave, el encabezado
 * queda sin entrada (se escribe en blanco). Cuando hay varios eventos
 * candidatos, usa el de menor `orden` (o, si no hay orden, el de fecha más
 * temprana).
 */
export function resolverFechasCronograma(eventos: EventoCronogramaInput[]): Record<string, Date> {
  const ordenados = [...eventos].sort((a, b) => {
    if (a.orden != null && b.orden != null) return a.orden - b.orden;
    if (a.orden != null) return -1;
    if (b.orden != null) return 1;
    const fa = a.fecha?.getTime() ?? Infinity;
    const fb = b.fecha?.getTime() ?? Infinity;
    return fa - fb;
  });
  const resultado: Record<string, Date> = {};
  for (const { encabezado, palabras } of PALABRAS_CRONOGRAMA) {
    const encontrado = ordenados.find(e => {
      const n = normalizarTextoEvento(e.evento);
      return e.fecha != null && palabras.some(p => n.includes(p));
    });
    if (encontrado?.fecha) resultado[encabezado] = encontrado.fecha;
  }
  return resultado;
}

export interface SolicitudInformeInput {
  createdAt: Date;
  modalidad: string | null;
  nombreProceso: string | null;
  codigoProceso: string | null;
  entidad: string | null;
  perfil: string | null;
  ciudad: string | null;
  objeto: string | null;
  valor: number | null;
  resultadoFinal: string | null;
  fechaCierre: Date | null;
  sqrNumero: string | null;
  revisor: string | null;
  plataforma: string | null;
  asignaciones: unknown;
  /** {nombreIndicador: valorTexto} ya consolidado — ver GET /api/solicitudes/indicadores-financieros */
  indicadores?: Record<string, string>;
  /** Eventos crudos de ProcesoCronogramaSecop — vacío/undefined si la solicitud no tiene procesoId. */
  eventosCronograma?: EventoCronogramaInput[];
}

interface FilaBase {
  fechaHallazgo: Date | null;
  tipoProceso: string;
  numeroProceso: string;
  entidad: string;
  empresa: string;
  ciudad: string;
  objeto: string;
  presupuesto: number | null;
  estadoPresentacion: string;
  observacionesComercial: string;
  fechaCierre: Date | null;
  sqr: string;
  responsable: string;
  responsableRevision: string;
  plataforma: string;
  indicadores: Record<string, string>;
  causalNoAdjudicacion: string;
  fechasCronograma: Record<string, Date>;
}

/** Transforma una Solicitud "cruda" (ya filtrada por el llamador) a la fila que va en EXPORTE. */
export function construirFilaInforme(s: SolicitudInformeInput): FilaBase {
  const ua = obtenerAsignacionDeCierre(s.asignaciones);
  const responsable = safeString(ua.analistaAsignado);
  return {
    fechaHallazgo: s.createdAt,
    tipoProceso: normalizarTipoProceso(s.modalidad, s.nombreProceso, s.objeto),
    numeroProceso: s.codigoProceso ?? '',
    entidad: s.entidad ?? '',
    empresa: (s.perfil ?? '').toUpperCase(),
    ciudad: s.ciudad ?? '',
    objeto: s.objeto ?? '',
    presupuesto: s.valor ?? null,
    estadoPresentacion: RESULTADO_A_ESTADO_PRESENTACION[s.resultadoFinal ?? ''] ?? (s.resultadoFinal ?? ''),
    observacionesComercial: safeString(ua.observacionesGestion),
    fechaCierre: s.fechaCierre,
    sqr: s.sqrNumero ?? '',
    responsable,
    responsableRevision: s.revisor ?? '',
    plataforma: s.plataforma ?? '',
    indicadores: s.indicadores ?? {},
    causalNoAdjudicacion: obtenerCausalNoAdjudicacion(ua),
    fechasCronograma: resolverFechasCronograma(s.eventosCronograma ?? []),
  };
}

/** Encabezado EXPORTE → cómo se obtiene el valor de esa columna a partir de una FilaBase. Columnas ausentes en la plantilla simplemente no se escriben (nunca se inventa una columna). */
const COLUMNAS_EXPORTE: { encabezado: string; valor: (f: FilaBase) => unknown; esFecha?: boolean }[] = [
  { encabezado: 'FECHA DE HALLAZGO', valor: f => f.fechaHallazgo, esFecha: true },
  { encabezado: 'TIPO DE PROCESO', valor: f => f.tipoProceso.toUpperCase() },
  { encabezado: 'No DE PROCESO', valor: f => f.numeroProceso },
  { encabezado: 'ENTIDAD', valor: f => f.entidad },
  { encabezado: 'EMPRESA', valor: f => f.empresa },
  { encabezado: 'CIUDAD', valor: f => f.ciudad },
  { encabezado: 'OBJETO', valor: f => f.objeto },
  { encabezado: 'PRESUPUESTO', valor: f => f.presupuesto },
  { encabezado: 'ESTADO DE PRESENTACION', valor: f => f.estadoPresentacion },
  { encabezado: 'OBSERVACIONES COMERCIAL', valor: f => f.observacionesComercial || undefined },
  { encabezado: 'FECHA DE CIERRE', valor: f => f.fechaCierre, esFecha: true },
  { encabezado: 'SQR PRESENTACION OFERTA', valor: f => f.sqr || undefined },
  { encabezado: 'RESPONSABLE', valor: f => f.responsable || undefined },
  { encabezado: 'RESPONSABLE DE REVISION', valor: f => f.responsableRevision || undefined },
  { encabezado: 'PLATAFORMA', valor: f => f.plataforma || undefined },
  { encabezado: 'CAUSALES DE NO ADJUDICACION', valor: f => f.causalNoAdjudicacion || undefined },
];

const INDICADOR_A_ENCABEZADO: Record<string, string> = {
  'Liquidez': 'LIQUIDEZ',
  'Endeudamiento': 'ENDEUDAMIENTO',
  'Razón de cobertura de intereses': 'RAZÓN DE COBERTURA DE INTERESES',
  'Rentabilidad del activo': 'RENTABILIDAD DEL ACTIVO',
  'Rentabilidad del patrimonio': 'RENTABILIDAD DEL PATRIMONIO',
  'Capital de trabajo': 'CAPITAL DE TRABAJO',
};

export interface GenerarInformeOpciones {
  rutaPlantilla: string;
  filas: SolicitudInformeInput[];
}

/**
 * Devuelve el Buffer del informe ya generado. NUNCA escribe en
 * `rutaPlantilla` — solo la abre en modo lectura.
 */
export async function generarInformeProcesosAdjudicados({ rutaPlantilla, filas }: GenerarInformeOpciones): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(rutaPlantilla);

  const hojaBase = workbook.getWorksheet(NOMBRE_HOJA_BASE);
  const hojaDashboard = workbook.getWorksheet(NOMBRE_HOJA_DASHBOARD);
  if (!hojaBase) throw new Error(`La plantilla no tiene una hoja llamada "${NOMBRE_HOJA_BASE}".`);

  const mapaColumnas = construirMapaColumnas(hojaBase);
  const ultimaColumnaBase = Math.max(1, ...mapaColumnas.values());

  // Última fila de datos ANTES de tocar nada. Se detecta dinámicamente.
  let filaAnteriorUltima = PRIMERA_FILA_DATOS - 1;
  hojaBase.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber >= PRIMERA_FILA_DATOS) filaAnteriorUltima = Math.max(filaAnteriorUltima, rowNumber);
  });
  if (filaAnteriorUltima < PRIMERA_FILA_DATOS) filaAnteriorUltima = PRIMERA_FILA_DATOS; // plantilla sin datos previos

  // Captura el estilo de la primera fila de datos ANTES de borrar, para
  // replicarlo en las filas nuevas — nunca se inventa un estilo nuevo. Si
  // la plantilla no tiene ninguna fila de datos todavía (como
  // "Informe.xlsx" recién cargada), no hay estilo que capturar y las filas
  // nuevas quedan con el estilo por defecto de ExcelJS.
  const estiloPorColumna: (Partial<ExcelJS.Style> | undefined)[] = [];
  const numFmtPorColumna: (string | undefined)[] = [];
  const filaEstiloOrigen = hojaBase.getRow(PRIMERA_FILA_DATOS);
  for (let c = 1; c <= ultimaColumnaBase; c++) {
    const celda = filaEstiloOrigen.getCell(c);
    estiloPorColumna[c] = { font: celda.font, fill: celda.fill, border: celda.border, alignment: celda.alignment };
    numFmtPorColumna[c] = celda.numFmt;
  }
  const numFmtFecha = numFmtPorColumna[mapaColumnas.get('FECHA DE HALLAZGO') ?? 1] || 'mm-dd-yy';

  // Borra ÚNICAMENTE los registros antiguos (nunca el encabezado, fila 1).
  // Nota: `worksheet.spliceRows(start, count)` de ExcelJS solo funciona
  // desplazando hacia arriba las filas que quedan DESPUÉS del rango
  // borrado — cuando se borra hasta la última fila con datos (no queda
  // ninguna fila "después"), la librería no hace nada (no-op silencioso,
  // confirmado con un caso real). Por eso el borrado se hace limpiando
  // cada fila manualmente.
  const filaTope = Math.max(filaAnteriorUltima, filas.length > 0 ? PRIMERA_FILA_DATOS + filas.length - 1 : PRIMERA_FILA_DATOS);
  for (let r = PRIMERA_FILA_DATOS; r <= filaTope; r++) {
    const row = hojaBase.getRow(r);
    row.values = [];
    for (let c = 1; c <= ultimaColumnaBase; c++) {
      row.getCell(c).style = {};
    }
  }

  const filasConstruidas = filas.map(construirFilaInforme);

  for (let i = 0; i < filasConstruidas.length; i++) {
    const fila = filasConstruidas[i];
    const numeroFila = PRIMERA_FILA_DATOS + i;
    const row = hojaBase.getRow(numeroFila);
    for (let c = 1; c <= ultimaColumnaBase; c++) {
      const celda = row.getCell(c);
      if (estiloPorColumna[c]) celda.style = estiloPorColumna[c] as ExcelJS.Style;
      if (numFmtPorColumna[c]) celda.numFmt = numFmtPorColumna[c] as string;
    }
    for (const { encabezado, valor } of COLUMNAS_EXPORTE) {
      const col = mapaColumnas.get(normalizarEncabezado(encabezado));
      if (col == null) continue; // columna no existe en esta versión de la plantilla — nunca se inventa
      row.getCell(col).value = (valor(fila) as ExcelJS.CellValue) ?? null;
    }
    for (const [nombreIndicador, encabezado] of Object.entries(INDICADOR_A_ENCABEZADO)) {
      const col = mapaColumnas.get(normalizarEncabezado(encabezado));
      if (col == null) continue;
      const texto = fila.indicadores[nombreIndicador];
      if (texto === undefined) continue;
      const t = texto.trim();
      row.getCell(col).value = /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
    }
    for (const [encabezado, fecha] of Object.entries(fila.fechasCronograma)) {
      const col = mapaColumnas.get(normalizarEncabezado(encabezado));
      if (col == null) continue;
      const celda = row.getCell(col);
      celda.value = fecha;
      celda.numFmt = numFmtFecha;
    }
    row.commit();
  }

  const filaNuevaUltima = filas.length > 0 ? PRIMERA_FILA_DATOS + filas.length - 1 : PRIMERA_FILA_DATOS;

  // Ajusta el rango del AutoFilter al nuevo último renglón, normalizado al
  // rango real de columnas de negocio (la plantilla tenía un
  // `_xlnm._FilterDatabase` arrastrado por error hasta la columna DCQ).
  hojaBase.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: filaNuevaUltima, column: ultimaColumnaBase },
  };

  // Reconstruye "RESUMEN" — ver docblock del módulo: las fórmulas venían
  // rotas en la plantilla, se reescriben aquí con rango completo de
  // columna (nunca necesitan ajustarse) y los 3 bloques por empresa se
  // regeneran completos, creciendo/decreciendo según el volumen real.
  if (hojaDashboard) {
    reconstruirResumen(hojaDashboard, filasConstruidas, mapaColumnas);
  }

  // Hojas adicionales por empresa + consolidado (petición directa, misma
  // ronda que "SEGREGAR POR EMPRESA + CONSOLIDADO") — generadas frescas en
  // cada informe, nunca se editan hojas preexistentes con contenido de otro
  // período, así que crecen/decrecen sin límite fijo sin ningún riesgo.
  crearHojasPorEmpresaYConsolidado(workbook, filasConstruidas);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** `=IFERROR(<expr>,"")` — mismo patrón ya usado en toda la plantilla original. */
function conIferror(expr: string): string {
  return `IFERROR(${expr},"")`;
}

/**
 * Reescribe la sección de KPIs de RESUMEN (filas 1-12, posición fija) con
 * fórmulas de RANGO COMPLETO DE COLUMNA — nunca dependen de cuántas filas
 * tenga EXPORTE — y regenera los 3 bloques por empresa desde la fila 15,
 * calculando dinámicamente dónde empieza cada bloque según el tamaño real
 * del bloque anterior.
 */
function reconstruirResumen(hoja: ExcelJS.Worksheet, filas: FilaBase[], mapaColumnasExporte: Map<string, number>): void {
  const colEmpresa = mapaColumnasExporte.get('EMPRESA');
  const colPresupuesto = mapaColumnasExporte.get('PRESUPUESTO');
  const colEstado = mapaColumnasExporte.get('ESTADO DE PRESENTACION');
  if (colEmpresa == null || colPresupuesto == null || colEstado == null) {
    // La plantilla no tiene las columnas mínimas necesarias — no se inventa
    // ninguna fórmula sobre columnas inexistentes.
    return;
  }
  const rE = `${NOMBRE_HOJA_BASE}!${letraColumna(colEmpresa)}2:${letraColumna(colEmpresa)}${ULTIMA_FILA_EXCEL}`;
  const rH = `${NOMBRE_HOJA_BASE}!${letraColumna(colPresupuesto)}2:${letraColumna(colPresupuesto)}${ULTIMA_FILA_EXCEL}`;
  const rI = `${NOMBRE_HOJA_BASE}!${letraColumna(colEstado)}2:${letraColumna(colEstado)}${ULTIMA_FILA_EXCEL}`;

  // Formatos — Ajuste "FORMATO MONEDA Y %" (petición directa, screenshot):
  // toda celda de valor monetario (VALOR TOTAL, VALOR POTENCIAL, PRESUPUESTO)
  // en formato moneda contable ("$ 564.496.614,00", "$ -" para cero); toda
  // celda de "% PARTICIPACION" en formato porcentaje sin decimales ("0%").
  const FMT_MONEDA = '_ "$"* #,##0.00_ ;_ "$"* -#,##0.00_ ;_ "$"* "-"??_ ;_ @_ ';
  const FMT_PORCENTAJE = '0%';
  const f = (dir: string, formula: string, numFmt?: string) => {
    const celda = hoja.getCell(dir);
    celda.value = { formula } as ExcelJS.CellFormulaValue;
    if (numFmt) celda.numFmt = numFmt;
  };

  // KPIs generales (filas 3-4).
  f('A4', conIferror(`COUNTA(${rE})`));
  f('B4', conIferror(`SUM(${rH})`), FMT_MONEDA);
  f('D4', conIferror(`SUMIFS(${rH},${rI},"ADJUDICADA")`), FMT_MONEDA);
  f('E4', conIferror(`SUMIFS(${rH},${rI},"ADJUDICADA")`), FMT_MONEDA);
  f('F4', conIferror(`SUMIFS(${rH},${rI},"ADJUDICADA")`), FMT_MONEDA);
  f('H4', conIferror(`+B4-D4`), FMT_MONEDA);
  f('I4', conIferror(`+B4-D4`), FMT_MONEDA);
  f('J4', conIferror(`+B4-D4`), FMT_MONEDA);
  f('K4', conIferror(`+B4-D4`), FMT_MONEDA);

  // Procesos presentados por empresa (filas 9-12).
  const EMPRESAS: { fila: number; nombre: string }[] = [
    { fila: 9, nombre: 'ASEOCOLBA' }, { fila: 10, nombre: 'TEMPOCOLBA' }, { fila: 11, nombre: 'VIGICOLBA' },
  ];
  for (const { fila, nombre } of EMPRESAS) {
    f(`B${fila}`, conIferror(`COUNTIF(${rE},"${nombre}")`));
    f(`C${fila}`, conIferror(`SUMIFS(${rH},${rE},"${nombre}")`), FMT_MONEDA);
    f(`D${fila}`, conIferror(`C${fila}/$B$4`), FMT_PORCENTAJE);
  }
  f('B12', 'SUM(B9:B11)');
  hoja.getCell('C12').value = { formula: 'SUM(C9:C11)' } as ExcelJS.CellFormulaValue; hoja.getCell('C12').numFmt = FMT_MONEDA;
  hoja.getCell('D12').value = { formula: 'SUM(D9:D11)' } as ExcelJS.CellFormulaValue; hoja.getCell('D12').numFmt = FMT_PORCENTAJE;

  // Ajuste "AJUSTAR ANCHO DE COLUMNAS DE RESUMEN" (petición directa,
  // screenshot) — la plantilla original traía columnas angostas (pensadas
  // para el layout viejo, con menos texto); con nombres de entidad y
  // causales reales el contenido se corta/se ve amontonado. Anchos fijos,
  // suficientes para el contenido más largo visto en datos reales.
  const ANCHOS_RESUMEN: [number, number][] = [
    [1, 20], [2, 22], [3, 24], [4, 15], [5, 3],
    [6, 55], [7, 22], [8, 18], [9, 3],
    [10, 55], [11, 22], [12, 18], [13, 48],
  ];
  for (const [c, w] of ANCHOS_RESUMEN) hoja.getColumn(c).width = w;

  // Limpia todo lo que hubiera desde la fila 14 en adelante (bloques por
  // empresa de la plantilla original o de una generación anterior) antes de
  // regenerarlos — incluidas las celdas combinadas (la plantilla ya trae
  // combinaciones ahí, ej. A15:D15; sin desmarcarlas primero, ExcelJS
  // lanza "Cannot merge already merged cells" al intentar recrearlas).
  const ultimaFilaHoja = Math.max(hoja.rowCount, 200);
  const mergesAQuitar = (hoja.model.merges || []).filter(rango => {
    const filaInicio = Number(rango.split(':')[0].match(/\d+/)?.[0] ?? 0);
    return filaInicio >= 14;
  });
  for (const rango of mergesAQuitar) hoja.unMergeCells(rango);
  for (let r = 14; r <= ultimaFilaHoja; r++) {
    const row = hoja.getRow(r);
    row.values = [];
    for (let c = 1; c <= 13; c++) row.getCell(c).style = {};
  }

  // Ajuste "LAS CELDAS NO ESTÁN CON BORDES" (petición directa, screenshot)
  // — borde fino en encabezados Y en toda celda de dato (antes solo los
  // encabezados llevaban estilo; las filas de datos quedaban sin nada).
  const BORDE_FINO: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FF000000' } }, bottom: { style: 'thin', color: { argb: 'FF000000' } },
    left: { style: 'thin', color: { argb: 'FF000000' } }, right: { style: 'thin', color: { argb: 'FF000000' } },
  };
  const ESTILO_TITULO_BLOQUE: Partial<ExcelJS.Style> = { font: { bold: true }, alignment: { horizontal: 'center' }, border: BORDE_FINO as ExcelJS.Borders };
  const ESTILO_ENCABEZADO_BLOQUE: Partial<ExcelJS.Style> = {
    font: { bold: true, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002060' } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    border: BORDE_FINO as ExcelJS.Borders,
  };
  const ponTitulo = (rango: string, texto: string) => {
    hoja.mergeCells(rango);
    const celda = hoja.getCell(rango.split(':')[0]);
    celda.value = texto;
    celda.style = ESTILO_TITULO_BLOQUE as ExcelJS.Style;
  };
  const ponEncabezados = (fila: number, cols: [number, string][]) => {
    for (const [c, texto] of cols) {
      const celda = hoja.getCell(fila, c);
      celda.value = texto;
      celda.style = ESTILO_ENCABEZADO_BLOQUE as ExcelJS.Style;
    }
  };
  /** Escribe un valor con borde fino (y numFmt opcional) — usado para TODAS las celdas de dato del bloque. */
  const ponDato = (fila: number, col: number, valor: unknown, numFmt?: string) => {
    const celda = hoja.getCell(fila, col);
    celda.value = (valor as ExcelJS.CellValue) ?? null;
    celda.border = BORDE_FINO as ExcelJS.Borders;
    if (numFmt) celda.numFmt = numFmt;
  };

  let filaBloque = 15;
  for (const { nombre, sigla } of [
    { nombre: 'ASEOCOLBA', sigla: 'ASEO' }, { nombre: 'TEMPOCOLBA', sigla: 'TEMPO' }, { nombre: 'VIGICOLBA', sigla: 'VIGI' },
  ]) {
    const r0 = filaBloque;
    ponTitulo(`A${r0}:D${r0}`, nombre);
    ponTitulo(`F${r0}:H${r0}`, `PROCESOS ADJUDICADOS (${sigla})`);
    ponTitulo(`J${r0}:M${r0}`, `PROCESOS NO ADJUDICADOS (${sigla})`);

    ponEncabezados(r0 + 1, [
      [1, 'DESCRIPCION'], [2, 'PROCESOS PRESENTADOS'], [3, 'VALOR POTENCIAL'], [4, '% PARTICIPACION'],
      [6, 'NOMBRE DE LA ENTIDAD'], [7, 'PRESUPUESTO'], [8, 'CIUDAD'],
      [10, 'NOMBRE DE LA ENTIDAD'], [11, 'PRESUPUESTO'], [12, 'CIUDAD'], [13, 'CAUSAL DE NO ADJUDICACION'],
    ]);

    const filaAdjudicado = r0 + 2;
    const filaNoAdjudicado = r0 + 3;
    ponDato(filaAdjudicado, 1, 'ADJUDICADO');
    ponDato(filaAdjudicado, 2, { formula: conIferror(`COUNTIFS(${rE},"${nombre}",${rI},"ADJUDICADA")`) });
    ponDato(filaAdjudicado, 3, { formula: conIferror(`SUMIFS(${rH},${rE},"${nombre}",${rI},"ADJUDICADA")`) }, FMT_MONEDA);
    // % participación = valor de este subtotal / valor TOTAL de la propia
    // empresa — fórmula autocontenida (SUMIFS por la misma empresa, sin
    // filtro de estado), nunca referencia la fila fija C9/C10/C11: así
    // sigue siendo correcta sin importar dónde termine cayendo este bloque.
    const totalEmpresa = `SUMIFS(${rH},${rE},"${nombre}")`;
    ponDato(filaAdjudicado, 4, { formula: conIferror(`C${filaAdjudicado}/(${totalEmpresa})`) }, FMT_PORCENTAJE);

    ponDato(filaNoAdjudicado, 1, 'NO ADJUDICADO');
    ponDato(filaNoAdjudicado, 2, { formula: conIferror(`COUNTIFS(${rE},"${nombre}",${rI},"NO ADJUDICADA")`) });
    ponDato(filaNoAdjudicado, 3, { formula: conIferror(`SUMIFS(${rH},${rE},"${nombre}",${rI},"NO ADJUDICADA")`) }, FMT_MONEDA);
    ponDato(filaNoAdjudicado, 4, { formula: conIferror(`C${filaNoAdjudicado}/(${totalEmpresa})`) }, FMT_PORCENTAJE);

    const adjudicados = filas.filter(x => x.empresa === nombre && x.estadoPresentacion === 'ADJUDICADA');
    const noAdjudicados = filas.filter(x => x.empresa === nombre && x.estadoPresentacion === 'NO ADJUDICADA');
    adjudicados.forEach((x, i) => {
      const fila = r0 + 2 + i;
      ponDato(fila, 6, x.entidad || null);
      ponDato(fila, 7, x.presupuesto ?? null, FMT_MONEDA);
      ponDato(fila, 8, x.ciudad || null);
    });
    noAdjudicados.forEach((x, i) => {
      const fila = r0 + 2 + i;
      ponDato(fila, 10, x.entidad || null);
      ponDato(fila, 11, x.presupuesto ?? null, FMT_MONEDA);
      ponDato(fila, 12, x.ciudad || null);
      ponDato(fila, 13, x.causalNoAdjudicacion || null);
    });

    const filasDeListado = Math.max(2, adjudicados.length, noAdjudicados.length);
    filaBloque = r0 + 2 + filasDeListado + 1; // +1 = fila en blanco de separación antes del siguiente bloque
  }
}

function escribirTabla(hoja: ExcelJS.Worksheet, filaInicio: number, encabezados: string[], filas: unknown[][]): number {
  const ESTILO_ENCABEZADO: Partial<ExcelJS.Style> = {
    font: { bold: true, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002060' } },
    alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
  };
  const filaEncabezado = hoja.getRow(filaInicio);
  encabezados.forEach((texto, i) => {
    const celda = filaEncabezado.getCell(i + 1);
    celda.value = texto;
    celda.style = ESTILO_ENCABEZADO as ExcelJS.Style;
  });
  filaEncabezado.commit();
  filas.forEach((valores, idx) => {
    const row = hoja.getRow(filaInicio + 1 + idx);
    valores.forEach((v, i) => { row.getCell(i + 1).value = (v as ExcelJS.CellValue) ?? null; });
    row.commit();
  });
  return filaInicio + 1 + filas.length; // siguiente fila libre
}

const EMPRESAS_INFORME = ['ASEOCOLBA', 'VIGICOLBA', 'TEMPOCOLBA'] as const;

/**
 * Crea, para cada empresa, una hoja con dos tablas (Adjudicados / No
 * adjudicados) — y una hoja "Consolidado" con 1 fila por proceso de las 3
 * empresas. Ambas se dimensionan exactamente al número real de procesos
 * (crecen o se reducen solas, sin ningún límite fijo) porque son hojas que
 * se escriben completas en cada generación — nunca se edita una hoja
 * preexistente con contenido de otro período.
 */
function crearHojasPorEmpresaYConsolidado(workbook: ExcelJS.Workbook, filas: FilaBase[]): void {
  for (const empresa of EMPRESAS_INFORME) {
    const nombreHoja = empresa.charAt(0) + empresa.slice(1).toLowerCase();
    const existente = workbook.getWorksheet(nombreHoja);
    if (existente) workbook.removeWorksheet(existente.id);
    const hoja = workbook.addWorksheet(nombreHoja);
    hoja.columns = [{ width: 40 }, { width: 20 }, { width: 20 }, { width: 22 }, { width: 60 }];

    const adjudicados = filas.filter(f => f.empresa === empresa && f.estadoPresentacion === 'ADJUDICADA');
    const noAdjudicados = filas.filter(f => f.empresa === empresa && f.estadoPresentacion === 'NO ADJUDICADA');

    const tituloAdj = hoja.getRow(1);
    tituloAdj.getCell(1).value = 'PROCESOS ADJUDICADOS';
    tituloAdj.getCell(1).font = { bold: true, size: 12 };
    tituloAdj.commit();
    let siguiente = escribirTabla(hoja, 2, ['Entidad', 'Presupuesto', 'Ciudad', 'Plazo de ejecución'],
      adjudicados.map(f => [f.entidad, f.presupuesto, f.ciudad, '']));

    siguiente += 1; // fila en blanco de separación
    const tituloNoAdj = hoja.getRow(siguiente);
    tituloNoAdj.getCell(1).value = 'PROCESOS NO ADJUDICADOS';
    tituloNoAdj.getCell(1).font = { bold: true, size: 12 };
    tituloNoAdj.commit();
    escribirTabla(hoja, siguiente + 1, ['Entidad', 'Presupuesto', 'Ciudad', 'Plazo de ejecución', 'Causal de no adjudicación'],
      noAdjudicados.map(f => [f.entidad, f.presupuesto, f.ciudad, '', f.causalNoAdjudicacion]));
  }

  const nombreConsolidado = 'Consolidado';
  const existenteConsolidado = workbook.getWorksheet(nombreConsolidado);
  if (existenteConsolidado) workbook.removeWorksheet(existenteConsolidado.id);
  const hojaConsolidado = workbook.addWorksheet(nombreConsolidado);
  hojaConsolidado.columns = [{ width: 16 }, { width: 40 }, { width: 22 }, { width: 60 }, { width: 20 }, { width: 16 }, { width: 20 }, { width: 60 }];
  escribirTabla(hojaConsolidado, 1, ['Empresa', 'Entidad', 'No. Proceso', 'Objeto', 'Presupuesto', 'Resultado', 'Ciudad', 'Causal de no adjudicación'],
    filas.map(f => [f.empresa, f.entidad, f.numeroProceso, f.objeto, f.presupuesto, f.estadoPresentacion, f.ciudad, f.estadoPresentacion === 'NO ADJUDICADA' ? f.causalNoAdjudicacion : '']));
}
