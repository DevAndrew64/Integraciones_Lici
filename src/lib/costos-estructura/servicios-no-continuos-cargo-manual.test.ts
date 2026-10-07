/**
 * Ajuste "CARGO MANUAL DE SNC" (corregido por "TARIFA REGULADA VIGICOLBA —
 * PESTAÑA PROPIA": la tarifa regulada Supervigilancia se retiró de aquí,
 * ver `tarifa-regulada-vigicolba.test.ts`) — verificación de fuente
 * (mismo patrón `bloque()` ya usado en servicios-no-continuos-modal-fase-b.test.ts)
 * + tests puros de las funciones de cálculo/totales del cargo de Mano de
 * Obra manual dentro del modal de Servicio No Continuo. Representa
 * EXCLUSIVAMENTE el costo interno de ese componente — cantidad × días ×
 * valorUnitario — nunca una tarifa de oferta.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  crearServicioNoContinuoVacio,
  calcularCostoInternoCargoManualServicio, calcularTotalCostoInternoCargosManualesServicio,
  calcularTotalesServicioNoContinuo,
  type CargoManualServicioNoContinuo,
} from './servicios-no-continuos';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function bloque(inicioMarcador: string, finMarcador: string, desde = 0): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador, desde);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}
const bModal = () => bloque('function ModalServicioNoContinuo(){', '  // ═══ Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — CRUD de\n  // Reinversión, el ÚNICO tipo administrado directamente en esta pestaña');

function cargo(p: Partial<CargoManualServicioNoContinuo> = {}): CargoManualServicioNoContinuo {
  return { id: 1, nombreCargo: 'POLIGRAFISTA', cantidad: 1, dias: 1, valorUnitario: 0, ...p };
}

describe('1/2/3) "+ Agregar cargo" funciona en SNC — crea un cargo con defaults correctos', () => {
  it('agregarCargoManualServicio agrega una fila con cantidad=1, días=1, valorUnitario=0', () => {
    const f = bloque('function agregarCargoManualServicio(servicioId:string){', 'function actualizarCargoManualServicio(');
    expect(f).toContain('cantidad:1,dias:1,valorUnitario:0');
    expect(f).toContain("actualizarArregloServicioNoContinuo(servicioId,'cargosManuales',arr=>[...(arr??[]),cargo]);");
  });

  it('el valor unitario es editable — actualizarCargoManualServicio aplica cambios parciales sobre el cargo por id', () => {
    const f = bloque('function actualizarCargoManualServicio(', 'function eliminarCargoManualServicio(');
    expect(f).toContain('arr=>(arr??[]).map(c=>c.id!==id?c:{...c,...cambios})');
  });
});

describe('4) Total se deriva correctamente — cantidad × días × valorUnitario, misma semántica confirmada contra el Excel ("Valor por Posición")', () => {
  it('calcularCostoInternoCargoManualServicio multiplica los 3 factores', () => {
    expect(calcularCostoInternoCargoManualServicio(cargo({ cantidad: 1, dias: 2, valorUnitario: 250000 }))).toBe(500000);
    expect(calcularCostoInternoCargoManualServicio(cargo({ cantidad: 3, dias: 4, valorUnitario: 10000 }))).toBe(120000);
  });

  it('cantidad, días o valor en 0 dan total 0 (nunca división por cero, nunca NaN)', () => {
    expect(calcularCostoInternoCargoManualServicio(cargo({ cantidad: 0, dias: 5, valorUnitario: 100 }))).toBe(0);
    expect(calcularCostoInternoCargoManualServicio(cargo({ cantidad: 5, dias: 0, valorUnitario: 100 }))).toBe(0);
  });
});

describe('5) Permite múltiples cargos — el total es la suma de todos', () => {
  it('calcularTotalCostoInternoCargosManualesServicio suma POLIGRAFISTA + COORDINADOR + TÉCNICO', () => {
    const cargos = [
      cargo({ id: 1, nombreCargo: 'POLIGRAFISTA', cantidad: 1, dias: 2, valorUnitario: 250000 }), // 500.000
      cargo({ id: 2, nombreCargo: 'COORDINADOR', cantidad: 1, dias: 1, valorUnitario: 300000 }),   // 300.000
      cargo({ id: 3, nombreCargo: 'TÉCNICO', cantidad: 2, dias: 1, valorUnitario: 100000 }),        // 200.000
    ];
    expect(calcularTotalCostoInternoCargosManualesServicio(cargos)).toBe(1000000);
  });
});

describe('6) Eliminar un cargo actualiza el subtotal', () => {
  it('eliminarCargoManualServicio filtra por id, sin tocar los demás', () => {
    const f = bloque('function eliminarCargoManualServicio(', '\n\n  const NOMBRE_MODULO_NO_APLICA');
    expect(f).toContain('arr=>(arr??[]).filter(c=>c.id!==id)');
  });

  it('quitar un cargo del arreglo reduce el total exactamente por su propio valor', () => {
    const cargos = [cargo({ id: 1, cantidad: 1, dias: 1, valorUnitario: 500000 }), cargo({ id: 2, cantidad: 1, dias: 1, valorUnitario: 300000 })];
    const totalAntes = calcularTotalCostoInternoCargosManualesServicio(cargos);
    const totalDespues = calcularTotalCostoInternoCargosManualesServicio(cargos.filter(c => c.id !== 2));
    expect(totalAntes - totalDespues).toBe(300000);
  });
});

describe('7/9) Borrador Fase B — agregar/editar/eliminar cargo manual modifica EXCLUSIVAMENTE borradorServicioNoContinuo mientras el modal está abierto', () => {
  it('las 3 funciones despachan por actualizarArregloServicioNoContinuo (mismo dispatcher draft-aware que Insumos/Maquinaria/Otros Costos)', () => {
    const agregar = bloque('function agregarCargoManualServicio(', 'function actualizarCargoManualServicio(');
    const actualizar = bloque('function actualizarCargoManualServicio(', 'function eliminarCargoManualServicio(');
    const eliminar = bloque('function eliminarCargoManualServicio(', '\n\n  const NOMBRE_MODULO_NO_APLICA');
    expect(agregar).toContain("actualizarArregloServicioNoContinuo(servicioId,'cargosManuales'");
    expect(actualizar).toContain("actualizarArregloServicioNoContinuo(servicioId,'cargosManuales'");
    expect(eliminar).toContain("actualizarArregloServicioNoContinuo(servicioId,'cargosManuales'");
  });

  it('actualizarArregloServicioNoContinuo redirige al borrador cuando servicioId coincide con borradorServicioNoContinuo.id — nunca escribe serviciosNoContinuos directamente mientras el modal está abierto', () => {
    const f = bloque('function actualizarArregloServicioNoContinuo<K extends', '  function buscarServicioOValorAgregadoPorId');
    expect(f).toContain('if(borradorServicioNoContinuo&&servicioId===borradorServicioNoContinuo.id){');
    expect(f).toContain('setBorradorServicioNoContinuo(b=>b?{...b,[clave]:actualizar(b[clave])}:b);');
  });

  it('Cancelar (cerrarModalServicioNoContinuo) descarta el borrador sin llamar setServiciosNoContinuos — los cargos manuales nuevos se pierden, nunca se persisten', () => {
    const f = bloque('function cerrarModalServicioNoContinuo(){', 'function guardarModalServicioNoContinuo(){');
    expect(f).not.toMatch(/setServiciosNoContinuos\(/);
    expect(f).toContain('setBorradorServicioNoContinuo(null);');
  });

  it('Guardar (guardarModalServicioNoContinuo) persiste el borrador completo — cargosManuales viaja dentro de "borrador" por spread, nunca una allowlist de campos', () => {
    const f = bloque('function guardarModalServicioNoContinuo(){', 'function actualizarDescripcionBorradorServicioNoContinuo(');
    expect(f).toContain('setServiciosNoContinuos(p=>borradorServicioNoContinuoEsNuevo?[...p,borrador]:p.map(s=>s.id===borrador.id?borrador:s));');
  });
});

describe('8) Editar SNC restaura los cargos manuales guardados', () => {
  it('abrirModalServicioNoContinuoEditar copia el servicio completo (incluye cargosManuales) al borrador vía clonarServicioNoContinuo, nunca una copia superficial que pudiera perder el arreglo', () => {
    const f = bloque('function abrirModalServicioNoContinuoEditar(', 'function cerrarModalServicioNoContinuo(){');
    expect(f).toContain('const clon=clonarServicioNoContinuo(original);');
    expect(f).toContain('setBorradorServicioNoContinuo({...clon,');
  });

  it('un servicio guardado antes de este ajuste (sin cargosManuales) sigue abriendo — crearServicioNoContinuoVacio y todo lector usan ??[]', () => {
    const vacio = crearServicioNoContinuoVacio('s1');
    expect(vacio.cargosManuales).toEqual([]);
    const historico = { ...vacio, cargosManuales: undefined };
    expect(calcularTotalCostoInternoCargosManualesServicio(historico.cargosManuales ?? [])).toBe(0);
  });
});

describe('9) Total Mano de Obra manual entra al total SNC — sin duplicar, y nunca se mezcla con tarifa regulada', () => {
  it('la grilla usa calcularCostoInternoCargoManualServicio por fila y "TOTAL MANO DE OBRA DEL SERVICIO" muestra totales.manoObra (nunca una suma paralela en JSX)', () => {
    const b = bModal();
    expect(b).toContain('{cop(calcularCostoInternoCargoManualServicio(cargo))}');
    expect(b).toContain('TOTAL MANO DE OBRA DEL SERVICIO');
    expect(b).toContain('{cop(totales.manoObra)}');
  });

  it('totalManoObraBorrador (lo que alimenta calcularTotalesServicioNoContinuo) suma calcularTotalCostoInternoCargosManualesServicio(b.cargosManuales??[]) — una sola vez, nunca por fila y de nuevo en el total, y NUNCA referencia tarifa regulada', () => {
    const f = bloque('const resultadosCargoBorrador=b.manoObra.map', 'const totales=calcularTotalesServicioNoContinuo(b,totalManoObraBorrador);');
    expect(f).toContain('calcularTotalCostoInternoCargosManualesServicio(b.cargosManuales??[])');
    expect(f).not.toContain('ValorOfertaRegulada');
    expect(f).not.toContain('DiferencialTarifaRegulada');
    expect(f).not.toContain('clasificacionTarifaSupervigilancia');
  });

  it('calcularTotalesServicioNoContinuo (histórico/ESTRUCTURA_COSTOS) usa el total recibido tal cual para manoObra, sin recalcular ni duplicar', () => {
    const servicio = { ...crearServicioNoContinuoVacio('s1'), cargosManuales: [cargo({ cantidad: 1, dias: 2, valorUnitario: 250000 })] };
    const totalManoObra = calcularTotalCostoInternoCargosManualesServicio(servicio.cargosManuales);
    const totales = calcularTotalesServicioNoContinuo(servicio, totalManoObra);
    expect(totales.manoObra).toBe(500000);
    expect(totales.subtotalAntesFrecuencia).toBe(500000);
    expect(totales.total).toBe(500000);
  });
});

describe('SIN fallback: Aseocolba no se ve afectado, y el SNC no acopla ningún tarifario automático', () => {
  it('la sección "Mano de obra del servicio" manual sigue gateada por !esTarifaAseocolba — Aseocolba (TARIFA_ASEOCOLBA) nunca la ve ni la usa', () => {
    const b = bModal();
    expect(b).toContain('{!esTarifaAseocolba&&(');
  });

  it('el modal NUNCA referencia el tarifario de Aseocolba NI el tarifario/pestaña de Tarifa Regulada Vigicolba dentro de la sección de cargo manual — el SNC es exclusivamente costo interno', () => {
    const b = bModal();
    const inicio = b.indexOf('Mano de obra del servicio');
    const fin = b.indexOf('Insumos', inicio);
    const seccion = b.slice(inicio, fin);
    expect(seccion).not.toContain('tarifario-especiales-aseocolba');
    expect(seccion).not.toContain('catalogoTarifasAseocolba');
    expect(seccion).not.toContain('tarifario-vigilancia-vigicolba');
    expect(seccion).not.toContain('tarifa-regulada-vigicolba');
    expect(seccion).not.toContain('ResueltaCargoVigicolba');
    expect(seccion).not.toContain('ValorOfertaRegulada');
    expect(seccion).not.toContain('clasificacionTarifaSupervigilancia');
  });
});
