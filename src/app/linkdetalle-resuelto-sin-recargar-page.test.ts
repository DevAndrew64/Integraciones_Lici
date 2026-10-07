/**
 * Ajuste "LINK DEL PROCESO SOLO APARECÍA TRAS RECARGAR" (bug real reportado
 * por el usuario: "cuando consulto un proceso automáticamente busca el link
 * pero no lo está mostrando sino hasta que refresco la página").
 *
 * CAUSA RAÍZ: el GET por id de `/api/procesos` resuelve el `linkDetalle` bajo
 * demanda, lo persiste Y lo devuelve ya resuelto en esa misma respuesta (ver
 * `route.ts`, rama `idParam > 0 && registros.length === 1`, cubierta por
 * `route.resolverLinkBajoDemanda.test.ts`). Las tres fichas disparan justo esa
 * petición vía `traerProcesoPorId(dbIdResuelto)` para resolver la identidad
 * canónica del Proceso, pero del resultado solo leían `externalId`/`sourceKey`
 * y DESCARTABAN `linkDetalle`. Como el estado local de la ficha se captura una
 * sola vez al montar (`useState(sol)`) y el efecto que lo refresca aborta con
 * `if(!sol.id||sol.id<=0)return` (en Búsqueda la ficha se arma con `id:0`), el
 * enlace quedaba vacío. Al recargar sí aparecía, porque la resolución de la
 * visita anterior ya lo había persistido en BD: siempre con una visita de
 * retraso.
 *
 * CORRECCIÓN: aprovechar la respuesta que ya está en la mano — sin peticiones
 * nuevas — y volcar el `linkDetalle` resuelto al estado local, sin pisar el que
 * la ficha ya tuviera.
 *
 * Mismo patrón de texto fuente que el resto de *-page.test.ts (sin harness de
 * render de componentes en este repo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');
const RESOLVER_PROCESO_FICHA = readFileSync(
  join(__dirname, '..', 'lib', 'procesos', 'resolver-proceso-ficha.ts'),
  'utf-8',
);

function extraerBloque(inicioMarker: string, finMarker: string): string {
  const inicio = PAGE_TSX.indexOf(inicioMarker);
  const fin = PAGE_TSX.indexOf(finMarker, inicio);
  if (inicio === -1 || fin === -1) throw new Error(`No se encontró el bloque ${inicioMarker} → ${finMarker}`);
  return PAGE_TSX.slice(inicio, fin);
}

const FICHAS: [string, string][] = [
  ['VistFicha', extraerBloque('function VistFicha(', 'function VistFichaBusqueda(')],
  ['VistFichaBusqueda', extraerBloque('function VistFichaBusqueda(', 'function DptoMultiSelect(')],
  ['VistFichaAsignacion', extraerBloque('function VistFichaAsignacion(', 'function ModuloAsignacionesPorValidar(')],
];

describe('1) El contrato de datos expone el link resuelto', () => {
  it('CandidatoProceso declara linkDetalle — sin él, la respuesta del GET por id no se puede leer con tipos', () => {
    expect(RESOLVER_PROCESO_FICHA).toMatch(/linkDetalle\?:\s*string\s*\|\s*null;/);
  });
});

describe('2) Las tres fichas aplican el linkDetalle que devuelve el GET por id', () => {
  it.each(FICHAS)('%s lee p.linkDetalle del resultado de traerProcesoPorId', (_nombre, bloque) => {
    expect(bloque).toContain("const linkResuelto=String(p?.linkDetalle??'').trim();");
  });

  it.each(FICHAS)('%s vuelca el link al estado local de la ficha (no solo a la identidad)', (_nombre, bloque) => {
    expect(bloque).toMatch(/if\(linkResuelto\)set(SolActual|SolLocal)\(prev=>/);
  });

  it.each(FICHAS)('%s aplica el link en el MISMO .then que ya resuelve la identidad, sin pedir nada extra', (_nombre, bloque) => {
    const then = bloque.slice(
      bloque.indexOf('traerProcesoPorId(dbIdResuelto).then(p=>{'),
      bloque.indexOf('}).catch(()=>{if(activo)setIdentidadProcesoResuelto(null);});'),
    );
    expect(then).toContain('setIdentidadProcesoResuelto(');
    expect(then).toContain('linkResuelto');
    // Ni un fetch adicional: el link viaja en la respuesta ya solicitada.
    expect(then).not.toContain('fetch(');
  });
});

describe('3) Nunca pisa un enlace que la ficha ya tenga', () => {
  it.each(FICHAS)('%s conserva el estado previo si ya había linkDetalle', (_nombre, bloque) => {
    // `prev` devuelto tal cual (misma referencia) ⇒ React no re-renderiza.
    expect(bloque).toMatch(
      /set(SolActual|SolLocal)\(prev=>String\(prev\.linkDetalle\?\?''\)\.trim\(\)\?prev:\{\.\.\.prev,linkDetalle:linkResuelto\}\)/,
    );
  });

  it.each(FICHAS)('%s no aplica nada cuando el link resuelto viene vacío', (_nombre, bloque) => {
    expect(bloque).toContain('if(linkResuelto)set');
  });
});

describe('4) Regresión — el resultado del GET por id no vuelve a descartarse', () => {
  it('ninguna ficha se queda leyendo solo externalId/sourceKey del resultado', () => {
    for (const [nombre, bloque] of FICHAS) {
      const inicio = bloque.indexOf('traerProcesoPorId(dbIdResuelto).then(p=>{');
      expect(inicio, `${nombre} ya no dispara traerProcesoPorId — revisar este test`).toBeGreaterThan(-1);
      const then = bloque.slice(inicio, bloque.indexOf('}).catch(', inicio));
      expect(then, `${nombre} volvió a descartar el linkDetalle resuelto`).toContain('linkDetalle');
    }
  });
});
