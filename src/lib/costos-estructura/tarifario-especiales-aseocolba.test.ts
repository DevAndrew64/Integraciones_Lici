/**
 * Ajuste "SERVICIOS NO CONTINUOS — FASE 2 MVP: TARIFARIO ASEOCOLBA" —
 * cobertura del motor puro y del catálogo provisional 2026-II. Los
 * valores de referencia son los verificados en las rondas de diagnóstico
 * previas (hoja "Tarifas mes 42H" del Excel real).
 */
import { describe, expect, it } from 'vitest';
import {
  CATALOGO_PROVISIONAL_ASEOCOLBA, FUENTE_TARIFARIO_PROVISIONAL, VIGENTE_HASTA_TARIFARIO_PROVISIONAL,
  buscarTarifaCatalogoAseocolba, resolverTarifaServicioNoContinuo, claveMapeoCodigoUen,
  construirTarifaServicioDesdeCatalogo, calcularTarifaServicioAseocolba,
  type TarifaServicioAseocolba,
} from './tarifario-especiales-aseocolba';

function tarifaServicio(overrides: Partial<TarifaServicioAseocolba> = {}): TarifaServicioAseocolba {
  return {
    tarifaKey: 'DIA_OPERARIO_DIURNA_HABIL', modalidad: 'DIA', descripcionTarifa: 'Operario · Diurna · Hábil',
    cargo: 'OPERARIO', jornada: 'DIURNA', tipoDia: 'HABIL', conInsumos: false, cantidadPersonas: 1,
    fuenteTarifa: 'MAPEO_AUTOMATICO',
    ...overrides,
  };
}

describe('CATALOGO_PROVISIONAL_ASEOCOLBA — identidad del proveedor', () => {
  it('36 entradas: 10 MENSUAL + 12 DIA + 12 HORA + 2 JORNADA parcial', () => {
    expect(CATALOGO_PROVISIONAL_ASEOCOLBA.filter(t => t.modalidad === 'MENSUAL')).toHaveLength(10);
    expect(CATALOGO_PROVISIONAL_ASEOCOLBA.filter(t => t.modalidad === 'DIA')).toHaveLength(12);
    expect(CATALOGO_PROVISIONAL_ASEOCOLBA.filter(t => t.modalidad === 'HORA')).toHaveLength(12);
    expect(CATALOGO_PROVISIONAL_ASEOCOLBA.filter(t => t.modalidad === 'JORNADA_6H')).toHaveLength(1);
    expect(CATALOGO_PROVISIONAL_ASEOCOLBA.filter(t => t.modalidad === 'JORNADA_4H')).toHaveLength(1);
  });
  it('todas las entradas se identifican con fuente EXCEL_2026_II_PROVISIONAL y vigenteHasta 2026-12-31', () => {
    expect(FUENTE_TARIFARIO_PROVISIONAL).toBe('EXCEL_2026_II_PROVISIONAL');
    expect(VIGENTE_HASTA_TARIFARIO_PROVISIONAL).toBe('2026-12-31');
    expect(CATALOGO_PROVISIONAL_ASEOCOLBA.every(t => t.fuente === 'EXCEL_2026_II_PROVISIONAL' && t.vigenteHasta === '2026-12-31')).toBe(true);
  });
  it('tarifaKey es único en todo el catálogo (identidad estable, nunca la descripción)', () => {
    const claves = CATALOGO_PROVISIONAL_ASEOCOLBA.map(t => t.tarifaKey);
    expect(new Set(claves).size).toBe(claves.length);
  });
  it('MENSUAL: valores reales verificados (Oper Aseo 42h sin/con insumos)', () => {
    const sinInsumos = buscarTarifaCatalogoAseocolba('MENSUAL_OPERARIO_ASEO_42_LS_SIN_INSUMOS');
    expect(sinInsumos).toMatchObject({ valorBase: 2791770, porcentajeAIU: 10, valorUnitarioConAIU: 3070947, conInsumos: false });
    const conInsumos = buscarTarifaCatalogoAseocolba('MENSUAL_OPERARIO_ASEO_42_LS_CON_INSUMOS');
    expect(conInsumos).toMatchObject({ valorBase: 2990717, porcentajeAIU: 10, valorUnitarioConAIU: 3289789, conInsumos: true });
  });
  it('DIA: valor real verificado (Operario/Diurna/Hábil)', () => {
    expect(buscarTarifaCatalogoAseocolba('DIA_OPERARIO_DIURNA_HABIL')).toMatchObject({ valorBase: 116324, porcentajeAIU: 20, valorUnitarioConAIU: 139589 });
  });
  it('HORA: valor real verificado, independiente de DIA (nunca dia/7)', () => {
    const hora = buscarTarifaCatalogoAseocolba('HORA_OPERARIO_DIURNA_HABIL');
    expect(hora).toMatchObject({ valorBase: 15870, porcentajeAIU: 20, valorUnitarioConAIU: 19043 });
    expect(hora!.valorBase).not.toBeCloseTo(116324 / 7, 0);
  });
  it('JORNADA_6H/JORNADA_4H: valores reales verificados, no derivados de HORA×horas', () => {
    const j6 = buscarTarifaCatalogoAseocolba('JORNADA_6H_OPERARIO_DIURNA_HABIL');
    expect(j6).toMatchObject({ valorBase: 103101, porcentajeAIU: 20, valorUnitarioConAIU: 123721 });
    expect(j6!.valorBase).not.toBe(15870 * 6);
    const j4 = buscarTarifaCatalogoAseocolba('JORNADA_4H_OPERARIO_DIURNA_HABIL');
    expect(j4).toMatchObject({ valorBase: 76657, porcentajeAIU: 20, valorUnitarioConAIU: 91989 });
    expect(j4!.valorBase).not.toBe(15870 * 4);
  });
  it('buscarTarifaCatalogoAseocolba(undefined) → null, nunca lanza', () => {
    expect(buscarTarifaCatalogoAseocolba(undefined)).toBeNull();
  });
});

