// Ajuste "DIAGNOSTICAR E IMPORTAR LA BASE DE TARIFAS DE MANTENIMIENTO DE
// EQUIPOS" — importador controlado del Excel "PLANTILLA COSTO MES
// MANTTO.xlsx" hacia TarifaMantenimientoEquipo/ImportacionTarifasMantenimiento.
//
// Llave de negocio DEFINITIVA (confirmada con el usuario tras verificar en
// vivo que "Cons. Tarifa" NO es un consecutivo por línea de equipo — es
// fijo por contrato/sitio, todas las líneas de un mismo sitio comparten el
// mismo valor):
//   empresaPrestadora + uen + contrato + puntoEntrega + consecutivoTarifa
//   + subtipoActivo
// `fuenteFila`/`hashFila` son SOLO trazabilidad técnica — nunca parte de
// la llave de negocio ni desempate silencioso (la fila puede cambiar de
// posición en una nueva versión del Excel).
//
// Regla de conflicto (nunca elige arbitrariamente): si dos o más filas
// comparten la llave de negocio completa, es una ANOMALÍA REAL del Excel
// origen (confirmado un caso: el mismo código de subtipo identifica dos
// equipos distintos en el mismo contrato+sitio+consecutivo) — el
// importador RECHAZA TODAS las filas de ese grupo, nunca elige una ni
// las combina. Se corrige reimportando después de arreglar el Excel.
//
// --dry-run (implementado en esta entrega): lee el Excel, normaliza,
// calcula hashArchivo/hashFila, detecta y RECHAZA grupos con conflicto de
// llave, y agrupa por grupo/tipo/subtipo/descripción para mostrar dónde
// hay varios valores distintos entre CONTRATOS (informativo — eso es
// esperado y válido, nunca se resuelve). NO escribe en la base de datos —
// no importa Prisma Client en absoluto en esta fase, precisamente porque
// el modelo todavía no existe en el schema/DB (solo se presenta como
// propuesta).
//
// --apply: NO implementado todavía (deliberadamente) — requiere que el
// modelo Prisma esté aprobado, migrado, y una revisión explícita de este
// mismo reporte dry-run. Llamarlo hoy termina el proceso con un error
// controlado, nunca escribe nada.
//
// Uso:
//   npx tsx scripts/importar-tarifas-mantenimiento.ts --file "<ruta.xlsx>" --dry-run
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { resolverValorCeldaNumericaExcel } from '../src/lib/mantenimiento-equipos/resolver-celda-excel';
import { construirLlaveNegocio, resolverConflictosLlave, agruparVariacionesEntreContratos } from '../src/lib/mantenimiento-equipos/normalizar-tarifas';

interface FilaTarifa {
  empresaPrestadora: string;
  uen: string;
  clienteRazonSocial: string;
  contrato: string;
  consecutivoTarifa: number;
  codigoTarifa: string | null;
  puntoEntrega: string;
  codigoMunicipio: string | null;
  nombreCiudad: string | null;
  grupoActivo: string;
  descripcionGrupoActivo: string | null;
  tipoActivo: string;
  descripcionTipoActivo: string | null;
  subtipoActivo: string;
  descripcionEquipo: string;
  cantidadAsignada: number | null;
  frecuencia: number | null;
  valorUnitarioAsignado: number | null;
  valorMesAsignado: number | null;
  cantidadFacturar: number | null;
  valorMesMantenimiento: number;
  formulaValorMantenimiento: string | null;
  valorMesOtrosRubros: number | null;
  fuenteArchivo: string;
  fuenteHoja: string;
  fuenteFila: number;
  hashFila: string;
  llaveNegocio: string;
}

// Fila 3 en BAQ (título + fila en blanco); fila 2 en BOG/MINA (solo título)
// — confirmado por inspección directa del archivo (ETAPA 1), nunca
// asumido por posición fija para todas las hojas.
const FILA_ENCABEZADO_POR_HOJA: Record<string, number> = {
  'PLANTILLA UEN BAQ': 3,
  'PLANTILLA UEN BOG': 2,
  'PLANTILLA UEN MINA': 2,
};

function uenDesdeNombreHoja(nombreHoja: string): string {
  const m = nombreHoja.match(/UEN\s+(\w+)/i);
  return m ? m[1].toUpperCase() : nombreHoja;
}

