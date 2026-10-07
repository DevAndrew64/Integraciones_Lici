import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PORCENTAJE_ADMINISTRATIVO_DEFECTO, calcularCostoAdministrativo, normalizarCostoAdministrativoHistorico,
  filasPolizasIniciales, calcularPolizas, calcularFilaPoliza, normalizarPolizaRow, validarNumeroMeses, resolverTipoBaseRC,
  migrarFilasPolizasVigenciaTotal,
  VIGENCIA_MESES_POLIZA_DEFECTO, NUMERO_MESES_CONTRATO_POLIZAS_DEFECTO,
  filasImpuestosIniciales, calcularValorImpuesto, calcularTotalImpuestos, calcularValorMensualImpuestos,
  resolverAplicaImpuesto, resolverAplicaAvisos, migrarActivoImpuestosPorTarifa, migrarAplicaAvisosPorTarifa,
  conceptosVariablesAdministrativasIniciales, calcularValorMensualVariable, calcularTotalVariablesAdministrativas,
  calcularConsolidadoCostosAdministrativos, migrarAdminRowsHistoricoAVariables,
  VALOR_UNITARIO_PAPELERIA_POR_DEFECTO, sincronizarCantidadesAutomaticasVariables, validarFrecuenciaMeses,
  migrarCantidadOrigenPorCatalogo, migrarValorUnitarioPapeleria,
  type PolizaRow, type ImpuestoRow, type VariableAdministrativaRow, type BasesImpuesto,
} from './calculo-costos-administrativos';

describe('calcularCostoAdministrativo — VALOR_FIJO / PORCENTAJE', () => {
  it('VALOR_FIJO devuelve exactamente valorFijo', () => {
    expect(calcularCostoAdministrativo({ tipoCalculo: 'VALOR_FIJO', valorFijo: 500000, baseManoObra: 0, baseCostoDirecto: 0 })).toBe(500000);
  });

  it('PORCENTAJE sobre COSTO_DIRECTO: $10.000.000 × 5% = $500.000', () => {
    expect(calcularCostoAdministrativo({
      tipoCalculo: 'PORCENTAJE', porcentaje: 5, baseCalculo: 'COSTO_DIRECTO',
      baseManoObra: 8000000, baseCostoDirecto: 10000000,
    })).toBe(500000);
  });

  it('PORCENTAJE sobre MANO_OBRA usa baseManoObra, nunca baseCostoDirecto', () => {
    expect(calcularCostoAdministrativo({
      tipoCalculo: 'PORCENTAJE', porcentaje: 10, baseCalculo: 'MANO_OBRA',
      baseManoObra: 1000000, baseCostoDirecto: 5000000,
    })).toBe(100000);
  });

  it('PORCENTAJE_ADMINISTRATIVO_DEFECTO es 5', () => {
    expect(PORCENTAJE_ADMINISTRATIVO_DEFECTO).toBe(5);
  });

  it('nunca incluye adminTotal en la base — la función ni siquiera lo recibe como parámetro', () => {
    const entrada = { tipoCalculo: 'PORCENTAJE' as const, porcentaje: 5, baseCalculo: 'COSTO_DIRECTO' as const, baseManoObra: 100, baseCostoDirecto: 200 };
    expect(Object.keys(entrada)).not.toContain('adminTotal');
  });
});

describe('normalizarCostoAdministrativoHistorico — compatibilidad defensiva', () => {
  it('tipoCalculo ausente se completa en VALOR_FIJO (única modalidad histórica real)', () => {
    const r = normalizarCostoAdministrativoHistorico({ concepto: 'Supervisión', valorMensual: 500000 });
    expect(r.tipoCalculo).toBe('VALOR_FIJO');
  });

  it('valorMensual histórico se preserva como valorFijo, sin recalcular', () => {
    const r = normalizarCostoAdministrativoHistorico({ concepto: 'Supervisión', valorMensual: 500000 });
    expect(r.valorFijo).toBe(500000);
    expect(r.valorMensual).toBe(500000);
  });

  it('concepto ausente se completa en "—"', () => {
    const r = normalizarCostoAdministrativoHistorico({ valorMensual: 100 });
    expect(r.concepto).toBe('—');
  });
});

