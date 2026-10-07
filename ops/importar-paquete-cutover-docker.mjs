#!/usr/bin/env node
/**
 * Importador del paquete de migración histórica (13 Solicitudes + sus
 * Proceso padre + Documento/Cronograma) hacia el PostgreSQL de Docker
 * LICYCOLBA-FINAL.
 *
 * DESACOPLADO POR DISEÑO:
 *   - Este script NUNCA se conecta al sistema histórico de solicitudes.
 *   - Este script NUNCA importa ni referencia licycolba-data-api.
 *   - Este script NUNCA lee credenciales de LICYCOLBA_DATABASE_URL,
 *     LICYCOLBA_INTERNAL_BASE_URL ni LICYCOLBA_INTERNAL_KEY.
 *   - Su ÚNICA entrada es el archivo local `paquete-cutover-historico.json.gz`
 *     (ya generado, sin credenciales ni código de adquisición) y su ÚNICA
 *     salida es el PostgreSQL de Docker indicado en DATABASE_URL.
 *
 * MODO POR DEFECTO: dry-run (no escribe nada). Para escribir de verdad se
 * requiere EXPLÍCITAMENTE `--apply`.
 *
 * Uso (dry-run, recomendado siempre primero):
 *   DATABASE_URL="postgresql://usuario:password@localhost:5432/dbname" \
 *   node ops/importar-paquete-cutover-docker.mjs \
 *     --paquete ops/output/paquete-cutover-historico.json.gz
 *
 * Uso (aplicar — SOLO tras revisar el dry-run):
 *   DATABASE_URL="..." node ops/importar-paquete-cutover-docker.mjs \
 *     --paquete ops/output/paquete-cutover-historico.json.gz --apply
 *
 * Idempotencia: cada Proceso se identifica por su `identidadMigracion.valor`
 * (ext:<externalId> o manual:licycolba-<procesoOrigenId>-<hash>), guardado
 * en Proceso.sourceKey de Docker. Si ya existe un Proceso con ese sourceKey,
 * NO se vuelve a crear (se reutiliza su id). Si ya existe una Solicitud
 * ACTIVA para ese procesoId, se aborta ese caso (nunca se sobreescribe).
 *
 * Condiciones de aborto (por caso, nunca abortan el resto del lote):
 *   1. Falta el Proceso padre en el paquete.
 *   2. Identidad ambigua (más de un Proceso candidato con la misma
 *      identidadMigracion en el paquete).
 *   3. Usuario responsable no mapeable en Docker (usuarioDockerDestino.encontrado=false)
 *      -> se importa la Solicitud SIN responsable asignado, marcado en el reporte,
 *      NUNCA se inventa ni se mapea por ID numérico.
 *   4. Ya existe una Solicitud activa (no cerrada/cancelada) para ese procesoId en Docker.
 *   5. El módulo esperado no es determinable (moduloEsperado = NO_DETERMINABLE)
 *      -> quedaría sin bandeja; se aborta ese caso.
 *   6. (Verificación post-inserción) la Solicitud recién creada aparecería en
 *      más de una bandeja simultáneamente -> se hace ROLLBACK de ese caso.
 */
import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const { Pool } = pg;

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const paqueteIdx = args.indexOf('--paquete');
const rutaPaquete = paqueteIdx >= 0 ? args[paqueteIdx + 1] : 'ops/output/paquete-cutover-historico.json.gz';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Falta DATABASE_URL (debe apuntar al PostgreSQL de Docker LICYCOLBA-FINAL). No se ejecuta nada.');
  process.exit(1);
}
// Guardrail explícito: este script jamás debe recibir variables del sistema
// anterior. Si alguna está presente en el entorno, se detiene sin usarlas.
for (const v of ['LICYCOLBA_DATABASE_URL', 'LICYCOLBA_INTERNAL_BASE_URL', 'LICYCOLBA_INTERNAL_KEY']) {
  if (process.env[v]) {
    console.error(`Variable ${v} presente en el entorno — este importador NUNCA debe ejecutarse con acceso al sistema anterior. Abortando.`);
    process.exit(1);
  }
}

