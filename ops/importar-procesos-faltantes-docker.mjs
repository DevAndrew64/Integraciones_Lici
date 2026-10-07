#!/usr/bin/env node
/**
 * Segundo paso del histórico hacia Docker: inserta los Proceso de altaria
 * que NO tienen match por identidad en la base del Docker — típicamente
 * procesos PRIVADOS (nunca vienen del sync de Data API, los crea un usuario
 * manualmente) que quedaron reportados como "sinMatch" al correr
 * importar-historico-solicitudes-docker.mjs.
 *
 * Reutiliza el MISMO paquete .gz ya copiado al contenedor — no hace falta
 * un export nuevo.
 *
 * Para cada Proceso insertado (nuevo id, autoincrement — NUNCA preserva el
 * id de altaria, para no chocar con la secuencia ya en uso), también migra
 * su ProcesoCronogramaSecop/ProcesoDocumentoSecop propios — un proceso
 * privado nunca los va a recibir del sync, a diferencia de los públicos.
 *
 * Después de correr este script, hay que volver a correr
 * importar-historico-solicitudes-docker.mjs — ya es idempotente (reporta
 * YA_EXISTE para lo que ya se migró) y ahora sí va a poder enlazar las
 * Solicitud/Notificacion que antes quedaron "sin match".
 *
 * MODO POR DEFECTO: dry-run (no escribe nada). Requiere --apply explícito.
 *
 * Uso (dry-run, siempre primero):
 *   DATABASE_URL="postgresql://..." node ops/importar-procesos-faltantes-docker.mjs
 *
 * Uso (aplicar — SOLO tras revisar el dry-run):
 *   DATABASE_URL="postgresql://..." node ops/importar-procesos-faltantes-docker.mjs --apply
 */
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const require = createRequire(process.cwd() + '/node_modules/index.js');
const { Pool } = require('pg');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const paqueteIdx = args.indexOf('--paquete');
const rutaPaquete = paqueteIdx >= 0 ? args[paqueteIdx + 1] : 'ops/output/historico-completo-para-docker.json.gz';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Falta DATABASE_URL (la de TU propia base — nunca la de altaria). No se ejecuta nada.');
  process.exit(1);
}
const host = (() => { try { return new URL(DATABASE_URL).host; } catch { return '<no parseable>'; } })();

console.log(`Modo: ${apply ? 'APLICAR (--apply)' : 'DRY-RUN (por defecto — no se escribe nada)'}`);
console.log(`Conectando — host destino: ${host}`);
console.log(`Paquete: ${rutaPaquete}`);

const gz = readFileSync(rutaPaquete);
const hash = createHash('sha256').update(gz).digest('hex');
console.log(`SHA-256 del paquete leído: ${hash}`);
const paquete = JSON.parse(gunzipSync(gz).toString('utf8'));
console.log(`Paquete generado en: ${paquete.generadoEn} (origen: ${paquete.origenHost})`);

