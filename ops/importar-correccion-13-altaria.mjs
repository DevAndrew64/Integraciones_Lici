#!/usr/bin/env node
/**
 * Importador de CORRECCIÓN (no migración) para los 13 casos categoría C
 * identificados en la auditoría de ubicación funcional: Solicitudes que YA
 * existen en altaria pero con `estadoSolicitud`/`asignaciones` desactualizados
 * respecto a licycolba (fuente autoritativa).
 *
 * GARANTÍA ESTRUCTURAL: este archivo NO contiene ningún
 * `INSERT INTO "Solicitud"` ni `INSERT INTO "Proceso"` ni
 * `UPDATE "Proceso"` en ningún punto — la única sentencia de escritura es
 * un `UPDATE "Solicitud" SET "estadoSolicitud"=..., asignaciones=...`
 * acotado por `WHERE id = $1`, sobre una Solicitud cuya identidad se
 * revalida en vivo antes de escribir.
 *
 * MODO POR DEFECTO: dry-run (no escribe nada). Requiere `--apply` explícito.
 */
import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const { Pool } = pg;

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const paqueteIdx = args.indexOf('--paquete');
const rutaPaquete = paqueteIdx >= 0 ? args[paqueteIdx + 1] : 'ops/output/paquete-correccion-13-altaria.json.gz';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Falta DATABASE_URL. No se ejecuta nada.');
  process.exit(1);
}
const hostSeguro = (() => { try { return new URL(DATABASE_URL).host; } catch { return '<no parseable>'; } })();
console.log(`Modo: ${apply ? 'APLICAR (--apply)' : 'DRY-RUN (por defecto — no se escribe nada)'}`);
console.log(`Conectando — host: ${hostSeguro} (nunca se imprime usuario/password)`);
console.log(`Paquete: ${rutaPaquete}`);

const gz = readFileSync(rutaPaquete);
const hashGz = createHash('sha256').update(gz).digest('hex');
console.log(`SHA-256 del paquete leído: ${hashGz}`);
const paquete = JSON.parse(gunzipSync(gz).toString('utf8'));
console.log(`Casos en el paquete: ${paquete.casos.length}`);

const pool = new Pool({ connectionString: DATABASE_URL, max: 3, statement_timeout: 60_000 });

const reporte = [];
let insertSolicitud = 0, insertProceso = 0, updateProceso = 0, updateSolicitud = 0;

