/**
 * DIAGNÓSTICO FINAL — auditoría puntual del caso real reportado:
 * ASEADOR, Lunes a Domingo 06:00-14:00 (56h/semana, jornada ordinaria 42h).
 * Reproduce con el motor REAL (nunca números inventados) los valores que
 * la aplicación muestra (Extra diurna=25,98 h/mes, Dom.-Fest.=41,44 h/mes,
 * Extra festiva=5,92 h/mes) para confirmar/refutar que sean matemáticamente
 * correctos según las reglas YA implementadas (nunca corrige la fórmula
 * sin antes probar la causa).
 */
import { describe, expect, it } from 'vitest';
import { derivarDistribucionHorasComercialActivo } from './derivar-distribucion-comercial';
import { calcularResultadoTarifaMensualComercial30Dias, FACTOR_SEMANAS_MES, PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT } from './motor-comercial-30-dias';
import type { DistribucionHorarioConfigurada } from '../horarios/tipos';

function distribucion(dias: DistribucionHorarioConfigurada['diasSemana'], bloques: { inicio: string; fin: string; orden: number }[]): DistribucionHorarioConfigurada {
  return { idCliente: 'd1', empresa: '', codigo: '', horario: '', jornada: '', turno: '', diasSemana: dias, bloques, excepcionesFecha: [], sincronizadoExterno: false };
}

describe('DIAGNÓSTICO — ASEADOR Lunes a Domingo 06:00-14:00 (56h/semana)', () => {
  const entrada = {
    distribucionesHorario: [distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '14:00', orden: 1 }])],
    incluyeFestivos: true,
    metodologiaCosteo: 'SEMANAL_4_33' as const,
  };

  it('1) la derivación reporta 6h/semana de sobretiempo genérico L-S (48h trabajadas L-S − 42h de jornada) y 0h nocturnas (06:00-14:00 es 100% diurno)', () => {
    const r = derivarDistribucionHorasComercialActivo(entrada);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(6, 6); // 48h(L-S) - 42h = 6h
    expect(r.horasExtraSemanales.nocturna).toBe(0);
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario).toBe(0);
    // El domingo (día especial) SIEMPRE se procesa aparte del acumulador
    // L-S, con su propia cuota diaria (42÷6=7h) — nunca se mezcla con el
    // acumulador semanal de 42h de L-S (mecanismo histórico, documentado
    // en derivar-distribucion-comercial.ts, "reversión provisional").
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBeCloseTo(7, 6); // cuota diaria del domingo
    expect(r.distribucion.horasExtraDiurnaFestivaDiaEspecial).toBeCloseTo(1, 6); // 8h trabajadas domingo - 7h de cuota
  });

  it('2) mensualizado: Extra diurna = 6h/semana × 4,33 = 25,98 h/mes (EXACTO, no una fórmula distinta)', () => {
    const r = derivarDistribucionHorasComercialActivo(entrada);
    if (!r.ok) throw new Error(r.motivo);
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion,
      salarioMensual: 1750905, auxilioTransporteMensual: 249095, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales,
    });
    const horasExtraDiurna = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.horasMensualesPromedio;
    const horasDomFest = resultado.conceptos.find(c => c.concepto === 'ordinariaDominical')!.horasMensualesPromedio;
    const horasExtraFestiva = resultado.conceptos.find(c => c.concepto === 'extraDiurnaFestiva')!.horasMensualesPromedio;
    // 25,98 = 6 × 4,33 (FACTOR_SEMANAS_MES) — el sobretiempo semanal L-S,
    // NUNCA 24,08 (eso es exclusivo de conceptos diarios, ver comentario
    // "los tres parámetros conviven... nunca se mezclan para la misma hora").
    expect(horasExtraDiurna).toBeCloseTo(6 * FACTOR_SEMANAS_MES, 4);
    expect(horasExtraDiurna).toBeCloseTo(25.98, 2);
    // 41,44 = 7h (cuota diaria del domingo) × 5,92 (domingosFestivosPromedioMes)
    expect(horasDomFest).toBeCloseTo(7 * PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT.domingosFestivosPromedioMes, 4);
    expect(horasDomFest).toBeCloseTo(41.44, 2);
    // 5,92 = 1h (exceso del domingo sobre su cuota de 7h) × 5,92
    expect(horasExtraFestiva).toBeCloseTo(1 * PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT.domingosFestivosPromedioMes, 4);
    expect(horasExtraFestiva).toBeCloseTo(5.92, 2);
  });

  it('3) las 56h/semana quedan 100% clasificadas, sin doble conteo ni solapamiento: 42(L-S ordinaria)+6(L-S extra)+7(domingo dominical)+1(domingo extra festiva)=56', () => {
    const r = derivarDistribucionHorasComercialActivo(entrada);
    if (!r.ok) throw new Error(r.motivo);
    const ordinariaLS = r.distribucion.horasOrdinariasDiaOrdinario * PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT.diasOrdinariosPromedioMes / PARAMETROS_METODO_COMERCIAL_30_DIAS_DEFAULT.diasOrdinariosPromedioMes; // horas/semana ya vienen normalizadas ÷6 en `distribucion`; se recomponen ×6 abajo
    // `distribucion.horasOrdinariasDiaOrdinario` viene dividido entre los 6
    // días ordinarios posibles (ver comentario "MENSUALIZACIÓN DE DÍAS
    // ORDINARIOS SELECCIONADOS") — se multiplica ×6 para volver a horas
    // TOTALES de la semana L-S y poder sumar contra las 56h reales.
    const totalLSOrdinariaSemana = r.distribucion.horasOrdinariasDiaOrdinario * 6;
    const totalLSExtraSemana = r.horasExtraSemanales.diurna;
    const totalDomingoDominical = r.distribucion.horasDominicalFestivaDiaEspecial;
    const totalDomingoExtra = r.distribucion.horasExtraDiurnaFestivaDiaEspecial;
    void ordinariaLS;
    expect(totalLSOrdinariaSemana).toBeCloseTo(42, 6);
    expect(totalLSExtraSemana).toBeCloseTo(6, 6);
    expect(totalDomingoDominical).toBeCloseTo(7, 6);
    expect(totalDomingoExtra).toBeCloseTo(1, 6);
    expect(totalLSOrdinariaSemana + totalLSExtraSemana + totalDomingoDominical + totalDomingoExtra).toBeCloseTo(56, 6);
  });
});
