/**
 * Ajuste "SERVICIOS NO CONTINUOS — FASE A: MÚLTIPLES CARGOS/TARIFAS
 * ASEOCOLBA POR SERVICIO" — un SNC `TARIFA_ASEOCOLBA` ahora soporta 0/1/N
 * cargos/tarifas simultáneos (`tarifas[]`), cada uno independiente. Este
 * archivo cubre exclusivamente esa evolución del modelo — la rama
 * `ESTRUCTURA_COSTOS`/histórica y el resto de bloques (insumos/maquinaria)
 * NO cambian de fórmula en esta fase, solo se verifica que no hay
 * regresión.
 */
import { describe, expect, it } from 'vitest';
import {
  calcularTotalesServicioNoContinuo, crearServicioNoContinuoVacio,
  servicioNoContinuoTieneDatos, serviciosNoContinuosTienenDatos, tarifasServicio,
  type ServicioNoContinuo,
} from './servicios-no-continuos';
import { construirTarifaServicioDesdeCatalogo as construirTarifaServicioDesdeCatalogoBase, buscarTarifaCatalogoAseocolba, type TarifaServicioAseocolba } from './tarifario-especiales-aseocolba';

// Ajuste "APLICA AIU POR DEFECTO DESACTIVADO" (ronda posterior a Fase A) —
// `construirTarifaServicioDesdeCatalogo` real ahora nace con
// `aplicaAiu:false` (el usuario debe marcarlo a propósito). Estos tests de
// Fase A verifican la fórmula de suma/AIU-por-cargo cuando SÍ aplica AIU
// (igual que el comportamiento histórico que Fase A siempre probó) — este
// wrapper local fuerza `aplicaAiu:true` explícito bajo el MISMO nombre que
// usa el resto del archivo, para no acoplar la intención de estos tests
// (AIU aplicado) al valor por defecto de un ajuste posterior y no
// relacionado con Fase A. Los tests que necesitan `aplicaAiu:false`
// explícito lo siguen sobrescribiendo aparte (gana el spread posterior).
function construirTarifaServicioDesdeCatalogo(entrada: Parameters<typeof construirTarifaServicioDesdeCatalogoBase>[0], fuenteTarifa: TarifaServicioAseocolba['fuenteTarifa']): TarifaServicioAseocolba {
  return { ...construirTarifaServicioDesdeCatalogoBase(entrada, fuenteTarifa), aplicaAiu: true };
}

function servicioBase(overrides: Partial<ServicioNoContinuo> = {}): ServicioNoContinuo {
  return {
    id: '1', descripcion: 'x',
    manoObra: [], dotacionEpp: [],
    examenesMedicos: { examenes: [], cursos: [], vacunas: [] },
    insumos: [], maquinariaEquipos: [],
    ...overrides,
  };
}

const OPERARIO_TODERO_MENSUAL = buscarTarifaCatalogoAseocolba('MENSUAL_OPERARIO_TODERO_42_LS')!; // valorUnitarioConAIU 3785290
const COORDINADOR_DIA = buscarTarifaCatalogoAseocolba('DIA_COORDINADOR_SERVICIO_ESPECIAL_DIURNA_HABIL')!; // valorUnitarioConAIU 238949 (por día)

