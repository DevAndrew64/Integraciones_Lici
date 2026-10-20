import { describe, expect, it } from 'vitest';
import type { CostosPantallaDto } from '@/lib/costos-estructura/exportacion/costos-pantalla';
import type { CargoPantallaDto } from './cargos';
import { costoPorTarifa, leerTarifasGuardadas, lineasParaTarifas, ponerTarifas, quitarTarifa } from './tarifas-pantalla';

const cargo = (o: Partial<CargoPantallaDto>): CargoPantallaDto => ({
  id: 1, nombre: 'ASEADOR', cantidad: 2, horasSemana: 48, jornada: 8, salario: 1423500, arlKey: 'I', codigoHorario: '941', valorTotal: 6000000, esTurnante: false, ...o,
});
const dto = {
  insumos: {
    total: 0,
    filas: [
      { codigo: '18111', nombre: 'Jabón', valorMensual: 300000, valorAgregado: false },
      { codigo: '18111', nombre: 'Jabón', valorMensual: 100000, valorAgregado: false },
      { codigo: '50000', nombre: 'Kit VA', valorMensual: 9000, valorAgregado: true },
    ],
  },
  maquinaria: { filas: [{ codigo: '', descripcion: 'Greca', valorMesComprar: 80000, valorMesMantenimiento: 20000, valorAgregado: false }] },
  administrativos: { variables: [{ concepto: 'Papelería', valorMensual: 50000 }] },
  serviciosNoContinuos: [],
  valoresAgregados: [{ tipo: 'INSUMO', descripcion: 'Kit VA', valorMensual: 9000 }],
} as unknown as CostosPantallaDto;
const cargos = [cargo({ id: 1 }), cargo({ id: 1, nombre: 'TURNANTE', esTurnante: true, valorTotal: 500000 }), cargo({ id: 3, cantidad: 0, valorTotal: 0 })];

describe('repartir el costeo en tarifas desde la pantalla', () => {
  it('lista cada línea con una clave estable (los repetidos se numeran; sin trabajadores o VA dentro de insumos no aparecen)', () => {
    expect(lineasParaTarifas(dto, cargos).map((l) => [l.clave, l.grupo, l.valor])).toEqual([
      ['c:1', 'Mano de obra', 6000000],
      ['t:1', 'Mano de obra', 500000],
      ['i:18111|JABÓN', 'Insumos', 300000],
      ['i:18111|JABÓN#2', 'Insumos', 100000],
      ['e:|GRECA', 'Equipos', 100000],
      ['a:PAPELERÍA', 'Costos admtivos', 50000],
      ['v:INSUMO|KIT VA', 'Valores agregados', 9000],
    ]);
  });

  it('pone la tarifa elegida en cada línea; lo no elegido o de una tarifa que ya no existe va a la 1', () => {
    const asignacion = { 't:1': 2, 'i:18111|JABÓN#2': 2, 'e:|GRECA': 5 };
    const r = ponerTarifas(dto, cargos, asignacion, 2);
    expect(r.cargos.map((c) => c.tarifa)).toEqual([1, 2, 1]);
    expect(r.dto.insumos.filas.map((f) => f.tarifa)).toEqual([1, 2, 1]);
    expect(r.dto.maquinaria.filas.map((f) => f.tarifa)).toEqual([1]);
    expect(costoPorTarifa(lineasParaTarifas(dto, cargos), asignacion, 2)).toEqual([6459000, 600000]);
    expect(ponerTarifas(dto, cargos, asignacion, 1)).toEqual({ dto, cargos });
  });

  it('quitar una tarifa devuelve sus líneas a la 1 y renumera las siguientes', () => {
    const g = { conceptos: ['453', '454', '455'], lineas: { a: 2, b: 3, c: 4 } };
    expect(quitarTarifa(g, 3)).toEqual({ conceptos: ['453', '455'], lineas: { a: 2, c: 3 } });
    expect(leerTarifasGuardadas({ conceptos: ['453', 7], lineas: { a: 2, b: 1, c: 'x' } })).toEqual({ conceptos: ['453'], lineas: { a: 2 } });
    expect(leerTarifasGuardadas(null)).toEqual({ conceptos: [], lineas: {} });
  });
});