describe('resolverTarifaServicioNoContinuo — capa de asignación centralizada', () => {
  it('mapeo provisional vacío hoy: cualquier codigo+uen devuelve null (nunca un mapping inventado)', () => {
    expect(resolverTarifaServicioNoContinuo('1', 'BAQ')).toBeNull();
    expect(resolverTarifaServicioNoContinuo('94', 'BAQ')).toBeNull(); // BRIGADA DE ASEO (5 OPERARIOS), sin mapping todavía
  });
  it('claveMapeoCodigoUen compone codigo::uen', () => {
    expect(claveMapeoCodigoUen('1', 'BAQ')).toBe('1::BAQ');
  });
});

describe('construirTarifaServicioDesdeCatalogo', () => {
  it('copia identidad+config del catálogo, cantidadPersonas=1 por defecto, sin cantidadDias/Horas', () => {
    const entrada = buscarTarifaCatalogoAseocolba('DIA_OPERARIO_DIURNA_HABIL')!;
    const t = construirTarifaServicioDesdeCatalogo(entrada, 'SELECCION_MANUAL');
    expect(t).toMatchObject({
      tarifaKey: 'DIA_OPERARIO_DIURNA_HABIL', modalidad: 'DIA', cargo: 'OPERARIO', jornada: 'DIURNA', tipoDia: 'HABIL',
      conInsumos: false, cantidadPersonas: 1, fuenteTarifa: 'SELECCION_MANUAL',
    });
    expect(t.cantidadDias).toBeUndefined();
    expect(t.cantidadHoras).toBeUndefined();
  });
});

describe('calcularTarifaServicioAseocolba — MENSUAL: total = valorUnitarioConAIU × cantidadPersonas', () => {
  it('3 personas', () => {
    const entrada = buscarTarifaCatalogoAseocolba('MENSUAL_OPERARIO_ASEO_42_LS_SIN_INSUMOS')!;
    const t = tarifaServicio({ tarifaKey: entrada.tarifaKey, modalidad: 'MENSUAL', cargo: 'OPERARIO', jornada: undefined, tipoDia: undefined, cantidadPersonas: 3 });
    const r = calcularTarifaServicioAseocolba(t, entrada);
    expect(r.valido).toBe(true);
    expect(r.total).toBe(3070947 * 3);
  });
  it('no usa cantidad de meses (MVP: solo valor mensual del servicio)', () => {
    const entrada = buscarTarifaCatalogoAseocolba('MENSUAL_OPERARIO_ASEO_42_LS_SIN_INSUMOS')!;
    const t = tarifaServicio({ tarifaKey: entrada.tarifaKey, modalidad: 'MENSUAL', cantidadPersonas: 1 });
    const r = calcularTarifaServicioAseocolba(t, entrada);
    expect(r.total).toBe(3070947);
  });
});

describe('calcularTarifaServicioAseocolba — DIA: total = valorUnitarioConAIU × personas × días', () => {
  it('ejemplo del usuario: 2 Operarios / Día / Diurna / Hábil / 3 días = 837.534', () => {
    const entrada = buscarTarifaCatalogoAseocolba('DIA_OPERARIO_DIURNA_HABIL')!;
    const t = tarifaServicio({ cantidadPersonas: 2, cantidadDias: 3 });
    const r = calcularTarifaServicioAseocolba(t, entrada);
    expect(r.valido).toBe(true);
    expect(r.valorUnitarioConAIU).toBe(139589);
    expect(r.total).toBe(139589 * 2 * 3);
    expect(r.total).toBe(837534);
  });
  it('cambiar jornada/tipoDia cambia la tarifa aplicada (claves distintas del catálogo)', () => {
    const diurnaHabil = buscarTarifaCatalogoAseocolba('DIA_OPERARIO_DIURNA_HABIL')!;
    const nocturnaDomFest = buscarTarifaCatalogoAseocolba('DIA_OPERARIO_NOCTURNA_DOM_FEST')!;
    expect(diurnaHabil.valorUnitarioConAIU).not.toBe(nocturnaDomFest.valorUnitarioConAIU);
    const r1 = calcularTarifaServicioAseocolba(tarifaServicio({ tarifaKey: diurnaHabil.tarifaKey, cantidadPersonas: 1, cantidadDias: 1 }), diurnaHabil);
    const r2 = calcularTarifaServicioAseocolba(tarifaServicio({ tarifaKey: nocturnaDomFest.tarifaKey, jornada: 'NOCTURNA', tipoDia: 'DOMINICAL_FESTIVO', cantidadPersonas: 1, cantidadDias: 1 }), nocturnaDomFest);
    expect(r1.total).not.toBe(r2.total);
  });
});

