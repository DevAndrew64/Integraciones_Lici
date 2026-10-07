/**
 * Ajuste "SERVICIOS NO CONTINUOS — FASE 2 MVP: TARIFARIO ASEOCOLBA" —
 * bifurcación de `calcularTotalesServicioNoContinuo` por `tipoCalculo`.
 * El cálculo HISTÓRICO (ausencia de `tipoCalculo`, o `'ESTRUCTURA_COSTOS'`)
 * debe quedar exactamente igual — ver también
 * `servicios-no-continuos-catalogo-aseocolba.test.ts` (Fase 1), que ya
 * fija por texto fuente la fórmula histórica intacta.
 */
import { describe, expect, it } from 'vitest';
import {
  calcularTotalesServicioNoContinuo, crearServicioNoContinuoVacio, servicioNoContinuoTieneDatos,
  type ServicioNoContinuo,
} from './servicios-no-continuos';
import { construirTarifaServicioDesdeCatalogo, buscarTarifaCatalogoAseocolba } from './tarifario-especiales-aseocolba';

function servicioBase(overrides: Partial<ServicioNoContinuo> = {}): ServicioNoContinuo {
  return {
    id: '1', descripcion: 'x',
    manoObra: [], dotacionEpp: [],
    examenesMedicos: { examenes: [], cursos: [], vacunas: [] },
    insumos: [], maquinariaEquipos: [],
    ...overrides,
  };
}

describe('calcularTotalesServicioNoContinuo — retrocompatibilidad histórica exacta', () => {
  it('servicio SIN tipoCalculo (dato antiguo) calcula exactamente igual que antes de esta fase (suma de los 5 bloques, ignora tarifa)', () => {
    const s = servicioBase();
    const r = calcularTotalesServicioNoContinuo(s, 500000);
    expect(r.manoObra).toBe(500000);
    expect(r.total).toBe(500000);
    expect(r.tarifaValida).toBeUndefined();
    expect(r.tarifaValorBase).toBeUndefined();
  });
  it('servicio con tipoCalculo="ESTRUCTURA_COSTOS" explícito calcula igual que ausente', () => {
    const sinTipo = calcularTotalesServicioNoContinuo(servicioBase(), 200000);
    const conTipo = calcularTotalesServicioNoContinuo(servicioBase({ tipoCalculo: 'ESTRUCTURA_COSTOS' }), 200000);
    expect(conTipo).toEqual(sinTipo);
  });
  it('un servicio TARIFA_ASEOCOLBA nunca lee sus 5 bloques históricos aunque tengan datos (aislamiento del cálculo)', () => {
    const entrada = buscarTarifaCatalogoAseocolba('MENSUAL_OPERARIO_ASEO_42_LS_SIN_INSUMOS')!;
    const tarifa = { ...construirTarifaServicioDesdeCatalogo(entrada, 'MAPEO_AUTOMATICO'), cantidadPersonas: 2 };
    const s = servicioBase({
      tipoCalculo: 'TARIFA_ASEOCOLBA', tarifa,
      insumos: [{ id: 1, origen: 'MANUAL', codigo: '', nombre: 'x', cantidad: 999, frecuenciaMeses: 1, valorUnitarioSinIva: 999999, valorUnitarioConIva: 999999, valorMensual: 999999999 }],
    });
    const r = calcularTotalesServicioNoContinuo(s, 123456789);
    expect(r.manoObra).toBe(0);
    expect(r.insumos).toBe(0);
    expect(r.total).toBe(3070947 * 2);
  });
});

describe('calcularTotalesServicioNoContinuo — rama TARIFA_ASEOCOLBA', () => {
  it('expone tarifaValida/tarifaValorBase/tarifaPorcentajeAIU/tarifaValorUnitarioConAIU', () => {
    // Ajuste "APLICA AIU POR DEFECTO DESACTIVADO" (ronda posterior a esta
    // fase) — `construirTarifaServicioDesdeCatalogo` real ahora nace con
    // `aplicaAiu:false`; este test verifica explícitamente el valor CON
    // AIU (su intención original), así que fuerza `aplicaAiu:true` en vez
    // de depender del default.
    const entrada = buscarTarifaCatalogoAseocolba('DIA_OPERARIO_DIURNA_HABIL')!;
    const tarifa = { ...construirTarifaServicioDesdeCatalogo(entrada, 'SELECCION_MANUAL'), cantidadPersonas: 2, cantidadDias: 3, aplicaAiu: true as const };
    const s = servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA', tarifa });
    const r = calcularTotalesServicioNoContinuo(s, 0);
    expect(r.tarifaValida).toBe(true);
    expect(r.tarifaValorBase).toBe(116324);
    expect(r.tarifaPorcentajeAIU).toBe(20);
    expect(r.tarifaValorUnitarioConAIU).toBe(139589);
    expect(r.total).toBe(837534);
  });
  it('servicio TARIFA_ASEOCOLBA sin tarifa asignada: total 0 pero tarifaValida=false (nunca $0 disfrazado de válido)', () => {
    const s = servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA' });
    const r = calcularTotalesServicioNoContinuo(s, 0);
    expect(r.total).toBe(0);
    expect(r.tarifaValida).toBe(false);
    expect(r.tarifaMotivoInvalido).toBeTruthy();
  });
});

describe('crearServicioNoContinuoVacio — tipoCalculo opcional retrocompatible', () => {
  it('sin tercer argumento, no fija tipoCalculo (retrocompatible con Fase 1)', () => {
    const s = crearServicioNoContinuoVacio('1');
    expect(s.tipoCalculo).toBeUndefined();
  });
  it("con tercer argumento 'TARIFA_ASEOCOLBA', lo fija explícitamente", () => {
    const s = crearServicioNoContinuoVacio('1', '', 'TARIFA_ASEOCOLBA');
    expect(s.tipoCalculo).toBe('TARIFA_ASEOCOLBA');
    expect(s.manoObra).toEqual([]);
  });
});

describe('servicioNoContinuoTieneDatos — caso TARIFA_ASEOCOLBA', () => {
  it('con tarifa asignada, tiene datos', () => {
    const entrada = buscarTarifaCatalogoAseocolba('DIA_OPERARIO_DIURNA_HABIL')!;
    const s = servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA', tarifa: construirTarifaServicioDesdeCatalogo(entrada, 'MAPEO_AUTOMATICO') });
    expect(servicioNoContinuoTieneDatos(s)).toBe(true);
  });
  it('sin tarifa asignada, NO tiene datos (aunque exista tipoCalculo)', () => {
    const s = servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA' });
    expect(servicioNoContinuoTieneDatos(s)).toBe(false);
  });
});
