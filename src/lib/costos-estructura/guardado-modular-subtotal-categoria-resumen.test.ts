/**
 * Ajuste "SUBTOTAL POR CATEGORÍA EN EL RESUMEN DE DOTACIÓN Y EPP" — la
 * sección de solo lectura (acordeón por cargo, fuera del modal de edición)
 * listaba las filas de cada categoría (Dotación femenina, EPP, etc.) y
 * saltaba directo al "TOTAL DOTACIÓN + EPP" general, sin mostrar el
 * subtotal de la categoría misma. Verificado por texto fuente (mismo
 * patrón que el resto de guardado-modular-*.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function bloque(inicioMarcador: string, finMarcador: string, desde = 0): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador, desde);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}

describe('renderGrupoDotEppSoloLectura — subtotal por categoría', () => {
  it('agrega una fila de subtotal al final de cada categoría, usando el mismo total ya calculado (totalGrupoDotEpp)', () => {
    const b = bloque('const renderGrupoDotEppSoloLectura=(titulo:string,g:DotGroup)=>{', '\n                const renderSujetoDotEppSoloLectura=');
    expect(b).toContain('Subtotal {titulo.toLowerCase()}');
    expect(b).toContain('{cop(totalGrupoDotEpp(g))}');
  });

  it('el subtotal aparece DESPUÉS de la última fila de productos (dentro del map), nunca antes', () => {
    const b = bloque('const renderGrupoDotEppSoloLectura=(titulo:string,g:DotGroup)=>{', '\n                const renderSujetoDotEppSoloLectura=');
    const idxMap = b.indexOf('g.rows.map(r=>(');
    const idxSubtotal = b.indexOf('Subtotal {titulo.toLowerCase()}');
    expect(idxSubtotal).toBeGreaterThan(idxMap);
  });

  it('no duplica el total general — "RESUMEN DOTACIÓN Y EPP" aparece UNA sola vez, al final (no por tarjeta de cargo)', () => {
    expect(PAGE_TSX).toContain('titulo="RESUMEN DOTACIÓN Y EPP"');
    const ocurrencias = (PAGE_TSX.match(/titulo="RESUMEN DOTACIÓN Y EPP"/g) ?? []).length;
    expect(ocurrencias).toBe(1);
  });
});