function textoOVacio(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function textoONulo(v: unknown): string | null {
  const t = textoOVacio(v);
  return t === '' ? null : t;
}

function numeroONulo(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf-8').digest('hex');
}

interface ResultadoLectura {
  filas: FilaTarifa[];
  rechazados: { hoja: string; fila: number; motivo: string }[];
  hashArchivo: string;
}

async function leerYNormalizar(rutaArchivo: string): Promise<ResultadoLectura> {
  const buffer = readFileSync(rutaArchivo);
  const hashArchivo = sha256(buffer.toString('base64'));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const filas: FilaTarifa[] = [];
  const rechazados: { hoja: string; fila: number; motivo: string }[] = [];

  for (const worksheet of workbook.worksheets) {
    const filaEncabezado = FILA_ENCABEZADO_POR_HOJA[worksheet.name];
    if (!filaEncabezado) {
      rechazados.push({ hoja: worksheet.name, fila: 0, motivo: 'Hoja no reconocida — no está en FILA_ENCABEZADO_POR_HOJA (revisar manualmente antes de --apply).' });
      continue;
    }
    const uen = uenDesdeNombreHoja(worksheet.name);
    const encabezados = new Map<string, number>();
    worksheet.getRow(filaEncabezado).eachCell((celda, colNumero) => {
      const nombre = textoOVacio(celda.value);
      if (nombre) encabezados.set(nombre, colNumero);
    });
    const col = (nombre: string) => encabezados.get(nombre);
    const get = (row: ExcelJS.Row, nombre: string) => {
      const c = col(nombre);
      return c ? row.getCell(c).value : undefined;
    };

    worksheet.eachRow((row, filaNum) => {
      if (filaNum <= filaEncabezado) return;
      const descripcionEquipo = textoOVacio(get(row, 'Descripción del Equipo o Máquina'));
      if (!descripcionEquipo) return; // fila vacía real (no confirmado ningún caso en el diagnóstico, pero se protege igual)

      const contrato = textoOVacio(get(row, 'Contrato'));
      const puntoEntrega = textoOVacio(get(row, 'Punto Entrega'));
      const consecutivoTarifaRaw = numeroONulo(get(row, 'Cons. Tarifa'));
      const grupoActivo = textoOVacio(get(row, 'Grupo Activo'));
      const tipoActivo = textoOVacio(get(row, 'Tipo Activo'));
      const subtipoActivo = textoOVacio(get(row, 'Sub-Tipo Activo'));
      // Ajuste "CORREGIR CELDAS CON FÓRMULA" — Vlr. Mes Mantenimiento puede
      // llegar como número plano O como {formula,result} (confirmado en
      // vivo, filas BAQ 125/218/231/235). Nunca tratarlo con Number()
      // directo (da NaN sobre el objeto y la fila se rechazaba
      // incorrectamente como "vacía"); nunca evalúa el texto de la
      // fórmula, solo lee `result`.
      const celdaValorMtto = resolverValorCeldaNumericaExcel(get(row, 'Vlr. Mes Mantenimiento'));

      const faltantes: string[] = [];
      if (!contrato) faltantes.push('Contrato');
      if (!puntoEntrega) faltantes.push('Punto Entrega');
      if (consecutivoTarifaRaw === null) faltantes.push('Cons. Tarifa');
      if (!grupoActivo) faltantes.push('Grupo Activo');
      if (!tipoActivo) faltantes.push('Tipo Activo');
      if (!subtipoActivo) faltantes.push('Sub-Tipo Activo');
      if (!celdaValorMtto.ok) {
        if (celdaValorMtto.vacio) faltantes.push('Vlr. Mes Mantenimiento');
        else { rechazados.push({ hoja: worksheet.name, fila: filaNum, motivo: `Vlr. Mes Mantenimiento inválido: ${celdaValorMtto.motivo}` }); return; }
      }
      if (faltantes.length > 0) {
        rechazados.push({ hoja: worksheet.name, fila: filaNum, motivo: `Campos obligatorios ausentes: ${faltantes.join(', ')}` });
        return;
      }
      const valorMesMantenimiento = celdaValorMtto.ok ? celdaValorMtto.valor : null;
      const formulaValorMantenimiento = celdaValorMtto.ok ? (celdaValorMtto.formula ?? null) : null;

      const empresaPrestadora = 'ASEOCOLBA';
      const llaveNegocio = construirLlaveNegocio({ empresaPrestadora, uen, contrato, puntoEntrega, consecutivoTarifa: consecutivoTarifaRaw as number, subtipoActivo });
      const camposHash = [
        empresaPrestadora, uen, contrato, puntoEntrega, consecutivoTarifaRaw,
        textoONulo(get(row, 'Cód. Tarifa.')), textoOVacio(get(row, 'Razón Social')),
        textoONulo(get(row, 'Ciudad')), textoONulo(get(row, 'Nombre Ciudad')),
        grupoActivo, textoONulo(get(row, 'Descripción Grupo Activo')),
        tipoActivo, textoONulo(get(row, 'Descripción Tipo Activo')),
        subtipoActivo, descripcionEquipo,
        numeroONulo(get(row, 'Cant. Asig-nada')), numeroONulo(get(row, 'Frecuencia')),
        numeroONulo(get(row, 'Valor Unitario Asignado')), numeroONulo(get(row, 'Valor Mes Asignado')),
        numeroONulo(get(row, 'Cant. Facturar')), valorMesMantenimiento,
        numeroONulo(get(row, 'Vlr. Mes Otros Rubros')),
      ].join('|');

      filas.push({
        empresaPrestadora, uen,
        clienteRazonSocial: textoOVacio(get(row, 'Razón Social')),
        contrato, consecutivoTarifa: consecutivoTarifaRaw as number,
        codigoTarifa: textoONulo(get(row, 'Cód. Tarifa.')),
        puntoEntrega,
        codigoMunicipio: textoONulo(get(row, 'Ciudad')),
        nombreCiudad: textoONulo(get(row, 'Nombre Ciudad')),
        grupoActivo, descripcionGrupoActivo: textoONulo(get(row, 'Descripción Grupo Activo')),
        tipoActivo, descripcionTipoActivo: textoONulo(get(row, 'Descripción Tipo Activo')),
        subtipoActivo, descripcionEquipo,
        cantidadAsignada: numeroONulo(get(row, 'Cant. Asig-nada')),
        frecuencia: numeroONulo(get(row, 'Frecuencia')),
        valorUnitarioAsignado: numeroONulo(get(row, 'Valor Unitario Asignado')),
        valorMesAsignado: numeroONulo(get(row, 'Valor Mes Asignado')),
        cantidadFacturar: numeroONulo(get(row, 'Cant. Facturar')),
        valorMesMantenimiento: valorMesMantenimiento as number,
        formulaValorMantenimiento,
        valorMesOtrosRubros: numeroONulo(get(row, 'Vlr. Mes Otros Rubros')),
        // Solo el nombre base — nunca la ruta completa (puede contener la
        // ruta local de OneDrive del usuario que ejecuta la importación).
        fuenteArchivo: basename(rutaArchivo), fuenteHoja: worksheet.name, fuenteFila: filaNum,
        hashFila: sha256(camposHash),
        llaveNegocio,
      });
    });
  }

  // Regla de conflicto de llave (confirmada con el usuario) — nunca elige
  // una fila del grupo ni las combina: si la llave de negocio completa se
  // repite, TODO el grupo se rechaza (es una anomalía real del Excel
  // origen, no un caso normal de "varios contratos, mismo equipo").
  const { aceptadas: filasAceptadas, rechazadas: rechazadasPorConflicto } = resolverConflictosLlave(filas);
  rechazados.push(...rechazadasPorConflicto);

  return { filas: filasAceptadas, rechazados, hashArchivo };
}

function reportarDryRun(resultado: ResultadoLectura) {
  const { filas, rechazados, hashArchivo } = resultado;
  console.log('\n=== REPORTE DRY-RUN — importar-tarifas-mantenimiento ===\n');
  console.log(`hashArchivo (sha256, base64 del contenido): ${hashArchivo}`);
  // Ajuste "corregir la redacción del reporte" — "leídas" ya no se
  // confundía con "aceptadas" en los datos (siempre fueron correctos:
  // 414 leídas = 412 aceptadas + 2 rechazadas), pero el texto anterior
  // ("Filas leídas (válidas)") mezclaba ambos conceptos en una sola
  // etiqueta. Ahora se muestran los tres conteos, explícitos y separados.
  const totalLeidas = filas.length + rechazados.length;
  console.log(`Total de filas leídas del Excel: ${totalLeidas}`);
  console.log(`  - Aceptadas (pasan todas las validaciones): ${filas.length}`);
  console.log(`  - Rechazadas: ${rechazados.length}`);
  if (rechazados.length) {
    console.log('  Detalle de rechazados:');
    for (const r of rechazados) console.log(`   - [${r.hoja} fila ${r.fila}] ${r.motivo}`);
  }

  const porHoja = new Map<string, number>();
  for (const f of filas) porHoja.set(f.fuenteHoja, (porHoja.get(f.fuenteHoja) ?? 0) + 1);
  console.log('\nFilas por hoja:');
  for (const [hoja, n] of porHoja) console.log(`   - ${hoja}: ${n}`);

  // Los grupos en conflicto de llave ya fueron RECHAZADOS por completo en
  // leerYNormalizar (ver arriba, listados en "Detalle de rechazados") —
  // por construcción, `filas` (aceptadas) nunca repite una llave de
  // negocio. Esta verificación es solo una guardia de integridad.
  const porLlave = new Map<string, FilaTarifa[]>();
  for (const f of filas) {
    const arr = porLlave.get(f.llaveNegocio) ?? [];
    arr.push(f);
    porLlave.set(f.llaveNegocio, arr);
  }
  const conflictosLlave = [...porLlave.entries()].filter(([, arr]) => arr.length > 1);
  console.log(`\nConflictos de llave de negocio remanentes entre las filas ACEPTADAS (debe ser siempre 0 — los grupos en conflicto se rechazan por completo arriba): ${conflictosLlave.length}`);

  // Duplicados EXACTOS por hashFila (misma fila, byte a byte) — indican
  // filas repetidas dentro del propio Excel, no solo conflicto de llave.
  const porHash = new Map<string, FilaTarifa[]>();
  for (const f of filas) {
    const arr = porHash.get(f.hashFila) ?? [];
    arr.push(f);
    porHash.set(f.hashFila, arr);
  }
  const duplicadosExactos = [...porHash.entries()].filter(([, arr]) => arr.length > 1);
  console.log(`\nDuplicados exactos (misma fila repetida, hashFila idéntico): ${duplicadosExactos.length}`);

  // Ajuste "CORREGIR REPORTE DE VARIACIONES ENTRE CONTRATOS" — agrupar
  // SOLO por empresaPrestadora+uen+grupoActivo+tipoActivo+subtipoActivo
  // (nunca por contrato/puntoEntrega/descripción libre, que separan cada
  // fila por definición y ocultaban la variación real). Puramente
  // informativo: nunca fusiona, nunca elige máximo/mínimo/promedio,
  // nunca rechaza — tarifas distintas de contratos distintos son válidas.
  const conVariosValores = agruparVariacionesEntreContratos(filas);
  console.log(`\nGrupos de equipo (empresaPrestadora+UEN+grupo+tipo+subtipo) con MÁS DE UN valor de mantenimiento distinto entre contratos: ${conVariosValores.length}`);
  console.log('  (informativo — nunca se fusiona ni se elige un valor; cada contrato conserva su propia tarifa, ver ETAPA 8)');
  for (const g of conVariosValores) {
    console.log(`   - ${g.clave} — ${g.filas.length} contratos, ${g.valoresDistintos.size} valores distintos:`);
    for (const f of g.filas) {
      console.log(`       · cliente="${f.clienteRazonSocial}" contrato=${f.contrato} punto=${f.puntoEntrega} descripción="${f.descripcionEquipo}" valor=${f.valorMesMantenimiento.toLocaleString('es-CO')}`);
    }
  }

  console.log(`\nRegistros que se insertarían (--apply, sin ejecutar todavía): ${filas.length}`);
  console.log('Registros que se actualizarían: 0 (no existe ningún registro previo — el modelo aún no está migrado en la base de datos).');
  console.log('\n=== FIN DEL REPORTE — no se escribió nada en la base de datos ===\n');
}

async function main() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  const rutaArchivo = fileIdx >= 0 ? args[fileIdx + 1] : undefined;
  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');

  if (!rutaArchivo) {
    console.error('Uso: npx tsx scripts/importar-tarifas-mantenimiento.ts --file "<ruta.xlsx>" --dry-run');
    process.exit(1);
  }
  if (apply) {
    console.error('--apply no está implementado todavía (deliberadamente): requiere el modelo Prisma migrado y aprobación explícita del reporte dry-run. Ejecuta primero --dry-run.');
    process.exit(1);
  }
  if (!dryRun) {
    console.error('Debes indicar --dry-run (el único modo disponible en esta entrega).');
    process.exit(1);
  }

  const resultado = await leerYNormalizar(rutaArchivo);
  reportarDryRun(resultado);
}

main().catch(e => { console.error(e); process.exit(1); });
