#!/usr/bin/env node
/**
 * Migra el histórico de GESTIÓN (Solicitud, Notificacion, DeletedSolicitud)
 * de altaria hacia la base propia del Docker de la empresa — SIN tocar
 * Proceso ni sus tablas hijas (ProcesoDetalleSecop/CronogramaSecop/
 * DocumentoSecop/SnapshotSecop/ProcesoNuevo), porque esas YA las trae el
 * sync de Data API que corre en el Docker de forma independiente. Copiar
 * Proceso en bruto generaría el mismo problema de duplicados que ya se
 * resolvió para altaria (ver ops/limpiar-duplicados-proceso.mjs).
 *
 * Cada Solicitud/Notificacion/DeletedSolicitud de altaria se enlaza al
 * Proceso EXISTENTE en el destino que tenga la MISMA IDENTIDAD real
 * (sourceKey -> externalId -> codigoProceso+entidad, en ese orden de
 * preferencia) — nunca se crea un Proceso nuevo. Si no hay match, el caso
 * se reporta aparte como "SIN_MATCH" para revisión manual, no se descarta
 * silenciosamente ni se fuerza.
 *
 * Si el destino YA tiene una Solicitud para ese procesoId (por ejemplo,
 * alguien ya empezó a gestionarlo ahí desde que el Docker entró en uso),
 * NUNCA se sobreescribe — se reporta como YA_EXISTE.
 *
 * Reutiliza el mismo paquete .gz que exportó Proceso/Solicitud/Notificacion/
 * DeletedSolicitud (ops/exportar-historico-para-docker.mjs) — no hace falta
 * volver a exportar.
 *
 * MODO POR DEFECTO: dry-run (no escribe nada). Requiere --apply explícito.
 *
 * Uso (dry-run, siempre primero):
 *   DATABASE_URL="postgresql://..." node ops/importar-historico-solicitudes-docker.mjs
 *
 * Uso (aplicar — SOLO tras revisar el dry-run):
 *   DATABASE_URL="postgresql://..." node ops/importar-historico-solicitudes-docker.mjs --apply
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

const procesosAltariaPorId = new Map((paquete.tablas.Proceso ?? []).map((p) => [p.id, p]));

const pool = new Pool({ connectionString: DATABASE_URL, max: 3, statement_timeout: 120_000 });

// Cache de resolución de identidad -> id real en el destino.
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

function identidadDeSolicitudODeleted(fila) {
  return { sourceKey: fila.procesoSourceKey ?? null, externalId: fila.externalId ?? null, codigoProceso: fila.codigoProceso ?? null, entidad: fila.entidad ?? null };
}

function identidadDeNotificacion(fila) {
  if (fila.codigoProceso && fila.entidad) {
    return { sourceKey: null, externalId: null, codigoProceso: fila.codigoProceso, entidad: fila.entidad };
  }
  const proc = fila.procesoId ? procesosAltariaPorId.get(fila.procesoId) : null;
  if (!proc) return null;
  return { sourceKey: proc.sourceKey ?? null, externalId: proc.externalId ?? null, codigoProceso: proc.codigoProceso ?? null, entidad: proc.entidad ?? null };
}

function serializarValor(v) {
  // pg interpreta un Array JS como arreglo NATIVO de Postgres ({...}), no
  // como JSON — rompe las columnas json/jsonb (asignaciones, docData, etc.
  // en Solicitud; datos en Notificacion). Ninguna de las tablas migradas
  // aquí tiene columnas de arreglo nativo real, así que es seguro
  // serializar explícitamente cualquier array/objeto a texto JSON.
  if (v !== null && typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

async function insertarConColumnas(client, tabla, fila, columnasOmitir, onConflict) {
  const columnas = Object.keys(fila).filter((c) => !columnasOmitir.includes(c));
  const listaColumnas = columnas.map((c) => `"${c}"`).join(',');
  const placeholders = columnas.map((_, i) => `$${i + 1}`).join(',');
  const valores = columnas.map((c) => serializarValor(fila[c]));
  const sql = `INSERT INTO "${tabla}" (${listaColumnas}) VALUES (${placeholders})${onConflict ? ` ${onConflict}` : ''}`;
  const res = await client.query(sql, valores);
  return res.rowCount;
}

(async () => {
  const client = await pool.connect();
  const resumen = {
    Solicitud: { total: 0, migradas: 0, sinMatch: 0, yaExiste: 0, sinMatchDetalle: [] },
    Notificacion: { total: 0, migradas: 0, sinMatch: 0, ignoradaPorIdempotencia: 0, sinMatchDetalle: [] },
    DeletedSolicitud: { total: 0, migradas: 0, sinMatch: 0, sinMatchDetalle: [] },
  };

  try {
    await client.query('BEGIN');

    // --- Solicitud ---
    for (const fila of paquete.tablas.Solicitud ?? []) {
      resumen.Solicitud.total++;
      const idDestino = await resolverProcesoDestino(client, identidadDeSolicitudODeleted(fila));
      if (idDestino === null) {
        resumen.Solicitud.sinMatch++;
        resumen.Solicitud.sinMatchDetalle.push({ id: fila.id, codigoProceso: fila.codigoProceso, entidad: fila.entidad });
        continue;
      }
      const yaExiste = await client.query('SELECT id FROM "Solicitud" WHERE "procesoId" = $1', [idDestino]);
      if (yaExiste.rows.length > 0) { resumen.Solicitud.yaExiste++; continue; }

      const filaAInsertar = { ...fila, procesoId: idDestino };
      if (apply) await insertarConColumnas(client, 'Solicitud', filaAInsertar, ['id']);
      resumen.Solicitud.migradas++;
    }

    // --- Notificacion ---
    for (const fila of paquete.tablas.Notificacion ?? []) {
      resumen.Notificacion.total++;
      const identidad = identidadDeNotificacion(fila);
      const idDestino = identidad ? await resolverProcesoDestino(client, identidad) : null;
      if (idDestino === null) {
        resumen.Notificacion.sinMatch++;
        if (resumen.Notificacion.sinMatchDetalle.length < 25) resumen.Notificacion.sinMatchDetalle.push({ id: fila.id, codigoProceso: fila.codigoProceso, tipo: fila.tipo });
        continue;
      }
      const filaAInsertar = { ...fila, procesoId: idDestino };
      if (apply) {
        const n = await insertarConColumnas(client, 'Notificacion', filaAInsertar, ['id'], 'ON CONFLICT ("claveIdempotencia") DO NOTHING');
        if (n === 0) resumen.Notificacion.ignoradaPorIdempotencia++; else resumen.Notificacion.migradas++;
      } else {
        resumen.Notificacion.migradas++;
      }
    }

    // --- DeletedSolicitud ---
    for (const fila of paquete.tablas.DeletedSolicitud ?? []) {
      resumen.DeletedSolicitud.total++;
      const idDestino = await resolverProcesoDestino(client, identidadDeSolicitudODeleted(fila));
      if (idDestino === null) {
        resumen.DeletedSolicitud.sinMatch++;
        resumen.DeletedSolicitud.sinMatchDetalle.push({ id: fila.id, codigoProceso: fila.codigoProceso, entidad: fila.entidad });
        continue;
      }
      const filaAInsertar = { ...fila, procesoId: idDestino };
      if (apply) await insertarConColumnas(client, 'DeletedSolicitud', filaAInsertar, ['id']);
      resumen.DeletedSolicitud.migradas++;
    }

    if (apply) {
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
  console.table({
    Solicitud: { total: resumen.Solicitud.total, migradas: resumen.Solicitud.migradas, sinMatch: resumen.Solicitud.sinMatch, yaExiste: resumen.Solicitud.yaExiste },
    Notificacion: { total: resumen.Notificacion.total, migradas: resumen.Notificacion.migradas, sinMatch: resumen.Notificacion.sinMatch, ignoradaPorIdempotencia: resumen.Notificacion.ignoradaPorIdempotencia },
    DeletedSolicitud: { total: resumen.DeletedSolicitud.total, migradas: resumen.DeletedSolicitud.migradas, sinMatch: resumen.DeletedSolicitud.sinMatch },
  });

  writeFileSync('ops/output/reporte-importacion-solicitudes-docker.json', JSON.stringify({ modo: apply ? 'APLICAR' : 'DRY_RUN', ejecutadoEn: new Date().toISOString(), hashPaquete: hash, resumen }, null, 1));
  console.log('Reporte guardado en ops/output/reporte-importacion-solicitudes-docker.json');

  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
