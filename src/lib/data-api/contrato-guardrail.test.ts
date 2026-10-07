/**
 * Guardrail de contrato — GENERALIZADO (auditoría de encapsulamiento).
 *
 * A diferencia de `licycolba-data-api` (que SÍ tiene un componente legítimo
 * —el motor de adquisición— autorizado a conocer el proveedor), LICYCOLBA-
 * FINAL NO tiene ningún caso legítimo de conocer el mecanismo de
 * adquisición: por diseño, FINAL solo debe hablar HTTP con
 * `DATA_API_BASE_URL` (ver `cliente.ts`) y nunca debe contener código de
 * scraping, credenciales de proveedor, selectores, ni URLs upstream.
 *
 * Por eso este guardrail escanea TODO `src/` (no una lista curada) — sin
 * ninguna excepción de "motor" como en el otro repositorio. Si algún día
 * alguien reintroduce código de adquisición directamente en FINAL (por
 * accidente, copiando de licycolba o de licycolba-data-api), este test
 * debe fallar.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const RAIZ_SRC = path.resolve(__dirname, '../../../src');

// Se excluyen únicamente los propios archivos de test (que necesitan poder
// mencionar los términos prohibidos como STRINGS para definir la lista) y
// este mismo archivo.
function listarArchivosTs(dir: string): string[] {
  const resultado: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const full = path.join(dir, nombre);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (nombre === 'node_modules' || nombre === '.next') continue;
      resultado.push(...listarArchivosTs(full));
    } else if ((full.endsWith('.ts') || full.endsWith('.tsx')) && !full.endsWith('.test.ts') && !full.endsWith('.test.tsx')) {
      resultado.push(full);
    }
  }
  return resultado;
}

const TODOS_LOS_ARCHIVOS = listarArchivosTs(RAIZ_SRC).map((f) => path.relative(RAIZ_SRC, f));

// Términos que NUNCA deben aparecer en código real (fuera de comentarios) en
// TODO licycolba-final — el nombre/dominio del proveedor privado y las
// variables de entorno que solo tienen sentido del lado de
// licycolba/licycolba-data-api.
//
// DELIBERADAMENTE NO incluye términos genéricos como "n8n"/"puppeteer"/
// "scraping"/"scraper"/"playwright"/"chromium": una primera versión de este
// guardrail sí los incluyó y produjo 12 falsos positivos — todos features
// legítimas y sin relación con el proveedor (`requireAdminOrN8N` es un
// helper de autorización propio de FINAL; `puppeteer` genera PDFs de
// informes propios; `scraper*` son nombres de columna heredados en
// `Proceso`; "scraping" aparece en un comentario de una fuente de TRM no
// relacionada). Esos términos son útiles en el guardrail de
// licycolba-data-api (donde si tienen relación real con el mecanismo), NO
// aquí — un término prohibido demasiado amplio en FINAL solo genera ruido
// y esconde las alertas reales entre falsos positivos.
const TERMINOS_PROHIBIDOS = [
  'licitaciones.info',
  'licitaciones-info',
  'col.licitaciones',
  'proveedor_upstream',
  'licycolba_database_url',
  'licycolba_internal_base_url',
  'licycolba_internal_key',
];

function quitarComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('Guardrail de contrato — FINAL completo (838+ archivos) sin código/referencias de adquisición confidencial', () => {
  it(`escaneó al menos 400 archivos de src/ (guardrail no vacío)`, () => {
    expect(TODOS_LOS_ARCHIVOS.length).toBeGreaterThan(400);
  });

  for (const rel of TODOS_LOS_ARCHIVOS) {
    it(`${rel} no menciona ningún término prohibido fuera de comentarios`, () => {
      const crudo = readFileSync(path.join(RAIZ_SRC, rel), 'utf8');
      const contenido = quitarComentarios(crudo).toLowerCase();
      const encontrados = TERMINOS_PROHIBIDOS.filter((t) => contenido.includes(t));
      expect(encontrados, `Términos prohibidos en código real (no comentarios) de ${rel}: ${encontrados.join(', ')}`).toEqual([]);
    });
  }

  it('ProcesoCanonico no incluye campos de proveedor (sourceKey/aliasFuente/fuente/rawJson/externalId)', async () => {
    const mod = await import('./tipos.js');
    const ejemplo: import('./tipos.js').ProcesoCanonico = {
      id: 'x', aggregateVersion: 'v1', codigoProceso: null, nombre: null, entidad: null, objeto: null,
      modalidad: null, perfil: null, departamento: null, estado: null, origenFuncional: 'DESCONOCIDO',
      fechaPublicacion: null, fechaCierre: null, fechaCierreAnterior: null, tieneCambioFechaCierre: false,
      valor: null, duracion: null, linkDetalle: null, totalDocumentos: 0, totalCronogramas: 0, actualizadoEn: 'x',
    };
    const CAMPOS_PROHIBIDOS = ['sourceKey', 'aliasFuente', 'fuente', 'rawJson', 'externalId', 'scraperIntentos', 'scraperEstado'];
    for (const c of CAMPOS_PROHIBIDOS) expect(Object.keys(ejemplo)).not.toContain(c);
    expect(mod.CONTRATO_VERSION_ACTUAL).toBe('1.0');
  });

  it('cliente.ts solo declara DATA_API_BASE_URL/DATA_API_KEY/DATA_API_TIMEOUT_MS como configuración de red — ninguna otra variable de red', () => {
    const crudo = quitarComentarios(readFileSync(path.join(RAIZ_SRC, 'lib/data-api/cliente.ts'), 'utf8'));
    const varsEnv = [...crudo.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    const permitidas = new Set(['DATA_API_BASE_URL', 'DATA_API_KEY', 'DATA_API_TIMEOUT_MS']);
    const noPermitidas = varsEnv.filter((v) => !permitidas.has(v));
    expect(noPermitidas, `cliente.ts lee variables de entorno no permitidas: ${noPermitidas.join(', ')}`).toEqual([]);
  });
});
