import { describe, expect, it } from 'vitest';
import { validarCostosPantallaDto } from './costos-pantalla';
import type { CostosPantallaDto } from './costos-pantalla';

function dto(): CostosPantallaDto {
  return {
    nTrabajadores: 1,
    cargos: ['ASEO Y CAFETERIA'],
    totales: {
      manoObra: 4518942, otrosCostosEnManoObra: 29667, insumos: 0, maquinaria: 0,
      serviciosNoContinuos: 0, valorAgregado: 0, administrativos: 5000, total: 4523942,
    },
    administrativos: {
      variables: [{ concepto: 'Papelería', cantidad: 1, valorUnitario: 5000, valorMensual: 5000 }],
      totalVariables: 5000, valorMensualPolizas: 0, valorMensualImpuestos: 0,
    },
    dotacionEpp: { total: 0, cargos: [] },
    examenes: { total: 29667, cargos: [] },
    insumos: { filas: [], total: 0 },
    maquinaria: { filas: [], subtotalAdquisicion: 0, subtotalMantenimiento: 0 },
  };
}

describe('validarCostosPantallaDto', () => {
  it('acepta el JSON de la pantalla del proceso INVITACIÓN A COTIZAR - RFP (MO 4.518.942 + Admin 5.000 = 4.523.942)', () => {
    expect(validarCostosPantallaDto(dto())).toEqual({ ok: true });
  });

  it('rechaza lo que no es un objeto', () => {
    expect(validarCostosPantallaDto(undefined).ok).toBe(false);
    expect(validarCostosPantallaDto(null).ok).toBe(false);
    expect(validarCostosPantallaDto('x').ok).toBe(false);
  });

  it('rechaza un total que no es la suma de los rubros del panel', () => {
    const d = dto();
    d.totales.total = 4489275; // el valor viejo de costoMO sin exámenes ni administrativos
    const r = validarCostosPantallaDto(d);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errores.join(' ')).toContain('totales.total no reconcilia');
  });

  it('rechaza administrativos que no cuadran con variables + pólizas + impuestos', () => {
    const d = dto();
    d.administrativos.valorMensualPolizas = 100000;
    const r = validarCostosPantallaDto(d);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errores.join(' ')).toContain('totales.administrativos no reconcilia');
  });

  it('rechaza un subtotal de variables que no cuadra con sus filas', () => {
    const d = dto();
    d.administrativos.variables[0].valorMensual = 1;
    const r = validarCostosPantallaDto(d);
    expect(r.ok).toBe(false);
  });

  it('rechaza números no finitos (NaN, Infinity) en cualquier parte del JSON', () => {
    const conNaN = dto();
    conNaN.dotacionEpp.total = Number.NaN;
    expect(validarCostosPantallaDto(conNaN).ok).toBe(false);
    const conInfinito = dto();
    conInfinito.examenes.cargos = [{ cargo: 'A', cantidadTrabajadores: 1, totalUnitario: Infinity, examenes: [], cursos: [], vacunas: [] }];
    expect(validarCostosPantallaDto(conInfinito).ok).toBe(false);
  });

  it('rechaza listas con elementos que no son objetos y un tamaño desproporcionado', () => {
    const d = dto();
    (d.administrativos.variables as unknown[]) = [null];
    expect(validarCostosPantallaDto(d).ok).toBe(false);
    const grande = dto();
    grande.dotacionEpp.cargos = [{ cargo: 'A', cantidadTrabajadores: 1, totalUnitario: 0, filas: new Array(5001).fill({ grupo: '', tipo: 'EPP', codigo: '', descripcion: '', unidad: '', cantidad: 0, frecuencia: 0, valorUnitario: 0, valorMensual: 0 }) }];
    expect(validarCostosPantallaDto(grande).ok).toBe(false);
  });

  it('rechaza insumos cuyo total no es la suma de las filas que cuentan (las de Valor agregado no suman)', () => {
    const d = dto();
    d.totales.insumos = 100;
    d.totales.total = 4523942 + 100;
    d.insumos = {
      total: 100,
      filas: [
        { codigo: 'a', nombre: 'a', unidad: 'UND', cantidad: 1, frecuenciaMeses: 1, valorUnitarioSinIva: 100, valorUnitarioConIva: 119, valorMensual: 100, valorAgregado: false },
        { codigo: 'b', nombre: 'b', unidad: 'UND', cantidad: 1, frecuenciaMeses: 1, valorUnitarioSinIva: 50, valorUnitarioConIva: 60, valorMensual: 50, valorAgregado: true },
      ],
    };
    expect(validarCostosPantallaDto(d)).toEqual({ ok: true });
    d.insumos.filas[1].valorAgregado = false; // ahora la fila de 50 sí contaría: 150 ≠ 100
    const r = validarCostosPantallaDto(d);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errores.join(' ')).toContain('insumos.total no reconcilia');
  });

  it('rechaza maquinaria cuyo total no es adquisición + mantenimiento, o cuyos subtotales no cuadran con sus filas', () => {
    const d = dto();
    d.totales.maquinaria = 700;
    d.totales.total = 4523942 + 700;
    d.maquinaria = {
      subtotalAdquisicion: 500, subtotalMantenimiento: 200,
      filas: [{ codigo: 'm', descripcion: 'm', categoria: 'c', cantidadRequerida: 1, cantidadComprar: 1, valorUnitario: 1, valorMesComprar: 500, valorMesMantenimiento: 200, valorAgregado: false }],
    };
    expect(validarCostosPantallaDto(d)).toEqual({ ok: true });
    d.maquinaria.subtotalMantenimiento = 250; // el total del panel (700) ya no es 500 + 250
    expect(validarCostosPantallaDto(d).ok).toBe(false);
  });

  it('rechaza cargos que no son una lista de nombres', () => {
    const d = dto();
    (d as unknown as { cargos: unknown }).cargos = [1, 2];
    expect(validarCostosPantallaDto(d).ok).toBe(false);
  });
});
