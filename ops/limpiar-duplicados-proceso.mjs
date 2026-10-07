// Limpieza de Procesos duplicados (bug de sourceKey inestable de Data API,
// ya corregido hacia adelante — ver aplicarPaginaCanonica.ts). Este script
// limpia el BACKLOG de duplicados que ya existían antes del fix.
//
// Criterio de selección de la fila GANADORA por grupo (codigoProceso+entidad):
//   1. Si exactamente 1 fila tiene Solicitud -> esa gana.
//   2. Si 2+ filas tienen Solicitud propia -> AMBIGUO, se omite (revisión manual).
//   3. Si ninguna tiene Solicitud -> gana la de lastSyncedAt/createdAt más reciente.
//
// Antes de retirar cada fila perdedora, sus hijos se REASIGNAN a la ganadora
// (nunca se pierden a ciegas):
//   - ProcesoDocumentoSecop: dedup por `nombre` — NO por dataApiDocId (es tan
//     inestable entre sincronizaciones como el sourceKey del Proceso,
//     verificado contra datos reales). Dentro del dedup por nombre, los
//     nombres GENÉRICOS (<=14 caracteres, sin dígitos — p.ej. "CDP", "ACTA
//     DE INICIO", "Invitación") NO se descartan automáticamente: no hay
//     metadata (hashArchivo/tamanoBytes están siempre NULL, verificado) para
//     confirmar que son el mismo archivo, así que van a REVISIÓN MANUAL en
//     vez de perderse o duplicarse a ciegas. Solo los nombres específicos
//     (largos o con dígitos/fechas) se descartan con alta confianza.
//   - ProcesoCronogramaSecop: dedup por `evento` — si la ganadora ya tiene
//     un evento con ese nombre, se descarta el de la perdedora; si no, se
//     reasigna.
//   - Notificacion: `proceso_nuevo` y `documento_nuevo` de las perdedoras se
//     descartan SIEMPRE (nunca se reasignan) — son duplicados casi
//     garantizados de eventos que la ganadora ya notificó (verificado:
//     mismo patrón de items en el mismo orden, solo con fecha distinta). El
//     resto de tipos (`cambio_estado`, `cambio_valor`, `cambio_fecha_cierre`,
//     `cambio_cronograma`, `manifestacion_interes`, y cualquier tipo legacy
//     huérfano como `adenda`) se deduplican por (`tipo`+`descripcion` EXACTA)
//     contra lo que ya tiene la ganadora — coincide -> descartar; si no,
//     se reasigna.
//   - ProcesoNuevo: se reasignan todas (sin restricción real, solo 2 filas
//     en todo el backlog).
//
// Cada GRUPO es una transacción independiente: si algo falla a mitad de un
// grupo, ese grupo hace rollback completo sin afectar a los demás grupos ya
// procesados en corridas anteriores o en la misma corrida.
//
// IMPORTANTE: los documentos en REVISIÓN MANUAL NUNCA se tocan en --apply
// (ni se reasignan ni se descartan) — quedan colgando de la fila perdedora
// hasta que se resuelvan a mano. Por eso, mientras un grupo tenga 1+
// documentos en revisión manual, ESE GRUPO se OMITE COMPLETO (la fila
// perdedora NO se retira) — retirar la fila perdedora borraría en cascada
// (onDelete:Cascade) esos documentos pendientes de revisión.
//
// Dry-run por defecto. Requiere --apply para escribir. --muestra=<codigo>
// imprime el detalle completo (reasignados/descartados/revisión) de un
// grupo puntual.
import { createRequire } from 'module';
import fs from 'node:fs';
const require = createRequire(process.cwd() + '/node_modules/index.js');
const { Pool } = require('pg');

const APLICAR = process.argv.includes('--apply');
const argMuestra = process.argv.find((a) => a.startsWith('--muestra='));
const CODIGOS_MUESTRA = argMuestra ? argMuestra.split('=')[1].split(',') : [];

