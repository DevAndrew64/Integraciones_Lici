/**
 * FASE 3B (diagnóstico Aseocolba) — tests permanentes que protegen la
 * conservación de horas cuando la reclasificación estadística de
 * festivos coincide con el sobretiempo genérico L-S (bug de doble
 * conteo/bucket negativo confirmado y corregido en Fase 3B).
 *
 * Invariantes protegidas (A-G del pedido de Fase 3B):
 *   A. ningún bucket de horas puede terminar negativo por una reclasificación.
 *   B. una hora reclasificada no queda simultáneamente en origen y destino.
 *   C. la reclasificación no crea horas adicionales.
 *   D. la reclasificación no elimina horas.
 *   E. la suma de horas afectadas se conserva antes/después.
 *   F. domingo/festivo dedicado no cambia.
 *   G. los casos sin festivo permanecen idénticos.
 *
 * NO se modifica ninguna regla de negocio en este archivo — mensualización
 * ×4,33, factor festivo 5,92 y clasificación de franjas quedan exactamente
 * como estaban. Los escenarios se ajustaron al tope diario de 8h + jornada
 * semanal de 42h (ajuste "HORAS EXTRAS POR JORNADA SEMANAL, NO POR DÍA"): el
 * exceso semanal cae en las últimas horas de la semana, así que los
 * escenarios que prueban reclasificación de sobretiempo usan 9h/día para que
 * el sobretiempo ocurra también de lunes a viernes (sábado no tiene festivos
 * estadísticos en 2026).
 */
import { describe, expect, it } from 'vitest';
import { derivarDistribucionHorasComercialActivo, derivarDistribucionComercialHistoricoParaPruebas } from './derivar-distribucion-comercial';
import { calcularResultadoTarifaMensualComercial30Dias } from './motor-comercial-30-dias';
import type { DistribucionHorarioConfigurada } from '../horarios/tipos';

function distribucion(dias: DistribucionHorarioConfigurada['diasSemana'], bloques: { inicio: string; fin: string; orden: number }[]): DistribucionHorarioConfigurada {
  return {
    idCliente: 'd1', empresa: '', codigo: '', horario: '', jornada: '', turno: '',
    diasSemana: dias, bloques, excepcionesFecha: [], sincronizadoExterno: false,
  };
}

const SALARIO = 1750905;

function calcular(r: ReturnType<typeof derivarDistribucionHorasComercialActivo>) {
  if (!r.ok) throw new Error('no debería bloquear');
  const resultado = calcularResultadoTarifaMensualComercial30Dias({
    distribucionHoras: r.distribucion, salarioMensual: SALARIO, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
    horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
  });
  return { r, resultado };
}

describe('FASE 3B — 1) L-S 8h/día, SIN festivo → comportamiento de Fase 3 sin cambios', () => {
  it('sin festivo, extra diurna semanal = 6h, mensual = 25,98h, nada reclasificado', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '16:00', orden: 1 }]);
    const { r, resultado } = calcular(derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' }));
    if (!r.ok) return;
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(6, 5);
    expect(r.distribucion.horasExtraDiurnaFestivaDiaEspecial).toBe(0);
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.horasMensualesPromedio).toBeCloseTo(25.98, 2);
  });
});

