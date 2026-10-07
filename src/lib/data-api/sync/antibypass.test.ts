/**
 * TEST ESTÁTICO ANTI-BYPASS (REPO SHARE-READY / B5).
 *
 * El pipeline de adquisición legacy (scraping directo, `procesos-sync`,
 * `resolver-link-detalle`, `secop/*`, `actualizar-ficha-puntual`, cliente de
 * fuente histórica) fue RETIRADO del árbol. La única vía de adquisición es la
 * Data API, detrás de la fachada `fachadaSync`.
 *
 * Este test lee el código fuente de los entrypoints de runtime y falla si
 * alguno vuelve a importar ese pipeline, y comprueba que los módulos legacy ya
 * no existen en el repositorio.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const RAIZ = resolve(__dirname, '../../../..'); // .../licycolba-final

/** Entrypoints de runtime que NO deben tocar el legacy de adquisición. */
const ENTRYPOINTS = [
  'src/instrumentation.ts',
  'src/app/api/procesos/sync/route.ts',
  'src/app/api/procesos/sync-profundo/route.ts',
  'src/app/api/procesos/actualizar-ficha/route.ts',
  'src/app/api/procesos/resolver-link-detalle/route.ts',
  'src/app/api/admin/resolver-links-batch/route.ts',
  'src/app/api/secop/detalle/route.ts',
];

/** Módulos del pipeline legacy — retirados del árbol; ninguno debe reaparecer. */
const MODULOS_LEGACY_RETIRADOS = [
  'src/lib/procesos-sync.ts',
  'src/lib/resolver-link-detalle.ts',
  'src/lib/resolver-link-real.ts',
  'src/lib/procesos/actualizar-ficha-puntual.ts',
  'src/lib/data-api/sync/impl/implLegacy.ts',
  'src/lib/secop/extract-detalle.ts',
  'src/lib/secop/persist-detalle.ts',
  'src/lib/secop/browser.ts',
];

