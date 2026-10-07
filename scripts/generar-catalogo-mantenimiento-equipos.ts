// Ajuste "MAQUINARIA Y EQUIPOS — RESOLVEDOR DETERMINÍSTICO DE
// MANTENIMIENTO" — genera el catálogo normalizado, versionado y
// reproducible de tarifas de mantenimiento a partir de los dos Excel
// fuente en data/importaciones/mantenimiento/. NUNCA modifica esos
// archivos (solo lectura) — este script se re-ejecuta manualmente cuando
// se actualicen; el JSON resultante es lo único que consume la app en
// tiempo de ejecución (nunca se leen los .xlsx en producción).
//
// Arquitectura confirmada con datos reales (ver diagnóstico):
//  - MAESTRO (COSTOS MTTO... 31/07/2025) = fuente de verdad de tarifa,
//    37 categorías curadas, sin códigos ni UEN.
//  - HISTÓRICO (PLANTILLA COSTO MES MANTTO) = crosswalk código↔tarifa,
//    410 filas válidas, con Grupo Activo + Sub-Tipo Activo + UEN.
//  - Confirmado: 0 conflictos maestro↔histórico donde son comparables
//    por descripción (13/13 coinciden exactamente); 0 diferencias reales
//    de tarifa entre UEN una vez descontados errores de captura ya
//    identificados — la UEN NO participa en la resolución de
//    mantenimiento (sí en disponibilidad, que es un cruce aparte).
//  - 6 de 49 códigos Grupo+SubTipo son AMBIGUOS (más de una tarifa) —
//    se listan explícitamente en `codigosAmbiguos`, nunca se ocultan ni
//    se resuelven arbitrariamente aquí.
//
// Uso: npx tsx scripts/generar-catalogo-mantenimiento-equipos.ts
import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolverValorCeldaNumericaExcel } from '../src/lib/mantenimiento-equipos/resolver-celda-excel';

const DIR_FUENTE = join(process.cwd(), 'data/importaciones/mantenimiento');
const RUTA_MAESTRO = join(DIR_FUENTE, 'COSTOS MTTO DE EQUIPOS ACT A 31 DE JULIO 2025.xlsx');
const RUTA_HISTORICO = join(DIR_FUENTE, 'PLANTILLA COSTO MES MANTTO.xlsx');
const RUTA_SALIDA = join(process.cwd(), 'src/data/costos-estructura/mantenimiento-equipos.json');