describe('calcularTarifaServicioAseocolba — HORA: total = valorUnitarioConAIU × personas × horas', () => {
  it('2 personas × 5 horas', () => {
    const entrada = buscarTarifaCatalogoAseocolba('HORA_OPERARIO_DIURNA_HABIL')!;
    const t = tarifaServicio({ tarifaKey: entrada.tarifaKey, modalidad: 'HORA', cantidadPersonas: 2, cantidadHoras: 5, cantidadDias: undefined });
    const r = calcularTarifaServicioAseocolba(t, entrada);
    expect(r.valido).toBe(true);
    expect(r.total).toBe(19043 * 2 * 5);
  });
});

describe('calcularTarifaServicioAseocolba — JORNADA_6H/JORNADA_4H: total = valorUnitarioConAIU × personas × días', () => {
  it('JORNADA_6H, 2 personas × 4 días', () => {
    const entrada = buscarTarifaCatalogoAseocolba('JORNADA_6H_OPERARIO_DIURNA_HABIL')!;
    const t = tarifaServicio({ tarifaKey: entrada.tarifaKey, modalidad: 'JORNADA_6H', cantidadPersonas: 2, cantidadDias: 4 });
    const r = calcularTarifaServicioAseocolba(t, entrada);
    expect(r.total).toBe(123721 * 2 * 4);
  });
  it('JORNADA_4H, 1 persona × 2 días', () => {
    const entrada = buscarTarifaCatalogoAseocolba('JORNADA_4H_OPERARIO_DIURNA_HABIL')!;
    const t = tarifaServicio({ tarifaKey: entrada.tarifaKey, modalidad: 'JORNADA_4H', cantidadPersonas: 1, cantidadDias: 2 });
    const r = calcularTarifaServicioAseocolba(t, entrada);
    expect(r.total).toBe(91989 * 1 * 2);
  });
});

describe('calcularTarifaServicioAseocolba — con/sin insumos', () => {
  it('conInsumos=true CON variante explícita en el catálogo (MENSUAL Oper Aseo 42h) usa esa tarifa directamente', () => {
    const entrada = buscarTarifaCatalogoAseocolba('MENSUAL_OPERARIO_ASEO_42_LS_CON_INSUMOS')!;
    const t = tarifaServicio({ tarifaKey: entrada.tarifaKey, modalidad: 'MENSUAL', conInsumos: true, cantidadPersonas: 1, jornada: undefined, tipoDia: undefined });
    const r = calcularTarifaServicioAseocolba(t, entrada);
    expect(r.valido).toBe(true);
    expect(r.valorUnitarioConAIU).toBe(3289789);
  });
  it('conInsumos=true SIN variante explícita (ej. DIA) y SIN override → inválido, nunca inventa un valor', () => {
    const entrada = buscarTarifaCatalogoAseocolba('DIA_OPERARIO_DIURNA_HABIL')!;
    const t = tarifaServicio({ conInsumos: true });
    const r = calcularTarifaServicioAseocolba(t, entrada);
    expect(r.valido).toBe(false);
    expect(r.total).toBe(0);
    expect(r.motivoInvalido).toMatch(/insumos/i);
  });
  it('conInsumos=true SIN variante explícita CON override provisional → usa el override, marca válido', () => {
    const entrada = buscarTarifaCatalogoAseocolba('DIA_OPERARIO_DIURNA_HABIL')!;
    const t = tarifaServicio({ conInsumos: true, valorUnitarioOverride: 150000, cantidadPersonas: 1, cantidadDias: 1 });
    const r = calcularTarifaServicioAseocolba(t, entrada);
    expect(r.valido).toBe(true);
    expect(r.valorUnitarioConAIU).toBe(150000);
    expect(r.total).toBe(150000);
  });
});

describe('calcularTarifaServicioAseocolba — tarifa no encontrada NUNCA produce $0 silencioso', () => {
  it('sin tarifa asignada (undefined) → inválido, motivo explícito', () => {
    const r = calcularTarifaServicioAseocolba(undefined, null);
    expect(r.valido).toBe(false);
    expect(r.total).toBe(0);
    expect(r.motivoInvalido).toBeTruthy();
  });
  it('tarifaKey que ya no existe en el catálogo vigente (sin override) → inválido, motivo explícito', () => {
    const t = tarifaServicio({ tarifaKey: 'CLAVE_QUE_NO_EXISTE', cantidadPersonas: 5, cantidadDias: 10 });
    const r = calcularTarifaServicioAseocolba(t, null);
    expect(r.valido).toBe(false);
    expect(r.total).toBe(0);
    expect(r.motivoInvalido).toMatch(/no existe/i);
  });
});
