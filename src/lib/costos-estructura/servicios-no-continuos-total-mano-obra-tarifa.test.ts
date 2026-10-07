/**
 * Ajuste "TOTAL MANO DE OBRA DEL SERVICIO MOSTRABA UN NEGATIVO".
 *
 * En el modal "Editar servicio no continuo", rama Tarifa Aseocolba, el
 * subtotal "TOTAL MANO DE OBRA DEL SERVICIO" se derivaba en el JSX como
 * `totales.total - totales.insumos - totales.maquinariaEquipos`, que:
 *  - mezcla `total` (YA dividido por la frecuencia del servicio) con
 *    `insumos`/`maquinaria` SIN dividir → con divisor > 1 da negativo;
 *  - nunca resta `otrosCostos`.
 *
 * Causa raíz corregida en la función pura: `calcularTotalesServicioNoContinuo`
 * ahora DEVUELVE `tarifaTotalCargos` (suma bruta de los `r.total` de cada
 * fila de cargo — exactamente lo que ve el usuario en la grilla), y el JSX
 * muestra ese campo. `manoObra` sigue en 0 en esta rama (la tarifa
 * reemplaza el detalle histórico); `total` (facturable) NO cambia.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calcularTotalesServicioNoContinuo, type ServicioNoContinuo } from './servicios-no-continuos';
import {
  construirTarifaServicioDesdeCatalogo, buscarTarifaCatalogoAseocolba, calcularTarifaServicioAseocolba,
} from './tarifario-especiales-aseocolba';

function servicioBase(overrides: Partial<ServicioNoContinuo> = {}): ServicioNoContinuo {
  return {
    id: '1', descripcion: 'BRIGADA DE ASEO',
    manoObra: [], dotacionEpp: [],
    examenesMedicos: { examenes: [], cursos: [], vacunas: [] },
    insumos: [], maquinariaEquipos: [],
    ...overrides,
  };
}

// Dos cargos por día (mismo cargo del catálogo, distintos días) — reproduce
// el caso de la captura: Operario (valorBase 116.324) × 1 × 2 días, y otro
// × 1 × 3 días. AIU desmarcado (como en la captura).
const entrada = buscarTarifaCatalogoAseocolba('DIA_OPERARIO_DIURNA_HABIL')!;
const cargoA = { ...construirTarifaServicioDesdeCatalogo(entrada, 'SELECCION_MANUAL'), cantidadPersonas: 1, cantidadDias: 2, aplicaAiu: false as const };
const cargoB = { ...construirTarifaServicioDesdeCatalogo(entrada, 'SELECCION_MANUAL'), cantidadPersonas: 1, cantidadDias: 3, aplicaAiu: false as const };
const totalA = calcularTarifaServicioAseocolba(cargoA, entrada).total;
const totalB = calcularTarifaServicioAseocolba(cargoB, entrada).total;
const sumaCargosVisibles = totalA + totalB;

describe('calcularTotalesServicioNoContinuo — tarifaTotalCargos (rama TARIFA_ASEOCOLBA)', () => {
  it('tarifaTotalCargos = suma BRUTA de los r.total de cada fila de cargo (lo que ve el usuario)', () => {
    const s = servicioBase({ tipoCalculo: 'TARIFA_ASEOCOLBA', tarifas: [cargoA, cargoB] });
    const r = calcularTotalesServicioNoContinuo(s, 0);
    expect(r.tarifaTotalCargos).toBe(sumaCargosVisibles);
    expect(r.tarifaTotalCargos).toBeGreaterThan(0);
    expect(sumaCargosVisibles).toBeGreaterThan(0); // sanity
  });

  it('NUNCA es negativo por efecto de insumos/maquinaria/otros costos ni de la frecuencia', () => {
    const s = servicioBase({
      tipoCalculo: 'TARIFA_ASEOCOLBA', tarifas: [cargoA, cargoB],
      frecuenciaServicioMeses: 4, // divisor > 1 — condición que disparaba el negativo
      insumos: [{ id: 1, origen: 'MANUAL', codigo: '', nombre: 'x', cantidad: 1, frecuenciaMeses: 1, valorUnitarioSinIva: 8_000_000, valorUnitarioConIva: 8_000_000, valorMensual: 8_000_000 }],
    });
    const r = calcularTotalesServicioNoContinuo(s, 0);

    expect(r.tarifaTotalCargos).toBe(sumaCargosVisibles); // idéntico al caso sin insumos/frecuencia
    expect(r.tarifaTotalCargos!).toBeGreaterThan(0);

    // La FÓRMULA VIEJA (la que estaba en el JSX) SÍ daba negativo en este escenario:
    const formulaVieja = r.total - r.insumos - r.maquinariaEquipos;
    expect(formulaVieja).toBeLessThan(0);
    expect(r.tarifaTotalCargos).not.toBe(formulaVieja);
  });

  it('el total FACTURABLE del servicio (`total`) NO cambia — sigue siendo subtotal completo ÷ frecuencia', () => {
    const s = servicioBase({
      tipoCalculo: 'TARIFA_ASEOCOLBA', tarifas: [cargoA, cargoB],
      frecuenciaServicioMeses: 2,
      insumos: [{ id: 1, origen: 'MANUAL', codigo: '', nombre: 'x', cantidad: 1, frecuenciaMeses: 1, valorUnitarioSinIva: 100_000, valorUnitarioConIva: 100_000, valorMensual: 100_000 }],
    });
    const r = calcularTotalesServicioNoContinuo(s, 0);
    expect(r.total).toBe((sumaCargosVisibles + r.insumos + r.maquinariaEquipos + r.otrosCostos) / 2);
  });

  it('rama histórica (ESTRUCTURA_COSTOS): tarifaTotalCargos queda undefined (usa `manoObra`)', () => {
    const r = calcularTotalesServicioNoContinuo(servicioBase(), 500_000);
    expect(r.tarifaTotalCargos).toBeUndefined();
    expect(r.manoObra).toBe(500_000);
  });
});

describe('page.tsx — el JSX del subtotal usa tarifaTotalCargos, ya no la resta rota', () => {
  const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');

  it('la rama Tarifa Aseocolba muestra `totales.tarifaTotalCargos`, nunca `totales.total-totales.insumos-totales.maquinariaEquipos`', () => {
    expect(PAGE_TSX).toContain('{cop(totales.tarifaTotalCargos??0)}');
    expect(PAGE_TSX).not.toContain('cop(totales.total-totales.insumos-totales.maquinariaEquipos)');
  });

  it('el bloque de cargos manuales (no-Aseocolba) sigue mostrando `totales.manoObra` sin cambios', () => {
    expect(PAGE_TSX).toContain('{cop(totales.manoObra)}');
  });
});
