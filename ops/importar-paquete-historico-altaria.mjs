#!/usr/bin/env node
/**
 * Importador del paquete histórico acotado a los 6 casos reales faltantes
 * en la BD local de licycolba-final (altaria).
 *
 * GARANTÍA ESTRUCTURAL: este script NO contiene ningún código que inserte
 * en la tabla "Proceso" — no hay `INSERT INTO "Proceso"` ni
 * `prisma.proceso.create` en ningún punto de este archivo. Cada caso SOLO
 * enlaza una Solicitud nueva a un Proceso.id que YA EXISTE, verificado por
 * identidad antes de escribir. Si el Proceso indicado en el paquete no
 * existe, o su identidad real no coincide con la registrada, el caso se
 * ABORTA — nunca se crea un Proceso como solución alternativa.
 *
 * MODO POR DEFECTO: dry-run (no escribe nada). Requiere `--apply` explícito.
 *
 * Uso (dry-run, siempre primero):
 *   DATABASE_URL="postgresql://..." node ops/importar-paquete-historico-altaria.mjs
 *
 * Uso (aplicar — SOLO tras revisar el dry-run):
 *   DATABASE_URL="postgresql://..." node ops/importar-paquete-historico-altaria.mjs --apply
 */
import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const { Pool } = pg;

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const paqueteIdx = args.indexOf('--paquete');
const rutaPaquete = paqueteIdx >= 0 ? args[paqueteIdx + 1] : 'ops/output/paquete-historico-altaria.json.gz';

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
let seCrearianProcesos = 0;