describe('filasPolizasIniciales / calcularFilaPoliza / calcularPolizas — fórmula real del Excel (valorAmparado ≠ costo)', () => {
  const VALOR_OFERTA_EJEMPLO = 3697772552;
  /** Comparación por tolerancia ABSOLUTA (nunca por dígitos decimales — con
   * valores en el orden de los millones, toBeCloseTo(x,-1) es demasiado
   * estricto: solo tolera ±5). */
  function cercaDe(actual: number, esperado: number, tolerancia: number) {
    expect(Math.abs(actual - esperado)).toBeLessThanOrEqual(tolerancia);
  }

  it('filasPolizasIniciales trae 9 conceptos, con solo los primeros 4 activos por defecto, y tasaPoliza SIN definir (0)', () => {
    const f = filasPolizasIniciales();
    expect(f).toHaveLength(9);
    expect(f.slice(0, 4).every((x) => x.activo)).toBe(true);
    expect(f.slice(4).every((x) => !x.activo)).toBe(true);
    expect(f.every((x) => x.tasaPoliza === 0)).toBe(true); // nunca se asume una tasa
  });

  // 1) El porcentaje del amparo produce valor amparado, no costo.
  it('1) porcentaje×valorOferta produce valorAmparado — NUNCA se usa directamente como costo', () => {
    const fila: PolizaRow = { id: 1, concepto: 'X', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.2 };
    const r = calcularFilaPoliza(fila, VALOR_OFERTA_EJEMPLO);
    expect(r.valorAmparado).toBeCloseTo(VALOR_OFERTA_EJEMPLO * 0.2, 2);
    expect(r.costoTotalPoliza).not.toBe(r.valorAmparado);
  });

  // 2) Oferta $3.697.772.552 al 20% produce valor amparado $739.554.510 aprox.
  it('2) oferta 3.697.772.552 al 20% → valorAmparado ≈ 739.554.510', () => {
    const r = calcularFilaPoliza({ id: 1, concepto: 'Cumplimiento del contrato', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.2 }, VALOR_OFERTA_EJEMPLO);
    cercaDe(r.valorAmparado, 739554510, 1);
  });

  // 3) La tasa 0,2% se interpreta como 0.002 (nunca como 20%).
  it('3) tasaPoliza=0.2 se interpreta como 0,2% (÷100 → 0.002), no como 20%', () => {
    const conTasaPunto2 = calcularFilaPoliza({ id: 1, concepto: 'X', activo: true, porcentaje: 100, vigenciaMeses: 12, tasaPoliza: 0.2 }, 1000000);
    const conTasa20 = calcularFilaPoliza({ id: 1, concepto: 'X', activo: true, porcentaje: 100, vigenciaMeses: 12, tasaPoliza: 20 }, 1000000);
    expect(conTasaPunto2.costoTotalPoliza).toBeCloseTo(conTasa20.costoTotalPoliza / 100, 4);
  });

  // 4) vigenciaMeses YA es la vigencia TOTAL (ajuste "AJUSTAR LA
  // TERMINOLOGÍA Y LA PRESENTACIÓN DE VIGENCIAS") — factorVigencia =
  // vigenciaMeses/12, SIN ninguna suma oculta de un mes.
  it('4) vigenciaMeses=13 (vigencia total ya calculada) → factorVigencia = 13/12, NUNCA 14/12', () => {
    const r = calcularFilaPoliza({ id: 1, concepto: 'X', activo: true, porcentaje: 100, vigenciaMeses: 13, tasaPoliza: 100 }, 100);
    expect(r.factorVigencia).toBeCloseTo(13 / 12, 10);
    expect(r.factorVigencia).not.toBeCloseTo(14 / 12, 10);
  });

  it('4b) vigenciaMeses=12 → factorVigencia = 12/12 = 1 (nunca 13/12)', () => {
    const r = calcularFilaPoliza({ id: 1, concepto: 'X', activo: true, porcentaje: 100, vigenciaMeses: 12, tasaPoliza: 100 }, 100);
    expect(r.factorVigencia).toBe(1);
  });

  // 5) Cumplimiento produce aproximadamente $1.602.368, con vigenciaMeses=13
  // (vigencia TOTAL ya calculada — nunca 12+1 dentro de la fórmula).
  it('5) Cumplimiento (oferta 3.697.772.552, 20%, tasa 0,2%, vigencia total 13) → costoTotalPoliza ≈ 1.602.368', () => {
    const r = calcularFilaPoliza({ id: 1, concepto: 'Cumplimiento del contrato', activo: true, porcentaje: 20, vigenciaMeses: 13, tasaPoliza: 0.2 }, VALOR_OFERTA_EJEMPLO);
    cercaDe(r.costoTotalPoliza, 1602368, 5); // tolerancia de redondeo, precisión decimal interna
  });

  // 6) Los valores amparados no se suman al subtotal de pólizas.
  it('6) subtotalPolizas NUNCA suma valorAmparado — el bug reportado (oferta×50%=1.848.886.276) no debe reproducirse', () => {
    const r = calcularPolizas({
      filas: [
        { id: 1, concepto: 'Cumplimiento del contrato', activo: true, porcentaje: 20, vigenciaMeses: 13, tasaPoliza: 0.2 },
      ],
      valorBase: VALOR_OFERTA_EJEMPLO, otros: 0, porcentajeIva: 0, numeroMesesContrato: 36,
    });
    const sumaDeValoresAmparados = VALOR_OFERTA_EJEMPLO * 0.2;
    expect(r.subtotalPolizas).toBeLessThan(sumaDeValoresAmparados / 100); // órdenes de magnitud por debajo
    cercaDe(r.subtotalPolizas, 1602368, 5);
  });

  // 7) El subtotal usa costos reales de pólizas.
  it('7) subtotalPolizas = Σ costoTotalPoliza de las filas activas (nunca Σ valorAmparado)', () => {
    const r = calcularPolizas({
      filas: [
        { id: 1, concepto: 'A', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.2 },
        { id: 2, concepto: 'B', activo: true, porcentaje: 10, vigenciaMeses: 12, tasaPoliza: 0.5 },
        { id: 3, concepto: 'C (inactiva)', activo: false, porcentaje: 50, vigenciaMeses: 12, tasaPoliza: 1 },
      ],
      valorBase: 100000000, otros: 0, porcentajeIva: 0, numeroMesesContrato: 12,
    });
    const esperado = r.filasCalculadas[0].costoTotalPoliza + r.filasCalculadas[1].costoTotalPoliza;
    expect(r.subtotalPolizas).toBeCloseTo(esperado, 6);
  });

  // 8/9/10/11) Ejemplo completo del Excel, con los 3 parámetros reales
  // confirmados por el usuario (ajuste "AJUSTAR LA TERMINOLOGÍA Y LA
  // PRESENTACIÓN DE VIGENCIAS" §3) — Cumplimiento (20%/0,20%/13m),
  // Prestaciones (10%/0,20%/48m), R.C. (20%/0,25%/36m) → subtotal
  // 10.107.245, IVA 19%, total 12.027.622, mensual/36 = 334.101.
  it('8/9/10/11) EJEMPLO COMPLETO con parámetros reales — Cumplimiento+Prestaciones+R.C. → subtotal≈10.107.245, IVA 19%≈1.920.377, total≈12.027.622, mensual/36≈334.101', () => {
    const r = calcularPolizas({
      filas: [
        { id: 1, concepto: 'Cumplimiento del contrato', activo: true, porcentaje: 20, vigenciaMeses: 13, tasaPoliza: 0.2 },
        { id: 2, concepto: 'Pago de salarios, prestaciones sociales e indemnizaciones laborales', activo: true, porcentaje: 10, vigenciaMeses: 48, tasaPoliza: 0.2 },
        { id: 3, concepto: 'Responsabilidad civil extracontractual', activo: true, porcentaje: 20, vigenciaMeses: 36, tasaPoliza: 0.25 },
      ],
      valorBase: VALOR_OFERTA_EJEMPLO, otros: 0, porcentajeIva: 19, numeroMesesContrato: 36,
    });
    cercaDe(r.filasCalculadas[0].costoTotalPoliza, 1602368, 5);
    cercaDe(r.filasCalculadas[1].costoTotalPoliza, 2958218, 5);
    cercaDe(r.filasCalculadas[2].costoTotalPoliza, 5546659, 5);
    cercaDe(r.subtotalPolizas, 10107245, 5);
    cercaDe(r.iva, 1920377, 5);
    cercaDe(r.total, 12027622, 5);
    cercaDe(r.valorMensual, 334101, 5);
  });

  // 12) Número de meses del contrato es distinto de la vigencia por fila.
  it('12) numeroMesesContrato (global) es independiente de vigenciaMeses (por fila) — cambiar uno no afecta al otro', () => {
    const filaBase: PolizaRow = { id: 1, concepto: 'Cumplimiento del contrato', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.2 };
    const r36 = calcularPolizas({ filas: [filaBase], valorBase: VALOR_OFERTA_EJEMPLO, otros: 0, porcentajeIva: 0, numeroMesesContrato: 36 });
    const r12 = calcularPolizas({ filas: [filaBase], valorBase: VALOR_OFERTA_EJEMPLO, otros: 0, porcentajeIva: 0, numeroMesesContrato: 12 });
    expect(r36.subtotalPolizas).toBe(r12.subtotalPolizas); // la vigencia de la fila (12) no cambió
    expect(r36.valorMensual).not.toBeCloseTo(r12.valorMensual, 0); // pero el mensual sí, por el numeroMesesContrato distinto
  });

  // 13) Una tasa faltante genera validación.
  it('13) tasaPoliza faltante (0/undefined) en una fila activa → costoTotalPoliza=0, completa=false, y el módulo queda "incompleto"', () => {
    const rFila = calcularFilaPoliza({ id: 1, concepto: 'X', activo: true, porcentaje: 20, vigenciaMeses: 12 }, VALOR_OFERTA_EJEMPLO);
    expect(rFila.tasaPoliza).toBeUndefined();
    expect(rFila.completa).toBe(false);
    expect(rFila.costoTotalPoliza).toBe(0);
    expect(Number.isFinite(rFila.costoTotalPoliza)).toBe(true);
    const rPolizas = calcularPolizas({
      filas: [{ id: 1, concepto: 'X', activo: true, porcentaje: 20, vigenciaMeses: 12 }],
      valorBase: VALOR_OFERTA_EJEMPLO, otros: 0, porcentajeIva: 19, numeroMesesContrato: 36,
    });
    expect(rPolizas.hayFilasIncompletas).toBe(true);
  });

  it('13b) porcentaje o vigencia faltante en una fila activa también la marca incompleta, nunca NaN/Infinity', () => {
    const sinPorcentaje = calcularFilaPoliza({ id: 1, concepto: 'X', activo: true, porcentaje: 0, vigenciaMeses: 12, tasaPoliza: 0.2 }, VALOR_OFERTA_EJEMPLO);
    expect(sinPorcentaje.completa).toBe(false);
    expect(sinPorcentaje.costoTotalPoliza).toBe(0);
    const sinVigencia = calcularFilaPoliza({ id: 1, concepto: 'X', activo: true, porcentaje: 20, vigenciaMeses: 0, tasaPoliza: 0.2 }, VALOR_OFERTA_EJEMPLO);
    expect(sinVigencia.completa).toBe(false);
    expect(sinVigencia.costoTotalPoliza).toBe(0);
    expect(Number.isFinite(sinVigencia.costoTotalPoliza)).toBe(true);
    const vigenciaNegativa = calcularFilaPoliza({ id: 1, concepto: 'X', activo: true, porcentaje: 20, vigenciaMeses: -3, tasaPoliza: 0.2 }, VALOR_OFERTA_EJEMPLO);
    expect(vigenciaNegativa.completa).toBe(false);
    expect(Number.isFinite(vigenciaNegativa.factorVigencia)).toBe(true);
  });

  it('una fila inactiva e incompleta NUNCA marca el módulo como incompleto (solo importa el estado de las filas activas)', () => {
    const r = calcularPolizas({
      filas: [
        { id: 1, concepto: 'Activa completa', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.2 },
        { id: 2, concepto: 'Inactiva incompleta', activo: false, porcentaje: 0, vigenciaMeses: 0 },
      ],
      valorBase: VALOR_OFERTA_EJEMPLO, otros: 0, porcentajeIva: 0, numeroMesesContrato: 12,
    });
    expect(r.hayFilasIncompletas).toBe(false);
  });

  // 14) No se mensualiza dos veces.
  it('14) el total se divide UNA sola vez por numeroMesesContrato — no existe ningún prorrateo por fila ni segundo divisor', () => {
    const cfg: Parameters<typeof calcularPolizas>[0] = { filas: [], valorBase: 0, otros: 0, porcentajeIva: 0, numeroMesesContrato: 12 };
    expect(Object.keys(cfg)).not.toContain('factorMensualPonderado');
    const r = calcularPolizas({
      filas: [{ id: 1, concepto: 'Cumplimiento del contrato', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.2 }],
      valorBase: VALOR_OFERTA_EJEMPLO, otros: 0, porcentajeIva: 0, numeroMesesContrato: 12,
    });
    expect(r.valorMensual).toBeCloseTo(r.total / 12, 6);
  });

  it('numeroMesesContrato inválido (0/negativo) nunca produce NaN/Infinity — valorMensual queda en 0', () => {
    const r = calcularPolizas({
      filas: [{ id: 1, concepto: 'Cumplimiento del contrato', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.2 }],
      valorBase: VALOR_OFERTA_EJEMPLO, otros: 0, porcentajeIva: 0, numeroMesesContrato: 0,
    });
    expect(r.valorMensual).toBe(0);
    expect(Number.isFinite(r.valorMensual)).toBe(true);
  });

  // 15) Los datos guardados y recargados conservan tasa, vigencia y porcentaje.
  it('15) guardar y recargar conserva porcentaje, vigenciaMeses y tasaPoliza por fila (round-trip por normalizarPolizaRow)', () => {
    const original: PolizaRow = { id: 1, concepto: 'Cumplimiento del contrato', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.2 };
    const recargada = normalizarPolizaRow(original);
    expect(recargada.porcentaje).toBe(20);
    expect(recargada.vigenciaMeses).toBe(12);
    expect(recargada.tasaPoliza).toBe(0.2);
  });

  it('normalizarPolizaRow NUNCA inventa una tasaPoliza para un registro histórico sin ella (queda en 0 = incompleta)', () => {
    const historica = normalizarPolizaRow({ id: 1, concepto: 'Cumplimiento', activo: true, porcentaje: 20, vigenciaMeses: 12, valorTotal: 739554510 } as unknown as PolizaRow);
    expect(historica.tasaPoliza).toBe(0);
    expect(historica.porcentaje).toBe(20); // el porcentaje SÍ se conserva/migra
  });

  it('normalizarPolizaRow NUNCA reutiliza el valorTotal histórico (fuera manual o valorAmparado del ajuste anterior) como costo', () => {
    const historica = normalizarPolizaRow({ id: 1, concepto: 'Cumplimiento del contrato', activo: true, porcentaje: 20, vigenciaMeses: 12, valorTotal: 739554510 } as unknown as PolizaRow);
    expect((historica as unknown as { valorTotal?: number }).valorTotal).toBeUndefined();
  });

  it('normalizarPolizaRow remapea los 5 nombres antiguos a los nuevos (compatibilidad de conceptos, sin relación con la tasa)', () => {
    expect(normalizarPolizaRow({ id: 1, concepto: 'Cumplimiento' }).concepto).toBe('Cumplimiento del contrato');
    expect(normalizarPolizaRow({ id: 5, concepto: 'Otros' }).concepto).toBe('Otros amparos o garantías');
  });

  it('normalizarPolizaRow nunca remapea un concepto ya editado por el usuario a otro texto distinto', () => {
    expect(normalizarPolizaRow({ id: 1, concepto: 'Cumplimiento (ajustado pliego XYZ)' }).concepto).toBe('Cumplimiento (ajustado pliego XYZ)');
  });

  // 16) El valor mensual de la tarjeta usa el nuevo cálculo correcto.
  it('16) el resultado global (valorMensual) usa costoTotalPoliza + numeroMesesContrato — nunca la fórmula anterior (valorAmparado/vigenciaPorFila)', () => {
    const r = calcularPolizas({
      filas: [{ id: 1, concepto: 'Cumplimiento del contrato', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.2 }],
      valorBase: VALOR_OFERTA_EJEMPLO, otros: 0, porcentajeIva: 0, numeroMesesContrato: 36,
    });
    const valorMensualBugAnterior = (VALOR_OFERTA_EJEMPLO * 0.2) / 12; // fórmula incorrecta que reportó el usuario
    expect(r.valorMensual).not.toBeCloseTo(valorMensualBugAnterior, -3);
    expect(r.valorMensual).toBeCloseTo(r.total / 36, 6);
  });

  it('IVA se calcula sobre subtotalConOtros (subtotalPolizas + otros)', () => {
    const r = calcularPolizas({
      filas: [{ id: 1, concepto: 'A', activo: true, porcentaje: 100, vigenciaMeses: 12, tasaPoliza: 100 }],
      valorBase: 1000000, otros: 0, porcentajeIva: 19, numeroMesesContrato: 12,
    });
    expect(r.iva).toBeCloseTo(r.subtotalConOtros * 0.19, 6);
  });

  it('subtotalConOtros incluye el campo OTROS del bloque', () => {
    const r = calcularPolizas({
      filas: [{ id: 1, concepto: 'A', activo: true, porcentaje: 100, vigenciaMeses: 12, tasaPoliza: 100 }],
      valorBase: 0, otros: 500, porcentajeIva: 0, numeroMesesContrato: 12,
    });
    expect(r.subtotalConOtros).toBe(500); // valorBase 0 → costoTotalPoliza 0, solo queda otros
  });
});