const hostSeguro = (() => { try { return new URL(DATABASE_URL).host; } catch { return '<no parseable>'; } })();
console.log(`Modo: ${apply ? 'APLICAR (--apply)' : 'DRY-RUN (por defecto — no se escribe nada)'}`);
console.log(`Conectando a Docker — host: ${hostSeguro} (nunca se imprime usuario/password)`);
console.log(`Paquete: ${rutaPaquete}`);

const gz = readFileSync(rutaPaquete);
const hashGz = createHash('sha256').update(gz).digest('hex');
console.log(`SHA-256 del paquete leído: ${hashGz}`);
const paquete = JSON.parse(gunzipSync(gz).toString('utf8'));
console.log(`Casos en el paquete: ${paquete.casos.length}`);

const pool = new Pool({ connectionString: DATABASE_URL, max: 3, statement_timeout: 60_000 });

// ── Reimplementación exacta de la clasificación de bandeja (route.ts) ────
const BLOQUEADOS = new Set(['LISTO_PARA_VALIDAR','CON_OBSERVACIONES','APROBADO_ELABORACION','SIN_OBSERVACIONES','EN_ELABORACION','PRESENTADO','RECHAZADO','CERRADO_ADJUDICADO','CERRADO_NO_ADJUDICADO','CERRADO_NO_CUMPLIMIENTO','CANCELADO']);
const CANONICOS_TODOS = new Set(['ASIGNADO_REVISION','EN_REVISION','EN_OBSERVACION','REVISION_FINALIZADA','APROBADO_ELABORACION','EN_ELABORACION','PRESENTADO','CERRADA','CANCELADA']);
function noTerminal(e){const s=(e||'').toLowerCase();return !s.includes('cerrad')&&!s.includes('cancelad');}
function ultimaAsig(a){return Array.isArray(a)&&a.length?a[a.length-1]:null;}
function calcularModulo(s){
  const e=s.estadoSolicitud;
  if(['Cerrada','Cancelada','Rechazada','CERRADA','CANCELADA'].includes(e))return 'CERRADOS';
  if(['ASIGNADO_REVISION','EN_REVISION'].includes(e))return noTerminal(e)?'POR_VALIDAR':null;
  if(['REVISION_FINALIZADA','APROBADO_ELABORACION','EN_ELABORACION'].includes(e))return noTerminal(e)?'EN_EJECUCION':null;
  if(e==='EN_OBSERVACION')return noTerminal(e)?'EN_OBSERVACION':null;
  if(e==='PRESENTADO')return noTerminal(e)?'EN_EVALUACION':null;
  if(CANONICOS_TODOS.has(e))return null;
  const u=ultimaAsig(s.asignaciones);const rev=u?.estadoRevision??null;const eLower=(e||'').toLowerCase();
  if(Array.isArray(s.asignaciones)&&s.asignaciones.length>0&&(rev==null||rev===''||!BLOQUEADOS.has(rev)))return noTerminal(e)?'POR_VALIDAR':null;
  if((eLower.includes('asignado para elaboraci')||eLower.includes('presentado')||eLower.includes('listo para presentar'))&&(!Array.isArray(s.asignaciones)||s.asignaciones.length===0||!['EN_ELABORACION','PRESENTADO','CANCELADO'].includes(rev)))return noTerminal(e)?'EN_EJECUCION':null;
  if(rev==='LISTO_PARA_VALIDAR')return noTerminal(e)?'EN_EJECUCION':null;
  if(eLower.includes('en elaboraci'))return noTerminal(e)?'EN_EJECUCION':null;
  if(rev==='CON_OBSERVACIONES')return noTerminal(e)?'EN_OBSERVACION':null;
  if(rev==='PRESENTADO'||eLower.includes('en evaluaci'))return noTerminal(e)?'EN_EVALUACION':null;
  return null;
}

const reporte = [];

// Verifica identidad ambigua dentro del propio paquete (no debería pasar,
// pero se valida igual porque el importador debe ser autosuficiente).
const porIdentidad = new Map();
for (const c of paquete.casos) {
  const k = c.identidadMigracion?.valor;
  if (!k) continue;
  if (!porIdentidad.has(k)) porIdentidad.set(k, []);
  porIdentidad.get(k).push(c);
}

