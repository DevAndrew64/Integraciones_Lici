/**
 * Ajuste "OTROS COSTOS DE SNC" — bloque independiente en el modal
 * Crear/Editar Servicio No Continuo para conceptos que no pertenecen a
 * Mano de Obra/Insumos/Maquinaria (transporte de equipos, viáticos,
 * alimentación, hospedaje, peajes, etc.).
 *
 * Cobertura mínima exigida (18 casos): cálculo puro (1-9, 13-14),
 * reconciliación (17-18) y wiring de borrador/persistencia/UI (10-12,
 * 15-16) verificado por texto fuente contra page.tsx, mismo patrón que el
 * resto de *-page.test.ts de este módulo (sin jsdom/RTL en el proyecto).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  calcularValorMensualOtroCostoServicio, calcularTotalOtrosCostosServicio,
  calcularTotalesServicioNoContinuo, calcularTotalServiciosNoContinuos,
  crearServicioNoContinuoVacio, servicioNoContinuoTieneDatos,
  calcularTotalInsumosServicio, calcularTotalMaquinariaServicio,
  type OtroCostoServicioNoContinuo, type ServicioNoContinuo, type InsumoServicioNoContinuo, type MaquinariaServicioNoContinuo,
} from './servicios-no-continuos';
import {
  construirTarifaServicioDesdeCatalogo, buscarTarifaCatalogoAseocolba, calcularTarifaServicioAseocolba,
} from './tarifario-especiales-aseocolba';
import { calcularValorUnitarioConIva, calcularValorMensualInsumo } from './calculo-insumos';
import { calcularCamposMaquinariaEquipo } from './calculo-maquinaria';

const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

function bloque(inicioMarcador: string, finMarcador: string, desde = 0): string {
  const inicio = PAGE_TSX.indexOf(inicioMarcador, desde);
  if (inicio === -1) throw new Error(`No se encontró el marcador de inicio: ${inicioMarcador}`);
  const fin = PAGE_TSX.indexOf(finMarcador, inicio);
  if (fin === -1) throw new Error(`No se encontró el marcador de fin: ${finMarcador}`);
  return PAGE_TSX.slice(inicio, fin);
}

function otroCosto(overrides: Partial<OtroCostoServicioNoContinuo> = {}): OtroCostoServicioNoContinuo {
  return { id: 1, concepto: 'Transporte de equipos', cantidad: 1, frecuenciaMeses: 1, valorUnitario: 500000, ...overrides };
}
function insumo(overrides: Partial<InsumoServicioNoContinuo> = {}): InsumoServicioNoContinuo {
  const cantidad = overrides.cantidad ?? 4, frecuenciaMeses = overrides.frecuenciaMeses ?? 1;
  const valorUnitarioSinIva = overrides.valorUnitarioSinIva ?? 10000, ivaPorcentaje = overrides.ivaPorcentaje ?? 19;
  const valorUnitarioConIva = calcularValorUnitarioConIva(valorUnitarioSinIva, ivaPorcentaje);
  return {
    id: 1, origen: 'MANUAL', codigo: '', nombre: 'Detergente', cantidad, frecuenciaMeses, valorUnitarioSinIva, ivaPorcentaje,
    valorUnitarioConIva, valorMensual: calcularValorMensualInsumo({ cantidad, frecuenciaMeses, valorUnitarioConIva }),
    ...overrides,
  };
}
function maquina(overrides: Partial<MaquinariaServicioNoContinuo> = {}): MaquinariaServicioNoContinuo {
  const base = {
    cantidadRequerida: 1, mesesDepreciacion: 24, valorUnitario: 2000000, incluyeIva: false,
    cantidadDisponible: 0, valorMantenimientoMensualUnitario: 30000 as number | null, ...overrides,
  };
  return {
    id: 1, origen: 'MANUAL', descripcion: 'Hidrolavadora', origenMantenimiento: 'MANUAL',
    ...base, ...calcularCamposMaquinariaEquipo(base),
    ...overrides,
  };
}
function servicioAseocolba(overrides: Partial<ServicioNoContinuo> = {}): ServicioNoContinuo {
  const entrada = buscarTarifaCatalogoAseocolba('MENSUAL_OPERARIO_ASEO_42_LS_SIN_INSUMOS')!;
  const tarifa = { ...construirTarifaServicioDesdeCatalogo(entrada, 'MAPEO_AUTOMATICO'), aplicaAiu: true as const };
  return {
    ...crearServicioNoContinuoVacio('1', 'Servicio prueba', 'TARIFA_ASEOCOLBA'),
    tarifas: [tarifa],
    ...overrides,
  };
}
function servicioHistorico(overrides: Partial<ServicioNoContinuo> = {}): ServicioNoContinuo {
  const base = crearServicioNoContinuoVacio('1', 'Servicio histórico');
  // Simula un registro guardado ANTES de este ajuste: sin la clave
  // `otrosCostos` en absoluto (no solo `[]`).
  const { otrosCostos: _omit, ...sinOtrosCostos } = base;
  return { ...sinOtrosCostos, ...overrides } as ServicioNoContinuo;
}

describe('1) SNC histórico sin otrosCostos funciona normalmente', () => {
  it('calcularTotalesServicioNoContinuo no lanza y otrosCostos=0 cuando el campo está ausente (nunca undefined ni NaN)', () => {
    const s = servicioHistorico({ manoObra: [] });
    expect(() => calcularTotalesServicioNoContinuo(s, 500000)).not.toThrow();
    const r = calcularTotalesServicioNoContinuo(s, 500000);
    expect(r.otrosCostos).toBe(0);
    expect(r.total).toBe(500000);
  });
  it('servicioNoContinuoTieneDatos no lanza sobre un servicio histórico sin otrosCostos', () => {
    const s = servicioHistorico();
    expect(() => servicioNoContinuoTieneDatos(s)).not.toThrow();
  });
});

describe('2) agregar un concepto de $500.000 incrementa el total del SNC exactamente en $500.000', () => {
  it('cantidad=1, frecuencia=1 → valorMensual = valorUnitario exacto', () => {
    const item = otroCosto({ valorUnitario: 500000 });
    expect(calcularValorMensualOtroCostoServicio(item)).toBe(500000);
  });
  it('el total del servicio (histórico) crece exactamente en $500.000 al agregar el concepto', () => {
    const sinConcepto = servicioHistorico({ manoObra: [], otrosCostos: [] });
    const conConcepto = servicioHistorico({ manoObra: [], otrosCostos: [otroCosto({ valorUnitario: 500000 })] });
    const totalAntes = calcularTotalesServicioNoContinuo(sinConcepto, 0).total;
    const totalDespues = calcularTotalesServicioNoContinuo(conConcepto, 0).total;
    expect(totalDespues - totalAntes).toBe(500000);
  });
});

describe('3) dos o más conceptos se suman correctamente', () => {
  it('calcularTotalOtrosCostosServicio suma independiente de cada fila', () => {
    const items = [
      otroCosto({ id: 1, concepto: 'Transporte de equipos', valorUnitario: 500000 }),
      otroCosto({ id: 2, concepto: 'Viáticos', valorUnitario: 720000 }),
    ];
    expect(calcularTotalOtrosCostosServicio(items)).toBe(1220000);
  });
});

describe('4) cantidad × valorUnitario / frecuencia — MISMA convención real que Insumos/Exámenes (nunca cantidad×frecuencia×valorUnitario)', () => {
  it('la frecuencia divide (no multiplica), igual que calcularValorMensualInsumo/calcularValorMensualItemExamenMedico', () => {
    const item = otroCosto({ cantidad: 2, frecuenciaMeses: 3, valorUnitario: 120000 });
    // Fórmula real reutilizada: 2 × 120.000 / 3 = 80.000 — NUNCA 720.000
    // (que sería multiplicar por la frecuencia en vez de dividir).
    expect(calcularValorMensualOtroCostoServicio(item)).toBe(80000);
    expect(calcularValorMensualOtroCostoServicio(item)).not.toBe(2 * 3 * 120000);
  });
  it('frecuenciaMeses<=0 se trata como 1 (nunca división por cero/negativo)', () => {
    const item = otroCosto({ cantidad: 3, frecuenciaMeses: 0, valorUnitario: 10000 });
    expect(calcularValorMensualOtroCostoServicio(item)).toBe(30000);
  });
});

describe('5) eliminar un concepto descuenta correctamente su valor', () => {
  it('quitar una fila del arreglo reduce el total exactamente en su valorMensual', () => {
    const items = [otroCosto({ id: 1, valorUnitario: 500000 }), otroCosto({ id: 2, concepto: 'Viáticos', valorUnitario: 300000 })];
    const totalConAmbos = calcularTotalOtrosCostosServicio(items);
    const totalSinUno = calcularTotalOtrosCostosServicio(items.filter(i => i.id !== 2));
    expect(totalConAmbos - totalSinUno).toBe(300000);
  });
});

describe('6/7/8) Otros costos no modifica Mano de obra/Insumos/Maquinaria', () => {
  it('6) el total de manoObra es independiente de otrosCostos (histórico)', () => {
    const sinOtros = calcularTotalesServicioNoContinuo(servicioHistorico({ otrosCostos: [] }), 777000);
    const conOtros = calcularTotalesServicioNoContinuo(servicioHistorico({ otrosCostos: [otroCosto()] }), 777000);
    expect(conOtros.manoObra).toBe(sinOtros.manoObra);
    expect(conOtros.manoObra).toBe(777000);
  });
  it('7) el total de insumos es independiente de otrosCostos', () => {
    const insumos = [insumo()];
    const sinOtros = calcularTotalesServicioNoContinuo(servicioHistorico({ insumos, otrosCostos: [] }), 0);
    const conOtros = calcularTotalesServicioNoContinuo(servicioHistorico({ insumos, otrosCostos: [otroCosto()] }), 0);
    expect(conOtros.insumos).toBe(sinOtros.insumos);
    expect(conOtros.insumos).toBe(calcularTotalInsumosServicio(insumos));
  });
  it('8) el total de maquinariaEquipos es independiente de otrosCostos', () => {
    const maquinariaEquipos = [maquina()];
    const sinOtros = calcularTotalesServicioNoContinuo(servicioHistorico({ maquinariaEquipos, otrosCostos: [] }), 0);
    const conOtros = calcularTotalesServicioNoContinuo(servicioHistorico({ maquinariaEquipos, otrosCostos: [otroCosto()] }), 0);
    expect(conOtros.maquinariaEquipos).toBe(sinOtros.maquinariaEquipos);
    expect(conOtros.maquinariaEquipos).toBe(calcularTotalMaquinariaServicio(maquinariaEquipos));
  });
  it('lo mismo en la rama TARIFA_ASEOCOLBA: manoObra/insumos/maquinaria/AIU de los cargos no cambian con otrosCostos', () => {
    const sinOtros = calcularTotalesServicioNoContinuo(servicioAseocolba({ otrosCostos: [] }), 0);
    const conOtros = calcularTotalesServicioNoContinuo(servicioAseocolba({ otrosCostos: [otroCosto()] }), 0);
    expect(conOtros.manoObra).toBe(sinOtros.manoObra);
    expect(conOtros.insumos).toBe(sinOtros.insumos);
    expect(conOtros.maquinariaEquipos).toBe(sinOtros.maquinariaEquipos);
    expect(conOtros.tarifaAplicaAiu).toBe(sinOtros.tarifaAplicaAiu);
    expect(conOtros.tarifaValorUnitarioConAIU).toBe(sinOtros.tarifaValorUnitarioConAIU);
  });
});

describe('9) Otros costos no activa AIU automáticamente ni aplica IVA/tarifas Aseocolba', () => {
  it('tarifaAplicaAiu/tarifaValida no se alteran por agregar otrosCostos (rama TARIFA_ASEOCOLBA)', () => {
    const sinOtros = calcularTotalesServicioNoContinuo(servicioAseocolba({ otrosCostos: [] }), 0);
    const conOtros = calcularTotalesServicioNoContinuo(servicioAseocolba({ otrosCostos: [otroCosto({ valorUnitario: 999999 })] }), 0);
    expect(conOtros.tarifaValida).toBe(sinOtros.tarifaValida);
    expect(conOtros.tarifaAplicaAiu).toBe(sinOtros.tarifaAplicaAiu);
  });
  it('calcularValorMensualOtroCostoServicio no aplica ningún porcentaje de IVA — el total es cantidad×valorUnitario/frecuencia, sin factor adicional', () => {
    const item = otroCosto({ cantidad: 1, frecuenciaMeses: 1, valorUnitario: 100000 });
    expect(calcularValorMensualOtroCostoServicio(item)).toBe(100000); // nunca 119.000 (19% IVA) ni 100.000×1.xx (AIU)
  });
});

describe('13) TOTAL OTROS COSTOS coincide con la suma de sus filas', () => {
  it('calcularTotalesServicioNoContinuo.otrosCostos === calcularTotalOtrosCostosServicio(items) para el mismo arreglo', () => {
    const items = [otroCosto({ id: 1, valorUnitario: 500000 }), otroCosto({ id: 2, concepto: 'Viáticos', valorUnitario: 720000 })];
    const s = servicioHistorico({ otrosCostos: items });
    const r = calcularTotalesServicioNoContinuo(s, 0);
    expect(r.otrosCostos).toBe(calcularTotalOtrosCostosServicio(items));
    expect(r.otrosCostos).toBe(1220000);
  });
});

describe('14) el total del servicio incluye Otros costos (ambas ramas)', () => {
  it('histórico: total = manoObra + dotacionEpp + examenesMedicos + insumos + maquinariaEquipos + otrosCostos', () => {
    const s = servicioHistorico({ insumos: [insumo()], maquinariaEquipos: [maquina()], otrosCostos: [otroCosto({ valorUnitario: 200000 })] });
    const r = calcularTotalesServicioNoContinuo(s, 100000);
    expect(r.total).toBe(r.manoObra + r.dotacionEpp + r.totalExamenesMedicos + r.insumos + r.maquinariaEquipos + r.otrosCostos);
  });
  it('TARIFA_ASEOCOLBA: total = totalCargos + insumos + maquinariaEquipos + otrosCostos', () => {
    const s = servicioAseocolba({ insumos: [insumo()], maquinariaEquipos: [maquina()], otrosCostos: [otroCosto({ valorUnitario: 200000 })] });
    const r = calcularTotalesServicioNoContinuo(s, 0);
    const totalCargos = (s.tarifas ?? []).reduce((acc, t) => acc + calcularTarifaServicioAseocolba(t, buscarTarifaCatalogoAseocolba(t.tarifaKey)).total, 0);
    expect(r.total).toBe(totalCargos + r.insumos + r.maquinariaEquipos + r.otrosCostos);
  });
});

describe('17/18) reconciliación completa — cargos + insumos + maquinaria + otros costos', () => {
  it('18) servicio TARIFA_ASEOCOLBA con los 4 bloques reconcilia: suma de bloques === total', () => {
    const s = servicioAseocolba({
      insumos: [insumo({ id: 1 })],
      maquinariaEquipos: [maquina({ id: 1 })],
      otrosCostos: [otroCosto({ id: 1, valorUnitario: 500000 }), otroCosto({ id: 2, concepto: 'Viáticos', valorUnitario: 300000 })],
    });
    const r = calcularTotalesServicioNoContinuo(s, 0);
    const totalCargos = (s.tarifas ?? []).reduce((acc, t) => acc + calcularTarifaServicioAseocolba(t, buscarTarifaCatalogoAseocolba(t.tarifaKey)).total, 0);
    expect(r.insumos).toBeGreaterThan(0);
    expect(r.maquinariaEquipos).toBeGreaterThan(0);
    expect(r.otrosCostos).toBe(800000);
    expect(totalCargos + r.insumos + r.maquinariaEquipos + r.otrosCostos).toBe(r.total);
  });
  it('17) calcularTotalServiciosNoContinuos (consolidado de todos los servicios) incluye otrosCostos de cada uno', () => {
    const s1 = servicioHistorico({ id: '1', otrosCostos: [otroCosto({ valorUnitario: 200000 })] });
    const s2 = servicioAseocolba({ id: '2', otrosCostos: [otroCosto({ valorUnitario: 300000 })] });
    const totalesManoObra = new Map([['1', 0], ['2', 0]]);
    const consolidado = calcularTotalServiciosNoContinuos([s1, s2], totalesManoObra);
    const esperado = calcularTotalesServicioNoContinuo(s1, 0).total + calcularTotalesServicioNoContinuo(s2, 0).total;
    expect(consolidado).toBe(esperado);
  });
});

describe('10) Cancelar edición descarta cambios en Otros costos — misma protección de borrador ya auditada en Fase B', () => {
  it('agregar/actualizar/eliminar otro costo despachan por actualizarArregloServicioNoContinuo, con la MISMA rama de aislamiento de borrador que Insumos/Maquinaria (nunca una ruta paralela)', () => {
    const b = bloque('function actualizarArregloServicioNoContinuo<K', 'function buscarServicioOValorAgregadoPorId');
    expect(b).toContain("if(borradorServicioNoContinuo&&servicioId===borradorServicioNoContinuo.id){");
    expect(b).toContain('setBorradorServicioNoContinuo(b=>b?{...b,[clave]:actualizar(b[clave])}:b);');
    // La firma genérica ahora acepta 'otrosCostos' como clave válida — mismo dispatcher, sin duplicar lógica.
    // Ajuste "TARIFARIO GENERAL VIGICOLBA EN MANO DE OBRA — CARGO MANUAL DE
    // SNC" — la firma genérica agregó 'cargosManuales' (Mano de Obra manual
    // del servicio ahora despacha por el mismo dispatcher), sin quitar
    // ninguna de las claves ya existentes. Ajuste "MAQUINARIA Y EQUIPOS SNC
    // — MODELO SERVICIOS ESPECIALIZADOS" — agregó 'equiposEspecializados',
    // mismo criterio.
    expect(PAGE_TSX).toContain("function actualizarArregloServicioNoContinuo<K extends 'manoObra'|'dotacionEpp'|'insumos'|'maquinariaEquipos'|'equiposEspecializados'|'otrosCostos'|'cargosManuales'>(");
    expect(PAGE_TSX).toContain("agregarOtroCostoServicio(servicioId:string){");
    expect(PAGE_TSX).toContain("actualizarArregloServicioNoContinuo(servicioId,'otrosCostos',arr=>[...(arr??[]),item]);");
  });
  it('cerrarModalServicioNoContinuo nunca escribe sobre serviciosNoContinuos — descarta el borrador completo (incluye otrosCostos) sin persistir nada', () => {
    const b = bloque('function cerrarModalServicioNoContinuo(){', 'function guardarModalServicioNoContinuo(){');
    expect(b).not.toContain('setServiciosNoContinuos');
    expect(b).toContain('setBorradorServicioNoContinuo(null);');
  });
});

describe('11) Guardar edición persiste los cambios de Otros costos', () => {
  it('guardarModalServicioNoContinuo escribe el borrador COMPLETO (objeto entero, incluye otrosCostos) — nunca copia campo por campo', () => {
    const b = bloque('function guardarModalServicioNoContinuo(){', 'function actualizarDescripcionBorradorServicioNoContinuo');
    // Inserta/reemplaza el borrador entero — si escribiera campo por campo,
    // otrosCostos podría quedarse fuera silenciosamente.
    expect(b).toMatch(/setServiciosNoContinuos\(p=>borradorServicioNoContinuoEsNuevo\?\[\.\.\.p,borrador\]:p\.map\(s=>s\.id===borrador\.id\?borrador:s\)\);/);
  });
});

describe('12) Reabrir (Editar) conserva los datos de Otros costos ya guardados', () => {
  it('abrirModalServicioNoContinuoEditar normaliza otrosCostos ausente/histórico a [] al construir el borrador — nunca undefined', () => {
    expect(PAGE_TSX).toContain("setBorradorServicioNoContinuo({...clon,tarifas:tarifasServicio(clon).map(t=>({...t})),tarifa:undefined,otrosCostos:clon.otrosCostos??[],frecuenciaServicioCodigo:sugerirFrecuenciaServicioCodigo(clon)});");
  });
});

describe('15) La tarjeta exterior presenta correctamente los conceptos de Otros costos (solo lectura)', () => {
  it('sección "Otros costos" de solo lectura en la tarjeta expandida — nunca <input> editable ahí', () => {
    const inicio = PAGE_TSX.indexOf('OTROS COSTOS DE SNC" — tabla de solo');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 2400);
    expect(b).toContain("servicio.otrosCostos??[]).length===0");
    expect(b).toContain('Sin otros costos registrados.');
    expect(b).toContain('{item.concepto');
    expect(b).toContain('calcularValorMensualOtroCostoServicio(item)');
    expect(b).not.toMatch(/<input/);
  });
});

describe('16) El Resumen Servicios no continuos incorpora Otros costos', () => {
  it('filasResumenServiciosNoContinuos usa calcularTotalesServicioNoContinuo(s,...).total por servicio — esa fuente canónica YA incluye otrosCostos (verificado en el test 14 de este archivo), sin una fórmula ad-hoc paralela', () => {
    expect(PAGE_TSX).toContain('const filasResumenServiciosNoContinuos=serviciosNoContinuos.map(s=>({');
    expect(PAGE_TSX).toContain('valor:calcularTotalesServicioNoContinuo(s,totalesManoObraPorServicioNoContinuo.get(s.id)??0).total,');
  });
});

describe('Ajuste "FRECUENCIA GLOBAL DEL SERVICIO" — campo único (visible en el bloque Otros Costos) que divide el TOTAL COMPLETO del SNC, decisión explícita del usuario', () => {
  it('ausente/≤0 se trata como 1 — el total no cambia respecto al comportamiento histórico (retrocompatible)', () => {
    const sinFrecuencia = servicioHistorico({ insumos: [insumo()], otrosCostos: [otroCosto({ valorUnitario: 200000 })] });
    const r1 = calcularTotalesServicioNoContinuo(sinFrecuencia, 100000);
    const conFrecuenciaUno = calcularTotalesServicioNoContinuo({ ...sinFrecuencia, frecuenciaServicioMeses: 1 }, 100000);
    const conFrecuenciaCero = calcularTotalesServicioNoContinuo({ ...sinFrecuencia, frecuenciaServicioMeses: 0 }, 100000);
    expect(r1.frecuenciaServicioMeses).toBe(1);
    expect(r1.total).toBe(r1.subtotalAntesFrecuencia);
    expect(conFrecuenciaUno.total).toBe(r1.total);
    expect(conFrecuenciaCero.total).toBe(r1.total);
  });
  it('frecuencia=2 divide el TOTAL COMPLETO (mano de obra + insumos + maquinaria + otros costos), no solo otrosCostos', () => {
    const s = servicioHistorico({
      insumos: [insumo({ valorUnitarioSinIva: 100000, ivaPorcentaje: 0, cantidad: 1, frecuenciaMeses: 1 })],
      maquinariaEquipos: [maquina({ valorMantenimientoMensualUnitario: 0 })],
      otrosCostos: [otroCosto({ valorUnitario: 200000 })],
      frecuenciaServicioMeses: 2,
    });
    const totalManoObra = 300000;
    const r = calcularTotalesServicioNoContinuo(s, totalManoObra);
    const subtotalEsperado = totalManoObra + r.dotacionEpp + r.totalExamenesMedicos + r.insumos + r.maquinariaEquipos + r.otrosCostos;
    expect(r.subtotalAntesFrecuencia).toBe(subtotalEsperado);
    expect(r.total).toBe(subtotalEsperado / 2);
    expect(r.total).not.toBe(subtotalEsperado); // confirma que SÍ se dividió, no un no-op
  });
  it('también divide el total completo en la rama TARIFA_ASEOCOLBA (cargos+insumos+maquinaria+otrosCostos)', () => {
    const s = servicioAseocolba({ otrosCostos: [otroCosto({ valorUnitario: 300000 })], frecuenciaServicioMeses: 3 });
    const r = calcularTotalesServicioNoContinuo(s, 0);
    expect(r.total).toBeCloseTo(r.subtotalAntesFrecuencia / 3, 6);
  });
  it('el campo vive en el servicio (no en un OtroCostoServicioNoContinuo individual) y se edita vía actualizarFrecuenciaServicioBorrador sobre el borrador — Ajuste "CATÁLOGO OFICIAL DE FRECUENCIAS EN SNC": ahora escribe el código del catálogo, no meses libres', () => {
    expect(PAGE_TSX).toContain('function actualizarFrecuenciaServicioBorrador(frecuenciaServicioCodigo:FrecuenciaValorAgregado){');
    expect(PAGE_TSX).toContain('setBorradorServicioNoContinuo(b=>b?{...b,frecuenciaServicioCodigo}:b);');
  });
  it('la tarjeta exterior muestra "Total de cada componente" (subtotalAntesFrecuencia) → "Frecuencia" (catálogo/legado) → "Total servicio" (dividido) — las 3 líneas de la misma fuente canónica, mismo patrón que Pólizas', () => {
    const inicio = PAGE_TSX.indexOf('Total de cada componente</span>');
    expect(inicio).toBeGreaterThan(-1);
    const b = PAGE_TSX.slice(inicio, inicio + 1300);
    expect(b).toContain('{cop(totales.subtotalAntesFrecuencia)}');
    expect(b).toContain('<span>Frecuencia</span>');
    expect(b).toContain('{totales.frecuenciaServicioCodigo?etiquetaFrecuenciaValorAgregado(totales.frecuenciaServicioCodigo):`${totales.frecuenciaServicioMeses} meses`}');
    expect(b).toContain('Total servicio');
    expect(b).toContain('{cop(totales.total)}');
  });
});