describe('migrarFilasPolizasVigenciaTotal — migración ÚNICA (ajuste "AJUSTAR LA TERMINOLOGÍA Y LA PRESENTACIÓN DE VIGENCIAS" §6)', () => {
  it('costeos guardados ANTES del ajuste (vigenciaTotalMigrada=false) reciben +1 UNA sola vez: 12→13, 47→48, 35→36', () => {
    const filas: PolizaRow[] = [
      { id: 1, concepto: 'Cumplimiento del contrato', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.2 },
      { id: 2, concepto: 'Prestaciones', activo: true, porcentaje: 10, vigenciaMeses: 47, tasaPoliza: 0.2 },
      { id: 3, concepto: 'R.C.', activo: true, porcentaje: 20, vigenciaMeses: 35, tasaPoliza: 0.25 },
    ];
    const migradas = migrarFilasPolizasVigenciaTotal(filas, false);
    expect(migradas.map((f) => f.vigenciaMeses)).toEqual([13, 48, 36]);
  });

  it('§6/§7 — vigencia almacenada 13 con vigenciaTotalMigrada=true NUNCA vuelve a sumarse (13→13, no 14)', () => {
    const filas: PolizaRow[] = [{ id: 1, concepto: 'Cumplimiento del contrato', activo: true, porcentaje: 20, vigenciaMeses: 13, tasaPoliza: 0.2 }];
    const resultado = migrarFilasPolizasVigenciaTotal(filas, true);
    expect(resultado[0].vigenciaMeses).toBe(13);
    // Y el factor derivado sigue siendo 13/12, nunca 14/12.
    const r = calcularFilaPoliza(resultado[0], 3697772552);
    expect(r.factorVigencia).toBeCloseTo(13 / 12, 10);
  });

  it('la migración nunca muta el arreglo original (nuevas referencias de fila)', () => {
    const original: PolizaRow = { id: 1, concepto: 'X', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.2 };
    const [migrada] = migrarFilasPolizasVigenciaTotal([original], false);
    expect(original.vigenciaMeses).toBe(12); // el original no cambia
    expect(migrada.vigenciaMeses).toBe(13);
  });
});

describe('Ajuste "LA BASE PARA RC ES EL SALARIO MÍNIMO, NO LA OFERTA" — Responsabilidad civil extracontractual (id=4) usa SMLMV×cantidadSMLMV, nunca valorOferta', () => {
  const VALOR_OFERTA_EJEMPLO = 3697772552;
  const SMLMV_EJEMPLO = 1750905;

  it('id=4 con salarioMinimoVigente informado calcula sobre 1×SMLMV por defecto, ignorando valorOferta', () => {
    const filaRC: PolizaRow = { id: 4, concepto: 'Responsabilidad civil extracontractual', activo: true, porcentaje: 20, vigenciaMeses: 36, tasaPoliza: 0.25 };
    const r = calcularFilaPoliza(filaRC, VALOR_OFERTA_EJEMPLO, SMLMV_EJEMPLO);
    expect(r.valorAmparado).toBeCloseTo(SMLMV_EJEMPLO * 0.2, 6);
    expect(r.valorAmparado).not.toBeCloseTo(VALOR_OFERTA_EJEMPLO * 0.2, 6);
  });

  it('id=4 con cantidadSMLMV=5 multiplica la base por esa cantidad de salarios mínimos', () => {
    const filaRC: PolizaRow = { id: 4, concepto: 'Responsabilidad civil extracontractual', activo: true, porcentaje: 20, vigenciaMeses: 36, tasaPoliza: 0.25, cantidadSMLMV: 5 };
    const r = calcularFilaPoliza(filaRC, VALOR_OFERTA_EJEMPLO, SMLMV_EJEMPLO);
    expect(r.valorAmparado).toBeCloseTo(SMLMV_EJEMPLO * 5 * 0.2, 6);
  });

  it('cualquier otro id (p.ej. Cumplimiento, id=1) sigue usando valorOferta como base, incluso con salarioMinimoVigente informado', () => {
    const filaCumplimiento: PolizaRow = { id: 1, concepto: 'Cumplimiento del contrato', activo: true, porcentaje: 20, vigenciaMeses: 13, tasaPoliza: 0.2 };
    const r = calcularFilaPoliza(filaCumplimiento, VALOR_OFERTA_EJEMPLO, SMLMV_EJEMPLO);
    expect(r.valorAmparado).toBeCloseTo(VALOR_OFERTA_EJEMPLO * 0.2, 6);
  });

  it('sin salarioMinimoVigente (compatibilidad histórica), id=4 cae de vuelta a valorOferta — nunca NaN/0 silencioso', () => {
    const filaRC: PolizaRow = { id: 4, concepto: 'Responsabilidad civil extracontractual', activo: true, porcentaje: 20, vigenciaMeses: 36, tasaPoliza: 0.25 };
    const r = calcularFilaPoliza(filaRC, VALOR_OFERTA_EJEMPLO);
    expect(r.valorAmparado).toBeCloseTo(VALOR_OFERTA_EJEMPLO * 0.2, 6);
  });

  it('normalizarPolizaRow completa cantidadSMLMV ausente/≤0 en 1 — nunca 0 SMLMV de base', () => {
    expect(normalizarPolizaRow({ id: 4, concepto: 'Responsabilidad civil extracontractual' }).cantidadSMLMV).toBe(1);
    expect(normalizarPolizaRow({ id: 4, concepto: 'Responsabilidad civil extracontractual', cantidadSMLMV: 0 }).cantidadSMLMV).toBe(1);
    expect(normalizarPolizaRow({ id: 4, concepto: 'Responsabilidad civil extracontractual', cantidadSMLMV: 3 }).cantidadSMLMV).toBe(3);
  });

  it('calcularPolizas propaga salarioMinimoVigente a la fila RC y deja las demás filas intactas', () => {
    const filas: PolizaRow[] = [
      { id: 1, concepto: 'Cumplimiento del contrato', activo: true, porcentaje: 20, vigenciaMeses: 13, tasaPoliza: 0.2 },
      { id: 4, concepto: 'Responsabilidad civil extracontractual', activo: true, porcentaje: 20, vigenciaMeses: 36, tasaPoliza: 0.25, cantidadSMLMV: 2 },
    ];
    const r = calcularPolizas({ filas, valorBase: VALOR_OFERTA_EJEMPLO, otros: 0, porcentajeIva: 0, numeroMesesContrato: 12, salarioMinimoVigente: SMLMV_EJEMPLO });
    const cumplimiento = r.filasCalculadas.find((f) => f.id === 1)!;
    const rc = r.filasCalculadas.find((f) => f.id === 4)!;
    expect(cumplimiento.valorAmparado).toBeCloseTo(VALOR_OFERTA_EJEMPLO * 0.2, 6);
    expect(rc.valorAmparado).toBeCloseTo(SMLMV_EJEMPLO * 2 * 0.2, 6);
  });
});

