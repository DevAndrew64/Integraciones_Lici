/**
 * FASE B.4.5 — "rutas críticas": clasificación explícita OFF/ON de cada
 * ruta de adquisición y del whitelist de n8n. Estático (lee el código
 * fuente) + comportamiento puro del whitelist. NO monta handlers Next.
 *
 * Contrato REPO SHARE-READY (B5):
 *   El pipeline legacy NO es alcanzable en ningún modo. Cada ruta de
 *   adquisición pasa por la fachada (o por el flag directo, detalle-unspsc)
 *   y cae en A (Data API) o B (409/410 / migrado / deshabilitado).
 *   El token n8n desbloquea EXCLUSIVAMENTE la ingestión RAG, nunca
 *   adquisición, con independencia del flag.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { rutasTokenN8nEfectivas, RUTAS_TOKEN_N8N } from '../../../proxy.js';

const RAIZ = resolve(__dirname, '../../../..');
const leer = (rel: string) => {
  const p = resolve(RAIZ, rel);
  expect(existsSync(p), `falta ${rel}`).toBe(true);
  return readFileSync(p, 'utf8');
};

/** Ruta de adquisición → (categoría con flag ON, señal que debe estar en el código). */
const CLASIFICACION: Record<string, { categoria: 'A' | 'B'; señales: RegExp[] }> = {
  'src/app/api/procesos/sync/route.ts': {
    categoria: 'A',
    // masa = A (fachada); dirigida (soloEste) = B 409 vía OperacionMigradaDataApiError
    señales: [/fachadaSync/, /OperacionMigradaDataApiError/, /error\.httpStatus/],
  },
  'src/app/api/procesos/sync-profundo/route.ts': {
    categoria: 'A',
    señales: [/fachadaSync\.sincronizarProcesos\(/, /fullResync:\s*true/, /OperacionMigradaDataApiError/],
  },
  'src/app/api/procesos/actualizar-ficha/route.ts': {
    // B.4.5 — categoría A: actualización puntual REAL vía Data API
    // (implDataApi.actualizarFichaProceso → resolverDestinoRuntime → bundle →
    // aplicarBundleCanonico). Ya NO responde 409 por "migrado".
    categoria: 'A',
    señales: [/fachadaSync\.actualizarFichaProceso/, /rFachada\.datos/],
  },
  'src/app/api/procesos/resolver-link-detalle/route.ts': {
    categoria: 'B',
    señales: [/ESTADO_MIGRADO_DATA_API/, /status:\s*410/],
  },
  'src/app/api/admin/resolver-links-batch/route.ts': {
    categoria: 'B',
    // B5 — ya no hay rama 'legacy': el endpoint solo informa estado
    // (deshabilitado o migrado a la Data API) y cierra el stream.
    señales: [/modoSyncRuntime\(/, /MENSAJE_SYNC_DESHABILITADO/, /resoluci[oó]n de enlaces está migrada/],
  },
  'src/app/api/secop/detalle/route.ts': {
    categoria: 'B',
    señales: [/OperacionMigradaDataApiError/, /status:\s*error\.httpStatus/],
  },
  'src/app/api/procesos/detalle-unspsc/route.ts': {
    categoria: 'B',
    // B5 — neutralizada: sin fetch al proveedor, sin flag; caché de BD o 410 migrada.
    señales: [/status:\s*410/, /migrado:\s*true/],
  },
};

/** Patrones de import legacy de adquisición prohibidos en un entrypoint. */
const LEGACY_PROHIBIDO: RegExp[] = [
  /from\s+['"]@\/lib\/resolver-link-detalle['"]/,
  /from\s+['"]@\/lib\/resolver-link-real['"]/,
  /from\s+['"]@\/lib\/secop\/[a-z0-9-]+['"]/,
  /import\s*\{[^}]*\bsincronizarProcesos\b[^}]*\}\s*from\s+['"]@\/lib\/procesos-sync['"]/,
  /import\s*\{[^}]*\bactualizarFichaPuntual\b[^}]*\}\s*from\s+['"]@\/lib\/procesos\/actualizar-ficha-puntual['"]/,
];

describe('B.4.5 — clasificación OFF/ON de rutas de adquisición', () => {
  for (const [rel, { categoria, señales }] of Object.entries(CLASIFICACION)) {
    it(`${rel} — categoría ${categoria}: no importa legacy de adquisición`, () => {
      const src = leer(rel);
      const infracciones = LEGACY_PROHIBIDO.filter((re) => re.test(src)).map(String);
      expect(infracciones, `import legacy en ${rel}`).toEqual([]);
    });

    it(`${rel} — categoría ${categoria}: lleva las señales del comportamiento con flag ON`, () => {
      const src = leer(rel);
      const faltan = señales.filter((re) => !re.test(src)).map(String);
      expect(faltan, `señales ausentes en ${rel}`).toEqual([]);
    });
  }

  it('todas menos detalle-unspsc pasan por la fachada; detalle-unspsc queda neutralizada (solo prisma)', () => {
    for (const rel of Object.keys(CLASIFICACION)) {
      const src = leer(rel);
      if (rel.endsWith('detalle-unspsc/route.ts')) {
        // Neutralizada: ni fachada ni flag ni proveedor — solo lee la BD propia.
        expect(/from\s+['"]@\/lib\/prisma['"]/.test(src)).toBe(true);
        expect(/runtimeFlag|col\.licitaciones\.info|\bfetch\s*\(/.test(src)).toBe(false);
      } else {
        expect(/@\/lib\/data-api\/sync\/(fachadaSync|modo)/.test(src)).toBe(true);
      }
    }
  });
});

describe('B5 — whitelist de token n8n: RAG-only, con independencia del flag', () => {
  const ON = { DATA_API_RUNTIME_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv;
  const OFF = {} as unknown as NodeJS.ProcessEnv;

  it('siempre es exactamente { /api/lectura/rag/ingestar } (OFF y ON)', () => {
    for (const env of [OFF, ON, undefined]) {
      const w = rutasTokenN8nEfectivas(env);
      expect(w).toBe(RUTAS_TOKEN_N8N);
      expect([...w]).toEqual(['/api/lectura/rag/ingestar']);
    }
  });

  it('n8n NUNCA desbloquea una ruta de adquisición de procesos', () => {
    for (const env of [OFF, ON]) {
      const w = rutasTokenN8nEfectivas(env);
      for (const r of [
        '/api/procesos/sync',
        '/api/procesos/sync-profundo',
        '/api/procesos/actualizar-documentos',
        '/api/procesos/actualizar-cronograma',
        '/api/procesos/resolver-link-detalle',
      ]) {
        expect(w.has(r), r).toBe(false);
      }
    }
  });
});