for (const caso of paquete.casos) {
  const fila = {
    solicitudLicycolbaId: caso.solicitudLicycolbaId,
    solicitudAltariaId: caso.solicitudAltariaId,
    accion: null,
    resultado: null,
    detalle: '',
  };

  if (caso.resultado === 'BLOQUEADO') {
    fila.accion = 'ABORTAR'; fila.resultado = 'BLOQUEADO_EN_PAQUETE'; fila.detalle = caso.motivo ?? 'bloqueado al construir el paquete';
    reporte.push(fila); continue;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Revalidación EN VIVO: la Solicitud debe existir, seguir enlazada al
    // MISMO Proceso registrado en el paquete, y su codigoProceso/entidad no
    // deben haber cambiado — cualquier drift aborta el caso, nunca se
    // adivina ni se fuerza.
    const actual = await client.query(
      'SELECT id, "procesoId", "codigoProceso", entidad, "estadoSolicitud" FROM "Solicitud" WHERE id = $1',
      [caso.solicitudAltariaId],
    );
    if (actual.rows.length === 0) {
      await client.query('ROLLBACK');
      fila.accion = 'ABORTAR'; fila.resultado = 'SOLICITUD_YA_NO_EXISTE';
      fila.detalle = `Solicitud.id=${caso.solicitudAltariaId} ya no existe en el destino.`;
      reporte.push(fila); continue;
    }
    const solActual = actual.rows[0];

    if (solActual.procesoId !== caso.procesoAltariaId) {
      await client.query('ROLLBACK');
      fila.accion = 'ABORTAR'; fila.resultado = 'IDENTIDAD_CAMBIO';
      fila.detalle = `procesoId real (${solActual.procesoId}) ya no coincide con el registrado en el paquete (${caso.procesoAltariaId}).`;
      reporte.push(fila); continue;
    }
    if (solActual.codigoProceso !== caso.codigoProceso || solActual.entidad !== caso.entidad) {
      await client.query('ROLLBACK');
      fila.accion = 'ABORTAR'; fila.resultado = 'IDENTIDAD_CAMBIO';
      fila.detalle = `codigoProceso/entidad de la Solicitud cambiaron desde que se construyó el paquete.`;
      reporte.push(fila); continue;
    }

    if (!apply) {
      fila.accion = 'ACTUALIZARIA_ESTADO_ASIGNACIONES'; fila.resultado = 'DRY_RUN_OK';
      fila.detalle = `estadoSolicitud: "${solActual.estadoSolicitud}" -> "${caso.estadoCorrectoLicycolba}" — módulo ${caso.moduloActualAltaria} -> ${caso.moduloEsperado}. Solo UPDATE de Solicitud (estadoSolicitud+asignaciones) — 0 INSERT, 0 UPDATE de Proceso.`;
      await client.query('ROLLBACK');
      reporte.push(fila); continue;
    }

    await client.query(
      'UPDATE "Solicitud" SET "estadoSolicitud" = $1, asignaciones = $2::jsonb, "updatedAt" = now() WHERE id = $3',
      [caso.estadoCorrectoLicycolba, JSON.stringify(caso.asignaciones ?? []), caso.solicitudAltariaId],
    );
    await client.query('COMMIT');
    updateSolicitud++;
    fila.accion = 'ACTUALIZADO'; fila.resultado = 'APLICADO';
    fila.detalle = `estadoSolicitud: "${solActual.estadoSolicitud}" -> "${caso.estadoCorrectoLicycolba}" — módulo ${caso.moduloActualAltaria} -> ${caso.moduloEsperado}.`;
    reporte.push(fila);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    fila.accion = 'ABORTAR'; fila.resultado = 'ERROR'; fila.detalle = e.message;
    reporte.push(fila);
  } finally {
    client.release();
  }
}

console.log('\n=== Reporte ===');
console.table(reporte.map(r => ({ solicitudLic: r.solicitudLicycolbaId, solicitudAltaria: r.solicitudAltariaId, accion: r.accion, resultado: r.resultado })));
for (const r of reporte) console.log(`- Solicitud ${r.solicitudLicycolbaId} -> ${r.solicitudAltariaId}: ${r.detalle}`);

const aplicadas = reporte.filter(r => r.resultado === 'APLICADO').length;
const bloqueadas = reporte.filter(r => r.resultado === 'BLOQUEADO_EN_PAQUETE' || r.resultado === 'IDENTIDAD_CAMBIO' || r.resultado === 'SOLICITUD_YA_NO_EXISTE').length;
const errores = reporte.filter(r => r.resultado === 'ERROR').length;

console.log('\n=== Validación de tipos de escritura ===');
console.log(`INSERT Solicitud = ${insertSolicitud} (siempre 0 — este script no tiene código para insertar Solicitud)`);
console.log(`INSERT Proceso = ${insertProceso} (siempre 0 — este script no tiene código para insertar Proceso)`);
console.log(`UPDATE Proceso = ${updateProceso} (siempre 0 — este script no tiene código para modificar Proceso)`);
console.log(`UPDATE Solicitud = ${updateSolicitud} (máximo 13)`);
console.log(`\nTotal aplicadas: ${aplicadas} | Total bloqueadas: ${bloqueadas} | Total errores: ${errores}`);

writeFileSync('ops/output/reporte-correccion-13-altaria.json', JSON.stringify({
  modo: apply ? 'APLICAR' : 'DRY_RUN', ejecutadoEn: new Date().toISOString(),
  insertSolicitud, insertProceso, updateProceso, updateSolicitud, aplicadas, bloqueadas, errores,
  reporte,
}, null, 1));
console.log('\nReporte guardado en ops/output/reporte-correccion-13-altaria.json');

await pool.end();
