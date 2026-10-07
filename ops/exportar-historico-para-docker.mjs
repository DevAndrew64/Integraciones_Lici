#!/usr/bin/env node
/**
 * Exporta el histórico de Proceso/Solicitud/Notificacion (y tablas hijas de
 * Proceso) desde altaria, para poblar por primera vez la base propia del
 * Docker de la empresa (http://10.152.0.19:3000/) ANTES de activar su sync
 * de Data API hacia adelante.
 *
 * Alcance intencional: solo las tablas del flujo de procesos/solicitudes
 * (lo que Data API sincroniza + lo que el equipo gestiona sobre eso). NO
 * incluye el módulo de mano de obra (SolicitudManoObra y afines) ni
 * catálogos/simulaciones — eso depende de catálogos propios (CatalogoCargo,
 * etc.) que no forman parte de este alcance y se trataría aparte si se
 * necesita.
 *
 * Orden de tablas: Proceso primero (raíz), luego sus hijas reales (FK
 * ON DELETE CASCADE), luego las que solo referencian procesoId sin FK
 * real (Solicitud, Notificacion, ProcesoNuevo, DeletedSolicitud) — el
 * importador respeta este mismo orden al insertar.
 *
 * Solo lectura sobre altaria. No escribe nada.
 *
 * Uso:
 *   node ops/exportar-historico-para-docker.mjs
 */
import { createRequire } from 'module';
import { writeFileSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const require = createRequire(process.cwd() + '/node_modules/index.js');
const { Pool } = require('pg');

function leerUrl(path, varName) {
  const contenido = readFileSync(path, 'utf8');
  const linea = contenido.split('\n').find((l) => l.startsWith(`${varName}=`));
  if (!linea) throw new Error(`${varName} no encontrada en ${path}`);
  return linea.slice(varName.length + 1).trim().replace(/^"(.*)"$/, '$1');
}

const DATABASE_URL = process.env.DATABASE_URL || leerUrl('.env.local', 'DATABASE_URL');
const host = (() => { try { return new URL(DATABASE_URL).host; } catch { return '<no parseable>'; } })();
console.log(`Conectando (solo lectura) — host: ${host}`);

const pool = new Pool({ connectionString: DATABASE_URL, max: 3 });

const TABLAS = [
  'Proceso',
  'ProcesoDetalleSecop',
  'ProcesoCronogramaSecop',
  'ProcesoDocumentoSecop',
  'ProcesoSnapshotSecop',
  'ProcesoNuevo',
  'Solicitud',
  'Notificacion',
  'DeletedSolicitud',
];

(async () => {
  const paquete = { generadoEn: new Date().toISOString(), origenHost: host, tablas: {} };
  let totalFilas = 0;

  for (const tabla of TABLAS) {
    const { rows } = await pool.query(`SELECT * FROM "${tabla}" ORDER BY id`);
    paquete.tablas[tabla] = rows;
    totalFilas += rows.length;
    console.log(`  ${tabla}: ${rows.length} filas`);
  }

  const json = JSON.stringify(paquete);
  const gz = gzipSync(Buffer.from(json, 'utf8'));
  const ruta = 'ops/output/historico-completo-para-docker.json.gz';
  writeFileSync(ruta, gz);
  const hash = createHash('sha256').update(gz).digest('hex');

  console.log(`\nTotal filas exportadas: ${totalFilas}`);
  console.log(`Paquete: ${ruta} (${(gz.length / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`SHA-256: ${hash}`);

  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