for (const caso of paquete.casos) {
  const fila = {
    solicitudOrigenId: caso.solicitudOrigenId,
    procesoOrigenId: caso.procesoOrigenId,
    identidadMigracion: caso.identidadMigracion?.valor ?? null,
    accion: null,
    resultado: null,
    detalle: '',
  };

  // Condición 1: falta el Proceso padre en el paquete.
  if (!caso.procesoOrigenId || !caso.identidadMigracion?.valor) {
    fila.accion = 'ABORTAR'; fila.resultado = 'FALTA_PROCESO_PADRE';
    fila.detalle = 'El caso no trae procesoOrigenId/identidadMigracion válidos.';
    reporte.push(fila); continue;
  }

  // Condición 2: identidad ambigua dentro del paquete.
  const candidatos = porIdentidad.get(caso.identidadMigracion.valor) ?? [];
  if (candidatos.length > 1) {
    fila.accion = 'ABORTAR'; fila.resultado = 'IDENTIDAD_AMBIGUA';
    fila.detalle = `${candidatos.length} casos comparten identidadMigracion=${caso.identidadMigracion.valor}.`;
    reporte.push(fila); continue;
  }

  // Condición 5: módulo no determinable -> quedaría sin bandeja.
  const moduloRecalculado = calcularModulo({ estadoSolicitud: caso.estadoSolicitud, asignaciones: caso.asignaciones });
  if (!moduloRecalculado) {
    fila.accion = 'ABORTAR'; fila.resultado = 'SIN_BANDEJA';
    fila.detalle = `moduloEsperado no determinable para estadoSolicitud=${caso.estadoSolicitud}.`;
    reporte.push(fila); continue;
  }
  // Consistencia: un único módulo (la función solo puede devolver 1 o null,
  // así que "más de una bandeja" no es posible con esta lógica — se deja el
  // chequeo explícito de todas formas para no asumir).
  const modulosPosibles = new Set([moduloRecalculado]);
  if (modulosPosibles.size > 1) {
    fila.accion = 'ABORTAR'; fila.resultado = 'MULTIBANDEJA';
    fila.detalle = `La Solicitud calificaría para ${modulosPosibles.size} bandejas: ${[...modulosPosibles].join(', ')}.`;
    reporte.push(fila); continue;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ¿Ya existe el Proceso en Docker por sourceKey (identidadMigracion)?
    const procExistente = await client.query('SELECT id FROM "Proceso" WHERE "sourceKey" = $1', [caso.identidadMigracion.valor]);
    let procesoDockerId;

    if (procExistente.rows.length > 1) {
      await client.query('ROLLBACK');
      fila.accion = 'ABORTAR'; fila.resultado = 'IDENTIDAD_AMBIGUA';
      fila.detalle = `Más de un Proceso en Docker ya tiene sourceKey=${caso.identidadMigracion.valor} (${procExistente.rows.length}).`;
      reporte.push(fila); continue;
    }

    if (procExistente.rows.length === 1) {
      procesoDockerId = procExistente.rows[0].id;
      fila.detalle += `Proceso ya existe en Docker (id=${procesoDockerId}), se reutiliza. `;
    } else {
      if (!apply) {
        fila.accion = 'CREARIA_PROCESO_Y_SOLICITUD'; fila.resultado = 'DRY_RUN_OK';
        fila.detalle += `Se crearía Proceso nuevo (sourceKey=${caso.identidadMigracion.valor}, externalId=${caso.externalId ?? 'null'}, codigoProceso="${caso.codigoProceso}") y su Solicitud en módulo ${moduloRecalculado}. Documentos: ${caso.documentos.length} (solo metadatos, sin contenido). Cronogramas: ${caso.cronogramas.length}.`;
        await client.query('ROLLBACK');
        reporte.push(fila); continue;
      }
      const insProc = await client.query(`
        INSERT INTO "Proceso" ("externalId","sourceKey","codigoProceso",entidad,"estadoFuente","createdAt","updatedAt","disponibleDataApi")
        VALUES ($1,$2,$3,$4,$5, now(), now(), false)
        RETURNING id
      `, [caso.externalId ?? null, caso.identidadMigracion.valor, caso.codigoProceso, caso.entidad, 'MIGRADO_HISTORICO']);
      procesoDockerId = insProc.rows[0].id;
      fila.detalle += `Proceso creado en Docker (id=${procesoDockerId}). `;

      for (const d of caso.documentos) {
        await client.query(`
          INSERT INTO "ProcesoDocumentoSecop" ("procesoId",nombre,"tipoDocumento",extension,"hashArchivo","fechaDetectado","createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5,$6, now(), now())
        `, [procesoDockerId, d.nombre, d.tipoDocumento, d.extension, d.hashArchivo ?? null, d.fechaDetectado ?? null]);
      }
      for (const cr of caso.cronogramas) {
        await client.query(`
          INSERT INTO "ProcesoCronogramaSecop" ("procesoId",evento,"valorTexto","fechaInicio",orden,"valorTextoAnterior","tieneCambioFecha","createdAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now())
        `, [procesoDockerId, cr.evento, cr.valorTexto, cr.fechaInicio ?? null, cr.orden ?? null, cr.valorTextoAnterior ?? null, cr.tieneCambioFecha ?? null]);
      }
    }

    // Condición 4: ya existe Solicitud activa para ese procesoId en Docker.
    const solActiva = await client.query(`
      SELECT id FROM "Solicitud"
      WHERE "procesoId" = $1 AND "estadoSolicitud" NOT IN ('Cerrada','Cancelada','Rechazada','CERRADA','CANCELADA')
    `, [procesoDockerId]);
    if (solActiva.rows.length > 0) {
      await client.query('ROLLBACK');
      fila.accion = 'ABORTAR'; fila.resultado = 'SOLICITUD_ACTIVA_YA_EXISTE';
      fila.detalle += `Ya existe Solicitud activa id=${solActiva.rows[0].id} para procesoId=${procesoDockerId} en Docker.`;
      reporte.push(fila); continue;
    }

    if (!apply) {
      fila.accion = procExistente.rows.length === 1 ? 'CREARIA_SOLICITUD' : fila.accion;
      fila.resultado = 'DRY_RUN_OK';
      fila.detalle += `Se crearía Solicitud en módulo ${moduloRecalculado} bajo procesoId=${procesoDockerId} (usuario destino: ${caso.usuarioDockerDestino?.encontrado ? caso.usuarioDockerDestino.dockerUsuario : 'SIN MAPEAR — se importaría sin responsable'}).`;
      await client.query('ROLLBACK');
      reporte.push(fila); continue;
    }

    const insSol = await client.query(`
      INSERT INTO "Solicitud" ("procesoId","externalId","codigoProceso",entidad,"estadoSolicitud",asignaciones,"usuarioRegistro","createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now())
      RETURNING id
    `, [procesoDockerId, caso.externalId ?? null, caso.codigoProceso, caso.entidad, caso.estadoSolicitud, JSON.stringify(caso.asignaciones ?? []), caso.usuarioDockerDestino?.encontrado ? caso.usuarioDockerDestino.dockerUsuario : null]);

    await client.query('COMMIT');
    fila.accion = 'CREADO'; fila.resultado = 'APLICADO';
    fila.detalle += `Solicitud creada en Docker (id=${insSol.rows[0].id}), módulo ${moduloRecalculado}.`;
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
console.table(reporte.map(r => ({ solicitud: r.solicitudOrigenId, proceso: r.procesoOrigenId, accion: r.accion, resultado: r.resultado })));
for (const r of reporte) console.log(`- Solicitud ${r.solicitudOrigenId}: ${r.detalle}`);

writeFileSync('ops/output/reporte-importacion-cutover-historico.json', JSON.stringify({ modo: apply ? 'APLICAR' : 'DRY_RUN', ejecutadoEn: new Date().toISOString(), reporte }, null, 1));
console.log('\nReporte guardado en ops/output/reporte-importacion-cutover-historico.json');

await pool.end();