describe('Corrección "PÓLIZA RC CON BASE SMMLV O VALOR DEL SERVICIO" — tipoBaseRC (id=4)', () => {
  const SMLMV_EJEMPLO = 1750905;
  const VALOR_OFERTA_EJEMPLO = 3697772552;

  // 1) RC con 1 SMMLV, tasa 0,25%, 12 meses conserva el comportamiento histórico.
  it('1) RC con 1 SMMLV (porcentaje=100), tasa 0,25%, 12 meses conserva exactamente el comportamiento histórico (tipoBaseRC ausente)', () => {
    const filaRC: PolizaRow = { id: 4, concepto: 'Responsabilidad civil extracontractual', activo: true, porcentaje: 100, vigenciaMeses: 12, tasaPoliza: 0.25, cantidadSMLMV: 1 };
    const r = calcularFilaPoliza(filaRC, VALOR_OFERTA_EJEMPLO, SMLMV_EJEMPLO);
    const esperado = SMLMV_EJEMPLO * 1 * (0.25 / 100) * (12 / 12);
    expect(r.costoTotalPoliza).toBeCloseTo(esperado, 2);
  });

  // 2) RC con 100 SMMLV, tasa 0,25%, 24 meses da aproximadamente $875.453.
  it('2) RC con 100 SMMLV, tasa 0,25%, 24 meses ≈ $875.453 (caso real del requerimiento)', () => {
    const filaRC: PolizaRow = { id: 4, concepto: 'Responsabilidad civil extracontractual', activo: true, porcentaje: 100, vigenciaMeses: 24, tasaPoliza: 0.25, cantidadSMLMV: 100, tipoBaseRC: 'SMMLV' };
    const r = calcularFilaPoliza(filaRC, VALOR_OFERTA_EJEMPLO, SMLMV_EJEMPLO);
    expect(r.costoTotalPoliza).toBeCloseTo(875453, -1); // tolerancia de redondeo del ejemplo del pliego
  });

  // 3) RC sobre valor del servicio $776.000.000, porcentaje 20%, tasa 0,25%, 12 meses da exactamente $388.000.
  it('3) RC modalidad VALOR_SERVICIO: $776.000.000 × 20% × 0,25% × 12/12 = exactamente $388.000', () => {
    const filaRC: PolizaRow = { id: 4, concepto: 'Responsabilidad civil extracontractual', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.25, tipoBaseRC: 'VALOR_SERVICIO' };
    const r = calcularFilaPoliza(filaRC, 776000000, SMLMV_EJEMPLO);
    expect(r.valorAmparado).toBe(776000000 * 0.20);
    expect(r.costoTotalPoliza).toBe(388000);
  });

  // 4) En modo SMMLV, modificar el valor de la oferta no reemplaza la base SMMLV.
  it('4) en modo SMMLV, cambiar valorOferta NO afecta el costo (la base sigue siendo SMLMV×cantidadSMLMV)', () => {
    const filaRC: PolizaRow = { id: 4, concepto: 'Responsabilidad civil extracontractual', activo: true, porcentaje: 100, vigenciaMeses: 12, tasaPoliza: 0.25, cantidadSMLMV: 10, tipoBaseRC: 'SMMLV' };
    const r1 = calcularFilaPoliza(filaRC, 100000000, SMLMV_EJEMPLO);
    const r2 = calcularFilaPoliza(filaRC, 999999999999, SMLMV_EJEMPLO);
    expect(r1.costoTotalPoliza).toBe(r2.costoTotalPoliza);
  });

  // 5) En modo Valor del servicio, modificar el valor de la oferta recalcula RC.
  it('5) en modo VALOR_SERVICIO, cambiar valorOferta SÍ recalcula el costo', () => {
    const filaRC: PolizaRow = { id: 4, concepto: 'Responsabilidad civil extracontractual', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.25, tipoBaseRC: 'VALOR_SERVICIO' };
    const r1 = calcularFilaPoliza(filaRC, 776000000, SMLMV_EJEMPLO);
    const r2 = calcularFilaPoliza(filaRC, 1000000000, SMLMV_EJEMPLO);
    expect(r1.costoTotalPoliza).not.toBe(r2.costoTotalPoliza);
    expect(r2.costoTotalPoliza).toBe(1000000000 * 0.20 * (0.25 / 100) * 1);
  });

  // 6) Cambiar entre SMMLV y Valor del servicio no mezcla cantidad SMMLV con porcentaje.
  it('6) alternar tipoBaseRC nunca mezcla cantidadSMLMV con porcentaje — cada campo conserva su propio valor y solo el activo participa en el cálculo', () => {
    const base: PolizaRow = { id: 4, concepto: 'Responsabilidad civil extracontractual', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.25, cantidadSMLMV: 7 };
    const comoSmmlv = calcularFilaPoliza({ ...base, tipoBaseRC: 'SMMLV' }, 776000000, SMLMV_EJEMPLO);
    const comoValorServicio = calcularFilaPoliza({ ...base, tipoBaseRC: 'VALOR_SERVICIO' }, 776000000, SMLMV_EJEMPLO);
    // SMMLV usa cantidadSMLMV=7 × SMLMV × 20%; VALOR_SERVICIO usa 776.000.000 × 20% — resultados distintos, cantidadSMLMV nunca se reinterpreta como % en ninguno de los dos.
    expect(comoSmmlv.valorAmparado).toBeCloseTo(SMLMV_EJEMPLO * 7 * 0.2, 6);
    expect(comoValorServicio.valorAmparado).toBe(776000000 * 0.20);
    expect(comoSmmlv.valorAmparado).not.toBeCloseTo(comoValorServicio.valorAmparado, -3);
  });

  // 7) Guardar y volver a abrir conserva el tipo de base seleccionado y sus parámetros (normalizarPolizaRow es el punto de hidratación real).
  it('7) normalizarPolizaRow conserva tipoBaseRC y sus parámetros tal cual fueron guardados (round-trip)', () => {
    const guardado = { id: 4, concepto: 'Responsabilidad civil extracontractual', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.25, tipoBaseRC: 'VALOR_SERVICIO' };
    const normalizado = normalizarPolizaRow(guardado);
    expect(normalizado.tipoBaseRC).toBe('VALOR_SERVICIO');
    expect(normalizado.porcentaje).toBe(20);
  });

  // 8) Un registro histórico sin el nuevo discriminador conserva el cálculo por SMMLV.
  it('8) registro histórico sin tipoBaseRC se normaliza a SMMLV y calcula EXACTAMENTE igual que antes de este ajuste', () => {
    const historico = { id: 4, concepto: 'Responsabilidad civil extracontractual', activo: true, porcentaje: 20, vigenciaMeses: 36, tasaPoliza: 0.25, cantidadSMLMV: 5 };
    const normalizado = normalizarPolizaRow(historico);
    expect(normalizado.tipoBaseRC).toBe('SMMLV');
    const r = calcularFilaPoliza(normalizado, VALOR_OFERTA_EJEMPLO, SMLMV_EJEMPLO);
    // Mismo resultado que el test preexistente "id=4 con cantidadSMLMV=5..." (línea ~335), sin ningún cambio de fórmula.
    expect(r.valorAmparado).toBeCloseTo(SMLMV_EJEMPLO * 5 * 0.2, 6);
  });

  // 9) 12 meses aplica factor 12/12.
  it('9) vigenciaMeses=12 aplica factorVigencia=1 (12/12) en ambas modalidades', () => {
    const smmlv = calcularFilaPoliza({ id: 4, concepto: 'RC', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.25, tipoBaseRC: 'SMMLV' }, VALOR_OFERTA_EJEMPLO, SMLMV_EJEMPLO);
    const valorServicio = calcularFilaPoliza({ id: 4, concepto: 'RC', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.25, tipoBaseRC: 'VALOR_SERVICIO' }, VALOR_OFERTA_EJEMPLO, SMLMV_EJEMPLO);
    expect(smmlv.factorVigencia).toBe(1);
    expect(valorServicio.factorVigencia).toBe(1);
  });

  // 10) 24 meses aplica factor 24/12.
  it('10) vigenciaMeses=24 aplica factorVigencia=2 (24/12) en ambas modalidades', () => {
    const smmlv = calcularFilaPoliza({ id: 4, concepto: 'RC', activo: true, porcentaje: 20, vigenciaMeses: 24, tasaPoliza: 0.25, tipoBaseRC: 'SMMLV' }, VALOR_OFERTA_EJEMPLO, SMLMV_EJEMPLO);
    const valorServicio = calcularFilaPoliza({ id: 4, concepto: 'RC', activo: true, porcentaje: 20, vigenciaMeses: 24, tasaPoliza: 0.25, tipoBaseRC: 'VALOR_SERVICIO' }, VALOR_OFERTA_EJEMPLO, SMLMV_EJEMPLO);
    expect(smmlv.factorVigencia).toBe(2);
    expect(valorServicio.factorVigencia).toBe(2);
  });

  // 11) Los otros amparos no cambian su cálculo.
  it('11) amparos distintos de RC (id≠4) no cambian su cálculo — tipoBaseRC no existe/no aplica para ellos', () => {
    const filaCumplimiento: PolizaRow = { id: 1, concepto: 'Cumplimiento del contrato', activo: true, porcentaje: 20, vigenciaMeses: 13, tasaPoliza: 0.2 };
    const r = calcularFilaPoliza(filaCumplimiento, VALOR_OFERTA_EJEMPLO, SMLMV_EJEMPLO);
    expect(r.valorAmparado).toBeCloseTo(VALOR_OFERTA_EJEMPLO * 0.2, 6);
  });

  // 12) Los subtotales, IVA y total de pólizas siguen recibiendo correctamente el nuevo valor calculado de RC.
  it('12) calcularPolizas propaga el costoTotalPoliza de RC (en modo VALOR_SERVICIO) al subtotal/IVA/total, junto con los demás amparos', () => {
    const filas: PolizaRow[] = [
      { id: 1, concepto: 'Cumplimiento del contrato', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.2 },
      { id: 4, concepto: 'Responsabilidad civil extracontractual', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.25, tipoBaseRC: 'VALOR_SERVICIO' },
    ];
    const r = calcularPolizas({ filas, valorBase: 776000000, otros: 0, porcentajeIva: 19, numeroMesesContrato: 12, salarioMinimoVigente: SMLMV_EJEMPLO });
    const rc = r.filasCalculadas.find((f) => f.id === 4)!;
    expect(rc.costoTotalPoliza).toBe(388000);
    const cumplimiento = r.filasCalculadas.find((f) => f.id === 1)!;
    expect(r.subtotalPolizas).toBeCloseTo(cumplimiento.costoTotalPoliza + rc.costoTotalPoliza, 6);
    expect(r.iva).toBeCloseTo(r.subtotalConOtros * 0.19, 6);
    expect(r.total).toBeCloseTo(r.subtotalConOtros + r.iva, 6);
  });
});

/**
 * Cobertura de COMPORTAMIENTO para la parte que vive en page.tsx. El
 * proyecto no tiene jsdom/RTL (`vitest.config.ts`: `environment:'node'`,
 * sin @testing-library en package.json), así que no es posible renderizar
 * el componente ni disparar eventos de verdad. Para no depender solo de
 * coincidencias de texto fuente, `resolverTipoBaseRC` se extrajo como
 * función CANÓNICA ÚNICA (ver calculo-costos-administrativos.ts) y page.tsx
 * la INVOCA directamente (`resolverTipoBaseRC(f)`) tanto para decidir qué
 * bloque de controles mostrar como para el value del <select> — nunca una
 * copia local del `??'SMMLV'`. Por eso, probar `resolverTipoBaseRC` con
 * datos reales SÍ prueba el comportamiento de la UI (misma función, mismo
 * resultado), no solo su cálculo. Las 2 comprobaciones de "cableado" al
 * final (marcadas explícitamente) son el único punto que sigue siendo
 * texto fuente — inevitable sin un harness de render — y verifican
 * exactamente que page.tsx llama a esta función en vez de reimplementarla.
 */
