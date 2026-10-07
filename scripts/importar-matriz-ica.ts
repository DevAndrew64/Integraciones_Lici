/**
 * Importación ÚNICA (manual, no se ejecuta en cada request) de la matriz de
 * tarifas ICA por empresa/municipio desde el Excel fuente hacia
 * `src/data/costos-estructura/matriz-ica-por-empresa-municipio.json`.
 *
 * Ejecutar con: npx tsx scripts/importar-matriz-ica.ts
 *
 * Ruta del Excel: relativa al repo (nunca una ruta absoluta de Windows) —
 * ver diagnóstico previo para la ubicación y estructura de cada bloque.
 */
import ExcelJS from 'exceljs';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { normalizarMunicipio, type EmpresaIca, type PeriodicidadImpuesto, type TarifaIcaMunicipio } from '../src/lib/costos-estructura/calculo-costos-administrativos';

const RUTA_EXCEL = join(__dirname, '..', 'data', 'importaciones', 'impuestos', '1. MATRIZ ICAS (1).xlsx');
const RUTA_JSON = join(__dirname, '..', 'src', 'data', 'costos-estructura', 'matriz-ica-por-empresa-municipio.json');

interface BloqueEmpresa {
  empresa: EmpresaIca;
  filaInicio: number;
  filaFin: number;
  colMunicipio: number;
  colPeriodicidad: number;
  colDane: number;
  colTarifaIca: number;
  colTarifaAvisos: number;
  colTarifaBomberil: number;
  colObservacion: number;
}

// Rangos y layouts de columnas confirmados por inspección directa del Excel
// (ver diagnóstico A-K entregado antes de esta implementación).
const BLOQUES: BloqueEmpresa[] = [
  { empresa: 'ASEOCOLBA', filaInicio: 15, filaFin: 99, colMunicipio: 3, colPeriodicidad: 4, colDane: 2, colTarifaIca: 5, colTarifaAvisos: 6, colTarifaBomberil: 7, colObservacion: 8 },
  { empresa: 'TEMPOCOLBA', filaInicio: 104, filaFin: 129, colMunicipio: 4, colPeriodicidad: 3, colDane: 2, colTarifaIca: 5, colTarifaAvisos: 6, colTarifaBomberil: 7, colObservacion: 8 },
  { empresa: 'TRANSCOLBA', filaInicio: 133, filaFin: 137, colMunicipio: 4, colPeriodicidad: 3, colDane: 2, colTarifaIca: 5, colTarifaAvisos: 6, colTarifaBomberil: 7, colObservacion: 8 },
  { empresa: 'VIGICOLBA', filaInicio: 141, filaFin: 149, colMunicipio: 4, colPeriodicidad: 3, colDane: 2, colTarifaIca: 5, colTarifaAvisos: 6, colTarifaBomberil: 7, colObservacion: 8 },
];

// Registros marcados como atípicos en el diagnóstico previo — nunca se
// inventa el motivo, se copia tal cual la observación del Excel donde
// exista; en Neiva (sin observación en el Excel) se documenta el motivo
// detectado en el diagnóstico.
const OBSERVACIONES_VALIDACION: Record<string, string> = {
  'TEMPOCOLBA|NEIVA': 'Tarifa ICA de 4% muy por encima del resto de municipios (rango típico 0,3%–1%) — verificar con la aseguradora/contador antes de usar.',
};

function celda(row: ExcelJS.Row, col: number): string | number {
  let v: unknown = row.getCell(col).value;
  if (v && typeof v === 'object' && 'result' in (v as Record<string, unknown>)) {
    v = (v as { result: unknown }).result;
  }
  if (v === null || v === undefined) return '';
  return v as string | number;
}

function normalizarPeriodicidad(valor: string): PeriodicidadImpuesto {
  const limpio = String(valor).trim().toUpperCase();
  if (limpio === 'MENSUAL' || limpio === 'BIMESTRAL' || limpio === 'ANUAL') return limpio;
  throw new Error(`Periodicidad desconocida: "${valor}"`);
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(RUTA_EXCEL);
  const ws = wb.worksheets[0];

  const registros: TarifaIcaMunicipio[] = [];

  for (const bloque of BLOQUES) {
    for (let f = bloque.filaInicio; f <= bloque.filaFin; f++) {
      const row = ws.getRow(f);
      const municipioOriginal = String(celda(row, bloque.colMunicipio) ?? '').trim();
      if (!municipioOriginal) continue;

      const municipioNormalizado = normalizarMunicipio(municipioOriginal);
      const codigoDaneRaw = celda(row, bloque.colDane);
      const codigoDane = codigoDaneRaw === '' ? undefined : String(codigoDaneRaw).trim();
      const periodicidad = normalizarPeriodicidad(String(celda(row, bloque.colPeriodicidad)));
      const tarifaIca = Number(celda(row, bloque.colTarifaIca)) || 0;
      const tarifaAvisos = Number(celda(row, bloque.colTarifaAvisos)) || 0;
      const tarifaBomberil = Number(celda(row, bloque.colTarifaBomberil)) || 0;
      const observacionExcel = String(celda(row, bloque.colObservacion) ?? '').trim();

      const claveValidacion = `${bloque.empresa}|${municipioNormalizado}`;
      const observacionValidacion = OBSERVACIONES_VALIDACION[claveValidacion];
      const observacion = observacionExcel || observacionValidacion || undefined;
      const requiereValidacion = Boolean(observacionExcel || observacionValidacion);

      registros.push({
        id: `${bloque.empresa}-${municipioNormalizado}`,
        empresa: bloque.empresa,
        codigoDane,
        municipio: municipioOriginal,
        municipioNormalizado,
        periodicidad,
        tarifaIca,
        tarifaAvisos,
        tarifaBomberil,
        observacion,
        requiereValidacion: requiereValidacion || undefined,
      });
    }
  }

  const salida = {
    version: 1,
    fuente: 'data/importaciones/impuestos/1. MATRIZ ICAS (1).xlsx',
    generadoEl: new Date().toISOString(),
    registros,
  };

  writeFileSync(RUTA_JSON, JSON.stringify(salida, null, 2) + '\n', 'utf-8');
  console.log(`Generados ${registros.length} registros en ${RUTA_JSON}`);
  for (const bloque of BLOQUES) {
    console.log(`  ${bloque.empresa}: ${registros.filter((r) => r.empresa === bloque.empresa).length}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
