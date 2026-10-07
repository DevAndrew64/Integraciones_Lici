import { describe, expect, it } from 'vitest';
import {
  calcularLineaMOServicioNoContinuo, calcularTotalManoObraServicio,
  calcularValorMensualItemDotacionEpp, calcularTotalDotacionEppServicio,
  calcularValorMensualItemExamenMedico, calcularTotalesExamenesMedicosServicio,
  calcularValorMensualInsumoServicio, calcularTotalInsumosServicio,
  calcularTotalMaquinariaServicio,
  calcularTotalesServicioNoContinuo, calcularTotalServiciosNoContinuos,
  crearServicioNoContinuoVacio, servicioNoContinuoTieneDatos, serviciosNoContinuosTienenDatos,
  type ServicioNoContinuo, type LineaMOServicioNoContinuo,
  type ItemExamenMedicoServicioNoContinuo, type InsumoServicioNoContinuo, type MaquinariaServicioNoContinuo,
} from './servicios-no-continuos';
import { resolverParametrosFinancierosManoObra } from '../costos-mano-obra/motor-distribuido/parametros-financieros-mano-obra';
import { calcularCamposMaquinariaEquipo } from './calculo-maquinaria';
import { calcularValorUnitarioConIva, calcularValorMensualInsumo } from './calculo-insumos';
import type { DotGroup, DotItemRow } from '../costos-mano-obra/motor-distribuido/dotacion-epp-tipo';

const parametros = resolverParametrosFinancierosManoObra(undefined);