describe('Comportamiento UI/persistencia — Base de liquidación de RC (tipoBaseRC)', () => {
  it('1) RC (id=4) resuelve una base de liquidación válida siempre — el valor que decide qué bloque de controles muestra la UI', () => {
    const filaRC: PolizaRow = { id: 4, concepto: 'Responsabilidad civil extracontractual', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.25 };
    expect(['SMMLV', 'VALOR_SERVICIO']).toContain(resolverTipoBaseRC(filaRC));
  });

  it('2) valor histórico/ausente (tipoBaseRC undefined) resuelve a SMMLV — selecciona esa opción por defecto', () => {
    const filaHistorica: PolizaRow = { id: 4, concepto: 'Responsabilidad civil extracontractual', activo: true, porcentaje: 100, vigenciaMeses: 12, tasaPoliza: 0.25, cantidadSMLMV: 3 };
    expect(resolverTipoBaseRC(filaHistorica)).toBe('SMMLV');
  });

  it('2b) Ajuste "POR DEFECTO QUE SALGA ACTIVA VALOR DE LA OFERTA" — una fila RC RECIÉN creada (filasPolizasIniciales, costeo nuevo) arranca en VALOR_SERVICIO, sin afectar el default histórico de arriba (rutas distintas: dato nuevo vs. dato ausente ya guardado)', () => {
    const rc = filasPolizasIniciales().find((f) => f.id === 4)!;
    expect(resolverTipoBaseRC(rc)).toBe('VALOR_SERVICIO');
    // El default histórico (test 2) NO cambió — sigue resolviendo 'SMMLV' cuando el campo está genuinamente ausente (registro ya guardado antes de este ajuste).
    expect(resolverTipoBaseRC({})).toBe('SMMLV');
  });

  it('3) en SMMLV, la UI debe mostrar "Cantidad SMMLV" (resolverTipoBaseRC==="SMMLV" es la condición que la habilita)', () => {
    const filaSmmlv: PolizaRow = { id: 4, concepto: 'RC', activo: true, porcentaje: 100, vigenciaMeses: 12, tasaPoliza: 0.25, tipoBaseRC: 'SMMLV' };
    expect(resolverTipoBaseRC(filaSmmlv) === 'SMMLV').toBe(true); // rama que renderiza el input "Cantidad SMMLV"
  });

  it('4) al seleccionar Valor del servicio, la condición que muestra "Cantidad SMMLV" pasa a false (deja de renderizarse)', () => {
    const filaValorServicio: PolizaRow = { id: 4, concepto: 'RC', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.25, tipoBaseRC: 'VALOR_SERVICIO' };
    expect(resolverTipoBaseRC(filaValorServicio) === 'SMMLV').toBe(false); // rama "Cantidad SMMLV" NO se renderiza
  });

  it('5) en Valor del servicio, el porcentaje (columna % amparo, ya existente) y el valor de oferta de referencia participan realmente en el cálculo mostrado', () => {
    const valorOferta = 776000000;
    const filaValorServicio: PolizaRow = { id: 4, concepto: 'RC', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.25, tipoBaseRC: 'VALOR_SERVICIO' };
    const r = calcularFilaPoliza(filaValorServicio, valorOferta);
    // El "valor de referencia" que ve el usuario (polizasValorBase) es el MISMO valorOferta que ya usa el cálculo — no un dato paralelo.
    expect(r.valorAmparado).toBe(valorOferta * (filaValorServicio.porcentaje / 100));
  });

  it('6) cambiar el selector (SMMLV→VALOR_SERVICIO) modifica tipoBaseRC vía el mismo patrón de merge que usa actualizarPolizaBorrador ({...f,...cambios}) y recalcula con la función canónica calcularFilaPoliza', () => {
    const filaOriginal: PolizaRow = { id: 4, concepto: 'RC', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.25, cantidadSMLMV: 8, tipoBaseRC: 'SMMLV' };
    const SMLMV = 1750905;
    const antes = calcularFilaPoliza(filaOriginal, 776000000, SMLMV);
    // Simula exactamente lo que hace el onChange del <select>: actualizarPolizaBorrador(f.id,{tipoBaseRC:'VALOR_SERVICIO'}) → setPolizasFilasBorrador(p=>p.map(f=>f.id!==id?f:{...f,...cambios}))
    const cambios: Partial<PolizaRow> = { tipoBaseRC: 'VALOR_SERVICIO' };
    const filaTrasCambio: PolizaRow = { ...filaOriginal, ...cambios };
    const despues = calcularFilaPoliza(filaTrasCambio, 776000000, SMLMV);
    expect(despues.costoTotalPoliza).not.toBe(antes.costoTotalPoliza);
    expect(despues.costoTotalPoliza).toBe(776000000 * 0.20 * (0.25 / 100) * 1);
  });

  it('7) guardar (serializar) y volver a cargar (normalizarPolizaRow) conserva VALOR_SERVICIO y sus parámetros', () => {
    const filaGuardada: PolizaRow = { id: 4, concepto: 'Responsabilidad civil extracontractual', activo: true, porcentaje: 20, vigenciaMeses: 12, tasaPoliza: 0.25, tipoBaseRC: 'VALOR_SERVICIO', cantidadSMLMV: 8 };
    // Simula el round-trip real de persistencia: JSON en polizasConfig.filas → normalizarPolizaRow al recargar.
    const recargada = normalizarPolizaRow(JSON.parse(JSON.stringify(filaGuardada)));
    expect(recargada.tipoBaseRC).toBe('VALOR_SERVICIO');
    expect(recargada.porcentaje).toBe(20);
    const r = calcularFilaPoliza(recargada, 776000000, 1750905);
    expect(r.costoTotalPoliza).toBe(776000000 * 0.20 * (0.25 / 100) * 1);
  });

  it('8) volver de VALOR_SERVICIO a SMMLV conserva cantidadSLMV y porcentaje como parámetros INDEPENDIENTES (nunca se mezclan) y el cálculo vuelve exactamente al comportamiento SMMLV', () => {
    const SMLMV = 1750905;
    const filaEnValorServicio: PolizaRow = { id: 4, concepto: 'RC', activo: true, porcentaje: 100, vigenciaMeses: 24, tasaPoliza: 0.25, cantidadSMLMV: 100, tipoBaseRC: 'VALOR_SERVICIO' };
    // El usuario alterna de vuelta a SMMLV — mismo patrón de merge que el onChange real.
    const filaDeVueltaEnSmmlv: PolizaRow = { ...filaEnValorServicio, tipoBaseRC: 'SMMLV' };
    // cantidadSMLMV (100) y porcentaje (100) NUNCA se tocaron entre ambas fases — siguen siendo dos campos distintos con sus valores originales.
    expect(filaDeVueltaEnSmmlv.cantidadSMLMV).toBe(100);
    expect(filaDeVueltaEnSmmlv.porcentaje).toBe(100);
    const r = calcularFilaPoliza(filaDeVueltaEnSmmlv, 3697772552, SMLMV);
    expect(r.costoTotalPoliza).toBeCloseTo(875453, -1); // idéntico al caso histórico "100 SMMLV/24 meses" (test 2)
  });

  // Verificación de cableado — confirma que page.tsx invoca la función
  // canónica en vez de reimplementar la resolución localmente. No
  // reemplaza las pruebas de comportamiento (1)-(8) de arriba; solo
  // cierra el único hueco que un test sin DOM no puede cubrir (que la
  // UI de verdad esté conectada a `resolverTipoBaseRC`).
  describe('verificación de cableado (page.tsx usa la función canónica, no una copia local)', () => {
    const PAGE_TSX = readFileSync(join(__dirname, '../../app/page.tsx'), 'utf-8');
    it('el <select> de Base de liquidación y la rama condicional SMMLV/Valor del servicio llaman a resolverTipoBaseRC(f) — nunca "f.tipoBaseRC??\'SMMLV\'" duplicado', () => {
      expect(PAGE_TSX).toContain('<select value={resolverTipoBaseRC(f)} disabled={!f.activo}');
      expect(PAGE_TSX).toContain("resolverTipoBaseRC(f)==='SMMLV'?(");
      expect(PAGE_TSX).not.toContain("f.tipoBaseRC??'SMMLV'");
    });
    it('la opción de modalidad "Valor de la oferta" existe y no quedó una línea de referencia redundante bajo el selector (retirada por "QUITAR ESTO", ya visible en "VALOR DE LA OFERTA" arriba del modal)', () => {
      expect(PAGE_TSX).toContain('<option value="VALOR_SERVICIO">Valor de la oferta</option>');
      expect(PAGE_TSX).not.toContain('% del valor del servicio');
    });
  });
});

describe('filasImpuestosIniciales / calcularValorImpuesto / calcularTotalImpuestos', () => {
  const bases: BasesImpuesto = { costoDirecto: 10000000, manoObra: 8000000, valorContractual: 50000000, subtotalSeleccionado: 2000000 };

  it('5) impuesto FIJO conserva el valor escrito', () => {
    const row: ImpuestoRow = { id: 1, concepto: 'ICA', tipoCalculo: 'FIJO', valorFijo: 350000, activo: true };
    expect(calcularValorImpuesto(row, bases)).toBe(350000);
  });

  it('6) impuesto PORCENTAJE usa la base seleccionada, cada fila puede elegir una distinta', () => {
    const sobreCostoDirecto: ImpuestoRow = { id: 1, concepto: 'ICA', tipoCalculo: 'PORCENTAJE', porcentaje: 5, baseSeleccionada: 'COSTO_DIRECTO', activo: true };
    expect(calcularValorImpuesto(sobreCostoDirecto, bases)).toBe(500000);
    const sobreManoObra: ImpuestoRow = { id: 2, concepto: 'Otro', tipoCalculo: 'PORCENTAJE', porcentaje: 5, baseSeleccionada: 'MANO_OBRA', activo: true };
    expect(calcularValorImpuesto(sobreManoObra, bases)).toBe(400000);
    const sobreContractual: ImpuestoRow = { id: 3, concepto: 'Otro', tipoCalculo: 'PORCENTAJE', porcentaje: 1, baseSeleccionada: 'VALOR_CONTRACTUAL', activo: true };
    expect(calcularValorImpuesto(sobreContractual, bases)).toBe(500000);
    const sobreManual: ImpuestoRow = { id: 4, concepto: 'Otro', tipoCalculo: 'PORCENTAJE', porcentaje: 10, baseSeleccionada: 'VALOR_MANUAL', baseManual: 100000, activo: true };
    expect(calcularValorImpuesto(sobreManual, bases)).toBe(10000);
  });

  it('7) el total de impuestos se divide entre el numero de meses', () => {
    const rows: ImpuestoRow[] = filasImpuestosIniciales().map((r, i) => (i === 0 ? { ...r, tipoCalculo: 'FIJO' as const, valorFijo: 1200000, activo: true } : r));
    const total = calcularTotalImpuestos(rows, bases);
    expect(total).toBe(1200000);
    expect(calcularValorMensualImpuestos(total, 12)).toBe(100000);
  });

  it('impuesto inactivo no suma al total', () => {
    const rows: ImpuestoRow[] = [
      { id: 1, concepto: 'ICA', tipoCalculo: 'FIJO', valorFijo: 100, activo: true },
      { id: 2, concepto: 'Avisos', tipoCalculo: 'FIJO', valorFijo: 999, activo: false },
    ];
    expect(calcularTotalImpuestos(rows, bases)).toBe(100);
  });

  it('valor cero se calcula como 0 internamente aunque la UI muestre guion', () => {
    const row: ImpuestoRow = { id: 1, concepto: 'CREE', tipoCalculo: 'FIJO', valorFijo: 0, activo: true };
    expect(calcularValorImpuesto(row, bases)).toBe(0);
  });
});

