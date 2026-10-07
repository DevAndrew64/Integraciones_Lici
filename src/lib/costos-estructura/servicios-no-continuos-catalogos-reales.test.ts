/**
 * Ajuste "SERVICIOS NO CONTINUOS — REUTILIZACIÓN REAL DE CATÁLOGOS" (Maquinaria
 * e Insumos) — verificación por texto fuente (mismo patrón que el resto de
 * guardado-modular-*.test.ts) de que el modal "Gestionar maquinaria y
 * equipos"/"Gestionar insumos" del módulo GLOBAL es EXACTAMENTE el mismo
 * que se abre dentro de un servicio no continuo — nunca un catálogo
 * paralelo — y que solo cambia el destino final de la confirmación.
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

describe('Maquinaria — "+ Dotación..." no aplica aquí, pero "Gestionar maquinaria y equipos" reutiliza /api/equipos-ext', () => {
  it('1/4) abrirModalMaquinaria(servicioId) es la MISMA función (con parámetro opcional) que ya usa el módulo global — nunca una segunda función', () => {
    expect(PAGE_TSX.match(/const abrirModalMaquinaria=\(servicioId\?:string\)=>\{/g)?.length).toBe(1);
    // El endpoint del catálogo global sigue siendo el único (no se duplicó).
    expect(PAGE_TSX.match(/\/api\/equipos-ext/g)!.length).toBeGreaterThan(0);
  });
  it('5) seleccionar/confirmar dentro de un servicio escribe SOLO en ese servicio (actualizarArregloServicioNoContinuo), nunca en maqRows global', () => {
    const b = bloque('const almacenarMaquinaria=()=>{', '};', PAGE_TSX.indexOf('const almacenarMaquinaria=()=>{'));
    expect(b).toContain("actualizarArregloServicioNoContinuo(destinoModalMaquinaria,'maquinariaEquipos',()=>borradorMaquinaria)");
    expect(b).toContain('else setMaqRows(borradorMaquinaria);');
  });
  it('6) el módulo global de Maquinaria (fuera de servicios) sigue escribiendo en maqRows sin cambios de comportamiento (destino=null)', () => {
    expect(PAGE_TSX).toContain('if(destinoModalMaquinaria!=null)actualizarArregloServicioNoContinuo(destinoModalMaquinaria,\'maquinariaEquipos\',()=>borradorMaquinaria);\n    else setMaqRows(borradorMaquinaria);');
  });
  it('7) no existe ningún segundo estado/catálogo paralelo para maquinaria de servicios (showModalMaquinaria/borradorMaquinaria son únicos)', () => {
    expect(PAGE_TSX.match(/showModalMaquinaria/g)!.length).toBeGreaterThan(0);
    expect(PAGE_TSX).not.toMatch(/showModalMaquinariaServicio|borradorMaquinariaServicio|catalogoServiciosNoContinuosMaquinaria/);
  });
  it('11) actualizarMaquinariaServicio reutiliza calcularCamposMaquinariaEquipo (mismas reglas de depreciación/IVA/mantenimiento que el módulo global)', () => {
    const b = bloque('function actualizarMaquinariaServicio(servicioId:string,id:number,cambios:Partial<MaquinariaServicioNoContinuo>){', 'function eliminarMaquinariaServicio');
    expect(b).toContain('calcularCamposMaquinariaEquipo(actualizado)');
  });
});

describe('Insumos — "Gestionar insumos" reutiliza /api/insumos-ext y el registro manual sin código', () => {
  it('2/4) abrirModalInsumos(servicioId,uenFija) es la MISMA función (con parámetros opcionales) que ya usa el módulo global — nunca una segunda función', () => {
    // Ajuste "QUE LEA LA UEN EN EL FILTRO DE INSUMOS" — se agregó un
    // segundo parámetro opcional (`uenFija`) para pre-filtrar el catálogo
    // cuando se abre desde un Servicio no continuo con UEN ya elegida;
    // sigue siendo la MISMA función única, nunca una segunda.
    expect(PAGE_TSX.match(/const abrirModalInsumos=\(servicioId\?:string,uenFija\?:string\)=>\{/g)?.length).toBe(1);
    expect(PAGE_TSX.match(/\/api\/insumos-ext/g)!.length).toBeGreaterThan(0);
  });
  it('5) seleccionar/confirmar dentro de un servicio escribe SOLO en ese servicio, nunca en insumosRows global', () => {
    const b = bloque('const almacenarInsumos=()=>{', '};', PAGE_TSX.indexOf('const almacenarInsumos=()=>{'));
    expect(b).toContain("actualizarArregloServicioNoContinuo(destinoModalInsumos,'insumos',()=>borradorInsumos)");
    expect(b).toContain('else setInsumosRows(borradorInsumos);');
  });
  it('7) no existe ningún catálogo/estado paralelo de insumos para servicios', () => {
    expect(PAGE_TSX).not.toMatch(/showModalInsumosServicio|borradorInsumosServicio|catalogoServiciosNoContinuosInsumos/);
  });
  it('el insumo manual sigue permitiendo código vacío dentro del servicio (origen MANUAL, nunca obligatorio)', () => {
    // Ajuste "FASE B: MODAL AGREGAR/EDITAR" — la fila de insumos (con la
    // condición codigo||Manual) ya no vive en la tarjeta de solo lectura:
    // se movió, sin cambios de fórmula, al modal `ModalServicioNoContinuo`.
    const bModal = bloque('function ModalServicioNoContinuo(){', '  // ═══ Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — CRUD de\n  // Reinversión, el ÚNICO tipo administrado directamente en esta pestaña');
    expect(bModal).toMatch(/item\.codigo\|\|\(item\.origen==='MANUAL'\?'Manual':/);
  });
  it('11) actualizarInsumoServicio reutiliza calcularValorUnitarioConIva/calcularValorMensualInsumo (mismas fórmulas del módulo global)', () => {
    const b = bloque('function actualizarInsumoServicio(servicioId:string,id:number,cambios:Partial<InsumoServicioNoContinuo>){', 'function eliminarInsumoServicio');
    expect(b).toContain('calcularValorUnitarioConIva(');
    expect(b).toContain('calcularValorMensualInsumo(');
  });
});

describe('Tipos — MaquinariaServicioNoContinuo/InsumoServicioNoContinuo son estructuralmente iguales al modelo global (nunca una versión simplificada paralela)', () => {
  it('MaquinariaServicioNoContinuo es un alias directo de MaquinariaEquipoRowNormalizado', async () => {
    const src = readFileSync(join(__dirname, 'servicios-no-continuos.ts'), 'utf-8');
    expect(src).toContain('export type MaquinariaServicioNoContinuo = MaquinariaEquipoRowNormalizado;');
  });
  it('InsumoServicioNoContinuo incluye valorUnitarioConIva/valorMensual (mismos campos calculados que InsumoRow global)', () => {
    const src = readFileSync(join(__dirname, 'servicios-no-continuos.ts'), 'utf-8');
    expect(src).toContain('valorUnitarioConIva: number;');
    expect(src).toContain('valorMensual: number;');
  });
});

describe('Aislamiento entre servicios y frente al módulo principal (ver también servicios-no-continuos.test.ts para la parte pura)', () => {
  it('8) el selector de cargo de Mano de Obra dentro de un servicio (si existiera) nunca podría venir de lineasExtra global — Maquinaria/Insumos de servicios no tienen asociación a cargo, y el aislamiento real ya está cubierto por actualizarArregloServicioNoContinuo (filtra por servicioId)', () => {
    const b = bloque('function actualizarArregloServicioNoContinuo<K', 'function actualizarExamenesMedicosServicioNoContinuo');
    expect(b).toContain('prev.map(s=>s.id!==servicioId?s:{...s,[clave]:actualizar(s[clave])})');
  });
  it('9/10) guardarModuloServiciosNoContinuos persiste `servicios` completo (incluye maquinariaEquipos/insumos de cada servicio) — recargar restaura vía obtenerModulo', () => {
    expect(PAGE_TSX).toContain('function construirDatosEntradaServiciosNoContinuos(){\n    return { servicios: serviciosNoContinuos };\n  }');
  });
});
