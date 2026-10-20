import { describe, expect, it } from 'vitest';
import type { CostosPantallaDto } from '@/lib/costos-estructura/exportacion/costos-pantalla';
import { validarContrato } from '../../../puente-contratos/src/validar.js';
import type { CargoPantallaDto } from './cargos';
import { cargosParaPuente } from './cargos';
import { armarPayloadContratos, equiposParaPuente, insumosParaPuente } from './payload';
import { costosAdministrativosEnTarifas, leerTarifasElegidas, normalizarTarifasDeLineas, repartir, tarifasDelCosteo } from './tarifas';

const cargo = (o: Partial<CargoPantallaDto>): CargoPantallaDto => ({
  id: 1, nombre: 'ASEADOR', cantidad: 2, horasSemana: 48, jornada: 8, salario: 1423500, arlKey: 'I', codigoHorario: '941', valorTotal: 6000000, esTurnante: false, ...o,
});

/** Aseo (tarifa 1) y cafetería (tarifa 2): 6 M + 2 M de mano de obra, un insumo y un equipo en cada una, pólizas sobre todo. */
function costeo(): { dto: CostosPantallaDto; cargos: CargoPantallaDto[] } {
  const dto = {
    nTrabajadores: 3,
    cargos: ['ASEADOR', 'CAFETERA'],
    totales: { manoObra: 8000000, otrosCostosEnManoObra: 0, insumos: 400000, maquinaria: 300000, serviciosNoContinuos: 0, valorAgregado: 0, administrativos: 170000, total: 8870000 },
    administrativos: {
      variables: [{ concepto: 'Papelería', cantidad: 1, valorUnitario: 50000, valorMensual: 50000, tarifa: 2 }],
      totalVariables: 50000, valorMensualPolizas: 87000, valorMensualImpuestos: 33000,
    },
    insumos: {
      total: 400000,
      filas: [
        { codigo: '18111', nombre: 'JABON', unidad: 'GL', cantidad: 2, frecuenciaMeses: 1, valorUnitarioSinIva: 100000, valorUnitarioConIva: 119000, valorMensual: 300000, valorAgregado: false },
        { codigo: '30001', nombre: 'CAFE', unidad: 'LB', cantidad: 4, frecuenciaMeses: 1, valorUnitarioSinIva: 25000, valorUnitarioConIva: 29750, valorMensual: 100000, valorAgregado: false, tarifa: 2 },
      ],
    },
    maquinaria: {
      subtotalAdquisicion: 300000, subtotalMantenimiento: 0,
      filas: [
        { codigo: '', descripcion: 'Brilladora', categoria: '', cantidadRequerida: 1, cantidadComprar: 1, valorUnitario: 1000000, valorMesComprar: 200000, valorMesMantenimiento: 0, valorAgregado: false },
        { codigo: '', descripcion: 'Greca', categoria: '', cantidadRequerida: 1, cantidadComprar: 1, valorUnitario: 500000, valorMesComprar: 100000, valorMesMantenimiento: 0, valorAgregado: false, tarifa: 2 },
      ],
    },
  } as unknown as CostosPantallaDto;
  return { dto, cargos: [cargo({ id: 1 }), cargo({ id: 2, nombre: 'CAFETERA', cantidad: 1, valorTotal: 2000000, tarifa: 2 })] };
}
const DOS = [{ consec: 1, codServicio: '452' }, { consec: 2, codServicio: '453' }];

