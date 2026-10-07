/**
 * Ajuste "ESTADO FINAL SQR — EN PROCESO" — verifica en la fuente de
 * `ModuloSqr` (page.tsx) que la etiqueta de "Estado" usa comparación
 * ESTRICTA (`===true`/`===false`), nunca un `if` laxo que confundiría
 * `null`/`undefined` con "No presentado", y que el filtro `estadoFinalSqr`
 * es una dimensión separada de `filtroSqr` (sqrCerrada).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

function bloque(inicioMarcador: string, finMarcador: string, desde = 0): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador, desde);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}

describe('ModuloSqr — estadoFinalSqrLabel (Estado: En proceso / Presentado / No presentado)', () => {
  const bloqueLabel = bloque('const estadoFinalSqrLabel=(s:Solicitud)=>{', 'const btnFiltro=');

  it('usa comparación ESTRICTA con true/false, nunca truthy/falsy', () => {
    expect(bloqueLabel).toContain("s.estadoFinalSqr===true");
    expect(bloqueLabel).toContain("s.estadoFinalSqr===false");
    // Nunca un patrón laxo como `s.estadoFinalSqr?...`  que confundiría null.
    expect(bloqueLabel).not.toMatch(/estadoFinalSqr\s*\?\s*'?Presentado/);
  });

  it('null/undefined (sin decisión final) se muestra como "En proceso", nunca "No presentado"', () => {
    expect(bloqueLabel).toContain("label:'En proceso'");
  });

  it('true→Presentado, false→No presentado', () => {
    expect(bloqueLabel).toContain("label:'Presentado'");
    expect(bloqueLabel).toContain("label:'No presentado'");
  });
});

describe('ModuloSqr — filtro independiente por estadoFinalSqr (En proceso/Presentados/No presentados/Todos)', () => {
  it('existe un tipo/estado de filtro separado del de sqrCerrada', () => {
    expect(PAGE_TSX).toContain("type FiltroFinalSqr='todos'|'enProceso'|'presentados'|'noPresentados';");
    expect(PAGE_TSX).toContain('const [filtroFinal,setFiltroFinal]=React.useState<FiltroFinalSqr>');
  });

  it('el fetch al backend envía ambos filtros por separado (filtroSqr y filtroFinal)', () => {
    expect(PAGE_TSX).toContain("soloSqr:'true',filtroSqr:filtro,filtroFinal,");
  });
});

describe('GET /api/solicitudes — rama soloSqr aplica filtroFinal sobre estadoFinalSqr (nunca sobre sqrCerrada)', () => {
  const ROUTE_TS = readFileSync(join(__dirname, 'api/solicitudes/route.ts'), 'utf-8');

  it('enProceso → estadoFinalSqr IS NULL; presentados → =true; noPresentados → =false', () => {
    expect(ROUTE_TS).toContain(`if (filtroFinal === 'enProceso') conds.push(\`"estadoFinalSqr" IS NULL\`);`);
    expect(ROUTE_TS).toContain(`else if (filtroFinal === 'presentados') conds.push(\`"estadoFinalSqr" = true\`);`);
    expect(ROUTE_TS).toContain(`else if (filtroFinal === 'noPresentados') conds.push(\`"estadoFinalSqr" = false\`);`);
  });
});
