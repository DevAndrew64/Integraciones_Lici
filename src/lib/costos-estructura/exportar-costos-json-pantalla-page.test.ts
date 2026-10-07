/**
 * "Exportar costos" manda al servidor el JSON con lo que la pantalla ya
 * calculó (decisión del usuario 2026-10-02: "lo correcto es lo que el usuario
 * puede ver"). Verificación de cableado en page.tsx (texto fuente, mismo
 * patrón que el resto de guardado-modular-*.test.ts); el contrato y el
 * Excel se prueban en exportacion/*.test.ts y api/.../exportar/route.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8').replace(/\r\n/g, '\n');

function bloque(inicioMarcador: string, finMarcador: string): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}

describe('construirCostosPantallaDto — solo valores que la pantalla ya calculó', () => {
  const b = bloque('function construirCostosPantallaDto():CostosPantallaDto{', 'async function exportarCostos(){');

  it('los totales son los mismos que muestra el panel de Resumen', () => {
    expect(b).toContain('manoObra:tarifaMensualTotalManoObra,');
    expect(b).toContain('insumos:totalMensualInsumos,');
    expect(b).toContain('maquinaria:maqTotal,');
    expect(b).toContain('serviciosNoContinuos:totalServiciosNoContinuos,');
    expect(b).toContain('valorAgregado:totalValorAgregado,');
    expect(b).toContain('administrativos:adminTotal,');
    expect(b).toContain('total:totalCostoInternoProceso,');
  });

  it('Administrativos usa las mismas funciones/valores de la pantalla (cantidad automática = trabajadores del servicio)', () => {
    expect(b).toContain('valorMensual:calcularValorMensualVariable(f,cantidadTrabajadoresServicio),');
    expect(b).toContain('totalVariables:totalVariablesAdministrativas,');
    expect(b).toContain('valorMensualPolizas:polizasCalculado.valorMensual,');
    expect(b).toContain('valorMensualImpuestos,');
  });

  it('EPP y Exámenes toman los totales por cargo y las filas de la pestaña, con las fórmulas por fila compartidas', () => {
    expect(b).toContain('totalUnitario:totalesDotacionEppPorSujeto.find(x=>x.lineaId===l.id)?.total??0,');
    expect(b).toContain('gruposActivosDeLinea(l.id)');
    expect(b).toContain('valorMensual:valorMesRow(r),');
    expect(b).toContain('totalUnitario:totalesExamCursosVacunasPorSujeto.find(x=>x.lineaId===l.id)?.totalUnitario??0,');
    // Valor mensual por fila: el que ya calculó la pantalla (mismo orden que el filtro por línea), sin fórmula propia.
    expect(b).toContain('const calculado=construirEntradaOtrosCostosLinea(l.id);');
    expect(b).toContain('valorMensual:mensual(calculado.examenes,i)');
    expect(b).toContain('valorMensual:mensual(calculado.cursos,i)');
    expect(b).toContain('valorMensual:mensual(calculado.vacunas,i)');
  });

  it('Insumos, Maquinaria y los cargos también salen de lo que muestra la pantalla (las filas de Valor agregado se marcan, no se excluyen del listado)', () => {
    expect(b).toContain('total:totalMensualInsumos,');
    expect(b).toContain('filas:insumosRows.map(r=>({');
    expect(b).toContain('subtotalAdquisicion:subtotalMensualAdquisicionMaq,');
    expect(b).toContain('subtotalMantenimiento:subtotalMensualMantenimientoMaq,');
    expect(b).toContain('filas:maqRows.map(r=>({');
    expect(b.match(/valorAgregado:esRecursoValorAgregado\(r\),/g)?.length).toBe(2);
    expect(b).toContain("cargos:Array.from(new Set(lineasManoObraDisponibles.filter(l=>l.origen==='manoObra').map(l=>l.nombre))),");
  });

  it('no recalcula con fórmulas propias (sin ×, ÷ ni Math.* sobre costos)', () => {
    expect(b).not.toMatch(/Math\.(floor|round|ceil)/);
    expect(b).not.toContain('r.cant*');
  });
});

describe('exportarCostos — envía el JSON y exige tener todo guardado', () => {
  const b = bloque('async function exportarCostos(){', '// ── ESTILOS');

  it('bloquea con CUALQUIER módulo con cambios sin guardar, nombrándolos', () => {
    expect(b).toContain('if(modulosConCambiosSinGuardar.length>0){');
    expect(b).toContain('Guarde los cambios de ${modulosConCambiosSinGuardar.join(\', \')} antes de generar el archivo Excel.');
  });

  it('manda manoObraDto y costosDto al endpoint', () => {
    expect(b).toContain('body:JSON.stringify({manoObraDto,costosDto:construirCostosPantallaDto()})');
  });
});

describe('Dotación/EPP — los grupos que participan del costeo salen de una sola función', () => {
  it('construirEntradaOtrosCostosLinea usa gruposActivosDeLinea (la misma que alimenta el JSON)', () => {
    const b = bloque('const construirEntradaOtrosCostosLinea=React.useCallback((lineaId:number)=>{', 'const totalGrupo=');
    expect(b).toContain('const gruposActivos=gruposActivosDeLinea(lineaId);');
  });
});
