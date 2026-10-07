/**
 * Ajuste "CORREGIR CÓDIGO, CANTIDAD A COMPRAR Y VINCULACIÓN DE
 * MANTENIMIENTO EN MAQUINARIA Y EQUIPOS" §3/§4/§5 — catálogo REAL de
 * mantenimiento (dos fuentes en `data/importaciones/mantenimiento/`,
 * NUNCA `TarifaMantenimientoEquipo` de Prisma, que sigue pausada y
 * ligada a contrato/sitio, no a un valor "oficial" por tipo de equipo):
 *
 *  1. Fuente principal — "COSTOS MTTO DE EQUIPOS ACT A 31 DE JULIO
 *     2025.xlsx": catálogo curado de ~37 tipos de equipo, un valor
 *     mensual por tipo (columna "valor mes" = VALOR PROMEDIO MES ÷
 *     FRECUENCIA, ya resuelto por Excel).
 *  2. Fuente secundaria — "PLANTILLA COSTO MES MANTTO.xlsx": asignaciones
 *     históricas reales por contrato (múltiples hojas, una por UEN);
 *     ~130 descripciones distintas de equipo, cada una con su
 *     "Vlr. Mes Mantenimiento" — se usa como respaldo SOLO cuando todas
 *     las apariciones de una misma descripción normalizada coinciden en
 *     el mismo valor (si hay conflicto, NUNCA se elige una arbitrariamente
 *     — se descarta esa descripción por completo).
 *
 * Las funciones de construcción de catálogo y de resolución de
 * coincidencia son PURAS (reciben filas ya extraídas, nunca leen Excel
 * directamente) — la lectura real del archivo vive en
 * `resolverMantenimientoSugerido` (I/O, no se prueba con datos sintéticos,
 * solo la lógica pura de las funciones `construir*`/`resolverMantenimientoSugeridoDesdeCatalogos`).
 */

import ExcelJS from 'exceljs';
import { join } from 'node:path';

/**
 * Resolución de celda numérica propia (no se reutiliza
 * `resolverValorCeldaNumericaExcel` de mantenimiento-equipos porque esa
 * solo reconoce `{formula,result}` — el Excel real de este catálogo usa
 * "fórmulas compartidas" de ExcelJS, donde las celdas que SIGUEN a la
 * fórmula original llegan como `{result,sharedFormula}`, SIN la clave
 * `formula`). Nunca evalúa la fórmula — solo lee `result`, el valor YA
 * calculado que Excel dejó cacheado.
 */
function extraerValorNumericoCelda(cellValue: unknown): number | null {
  if (typeof cellValue === 'number') return isNaN(cellValue) ? null : cellValue;
  if (typeof cellValue === 'string') {
    const n = Number(cellValue.trim());
    return isNaN(n) ? null : n;
  }
  if (typeof cellValue === 'object' && cellValue !== null && 'result' in cellValue) {
    const result = (cellValue as { result?: unknown }).result;
    return typeof result === 'number' && !isNaN(result) ? result : null;
  }
  return null;
}

export type OrigenMantenimiento = 'CATALOGO_MTTO_2025' | 'PLANTILLA_HISTORICA' | 'MANUAL' | 'SIN_COINCIDENCIA';

export interface SugerenciaMantenimiento {
  valor: number;
  origen: 'CATALOGO_MTTO_2025' | 'PLANTILLA_HISTORICA';
  referenciaId: string;
}

/**
 * Normalización controlada (§4): mayúsculas, corrige la codificación
 * `Ð→Ñ` vista en el Excel real, quita tildes de vocales (conserva Ñ),
 * quita comillas/marcas de pulgadas, colapsa cualquier otro signo a
 * espacio y colapsa espacios múltiples. Nunca quita números — algunos
 * equipos (ej. motobombas por pulgadas) se distinguen SOLO por el
 * número, y quitarlo produciría coincidencias falsas.
 */