function normalizar(s: string): string {
  return s.toUpperCase()
    .replace(/[ÁÀÂÄ]/g, 'A').replace(/[ÉÈÊË]/g, 'E').replace(/[ÍÌÎÏ]/g, 'I').replace(/[ÓÒÔÖ]/g, 'O').replace(/[ÚÙÛÜ]/g, 'U')
    .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

interface EntradaMaestro { descripcionOriginal: string; descripcionNormalizada: string; valorMensual: number; referenciaId: string; }
interface EntradaHistorico {
  grupoActivo: string; subTipoActivo: string; descripcionOriginal: string; descripcionNormalizada: string;
  valorMensual: number; uen: string; hoja: string; fila: number;
}
interface CodigoAmbiguo { grupoActivo: string; subTipoActivo: string; tarifasDistintas: number[]; descripcionesInvolucradas: string[]; }

async function main() {
  // ── MAESTRO ──────────────────────────────────────────────────────
  const wbMaestro = new ExcelJS.Workbook();
  await wbMaestro.xlsx.readFile(RUTA_MAESTRO);
  const wsMaestro = wbMaestro.worksheets[0];
  const maestro: EntradaMaestro[] = [];
  for (let r = 2; r <= wsMaestro.rowCount; r++) {
    const row = wsMaestro.getRow(r);
    const desc = row.getCell(2).value;
    if (desc == null || String(desc).trim() === '') continue;
    const celda = resolverValorCeldaNumericaExcel(row.getCell(6).value);
    if (!celda.ok) continue;
    const descripcionOriginal = String(desc).trim();
    maestro.push({
      descripcionOriginal, descripcionNormalizada: normalizar(descripcionOriginal),
      valorMensual: Math.round(celda.valor), referenciaId: `maestro-fila-${r}`,
    });
  }

  // ── HISTÓRICO ────────────────────────────────────────────────────
  const wbHist = new ExcelJS.Workbook();
  await wbHist.xlsx.readFile(RUTA_HISTORICO);
  const UEN_POR_HOJA: Record<string, string> = { 'PLANTILLA UEN BAQ': 'BAQ', 'PLANTILLA UEN BOG': 'BOG', 'PLANTILLA UEN MINA': 'MIN' };
  const historico: EntradaHistorico[] = [];
  for (const ws of wbHist.worksheets) {
    const uen = UEN_POR_HOJA[ws.name] ?? ws.name;
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const grupoActivo = row.getCell(8).value;
      if (grupoActivo == null || String(grupoActivo).trim() === '') continue;
      const celda = resolverValorCeldaNumericaExcel(row.getCell(19).value);
      if (!celda.ok) continue; // fila sin tarifa registrada — se omite, nunca se asume 0
      const descripcionOriginal = String(row.getCell(13).value ?? '').trim();
      if (!descripcionOriginal) continue;
      historico.push({
        grupoActivo: String(grupoActivo).trim(),
        subTipoActivo: String(row.getCell(12).value ?? '').trim(),
        descripcionOriginal, descripcionNormalizada: normalizar(descripcionOriginal),
        valorMensual: Math.round(celda.valor), uen, hoja: ws.name, fila: r,
      });
    }
  }

  // ── Detección de códigos ambiguos (Grupo+SubTipo con >1 tarifa) ──
  const porCodigo = new Map<string, EntradaHistorico[]>();
  for (const h of historico) {
    const key = `${h.grupoActivo}|${h.subTipoActivo}`;
    (porCodigo.get(key) ?? porCodigo.set(key, []).get(key)!).push(h);
  }
  const codigosAmbiguos: CodigoAmbiguo[] = [];
  for (const [key, filas] of porCodigo) {
    const valores = new Set(filas.map(f => f.valorMensual));
    if (valores.size > 1) {
      const [grupoActivo, subTipoActivo] = key.split('|');
      codigosAmbiguos.push({
        grupoActivo, subTipoActivo, tarifasDistintas: [...valores],
        descripcionesInvolucradas: [...new Set(filas.map(f => f.descripcionOriginal))],
      });
    }
  }

  // ── Validación cruzada maestro↔histórico (nunca oculta conflictos) ──
  const maestroPorDesc = new Map(maestro.map(m => [m.descripcionNormalizada, m.valorMensual]));
  const conflictosMaestroHistorico: { descripcion: string; valorMaestro: number; valorHistorico: number }[] = [];
  const yaValidadas = new Set<string>();
  for (const h of historico) {
    if (yaValidadas.has(h.descripcionNormalizada)) continue;
    yaValidadas.add(h.descripcionNormalizada);
    const vMaestro = maestroPorDesc.get(h.descripcionNormalizada);
    if (vMaestro == null) continue;
    if (vMaestro !== h.valorMensual) {
      conflictosMaestroHistorico.push({ descripcion: h.descripcionNormalizada, valorMaestro: vMaestro, valorHistorico: h.valorMensual });
    }
  }

  const catalogo = {
    version: 1,
    generadoEn: new Date().toISOString(),
    fuente: {
      maestro: 'data/importaciones/mantenimiento/COSTOS MTTO DE EQUIPOS ACT A 31 DE JULIO 2025.xlsx',
      historico: 'data/importaciones/mantenimiento/PLANTILLA COSTO MES MANTTO.xlsx',
    },
    // Confirmado con datos reales: la UEN NO afecta la tarifa de
    // mantenimiento (0 diferencias reales tras descontar errores de
    // captura ya documentados en codigosAmbiguos) — se conserva en cada
    // fila de `historico` solo para trazabilidad/auditoría, nunca se usa
    // para filtrar en la resolución.
    notaUen: 'UEN no participa en la resolución de tarifa de mantenimiento (validado con datos reales) — se conserva solo para trazabilidad.',
    maestro,
    historico,
    codigosAmbiguos,
    conflictosMaestroHistorico,
  };

  writeFileSync(RUTA_SALIDA, JSON.stringify(catalogo, null, 2) + '\n', 'utf-8');
  console.log(`Catálogo generado: ${RUTA_SALIDA}`);
  console.log(`  maestro: ${maestro.length} categorías`);
  console.log(`  histórico: ${historico.length} filas válidas`);
  console.log(`  códigos ambiguos: ${codigosAmbiguos.length}`);
  console.log(`  conflictos maestro↔histórico: ${conflictosMaestroHistorico.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