function lineaMO(overrides: Partial<LineaMOServicioNoContinuo> = {}): LineaMOServicioNoContinuo {
  return { id: 1, cargo: 'Operario', cantidadTrabajadores: 1, salarioBasicoMensual: 1300000, auxilioTransporteMensual: 162000, claseArl: 'II', ...overrides };
}
function filaEpp(overrides: Partial<DotItemRow> = {}): DotItemRow {
  return { id: 1, codigo: '', desc: 'Casco', medida: 'UND', cant: 2, frec: 12, vUnit: 50000, section: 'epp', ...overrides };
}
function grupoEpp(overrides: Partial<DotGroup> = {}, filaOverrides: Partial<DotItemRow> = {}): DotGroup {
  return { id: 1, tipo: 'epp', nombre: 'EPP', rows: [filaEpp(filaOverrides)], categoria: 'EPP', ...overrides };
}
function itemExam(overrides: Partial<ItemExamenMedicoServicioNoContinuo> = {}): ItemExamenMedicoServicioNoContinuo {
  return { id: 1, concepto: 'Examen ingreso', cantidad: 1, frecuenciaMeses: 12, valorUnitario: 60000, ...overrides };
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

describe('Mano de Obra del servicio — cálculo puro', () => {
  it('calcula prestaciones/seguridad social/parafiscales sobre el salario básico', () => {
    const r = calcularLineaMOServicioNoContinuo(lineaMO(), parametros);
    expect(r.tarifaMensualPorTrabajador).toBeGreaterThan(1300000);
    expect(r.prestacionesSocialesMensuales).toBeGreaterThan(0);
    expect(r.seguridadSocialMensual).toBeGreaterThan(0);
  });
  it('multiplica la tarifa por trabajador por la cantidad de trabajadores', () => {
    const r1 = calcularLineaMOServicioNoContinuo(lineaMO({ cantidadTrabajadores: 1 }), parametros);
    const r2 = calcularLineaMOServicioNoContinuo(lineaMO({ cantidadTrabajadores: 3 }), parametros);
    expect(r2.tarifaMensualLinea).toBe(r1.tarifaMensualPorTrabajador * 3);
  });
  it('total de Mano de Obra del servicio es la suma de tarifaMensualLinea de cada línea', () => {
    const lineas = [lineaMO({ id: 1, cantidadTrabajadores: 2 }), lineaMO({ id: 2, cantidadTrabajadores: 1, salarioBasicoMensual: 1500000 })];
    const total = calcularTotalManoObraServicio(lineas, parametros);
    const esperado = lineas.reduce((s, l) => s + calcularLineaMOServicioNoContinuo(l, parametros).tarifaMensualLinea, 0);
    expect(total).toBe(esperado);
  });
});

describe('EPP/Dotación del servicio — cálculo puro (reutiliza DotGroup/DotItemRow, mismo tipo que el modal global)', () => {
  it('valorMensual = cantidad × valorUnitario con IVA / frecuencia', () => {
    const v = calcularValorMensualItemDotacionEpp(filaEpp({ cant: 2, vUnit: 50000, frec: 12 }));
    expect(v).toBe(Math.floor((2 * 50000 * 1.19) / 12));
  });
  it('total EPP/Dotación es la suma de todas las filas de todos los grupos', () => {
    const grupos = [grupoEpp({ id: 1 }), grupoEpp({ id: 2, tipo: 'dot', categoria: 'DOTACION_MASCULINA' }, { id: 2, cant: 1 })];
    const filas = grupos.flatMap(g => g.rows);
    expect(calcularTotalDotacionEppServicio(grupos)).toBe(filas.reduce((s, i) => s + calcularValorMensualItemDotacionEpp(i), 0));
  });
});

describe('Exámenes Médicos del servicio — Exámenes/Cursos/Vacunas independientes', () => {
  it('valorMensual = cantidad × valorUnitario / frecuencia', () => {
    expect(calcularValorMensualItemExamenMedico(itemExam({ cantidad: 2, valorUnitario: 60000, frecuenciaMeses: 12 }))).toBe((2 * 60000) / 12);
  });
  it('Total Exámenes Médicos = Exámenes + Cursos + Vacunas', () => {
    const bloque = {
      examenes: [itemExam({ id: 1 })],
      cursos: [itemExam({ id: 2, concepto: 'Curso alturas', valorUnitario: 80000 })],
      vacunas: [itemExam({ id: 3, concepto: 'Tétanos', valorUnitario: 30000 })],
    };
    const t = calcularTotalesExamenesMedicosServicio(bloque);
    expect(t.totalExamenesMedicos).toBeCloseTo(t.totalExamenes + t.totalCursos + t.totalVacunas, 6);
  });
  it('un bloque vacío (ej. sin cursos) no afecta el cálculo de los otros dos', () => {
    const t = calcularTotalesExamenesMedicosServicio({ examenes: [itemExam()], cursos: [], vacunas: [] });
    expect(t.totalCursos).toBe(0);
    expect(t.totalExamenesMedicos).toBe(t.totalExamenes);
  });
});

describe('Insumos del servicio — reutiliza calculo-insumos.ts', () => {
  it('permite insumo manual sin código (código vacío, origen MANUAL)', () => {
    const i = insumo({ codigo: '', origen: 'MANUAL' });
    expect(() => calcularValorMensualInsumoServicio(i)).not.toThrow();
    expect(calcularValorMensualInsumoServicio(i)).toBeGreaterThan(0);
  });
  it('total de insumos es la suma de valorMensual de cada fila', () => {
    const insumos = [insumo({ id: 1 }), insumo({ id: 2, cantidad: 1, valorUnitarioSinIva: 5000 })];
    expect(calcularTotalInsumosServicio(insumos)).toBe(insumos.reduce((s, i) => s + calcularValorMensualInsumoServicio(i), 0));
  });
});

describe('Maquinaria y Equipos del servicio — reutiliza calculo-maquinaria.ts', () => {
  it('total de maquinaria es adquisición + mantenimiento, igual que el módulo global', () => {
    const filas = [maquina({ id: 1 }), maquina({ id: 2, cantidadRequerida: 2, cantidadDisponible: 1 })];
    const total = calcularTotalMaquinariaServicio(filas);
    expect(total).toBeGreaterThan(0);
  });
});

describe('Servicio no continuo — unidad completa y aislamiento', () => {
  it('crearServicioNoContinuoVacio produce arreglos propios (nunca referencias compartidas entre dos servicios)', () => {
    const s1 = crearServicioNoContinuoVacio('a', 'Servicio 1');
    const s2 = crearServicioNoContinuoVacio('b', 'Servicio 2');
    s1.manoObra.push(lineaMO());
    s1.insumos.push(insumo());
    expect(s2.manoObra).toHaveLength(0);
    expect(s2.insumos).toHaveLength(0);
    expect(s1.manoObra).not.toBe(s2.manoObra);
    expect(s1.examenesMedicos).not.toBe(s2.examenesMedicos);
  });

  it('modificar un bloque de un servicio no altera los demás bloques del mismo servicio', () => {
    const s: ServicioNoContinuo = crearServicioNoContinuoVacio('a', 'Servicio 1');
    s.manoObra.push(lineaMO());
    const totalesAntes = calcularTotalesServicioNoContinuo(s, parametros);
    s.insumos.push(insumo());
    const totalesDespues = calcularTotalesServicioNoContinuo(s, parametros);
    expect(totalesDespues.manoObra).toBe(totalesAntes.manoObra);
    expect(totalesDespues.insumos).toBeGreaterThan(totalesAntes.insumos);
  });

  it('Total Servicio = MO + EPP + Exámenes + Cursos + Vacunas + Insumos + Maquinaria (NUNCA incluye Costos Administrativos)', () => {
    const s: ServicioNoContinuo = {
      id: 'a', descripcion: 'Lavado de fachada',
      manoObra: [lineaMO()], dotacionEpp: [grupoEpp()],
      examenesMedicos: { examenes: [itemExam()], cursos: [itemExam({ id: 2 })], vacunas: [itemExam({ id: 3 })] },
      insumos: [insumo()], maquinariaEquipos: [maquina()],
    };
    const t = calcularTotalesServicioNoContinuo(s, parametros);
    expect(t.total).toBeCloseTo(t.manoObra + t.dotacionEpp + t.totalExamenesMedicos + t.insumos + t.maquinariaEquipos, 6);
    expect(t).not.toHaveProperty('costosAdministrativos');
    expect(t).not.toHaveProperty('polizas');
    expect(t).not.toHaveProperty('impuestos');
  });

  it('el total de dos servicios independientes nunca se mezcla entre sí (mutar el servicio 2 no cambia el total ya calculado del servicio 1)', () => {
    const s1: ServicioNoContinuo = { ...crearServicioNoContinuoVacio('1', 'Servicio 1'), manoObra: [lineaMO({ cantidadTrabajadores: 2 })] };
    const s2: ServicioNoContinuo = { ...crearServicioNoContinuoVacio('2', 'Servicio 2'), manoObra: [lineaMO({ cantidadTrabajadores: 4 })] };
    const total1Antes = calcularTotalesServicioNoContinuo(s1, parametros).total;
    s2.manoObra.push(lineaMO({ id: 99, cantidadTrabajadores: 10 }));
    const total1Despues = calcularTotalesServicioNoContinuo(s1, parametros).total;
    expect(total1Despues).toBe(total1Antes);
  });

  it('Total Servicios no continuos = suma de los totales de cada servicio, nunca ingresado manualmente', () => {
    const s1: ServicioNoContinuo = { ...crearServicioNoContinuoVacio('1', 'Servicio 1'), insumos: [insumo()] };
    const s2: ServicioNoContinuo = { ...crearServicioNoContinuoVacio('2', 'Servicio 2'), insumos: [insumo({ id: 2, cantidad: 2 })] };
    const total = calcularTotalServiciosNoContinuos([s1, s2], parametros);
    const esperado = calcularTotalesServicioNoContinuo(s1, parametros).total + calcularTotalesServicioNoContinuo(s2, parametros).total;
    expect(total).toBeCloseTo(esperado, 6);
  });

  it('eliminar un servicio del arreglo (filter) nunca altera los servicios restantes', () => {
    const s1 = { ...crearServicioNoContinuoVacio('1', 'Servicio 1'), insumos: [insumo()] };
    const s2 = { ...crearServicioNoContinuoVacio('2', 'Servicio 2'), insumos: [insumo({ id: 2 })] };
    const s3 = { ...crearServicioNoContinuoVacio('3', 'Servicio 3'), insumos: [insumo({ id: 3 })] };
    const totalS1Antes = calcularTotalesServicioNoContinuo(s1, parametros).total;
    const restantes = [s1, s2, s3].filter(s => s.id !== '2');
    expect(restantes.map(s => s.id)).toEqual(['1', '3']);
    expect(calcularTotalesServicioNoContinuo(restantes[0], parametros).total).toBe(totalS1Antes);
  });

  it('servicioNoContinuoTieneDatos detecta datos en cualquiera de los 5 bloques', () => {
    expect(servicioNoContinuoTieneDatos(crearServicioNoContinuoVacio('a'))).toBe(false);
    expect(servicioNoContinuoTieneDatos({ ...crearServicioNoContinuoVacio('a'), maquinariaEquipos: [maquina()] })).toBe(true);
    expect(servicioNoContinuoTieneDatos({ ...crearServicioNoContinuoVacio('a'), examenesMedicos: { examenes: [], cursos: [itemExam()], vacunas: [] } })).toBe(true);
  });

  it('serviciosNoContinuosTienenDatos es false para un arreglo vacío (queda pendiente, nunca NO_APLICA automático)', () => {
    expect(serviciosNoContinuosTienenDatos([])).toBe(false);
    expect(serviciosNoContinuosTienenDatos([crearServicioNoContinuoVacio('a', '')])).toBe(false);
    expect(serviciosNoContinuosTienenDatos([crearServicioNoContinuoVacio('a', 'Lavado de fachada')])).toBe(true);
  });
});