describe('Ajuste "TOGGLE AUTOMÁTICO POR TARIFA, SIN SOBRESCRIBIR OVERRIDE MANUAL" — resolverAplicaImpuesto/resolverAplicaAvisos', () => {
  const bases: BasesImpuesto = { costoDirecto: 10000000, manoObra: 8000000, valorContractual: 50000000, subtotalSeleccionado: 2000000 };
  const rowSinDecision = (porcentaje: number): ImpuestoRow => (
    { id: 1, concepto: 'Estampillas', tipoCalculo: 'PORCENTAJE', porcentaje, baseSeleccionada: 'VALOR_CONTRACTUAL' }
  );

  it('0% sin valor previo (activo undefined) → No aplica por defecto', () => {
    expect(resolverAplicaImpuesto(rowSinDecision(0))).toBe(false);
    expect(calcularValorImpuesto(rowSinDecision(5), { ...bases, valorContractual: 0 })).toBe(0); // porcentaje>0 pero base=0, sigue siendo 0 — no confundir con "no aplica"
  });

  it('>0% sin valor previo (activo undefined) → Aplica por defecto', () => {
    expect(resolverAplicaImpuesto(rowSinDecision(1.5))).toBe(true);
    const row = rowSinDecision(1.5);
    expect(calcularValorImpuesto(row, bases)).toBe(bases.valorContractual * 1.5 / 100);
  });

  it('>0% + false guardado explícitamente → conserva "No aplica" (false NUNCA es "sin configurar")', () => {
    const row: ImpuestoRow = { ...rowSinDecision(1.5), activo: false };
    expect(resolverAplicaImpuesto(row)).toBe(false);
    expect(calcularValorImpuesto(row, bases)).toBe(0);
  });

  it('0% + true guardado explícitamente → conserva "Aplica" (el usuario permitió la excepción)', () => {
    const row: ImpuestoRow = { ...rowSinDecision(0), activo: true };
    expect(resolverAplicaImpuesto(row)).toBe(true);
    // el porcentaje sigue siendo 0 → el valor calculado es 0, pero el toggle EFECTIVO es "Aplica"
    expect(calcularValorImpuesto(row, bases)).toBe(0);
  });

  it('activo=null se trata igual que undefined (sin decisión) — nunca como false', () => {
    const row = { ...rowSinDecision(3), activo: null } as ImpuestoRow;
    expect(resolverAplicaImpuesto(row)).toBe(true);
  });

  it('cambiar manualmente el toggle (activo=false) no se revierte aunque el porcentaje siga >0 en llamadas posteriores — resolverAplicaImpuesto nunca recalcula desde la tarifa cuando ya hay decisión', () => {
    let row: ImpuestoRow = rowSinDecision(2); // sin decisión → Aplica por defecto (tarifa>0)
    expect(resolverAplicaImpuesto(row)).toBe(true);
    row = { ...row, activo: false }; // decisión manual del usuario
    // subir/bajar la tarifa después de la decisión NUNCA la sobrescribe
    row = { ...row, porcentaje: 9 };
    expect(resolverAplicaImpuesto(row)).toBe(false);
    row = { ...row, porcentaje: 0 };
    expect(resolverAplicaImpuesto(row)).toBe(false);
  });

  it('guardar y reabrir conserva la elección manual — un valor booleano explícito persistido siempre gana sobre la tarifa', () => {
    const guardadoTrasEleccionManual: ImpuestoRow = { ...rowSinDecision(7), activo: false };
    // simula "reabrir": se reconstruye la fila desde el objeto persistido, sin tocar `activo`
    const rowReabierta: ImpuestoRow = { ...guardadoTrasEleccionManual };
    expect(resolverAplicaImpuesto(rowReabierta)).toBe(false);
  });

  it('estructuras antiguas sin el campo `activo` (nunca existió en el JSON guardado) reciben correctamente el default por tarifa', () => {
    const filaAntiguaSinCampo = JSON.parse(JSON.stringify(rowSinDecision(4))) as ImpuestoRow; // nunca tuvo `activo`
    expect('activo' in filaAntiguaSinCampo).toBe(false);
    expect(resolverAplicaImpuesto(filaAntiguaSinCampo)).toBe(true);
    const filaAntiguaTarifaCero = JSON.parse(JSON.stringify(rowSinDecision(0))) as ImpuestoRow;
    expect(resolverAplicaImpuesto(filaAntiguaTarifaCero)).toBe(false);
  });

  it('impuesto FIJO sin decisión conserva el comportamiento histórico (siempre aplica) — la regla de tarifa 0%/>0% es exclusiva de PORCENTAJE', () => {
    const rowFijo: ImpuestoRow = { id: 9, concepto: 'Otro', tipoCalculo: 'FIJO', valorFijo: 0 };
    expect(resolverAplicaImpuesto(rowFijo)).toBe(true);
  });

  it('resolverAplicaAvisos: misma prioridad — decisión explícita > tarifa (0% → No aplica; >0% → Aplica) — nunca se sobrescribe una decisión ya tomada al cambiar de municipio/tarifa', () => {
    expect(resolverAplicaAvisos(undefined, 0)).toBe(false); // 0% sin decisión → No aplica
    expect(resolverAplicaAvisos(undefined, 0.15)).toBe(true); // >0% sin decisión → Aplica
    expect(resolverAplicaAvisos(false, 0.15)).toBe(false); // decisión explícita false con tarifa>0 → se respeta
    expect(resolverAplicaAvisos(true, 0)).toBe(true); // decisión explícita true con tarifa=0 → se respeta (excepción permitida)
    expect(resolverAplicaAvisos(null, 0.15)).toBe(true); // null = sin decisión, igual que undefined
  });
});

describe('Migración ÚNICA "TOGGLE AUTOMÁTICO POR TARIFA" — costeos guardados ANTES del ajuste tenían activo=false ambiguo; se resetea a "sin decisión" solo si nunca pasaron por el modelo nuevo', () => {
  it('migrarActivoImpuestosPorTarifa: sin marcador (costeo viejo) → false se convierte en undefined (deja que la tarifa mande); true se conserva', () => {
    const filas: ImpuestoRow[] = [
      { id: 1, concepto: 'Estampillas', tipoCalculo: 'PORCENTAJE', porcentaje: 10, baseSeleccionada: 'VALOR_CONTRACTUAL', activo: false },
      { id: 2, concepto: 'Otro', tipoCalculo: 'FIJO', valorFijo: 500, activo: true },
    ];
    const migradas = migrarActivoImpuestosPorTarifa(filas, false);
    expect(migradas[0].activo).toBeUndefined();
    expect(resolverAplicaImpuesto(migradas[0])).toBe(true); // porcentaje=10>0 → ahora Aplica
    expect(migradas[1].activo).toBe(true); // true viejo se conserva tal cual
  });

  it('migrarActivoImpuestosPorTarifa: CON marcador (ya migrado antes) → false se respeta SIEMPRE, nunca se vuelve a resetear', () => {
    const filas: ImpuestoRow[] = [
      { id: 1, concepto: 'Estampillas', tipoCalculo: 'PORCENTAJE', porcentaje: 10, baseSeleccionada: 'VALOR_CONTRACTUAL', activo: false },
    ];
    const migradas = migrarActivoImpuestosPorTarifa(filas, true);
    expect(migradas[0].activo).toBe(false);
    expect(resolverAplicaImpuesto(migradas[0])).toBe(false); // decisión real, respetada aunque porcentaje>0
  });

  it('migrarAplicaAvisosPorTarifa: sin marcador → false se convierte en undefined; true se conserva; con marcador, false se respeta siempre', () => {
    expect(migrarAplicaAvisosPorTarifa(false, false)).toBeUndefined();
    expect(migrarAplicaAvisosPorTarifa(true, false)).toBe(true);
    expect(migrarAplicaAvisosPorTarifa(undefined, false)).toBeUndefined();
    expect(migrarAplicaAvisosPorTarifa(false, true)).toBe(false);
  });

  it('caso íntegro del reporte del usuario: Avisos 15% guardado como false ANTES del ajuste → tras migrar, se ve "Aplica" (nunca se queda apagado)', () => {
    const migrado = migrarAplicaAvisosPorTarifa(false, false);
    expect(resolverAplicaAvisos(migrado, 0.15)).toBe(true);
  });
});