/** Imports prohibidos en cualquier archivo del repo (módulo o símbolo legacy). */
const PATRONES_PROHIBIDOS: { nombre: string; re: RegExp }[] = [
  { nombre: "'@/lib/resolver-link-detalle'", re: /['"]@\/lib\/resolver-link-detalle['"]/ },
  { nombre: "'@/lib/resolver-link-real'", re: /['"]@\/lib\/resolver-link-real['"]/ },
  { nombre: "'@/lib/procesos-sync'", re: /['"]@\/lib\/procesos-sync['"]/ },
  { nombre: "'@/lib/secop/*'", re: /['"]@\/lib\/secop\/[a-z0-9-]+['"]/ },
  { nombre: "'@/lib/procesos/actualizar-ficha-puntual'", re: /['"]@\/lib\/procesos\/actualizar-ficha-puntual['"]/ },
  { nombre: "'@/lib/data-api/sync/impl/implLegacy'", re: /implLegacy['"]/ },
];

function leer(rel: string): string {
  const p = resolve(RAIZ, rel);
  expect(existsSync(p), `no existe el entrypoint esperado: ${rel}`).toBe(true);
  return readFileSync(p, 'utf8');
}

describe('B5 — anti-bypass: los disparadores de runtime pasan por la fachada', () => {
  for (const rel of ENTRYPOINTS) {
    it(`${rel} NO importa el pipeline de adquisición legacy`, () => {
      const src = leer(rel);
      const infracciones = PATRONES_PROHIBIDOS.filter((p) => p.re.test(src)).map((p) => p.nombre);
      expect(infracciones, `bypass en ${rel}: ${infracciones.join(', ')}`).toEqual([]);
    });

    it(`${rel} referencia la fachada de sincronización`, () => {
      const src = leer(rel);
      expect(
        /from\s+['"]@\/lib\/data-api\/sync\/(fachadaSync|modo|jobSyncProcesos)['"]/.test(src) ||
          /import\(\s*['"]@\/lib\/data-api\/sync\/(fachadaSync|jobSyncProcesos)['"]\s*\)/.test(src),
        `${rel} no referencia @/lib/data-api/sync/{fachadaSync,modo,jobSyncProcesos}`,
      ).toBe(true);
    });
  }

  // `jobSyncProcesos` es la única indirección aceptada para `instrumentation.ts`:
  // debe enrutar por la fachada y no tocar el legacy.
  it('jobSyncProcesos.ts enruta por la fachada de sincronización', () => {
    const src = leer('src/lib/data-api/sync/jobSyncProcesos.ts');
    expect(/from\s+['"]\.\/fachadaSync['"]/.test(src)).toBe(true);
    const infracciones = PATRONES_PROHIBIDOS.filter((p) => p.re.test(src)).map((p) => p.nombre);
    expect(infracciones).toEqual([]);
  });

  it('los módulos del pipeline legacy ya NO existen en el árbol', () => {
    const presentes = MODULOS_LEGACY_RETIRADOS.filter((rel) => existsSync(resolve(RAIZ, rel)));
    expect(presentes, `módulos legacy que reaparecieron: ${presentes.join(', ')}`).toEqual([]);
  });

  it('las rutas de recálculo de fecha usan el módulo neutral fechas-cronograma (no procesos-sync)', () => {
    for (const rel of [
      'src/app/api/procesos/actualizar-cronograma/route.ts',
      'src/app/api/admin/proceso-recalcular-fecha/route.ts',
    ]) {
      if (!existsSync(resolve(RAIZ, rel))) continue;
      const src = readFileSync(resolve(RAIZ, rel), 'utf8');
      expect(/from\s+['"]@\/lib\/procesos\/fechas-cronograma['"]/.test(src), `${rel} no usa fechas-cronograma`).toBe(true);
      expect(/['"]@\/lib\/procesos-sync['"]/.test(src), `${rel} aún importa procesos-sync`).toBe(false);
    }
  });
});

describe('B5 — detalle-unspsc: SIN bypass directo al proveedor (neutralizada, 410 migrada)', () => {
  const REL = 'src/app/api/procesos/detalle-unspsc/route.ts';
  const src = () => readFileSync(resolve(RAIZ, REL), 'utf8');

  it('NO hace fetch a ninguna fuente externa (no hay `fetch(` en el archivo)', () => {
    expect(/\bfetch\s*\(/.test(src())).toBe(false);
  });

  it('NO maneja cookies ni cabeceras de sesión de un portal externo', () => {
    expect(/laravel_admin_session|XSRF-TOKEN|PDTLicita|set-cookie|process\.env\.[A-Z_]*_(TOKEN|SESSION|COOKIE)/i.test(src())).toBe(false);
  });

  it('sin caché en BD responde 410 (operación migrada a la Data API)', () => {
    expect(/status:\s*410/.test(src())).toBe(true);
    expect(/migrado:\s*true/.test(src())).toBe(true);
  });

  it('solo consulta la BD propia (prisma)', () => {
    expect(/from\s+['"]@\/lib\/prisma['"]/.test(src())).toBe(true);
  });
});

describe('B5 — instrumentation: sin crons de adquisición legacy; sync SOLO en modo data-api', () => {
  const src0 = () => readFileSync(resolve(RAIZ, 'src/instrumentation.ts'), 'utf8');

  it('registra el sync SOLO cuando el modo efectivo es data-api', () => {
    const src = src0();
    expect(/modoSyncRuntime\(\)/.test(src)).toBe(true);
    expect(/===\s*['"]data-api['"]/.test(src)).toBe(true);
  });

  it("NO contiene el paso legacy de resolver-links ni 'legacy' como modo", () => {
    const src = src0();
    expect(/resolver-link/i.test(src)).toBe(false);
    expect(/resolverLink/i.test(src)).toBe(false);
    expect(/['"]legacy['"]/.test(src)).toBe(false);
  });
});

describe('B5 — la fachada productiva NO alcanza implLegacy', () => {
  const FACHADA = 'src/lib/data-api/sync/fachadaSync.ts';
  const IMPL_DATA_API = 'src/lib/data-api/sync/impl/implDataApi.ts';

  it('fachadaSync.ts NO importa ni menciona implLegacy', () => {
    const src = leer(FACHADA);
    expect(/implLegacy/.test(src), 'fachadaSync menciona implLegacy').toBe(false);
  });

  it('los contratos de tipos vienen del módulo neutral contratosSync', () => {
    const src = leer(FACHADA);
    expect(/from\s+['"]\.\/impl\/contratosSync(?:\.js)?['"]/.test(src)).toBe(true);
  });

  it('implDataApi.ts tampoco menciona implLegacy', () => {
    const src = leer(IMPL_DATA_API);
    expect(/implLegacy/.test(src)).toBe(false);
  });

  it('fachadaSync.ts despacha exclusivamente a implDataApi', () => {
    const src = leer(FACHADA);
    expect(/from\s+['"]\.\/impl\/implDataApi(?:\.js)?['"]/.test(src)).toBe(true);
    expect(/implDataApi\./.test(src)).toBe(true);
  });
});