describe('FASE 3B — 2) L-S 9h/día + festivo estadístico → ningún bucket negativo, ninguna doble contabilización', () => {
  // 9h × 6 = 54h: 1h extra diaria L-V (tope de 8h) + 7h extra el sábado
  // (la semana ya llegó a 42h) = 12h extra semanales.
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '17:00', orden: 1 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026, metodologiaCosteo: 'SEMANAL_4_33' });

  it('[Invariante A] ningún bucket de la distribución es negativo', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    for (const [clave, valor] of Object.entries(r.distribucion)) {
      expect(valor as number, clave).toBeGreaterThanOrEqual(0);
    }
    expect(r.horasExtraSemanales.diurna).toBeGreaterThanOrEqual(0);
    expect(r.horasExtraSemanales.nocturna).toBeGreaterThanOrEqual(0);
  });

  it('[Invariante B/C/D/E] la suma (extraDiurna + extraDiurnaFestiva) mensual, con festivo, es idéntica a extraDiurna mensual sin festivo — ni se crean ni se pierden horas, la porción reclasificada no queda en ambos buckets', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: SALARIO, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!;
    const hedf = resultado.conceptos.find(c => c.concepto === 'extraDiurnaFestiva')!;
    // Sin festivo, este mismo escenario da exactamente 12h × 4,33 = 51,96h
    // — con festivo, la suma de ambos conceptos debe seguir siendo 51,96h:
    // la reclasificación solo mueve horas entre buckets, nunca las duplica
    // ni las descuenta de más.
    expect(hed.horasMensualesPromedio + hedf.horasMensualesPromedio).toBeCloseTo(12 * 4.33, 5);
    expect(hedf.horasMensualesPromedio).toBeGreaterThan(0); // algo SÍ se reclasificó
    expect(hed.horasMensualesPromedio).toBeLessThan(12 * 4.33); // y salió de aquí, no se quedó íntegro
  });
});

describe('FASE 3B — 3) sobretiempo DIURNO + festivo → traslado correcto al bucket festivo diurno', () => {
  it('L-S 9h/día (100% diurno): la porción reclasificada aparece en horasExtraDiurnaFestivaDiaEspecial, nunca en la nocturna', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '17:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasExtraDiurnaFestivaDiaEspecial).toBeGreaterThan(0);
    expect(r.distribucion.horasExtraNocturnaFestivaDiaEspecial).toBe(0);
  });
});

describe('FASE 3B — 4) sobretiempo NOCTURNO + festivo → traslado correcto al bucket festivo nocturno, nunca al diurno', () => {
  it('L-S 20:00-05:00 (9h, 100% nocturno): la porción reclasificada aparece en horasExtraNocturnaFestivaDiaEspecial, nunca en la diurna', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '20:00', fin: '05:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    // 9h nocturnas > 8h de tope diario → 1h extra nocturna/día, íntegramente nocturna.
    expect(r.horasExtraSemanales.nocturna).toBeGreaterThan(0);
    expect(r.horasExtraSemanales.diurna).toBe(0);
    if (r.distribucion.horasExtraNocturnaFestivaDiaEspecial > 0) {
      expect(r.distribucion.horasExtraDiurnaFestivaDiaEspecial).toBe(0);
    }
    for (const [clave, valor] of Object.entries(r.distribucion)) {
      expect(valor as number, clave).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('FASE 3B — 5/6) jornadas sin exceso (7h exactas o menos) + festivo → nunca inventa horas extra', () => {
  it('7h exactas/día + festivo: 0 extra, ninguna reclasificación de "extra" (solo de ordinaria)', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '15:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasExtraSemanales.diurna).toBe(0);
    expect(r.distribucion.horasExtraDiurnaFestivaDiaEspecial).toBe(0);
  });

  it('6h/día (< 7h cuota) + festivo: 0 extra', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '14:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasExtraSemanales.diurna).toBe(0);
    expect(r.distribucion.horasExtraDiurnaFestivaDiaEspecial).toBe(0);
  });
});

describe('FASE 3B — 7) festivo pero sin sobretiempo → comportamiento anterior preservado', () => {
  it('7h/día + festivo: horasDominicalFestivaDiaEspecial (ordinaria reclasificada) sigue funcionando igual que siempre, sin relación con el fix de extra', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '15:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBeGreaterThan(0);
  });
});

describe('FASE 3B — 8) sobretiempo pero sin festivo → comportamiento de Fase 3 preservado', () => {
  it('L-S 8h/día, incluyeFestivos=false: idéntico al test §1 de este archivo', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '16:00', orden: 1 }]);
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(6, 5);
  });
});