describe('varias tarifas en la oferta', () => {
  it('lee las tarifas elegidas: 1, 2, 3… sin saltos y con concepto', () => {
    expect(leerTarifasElegidas(undefined)).toEqual({ ok: true, tarifas: [] });
    expect(leerTarifasElegidas([{ consec: 1, codServicio: ' 452 ' }, { consec: 2, codServicio: '453' }])).toEqual({ ok: true, tarifas: DOS });
    expect(leerTarifasElegidas([{ consec: 1, codServicio: '452' }, { consec: 3, codServicio: '453' }])).toEqual({ ok: false, mensaje: 'Las tarifas deben ir numeradas 1, 2, 3… sin saltos.' });
    expect(leerTarifasElegidas([{ consec: 1, codServicio: '452' }, { consec: 2, codServicio: '' }])).toEqual({ ok: false, mensaje: 'Elija el concepto de facturación de la tarifa 2.' });
  });

  it('reparte al peso sin perder ni sobrar', () => {
    expect(repartir(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(repartir(10, [0, 0])).toEqual([10, 0]);
    expect(repartir(8640000, [6000000, 2000000])).toEqual([6480000, 2160000]);
  });

  it('cada tarifa suma sus líneas con el A.I.U., y las tarifas suman exactamente la tarifa de la oferta', () => {
    const { dto, cargos } = costeo();
    const tarifas = tarifasDelCosteo({ tarifas: DOS.map((t) => ({ ...t, descripcion: null })), dto, cargos, aiu: 8 });
    expect(tarifas.map((t) => [t.consec, t.codServicio, t.manoObra, t.insumos, t.maquinaria, t.administrativos])).toEqual([
      [1, '452', 6480000, 324000, 216000, 96828], // pólizas + impuestos (120.000) por el peso de aseo (6,5 de 8,7 M) = 89.655; admin 183.600 con A.I.U. en esa proporción
      [2, '453', 2160000, 108000, 108000, 86772], // papelería 50.000 + 30.345 de pólizas e impuestos
    ]);
    for (const r of ['manoObra', 'insumos', 'maquinaria', 'administrativos'] as const) {
      expect(tarifas.reduce((s, t) => s + t[r], 0)).toBe(Math.round(dto.totales[r] * 1.08));
    }
  });

  it('los costos administrativos de cada tarifa: pólizas e impuestos repartidos y cada variable en la suya', () => {
    const { dto, cargos } = costeo();
    expect(costosAdministrativosEnTarifas(2, dto, cargos)).toEqual([
      { concepto: 'Pólizas', valorMensual: 65000 }, { concepto: 'Pólizas', valorMensual: 22000, tarifa: 2 },
      { concepto: 'Impuestos', valorMensual: 24655.17 }, { concepto: 'Impuestos', valorMensual: 8344.83, tarifa: 2 },
      { concepto: 'Papelería', valorMensual: 50000, tarifa: 2 },
    ]);
  });

  it('con una sola tarifa la tarifa de cada línea se quita (lo enviado no cambia); con varias, una tarifa que no existe es un error', () => {
    const { dto, cargos } = costeo();
    const una = normalizarTarifasDeLineas(1, dto, cargos);
    expect(una.ok && [una.cargos.map((c) => c.tarifa), una.dto.insumos.filas.map((f) => f.tarifa)]).toEqual([[undefined, undefined], [undefined, undefined]]);
    const mala = normalizarTarifasDeLineas(2, { ...dto, maquinaria: { ...dto.maquinaria, filas: [{ ...dto.maquinaria.filas[0], tarifa: 3 }] } }, cargos);
    expect(mala).toEqual({ ok: false, mensaje: 'Estas líneas piden una tarifa que no está en la oferta: equipo «Brilladora».' });
  });

  it('el JSON que arma LiciColba con dos tarifas lo acepta el puente', () => {
    const { dto, cargos } = costeo();
    const tarifas = tarifasDelCosteo({ tarifas: DOS.map((t) => ({ ...t, descripcion: 'X' })), dto, cargos, aiu: 8 });
    const payload = armarPayloadContratos({
      solicitud: { id: 7, codigoProceso: 'P-1', entidad: 'Cliente SAS', objeto: 'Aseo', nitContacto: '900123456-8', direccionContacto: 'Calle 1' },
      procesoCodigo: 'P-1',
      resultado: { porcentajeIU: 8, valorMesIncluidoIva: 10000000, vigenciaMeses: 12 } as never,
      totales: dto.totales,
      destino: { empresa: '01', undnegocio: 'BAQ', tipoAdm: 'C', origenProceso: 'LIC', codServicio: '452', descripcionServicio: 'LIMPIEZA' },
      cargos: cargosParaPuente(cargos),
      tarifas,
      insumos: insumosParaPuente(dto.insumos.filas),
      costosAdministrativos: costosAdministrativosEnTarifas(2, dto, cargos),
      equipos: equiposParaPuente(dto.maquinaria.filas),
    });
    expect(payload.cargos?.map((c) => c.tarifa)).toEqual([undefined, 2]);
    expect(payload.insumos?.map((c) => c.tarifa)).toEqual([undefined, 2]);
    const r = validarContrato(payload, { paraEscribir: true });
    expect(r.ok ? [] : r.errores).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
