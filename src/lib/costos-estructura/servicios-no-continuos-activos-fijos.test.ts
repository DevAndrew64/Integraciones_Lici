/**
 * Ajuste "ACTIVOS FIJOS EN SNC — DOS FUENTES DE EQUIPOS" — dentro del modal
 * de un Servicio No Continuo hay dos formas independientes de agregar
 * equipos: "Activos Fijos" (`servicio.maquinariaEquipos`, mismo catálogo/
 * modal/estado que la pestaña global "Maquinaria y Equipos") y "Equipos
 * Especializados" (`servicio.equiposEspecializados`, catálogo propio de
 * Servicios Especializados). Ninguno reemplaza al otro; el total combinado
 * sigue siendo la suma de los dos subtotales independientes.
 *
 * Este archivo reemplaza a `servicios-no-continuos-maquinaria-legado.test.ts`
 * (ronda anterior, "SEPARAR MAQUINARIA LEGADO DE EQUIPOS ESPECIALIZADOS"):
 * en esa ronda `maquinariaEquipos` era tratado como legado de SOLO LECTURA +
 * ELIMINAR ("Maquinaria y equipos registrados anteriormente"/"Maquinaria y
 * equipos anteriores"). Ahora `maquinariaEquipos` vuelve a ser un modelo
 * ACTIVO: se puede agregar equipos nuevos vía "+ Agregar Activo Fijo", que
 * reutiliza `abrirModalMaquinaria(servicioId)` — la misma función/modal/
 * catálogo (`/api/equipos-ext`) que la pestaña global, sin duplicar lógica.
 * Los registros que ya existían (antes mostrados como "anteriores") siguen
 * ahí sin migración, ahora simplemente bajo el título "Activos Fijos".
 *
 * Mismo patrón `bloque()`/`toContain` sobre texto fuente ya usado en el
 * resto de *-page.test.ts (no hay arnés de render de componentes para
 * page.tsx).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  calcularTotalesServicioNoContinuo, calcularTotalMaquinariaServicio,
  type ServicioNoContinuo, type MaquinariaServicioNoContinuo,
} from './servicios-no-continuos';
import { calcularValorTotalEquipoEspecializado, calcularTotalEquiposEspecializadosServicio, type EquipoEspecializadoServicioNoContinuo } from './equipos-especializados-snc';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function baseServicio(overrides: Partial<ServicioNoContinuo> = {}): ServicioNoContinuo {
  return {
    id: '1', descripcion: 'Brigada de aseo',
    manoObra: [], dotacionEpp: [],
    examenesMedicos: { examenes: [], cursos: [], vacunas: [] },
    insumos: [], maquinariaEquipos: [],
    ...overrides,
  };
}

function activoFijo(overrides: Partial<MaquinariaServicioNoContinuo> = {}): MaquinariaServicioNoContinuo {
  return {
    id: 1, origen: 'CATALOGO', descripcion: 'HIDROLAVADORA ELECTRICA',
    cantidadRequerida: 1, mesesDepreciacion: 36,
    valorUnitario: 1500000, incluyeIva: false, valorConIva: 1500000,
    valorMesRequerido: 41666,
    cantidadDisponible: 0, cantidadComprar: 1,
    valorMesComprar: 41666,
    valorMantenimientoMensualUnitario: 1952, valorMesMantenimiento: 1952,
    origenMantenimiento: 'CATALOGO_MTTO_2025',
    ...overrides,
  };
}

function equipoEspecializado(overrides: Partial<EquipoEspecializadoServicioNoContinuo> = {}): EquipoEspecializadoServicioNoContinuo {
  return {
    id: 1, codigo: 900, descripcion: 'ANDAMIO', subTipo: 'ALTURA',
    codigoTipo: '1', codigoSubtipo: '1', cantidad: 2, numeroDias: 10, valorDia: 5000, origen: 'CATALOGO',
    ...overrides,
  };
}

describe('1) SNC sin ningún equipo (ni Activos Fijos ni Especializados)', () => {
  it('el subtotal de maquinaria y equipos es 0', () => {
    const s = baseServicio({ maquinariaEquipos: [], equiposEspecializados: [] });
    expect(calcularTotalesServicioNoContinuo(s, 0).maquinariaEquipos).toBe(0);
  });
  it('ambos bloques muestran "Sin equipos registrados." cuando su arreglo respectivo está vacío', () => {
    expect(PAGE_TSX).toContain("servicio.maquinariaEquipos.length===0&&(servicio.equiposEspecializados??[]).length===0?(<>");
    expect(PAGE_TSX).toContain('Sin equipos registrados.');
  });
});

describe('2) Agregar un Activo Fijo reutiliza el modal/catálogo global — nunca contamina maqRows', () => {
  it('el botón "+ Agregar Activo Fijo" del modal SNC llama a abrirModalMaquinaria(b.id) — la MISMA función/modal/catálogo (/api/equipos-ext) que la pestaña global "Maquinaria y Equipos", sin duplicar lógica', () => {
    expect(PAGE_TSX).toContain('<button onClick={()=>abrirModalMaquinaria(b.id)}');
    expect(PAGE_TSX).toContain('+ Agregar Activo Fijo');
  });
  it('abrirModalMaquinaria(servicioId) fija destinoModalMaquinaria al SNC y siembra el borrador desde servicio.maquinariaEquipos (nunca desde maqRows global)', () => {
    expect(PAGE_TSX).toContain('const abrirModalMaquinaria=(servicioId?:string)=>{');
    expect(PAGE_TSX).toContain('setDestinoModalMaquinaria(servicioId??null);');
    expect(PAGE_TSX).toContain('const filasOrigen=servicioId!=null?(buscarServicioOValorAgregadoPorId(servicioId)?.maquinariaEquipos??[]):maqRows;');
  });
  it('almacenarMaquinaria() SOLO escribe en maqRows global cuando destinoModalMaquinaria es null — con un SNC como destino, siempre usa actualizarArregloServicioNoContinuo(...,\'maquinariaEquipos\',...), jamás setMaqRows', () => {
    expect(PAGE_TSX).toMatch(/const almacenarMaquinaria=\(\)=>\{\s*if\(destinoModalMaquinaria!=null\)actualizarArregloServicioNoContinuo\(destinoModalMaquinaria,'maquinariaEquipos',\(\)=>borradorMaquinaria\);\s*else setMaqRows\(borradorMaquinaria\);/);
  });
  it('agregar un Activo Fijo (simulado: almacenarMaquinaria con destino=SNC) actualiza SOLO servicio.maquinariaEquipos, suma al total del SNC, y el objeto agregado conserva TODOS los campos que calcularTotalMaquinariaServicio necesita', () => {
    const nuevo = activoFijo({ id: 99, descripcion: 'MOTOBOMBA SUMERGIBLE 2"' });
    const s = baseServicio({ maquinariaEquipos: [], equiposEspecializados: [] });
    // Simula lo que hace actualizarArregloServicioNoContinuo(servicioId,'maquinariaEquipos',arr=>[...arr,nuevo]) — mismo spread que el resto del SNC.
    const actualizado: ServicioNoContinuo = { ...s, maquinariaEquipos: [...s.maquinariaEquipos, nuevo] };
    expect(actualizado.maquinariaEquipos).toHaveLength(1);
    expect(actualizado.equiposEspecializados).toEqual([]);
    const totales = calcularTotalesServicioNoContinuo(actualizado, 0);
    expect(totales.maquinariaEquipos).toBe(calcularTotalMaquinariaServicio([nuevo]));
    expect(totales.maquinariaEquipos).toBeGreaterThan(0);
  });
});

describe('3) Agregar un Equipo Especializado — comportamiento actual intacto', () => {
  it('el total de maquinaria coincide EXACTAMENTE con calcularTotalEquiposEspecializadosServicio — sin sumar nada de maquinariaEquipos', () => {
    const especializados = [equipoEspecializado(), equipoEspecializado({ id: 2, descripcion: 'ESLINGA', cantidad: 1, numeroDias: 5, valorDia: 3000 })];
    const s = baseServicio({ maquinariaEquipos: [], equiposEspecializados: especializados });
    const totales = calcularTotalesServicioNoContinuo(s, 0);
    expect(totales.maquinariaEquipos).toBe(calcularTotalEquiposEspecializadosServicio(especializados));
    expect(totales.maquinariaEquipos).toBe(especializados.reduce((acc, i) => acc + calcularValorTotalEquipoEspecializado(i), 0));
  });
  it('el bloque "Equipos especializados" conserva sus botones "+ Crear manual"/"+ Agregar equipo" y sus columnas Cant./N.º días/Valor día/Total', () => {
    expect(PAGE_TSX).toContain('+ Crear manual');
    expect(PAGE_TSX).toContain('+ Agregar equipo');
    expect(PAGE_TSX).toContain("letterSpacing:'.04em'}}>Maquinaria y Equipos - Especializados</div>");
  });
});

describe('4) SNC con AMBOS modelos: total = calcularTotalMaquinariaServicio + calcularTotalEquiposEspecializadosServicio, sin doble conteo', () => {
  it('el total combinado es exactamente la suma de los dos subtotales independientes', () => {
    const activos = [activoFijo()];
    const especializados = [equipoEspecializado()];
    const s = baseServicio({ maquinariaEquipos: activos, equiposEspecializados: especializados });
    const totales = calcularTotalesServicioNoContinuo(s, 0);
    const subtotalActivos = calcularTotalMaquinariaServicio(activos);
    const subtotalEspecializados = calcularTotalEquiposEspecializadosServicio(especializados);
    expect(totales.maquinariaEquipos).toBe(subtotalActivos + subtotalEspecializados);
    expect(subtotalActivos).toBeGreaterThan(0);
    expect(subtotalEspecializados).toBeGreaterThan(0);
  });
  it('el footer "TOTAL MAQUINARIA Y EQUIPOS" del modal se muestra si hay Activos Fijos O Especializados, en cualquier combinación', () => {
    expect(PAGE_TSX).toContain("((b.maquinariaEquipos??[]).length>0||(b.equiposEspecializados??[]).length>0)&&(");
  });
});

describe('5) Eliminar un Activo Fijo — solo afecta el SNC correspondiente y recalcula el total', () => {
  it('eliminar una fila de maquinariaEquipos por id la remueve del arreglo y recalcula el total (misma operación que usa eliminarMaquinariaServicio, arr.filter)', () => {
    const activos = [activoFijo({ id: 1 }), activoFijo({ id: 2, descripcion: 'ARNEZ', valorMesComprar: 8500, valorMesMantenimiento: 241 })];
    const antes = calcularTotalMaquinariaServicio(activos);
    const despuesDeEliminar = activos.filter(i => i.id !== 1);
    const despues = calcularTotalMaquinariaServicio(despuesDeEliminar);
    expect(despuesDeEliminar).toHaveLength(1);
    expect(despuesDeEliminar[0].id).toBe(2);
    expect(despues).toBeLessThan(antes);
    expect(despues).toBe(calcularTotalMaquinariaServicio([activos[1]]));
  });
  it('el modal conecta el botón de eliminar del bloque Activos Fijos a eliminarMaquinariaServicio(b.id,item.id) — actualiza únicamente la clave maquinariaEquipos del SNC indicado, vía actualizarArregloServicioNoContinuo (filtra por servicioId, nunca mapea sin condición)', () => {
    expect(PAGE_TSX).toContain('<BtnDel onClick={()=>eliminarMaquinariaServicio(b.id,item.id)}/></div>');
    expect(PAGE_TSX).toMatch(/function eliminarMaquinariaServicio\(servicioId:string,id:number\)\{\s*actualizarArregloServicioNoContinuo\(servicioId,'maquinariaEquipos',arr=>arr\.filter\(i=>i\.id!==id\)\);/);
  });
});

describe('6) Guardar/reabrir — Activos Fijos y Especializados persisten independientemente', () => {
  it('actualizarArregloServicioNoContinuo(servicioId,\'maquinariaEquipos\',...) y (servicioId,\'equiposEspecializados\',...) actualizan SOLO su propia clave — un ServicioNoContinuo con ambos arreglos poblados conserva cada uno intacto tras una actualización dirigida a la otra clave', () => {
    const activos = [activoFijo()];
    const especializados = [equipoEspecializado()];
    const s = baseServicio({ maquinariaEquipos: activos, equiposEspecializados: especializados });
    // Simula actualizarArregloServicioNoContinuo(s.id,'equiposEspecializados',arr=>[...arr,nuevo]) — el spread {...s,[clave]:...} nunca toca maquinariaEquipos.
    const nuevoEspecializado = equipoEspecializado({ id: 2, descripcion: 'ESCALERA 12 PASOS' });
    const trasActualizarEspecializados: ServicioNoContinuo = { ...s, equiposEspecializados: [...(s.equiposEspecializados ?? []), nuevoEspecializado] };
    expect(trasActualizarEspecializados.maquinariaEquipos).toBe(s.maquinariaEquipos);
    expect(trasActualizarEspecializados.equiposEspecializados).toHaveLength(2);
    // Y viceversa: actualizar maquinariaEquipos nunca toca equiposEspecializados.
    const nuevoActivo = activoFijo({ id: 2, descripcion: 'KIT VENTILADOR-EXTRACTOR' });
    const trasActualizarActivos: ServicioNoContinuo = { ...s, maquinariaEquipos: [...s.maquinariaEquipos, nuevoActivo] };
    expect(trasActualizarActivos.equiposEspecializados).toBe(s.equiposEspecializados);
    expect(trasActualizarActivos.maquinariaEquipos).toHaveLength(2);
  });
});

describe('7) Activos Fijos NUNCA muestran columnas ficticias de días/valor día — esos campos son exclusivos de Especializados', () => {
  it('el bloque "Activos Fijos" del modal solo tiene columnas Equipo/Cant./Valor mensual — nunca N.º días ni Valor día', () => {
    const idxActivos = PAGE_TSX.indexOf('>Maquinaria y Equipos - Activos Fijos</div>');
    const idxEspecializados = PAGE_TSX.indexOf('Maquinaria y Equipos - Especializados</div>', idxActivos);
    const bloqueActivos = PAGE_TSX.slice(idxActivos, idxEspecializados);
    expect(bloqueActivos).toContain('Valor mensual');
    expect(bloqueActivos).not.toContain('N.º días');
    expect(bloqueActivos).not.toContain('Valor día');
    expect(bloqueActivos).not.toContain('numeroDias');
    expect(bloqueActivos).not.toContain('valorDia');
  });
});

describe('8) Registros antiguos de maquinariaEquipos (previos a este cambio) siguen visibles, ahora bajo "Activos Fijos"', () => {
  it('reproduce el caso real (captura de producción, Aseocolba proceso 26001222): un SNC con maquinariaEquipos histórico (HIDROLAVADORA y otros) se sigue sumando y mostrando, ahora bajo el título "Activos Fijos" — nunca "anteriores" ni "legado"', () => {
    const hidrolavadora = activoFijo({ id: 1, descripcion: 'HIDROLAVADORA ELECTRICA', valorMesComprar: 40000, valorMesMantenimiento: 3618 });
    const arnes = activoFijo({ id: 2, descripcion: 'ARNEZ 4 ARGOLLAS RECUBIERTO EN POLIURETANO', valorMesComprar: 8300, valorMesMantenimiento: 441 });
    const s = baseServicio({ maquinariaEquipos: [hidrolavadora, arnes], equiposEspecializados: [] });
    const totales = calcularTotalesServicioNoContinuo(s, 0);
    expect(totales.maquinariaEquipos).toBe(43618 + 8741);
    const esperado = [hidrolavadora, arnes].reduce((acc, i) => acc + i.valorMesComprar + i.valorMesMantenimiento, 0);
    expect(totales.maquinariaEquipos).toBe(esperado);
  });
  it('la UI ya no usa el título "Maquinaria y equipos anteriores"/"registrados anteriormente" — esos registros se presentan como "Activos Fijos" igual que cualquier registro nuevo', () => {
    expect(PAGE_TSX).not.toContain('Maquinaria y equipos anteriores');
    expect(PAGE_TSX).not.toContain('Maquinaria y equipos registrados anteriormente');
    expect(PAGE_TSX).not.toContain('Subtotal registrados anteriormente');
    expect(PAGE_TSX).not.toContain('Estos registros pertenecen al modelo anterior de equipos del servicio.');
    expect(PAGE_TSX).toContain('>Maquinaria y Equipos - Activos Fijos</div>');
  });
});