for (const caso of paquete.casos) {
  const fila = {
    solicitudOrigenId: caso.solicitudOrigenId,
    procesoAltariaId: caso.procesoAltariaId,
    accion: null,
    resultado: null,
    detalle: '',
    crearia_proceso: false, // esta bandera se reporta explícita — debe ser SIEMPRE false
  };

  if (caso.resultado === 'BLOQUEADO') {
    fila.accion = 'ABORTAR'; fila.resultado = 'BLOQUEADO_EN_PAQUETE'; fila.detalle = caso.motivo ?? 'bloqueado al construir el paquete';
    reporte.push(fila); continue;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. El Proceso indicado DEBE existir ya — nunca se crea.
    const procExistente = await client.query(
      'SELECT id, "externalId", "sourceKey", "codigoProceso", entidad FROM "Proceso" WHERE id = $1',
      [caso.procesoAltariaId],
    );
    if (procExistente.rows.length === 0) {
      await client.query('ROLLBACK');
      fila.accion = 'ABORTAR'; fila.resultado = 'PROCESO_NO_EXISTE';
      fila.detalle = `Proceso.id=${caso.procesoAltariaId} no existe en este destino — este importador NUNCA crea un Proceso, se aborta el caso.`;
      reporte.push(fila); continue;
    }
    const proc = procExistente.rows[0];

    // 2. Verificación de identidad EN VIVO contra lo registrado en el paquete
    // (defensa contra drift entre el momento de construir el paquete y el
    // momento de aplicarlo — un sourceKey/externalId que cambió = abortar).
    if (proc.sourceKey !== caso.identidadMigracion?.procesoAltariaSourceKeyReal) {
      await client.query('ROLLBACK');
      fila.accion = 'ABORTAR'; fila.resultado = 'IDENTIDAD_CAMBIO';
      fila.detalle = `sourceKey real del Proceso (${proc.sourceKey}) ya no coincide con el registrado en el paquete (${caso.identidadMigracion?.procesoAltariaSourceKeyReal}).`;
      reporte.push(fila); continue;
    }
    if (caso.externalId && proc.externalId && caso.externalId !== proc.externalId) {
      await client.query('ROLLBACK');
      fila.accion = 'ABORTAR'; fila.resultado = 'IDENTIDAD_CAMBIO';
      fila.detalle = `externalId real (${proc.externalId}) no coincide con el del paquete (${caso.externalId}).`;
      reporte.push(fila); continue;
    }

    // 3. Nunca sobrescribir: si YA existe una Solicitud para este Proceso, abortar.
    const solExistente = await client.query('SELECT id FROM "Solicitud" WHERE "procesoId" = $1', [caso.procesoAltariaId]);
    if (solExistente.rows.length > 0) {
      await client.query('ROLLBACK');
      fila.accion = 'ABORTAR'; fila.resultado = 'SOLICITUD_YA_EXISTE';
      fila.detalle = `Ya existe Solicitud.id=${solExistente.rows[0].id} para procesoId=${caso.procesoAltariaId} — no se sobreescribe.`;
      reporte.push(fila); continue;
    }

    if (!apply) {
      fila.accion = 'CREARIA_SOLICITUD'; fila.resultado = 'DRY_RUN_OK';
      fila.detalle = `Se crearía Solicitud enlazada a Proceso.id=${caso.procesoAltariaId} (sourceKey real ${proc.sourceKey}, verificado), módulo ${caso.moduloEsperado}, estadoSolicitud=${caso.estadoSolicitud}.`;
      await client.query('ROLLBACK');
      reporte.push(fila); continue;
    }

    const procesoSourceKey = proc.sourceKey;
    const insSol = await client.query(`
      INSERT INTO "Solicitud" (
        "procesoId","procesoSourceKey","externalId","codigoProceso",entidad,"estadoSolicitud",asignaciones,
        perfil,"usuarioRegistro","emailRegistro","cargoRegistro","entidadRegistro",observacion,
        "fechaPublicacion","fechaVencimiento","fechaCierre",
        "sqrNumero","sqrCreada","sqrCerrada","resultadoFinal","causalCierre",
        ciudad,sede,plataforma,fuente,"aliasFuente",modalidad,departamento,valor,
        "linkDetalle","linkSecop","linkSecopReg","createdAt","updatedAt"
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,$12,$13,
        $14,$15,$16,
        $17,$18,$19,$20,$21,
        $22,$23,$24,$25,$26,$27,$28,$29,
        $30,$31,$32, now(), now()
      ) RETURNING id
    `, [
      caso.procesoAltariaId, procesoSourceKey, caso.externalId ?? null, caso.codigoProceso, caso.entidad, caso.estadoSolicitud, JSON.stringify(caso.asignaciones ?? []),
      caso.perfil ?? null, caso.usuarioRegistro ?? null, caso.emailRegistro ?? null, caso.cargoRegistro ?? null, caso.entidadRegistro ?? null, caso.observacion ?? null,
      caso.fechaPublicacion ?? null, caso.fechaVencimiento ?? null, caso.fechaCierre ?? null,
      caso.sqrNumero ?? null, caso.sqrCreada ?? false, caso.sqrCerrada ?? false, caso.resultadoFinal ?? null, caso.causalCierre ?? null,
      caso.ciudad ?? null, caso.sede ?? null, caso.plataforma ?? null, caso.fuente ?? null, caso.aliasFuente ?? null, caso.modalidad ?? null, caso.departamento ?? null, caso.valor ?? null,
      caso.linkDetalle ?? null, caso.linkSecop ?? null, caso.linkSecopReg ?? null,
    ]);

    await client.query('COMMIT');
    fila.accion = 'CREADO'; fila.resultado = 'APLICADO';
    fila.detalle = `Solicitud creada (id=${insSol.rows[0].id}), enlazada a Proceso.id=${caso.procesoAltariaId} ya existente, módulo ${caso.moduloEsperado}.`;
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
console.table(reporte.map(r => ({ solicitud: r.solicitudOrigenId, proceso: r.procesoAltariaId, accion: r.accion, resultado: r.resultado, crearia_proceso: r.crearia_proceso })));
for (const r of reporte) console.log(`- Solicitud ${r.solicitudOrigenId}: ${r.detalle}`);

if (seCrearianProcesos > 0) {
  console.error(`\nABORTANDO EJECUCIÓN: ${seCrearianProcesos} caso(s) hubieran requerido crear un Proceso — este importador nunca lo hace. Revisar el paquete.`);
  process.exitCode = 1;
}

writeFileSync('ops/output/reporte-importacion-historico-altaria.json', JSON.stringify({ modo: apply ? 'APLICAR' : 'DRY_RUN', ejecutadoEn: new Date().toISOString(), reporte }, null, 1));
console.log('\nReporte guardado en ops/output/reporte-importacion-historico-altaria.json');

await pool.end();