function readUrl(path, varName) {
  const txt = fs.readFileSync(path, 'utf8');
  const m = txt.match(new RegExp(`^${varName}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm'));
  return m[1];
}
const altaria = new Pool({ connectionString: readUrl('.env.local', 'DATABASE_URL'), max: 3 });

function esNombreGenerico(nombre) {
  const n = (nombre ?? '').trim();
  return n.length <= 14 && !/\d/.test(n);
}

const TIPOS_SIEMPRE_DESCARTAR = new Set(['proceso_nuevo', 'documento_nuevo']);

(async () => {
  const detalle = JSON.parse(fs.readFileSync('ops/output/propuesta-limpieza-duplicados.json', 'utf8'));
  const grupos = detalle.filter((g) => g.bucket !== 'peligroso_multiples_solicitudes');
  const omitidosAmbiguos = detalle.filter((g) => g.bucket === 'peligroso_multiples_solicitudes');

  console.log(`=== MODO: ${APLICAR ? 'APLICAR (escribe en altaria)' : 'DRY-RUN (solo lectura, no escribe nada)'} ===`);
  console.log(`Grupos a procesar: ${grupos.length} | Omitidos por ambigüedad: ${omitidosAmbiguos.length}\n`);

  const resumen = { grupos: [], errores: [], gruposConRevisionManual: [] };
  let totalDocReasignados = 0, totalDocDescartados = 0, totalDocRevisionManual = 0;
  let totalCronReasignados = 0, totalCronDescartados = 0;
  let totalNotifReasignadas = 0, totalNotifDescartadas = 0, totalProcesoNuevoReasignados = 0;
  let gruposOmitidosPorRevisionManual = 0;

  for (const g of grupos) {
    const ganadoraId = g.idElegida;
    const perdedoraIds = g.filas.map((f) => f.id).filter((id) => id !== ganadoraId);

    const docsGanadora = await altaria.query(`SELECT nombre FROM "ProcesoDocumentoSecop" WHERE "procesoId"=$1`, [ganadoraId]);
    const docIdsGanadora = new Set(docsGanadora.rows.map((r) => r.nombre));
    const cronGanadora = await altaria.query(`SELECT evento FROM "ProcesoCronogramaSecop" WHERE "procesoId"=$1`, [ganadoraId]);
    const eventosGanadora = new Set(cronGanadora.rows.map((r) => r.evento));
    const notifGanadora = await altaria.query(`SELECT tipo, descripcion FROM "Notificacion" WHERE "procesoId"=$1 AND descripcion IS NOT NULL`, [ganadoraId]);
    const clavesNotifGanadora = new Set(notifGanadora.rows.map((r) => `${r.tipo}||${r.descripcion}`));

    const docsPerdedoras = await altaria.query(`SELECT id, nombre FROM "ProcesoDocumentoSecop" WHERE "procesoId"=ANY($1::int[])`, [perdedoraIds]);
    const cronPerdedoras = await altaria.query(`SELECT id, evento FROM "ProcesoCronogramaSecop" WHERE "procesoId"=ANY($1::int[])`, [perdedoraIds]);
    const notifPerdedoras = await altaria.query(`SELECT id, tipo, descripcion FROM "Notificacion" WHERE "procesoId"=ANY($1::int[])`, [perdedoraIds]);
    const nuevoPerdedoras = await altaria.query(`SELECT id FROM "ProcesoNuevo" WHERE "procesoId"=ANY($1::int[])`, [perdedoraIds]);

    const docsAReasignar = [];
    const docsADescartar = [];
    const docsARevisionManual = [];
    const vistosEnEstaCorrida = new Set(docIdsGanadora);
    for (const d of docsPerdedoras.rows) {
      if (esNombreGenerico(d.nombre)) { docsARevisionManual.push({ id: d.id, nombre: d.nombre }); continue; }
      if (vistosEnEstaCorrida.has(d.nombre)) docsADescartar.push(d.id);
      else { docsAReasignar.push(d.id); vistosEnEstaCorrida.add(d.nombre); }
    }

    const cronAReasignar = [];
    const cronADescartar = [];
    const eventosVistos = new Set(eventosGanadora);
    for (const c of cronPerdedoras.rows) {
      if (eventosVistos.has(c.evento)) cronADescartar.push(c.id);
      else { cronAReasignar.push(c.id); eventosVistos.add(c.evento); }
    }

    const notifAReasignar = [];
    const notifADescartar = [];
    for (const n of notifPerdedoras.rows) {
      if (TIPOS_SIEMPRE_DESCARTAR.has(n.tipo)) { notifADescartar.push(n.id); continue; }
      if (n.descripcion !== null && clavesNotifGanadora.has(`${n.tipo}||${n.descripcion}`)) notifADescartar.push(n.id);
      else notifAReasignar.push(n.id);
    }

    const tieneRevisionManual = docsARevisionManual.length > 0;

    const plan = {
      codigoProceso: g.codigoProceso, entidad: g.entidad, ganadoraId, perdedoraIds,
      omitidoPorRevisionManual: tieneRevisionManual,
      documentos: { reasignar: docsAReasignar.length, descartar: docsADescartar.length, revisionManual: docsARevisionManual.length, nombresRevisionManual: docsARevisionManual.map((d) => d.nombre) },
      cronograma: { reasignar: cronAReasignar.length, descartar: cronADescartar.length },
      notificaciones: { reasignar: notifAReasignar.length, descartar: notifADescartar.length },
      procesoNuevo: { reasignar: nuevoPerdedoras.rows.length },
    };
    resumen.grupos.push(plan);
    totalDocReasignados += docsAReasignar.length; totalDocDescartados += docsADescartar.length; totalDocRevisionManual += docsARevisionManual.length;
    totalCronReasignados += cronAReasignar.length; totalCronDescartados += cronADescartar.length;
    totalNotifReasignadas += notifAReasignar.length; totalNotifDescartadas += notifADescartar.length;
    totalProcesoNuevoReasignados += nuevoPerdedoras.rows.length;
    if (tieneRevisionManual) { gruposOmitidosPorRevisionManual++; resumen.gruposConRevisionManual.push(plan); }

    if (CODIGOS_MUESTRA.includes(g.codigoProceso)) {
      console.log(`--- MUESTRA DETALLADA: ${g.codigoProceso} / ${g.entidad} ---`);
      console.log(`  Ganadora: id=${ganadoraId} | Perdedoras: ${perdedoraIds.join(', ')}`);
      console.log(`  Documentos: ${docsGanadora.rows.length} ya en ganadora + ${docsPerdedoras.rows.length} en perdedoras -> reasignar ${docsAReasignar.length}, descartar ${docsADescartar.length}, revisión manual ${docsARevisionManual.length} (${docsARevisionManual.map((d) => d.nombre).join(', ')})`);
      console.log(`  Cronograma: ${cronGanadora.rows.length} ya en ganadora + ${cronPerdedoras.rows.length} en perdedoras -> reasignar ${cronAReasignar.length}, descartar ${cronADescartar.length}`);
      console.log(`  Notificaciones: reasignar ${notifAReasignar.length}, descartar ${notifADescartar.length}`);
      console.log(`  ProcesoNuevo: ${nuevoPerdedoras.rows.length} a reasignar`);
      console.log(`  Grupo omitido por revisión manual: ${tieneRevisionManual}`);
      console.log('');
    }

    if (APLICAR) {
      if (tieneRevisionManual) {
        console.log(`  [OMITIDO] ${g.codigoProceso}: tiene ${docsARevisionManual.length} documento(s) en revisión manual — grupo completo se salta, filas perdedoras NO se retiran.`);
        continue;
      }
      const client = await altaria.connect();
      try {
        await client.query('BEGIN');
        if (docsAReasignar.length) await client.query(`UPDATE "ProcesoDocumentoSecop" SET "procesoId"=$1 WHERE id=ANY($2::int[])`, [ganadoraId, docsAReasignar]);
        if (docsADescartar.length) await client.query(`DELETE FROM "ProcesoDocumentoSecop" WHERE id=ANY($1::int[])`, [docsADescartar]);
        if (cronAReasignar.length) await client.query(`UPDATE "ProcesoCronogramaSecop" SET "procesoId"=$1 WHERE id=ANY($2::int[])`, [ganadoraId, cronAReasignar]);
        if (cronADescartar.length) await client.query(`DELETE FROM "ProcesoCronogramaSecop" WHERE id=ANY($1::int[])`, [cronADescartar]);
        if (notifAReasignar.length) await client.query(`UPDATE "Notificacion" SET "procesoId"=$1 WHERE id=ANY($2::int[])`, [ganadoraId, notifAReasignar]);
        if (notifADescartar.length) await client.query(`DELETE FROM "Notificacion" WHERE id=ANY($1::int[])`, [notifADescartar]);
        if (nuevoPerdedoras.rows.length) await client.query(`UPDATE "ProcesoNuevo" SET "procesoId"=$1 WHERE id=ANY($2::int[])`, [ganadoraId, nuevoPerdedoras.rows.map((r) => r.id)]);
        await client.query(`DELETE FROM "Proceso" WHERE id=ANY($1::int[])`, [perdedoraIds]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        resumen.errores.push(`${g.codigoProceso}/${g.entidad}: ${e.message}`);
        console.error(`  [ERROR] ${g.codigoProceso}: ${e.message}`);
      } finally { client.release(); }
    }
  }

  console.log('=== RESUMEN TOTAL ===');
  console.log('Grupos procesados:', grupos.length);
  console.log('Documentos: reasignar', totalDocReasignados, '| descartar', totalDocDescartados, '| REVISIÓN MANUAL', totalDocRevisionManual);
  console.log('Cronograma: reasignar', totalCronReasignados, '| descartar', totalCronDescartados);
  console.log('Notificaciones: reasignar', totalNotifReasignadas, '| descartar', totalNotifDescartadas);
  console.log('ProcesoNuevo reasignados:', totalProcesoNuevoReasignados);
  console.log('Grupos CON revisión manual (se omiten completos en --apply):', gruposOmitidosPorRevisionManual, 'de', grupos.length);
  console.log('Grupos que SÍ se limpiarían completos:', grupos.length - gruposOmitidosPorRevisionManual);
  console.log('Filas Proceso que se retirarían (excluyendo grupos con revisión manual):', grupos.filter((g) => !resumen.gruposConRevisionManual.some((r) => r.codigoProceso === g.codigoProceso && r.entidad === g.entidad)).reduce((a, g) => a + (g.filas.length - 1), 0));
  console.log('Errores:', resumen.errores.length);
  if (resumen.errores.length) console.log(JSON.stringify(resumen.errores, null, 1));

  console.log('\n=== GRUPOS CON REVISIÓN MANUAL (documentos genéricos) ===');
  console.log(JSON.stringify(resumen.gruposConRevisionManual.map((g) => ({ codigoProceso: g.codigoProceso, entidad: g.entidad, nombresGenericos: g.documentos.nombresRevisionManual })), null, 1));

  fs.writeFileSync('ops/output/plan-limpieza-duplicados.json', JSON.stringify(resumen, null, 2));
  await altaria.end();
})().catch((e) => { console.error('ERROR FATAL:', e.message, e.stack); process.exit(1); });
