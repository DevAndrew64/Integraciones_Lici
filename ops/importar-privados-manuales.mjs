// Importador de Procesos privados que licycolba registró manualmente (el
// "externalId" que traen es un consecutivo INTERNO de licycolba, no
// evidencia de que Data API los vaya a sincronizar — confirmado por el
// usuario). Dos grupos:
//   Grupo A: no existe Solicitud en altaria -> crear Proceso (+ Solicitud
//            si existe en licycolba con gestión real).
//   Grupo B: YA existe una Solicitud en altaria pero apunta a un Proceso
//            "fantasma" (sin codigoProceso) -> crear/completar el Proceso
//            real y reparar procesoId de la Solicitud existente, SIN
//            tocar estadoSolicitud/asignaciones/demás campos de gestión.
//
// Nunca toca casos ambiguos (misma llave codigoProceso+entidad con 2+
// Solicitudes en altaria). Dry-run por defecto; requiere --apply.
import { createRequire } from 'module';
import fs from 'node:fs';
const require = createRequire(process.cwd() + '/node_modules/index.js');
const { Pool } = require('pg');

const APLICAR = process.argv.includes('--apply');

function readUrl(path, varName) {
  const txt = fs.readFileSync(path, 'utf8');
  const m = txt.match(new RegExp(`^${varName}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm'));
  return m[1];
}
const licycolba = new Pool({ connectionString: readUrl('C:/Users/ANA-LICITACIONES3/licycolba/.env.local', 'DATABASE_URL'), max: 2 });
const altaria = new Pool({ connectionString: readUrl('.env.local', 'DATABASE_URL'), max: 2 });

function normalizarTexto(s) { return String(s ?? '').trim().toUpperCase().normalize('NFD').replace(/\p{Mn}/gu, '').replace(/\s+/g, ' '); }
function construirLlave(c, e) { return normalizarTexto(c) + '||' + normalizarTexto(e); }

async function crearProcesoDesdeLicycolba(client, procesoLic) {
  const cols = {
    codigoProceso: procesoLic.codigoProceso,
    nombre: procesoLic.nombre,
    entidad: procesoLic.entidad,
    objeto: procesoLic.objeto,
    fuente: procesoLic.fuente || null,
    aliasFuente: procesoLic.aliasFuente || null,
    modalidad: procesoLic.modalidad,
    perfil: procesoLic.perfil,
    departamento: procesoLic.departamento,
    estadoFuente: procesoLic.estadoFuente,
    fechaPublicacion: procesoLic.fechaPublicacion,
    fechaVencimiento: procesoLic.fechaVencimiento,
    valor: procesoLic.valor,
    linkDetalle: procesoLic.linkDetalle,
    linkSecop: procesoLic.linkSecop,
    linkSecopReg: procesoLic.linkSecopReg,
    sourceKey: procesoLic.sourceKey,
    origenFuncional: 'MANUAL',
    disponibleDataApi: false,
    duracion: procesoLic.duracion,
    unspsc: procesoLic.unspsc,
    createdAt: procesoLic.createdAt,
    updatedAt: procesoLic.updatedAt,
  };
  const keys = Object.keys(cols);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(',');
  const r = await client.query(
    `INSERT INTO "Proceso" (${keys.map(k => `"${k}"`).join(',')}) VALUES (${placeholders}) RETURNING id`,
    keys.map(k => cols[k])
  );
  return r.rows[0].id;
}

function solColsDesde(solicitudLic, procesoLic, procesoIdNuevo) {
  return {
    procesoId: procesoIdNuevo,
    procesoSourceKey: procesoLic.sourceKey,
    codigoProceso: solicitudLic.codigoProceso,
    nombreProceso: solicitudLic.nombreProceso,
    entidad: solicitudLic.entidad,
    objeto: solicitudLic.objeto,
    fuente: solicitudLic.fuente,
    aliasFuente: solicitudLic.aliasFuente,
    modalidad: solicitudLic.modalidad,
    perfil: solicitudLic.perfil,
    departamento: solicitudLic.departamento,
    estadoFuente: solicitudLic.estadoFuente,
    fechaPublicacion: solicitudLic.fechaPublicacion,
    fechaVencimiento: solicitudLic.fechaVencimiento,
    valor: solicitudLic.valor,
    linkDetalle: solicitudLic.linkDetalle,
    linkSecop: solicitudLic.linkSecop,
    linkSecopReg: solicitudLic.linkSecopReg,
    estadoSolicitud: solicitudLic.estadoSolicitud,
    observacion: solicitudLic.observacion,
    usuarioRegistro: solicitudLic.usuarioRegistro,
    emailRegistro: solicitudLic.emailRegistro,
    cargoRegistro: solicitudLic.cargoRegistro,
    entidadRegistro: solicitudLic.entidadRegistro,
    asignaciones: solicitudLic.asignaciones,
    ciudad: solicitudLic.ciudad,
    docData: solicitudLic.docData,
    fechaCierre: solicitudLic.fechaCierre,
    plataforma: solicitudLic.plataforma,
    aprobador: solicitudLic.aprobador,
    procData: solicitudLic.procData,
    procStep: solicitudLic.procStep,
    revisor: solicitudLic.revisor,
    sede: solicitudLic.sede,
    causalCierre: solicitudLic.causalCierre,
    obsData: solicitudLic.obsData,
    fechaAperturaSqr: solicitudLic.fechaAperturaSqr,
    fechaCierreSqr: solicitudLic.fechaCierreSqr,
    resultadoFinal: solicitudLic.resultadoFinal,
    sqrCerrada: solicitudLic.sqrCerrada,
    sqrCreada: solicitudLic.sqrCreada,
    sqrError: solicitudLic.sqrError,
    sqrNumero: solicitudLic.sqrNumero,
    sqrCierreEstado: solicitudLic.sqrCierreEstado,
    estadoFinalSqr: solicitudLic.estadoFinalSqr,
    origenSolicitud: solicitudLic.origenSolicitud || 'Comercial',
    correoContacto: solicitudLic.correoContacto,
    direccionContacto: solicitudLic.direccionContacto,
    nitContacto: solicitudLic.nitContacto,
    personaContacto: solicitudLic.personaContacto,
    telefonoContacto: solicitudLic.telefonoContacto,
    duracion: solicitudLic.duracion,
    fechaEntregaInfo: solicitudLic.fechaEntregaInfo,
    observacionesSeguimiento: solicitudLic.observacionesSeguimiento,
    externalId: null,
    createdAt: solicitudLic.createdAt,
    updatedAt: solicitudLic.updatedAt,
  };
}

(async () => {
  const reporte = { grupoA: [], grupoB: [], omitidos: [], errores: [] };
  console.log(`=== MODO: ${APLICAR ? 'APLICAR (escribe en altaria)' : 'DRY-RUN (solo lectura, no escribe nada)'} ===\n`);

  const faltanCompleto = JSON.parse(fs.readFileSync('ops/output/faltan-privados.json', 'utf8'));
  // Descartar filas basura de licycolba (codigoProceso null / entidad vacía) — no son casos reales.
  const faltan = faltanCompleto.filter(r => r.codigoProceso && r.entidad);
  console.log(`Universo total en faltan-privados.json: ${faltanCompleto.length} (descartadas ${faltanCompleto.length - faltan.length} filas basura sin codigoProceso/entidad)`);

  const solAlt = (await altaria.query(`SELECT id, "codigoProceso", entidad, "estadoSolicitud", "procesoId" FROM "Solicitud"`)).rows;
  const solPorLlave = new Map();
  for (const s of solAlt) { const k = construirLlave(s.codigoProceso, s.entidad); solPorLlave.set(k, (solPorLlave.get(k) || []).concat(s)); }

  const grupoBCandidatos = [];
  const grupoACandidatos = [];
  for (const f of faltan) {
    const k = construirLlave(f.codigoProceso, f.entidad);
    const sols = solPorLlave.get(k);
    if (sols && sols.length === 1) grupoBCandidatos.push({ f, sol: sols[0] });
    else if (sols && sols.length > 1) reporte.omitidos.push(`AMBIGUO (${sols.length} Solicitudes en altaria con misma llave): ${f.codigoProceso} / ${f.entidad}`);
    else grupoACandidatos.push(f);
  }

  console.log(`Grupo A candidatos (crear Proceso, sin Solicitud previa en altaria): ${grupoACandidatos.length}`);
  console.log(`Grupo B candidatos (reparar Proceso fantasma + Solicitud ya existente): ${grupoBCandidatos.length}`);
  console.log(`Omitidos por ambigüedad: ${reporte.omitidos.length}\n`);

  // ---------- GRUPO A ----------
  console.log('--- GRUPO A ---');
  for (const f of grupoACandidatos) {
    const procesoLic = (await licycolba.query(`SELECT * FROM "Proceso" WHERE id = $1`, [f.id])).rows[0];
    if (!procesoLic) { reporte.errores.push(`Grupo A: ${f.codigoProceso} no encontrado en licycolba por id ${f.id}`); continue; }
    const solicitudLic = (await licycolba.query(`SELECT * FROM "Solicitud" WHERE "codigoProceso" = $1 AND entidad = $2`, [f.codigoProceso, f.entidad])).rows[0] ?? null;

    const yaExiste = await altaria.query(`SELECT id FROM "Proceso" WHERE "sourceKey" = $1`, [procesoLic.sourceKey]);
    if (yaExiste.rows.length) { reporte.omitidos.push(`Grupo A: ${f.codigoProceso} YA EXISTE en altaria (sourceKey=${procesoLic.sourceKey}), se omite`); continue; }

    if (!APLICAR) {
      reporte.grupoA.push({ codigoProceso: f.codigoProceso, entidad: f.entidad, sourceKey: procesoLic.sourceKey, conSolicitudLicycolba: !!solicitudLic, estadoSolicitudLicycolba: solicitudLic?.estadoSolicitud ?? null });
      continue;
    }
    const client = await altaria.connect();
    try {
      await client.query('BEGIN');
      const procesoIdNuevo = await crearProcesoDesdeLicycolba(client, procesoLic);
      let solicitudIdNueva = null;
      if (solicitudLic) {
        const solCols = solColsDesde(solicitudLic, procesoLic, procesoIdNuevo);
        const CAMPOS_JSONB = ['asignaciones', 'docData', 'procData', 'obsData', 'observacionesSeguimiento'];
        for (const campo of CAMPOS_JSONB) {
          if (solCols[campo] !== null && solCols[campo] !== undefined) solCols[campo] = JSON.stringify(solCols[campo]);
        }
        const keys = Object.keys(solCols);
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(',');
        const r = await client.query(`INSERT INTO "Solicitud" (${keys.map(k => `"${k}"`).join(',')}) VALUES (${placeholders}) RETURNING id`, keys.map(k => solCols[k]));
        solicitudIdNueva = r.rows[0].id;
      }
      await client.query('COMMIT');
      reporte.grupoA.push({ codigoProceso: f.codigoProceso, procesoIdNuevo, solicitudIdNueva, aplicado: true });
      console.log(`  [APLICADO] ${f.codigoProceso} -> Proceso id=${procesoIdNuevo}${solicitudIdNueva ? `, Solicitud id=${solicitudIdNueva}` : ''}`);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      reporte.errores.push(`Grupo A: ${f.codigoProceso} ERROR: ${e.message}`);
      console.error(`  [ERROR] ${f.codigoProceso}: ${e.message}`);
    } finally { client.release(); }
  }

  // ---------- GRUPO B ----------
  console.log('\n--- GRUPO B ---');
  for (const { f, sol } of grupoBCandidatos) {
    const yaExiste = await altaria.query(`SELECT id, "codigoProceso" FROM "Proceso" WHERE "sourceKey" = $1`, [f.sourceKey]);
    if (yaExiste.rows.length && yaExiste.rows[0].codigoProceso) { reporte.omitidos.push(`Grupo B: ${f.codigoProceso} YA tiene Proceso real en altaria, se omite`); continue; }
    const procesoLic = (await licycolba.query(`SELECT * FROM "Proceso" WHERE id = $1`, [f.id])).rows[0];
    if (!procesoLic) { reporte.errores.push(`Grupo B: ${f.codigoProceso} no encontrado en licycolba por id ${f.id}`); continue; }

    if (!APLICAR) {
      reporte.grupoB.push({ codigoProceso: f.codigoProceso, entidad: f.entidad, solicitudIdAltaria: sol.id, estadoSolicitud: sol.estadoSolicitud, procesoIdActualFantasma: sol.procesoId, accion: yaExiste.rows.length ? 'completar Proceso fantasma existente in-place' : 'crear Proceso nuevo' });
      continue;
    }
    const client = await altaria.connect();
    try {
      await client.query('BEGIN');
      let procesoIdNuevo;
      if (yaExiste.rows.length) {
        await client.query(
          `UPDATE "Proceso" SET "codigoProceso"=$1,"nombre"=$2,objeto=$3,fuente=$4,"aliasFuente"=$5,modalidad=$6,perfil=$7,departamento=$8,"estadoFuente"=$9,"fechaPublicacion"=$10,"fechaVencimiento"=$11,valor=$12,"linkDetalle"=$13,"origenFuncional"='MANUAL',"updatedAt"=now() WHERE id=$14`,
          [procesoLic.codigoProceso, procesoLic.nombre, procesoLic.objeto, procesoLic.fuente, procesoLic.aliasFuente, procesoLic.modalidad, procesoLic.perfil, procesoLic.departamento, procesoLic.estadoFuente, procesoLic.fechaPublicacion, procesoLic.fechaVencimiento, procesoLic.valor, procesoLic.linkDetalle, yaExiste.rows[0].id]
        );
        procesoIdNuevo = yaExiste.rows[0].id;
      } else {
        procesoIdNuevo = await crearProcesoDesdeLicycolba(client, procesoLic);
      }
      await client.query(`UPDATE "Solicitud" SET "procesoId"=$1, "updatedAt"=now() WHERE id=$2`, [procesoIdNuevo, sol.id]);
      await client.query('COMMIT');
      reporte.grupoB.push({ codigoProceso: f.codigoProceso, procesoId: procesoIdNuevo, solicitudId: sol.id, aplicado: true });
      console.log(`  [APLICADO] ${f.codigoProceso} -> Proceso id=${procesoIdNuevo}, Solicitud id=${sol.id} reparada`);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      reporte.errores.push(`Grupo B: ${f.codigoProceso} ERROR: ${e.message}`);
      console.error(`  [ERROR] ${f.codigoProceso}: ${e.message}`);
    } finally { client.release(); }
  }

  console.log('\n=== RESUMEN ===');
  console.log('Grupo A:', reporte.grupoA.length);
  console.log('Grupo B:', reporte.grupoB.length);
  console.log('Omitidos:', reporte.omitidos.length);
  console.log('Errores:', reporte.errores.length);

  fs.writeFileSync('ops/output/reporte-importacion-privados-manuales.json', JSON.stringify(reporte, null, 2));

  await licycolba.end();
  await altaria.end();
})().catch(e => { console.error('ERROR FATAL:', e.message, e.stack); process.exit(1); });