describe('conceptosVariablesAdministrativasIniciales / calcularValorMensualVariable', () => {
  it('conceptos iniciales arrancan en $0 (nunca valores de ejemplo hardcodeados), salvo Papelería ($5.000 por defecto — Ajuste "AJUSTAR OTROS COSTOS ADMINISTRATIVOS" §2) — la cantidad es 0 o 1, nunca inventada', () => {
    const filas = conceptosVariablesAdministrativasIniciales();
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.filter((f) => f.concepto !== 'Papelería').every((f) => f.valorUnitario === 0)).toBe(true);
    expect(filas.find((f) => f.concepto === 'Papelería')?.valorUnitario).toBe(VALOR_UNITARIO_PAPELERIA_POR_DEFECTO);
    expect(filas.every((f) => f.cantidad === 0 || f.cantidad === 1)).toBe(true);
  });

  it('8) MENSUAL: valorMensual = cantidad x valorUnitario', () => {
    const r: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Papeleria', cantidad: 3, valorUnitario: 50000, tipoPeriodicidad: 'MENSUAL', activo: true };
    expect(calcularValorMensualVariable(r)).toBe(150000);
  });

  it('9) UNICO/TOTAL_CONTRATO: se distribuye entre numeroMesesContrato', () => {
    const r: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Carnet', cantidad: 10, valorUnitario: 12000, tipoPeriodicidad: 'UNICO', numeroMesesContrato: 12, activo: true };
    expect(calcularValorMensualVariable(r)).toBe((10 * 12000) / 12);
    const r2: VariableAdministrativaRow = { ...r, tipoPeriodicidad: 'TOTAL_CONTRATO' };
    expect(calcularValorMensualVariable(r2)).toBe((10 * 12000) / 12);
  });

  it('10) CADA_N_MESES se mensualiza dividiendo entre la frecuencia', () => {
    const r: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Jornadas de refuerzo', cantidad: 1, valorUnitario: 600000, tipoPeriodicidad: 'CADA_N_MESES', frecuenciaMeses: 6, activo: true };
    expect(calcularValorMensualVariable(r)).toBe(100000);
  });

  it('11) fila inactiva no suma al total', () => {
    const rows: VariableAdministrativaRow[] = [
      { id: 1, categoria: 'General', concepto: 'A', cantidad: 1, valorUnitario: 1000, tipoPeriodicidad: 'MENSUAL', activo: true },
      { id: 2, categoria: 'General', concepto: 'B', cantidad: 1, valorUnitario: 9999, tipoPeriodicidad: 'MENSUAL', activo: false },
    ];
    expect(calcularTotalVariablesAdministrativas(rows)).toBe(1000);
  });

  it('cantidad y valorUnitario negativos nunca producen un valor mensual negativo', () => {
    const r: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'X', cantidad: -5, valorUnitario: -1000, tipoPeriodicidad: 'MENSUAL', activo: true };
    expect(calcularValorMensualVariable(r)).toBe(0);
  });

  it('transporte por ciudad: varias filas independientes, cada una con su propio total', () => {
    const rows: VariableAdministrativaRow[] = [
      { id: 1, categoria: 'Transporte de insumos', concepto: 'Transporte', ciudad: 'Cartagena', cantidad: 4, valorUnitario: 50000, tipoPeriodicidad: 'MENSUAL', activo: true },
      { id: 2, categoria: 'Transporte de insumos', concepto: 'Transporte', ciudad: 'Bogota', cantidad: 2, valorUnitario: 80000, tipoPeriodicidad: 'MENSUAL', activo: true },
    ];
    expect(calcularValorMensualVariable(rows[0])).toBe(200000);
    expect(calcularValorMensualVariable(rows[1])).toBe(160000);
    expect(calcularTotalVariablesAdministrativas(rows)).toBe(360000);
  });
});

describe('calcularConsolidadoCostosAdministrativos — sin doble contabilizacion', () => {
  it('12/13/14) totalCostosModulos no duplica Turnantes/Dotacion/EPP/Examenes/Cursos/Vacunas ni Mantenimiento: se pasa como un unico numero ya consolidado por el caller', () => {
    const c = calcularConsolidadoCostosAdministrativos({
      totalCostosModulos: 20000000, totalVariablesAdministrativas: 0, valorMensualPolizas: 0, valorMensualImpuestos: 0,
    });
    expect(c.totalCostosModulos).toBe(20000000);
  });

  it('15) totalMensualAdministrativo nunca se incluye dentro de su propia base', () => {
    const c = calcularConsolidadoCostosAdministrativos({
      totalCostosModulos: 10000000, totalVariablesAdministrativas: 500000, valorMensualPolizas: 100000, valorMensualImpuestos: 50000,
    });
    expect(c.totalMensualAdministrativo).toBe(650000);
    expect(c.costoMensualGeneral).toBe(10650000);
    expect(c.totalVariablesAdministrativas + c.valorMensualPolizas + c.valorMensualImpuestos).toBe(c.totalMensualAdministrativo);
  });

  it('costoMensualGeneral = totalCostosModulos + totalMensualAdministrativo, exactamente una vez cada uno', () => {
    const c = calcularConsolidadoCostosAdministrativos({
      totalCostosModulos: 1000, totalVariablesAdministrativas: 10, valorMensualPolizas: 20, valorMensualImpuestos: 30,
    });
    expect(c.costoMensualGeneral).toBe(1060);
  });
});

describe('migrarAdminRowsHistoricoAVariables — compatibilidad con costeos anteriores a este ajuste', () => {
  it('un adminRow VALOR_FIJO historico se migra a una variable MENSUAL con el mismo valor', () => {
    let id = 100;
    const migradas = migrarAdminRowsHistoricoAVariables(
      [{ id: 1, concepto: 'Supervision externa', valorMensual: 700000 }],
      { baseManoObra: 0, baseCostoDirecto: 0 },
      () => id++,
    );
    expect(migradas).toHaveLength(1);
    expect(migradas[0].valorUnitario).toBe(700000);
    expect(migradas[0].tipoPeriodicidad).toBe('MENSUAL');
    expect(calcularValorMensualVariable(migradas[0])).toBe(700000);
  });

  it('un adminRow PORCENTAJE historico se congela al valor resuelto con las bases dadas', () => {
    let id = 200;
    const migradas = migrarAdminRowsHistoricoAVariables(
      [{ id: 1, concepto: 'Administracion 5%', tipoCalculo: 'PORCENTAJE', porcentaje: 5, baseCalculo: 'COSTO_DIRECTO' }],
      { baseManoObra: 8000000, baseCostoDirecto: 10000000 },
      () => id++,
    );
    expect(calcularValorMensualVariable(migradas[0])).toBe(500000);
  });
});

describe('Ajuste "AJUSTAR OTROS COSTOS ADMINISTRATIVOS: CANTIDAD AUTOMÁTICA, PAPELERÍA Y FRECUENCIA" — pruebas obligatorias', () => {
  it('1) Papelería nueva: default = $5.000, cantidadOrigen AUTOMATICA_MANO_OBRA', () => {
    const filas = conceptosVariablesAdministrativasIniciales();
    const papeleria = filas.find((f) => f.concepto === 'Papelería');
    expect(papeleria?.valorUnitario).toBe(5000);
    expect(papeleria?.cantidadOrigen).toBe('AUTOMATICA_MANO_OBRA');
  });

  it('2) Papelería editada: usuario cambia $5.000 → $8.000; el objeto guardado conserva $8.000 (nunca se resetea al default al releer/recalcular)', () => {
    const editada: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Papelería', cantidad: 10, valorUnitario: 8000, tipoPeriodicidad: 'MENSUAL', activo: true, cantidadOrigen: 'AUTOMATICA_MANO_OBRA' };
    const sincronizada = sincronizarCantidadesAutomaticasVariables([editada], 12);
    expect(sincronizada[0].valorUnitario).toBe(8000); // el sincronizador NUNCA toca valorUnitario, solo cantidad
  });

  it('3) Papelería explícitamente en $0: no vuelve automáticamente a $5.000 (0 es un valor válido, no "sin configurar")', () => {
    const enCero: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Papelería', cantidad: 10, valorUnitario: 0, tipoPeriodicidad: 'MENSUAL', activo: true, cantidadOrigen: 'AUTOMATICA_MANO_OBRA' };
    const sincronizada = sincronizarCantidadesAutomaticasVariables([enCero], 10);
    expect(sincronizada[0].valorUnitario).toBe(0);
  });

  it('4) 10 trabajadores → cantidad AUTOMATICA_MANO_OBRA = 10', () => {
    const fila: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Papelería', cantidad: 0, valorUnitario: 5000, tipoPeriodicidad: 'MENSUAL', activo: true, cantidadOrigen: 'AUTOMATICA_MANO_OBRA' };
    const [sincronizada] = sincronizarCantidadesAutomaticasVariables([fila], 10);
    expect(sincronizada.cantidad).toBe(10);
  });

  it('5) 10 principales + 2 turnantes físicos (headcount ya sumado en page.tsx) → cantidad = 12', () => {
    const fila: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Carnet', cantidad: 0, valorUnitario: 3000, tipoPeriodicidad: 'MENSUAL', activo: true, cantidadOrigen: 'AUTOMATICA_MANO_OBRA' };
    const [sincronizada] = sincronizarCantidadesAutomaticasVariables([fila], 10 + 2);
    expect(sincronizada.cantidad).toBe(12);
  });

  it('6) el headcount recibido por sincronizarCantidadesAutomaticasVariables ya excluye líneas técnicas (TURNANTE-AUTO-REF42, fichas 42h, factores 7/42) — responsabilidad de `cantidadTrabajadoresServicio` en page.tsx, esta función solo aplica el número ya correcto', () => {
    // Documentado: la exclusión de líneas técnicas ocurre ANTES, al calcular
    // `cantidadTrabajadoresServicio` (page.tsx) — nunca aquí. Esta prueba
    // confirma que la función no introduce ninguna cuenta adicional propia.
    const fila: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Capacitaciones', cantidad: 0, valorUnitario: 1000, tipoPeriodicidad: 'MENSUAL', activo: true, cantidadOrigen: 'AUTOMATICA_MANO_OBRA' };
    const headcountYaCorrecto = 3; // 1 vigilante principal + 2 turnantes físicos (nunca la ficha técnica)
    const [sincronizada] = sincronizarCantidadesAutomaticasVariables([fila], headcountYaCorrecto);
    expect(sincronizada.cantidad).toBe(3);
  });

  it('7) Frecuencia mensual: $5.000 × 12 = $60.000', () => {
    const fila: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Papelería', cantidad: 12, valorUnitario: 5000, tipoPeriodicidad: 'MENSUAL', activo: true };
    expect(calcularValorMensualVariable(fila)).toBe(60000);
  });

  it('8) Frecuencia "cada N meses" (trimestral, N=3): ($12.000 × 12) / 3 = $48.000 mensual', () => {
    const fila: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Jornadas de refuerzo', cantidad: 12, valorUnitario: 12000, tipoPeriodicidad: 'CADA_N_MESES', frecuenciaMeses: 3, activo: true };
    expect(calcularValorMensualVariable(fila)).toBe(48000);
  });

  it('9) cambio de headcount 10 → 12 recalcula automáticamente (misma función, nuevo valor)', () => {
    const fila: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Papelería', cantidad: 10, valorUnitario: 5000, tipoPeriodicidad: 'MENSUAL', activo: true, cantidadOrigen: 'AUTOMATICA_MANO_OBRA' };
    const [con10] = sincronizarCantidadesAutomaticasVariables([fila], 10);
    expect(con10.cantidad).toBe(10);
    const [con12] = sincronizarCantidadesAutomaticasVariables([con10], 12);
    expect(con12.cantidad).toBe(12);
  });

  it('10) COSTO_FIJO se reserva para conceptos que sean genuinamente "1 unidad del servicio", cantidad SIEMPRE 1 y NUNCA se multiplica por el headcount aunque cambie a 40 trabajadores — probado sobre un concepto hipotético (ninguno de los 9 predeterminados usa COSTO_FIJO hoy, tras la corrección de negocio de "Mano de obra administrativa")', () => {
    const hipotetico: VariableAdministrativaRow = { id: 99, categoria: 'General', concepto: 'Concepto fijo hipotético', cantidad: 1, valorUnitario: 100000, tipoPeriodicidad: 'MENSUAL', activo: true, cantidadOrigen: 'COSTO_FIJO' };
    const [sincronizada] = sincronizarCantidadesAutomaticasVariables([hipotetico], 40);
    expect(sincronizada.cantidad).toBe(1);
  });

  it('10b) "Mano de obra administrativa" es MANUAL (corrección de negocio confirmada) — el usuario define 1, 2 o N coordinadores/auxiliares, NUNCA atado al headcount operativo', () => {
    const filas = conceptosVariablesAdministrativasIniciales();
    const manoObraAdmin = filas.find((f) => f.concepto === 'Mano de obra administrativa');
    expect(manoObraAdmin?.cantidadOrigen).toBe('MANUAL');
    const [sincronizada] = sincronizarCantidadesAutomaticasVariables([{ ...manoObraAdmin!, cantidad: 2 }], 40);
    expect(sincronizada.cantidad).toBe(2); // nunca se fuerza a 40
  });

  it('11) cantidad MANUAL (ej. "Microsoft", licencias por equipo — NUNCA por trabajador): permanece editable y NUNCA la toca sincronizarCantidadesAutomaticasVariables, aunque cambie el headcount', () => {
    const filas = conceptosVariablesAdministrativasIniciales();
    const microsoft = filas.find((f) => f.concepto === 'Microsoft');
    expect(microsoft?.cantidadOrigen).toBe('MANUAL');
    const [sincronizada] = sincronizarCantidadesAutomaticasVariables([{ ...microsoft!, cantidad: 5 }], 40);
    expect(sincronizada.cantidad).toBe(5); // 2 computadores ≠ 40 trabajadores — nunca se fuerza a 40
  });
});

