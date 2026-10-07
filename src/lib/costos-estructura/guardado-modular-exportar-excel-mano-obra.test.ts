/**
 * Ajuste "IMPLEMENTAR EXPORTACIÓN DE MANO DE OBRA USANDO EXACTAMENTE LA
 * PLANTILLA 'Mano de obra.xlsx'" — verificación de cableado en page.tsx
 * (texto fuente, mismo patrón que el resto de guardado-modular-*.test.ts).
 * El generador de Excel y la validación del DTO se prueban por separado en
 * src/lib/costos-mano-obra/exportacion/*.test.ts.
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

describe('§2/§18 — el botón "Exportar fichas a Excel" bloquea la exportación con cambios sin guardar', () => {
  it('exportarExcelManoObra revisa hayCambiosSinGuardarManoObra ANTES de llamar al endpoint', () => {
    const b = bloque('const exportarExcelManoObra=async()=>{', 'setExportandoExcelManoObra(true)');
    expect(b).toContain('if(hayCambiosSinGuardarManoObra){');
    expect(b).toContain('Guarde los cambios de Mano de Obra antes de generar el archivo Excel.');
  });
  it('exportarExcelManoObra exige un guardado previo (costoEstructuraIdActual y manoObraUltimaActualizacion)', () => {
    const b = bloque('const exportarExcelManoObra=async()=>{', 'setExportandoExcelManoObra(true)');
    expect(b).toContain('if(!costoEstructuraIdActual||!manoObraUltimaActualizacion){');
  });
  it('el botón "Exportar fichas a Excel" está junto a "Agregar cargo", en ese orden', () => {
    const inicio = PAGE_TSX.indexOf('Exportar fichas a Excel');
    const finAgregar = PAGE_TSX.indexOf('Agregar cargo', inicio);
    expect(inicio).toBeGreaterThan(-1);
    expect(finAgregar).toBeGreaterThan(inicio);
  });
});

describe('§3/§19 — el DTO se construye desde los objetos canónicos (finUnitario/calculoLaboralUnitario/referenciaUnitaria), nunca del DOM', () => {
  it('fichasExportacionManoObra usa grupo.finUnitario y grupo.calculoLaboralUnitario, no texto renderizado', () => {
    const b = bloque('const fichasExportacionManoObra=React.useMemo', 'const [exportandoExcelManoObra');
    expect(b).toContain('g.finUnitario');
    expect(b).toContain('g.calculoLaboralUnitario');
    expect(b).not.toContain('document.querySelector');
    expect(b).not.toContain('innerText');
    expect(b).not.toContain('innerHTML');
  });
  it('las fichas de cargo con más de una línea (finUnitario null) se omiten, nunca se inventa un unitario promedio', () => {
    const b = bloque('const fichasExportacionManoObra=React.useMemo', 'const [exportandoExcelManoObra');
    expect(b).toContain('.filter(g=>g.finUnitario&&g.calculoLaboralUnitario)');
  });
  it('cada total (totalRecargos/totalPrestaciones/etc.) se construye sumando sus propios conceptos canónicos, no se lee un total ya redondeado por separado', () => {
    const b = bloque('const fichasExportacionManoObra=React.useMemo', 'const [exportandoExcelManoObra');
    expect(b).toContain('fu.desgloseRecargos.valorRecargoNocturnoMensual+fu.desgloseRecargos.valorExtraDiurnaMensual');
    expect(b).toContain('fu.desglosePrestaciones.cesantiasMensuales+fu.desglosePrestaciones.primaMensual');
  });
  it('los turnantes se exportan como fichas tipo TURNANTE, usando g.finRef (gruposTurnantesManoObra) — la MISMA ficha completa de 42h que un cargo, con el factor aplicado solo al final', () => {
    const b = bloque('const fichasExportacionManoObra=React.useMemo', 'const [exportandoExcelManoObra');
    expect(b).toContain("gruposTurnantesManoObra.map((g,i)=>{");
    expect(b).toContain("tipo:'TURNANTE' as const");
    expect(b).toContain('g.finRef');
    expect(b).toContain('costoLaboralUnitario*g.cantidadTurnantesFisicos*factorProporcional');
  });
  it('Ajuste "833,00% en vez de 8,33%" — los porcentajes del motor (escala 0-100) se dividen entre 100 antes de escribirse en el DTO, para la celda con formato 0,00%', () => {
    const b = bloque('const fichasExportacionManoObra=React.useMemo', 'const [exportandoExcelManoObra');
    expect(b).toContain('porcentajeCesantias:fu.desglosePrestaciones.porcentajeCesantias/100');
    expect(b).toContain('porcentajeArl:fu.desgloseSeguridadSocial.porcentajeArl/100');
  });
});