export function normalizarDescripcionEquipoMtto(s: string): string {
  const sinTildes = s
    .toUpperCase()
    .replace(/Ð/g, 'Ñ')
    .replace(/[ÁÀÂÄ]/g, 'A')
    .replace(/[ÉÈÊË]/g, 'E')
    .replace(/[ÍÌÎÏ]/g, 'I')
    .replace(/[ÓÒÔÖ]/g, 'O')
    .replace(/[ÚÙÛÜ]/g, 'U');
  return sinTildes
    .replace(/[^\w\sÑ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface EntradaCatalogoPrimario {
  descripcionNormalizada: string;
  valor: number;
  referenciaId: string;
}

export interface FilaCatalogoPrimarioCrudo {
  descripcion: unknown;
  valorMesCelda: unknown;
  fila: number;
}

/** Construye el catálogo principal (2025) a partir de filas ya extraídas del Excel — nunca lee el archivo. */
export function construirCatalogoPrimarioMantenimiento(filas: FilaCatalogoPrimarioCrudo[]): EntradaCatalogoPrimario[] {
  const entradas: EntradaCatalogoPrimario[] = [];
  for (const f of filas) {
    if (f.descripcion == null || String(f.descripcion).trim() === '') continue;
    const valor = extraerValorNumericoCelda(f.valorMesCelda);
    if (valor == null) continue;
    entradas.push({
      descripcionNormalizada: normalizarDescripcionEquipoMtto(String(f.descripcion)),
      valor: Math.round(valor),
      referenciaId: `catalogo-2025-fila-${f.fila}`,
    });
  }
  return entradas;
}

export interface FilaHistoricaCrudo {
  descripcion: unknown;
  valorMantenimientoCelda: unknown;
}

/**
 * Construye el respaldo histórico: por descripción normalizada, el
 * valor SOLO si todas las apariciones coinciden — de lo contrario
 * `null` (descartado, nunca se inventa cuál es la correcta).
 */
export function construirCatalogoHistoricoMantenimiento(filas: FilaHistoricaCrudo[]): Map<string, number | null> {
  const porDescripcion = new Map<string, Set<number>>();
  for (const f of filas) {
    if (f.descripcion == null || String(f.descripcion).trim() === '') continue;
    const valor = extraerValorNumericoCelda(f.valorMantenimientoCelda);
    if (valor == null) continue;
    const key = normalizarDescripcionEquipoMtto(String(f.descripcion));
    const set = porDescripcion.get(key) ?? new Set<number>();
    set.add(Math.round(valor));
    porDescripcion.set(key, set);
  }
  const resultado = new Map<string, number | null>();
  for (const [key, valores] of porDescripcion) {
    resultado.set(key, valores.size === 1 ? [...valores][0] : null);
  }
  return resultado;
}

/**
 * Resolución de coincidencia (§3/§4), pura — recibe los catálogos ya
 * construidos. Jerarquía:
 *  1. Coincidencia exacta en el catálogo principal (2025).
 *  2. Contención bidireccional ÚNICA en el catálogo principal (ej.
 *     "BRILLADORA INDUSTRIAL 175 RPM 17" contiene "BRILLADORA
 *     INDUSTRIAL") — si más de una entrada distinta calificara con
 *     valores distintos, se considera ambigua y se descarta (nunca se
 *     elige arbitrariamente).
 *  3. Coincidencia exacta en el histórico (solo si es consistente).
 *  4. Sin coincidencia → null (nunca se inventa un valor).
 */
export function resolverMantenimientoSugeridoDesdeCatalogos(
  descripcionEquipo: string,
  catalogoPrimario: EntradaCatalogoPrimario[],
  catalogoHistorico: Map<string, number | null>,
): SugerenciaMantenimiento | null {
  const objetivo = normalizarDescripcionEquipoMtto(descripcionEquipo);
  if (!objetivo) return null;

  const exacto = catalogoPrimario.find(e => e.descripcionNormalizada === objetivo);
  if (exacto) return { valor: exacto.valor, origen: 'CATALOGO_MTTO_2025', referenciaId: exacto.referenciaId };

  const coincidencias = catalogoPrimario.filter(e =>
    objetivo.includes(e.descripcionNormalizada) || e.descripcionNormalizada.includes(objetivo),
  );
  const valoresDistintos = new Set(coincidencias.map(c => c.valor));
  if (coincidencias.length > 0 && valoresDistintos.size === 1) {
    return { valor: coincidencias[0].valor, origen: 'CATALOGO_MTTO_2025', referenciaId: coincidencias[0].referenciaId };
  }

  const valorHistorico = catalogoHistorico.get(objetivo);
  if (typeof valorHistorico === 'number') {
    return { valor: valorHistorico, origen: 'PLANTILLA_HISTORICA', referenciaId: `historico-${objetivo}` };
  }

  return null;
}

// ── Lectura real de los dos archivos — I/O, cacheado en memoria por
// proceso (los archivos son estáticos en `data/`, sin TTL: se recargan
// solo si se reinicia el servidor). ──────────────────────────────────
const RUTA_CATALOGO_2025 = join(process.cwd(), 'data/importaciones/mantenimiento/COSTOS MTTO DE EQUIPOS ACT A 31 DE JULIO 2025.xlsx');
const RUTA_PLANTILLA_HISTORICA = join(process.cwd(), 'data/importaciones/mantenimiento/PLANTILLA COSTO MES MANTTO.xlsx');

let cachePrimario: EntradaCatalogoPrimario[] | null = null;
let cacheHistorico: Map<string, number | null> | null = null;
let cargaEnCurso: Promise<void> | null = null;

async function cargarCatalogosMantenimiento(): Promise<void> {
  if (cachePrimario && cacheHistorico) return;
  if (cargaEnCurso) return cargaEnCurso;
  cargaEnCurso = (async () => {
    const wbPrimario = new ExcelJS.Workbook();
    await wbPrimario.xlsx.readFile(RUTA_CATALOGO_2025);
    const wsPrimario = wbPrimario.worksheets[0];
    const filasPrimario: FilaCatalogoPrimarioCrudo[] = [];
    for (let r = 2; r <= wsPrimario.rowCount; r++) {
      const row = wsPrimario.getRow(r);
      filasPrimario.push({ descripcion: row.getCell(2).value, valorMesCelda: row.getCell(6).value, fila: r });
    }
    cachePrimario = construirCatalogoPrimarioMantenimiento(filasPrimario);

    const wbHistorico = new ExcelJS.Workbook();
    await wbHistorico.xlsx.readFile(RUTA_PLANTILLA_HISTORICA);
    const filasHistorico: FilaHistoricaCrudo[] = [];
    wbHistorico.eachSheet(ws => {
      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        filasHistorico.push({ descripcion: row.getCell(13).value, valorMantenimientoCelda: row.getCell(19).value });
      }
    });
    cacheHistorico = construirCatalogoHistoricoMantenimiento(filasHistorico);
  })();
  return cargaEnCurso;
}

export async function resolverMantenimientoSugerido(descripcionEquipo: string): Promise<SugerenciaMantenimiento | null> {
  await cargarCatalogosMantenimiento();
  return resolverMantenimientoSugeridoDesdeCatalogos(descripcionEquipo, cachePrimario!, cacheHistorico!);
}

/** Solo para pruebas — nunca se llama en producción. */
export function limpiarCacheCatalogoMantenimiento() {
  cachePrimario = null;
  cacheHistorico = null;
  cargaEnCurso = null;
}