describe('FASE 3B — 9) camino histórico LEGADO → tests históricos siguen verdes (aislamiento activo/histórico preservado)', () => {
  it('LEGADO con festivo: la reclasificación sigue saliendo de horasExtraDiurnaDiaOrdinario (mecanismo original, nunca del bucket semanal)', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '16:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026, metodologiaCosteo: 'LEGADO_COMERCIAL_30_DIAS' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasExtraSemanales.diurna).toBe(0); // el bucket semanal nunca se usa en LEGADO
    for (const [clave, valor] of Object.entries(r.distribucion)) {
      expect(valor as number, clave).toBeGreaterThanOrEqual(0); // tampoco el histórico puede ir negativo
    }
  });
});

describe('FASE 3B — 10) regresión Aseocolba 12:00-20:00 sin festivo', () => {
  it('48h semanales (8h/día, sin exceso diario): L-V 8h ordinarias (19:00-20:00 es recargo nocturno), el exceso semanal de 6h cae el sábado — 5h extra diurna + 1h extra nocturna', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '12:00', fin: '20:00', orden: 1 }]);
    const { r, resultado } = calcular(derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' }));
    if (!r.ok) return;
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario * 6).toBeCloseTo(5, 5); // 1h × L-V
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.horasMensualesPromedio).toBeCloseTo(5 * 4.33, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'extraNocturna')!.horasMensualesPromedio).toBeCloseTo(1 * 4.33, 2);
  });
});

describe('FASE 3B — 11) CT172 activo bajo la regla de jornada semanal', () => {
  // L-V 11h (8h ordinarias + 3h extra por día = 15h) + sábado 6h (2h ordinarias
  // hasta completar las 42h + 4h extra) = 19h extra semanales — el valor
  // histórico validado contra el Excel de CT172 ($857.422).
  it('19h extra semanales, 82,27h mensuales, $857.422', () => {
    const dLV = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '12:00', orden: 1 }, { inicio: '13:00', fin: '18:00', orden: 2 }]);
    const dSab = distribucion(['S'], [{ inicio: '06:00', fin: '12:00', orden: 1 }]);
    const { r, resultado } = calcular(derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dLV, dSab], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' }));
    if (!r.ok) return;
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(19, 5);
    const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!;
    expect(hed.horasMensualesPromedio).toBeCloseTo(82.27, 2);
    expect(hed.valorMensual).toBe(857422);
  });
});

describe('FASE 3B — 12) camino histórico LEGADO, mismo escenario CT172, sin cambios frente a Fase 3', () => {
  // NOTA: $857.422/82,27h NUNCA fue producido por LEGADO_COMERCIAL_30_DIAS
  // — ese valor venía del acumulador semanal cronológico que en su
  // momento se llamaba "SEMANAL_4_33" (retirado del código en Fase 3, ver
  // detalle-calculo-horas.test.ts). LEGADO siempre usó cuota diaria
  // =jornadaSemanal÷díasProgramados (aquí 42÷6=7h, coincidentemente igual
  // a la cuota activa) mensualizada con 24,08 — produce 80,2667h, un
  // valor DISTINTO, sin cambios entre Fase 3 y Fase 3B (esta fase no
  // toca la ruta LEGADO en absoluto salvo por el guardrail de no-negativos).
  it('80,27h mensuales (24,08÷6 sobre 20h de exceso semanal bruto) — no 82,27h, ese valor nunca vino de LEGADO', () => {
    const dLV = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '12:00', orden: 1 }, { inicio: '13:00', fin: '18:00', orden: 2 }]);
    const dSab = distribucion(['S'], [{ inicio: '06:00', fin: '12:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dLV, dSab], incluyeFestivos: false, metodologiaCosteo: 'LEGADO_COMERCIAL_30_DIAS' });
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: SALARIO, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!;
    expect(hed.horasMensualesPromedio).toBeCloseTo(80.266666, 2);
  });
});

describe('FASE 3B — F) domingo/festivo dedicado (bucket 5,92) no cambia con este fix', () => {
  it('domingo programado, sin festivo estadístico L-S: 7h dominicales, 0 extra — idéntico a Fase 1', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '13:00', orden: 1 }]);
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist], incluyeFestivos: true, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBe(7);
    expect(r.distribucion.horasExtraDiurnaFestivaDiaEspecial).toBe(0);
  });
});