describe('Ajuste "LA CANTIDAD NO DEBE PODER EDITARSE MANUALMENTE" — cantidad de AUTOMATICA_MANO_OBRA se DERIVA en cada cálculo, nunca se persiste como dato independiente', () => {
  it('calcularValorMensualVariable ignora row.cantidad para AUTOMATICA_MANO_OBRA cuando se pasa cantidadTrabajadoresServicio — 4 Operarios + 1 Jardinero = 5, Papelería $5.000/1 → $25.000', () => {
    const papeleria: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Papelería', cantidad: 999, valorUnitario: 5000, tipoPeriodicidad: 'CADA_N_MESES', frecuenciaMeses: 1, activo: true, cantidadOrigen: 'AUTOMATICA_MANO_OBRA' };
    expect(calcularValorMensualVariable(papeleria, 5)).toBe(25000); // row.cantidad=999 se IGNORA por completo
  });

  it('$12.000 × 5 / 3 = $20.000 (frecuencia trimestral, headcount 5)', () => {
    const fila: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'X', cantidad: 0, valorUnitario: 12000, tipoPeriodicidad: 'CADA_N_MESES', frecuenciaMeses: 3, activo: true, cantidadOrigen: 'AUTOMATICA_MANO_OBRA' };
    expect(calcularValorMensualVariable(fila, 5)).toBe(20000);
  });

  it('sin cantidadTrabajadoresServicio (parámetro ausente) usa row.cantidad tal cual — compatibilidad con llamadas que aún no conocen el headcount', () => {
    const fila: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Papelería', cantidad: 5, valorUnitario: 5000, tipoPeriodicidad: 'CADA_N_MESES', frecuenciaMeses: 1, activo: true, cantidadOrigen: 'AUTOMATICA_MANO_OBRA' };
    expect(calcularValorMensualVariable(fila)).toBe(25000);
  });

  it('cantidad MANUAL/COSTO_FIJO NUNCA se sustituye por cantidadTrabajadoresServicio, aunque se pase', () => {
    const manual: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Microsoft', cantidad: 3, valorUnitario: 50000, tipoPeriodicidad: 'CADA_N_MESES', frecuenciaMeses: 1, activo: true, cantidadOrigen: 'MANUAL' };
    expect(calcularValorMensualVariable(manual, 40)).toBe(150000); // 3 licencias, NUNCA 40
  });

  it('calcularTotalVariablesAdministrativas propaga cantidadTrabajadoresServicio a todas las filas AUTOMATICA_MANO_OBRA', () => {
    const filas: VariableAdministrativaRow[] = [
      { id: 1, categoria: 'General', concepto: 'Papelería', cantidad: 1, valorUnitario: 5000, tipoPeriodicidad: 'CADA_N_MESES', frecuenciaMeses: 1, activo: true, cantidadOrigen: 'AUTOMATICA_MANO_OBRA' },
      { id: 2, categoria: 'General', concepto: 'Carnet', cantidad: 1, valorUnitario: 3000, tipoPeriodicidad: 'CADA_N_MESES', frecuenciaMeses: 1, activo: true, cantidadOrigen: 'AUTOMATICA_MANO_OBRA' },
    ];
    expect(calcularTotalVariablesAdministrativas(filas, 5)).toBe(5000 * 5 + 3000 * 5);
  });
});

describe('validarFrecuenciaMeses — Ajuste "PARAMETRIZAR CORRECTAMENTE OTROS COSTOS ADMINISTRATIVOS" §4: entero ≥1, nunca 0 ni negativo', () => {
  it('1, 2, 3, 6, 12 son válidos', () => {
    [1, 2, 3, 6, 12].forEach((n) => expect(validarFrecuenciaMeses(n)).toBe(true));
  });

  it('0 y negativos son inválidos', () => {
    expect(validarFrecuenciaMeses(0)).toBe(false);
    expect(validarFrecuenciaMeses(-1)).toBe(false);
    expect(validarFrecuenciaMeses(-12)).toBe(false);
  });

  it('valores no enteros son inválidos', () => {
    expect(validarFrecuenciaMeses(1.5)).toBe(false);
    expect(validarFrecuenciaMeses(NaN)).toBe(false);
  });
});

describe('conceptosVariablesAdministrativasIniciales — Papelería usa CADA_N_MESES/frecuenciaMeses=1 (nunca MENSUAL como periodicidad distinta) desde el catálogo centralizado', () => {
  it('Papelería nace con tipoPeriodicidad CADA_N_MESES y frecuenciaMeses 1 (matemáticamente idéntico a "mensual")', () => {
    const papeleria = conceptosVariablesAdministrativasIniciales().find((f) => f.concepto === 'Papelería')!;
    expect(papeleria.tipoPeriodicidad).toBe('CADA_N_MESES');
    expect(papeleria.frecuenciaMeses).toBe(1);
    expect(calcularValorMensualVariable(papeleria, 12)).toBe(60000); // $5.000 × 12 / 1
  });
});

describe('migrarCantidadOrigenPorCatalogo — corrección de seguimiento: filas guardadas ANTES de este ajuste no tenían cantidadOrigen', () => {
  it('completa cantidadOrigen para una fila histórica llamada exactamente "Papelería" (sin el campo) usando el catálogo → AUTOMATICA_MANO_OBRA', () => {
    const historica: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Papelería', cantidad: 0, valorUnitario: 0, tipoPeriodicidad: 'MENSUAL', activo: true };
    const [migrada] = migrarCantidadOrigenPorCatalogo([historica]);
    expect(migrada.cantidadOrigen).toBe('AUTOMATICA_MANO_OBRA');
  });

  it('NUNCA sobrescribe un cantidadOrigen ya explícito, aunque sea "MANUAL" (decisión real tomada por el usuario)', () => {
    const yaDecidida: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Papelería', cantidad: 3, valorUnitario: 5000, tipoPeriodicidad: 'MENSUAL', activo: true, cantidadOrigen: 'MANUAL' };
    const [migrada] = migrarCantidadOrigenPorCatalogo([yaDecidida]);
    expect(migrada.cantidadOrigen).toBe('MANUAL');
  });

  it('un concepto que NO coincide exactamente con el catálogo (ej. "Control de acceso o identificación") queda sin cambios', () => {
    const otro: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Control de acceso o identificación', cantidad: 1, valorUnitario: 0, tipoPeriodicidad: 'MENSUAL', activo: true };
    const [migrada] = migrarCantidadOrigenPorCatalogo([otro]);
    expect(migrada.cantidadOrigen).toBeUndefined();
  });
});

describe('migrarValorUnitarioPapeleria — corrección de seguimiento: Papelería guardada en $0 ANTES de este ajuste (nunca una decisión real) se corrige UNA sola vez', () => {
  it('yaMigrado=false y Papelería en $0 → se corrige a $5.000', () => {
    const historica: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Papelería', cantidad: 0, valorUnitario: 0, tipoPeriodicidad: 'MENSUAL', activo: true, cantidadOrigen: 'AUTOMATICA_MANO_OBRA' };
    const [migrada] = migrarValorUnitarioPapeleria([historica], false);
    expect(migrada.valorUnitario).toBe(VALOR_UNITARIO_PAPELERIA_POR_DEFECTO);
  });

  it('yaMigrado=true → NUNCA toca un $0 (ya es una decisión explícita posterior a este ajuste)', () => {
    const explicita: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Papelería', cantidad: 5, valorUnitario: 0, tipoPeriodicidad: 'MENSUAL', activo: true, cantidadOrigen: 'AUTOMATICA_MANO_OBRA' };
    const [migrada] = migrarValorUnitarioPapeleria([explicita], true);
    expect(migrada.valorUnitario).toBe(0);
  });

  it('yaMigrado=false pero Papelería ya tiene un valor distinto de 0 → se respeta (no se sobrescribe)', () => {
    const conValor: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Papelería', cantidad: 5, valorUnitario: 8000, tipoPeriodicidad: 'MENSUAL', activo: true, cantidadOrigen: 'AUTOMATICA_MANO_OBRA' };
    const [migrada] = migrarValorUnitarioPapeleria([conValor], false);
    expect(migrada.valorUnitario).toBe(8000);
  });

  it('nunca afecta otros conceptos (ej. Microsoft en $0 se mantiene en $0)', () => {
    const microsoft: VariableAdministrativaRow = { id: 1, categoria: 'General', concepto: 'Microsoft', cantidad: 1, valorUnitario: 0, tipoPeriodicidad: 'MENSUAL', activo: true, cantidadOrigen: 'MANUAL' };
    const [migrada] = migrarValorUnitarioPapeleria([microsoft], false);
    expect(migrada.valorUnitario).toBe(0);
  });
});