describe('Fase A — 1 SNC con 1 tarifa (mismo resultado que antes)', () => {
  it('un servicio con tarifas:[unaTarifa] calcula exactamente igual que el formato antiguo tarifa singular', () => {
    const tarifa = { ...construirTarifaServicioDesdeCatalogo(OPERARIO_TODERO_MENSUAL, 'SELECCION_MANUAL'), cantidadPersonas: 2 };
    const conTarifaSingular = calcularTotalesServicioNoContinuo(servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA', tarifa }), 0);
    const conTarifasArreglo = calcularTotalesServicioNoContinuo(servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA', tarifas: [tarifa] }), 0);
    expect(conTarifasArreglo).toEqual(conTarifaSingular);
    expect(conTarifaSingular.total).toBe(3785290 * 2);
  });
});

describe('Fase A — 1 SNC con 2 cargos/tarifas', () => {
  it('suma correctamente 2 cargos independientes (Operario Todero mensual × 2 + Coordinador día × 1)', () => {
    const todero = { ...construirTarifaServicioDesdeCatalogo(OPERARIO_TODERO_MENSUAL, 'SELECCION_MANUAL'), cantidadPersonas: 2 };
    const coordinador = { ...construirTarifaServicioDesdeCatalogo(COORDINADOR_DIA, 'SELECCION_MANUAL'), cantidadPersonas: 1, cantidadDias: 1 };
    const s = servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA', tarifas: [todero, coordinador] });
    const r = calcularTotalesServicioNoContinuo(s, 0);
    const esperadoTodero = 3785290 * 2; // 7570580
    const esperadoCoordinador = 238949 * 1 * 1; // 238949
    expect(r.tarifaValida).toBe(true);
    expect(r.total).toBe(esperadoTodero + esperadoCoordinador);
    expect(r.total).toBe(7809529);
  });
});

describe('Fase A — 1 SNC con 3 cargos/tarifas y cantidades distintas por cargo', () => {
  it('suma correctamente 3 cargos con cantidades de personas/días distintas entre sí', () => {
    const toderoX2 = { ...construirTarifaServicioDesdeCatalogo(OPERARIO_TODERO_MENSUAL, 'SELECCION_MANUAL'), cantidadPersonas: 2 };
    const toderoX1 = { ...construirTarifaServicioDesdeCatalogo(OPERARIO_TODERO_MENSUAL, 'SELECCION_MANUAL'), cantidadPersonas: 1 };
    const coordinadorX1X3Dias = { ...construirTarifaServicioDesdeCatalogo(COORDINADOR_DIA, 'SELECCION_MANUAL'), cantidadPersonas: 1, cantidadDias: 3 };
    const s = servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA', tarifas: [toderoX2, toderoX1, coordinadorX1X3Dias] });
    const r = calcularTotalesServicioNoContinuo(s, 0);
    const esperado = (3785290 * 2) + (3785290 * 1) + (238949 * 1 * 3);
    expect(r.tarifaValida).toBe(true);
    expect(r.total).toBe(esperado);
    expect(r.total).toBe(12072717);
  });
});

describe('Fase A — AIU independiente por cargo, sin duplicación', () => {
  it('un cargo con AIU desactivado y otro con AIU activo se calculan cada uno con su propia regla, nunca un AIU global sobre la suma', () => {
    const toderoSinAiu = { ...construirTarifaServicioDesdeCatalogo(OPERARIO_TODERO_MENSUAL, 'SELECCION_MANUAL'), cantidadPersonas: 1, aplicaAiu: false as const };
    const coordinadorConAiu = { ...construirTarifaServicioDesdeCatalogo(COORDINADOR_DIA, 'SELECCION_MANUAL'), cantidadPersonas: 1, cantidadDias: 1 };
    const s = servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA', tarifas: [toderoSinAiu, coordinadorConAiu] });
    const r = calcularTotalesServicioNoContinuo(s, 0);
    // Todero sin AIU usa valorBase (3441172), Coordinador con AIU usa valorUnitarioConAIU (238949)
    const esperado = (3441172 * 1) + (238949 * 1 * 1);
    expect(r.total).toBe(esperado);
    // Ningún porcentaje de AIU global se vuelve a aplicar sobre la suma:
    // el total no coincide con aplicar 10%/20% otra vez sobre `esperado`.
    expect(r.total).not.toBe(Math.round(esperado * 1.1));
    expect(r.total).not.toBe(Math.round(esperado * 1.2));
  });
});

describe('Fase A — Insumos y Maquinaria se suman UNA sola vez, sin importar cuántas tarifas tenga el SNC', () => {
  it('insumos se suman una sola vez con 2 cargos configurados', () => {
    const todero = { ...construirTarifaServicioDesdeCatalogo(OPERARIO_TODERO_MENSUAL, 'SELECCION_MANUAL'), cantidadPersonas: 1 };
    const coordinador = { ...construirTarifaServicioDesdeCatalogo(COORDINADOR_DIA, 'SELECCION_MANUAL'), cantidadPersonas: 1, cantidadDias: 1 };
    const insumos = [{ id: 1, origen: 'MANUAL' as const, codigo: '', nombre: 'Guantes', cantidad: 10, frecuenciaMeses: 1, valorUnitarioSinIva: 1000, valorUnitarioConIva: 1190, valorMensual: 11900 }];
    const s = servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA', tarifas: [todero, coordinador], insumos });
    const r = calcularTotalesServicioNoContinuo(s, 0);
    expect(r.insumos).toBe(11900);
    expect(r.total).toBe((3785290) + (238949) + 11900);
  });
  it('maquinaria/equipos se suman una sola vez con 3 cargos configurados', () => {
    const toderoA = { ...construirTarifaServicioDesdeCatalogo(OPERARIO_TODERO_MENSUAL, 'SELECCION_MANUAL'), cantidadPersonas: 1 };
    const toderoB = { ...construirTarifaServicioDesdeCatalogo(OPERARIO_TODERO_MENSUAL, 'SELECCION_MANUAL'), cantidadPersonas: 1 };
    const coordinador = { ...construirTarifaServicioDesdeCatalogo(COORDINADOR_DIA, 'SELECCION_MANUAL'), cantidadPersonas: 1, cantidadDias: 1 };
    const maquinariaEquipos = [{
      id: 1, origen: 'MANUAL' as const, descripcion: 'Hidrolavadora',
      cantidadRequerida: 1, mesesDepreciacion: 12,
      valorUnitario: 1200000, incluyeIva: true, valorConIva: 1200000,
      valorMesRequerido: 100000,
      cantidadDisponible: 0, cantidadComprar: 1,
      valorMesComprar: 100000,
      valorMantenimientoMensualUnitario: null, valorMesMantenimiento: 0,
      origenMantenimiento: 'SIN_COINCIDENCIA' as const,
    }];
    const s = servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA', tarifas: [toderoA, toderoB, coordinador], maquinariaEquipos });
    const r = calcularTotalesServicioNoContinuo(s, 0);
    expect(r.maquinariaEquipos).toBe(100000);
    expect(r.total).toBe((3785290) + (3785290) + (238949) + 100000);
  });
});

describe('Fase A — retrocompatibilidad de formato', () => {
  it('formato antiguo `tarifa` (singular) sigue cargando correctamente vía tarifasServicio', () => {
    const tarifa = { ...construirTarifaServicioDesdeCatalogo(OPERARIO_TODERO_MENSUAL, 'MAPEO_AUTOMATICO'), cantidadPersonas: 3 };
    const s = servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA', tarifa });
    expect(tarifasServicio(s)).toEqual([tarifa]);
    const r = calcularTotalesServicioNoContinuo(s, 0);
    expect(r.tarifaValida).toBe(true);
    expect(r.total).toBe(3785290 * 3);
  });
  it('formato nuevo `tarifas[]` carga correctamente', () => {
    const a = { ...construirTarifaServicioDesdeCatalogo(OPERARIO_TODERO_MENSUAL, 'SELECCION_MANUAL'), cantidadPersonas: 1 };
    const b = { ...construirTarifaServicioDesdeCatalogo(COORDINADOR_DIA, 'SELECCION_MANUAL'), cantidadPersonas: 1, cantidadDias: 2 };
    const s = servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA', tarifas: [a, b] });
    expect(tarifasServicio(s)).toEqual([a, b]);
  });
  it('`tarifas: []` se comporta como SNC sin cargo configurado (mismo mensaje que el formato antiguo sin `tarifa`)', () => {
    const sinTarifaViejo = calcularTotalesServicioNoContinuo(servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA' }), 0);
    const tarifasVacio = calcularTotalesServicioNoContinuo(servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA', tarifas: [] }), 0);
    expect(tarifasVacio).toEqual(sinTarifaViejo);
    expect(tarifasVacio.total).toBe(0);
    expect(tarifasVacio.tarifaValida).toBe(false);
    expect(tarifasVacio.tarifaMotivoInvalido).toBeTruthy();
  });
});

describe('Fase A — camino genérico (manoObra[]) sin regresión', () => {
  it('un servicio sin tipoCalculo (o ESTRUCTURA_COSTOS) ignora tarifas[] por completo y sigue sumando los 5 bloques históricos', () => {
    const s = servicioBase({ manoObra: [] as any, tarifas: [{ ...construirTarifaServicioDesdeCatalogo(OPERARIO_TODERO_MENSUAL, 'SELECCION_MANUAL'), cantidadPersonas: 99 }] });
    const r = calcularTotalesServicioNoContinuo(s, 500000);
    expect(r.manoObra).toBe(500000);
    expect(r.total).toBe(500000);
  });
});

describe('Fase A — servicioNoContinuoTieneDatos/serviciosNoContinuosTienenDatos reconocen tarifas[]', () => {
  it('con tarifas:[algo], tiene datos', () => {
    const tarifa = construirTarifaServicioDesdeCatalogo(OPERARIO_TODERO_MENSUAL, 'SELECCION_MANUAL');
    const s = servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA', tarifas: [tarifa] });
    expect(servicioNoContinuoTieneDatos(s)).toBe(true);
    expect(serviciosNoContinuosTienenDatos([s])).toBe(true);
  });
  it('con tarifas:[], NO tiene datos', () => {
    const s = servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA', tarifas: [] });
    expect(servicioNoContinuoTieneDatos(s)).toBe(false);
  });
  it('crearServicioNoContinuoVacio sigue sin fijar tarifas (retrocompatible, N=0 por defecto)', () => {
    const s = crearServicioNoContinuoVacio('1', '', 'TARIFA_ASEOCOLBA');
    expect(tarifasServicio(s)).toEqual([]);
    expect(servicioNoContinuoTieneDatos(s)).toBe(false);
  });
});