function serializarValor(v) {
  if (v !== null && typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

async function insertarConColumnas(client, tabla, fila, columnasOmitir, retornarId) {
  const columnas = Object.keys(fila).filter((c) => !columnasOmitir.includes(c));
  const listaColumnas = columnas.map((c) => `"${c}"`).join(',');
  const placeholders = columnas.map((_, i) => `$${i + 1}`).join(',');
  const valores = columnas.map((c) => serializarValor(fila[c]));
  const sql = `INSERT INTO "${tabla}" (${listaColumnas}) VALUES (${placeholders})${retornarId ? ' RETURNING id' : ''}`;
  const res = await client.query(sql, valores);
  return retornarId ? res.rows[0].id : null;
}

const cacheMatch = new Map();
async function resolverProcesoDestino(client, { sourceKey, externalId, codigoProceso, entidad }) {
  const clave = JSON.stringify([sourceKey ?? null, externalId ?? null, codigoProceso ?? null, entidad ?? null]);
  if (cacheMatch.has(clave)) return cacheMatch.get(clave);
  let id = null;
  if (sourceKey) {
    const r = await client.query('SELECT id FROM "Proceso" WHERE "sourceKey" = $1', [sourceKey]);
    if (r.rows.length) id = r.rows[0].id;
  }
  if (id === null && externalId) {
    const r = await client.query('SELECT id FROM "Proceso" WHERE "externalId" = $1', [externalId]);
    if (r.rows.length) id = r.rows[0].id;
  }
  if (id === null && codigoProceso && entidad) {
    const r = await client.query('SELECT id FROM "Proceso" WHERE "codigoProceso" = $1 AND entidad = $2', [codigoProceso, entidad]);
    if (r.rows.length === 1) id = r.rows[0].id;
  }
  cacheMatch.set(clave, id);
  return id;
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 3, statement_timeout: 180_000 });

(async () => {
  const client = await pool.connect();
  const procesos = paquete.tablas.Proceso ?? [];
  const cronogramaPorProceso = new Map();
  for (const c of paquete.tablas.ProcesoCronogramaSecop ?? []) {
    if (!cronogramaPorProceso.has(c.procesoId)) cronogramaPorProceso.set(c.procesoId, []);
    cronogramaPorProceso.get(c.procesoId).push(c);
  }
  const documentosPorProceso = new Map();
  for (const d of paquete.tablas.ProcesoDocumentoSecop ?? []) {
    if (!documentosPorProceso.has(d.procesoId)) documentosPorProceso.set(d.procesoId, []);
    documentosPorProceso.get(d.procesoId).push(d);
  }

  const resumen = { totalProcesos: procesos.length, yaExiste: 0, insertados: 0, cronogramaInsertado: 0, documentosInsertados: 0, muestraInsertados: [] };

  try {
    await client.query('BEGIN');

    for (const p of procesos) {
      const idExistente = await resolverProcesoDestino(client, { sourceKey: p.sourceKey, externalId: p.externalId, codigoProceso: p.codigoProceso, entidad: p.entidad });
      if (idExistente !== null) { resumen.yaExiste++; continue; }

      if (resumen.muestraInsertados.length < 30) resumen.muestraInsertados.push({ codigoProceso: p.codigoProceso, entidad: p.entidad, sourceKey: p.sourceKey });

      if (!apply) { resumen.insertados++; continue; }

      const nuevoId = await insertarConColumnas(client, 'Proceso', p, ['id'], true);
      // Registrar el match para que llamadas posteriores dentro de esta misma
      // corrida (si el mismo sourceKey se repitiera) no vuelvan a insertar.
      cacheMatch.set(JSON.stringify([p.sourceKey ?? null, p.externalId ?? null, p.codigoProceso ?? null, p.entidad ?? null]), nuevoId);
      resumen.insertados++;

      for (const c of cronogramaPorProceso.get(p.id) ?? []) {
        await insertarConColumnas(client, 'ProcesoCronogramaSecop', { ...c, procesoId: nuevoId }, ['id'], false);
        resumen.cronogramaInsertado++;
      }
      for (const d of documentosPorProceso.get(p.id) ?? []) {
        await insertarConColumnas(client, 'ProcesoDocumentoSecop', { ...d, procesoId: nuevoId }, ['id'], false);
        resumen.documentosInsertados++;
      }
    }

    if (apply) {
      await client.query(`SELECT setval(pg_get_serial_sequence('"Proceso"', 'id'), COALESCE((SELECT MAX(id) FROM "Proceso"), 1))`);
      await client.query(`SELECT setval(pg_get_serial_sequence('"ProcesoCronogramaSecop"', 'id'), COALESCE((SELECT MAX(id) FROM "ProcesoCronogramaSecop"), 1))`);
      await client.query(`SELECT setval(pg_get_serial_sequence('"ProcesoDocumentoSecop"', 'id'), COALESCE((SELECT MAX(id) FROM "ProcesoDocumentoSecop"), 1))`);
      await client.query('COMMIT');
      console.log('\nAPLICADO — transacción confirmada.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDRY-RUN — nada escrito (ROLLBACK explícito).');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nERROR — se hizo ROLLBACK completo, no quedó nada a medias.');
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }

  console.log('\n=== Resumen ===');
  console.table({ Proceso: { total: resumen.totalProcesos, yaExiste: resumen.yaExiste, insertados: resumen.insertados }, ProcesoCronogramaSecop: { insertados: resumen.cronogramaInsertado }, ProcesoDocumentoSecop: { insertados: resumen.documentosInsertados } });
  console.log('\nMuestra de procesos que se insertarían (primeros 30):');
  console.table(resumen.muestraInsertados);

  writeFileSync('ops/output/reporte-importacion-procesos-faltantes-docker.json', JSON.stringify({ modo: apply ? 'APLICAR' : 'DRY_RUN', ejecutadoEn: new Date().toISOString(), hashPaquete: hash, resumen }, null, 1));
  console.log('\nReporte guardado en ops/output/reporte-importacion-procesos-faltantes-docker.json');

  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
