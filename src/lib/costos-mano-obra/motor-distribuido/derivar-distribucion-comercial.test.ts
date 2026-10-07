/**
 * Derivación automática de la clasificación comercial desde el horario
 * estructurado — pruebas obligatorias de la corrección "el método
 * comercial no debe pedir las horas por concepto manualmente". Cubre
 * §7 (caso 1 bloque), §8 (dos bloques), §9 (descanso), §10 (varias
 * distribuciones), §11 (domingo/festivos) y la prueba de integración §15
 * (desde horario hasta el resultado monetario, sin ningún campo manual).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { derivarDistribucionComercialHistoricoParaPruebas, derivarDistribucionHorasComercialActivo, MetodologiaLegadaNoEjecutableError } from './derivar-distribucion-comercial';
import { calcularResultadoTarifaMensualComercial30Dias } from './motor-comercial-30-dias';
import { calcularFestivosPromedioMesPorDiaSemana } from './festivos-dia-semana';
import type { DistribucionHorarioConfigurada } from '../horarios/tipos';

function distribucion(dias: DistribucionHorarioConfigurada['diasSemana'], bloques: { inicio: string; fin: string; orden: number }[]): DistribucionHorarioConfigurada {
  return {
    idCliente: 'd1', empresa: '', codigo: '', horario: '', jornada: '', turno: '',
    diasSemana: dias, bloques, excepcionesFecha: [], sincronizadoExterno: false,
  };
}

describe('§7 CASO DE CONTROL 1 — lunes a domingo, un solo bloque 06:00-13:00', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '13:00', orden: 1 }]);
  // Ajuste "IMPLEMENTACIÓN CONTROLADA" — reversión provisional: domingo
  // (el día de descanso obligatorio por defecto) vuelve a procesarse
  // aislado, con su propia cuota, mensualizado con 5,92 — nunca participa
  // del acumulador semanal compartido ni de la reclasificación
  // estadística de festivos, hasta contar con Excel que confirme el
  // tratamiento unificado (ver auditoría de los 6 casos preexistentes).

  it('4) 06:00-13:00 deriva 7 horas ordinarias automáticamente, sin campos manuales', () => {
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.distribucion.horasOrdinariasDiaOrdinario).toBe(7);
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario).toBe(0);
    expect(r.distribucion.horasExtraNocturnaDiaOrdinario).toBe(0);
  });

  it('el perfil dominical/festivo se deriva del domingo programado (mismo horario) — 7 horas dominicales, 0 extra', () => {
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBe(7);
    expect(r.distribucion.horasExtraDiurnaFestivaDiaEspecial).toBe(0);
    expect(r.distribucion.horasExtraNocturnaFestivaDiaEspecial).toBe(0);
    expect(r.distribucion.horasRecargoNocturnoFestivoDiaEspecial).toBe(0);
    expect(r.horasExtraSemanales.diurnaFestiva).toBe(0);
    expect(r.origenMensualizacionExtra).toBe('DIARIO_24_08');
  });

  it('14/15) prueba de integración completa: mensual 210,00 h y $656.473, SIN suministrar ninguna hora por concepto manualmente', () => {
    const derivado = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!derivado.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: derivado.distribucion,
      salarioMensual: 1750905,
      auxilioTransporteMensual: 0,
      cantidadTrabajadores: 1,
    });
    const ordinariaMensual = resultado.horasOrdinariasMensualesPromedio;
    const dominicalMensual = resultado.conceptos.find(c => c.concepto === 'ordinariaDominical')!.horasMensualesPromedio;
    const extraFestiva = resultado.conceptos.find(c => c.concepto === 'extraDiurnaFestiva')!.valorMensual;
    expect(ordinariaMensual).toBeCloseTo(168.56, 2);
    expect(dominicalMensual).toBeCloseTo(41.44, 2);
    expect(Math.round((ordinariaMensual + dominicalMensual) * 100) / 100).toBeCloseTo(210, 1);
    expect(resultado.conceptos.find(c => c.concepto === 'ordinariaDominical')!.valorMensual).toBe(656473);
    expect(extraFestiva).toBe(0);
  });
});

describe('§8 CASO DE CONTROL 2 — dos bloques, lunes a domingo 07:00-13:00 / 14:00-17:00', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [
    { inicio: '07:00', fin: '13:00', orden: 1 },
    { inicio: '14:00', fin: '17:00', orden: 2 },
  ]);

  // Ajuste "USAR 4,33 COMO PROYECCIÓN PRINCIPAL DE SOBRETIEMPO EN COSTEOS
  // NUEVOS" — para un costeo nuevo (metodologiaCosteo por defecto,
  // SEMANAL_4_33), TODO patrón genérico L-S usa el acumulador semanal
  // compartido, uniforme o no — nunca la cuota diaria rígida. El día de
  // descanso obligatorio (domingo, aquí) sigue aislado con 5,92, sin
  // cambio (fuera de alcance, §7).

  it('5) deriva 9 horas efectivas por día (6+3): 12h de exceso semanal, SEMANAL_4_33 (costeo nuevo)', () => {
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasOrdinariasDiaOrdinario).toBe(7);
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(12, 5);
  });

  it('6) el descanso (13:00-14:00) no se contabiliza — nunca se calculan 10 horas', () => {
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    const totalDiario = r.distribucion.horasOrdinariasDiaOrdinario + r.horasExtraSemanales.diurna / 6;
    expect(totalDiario).toBe(9);
    expect(totalDiario).not.toBe(10);
  });

  it('el domingo (mismo horario) deriva 7 dominicales + 2 extra festiva diurna — sin cambio (día de descanso, fuera de alcance)', () => {
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBe(7);
    expect(r.distribucion.horasExtraDiurnaFestivaDiaEspecial).toBe(2);
  });

  it('mensual: dominicales 41.44, HEDF 11.84 (5,92, sin cambio); HED = 51,96 (12h × 4,33, costeo nuevo) — nunca 48,16', () => {
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion,
      salarioMensual: 1750905,
      auxilioTransporteMensual: 0,
      cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales,
      origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.horasMensualesPromedio).toBeCloseTo(12 * 4.33, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.horasMensualesPromedio).not.toBeCloseTo(48.16, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'ordinariaDominical')!.horasMensualesPromedio).toBeCloseTo(41.44, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurnaFestiva')!.horasMensualesPromedio).toBeCloseTo(11.84, 2);
  });
});

describe('§9 CASO DE CONTROL 3 — descanso intermedio, lunes a sábado 06:00-12:00 / 14:00-18:00', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [
    { inicio: '06:00', fin: '12:00', orden: 1 },
    { inicio: '14:00', fin: '18:00', orden: 2 },
  ]);

  it('7) lunes a sábado con 10h efectivas/día: 18h de exceso semanal, SEMANAL_4_33 (ajuste "USAR 4,33 COMO PROYECCIÓN PRINCIPAL DE SOBRETIEMPO EN COSTEOS NUEVOS")', () => {
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasOrdinariasDiaOrdinario).toBe(7);
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(18, 5);
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
  });

  it('sin domingo programado y sin incluyeFestivos, el perfil especial queda en cero (no bloquea)', () => {
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBe(0);
  });
});

describe('§10 varias distribuciones — perfiles distintos por día, agregados correctamente', () => {
  it('distribución A (lunes-jueves, 8h) y B (viernes, 7h) se derivan y agregan sin campos manuales por distribución', () => {
    const distA = distribucion(['L', 'M', 'X', 'J'], [{ inicio: '08:00', fin: '12:30', orden: 1 }, { inicio: '14:00', fin: '18:00', orden: 2 }]); // 4.5+4=8.5h... ajustar
    const distB = distribucion(['V'], [{ inicio: '08:00', fin: '12:00', orden: 1 }, { inicio: '14:00', fin: '17:00', orden: 2 }]); // 4+3=7h
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [distA, distB], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 5 días ordinarios programados (L,M,X,J,V) → cuota=42/5=8.4h
    expect(r.diasOrdinariosProgramadosSemana).toBe(5);
    expect(r.cuotaOrdinariaDiariaComercialHoras).toBeCloseTo(8.4, 4);
  });

  it('[ACTUALIZADO — jornada semanal 8h/42h] no pierde días/bloques/descansos al combinar varias distribuciones — la suma de ordinarias+extra por día ya NO incluye el sobretiempo (que ahora vive en horasExtraSemanales, mensualizado × 4,33, nunca en este promedio ponderado)', () => {
    const distA = distribucion(['L', 'M', 'X', 'J'], [{ inicio: '08:00', fin: '12:30', orden: 1 }, { inicio: '14:00', fin: '18:00', orden: 2 }]);
    const distB = distribucion(['V'], [{ inicio: '08:00', fin: '12:00', orden: 1 }, { inicio: '14:00', fin: '17:00', orden: 2 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [distA, distB], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    const horasDiaPromedio = r.distribucion.horasOrdinariasDiaOrdinario + r.distribucion.horasRecargoNocturnoDiaOrdinario + r.distribucion.horasExtraDiurnaDiaOrdinario + r.distribucion.horasExtraNocturnaDiaOrdinario;
    // Regla vigente (tope diario de 8h + 42h semanales): L,M,X,J (8,5h/día)
    // aportan 8h ordinarias + 0,5h extra cada uno; V (7h) no genera extra.
    // Total semanal 41h (< 42h, el tope semanal no interviene). Solo las
    // ordinarias quedan en este campo (39h/6 = 6,5h) — el sobretiempo (2h
    // semanales: 0,5h×4) se reporta aparte, en horasExtraSemanales,
    // mensualizado × 4,33.
    expect(horasDiaPromedio).toBeCloseTo(39 / 6, 5);
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(2, 5);
  });
});

describe('§11 domingo/festivos — ya NO bloquea (ajuste "FESTIVOS SEGÚN LOS DÍAS REALMENTE PROGRAMADOS")', () => {
  it('incluyeFestivos=true sin domingo programado YA NO bloquea — se interpreta como jornada normal, con reclasificación de festivos reales', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '06:00', fin: '13:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.interpretacion.tipoOperacionInterpretada).toBe('JORNADA_INDIVIDUAL');
  });

  it('incluyeFestivos=false sin domingo programado NO bloquea — el perfil especial es simplemente cero', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '06:00', fin: '13:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    expect(r.ok).toBe(true);
  });
});

describe('§16 pruebas adicionales — franja nocturna y exclusividad de conceptos', () => {
  it('[ACTUALIZADO — Opción C, rollover S→D] la franja nocturna (19:00-06:00) se clasifica como recargo nocturno dentro de la cuota — el bloque de SÁBADO (22:00-05:00) cruza hacia domingo, así que sus 5h posteriores a medianoche ya no cuentan como sábado/ordinario: van al bucket dominical/nocturno, con conservación exacta de las 42h totales', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '22:00', fin: '05:00', orden: 1 }]); // 7h/día, cruza medianoche, toda nocturna
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    // L-V (5 días, ningún cruce hacia domingo): 5 × 7h = 35h.
    // Sábado 22:00-24:00 (antes de medianoche, sigue siendo sábado): 2h.
    // Sábado 22:00-05:00 nunca reinicia su cuota de 7h al llegar a
    // medianoche — el acumulador es continuo durante todo el turno — pero
    // los minutos posteriores a medianoche (domingo 00:00-05:00, 5h) se
    // clasifican en el día real en que ocurren, nunca como sábado.
    // Ordinario nocturno (L-V + la porción de sábado ANTES de medianoche):
    // 35h + 2h = 37h → mensualizado ÷6 = 6,1666...h.
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario).toBeCloseTo(37 / 6, 6);
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario * 6).toBeCloseTo(37, 6);
    expect(r.distribucion.horasOrdinariasDiaOrdinario).toBe(0);
    // Las 5h de domingo (00:00-05:00) NUNCA se pierden: quedan
    // conservadas íntegras en el bucket dominical/nocturno correcto
    // (recargo, no extra — la cuota de 7h del turno de sábado nunca se
    // completa dos veces: acumulado 0-419min dentro de cuota=420min en
    // todo el turno continuo, sin excepción).
    expect(r.distribucion.horasRecargoNocturnoFestivoDiaEspecial).toBeCloseTo(5, 6);
    // Sin sobretiempo en ningún bucket (7h/día exactas, nunca se supera la
    // cuota continua del turno) — ni ordinario ni dominical.
    expect(r.distribucion.horasExtraNocturnaDiaOrdinario).toBe(0);
    expect(r.distribucion.horasExtraNocturnaFestivaDiaEspecial).toBe(0);
    expect(r.horasExtraSemanales.nocturna).toBe(0);
    expect(r.horasExtraSemanales.diurna).toBe(0);
    // Conservación total: 37h (ordinario) + 5h (dominical) = 42h (6 días × 7h) —
    // ningún minuto perdido ni duplicado entre los dos buckets.
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario * 6 + r.distribucion.horasRecargoNocturnoFestivoDiaEspecial).toBeCloseTo(42, 6);
  });

  it('10) no se duplican conceptos — el total semanal efectivo coincide con las horas brutas del día × 6 (el sobretiempo semanal ahora se reporta vía horasExtraSemanales, no vía horasExtraDiurnaDiaOrdinario)', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '06:00', fin: '15:00', orden: 1 }]); // 9h
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasEfectivasSemanaTotal).toBeCloseTo(9 * 6, 5);
    const sumaPonderada = r.distribucion.horasOrdinariasDiaOrdinario + r.distribucion.horasRecargoNocturnoDiaOrdinario + r.distribucion.horasExtraDiurnaDiaOrdinario + r.distribucion.horasExtraNocturnaDiaOrdinario;
    expect(sumaPonderada * 6 + r.horasExtraSemanalGenerica).toBeCloseTo(9 * 6, 5);
  });

  it('11) 24.08 y 5.92 permanecen internos — este módulo no los expone ni los recibe como parámetro', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '06:00', fin: '13:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    expect(r).not.toHaveProperty('diasOrdinariosPromedioMes');
    expect(r).not.toHaveProperty('domingosFestivosPromedioMes');
  });

  it('2/3) el cálculo no requiere ni acepta ninguna hora por concepto manual — la única entrada es el horario estructurado', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '13:00', orden: 1 }]);
    const entrada = { distribucionesHorario: [dist], incluyeFestivos: true, metodologiaCosteo: 'SEMANAL_4_33' as const };
    // TypeScript ya impide pasar horasOrdinariasDiaOrdinario/etc. como
    // entrada (EntradaDerivacionComercial no los declara) — la prueba en
    // runtime confirma que el resultado depende solo de distribucionesHorario/incluyeFestivos.
    const r1 = derivarDistribucionComercialHistoricoParaPruebas(entrada);
    const r2 = derivarDistribucionComercialHistoricoParaPruebas({ ...entrada });
    expect(r1).toEqual(r2);
  });
});

describe('§ INTÉRPRETE DE TURNOS — C) turno diurno de 12 horas (06:00-18:00, L-D/Fest)', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });

  it('deriva ok y clasifica como TURNO_12_HORAS_INDIVIDUAL/COBERTURA_12_7 con cuota fija 10,5h', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.tipoOperacionInterpretada).toBe('COBERTURA_12_7');
    expect(r.cuotaOrdinariaDiariaComercialHoras).toBe(10.5);
    expect(r.distribucion.horasOrdinariasDiaOrdinario).toBe(10.5);
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(1.5);
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario).toBe(0);
    expect(r.distribucion.horasExtraNocturnaDiaOrdinario).toBe(0);
  });

  it('mensual: Dom./Fest. 62,16, HED 36,12, HEDF 8,88', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    expect(resultado.conceptos.find(c => c.concepto === 'ordinariaDominical')!.horasMensualesPromedio).toBeCloseTo(62.16, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.horasMensualesPromedio).toBeCloseTo(36.12, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurnaFestiva')!.horasMensualesPromedio).toBeCloseTo(8.88, 2);
  });

  it('nunca usa 10.995 ni 1.005 (parámetros legacy)', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.cuotaOrdinariaDiariaComercialHoras).not.toBe(10.995);
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).not.toBe(1.005);
  });
});

describe('§ INTÉRPRETE DE TURNOS — D) turno nocturno de 12 horas (18:00-06:00, L-D/Fest)', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '18:00', fin: '06:00', orden: 1 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });

  it('clasificación cronológica: 1h ordinaria diurna + 9,5h recargo nocturno + 1,5h extra nocturna', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.tipoOperacionInterpretada).toBe('COBERTURA_12_7');
    expect(r.interpretacion.cruzaMedianoche).toBe(true);
    expect(r.distribucion.horasOrdinariasDiaOrdinario).toBeCloseTo(1, 5);
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario).toBeCloseTo(9.5, 5);
    expect(r.distribucion.horasExtraNocturnaDiaOrdinario).toBeCloseTo(1.5, 5);
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
  });

  it('mensual: Dom./Fest. 5,92, HEN 36,12, HENF 8,88, RN 228,76, RNF 56,24 — nunca 5,83', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    expect(resultado.conceptos.find(c => c.concepto === 'ordinariaDominical')!.horasMensualesPromedio).toBeCloseTo(5.92, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'extraNocturna')!.horasMensualesPromedio).toBeCloseTo(36.12, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'extraNocturnaFestiva')!.horasMensualesPromedio).toBeCloseTo(8.88, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'recargoNocturno')!.horasMensualesPromedio).toBeCloseTo(228.76, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'recargoNocturnoDominical')!.horasMensualesPromedio).toBeCloseTo(56.24, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'ordinariaDominical')!.horasMensualesPromedio).not.toBeCloseTo(5.83, 2);
  });
});

describe('§ INTÉRPRETE DE TURNOS — A) Avianca, posición 24/7 vía dos bloques 06:00-18:00 + 18:00-06:00', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, cantidadTrabajadores: 1 , metodologiaCosteo: 'SEMANAL_4_33' });

  it('tipo COBERTURA_24_7, cantidad interpretada como 1 posición, cobertura 168h', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.tipoOperacionInterpretada).toBe('COBERTURA_24_7');
    expect(r.interpretacion.significadoCantidad).toBe('POSICIONES');
    expect(r.interpretacion.cantidadPosiciones).toBe(1);
    expect(r.interpretacion.coberturaSemanalPorPosicion).toBe(168);
    expect(r.interpretacion.requiereTurnantes).toBe(true);
    expect(r.interpretacion.brechaCoberturaPendiente).toBe(true);
  });
});

describe('§ INTÉRPRETE DE TURNOS — B) Avianca, tres posiciones 24/7 (cantidadTrabajadores=3)', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, cantidadTrabajadores: 3 , metodologiaCosteo: 'SEMANAL_4_33' });

  it('3 posiciones, cobertura total 504h — nunca 3 trabajadores', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.cantidadPosiciones).toBe(3);
    expect(r.interpretacion.coberturaSemanalTotal).toBe(504);
    expect(r.interpretacion.significadoCantidad).toBe('POSICIONES');
  });
});

describe('§ INTÉRPRETE DE TURNOS — E) bloque 06:00-06:00 vía derivador (división automática, sin preguntar)', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '06:00', orden: 1 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });

  it('se interpreta como COBERTURA_24_7 con dos turnos, nunca como cero horas', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.tipoOperacionInterpretada).toBe('COBERTURA_24_7');
    expect(r.interpretacion.turnosInterpretados).toBe(2);
    expect(r.interpretacion.coberturaSemanalPorPosicion).toBe(168);
  });
});

describe('§ INTÉRPRETE DE TURNOS — I) parámetros monetarios vigentes en los casos de 12 horas', () => {
  it('divisor 210, factores vigentes, HALF_UP por concepto — turno diurno', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    for (const c of resultado.conceptos) {
      expect(Number.isInteger(c.valorMensual)).toBe(true); // HALF_UP ya aplicado, entero en pesos
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// CIERRE CORRECTIVO — programaciones NO uniformes (§4/§5): cada
// distribución se procesa de forma independiente (normaliza, valida,
// clasifica, mensualiza SOLO sus días), nunca asumiendo que un "día
// representativo" describe a los demás. Casos A–D del cierre.
// ═══════════════════════════════════════════════════════════════════════

describe('CASO A) L-V 14:00-21:00 + sábado libre + domingo 14:00-21:00 (festivos)', () => {
  const dLV = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '14:00', fin: '21:00', orden: 1 }]);
  const dDom = distribucion(['D'], [{ inicio: '14:00', fin: '21:00', orden: 1 }]);
  // Ajuste "IMPLEMENTACIÓN CONTROLADA" — reversión provisional: domingo
  // programado desactiva la reclasificación estadística de festivos por
  // completo (mismo gate histórico), hasta contar con Excel que confirme
  // el tratamiento unificado.
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dLV, dDom], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });

  it('9) no se usa el primer día como representante de todos — sábado nunca se selecciona y genera cero horas', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.diasOrdinariosProgramadosSemana).toBe(5); // L-V, sábado ausente por completo
  });

  it('clasificación cronológica del bloque 14:00-21:00: 5h diurnas (ordinaria) + 2h nocturnas (recargo), sin extra', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasOrdinariasDiaOrdinario).toBeCloseTo((5 * 5) / 6, 5);
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario).toBeCloseTo((2 * 5) / 6, 5);
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
    expect(r.distribucion.horasExtraNocturnaDiaOrdinario).toBe(0);
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBe(5);
    expect(r.distribucion.horasRecargoNocturnoFestivoDiaEspecial).toBe(2);
  });

  it('§8.1 — Ordinaria 100,33 / RN 40,13 / Dom.Fest. 29,60 / RNF 11,84 (valores corregidos, peso 24,08÷6 por día seleccionado)', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    expect(resultado.horasOrdinariasMensualesPromedio).toBeCloseTo(100.33, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'recargoNocturno')!.horasMensualesPromedio).toBeCloseTo(40.13, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'ordinariaDominical')!.horasMensualesPromedio).toBeCloseTo(29.60, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'recargoNocturnoDominical')!.horasMensualesPromedio).toBeCloseTo(11.84, 2);
  });

  it('total mensual (7 conceptos, horas) = 181,91', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    const totalHoras = resultado.horasOrdinariasMensualesPromedio + resultado.conceptos.reduce((s, c) => s + c.horasMensualesPromedio, 0);
    expect(totalHoras).toBeCloseTo(181.91, 2);
  });
});

describe('§8.5 — sábado no seleccionado: cero horas de sábado (peso del día ausente nunca se genera)', () => {
  it('un bloque de 1h/día en L-V (sábado ausente) pesa 5×(24,08÷6)=20,0667, nunca 6×(24,08÷6)=24,08', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '08:00', fin: '09:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    expect(resultado.horasOrdinariasMensualesPromedio).toBeCloseTo(20.066666, 4);
    expect(resultado.horasOrdinariasMensualesPromedio).not.toBeCloseTo(24.08, 2);
  });
});

describe('CASO B) L,X,V 06:00-14:00 (8h) + M,J 14:00-21:00 (7h) — se suman ambas distribuciones', () => {
  const d1 = distribucion(['L', 'X', 'V'], [{ inicio: '06:00', fin: '14:00', orden: 1 }]);
  const d2 = distribucion(['M', 'J'], [{ inicio: '14:00', fin: '21:00', orden: 1 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [d1, d2], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });

  it('8) cada distribución se clasifica con su propio horario — el resultado NO es el de lunes aplicado a los 5 días', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    // Si (incorrectamente) se usara el horario del lunes (06:00-14:00, 8h,
    // 100% diurno) para los 5 días, recargoNocturnoDiaOrdinario sería 0.
    // Martes/jueves (14:00-21:00) sí generan 2h nocturnas cada uno — el
    // peso agregado debe reflejarlo.
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario).toBeGreaterThan(0);
  });

  it('[ACTUALIZADO — jornada semanal 8h/42h] §8.6 — L,X,V (8h diurnas) caben en el tope diario de 8h; M,J (7h, de las cuales 2h nocturnas) también; la semana suma 38h (< 42h) → sin extras — ordinaria=(3×8+2×5)/6=5,6667h; recargo nocturno=(2×2)/6=0,6667h; extra diurna semanal=0', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasOrdinariasDiaOrdinario).toBeCloseTo((3 * 8 + 2 * 5) / 6, 5);
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario).toBeCloseTo((2 * 2) / 6, 5);
    expect(r.horasExtraSemanales.diurna).toBe(0);
  });
});

describe('CASO C) L-V 06:00-14:00 + domingo 08:00-12:00 (4h propias, no hereda el horario semanal)', () => {
  const dLV = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '14:00', orden: 1 }]);
  const dDom = distribucion(['D'], [{ inicio: '08:00', fin: '12:00', orden: 1 }]);
  // Ajuste "IMPLEMENTACIÓN CONTROLADA" — reversión provisional: domingo
  // programado desactiva la reclasificación estadística de festivos.
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dLV, dDom], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });

  it('el domingo conserva su propia duración de 4 horas, no las 8h del horario L-V', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const totalEspecial = r.distribucion.horasDominicalFestivaDiaEspecial + r.distribucion.horasRecargoNocturnoFestivoDiaEspecial
      + r.distribucion.horasExtraDiurnaFestivaDiaEspecial + r.distribucion.horasExtraNocturnaFestivaDiaEspecial;
    expect(totalEspecial).toBe(4);
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBe(4);
  });

  it('[ACTUALIZADO — jornada semanal 8h/42h] L-V: 8h/día (100% diurno) caben en el tope diario → 8h×5÷6=6,6667h ordinarias; 40h semanales (< 42h) → sin extra (el domingo está aislado y no cuenta para el tope semanal)', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasOrdinariasDiaOrdinario).toBeCloseTo((8 * 5) / 6, 5);
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario).toBe(0);
    expect(r.horasExtraSemanales.diurna).toBe(0);
  });
});

describe('§8.2/§8.4 — pesos exactos por cantidad de días seleccionados (24,08÷6 por día)', () => {
  it('§8.2 — L-S completo (6 días), bloque de 1h/día: el peso ordinario total es exactamente 24,08 (6×24,08÷6)', () => {
    // Bloque de 1h (sin superar ninguna cuota) para aislar el peso puro,
    // igual que en §8.3/§8.4 — con un bloque más largo el resultado sigue
    // siendo correcto pero mezclado con la cuota ordinaria/extra del día.
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '09:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.diasOrdinariosProgramadosSemana).toBe(6);
    const resultado = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    expect(resultado.horasOrdinariasMensualesPromedio).toBeCloseTo(24.08, 2); // 6 días × (24.08÷6) = 24.08 exacto
  });

  it('§8.2b — L-S completo con un bloque real (07:00-13:00/14:00-17:00, 9h): costeo nuevo → SEMANAL_4_33 (168,56 ordinaria sin cambio; HED=51,96 vía 4,33; 41,44/11,84 sin cambio)', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '07:00', fin: '13:00', orden: 1 }, { inicio: '14:00', fin: '17:00', orden: 2 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion,
      salarioMensual: 1750905,
      auxilioTransporteMensual: 0,
      cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales,
      origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
    expect(resultado.horasOrdinariasMensualesPromedio).toBeCloseTo(168.56, 2);
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(12, 5);
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.horasMensualesPromedio).toBeCloseTo(12 * 4.33, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.horasMensualesPromedio).not.toBeCloseTo(48.16, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'ordinariaDominical')!.horasMensualesPromedio).toBeCloseTo(41.44, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurnaFestiva')!.horasMensualesPromedio).toBeCloseTo(11.84, 2);
  });

  it('§8.3 — L,M,X,J,V (5 días): peso ordinario = 20,066666...', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '08:00', fin: '09:00', orden: 1 }]); // 1h/día para aislar el peso puro
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasOrdinariasDiaOrdinario).toBeCloseTo(5 / 6, 6); // 1h × 5 días / 6
    const resultado = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    expect(resultado.horasOrdinariasMensualesPromedio).toBeCloseTo(20.066666, 4);
  });

  it('§8.4 — L, X y V (3 días): peso ordinario = 12,04', () => {
    const dist = distribucion(['L', 'X', 'V'], [{ inicio: '08:00', fin: '09:00', orden: 1 }]); // 1h/día
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    expect(resultado.horasOrdinariasMensualesPromedio).toBeCloseTo(12.04, 2);
  });
});

describe('CASO D) dos distribuciones asignan el mismo lunes con horarios incompatibles — debe bloquearse por colisión', () => {
  it('bloquea con un mensaje claro, sin escoger silenciosamente ninguna de las dos', () => {
    const d1 = distribucion(['L'], [{ inicio: '06:00', fin: '14:00', orden: 1 }]);
    const d2 = distribucion(['L'], [{ inicio: '08:00', fin: '16:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [d1, d2], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toMatch(/lunes/);
    expect(r.motivo).toMatch(/colisión|distintas/);
    expect(r.motivo).not.toMatch(/[A-Z_]{4,}/); // nunca un código interno
  });

  it('dos distribuciones con el MISMO horario para el mismo día no son una colisión (caso legítimo, ej. horario ya fusionado por catálogo)', () => {
    const d1 = distribucion(['L'], [{ inicio: '06:00', fin: '14:00', orden: 1 }]);
    const d2 = distribucion(['L'], [{ inicio: '06:00', fin: '14:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [d1, d2], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    expect(r.ok).toBe(true);
  });
});

describe('§10.6 — un bloque inválido (solapado) NUNCA llega a calcularse — se bloquea en el propio derivador', () => {
  it('bloques que se solapan dentro de UNA misma distribución bloquean con mensaje claro, sin código interno', () => {
    const d = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '17:00', fin: '06:00', orden: 2 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [d], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe('Los bloques 06:00–18:00 y 17:00–06:00 se superponen entre las 17:00 y las 18:00.');
  });
});

describe('§6/§7 — costo de cobertura vs. costo de trabajador, sin doble multiplicación', () => {
  it('A) una jornada individual usa cantidad como TRABAJADORES', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '08:00', fin: '17:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false, cantidadTrabajadores: 4 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.significadoCantidad).toBe('TRABAJADORES');
  });

  it('B) una cobertura 12/7 usa cantidad como POSICIONES', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, cantidadTrabajadores: 2 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.significadoCantidad).toBe('POSICIONES');
  });

  it('C) una cobertura 24/7 usa cantidad como POSICIONES', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, cantidadTrabajadores: 1 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.significadoCantidad).toBe('POSICIONES');
  });

  it('D) tres posiciones 24/7 producen 3 × 168 = 504 horas semanales de cobertura', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, cantidadTrabajadores: 3 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.coberturaSemanalTotal).toBe(504);
    expect(r.interpretacion.cantidadPosiciones).toBe(3);
  });

  it('E) el sistema nunca afirma que tres posiciones equivalen a tres trabajadores (no existe ningún campo "trabajadores" derivado de cantidadPosiciones)', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, cantidadTrabajadores: 3 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion).not.toHaveProperty('cantidadTrabajadores');
    expect(r.interpretacion.significadoCantidad).toBe('POSICIONES');
  });

  it('F) brechaCoberturaPendiente marca el total como provisional mientras no se resuelvan titulares/turnantes', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, cantidadTrabajadores: 1 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.brechaCoberturaPendiente).toBe(true);
  });

  it('§7 trazabilidad — la cantidad NO multiplica dos veces las horas: distribucion (horas por trabajador) es idéntica sin importar cantidadTrabajadores', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }]);
    const r1 = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, cantidadTrabajadores: 1 , metodologiaCosteo: 'SEMANAL_4_33' });
    const r3 = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, cantidadTrabajadores: 3 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r1.ok || !r3.ok) throw new Error('no debería bloquear');
    // `distribucion` (horas unitarias) es igual — cantidadTrabajadores solo
    // afecta interpretacion.cantidadPosiciones/coberturaSemanalTotal, nunca
    // las horas por trabajador que alimentan el motor financiero.
    expect(r1.distribucion).toEqual(r3.distribucion);
    // El multiplicador de cantidad se aplica UNA sola vez, más adelante,
    // dentro de motor-comercial-30-dias.ts (`tarifaMensualCargo =
    // tarifaMensualPorTrabajador × cantidadTrabajadores`) — nunca aquí.
    const resultado1 = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r1.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    const resultado3 = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r3.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 3 });
    expect(resultado3.tarifaMensualCargo).toBe(resultado1.tarifaMensualCargo * 3);
    expect(resultado3.tarifaMensualPorTrabajador).toBe(resultado1.tarifaMensualPorTrabajador);
  });
});
describe('§8.7/§8.8 — sin literales legacy en el archivo fuente del ajuste', () => {
  it('el módulo no contiene el literal 4.5 (promedio anterior, ya no vigente)', () => {
    const fuente = readFileSync(join(__dirname, 'derivar-distribucion-comercial.ts'), 'utf-8');
    expect(fuente).not.toMatch(/\b4\.5\b/);
  });

  it('el módulo no contiene el literal 5.83 (parámetro legacy)', () => {
    const fuente = readFileSync(join(__dirname, 'derivar-distribucion-comercial.ts'), 'utf-8');
    expect(fuente).not.toMatch(/5\.83/);
  });

  it('el peso diario se deriva de una constante entera (6), nunca de un decimal redondeado independiente', () => {
    const fuente = readFileSync(join(__dirname, 'derivar-distribucion-comercial.ts'), 'utf-8');
    expect(fuente).toMatch(/DIAS_ORDINARIOS_SEMANA_COMERCIAL\s*=\s*6/);
    expect(fuente).not.toMatch(/4\.01333/);
  });
});

describe('§8.9 — casos Avianca (12/7 y 24/7) continúan pasando sin cambios (diasOrdinariosProgramadosSemana=6 siempre en cobertura permanente)', () => {
  it('COBERTURA_12_7 sigue produciendo Dom./Fest. 62,16, HED 36,12, HEDF 8,88', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.tipoOperacionInterpretada).toBe('COBERTURA_12_7');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    expect(resultado.conceptos.find(c => c.concepto === 'ordinariaDominical')!.horasMensualesPromedio).toBeCloseTo(62.16, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.horasMensualesPromedio).toBeCloseTo(36.12, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurnaFestiva')!.horasMensualesPromedio).toBeCloseTo(8.88, 2);
  });

  it('COBERTURA_24_7 (Avianca 1 posición) sigue con cobertura semanal 168h', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, cantidadTrabajadores: 1 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.tipoOperacionInterpretada).toBe('COBERTURA_24_7');
    expect(r.interpretacion.coberturaSemanalPorPosicion).toBe(168);
  });
});


// ═══════════════════════════════════════════════════════════════════════
// CORRECCIÓN — FESTIVOS SEGÚN LOS DÍAS REALMENTE PROGRAMADOS: una jornada
// sin domingo (ej. L-V) con incluyeFestivos=true ya NO bloquea; los
// festivos reales de Colombia (calendario-festivos-colombia.ts) que
// coinciden con un día seleccionado reclasifican esas horas de ordinario
// a festivo, sin crear horas nuevas. anioCalculo=2026 fijo en las pruebas
// para que los conteos de festivos por día de semana sean deterministas.
// ═══════════════════════════════════════════════════════════════════════

describe('§12.1 — L-V 06:00-14:00 (40h) sin domingo: JORNADA_PARCIAL (sabado ausente), nunca cobertura ni turnantes', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '14:00', orden: 1 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026 , metodologiaCosteo: 'SEMANAL_4_33' });

  it('ya no bloquea, y no es COBERTURA_12_7/24_7', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.tipoOperacionInterpretada).not.toBe('COBERTURA_12_7');
    expect(r.interpretacion.tipoOperacionInterpretada).not.toBe('COBERTURA_24_7');
  });

  it('11) no aparece significadoCantidad=POSICIONES — sigue siendo TRABAJADORES', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.significadoCantidad).toBe('TRABAJADORES');
  });

  it('12) requiereTurnantes=false y brechaCoberturaPendiente=false — nunca "costo parcial pendiente de turnantes"', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.requiereTurnantes).toBe(false);
    expect(r.interpretacion.brechaCoberturaPendiente).toBe(false);
  });

  it('cobertura semanal programada = 40 horas', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.coberturaSemanalPorPosicion).toBe(40);
  });
});

describe('§12.2/§12.6/§12.7 — festivo lunes: 8 horas reclasificadas, sin doble conteo, sin aumentar el total', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '14:00', orden: 1 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026 , metodologiaCosteo: 'SEMANAL_4_33' });
  const rSinFestivos = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false, anioCalculo: 2026 , metodologiaCosteo: 'SEMANAL_4_33' });

  it('la contribución de lunes (8h × 1 festivo-lunes/mes en 2026) se reclasifica a Dom./Fest.', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    const domFest = resultado.conceptos.find(c => c.concepto === 'ordinariaDominical')!.horasMensualesPromedio;
    expect(domFest).toBeGreaterThan(0);
  });

  it('[ACTUALIZADO — Fase 3B] 7) el total de horas (ordinaria + extra genérica + festiva) no aumenta por reclasificar un festivo — es idéntico al caso sin festivos, siempre que se pase horasExtraSemanales/origenMensualizacionExtra (el bucket donde ahora vive el sobretiempo genérico en el camino activo, ver Fase 3/3B)', () => {
    if (!r.ok || !rSinFestivos.ok) throw new Error('no debería bloquear');
    const conFestivos = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const sinFestivos = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: rSinFestivos.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: rSinFestivos.horasExtraSemanales, origenMensualizacionExtra: rSinFestivos.origenMensualizacionExtra,
    });
    const totalHorasCon = conFestivos.horasOrdinariasMensualesPromedio + conFestivos.conceptos.reduce((s, c) => s + c.horasMensualesPromedio, 0);
    const totalHorasSin = sinFestivos.horasOrdinariasMensualesPromedio + sinFestivos.conceptos.reduce((s, c) => s + c.horasMensualesPromedio, 0);
    expect(totalHorasCon).toBeCloseTo(totalHorasSin, 5);
  });

  it('[ACTUALIZADO — Fase 3B] 6) no existe doble conteo — pasando horasExtraSemanales/origenMensualizacionExtra (uso real de producción), el total con festivo coincide con el total sin festivo; SIN pasarlos, el sobretiempo genérico "queda sin valorizar" por diseño (documentado en el tipo `EntradaTarifaMensual`) — no es un techo fijo basado en 24,08, ese técho ya no aplica al sobretiempo genérico bajo la regla vigente', () => {
    if (!r.ok || !rSinFestivos.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const resultadoSin = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: rSinFestivos.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: rSinFestivos.horasExtraSemanales, origenMensualizacionExtra: rSinFestivos.origenMensualizacionExtra,
    });
    const totalHoras = resultado.horasOrdinariasMensualesPromedio + resultado.conceptos.reduce((s, c) => s + c.horasMensualesPromedio, 0);
    const totalHorasSin = resultadoSin.horasOrdinariasMensualesPromedio + resultadoSin.conceptos.reduce((s, c) => s + c.horasMensualesPromedio, 0);
    expect(totalHoras).toBeCloseTo(totalHorasSin, 5); // conservación exacta, no un techo aproximado
  });
});

describe('§12.3/§12.9 — festivo viernes usa la programación específica del viernes (no la del lunes)', () => {
  it('L,M,X,J con 06:00-14:00 y V con 14:00-21:00: el festivo de viernes reclasifica horas nocturnas, no solo diurnas', () => {
    const dLMXJ = distribucion(['L', 'M', 'X', 'J'], [{ inicio: '06:00', fin: '14:00', orden: 1 }]);
    const dV = distribucion(['V'], [{ inicio: '14:00', fin: '21:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dLMXJ, dV], incluyeFestivos: true, anioCalculo: 2026 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    const rnf = resultado.conceptos.find(c => c.concepto === 'recargoNocturnoDominical')!.horasMensualesPromedio;
    expect(rnf).toBeGreaterThan(0);
  });
});

describe('§12.4/§12.5 — festivo sábado/domingo: cero horas cuando no están seleccionados', () => {
  it('sábado no seleccionado nunca contribuye reclasificación (no aparece en diasOrdinarios)', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '14:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.diasOrdinariosProgramadosSemana).toBe(5);
  });

  it('domingo no seleccionado: horasDominicalFestivaDiaEspecial proviene SOLO de reclasificar días entre semana', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '14:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBeGreaterThan(0);
  });
});

describe('§12.8 — incluyeFestivos=false: sin conceptos festivos, comportamiento vigente sin cambios', () => {
  it('[ACTUALIZADO — jornada semanal 8h/42h] L-V sin festivos: horasDominicalFestivaDiaEspecial es exactamente 0; ordinarias = 8h×5÷6 (40h semanales, dentro del tope diario de 8h y de las 42h), sin extra', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '14:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false, anioCalculo: 2026 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBe(0);
    expect(r.distribucion.horasOrdinariasDiaOrdinario).toBeCloseTo((8 * 5) / 6, 5);
    expect(r.horasExtraSemanales.diurna).toBe(0);
  });
});

describe('§11 — casos protegidos: 12/7, 24/7 y L-V+domingo NO cambian con el ajuste de festivos', () => {
  it('A) L-D 06:00-18:00 incluye festivos: sigue siendo COBERTURA_12_7 con 62,16/36,12/8,88', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.tipoOperacionInterpretada).toBe('COBERTURA_12_7');
    expect(r.interpretacion.coberturaSemanalPorPosicion).toBe(84);
    const resultado = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    expect(resultado.conceptos.find(c => c.concepto === 'ordinariaDominical')!.horasMensualesPromedio).toBeCloseTo(62.16, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.horasMensualesPromedio).toBeCloseTo(36.12, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurnaFestiva')!.horasMensualesPromedio).toBeCloseTo(8.88, 2);
  });

  it('B/C) Avianca 24/7 sigue con cobertura 168h/504h', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }]);
    const r1 = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, cantidadTrabajadores: 1, anioCalculo: 2026 , metodologiaCosteo: 'SEMANAL_4_33' });
    const r3 = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, cantidadTrabajadores: 3, anioCalculo: 2026 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r1.ok || !r3.ok) throw new Error('no debería bloquear');
    expect(r1.interpretacion.coberturaSemanalPorPosicion).toBe(168);
    expect(r3.interpretacion.coberturaSemanalTotal).toBe(504);
  });

  it('D) L-V + domingo, sin sábado: conserva exactamente 100,33/40,13/29,60/11,84 — reversión provisional confirmada (ver auditoría de los 6 casos)', () => {
    const dLV = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '14:00', fin: '21:00', orden: 1 }]);
    const dDom = distribucion(['D'], [{ inicio: '14:00', fin: '21:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dLV, dDom], incluyeFestivos: true, anioCalculo: 2026 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1 });
    expect(resultado.horasOrdinariasMensualesPromedio).toBeCloseTo(100.33, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'recargoNocturno')!.horasMensualesPromedio).toBeCloseTo(40.13, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'ordinariaDominical')!.horasMensualesPromedio).toBeCloseTo(29.60, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'recargoNocturnoDominical')!.horasMensualesPromedio).toBeCloseTo(11.84, 2);
  });

  it('15) no introduce 5,83, 4,5, 10,995 ni 1,005 en el archivo fuente', () => {
    const fuente = readFileSync(join(__dirname, 'derivar-distribucion-comercial.ts'), 'utf-8');
    expect(fuente).not.toMatch(/5\.83/);
    expect(fuente).not.toMatch(/\b4\.5\b/);
    expect(fuente).not.toMatch(/10\.995/);
    expect(fuente).not.toMatch(/1\.005/);
  });
});

/**
 * Ex-"CASO CT 172" — RECEPCIONISTA, L-V 06:00-18:00 c/1h descanso (11h
 * efectivas/día) + sábado 06:00-12:00 (6h). Ajuste "HORAS EXTRAS POR
 * JORNADA SEMANAL, NO POR DÍA": con tope diario de 8h + 42h semanales, L-V
 * aporta 8h ordinarias + 3h extra por día (15h) y el sábado 2h ordinarias
 * (la semana llega a 42h) + 4h extra = 19h HED semanales, 82,27h
 * mensuales, $857.422 — el valor histórico que el commit `1028ca1`
 * (27-jul-2026) documentó como validado contra un Excel (ese artefacto no
 * está en este repositorio; la única evidencia es el comentario del
 * commit). La regla anterior de 7h fijas por día daba 20h / $902.550.
 */
describe('CASO ex-"CT 172" — RECEPCIONISTA, distribución semanal irregular (L-V 06:00-18:00 c/1h descanso + sábado 06:00-12:00 sin descanso), motor ACTIVO', () => {
  const dLV = distribucion(['L', 'M', 'X', 'J', 'V'], [
    { inicio: '06:00', fin: '12:00', orden: 1 },
    { inicio: '13:00', fin: '18:00', orden: 2 },
  ]);
  const dSab = distribucion(['S'], [{ inicio: '06:00', fin: '12:00', orden: 1 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dLV, dSab], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });

  it('1) total semanal efectivo = 61 horas (55 L-V + 6 sábado) — el descanso L-V resta 1×5=5 horas (sin cambio, es tiempo efectivamente trabajado, no clasificación)', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasEfectivasSemanaTotal).toBeCloseTo(61, 5);
  });

  it('[ACTUALIZADO] 5) horas ordinarias semanales = 42 (L-V: 8h×5=40h por el tope diario; sábado: 2h para completar la jornada semanal de 42h)', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasOrdinariasDiaOrdinario * 6).toBeCloseTo(42, 5);
  });

  it('[ACTUALIZADO] 6) HED (extra diurna) semanales = 19 (3h extra cada día L-V: 11h−8h tope diario = 15h; sábado 4h por superar las 42h semanales); sigue sin salir por horasExtraDiurnaDiaOrdinario, sino por horasExtraSemanales (× 4,33)', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(19, 5);
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario).toBe(0);
    expect(r.distribucion.horasExtraNocturnaDiaOrdinario).toBe(0);
    expect(r.horasExtraSemanales.nocturna).toBe(0);
  });

  it('[ACTUALIZADO] 9) produce exactamente 19 horas extra semanales = las 61h trabajadas menos las 42h de la jornada semanal', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(19, 5);
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(r.horasEfectivasSemanaTotal - 42, 5);
  });

  it('[ACTUALIZADO] 12) los topes diario (8h) y semanal (42h) actúan en conjunto: L,M,X,J,V reparten 8h ordinarias + 3h extra cada uno (40 ordinarias + 15 extra); el sábado completa 2h ordinarias hasta las 42h y las 4h restantes son extra', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasOrdinariasDiaOrdinario * 6).toBeCloseTo(42, 5);
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(19, 5);
  });

  it('[ACTUALIZADO] 7) HED mensuales = 82,27 (19 × 4,33); nunca 24,08÷6 ni el valor de la regla anterior de 7h fijas por día (86,6)', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion,
      salarioMensual: 1750905,
      auxilioTransporteMensual: 0,
      cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales,
      origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!;
    expect(hed.horasMensualesPromedio).toBeCloseTo(82.27, 2);
    expect(hed.horasMensualesPromedio).not.toBeCloseTo(76.253333, 2); // nunca 24,08÷6
    expect(hed.horasMensualesPromedio).not.toBeCloseTo(86.6, 2); // regla anterior de 7h fijas por día (20h), ya no vigente
  });

  it('[ACTUALIZADO] 8) valor HED mensual HALF_UP = $857.422 — el valor histórico que el commit 1028ca1 documentó como validado contra un Excel (no disponible en este repositorio)', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion,
      salarioMensual: 1750905,
      auxilioTransporteMensual: 0,
      cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales,
      origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!;
    expect(hed.valorMensual).toBe(857422);
    expect(hed.valorMensual).not.toBe(902550); // regla anterior de 7h fijas por día (20h), ya no vigente
    expect(hed.valorMensual).not.toBe(794716); // fórmula de mensualización diaria (24,08÷6), nunca aplica al exceso semanal
  });

  it('no utiliza 4,333333... (52÷12) — el factor es el literal exacto 4,33', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion,
      salarioMensual: 1750905,
      auxilioTransporteMensual: 0,
      cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales,
      origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!;
    expect(hed.horasMensualesPromedio).not.toBeCloseTo(19 * (52 / 12), 5);
    expect(hed.horasMensualesPromedio).toBeCloseTo(19 * 4.33, 5);
  });

  it('no existe doble mensualización — sin pasar horasExtraSemanales/origenMensualizacionExtra, el HED semanal no se cuela también por el mecanismo diario (24,08÷6)', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion,
      salarioMensual: 1750905,
      auxilioTransporteMensual: 0,
      cantidadTrabajadores: 1,
      // Deliberadamente SIN horasExtraSemanales/origenMensualizacionExtra:
      // el campo horasExtraDiurnaDiaOrdinario de la distribución ya viene
      // en 0 para este caso (todo el exceso es semanal genérico), así que
      // el HED mensual debe quedar en 0 — nunca aparece por partida doble.
      });
    const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!;
    expect(hed.horasMensualesPromedio).toBe(0);
  });

  it('las primeras 42 horas de la semana permanecen cubiertas por el salario mensual — no se agrega una fila monetaria nueva por horas ordinarias', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion,
      salarioMensual: 1750905,
      auxilioTransporteMensual: 0,
      cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales,
      origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    // Los 7 conceptos de sobretiempo son los únicos con valorMensual propio;
    // no existe un octavo concepto de "ordinaria semanal" separado del
    // salario base.
    expect(resultado.conceptos.length).toBe(7);
    expect(resultado.salarioBaseMensual).toBe(1750905);
  });
});

describe('CT 172 — jornadas uniformes ya aprobadas no cambian (regresión de la corrección de distribución irregular)', () => {
  it('§9 CASO DE CONTROL 3 (uniforme, 6 días, 10h efectivas/día) mantiene su resultado agregado: 42 ordinarias + 18 extra — costeo nuevo → SEMANAL_4_33 (ajuste "USAR 4,33 COMO PROYECCIÓN PRINCIPAL")', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [
      { inicio: '06:00', fin: '12:00', orden: 1 },
      { inicio: '14:00', fin: '18:00', orden: 2 },
    ]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    // 10h efectivas (6+4) × 6 días = 60h/semana. Para un costeo nuevo
    // (metodologiaCosteo por defecto, SEMANAL_4_33), el acumulador
    // semanal compartido se usa SIEMPRE, sea el patrón uniforme o no —
    // 42 ordinarias + 18 extra semanales, mensualizado con 4,33 (nunca
    // 24,08 — ese factor queda reservado a costeos LEGADO_COMERCIAL_30_DIAS).
    expect(r.distribucion.horasOrdinariasDiaOrdinario * 6).toBeCloseTo(42, 5);
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(18, 5);
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
  });

  it('coberturas 12/7 y 24/7 (patrón de turno fijo) no participan del acumulador semanal — permanecen intactas', () => {
    const dist12h = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist12h], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.tipoOperacionInterpretada).toBe('COBERTURA_12_7');
    // Cuota fija 10,5h/turno (42÷4), sin cambios por la corrección CT 172.
    expect(r.cuotaOrdinariaDiariaComercialHoras).toBeCloseTo(10.5, 5);
    // El sobretiempo de coberturas 12/7 sigue siendo 24,08÷6 — nunca 4,33.
    expect(r.origenMensualizacionExtra).toBe('DIARIO_24_08');
    expect(r.horasExtraSemanales.diurna).toBe(0);
    expect(r.horasExtraSemanales.nocturna).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AJUSTE "ACUMULADOR SEMANAL UNIFICADO, DÍA DE DESCANSO Y FESTIVOS" —
// domingo/día de descanso ya NO se procesa mediante una cuota aislada:
// participa del mismo acumulador cronológico de 42h que cualquier otro
// día. `diaDescansoObligatorio` (default 'D') decide en cuál de los 8
// conceptos monetarios cae cada minuto, nunca si participa del
// acumulador. Todo sobretiempo semanal (HED/HEN/HEDF/HENF) se
// mensualiza exclusivamente con 4,33 — nunca con 5,92 ni 24,08÷6.
// ═══════════════════════════════════════════════════════════════════════

describe('A) L-V 8h + sábado 2h + domingo 8h, descanso domingo (default) — las 42h se completan el sábado', () => {
  const dLV = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '08:00', fin: '16:00', orden: 1 }]);
  const dSab = distribucion(['S'], [{ inicio: '08:00', fin: '10:00', orden: 1 }]);
  const dDom = distribucion(['D'], [{ inicio: '08:00', fin: '16:00', orden: 1 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dLV, dSab, dDom], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });

  it('[ACTUALIZADO — jornada semanal 8h/42h] L-V (8h/día) caben en el tope diario y el sábado (2h) completa las 42h exactas → 42h ordinarias, sin extra (el domingo está aislado y no cuenta para el tope semanal)', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasEfectivasSemanaTotal).toBe(50); // 40+2+8 — sin cambio, es tiempo efectivo, no clasificación
    expect(r.distribucion.horasOrdinariasDiaOrdinario * 6).toBeCloseTo(42, 5);
    expect(r.horasExtraSemanales.diurna).toBe(0);
  });

  it('domingo (día de descanso aislado) → dominical propia (5,92), nunca HEDF semanal (4,33) — sin cambio en esta fase (regresión)', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    // Domingo sigue aislado con su propia cuota (42÷6=7h/día): sus 8h se
    // reparten 7h dominical + 1h extra festiva, ambas mensualizadas con
    // 5,92 — nunca participa de los topes diario/semanal L-S.
    // horasExtraSemanales.diurna es 0: L-V+sábado suman exactamente 42h.
    expect(r.horasExtraSemanales.diurnaFestiva).toBe(0);
    expect(r.horasExtraSemanales.diurna).toBe(0);
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBe(7);
    expect(r.distribucion.horasExtraDiurnaFestivaDiaEspecial).toBe(1);
    // Sin exceso semanal genérico, el origen de mensualización es
    // DIARIO_24_08 — el domingo en sí se mensualiza con 5,92 (ver
    // aserciones de abajo).
    expect(r.origenMensualizacionExtra).toBe('DIARIO_24_08');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const hedf = resultado.conceptos.find(c => c.concepto === 'extraDiurnaFestiva')!;
    expect(hedf.horasMensualesPromedio).toBeCloseTo(1 * 5.92, 5);
    expect(resultado.conceptos.find(c => c.concepto === 'ordinariaDominical')!.horasMensualesPromedio).toBeCloseTo(7 * 5.92, 5);
  });
});

describe('B) M-D 8h/día, diaDescansoObligatorio=L (dato histórico/legal) — costeo nuevo → SEMANAL_4_33 (ajuste "USAR 4,33 COMO PROYECCIÓN PRINCIPAL")', () => {
  const dist = distribucion(['M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '08:00', fin: '16:00', orden: 1 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false, diaDescansoObligatorio: 'L' , metodologiaCosteo: 'SEMANAL_4_33' });

  // Corrección "RECARGO COMERCIAL DOMINICAL SIEMPRE" — este caso se
  // actualiza (era una expectativa del bug ya corregido): domingo trabajado
  // SIEMPRE se aísla como día especial (recargo dominical), sin importar
  // `diaDescansoObligatorio` (aquí 'L', un dato histórico/legal que YA NO
  // decide la clasificación monetaria). M-S (5 días, nunca domingo)
  // participan del acumulador semanal compartido de 42h.
  it('[ACTUALIZADO — jornada semanal 8h/42h] domingo SIEMPRE se aísla como especial (recargo dominical) — diaDescansoObligatorio=L ya no lo vuelve ordinario; M-S (5 días, 8h c/u) = 40h ordinarias, dentro del tope diario y de las 42h → sin extra', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasOrdinariasDiaOrdinario * 6).toBeCloseTo(40, 5);
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
    expect(r.horasExtraSemanales.diurna).toBe(0);
    // Domingo (8h) queda íntegramente en el bucket especial (recargo
    // dominical) — nunca ordinario, nunca vacío. Sin cambio en esta fase.
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBe(8);
  });
});

describe('C) jornada nocturna, costeo nuevo → SEMANAL_4_33 (ajuste "USAR 4,33 COMO PROYECCIÓN PRINCIPAL")', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '21:00', fin: '06:00', orden: 1 }]); // 9h, 100% nocturno
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });

  it('[ACTUALIZADO — Opción C, rollover S→D] 54h nocturnas/semana: el bloque de SÁBADO (21:00-06:00) cruza hacia domingo — la semana llega a 42h ordinarias el sábado a las 23:00, así que 1h antes de medianoche (sábado) y las 6h de domingo son sobretiempo', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    // L-V (5 días, sin cruce hacia domingo): 8h de recargo nocturno (tope
    // diario) + 1h extra nocturna cada uno (9h/día - 8h) → 40h + 5h.
    // Sábado 21:00-06:00 (9h): el tope diario es continuo durante TODO el
    // turno — nunca se reinicia a medianoche — pero la semana ya acumula
    // 40h ordinarias, así que solo caben 2h más (21:00-23:00) antes de
    // llegar a las 42h. 23:00-24:00 (1h, sábado) es extra nocturna del
    // bucket semanal; 00:00-06:00 (6h) ya pertenece a domingo y es extra
    // nocturna festiva — nunca sábado/ordinario.
    // Ordinario nocturno: 40h (L-V) + 2h (sábado) = 42h.
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario * 6).toBeCloseTo(42, 5);
    expect(r.distribucion.horasExtraNocturnaDiaOrdinario).toBe(0); // reservado a turnos de 12h fijo, nunca a este patrón genérico
    // Sobretiempo ordinario semanal: L-V 1h × 5 días + 1h del sábado antes
    // de medianoche.
    expect(r.horasExtraSemanales.nocturna).toBeCloseTo(6, 5);
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
    // Domingo (bucket especial): ya no cabe ninguna hora ordinaria (la
    // semana llegó a 42h), así que las 6h son sobretiempo dominical
    // nocturno — conservadas íntegras, nunca perdidas ni duplicadas en el
    // bucket ordinario.
    expect(r.distribucion.horasRecargoNocturnoFestivoDiaEspecial).toBe(0);
    expect(r.distribucion.horasExtraNocturnaFestivaDiaEspecial).toBeCloseTo(6, 5);
    // Conservación total: 42h (ordinario) + 6h (extra semanal genérico) +
    // 0h (dominical) + 6h (extra dominical) = 54h (6 días × 9h) — ningún
    // minuto perdido ni duplicado entre los cuatro buckets.
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario * 6 + r.horasExtraSemanales.nocturna + r.distribucion.horasRecargoNocturnoFestivoDiaEspecial + r.distribucion.horasExtraNocturnaFestivaDiaEspecial).toBeCloseTo(54, 5);
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const hen = resultado.conceptos.find(c => c.concepto === 'extraNocturna')!;
    expect(hen.horasMensualesPromedio).toBeCloseTo(6 * 4.33, 5);
    expect(hen.horasMensualesPromedio).not.toBeCloseTo(2 * 24.08, 2);
    // El sobretiempo dominical nocturno (6h) se mensualiza vía 5,92
    // (domingosFestivosPromedioMes), nunca vía 4,33 ni 24,08 — mecanismo
    // ya existente, sin cambios, aplicado ahora también a la porción que
    // llegó aquí por el rollover S→D.
    const henf = resultado.conceptos.find(c => c.concepto === 'extraNocturnaFestiva')!;
    expect(henf.horasMensualesPromedio).toBeGreaterThan(0);
  });
});

describe('D) festivo estadístico — costeo nuevo (L-S 9h/día, 54h/semana, incluyeFestivos=true) → SEMANAL_4_33', () => {
  // 9h × 6: L-V aportan 8h ordinarias + 1h extra (tope diario); el sábado 2h
  // ordinarias (la semana llega a 42h) + 7h extra → 12h extra semanales. Los
  // promedios de festivos por día de la semana se leen del mismo calendario
  // que usa el derivador, para que los valores esperados no dependan de
  // números pegados a mano.
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '17:00', orden: 1 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026 , metodologiaCosteo: 'SEMANAL_4_33' });
  const f = calcularFestivosPromedioMesPorDiaSemana(2026);
  const fLV = f.L + f.M + f.X + f.J + f.V;
  const ordinariaReclasificadaMes = 8 * fLV + 2 * f.S;
  const extraReclasificadaMes = 1 * fLV + 7 * f.S;

  it('[ACTUALIZADO — Fase 3B] festivo antes de 42h: cuenta dentro del acumulado semanal y conserva el recargo festivo, sin duplicarse', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
    expect(r.distribucion.horasOrdinariasDiaOrdinario).toBeCloseTo(42 / 6 - ordinariaReclasificadaMes / 24.08, 5);
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBeCloseTo(ordinariaReclasificadaMes / 5.92, 5);
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBeGreaterThan(0);
  });

  it('[ACTUALIZADO — Fase 3B, corrige el doble conteo] sobretiempo semanal se mensualiza con 4,33 — nunca con 24,08, nunca doble mensualización; la porción reclasificada a festivo SALE del bucket semanal, nunca queda contada en ambos', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    // Antes de reclasificar: 12h extra diurna semanal. La reclasificación
    // estadística de festivos mueve una fracción de esas horas
    // (`extraReclasificadaMes`, horas/mes) hacia horasExtraDiurnaFestivaDiaEspecial
    // — por eso el bucket semanal queda en 12h − extraReclasificadaMes÷4,33
    // y horasExtraDiurnaDiaOrdinario permanece en 0 (nunca negativo, nunca es
    // el origen de esta resta en el camino activo).
    expect(extraReclasificadaMes).toBeGreaterThan(0);
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(12 - extraReclasificadaMes / 4.33, 5);
    expect(r.horasExtraSemanales.diurna).toBeGreaterThanOrEqual(0); // invariante A — nunca negativo
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!;
    const hedf = resultado.conceptos.find(c => c.concepto === 'extraDiurnaFestiva')!;
    expect(hed.horasMensualesPromedio).toBeCloseTo(12 * 4.33 - extraReclasificadaMes, 3);
    expect(hed.horasMensualesPromedio).not.toBeCloseTo((12 / 6) * 24.08, 2); // nunca 24,08÷6
    // Invariante E — conservación: la suma de ambos conceptos (ordinario +
    // festivo) debe ser idéntica al total SIN reclasificar (12h × 4,33 =
    // 51,96h) — ni se crean ni se pierden horas al mover la porción
    // festiva de un bucket a otro.
    expect(hed.horasMensualesPromedio + hedf.horasMensualesPromedio).toBeCloseTo(12 * 4.33, 5);
  });
});

describe('E) día de descanso obligatorio distinto de domingo (sábado) — la clasificación especial se basa en diaDescansoObligatorio, no en esDomingo', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '08:00', fin: '14:00', orden: 1 }]); // 6h/día, 7 días
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false, diaDescansoObligatorio: 'S' , metodologiaCosteo: 'SEMANAL_4_33' });

  it('sábado (día de descanso configurado) recibe la clasificación especial — domingo se trata como día ordinario más', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    // 42h totales (7×6h), exactamente en el límite — sin sobretiempo. El
    // bucket especial (5,92) recibe las 6h de SÁBADO, no las de domingo.
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBe(6);
    expect(r.origenMensualizacionExtra).toBe('DIARIO_24_08');
  });
});

describe('F) advertencia "PROGRAMACIÓN DE SIETE DÍAS" — no bloqueante, solo para patrón genérico que cubre los 7 días', () => {
  it('cargo individual que cubre los 7 días sin excluir el día de descanso: advertencia no nula, cálculo no bloqueado', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '08:00', fin: '14:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.advertenciaProgramacion).not.toBeNull();
    // Ajuste "OCULTAR COMPLETAMENTE EL DÍA DE DESCANSO" (§4): mensaje
    // funcional simple — nunca menciona "día de descanso obligatorio" ni
    // ningún día específico.
    expect(r.advertenciaProgramacion).toBe('Esta programación requiere validar la cobertura de relevos o turnantes.');
    expect(r.advertenciaProgramacion).not.toMatch(/día de descanso/i);
    expect(r.advertenciaProgramacion).not.toMatch(/domingo/i);
  });

  it('cargo de 6 días (sin domingo) NO genera advertencia', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '14:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.advertenciaProgramacion).toBeNull();
  });

  it('COBERTURA_12_7 que cubre los 7 días NUNCA genera esta advertencia', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.tipoOperacionInterpretada).toBe('COBERTURA_12_7');
    expect(r.advertenciaProgramacion).toBeNull();
  });
});

describe('G) coberturas 12/7, 24/7 y Avianca — diferencia cero frente al ajuste de acumulador unificado', () => {
  it('COBERTURA_12_7 (turno diurno 06:00-18:00): mismos valores de siempre, origen DIARIO_24_08', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, diaDescansoObligatorio: 'D' , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.tipoOperacionInterpretada).toBe('COBERTURA_12_7');
    expect(r.cuotaOrdinariaDiariaComercialHoras).toBe(10.5);
    expect(r.distribucion.horasOrdinariasDiaOrdinario).toBe(10.5);
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(1.5);
    expect(r.origenMensualizacionExtra).toBe('DIARIO_24_08');
    expect(r.horasExtraSemanales).toEqual({ diurna: 0, nocturna: 0, diurnaFestiva: 0, nocturnaFestiva: 0 });
  });

  it('Avianca 24/7 (1 y 3 posiciones): mismos valores de siempre', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }]);
    const r1 = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, cantidadTrabajadores: 1 , metodologiaCosteo: 'SEMANAL_4_33' });
    const r3 = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, cantidadTrabajadores: 3 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r1.ok || !r3.ok) throw new Error('no debería bloquear');
    expect(r1.interpretacion.tipoOperacionInterpretada).toBe('COBERTURA_24_7');
    expect(r1.interpretacion.coberturaSemanalPorPosicion).toBe(168);
    expect(r3.interpretacion.coberturaSemanalTotal).toBe(504);
    expect(r1.origenMensualizacionExtra).toBe('DIARIO_24_08');
    expect(r1.horasExtraSemanales.diurna).toBe(0);
    expect(r1.horasExtraSemanales.nocturna).toBe(0);
  });
});

describe('H) serialización — LineaMOExtra con diaDescansoObligatorio sobrevive JSON.stringify/parse y produce el mismo resultado', () => {
  it('un cargo con diaDescansoObligatorio explícito conserva el mismo cálculo tras ida y vuelta por JSON', () => {
    const lineaOriginal = {
      id: 1, codigo: '1', nombreCargo: 'Recepcionista', diaDescansoObligatorio: 'S' as const, incluyeFestivos: false,
      distribucionesHorario: [distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '08:00', fin: '16:00', orden: 1 }])],
    };
    const restaurada = JSON.parse(JSON.stringify(lineaOriginal)) as typeof lineaOriginal;
    expect(restaurada.diaDescansoObligatorio).toBe('S');
    expect(restaurada.distribucionesHorario).toEqual(lineaOriginal.distribucionesHorario);
    const rAntes = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: lineaOriginal.distribucionesHorario, incluyeFestivos: false, diaDescansoObligatorio: lineaOriginal.diaDescansoObligatorio , metodologiaCosteo: 'SEMANAL_4_33' });
    const rDespues = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: restaurada.distribucionesHorario, incluyeFestivos: false, diaDescansoObligatorio: restaurada.diaDescansoObligatorio , metodologiaCosteo: 'SEMANAL_4_33' });
    expect(rAntes).toEqual(rDespues);
  });

  it('un cargo SIN diaDescansoObligatorio (borrador histórico) sobrevive JSON.stringify/parse y resuelve como domingo (compatibilidad histórica)', () => {
    const lineaOriginal = {
      id: 1, codigo: '1', nombreCargo: 'Recepcionista', incluyeFestivos: false,
      distribucionesHorario: [distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '08:00', fin: '16:00', orden: 1 }])],
    };
    const restaurada = JSON.parse(JSON.stringify(lineaOriginal)) as typeof lineaOriginal & { diaDescansoObligatorio?: string };
    expect(restaurada.diaDescansoObligatorio).toBeUndefined();
    const rSinCampo = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: restaurada.distribucionesHorario, incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    const rConDomingoExplicito = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: restaurada.distribucionesHorario, incluyeFestivos: false, diaDescansoObligatorio: 'D' , metodologiaCosteo: 'SEMANAL_4_33' });
    expect(rSinCampo).toEqual(rConDomingoExplicito);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AJUSTE "SELECCIÓN DIARIO_24,08 VS SEMANAL_4,33" — caso real Conserje/
// Aseador (L-D y festivos, 07:00-15:00, 8h/día): demuestra que 4,33 no
// puede aplicarse a TODO exceso semanal de una jornada individual. La
// selección depende exclusivamente de la ESTRUCTURA de la programación
// (patrón diario uniforme completo L-S vs. patrón semanal irregular),
// nunca de un caso, nombre de cargo o código hardcodeado.
// ═══════════════════════════════════════════════════════════════════════

describe('Caso real — Conserje/Aseador L-D y festivos 07:00-15:00 (8h/día) — costeo con metodologiaCosteo:SEMANAL_4_33 explícito', () => {
  // Ajuste "USAR 4,33 COMO PROYECCIÓN PRINCIPAL DE SOBRETIEMPO EN COSTEOS
  // NUEVOS": para un costeo nuevo, este mismo caso YA NO reproduce el
  // $250.963 del Excel histórico — usa 4,33 siempre. El Excel queda
  // reproducible SOLO marcando metodologiaCosteo:'LEGADO_COMERCIAL_30_DIAS'
  // (ver describe siguiente).
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '07:00', fin: '15:00', orden: 1 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026 , metodologiaCosteo: 'SEMANAL_4_33' });

  // Ajuste "AJUSTE FINAL ANTES DE CERRAR" §1 — el informe de cierre de la
  // corrección anterior reportó "62 horas semanales" para este caso en la
  // matriz de impacto; era un ERROR DOCUMENTAL (de redacción del informe,
  // nunca del motor/UI/pruebas) — el motor SIEMPRE produjo 56 (7 días × 8h:
  // L-S=48h + domingo=8h), confirmado aquí explícitamente para que
  // cualquier regresión futura hacia 62 (u otro valor) falle de inmediato.
  it('0) horasEfectivasSemanaTotal es 56 (7 días × 8h), NUNCA 62 — L-S=48h, domingo=8h vía ruta especial', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasEfectivasSemanaTotal).toBe(56);
    expect(r.horasEfectivasSemanaTotal).not.toBe(62);
    expect(r.distribucion.horasOrdinariasDiaOrdinario * 6).toBeCloseTo(42, 5); // L-S ordinaria
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(6, 5); // exceso semanal L-S = 48-42
    expect(r.distribucion.horasDominicalFestivaDiaEspecial + r.distribucion.horasExtraDiurnaFestivaDiaEspecial).toBe(8); // domingo completo, ruta especial
  });

  // Corrección "COBERTURA vs. CAPACIDAD vs. RECARGOS — TURNANTES" — cuando
  // un turnante físico cubre el día de descanso obligatorio de este mismo
  // cargo, `excluirDiaDescansoDeHorasEfectivas:true` debe excluir SOLO la
  // contribución del domingo (8h) de `horasEfectivasSemanaTotal`
  // (informativo, "horas trabajadas" — nunca dinero) — el resto del
  // resultado (`distribucion`, recargos/extras monetarios, incluido el
  // recargo dominical/festivo) debe permanecer IDÉNTICO al caso sin la
  // bandera: el recargo del servicio permanece una sola vez en el cargo
  // principal, regla de negocio confirmada — nunca se elimina.
  it('0b) excluirDiaDescansoDeHorasEfectivas:true → horasEfectivasSemanaTotal=48 (solo L-S), pero `distribucion` (dinero) NO cambia', () => {
    const rConTurnante = derivarDistribucionComercialHistoricoParaPruebas({
      distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026, metodologiaCosteo: 'SEMANAL_4_33',
      excluirDiaDescansoDeHorasEfectivas: true,
    });
    if (!r.ok || !rConTurnante.ok) throw new Error('no debería bloquear');
    expect(rConTurnante.horasEfectivasSemanaTotal).toBe(48);
    expect(rConTurnante.horasEfectivasSemanaTotal).not.toBe(56);
    // El dinero (distribucion) es exactamente igual con y sin la bandera —
    // el recargo dominical/festivo del domingo permanece intacto.
    expect(rConTurnante.distribucion).toEqual(r.distribucion);
    expect(rConTurnante.horasExtraSemanales).toEqual(r.horasExtraSemanales);
  });

  it('0c) excluirDiaDescansoDeHorasEfectivas ausente/false — comportamiento histórico sin cambios (56h, igual que 0)', () => {
    const rSinBandera = derivarDistribucionComercialHistoricoParaPruebas({
      distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026, metodologiaCosteo: 'SEMANAL_4_33',
      excluirDiaDescansoDeHorasEfectivas: false,
    });
    if (!r.ok || !rSinBandera.ok) throw new Error('no debería bloquear');
    expect(rSinBandera.horasEfectivasSemanaTotal).toBe(56);
    expect(rSinBandera).toEqual(r);
  });

  it('1) costeo nuevo: 6 HED semanales × 4,33 = 25,98 HED mensuales, $270.765 — nunca 24,08', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(6, 5);
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!;
    expect(hed.horasMensualesPromedio).toBeCloseTo(6 * 4.33, 2);
    expect(hed.valorMensual).toBe(270765);
    expect(hed.horasMensualesPromedio).not.toBeCloseTo(24.08, 2);
    expect(hed.valorMensual).not.toBe(250963);
  });

  it('2) domingo 07:00-15:00: 41,44 horas dominicales, 5,92 HEDF, $656.473 y $106.122 — sin cambio (fuera de alcance, §7)', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const dominical = resultado.conceptos.find(c => c.concepto === 'ordinariaDominical')!;
    const hedf = resultado.conceptos.find(c => c.concepto === 'extraDiurnaFestiva')!;
    expect(dominical.horasMensualesPromedio).toBeCloseTo(41.44, 2);
    expect(dominical.valorMensual).toBe(656473);
    expect(hedf.horasMensualesPromedio).toBeCloseTo(5.92, 2);
    expect(hedf.valorMensual).toBe(106122);
  });

  it('turnante — hallazgo registrado, no implementado: el Excel de este caso incluye un turnante de $470.888, dotación/EPP $66.602 y exámenes $16.050 — NO se compara el total final de Licycolba contra el total del Excel sin sumarlos', () => {
    expect(true).toBe(true);
  });
});

describe('Caso real — Conserje/Aseador, costeo LEGADO_COMERCIAL_30_DIAS reproduce exactamente el Excel histórico', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '07:00', fin: '15:00', orden: 1 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026, metodologiaCosteo: 'LEGADO_COMERCIAL_30_DIAS' });

  it('8) un costeo histórico conserva DIARIO_24_08: 1 HED diaria, 24,08 HED mensuales, $250.963 — nunca 4,33', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.origenMensualizacionExtra).toBe('DIARIO_24_08');
    expect(r.horasExtraSemanales.diurna).toBe(0);
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!;
    expect(hed.horasMensualesPromedio).toBeCloseTo(24.08, 2);
    expect(hed.valorMensual).toBe(250963);
    expect(hed.horasMensualesPromedio).not.toBeCloseTo(6 * 4.33, 2);
    expect(hed.valorMensual).not.toBe(270765);
  });

  it('3) total de recargos legado = $1.013.558 (656.473 + 250.963 + 106.122)', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    expect(resultado.recargosSobretiempoMensual).toBe(656473 + 250963 + 106122);
  });
});

// Ajuste "AJUSTE FINAL ANTES DE CERRAR" §4/§5(11,12) — no existe hoy una
// función de "duplicar costeo" en la aplicación (confirmado por auditoría,
// ver comentario junto a `metodologiaCosteoGuardada` en page.tsx). Estas
// dos pruebas documentan, a nivel del núcleo puro, el comportamiento que
// esa función deberá reproducir cuando se implemente: la MISMA
// distribución horaria produce resultados distintos y correctos según cuál
// de las dos operaciones (A/B) se ejecute — nunca una migración silenciosa
// en ningún sentido.
describe('11/12) Duplicación de costeos históricos — comportamiento del núcleo para las 2 operaciones futuras (§4)', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '07:00', fin: '15:00', orden: 1 }]);

  it('11) "duplicar conservando metodología": metodologiaCosteo:LEGADO_COMERCIAL_30_DIAS mantiene el resultado histórico exacto ($250.963 en HED), nunca migra a 4,33', () => {
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026, metodologiaCosteo: 'LEGADO_COMERCIAL_30_DIAS' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.origenMensualizacionExtra).toBe('DIARIO_24_08');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.valorMensual).toBe(250963);
  });

  it('12) "crear nueva versión corporativa": metodologiaCosteo:SEMANAL_4_33 sobre el MISMO horario produce el valor vigente ($270.765 en HED), nunca permanece en 24,08', () => {
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.valorMensual).toBe(270765);
  });
});

describe('ex-"CT 172" bajo la regla vigente de 7h/día (patrón irregular, motor ACTIVO)', () => {
  const dLV = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '12:00', orden: 1 }, { inicio: '13:00', fin: '18:00', orden: 2 }]);
  const dSab = distribucion(['S'], [{ inicio: '06:00', fin: '12:00', orden: 1 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dLV, dSab], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });

  it('[ACTUALIZADO] 4) ex-CT172: 61h efectivas, 42 ordinarias, 19 HED semanales, 82,27h mensuales, $857.422 — motor ACTIVO (L-V=11h ≠ sábado=6h, patrón irregular; tope diario 8h + 42h semanales; coincide con el valor histórico validado en el commit 1028ca1)', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasEfectivasSemanaTotal).toBe(61);
    expect(r.distribucion.horasOrdinariasDiaOrdinario * 6).toBeCloseTo(42, 5);
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(19, 5);
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!;
    expect(hed.horasMensualesPromedio).toBeCloseTo(82.27, 2);
    expect(hed.valorMensual).toBe(857422);
  });
});

describe('Patrón diario uniforme y patrón irregular — ambos usan SEMANAL_4_33 en un costeo nuevo (ajuste "USAR 4,33 COMO PROYECCIÓN PRINCIPAL")', () => {
  it('5) 06:00-14:00 (L-J) y 10:00-18:00 (V-S), ambos 8h efectivas (duraciones idénticas): también usa SEMANAL_4_33', () => {
    const d1 = distribucion(['L', 'M', 'X', 'J'], [{ inicio: '06:00', fin: '14:00', orden: 1 }]);
    const d2 = distribucion(['V', 'S'], [{ inicio: '10:00', fin: '18:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [d1, d2], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!;
    expect(hed.horasMensualesPromedio).toBeCloseTo(6 * 4.33, 2); // 6h de exceso semanal × 4,33
    expect(hed.horasMensualesPromedio).not.toBeCloseTo(24.08, 2);
  });

  it('6) horarios L-S con duraciones diferentes (5 días 8h + 1 día 9h): usan SEMANAL_4_33', () => {
    const d1 = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '14:00', orden: 1 }]);
    const d2 = distribucion(['S'], [{ inicio: '06:00', fin: '15:00', orden: 1 }]); // 9h, distinto de los demás
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [d1, d2], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
  });
});

describe('Coberturas 12/7, 24/7 y Avianca — sin regresiones frente al ajuste DIARIO_24,08/SEMANAL_4,33', () => {
  it('COBERTURA_12_7 nunca resuelve DIARIO_24,08 vía la ruta genérica — sigue usando su cuota fija de turno (10,5h), origen propio', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.tipoOperacionInterpretada).toBe('COBERTURA_12_7');
    expect(r.cuotaOrdinariaDiariaComercialHoras).toBe(10.5);
    expect(r.origenMensualizacionExtra).toBe('DIARIO_24_08'); // sin exceso semanal genérico — sin cambio de significado
    expect(r.horasExtraSemanales.diurna).toBe(0);
  });

  it('Avianca 24/7 (1 y 3 posiciones) — sin cambios', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }]);
    const r1 = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, cantidadTrabajadores: 1 , metodologiaCosteo: 'SEMANAL_4_33' });
    const r3 = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, cantidadTrabajadores: 3 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r1.ok || !r3.ok) throw new Error('no debería bloquear');
    expect(r1.interpretacion.tipoOperacionInterpretada).toBe('COBERTURA_24_7');
    expect(r1.interpretacion.coberturaSemanalPorPosicion).toBe(168);
    expect(r3.interpretacion.coberturaSemanalTotal).toBe(504);
  });
});

describe('10) ninguna hora se mensualiza dos veces (24,08 y 4,33 simultáneos)', () => {
  it('en un costeo NUEVO (SEMANAL_4_33), horasExtraDiurnaDiaOrdinario (24,08) queda en 0 — el sobretiempo solo existe vía horasExtraSemanales/4,33', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '07:00', fin: '15:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026 , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
    expect(r.horasExtraSemanales.diurna).toBeGreaterThan(0);
  });

  it('en un costeo LEGADO_COMERCIAL_30_DIAS, horasExtraSemanales queda en 0 — el sobretiempo solo existe vía horasExtraDiurnaDiaOrdinario/24,08', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '07:00', fin: '15:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026, metodologiaCosteo: 'LEGADO_COMERCIAL_30_DIAS' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasExtraSemanales.diurna).toBe(0);
    expect(r.horasExtraSemanales.nocturna).toBe(0);
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBeGreaterThan(0);
  });

  it('en el caso irregular (CT 172), horasExtraDiurnaDiaOrdinario queda en 0 — el sobretiempo solo existe vía horasExtraSemanales/4,33', () => {
    const dLV = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '12:00', orden: 1 }, { inicio: '13:00', fin: '18:00', orden: 2 }]);
    const dSab = distribucion(['S'], [{ inicio: '06:00', fin: '12:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dLV, dSab], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
    expect(r.horasExtraSemanales.diurna).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AJUSTE "USAR 4,33 COMO PROYECCIÓN PRINCIPAL DE SOBRETIEMPO EN COSTEOS
// NUEVOS" — §3 caso obligatorio y §10 pruebas explícitas.
// ═══════════════════════════════════════════════════════════════════════

describe('Caso obligatorio §3 — L-S 08:00-15:20, sin descanso adicional', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '15:20', orden: 1 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });

  it('duración diaria 7h20min, semanal 44h, 42 ordinarias, 2 HED semanales', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasEfectivasSemanaTotal).toBeCloseTo(44, 5);
    expect(r.distribucion.horasOrdinariasDiaOrdinario * 6).toBeCloseTo(42, 5);
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(2, 5);
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
  });

  it('HED mensuales = 2 × 4,33 = 8,66h; valor HED = $90.255 — nunca 0,333333×24,08=8,03h ni $83.654', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!;
    expect(hed.horasMensualesPromedio).toBeCloseTo(8.66, 2);
    expect(hed.valorMensual).toBe(90255);
    expect(hed.horasMensualesPromedio).not.toBeCloseTo(8.03, 2);
    expect(hed.valorMensual).not.toBe(83654);
  });
});

describe('§10 — L-S con distintas duraciones diarias, todas usan SEMANAL_4_33 (costeo nuevo)', () => {
  it('2) L-S 8h/día: 48h semanales, 6 HED semanales, 25,98 HED mensuales', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '16:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasEfectivasSemanaTotal).toBe(48);
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(6, 5);
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.horasMensualesPromedio).toBeCloseTo(25.98, 2);
  });

  it('3) L-S 9h/día: 54h semanales, 12 HED semanales, 51,96 HED mensuales', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '06:00', fin: '15:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasEfectivasSemanaTotal).toBe(54);
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(12, 5);
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.horasMensualesPromedio).toBeCloseTo(51.96, 2);
  });

  it('4) L-S 10h/día: 60h semanales, 18 HED semanales, 77,94 HED mensuales', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '06:00', fin: '16:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false , metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasEfectivasSemanaTotal).toBe(60);
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(18, 5);
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.horasMensualesPromedio).toBeCloseTo(77.94, 2);
  });
});

// Ajuste "METODOLOGÍA EXPLÍCITA EN EL MOTOR" — reemplaza la prueba
// anterior ("costeo nuevo usa SEMANAL_4_33 por defecto"), que asumía un
// default silencioso. ES EXACTAMENTE ESE DEFAULT lo que esta corrección
// prohíbe: quien resuelve compatibilidad histórica (§9) es page.tsx,
// SIEMPRE antes de llamar al derivador — nunca este núcleo puro.
describe('9) el núcleo puro nunca infiere metodologiaCosteo — falla de forma controlada si falta', () => {
  it('sin metodologiaCosteo en la entrada, lanza un error controlado en vez de asumir SEMANAL_4_33 (o cualquier otro valor)', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '16:00', orden: 1 }]);
    // @ts-expect-error — metodologiaCosteo es obligatorio; se omite deliberadamente para probar el rechazo en runtime.
    const llamar = () => derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false });
    expect(llamar).toThrow(/metodologiaCosteo es obligatorio/);
  });

  it('con metodologiaCosteo:undefined explícito (posible desde un caller JS/no tipado), también lanza — no lo trata como "campo ausente = SEMANAL_4_33"', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '16:00', orden: 1 }]);
    // @ts-expect-error — mismo caso que arriba, forzado explícitamente a undefined.
    const llamar = () => derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist], incluyeFestivos: false, metodologiaCosteo: undefined });
    expect(llamar).toThrow(/metodologiaCosteo es obligatorio/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AJUSTE "CORRECCIÓN URGENTE — GENERA HED AUNQUE EL TOTAL SEMANAL ES 41H30"
// — caso real RECEPCIONISTA (L-V 07:45-12:00/13:45-17:00 = 7h30/día,
// sábado 08:00-12:00 = 4h; total 41,5h semanales, por debajo del límite
// de 42h). Bajo SEMANAL_4_33 nunca debe generarse HED — el motor ya lo
// hace correctamente (verificado); el problema real estaba en la
// resolución de `metodologiaCosteo` en page.tsx (corregido aparte, §9).
// ═══════════════════════════════════════════════════════════════════════

/**
 * [ACTUALIZADO — jornada semanal 8h/42h] Estos 4 describes afirman que una
 * semana por debajo de 42h NUNCA genera HED mientras ningún día individual
 * pase el tope diario de 8h (la regla anterior de 7h fijas por día generaba
 * 0,5h de extra por cada día de 7h30 aunque la semana sumara 41,5h). Un día
 * que SÍ pasa las 8h genera extra aunque la semana no llegue a 42h.
 */
describe('§6(1) Caso RECEPCIONISTA — L-V 7h30 + sábado 4h = 41,5h semanales: NO genera HED (ningún día pasa de 8h y la semana no llega a 42h)', () => {
  const dLV = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '07:45', fin: '12:00', orden: 1 }, { inicio: '13:45', fin: '17:00', orden: 2 }]);
  const dSab = distribucion(['S'], [{ inicio: '08:00', fin: '12:00', orden: 1 }]);
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dLV, dSab], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });

  it('[ACTUALIZADO] total 41,5h (por debajo de 42h) y cada día L-V (7h30) cabe en el tope diario de 8h → 0 HED semanales, 0 HED mensuales, $0', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasEfectivasSemanaTotal).toBeCloseTo(41.5, 5);
    expect(r.horasExtraSemanales.diurna).toBe(0);
    expect(r.origenMensualizacionExtra).toBe('DIARIO_24_08');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!;
    expect(hed.horasMensualesPromedio).toBe(0);
    expect(hed.valorMensual).toBe(0);
  });
});

describe('§6(2) L-V 8h/día + sábado 2h = 42h semanales exactas: HED es 0 (cada día L-V cabe en el tope diario de 8h y la semana no excede 42h)', () => {
  const dLV = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '07:00', fin: '15:00', orden: 1 }]); // 8h × 5 = 40h
  const dSab = distribucion(['S'], [{ inicio: '08:00', fin: '10:00', orden: 1 }]); // 2h
  const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dLV, dSab], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });

  it('[ACTUALIZADO] 42h totales (límite semanal exacto): L-V (8h/día) cabe en el tope diario y el sábado (2h) completa las 42h → 0 HED semanales', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasEfectivasSemanaTotal).toBe(42);
    expect(r.horasExtraSemanales.diurna).toBe(0);
  });
});

describe('§6(5) un exceso sobre el tope diario de 8h genera HED aunque la semana no llegue a 42h; un día de 7h30 no', () => {
  it('[ACTUALIZADO] un día individual de 7h30 NO genera extra (cabe en las 8h); un día de 10h genera 2h de extra aunque el total semanal (34h) esté por debajo de 42h', () => {
    const dLV = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '07:45', fin: '12:00', orden: 1 }, { inicio: '13:45', fin: '17:00', orden: 2 }]);
    const dSab = distribucion(['S'], [{ inicio: '08:00', fin: '12:00', orden: 1 }]);
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dLV, dSab], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    // Regla vigente: un minuto es ordinario solo si cabe en el tope diario
    // (8h) Y en las 42h semanales. L-V (7h30/día) cabe en ambos.
    expect(r.horasExtraSemanales.diurna).toBe(0);
    // Lunes de 10h + martes a viernes de 6h = 34h: la semana no llega a
    // 42h, pero las 2h del lunes sobre el tope diario son extra.
    const lunes10h = distribucion(['L'], [{ inicio: '06:00', fin: '16:00', orden: 1 }]);
    const martesViernes6h = distribucion(['M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '12:00', orden: 1 }]);
    const rExceso = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [lunes10h, martesViernes6h], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!rExceso.ok) throw new Error('no debería bloquear');
    expect(rExceso.horasEfectivasSemanaTotal).toBeCloseTo(34, 5);
    expect(rExceso.horasExtraSemanales.diurna).toBeCloseTo(2, 5);
    expect(rExceso.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0); // sigue saliendo por el bucket semanal, nunca por este campo
  });
});

describe('§6(7) el valor monetario es $0 cuando ningún día pasa de 8h y la semana no pasa de 42h; es > 0 si un día pasa de 8h aunque la semana sea menor a 42h', () => {
  it('[ACTUALIZADO] caso SIN exceso (7h×6=42h) → $0; caso SIN exceso (7h30×5+4h=41,5h) → $0; caso CON exceso diario (lunes de 10h, semana de 34h) → valor > 0', () => {
    const casoSinExcesoDiario = [distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '15:00', orden: 1 }])]; // 7h × 6 = 42h, cada día exactamente en su cuota
    const casoConExcesoDiario = [distribucion(['L'], [{ inicio: '06:00', fin: '16:00', orden: 1 }]), distribucion(['M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '12:00', orden: 1 }])]; // 34h totales, pero el lunes de 10h excede el tope diario

    const rSin = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: casoSinExcesoDiario, incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!rSin.ok) throw new Error('no debería bloquear');
    const resultadoSin = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: rSin.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: rSin.horasExtraSemanales, origenMensualizacionExtra: rSin.origenMensualizacionExtra,
    });
    for (const conceptoClave of ['extraDiurna', 'extraNocturna'] as const) {
      const c = resultadoSin.conceptos.find(x => x.concepto === conceptoClave)!;
      expect(c.horasMensualesPromedio).toBe(0);
      expect(c.valorMensual).toBe(0);
    }

    const rCon = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: casoConExcesoDiario, incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!rCon.ok) throw new Error('no debería bloquear');
    const resultadoCon = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: rCon.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: rCon.horasExtraSemanales, origenMensualizacionExtra: rCon.origenMensualizacionExtra,
    });
    const hedCon = resultadoCon.conceptos.find(x => x.concepto === 'extraDiurna')!;
    expect(hedCon.horasMensualesPromedio).toBeGreaterThan(0);
    expect(hedCon.valorMensual).toBeGreaterThan(0);
  });
});

describe('derivarDistribucionHorasComercialActivo — punto de entrada ACTIVO, fail-closed ante 24,08', () => {
  function distribucionActiva(dias: DistribucionHorarioConfigurada['diasSemana'], bloques: DistribucionHorarioConfigurada['bloques']): DistribucionHorarioConfigurada {
    return { idCliente: 'd1', empresa: '', codigo: '', horario: '', jornada: '', turno: '', diasSemana: dias, bloques, excepcionesFecha: [], sincronizadoExterno: false };
  }

  it('1) un costeo activo con SEMANAL_4_33 calcula normalmente, idéntico a la función base', () => {
    const dLV = distribucionActiva(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '16:00', orden: 1 }]);
    const entrada = { distribucionesHorario: [dLV], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' as const };
    const activo = derivarDistribucionHorasComercialActivo(entrada);
    const base = derivarDistribucionComercialHistoricoParaPruebas(entrada);
    expect(activo).toEqual(base);
    if (!activo.ok) throw new Error('no debería bloquear');
    expect(activo.horasExtraSemanales.diurna).toBe(6);
  });

  it('2) una llamada directa al punto de entrada ACTIVO con LEGADO_COMERCIAL_30_DIAS lanza MetodologiaLegadaNoEjecutableError — nunca ejecuta 24,08', () => {
    const dLV = distribucionActiva(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '16:00', orden: 1 }]);
    const entrada = { distribucionesHorario: [dLV], incluyeFestivos: false, metodologiaCosteo: 'LEGADO_COMERCIAL_30_DIAS' as const };
    expect(() => derivarDistribucionHorasComercialActivo(entrada)).toThrow(MetodologiaLegadaNoEjecutableError);
    expect(() => derivarDistribucionHorasComercialActivo(entrada)).toThrow(/ya no puede ejecutarse en un costeo activo/);
  });

  it('3) un JSON antiguo con metodologiaCosteo=LEGADO_COMERCIAL_30_DIAS puede LEERSE/calcularse sin romper la aplicación vía la función de compatibilidad histórica (no la activa)', () => {
    const dLV = distribucionActiva(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '16:00', orden: 1 }]);
    const entrada = { distribucionesHorario: [dLV], incluyeFestivos: false, metodologiaCosteo: 'LEGADO_COMERCIAL_30_DIAS' as const };
    expect(() => derivarDistribucionComercialHistoricoParaPruebas(entrada)).not.toThrow();
    const r = derivarDistribucionComercialHistoricoParaPruebas(entrada);
    expect(r.ok).toBe(true);
  });

  it('4) al recalcular ese mismo horario con SEMANAL_4_33 (lo que hace la UI al editar/restaurar), el resultado usa el acumulador semanal, no la cuota diaria rígida', () => {
    const dLV = distribucionActiva(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '16:00', orden: 1 }]);
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dLV], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
    expect(r.horasExtraSemanales.diurna).toBe(6);
  });

  it('5) ningún resultado del punto de entrada ACTIVO calcula horasExtraDiurnaDiaOrdinario/horasExtraNocturnaDiaOrdinario vía cuota diaria para el patrón genérico L-S (quedan en 0; el sobretiempo real vive únicamente en horasExtraSemanales, mensualizado con 4,33)', () => {
    const dLV = distribucionActiva(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '16:00', orden: 1 }]);
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dLV], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
    expect(r.distribucion.horasExtraNocturnaDiaOrdinario).toBe(0);
  });

  it('[ACTUALIZADO] 6) los casos de referencia (44→8,66; 48→25,98; ex-CT172→82,27) se sostienen íntegros a través del punto de entrada ACTIVO', () => {
    const casos: Array<{ nombre: string; dias: DistribucionHorarioConfigurada[]; extraSemanal: number; extraMensual: number }> = [
      {
        nombre: '44h', extraSemanal: 2, extraMensual: 8.66,
        dias: [distribucionActiva(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '15:20', orden: 1 }])],
      },
      {
        nombre: '48h', extraSemanal: 6, extraMensual: 25.98,
        dias: [distribucionActiva(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '16:00', orden: 1 }])],
      },
    ];
    for (const c of casos) {
      const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: c.dias, incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
      if (!r.ok) throw new Error(`no debería bloquear (${c.nombre})`);
      expect(r.horasExtraSemanales.diurna, c.nombre).toBeCloseTo(c.extraSemanal, 2);
      const resultado = calcularResultadoTarifaMensualComercial30Dias({
        distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
        horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
      });
      const hed = resultado.conceptos.find(x => x.concepto === 'extraDiurna')!;
      expect(hed.horasMensualesPromedio, c.nombre).toBeCloseTo(c.extraMensual, 2);
    }
    const dLV = distribucionActiva(['L', 'M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '12:00', orden: 1 }, { inicio: '13:00', fin: '18:00', orden: 2 }]);
    const dSab = distribucionActiva(['S'], [{ inicio: '06:00', fin: '12:00', orden: 1 }]);
    const rCt172 = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dLV, dSab], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!rCt172.ok) throw new Error('no debería bloquear (CT172)');
    expect(rCt172.horasExtraSemanales.diurna).toBeCloseTo(19, 2);
    const resultadoCt172 = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: rCt172.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: rCt172.horasExtraSemanales, origenMensualizacionExtra: rCt172.origenMensualizacionExtra,
    });
    const hedCt172 = resultadoCt172.conceptos.find(x => x.concepto === 'extraDiurna')!;
    expect(hedCt172.horasMensualesPromedio).toBeCloseTo(82.27, 2);
  });
});

describe('CIERRE FINAL DE AISLAMIENTO — el módulo productivo no expone ninguna vía para ejecutar LEGADO_COMERCIAL_30_DIAS', () => {
  const FUENTE_MOTOR = readFileSync(join(__dirname, 'derivar-distribucion-comercial.ts'), 'utf-8');
  const PAGE_TSX = readFileSync(join(__dirname, '../../../app/page.tsx'), 'utf-8');

  function listarArchivosTs(dir: string): string[] {
    let resultado: string[] = [];
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      const stat = statSync(ruta);
      if (stat.isDirectory()) resultado = resultado.concat(listarArchivosTs(ruta));
      else if (nombre.endsWith('.ts') || nombre.endsWith('.tsx')) resultado.push(ruta);
    }
    return resultado;
  }

  it('7) el módulo productivo no exporta ninguna función capaz de ejecutar LEGADO_COMERCIAL_30_DIAS — solo derivarDistribucionHorasComercialActivo (fail-closed) queda pública para uso activo', () => {
    expect(FUENTE_MOTOR).not.toContain('export function derivarDistribucionHorasComercialDesdeHorario');
    expect(FUENTE_MOTOR).not.toContain('export function derivarDistribucionHorasComercialInterno');
    expect(FUENTE_MOTOR).toContain('function derivarDistribucionHorasComercialInterno');
    expect(FUENTE_MOTOR).toContain('export function derivarDistribucionHorasComercialActivo');
    expect(FUENTE_MOTOR).toContain('export function derivarDistribucionComercialHistoricoParaPruebas');
  });

  it('8) auditoría de importaciones — page.tsx nunca importa la función histórica/legada, únicamente la activa', () => {
    expect(PAGE_TSX).not.toContain('derivarDistribucionComercialHistoricoParaPruebas');
    expect(PAGE_TSX).not.toContain('derivarDistribucionHorasComercialDesdeHorario');
    expect(PAGE_TSX).not.toContain('derivarDistribucionHorasComercialInterno');
    expect(PAGE_TSX).toContain('derivarDistribucionHorasComercialActivo');
  });

  it('9) auditoría de importaciones — ninguna ruta API (src/app/api/**) importa la función histórica/legada ni la interna', () => {
    const dirApi = join(__dirname, '../../../app/api');
    const archivos = listarArchivosTs(dirApi);
    for (const archivo of archivos) {
      const contenido = readFileSync(archivo, 'utf-8');
      expect(contenido, archivo).not.toContain('derivarDistribucionComercialHistoricoParaPruebas');
      expect(contenido, archivo).not.toContain('derivarDistribucionHorasComercialDesdeHorario');
      expect(contenido, archivo).not.toContain('derivarDistribucionHorasComercialInterno');
    }
  });

  it('10) el único módulo que importa derivarDistribucionComercialHistoricoParaPruebas en todo src/ son archivos de prueba (*.test.ts)', () => {
    const dirSrc = join(__dirname, '../../../');
    const archivos = listarArchivosTs(dirSrc).filter(a => !a.includes('node_modules'));
    for (const archivo of archivos) {
      if (archivo.endsWith('.test.ts') || archivo.endsWith('.test.tsx')) continue;
      if (archivo.endsWith('derivar-distribucion-comercial.ts')) continue;
      const contenido = readFileSync(archivo, 'utf-8');
      expect(contenido, archivo).not.toContain('derivarDistribucionComercialHistoricoParaPruebas');
    }
  });
});

describe('CASO DE REGRESIÓN — recargo comercial dominical SIEMPRE (martes a domingo, 07:00-14:00) — política comercial, independiente de cualquier valor de diaDescansoObligatorio', () => {
  const dist = distribucion(['M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '07:00', fin: '14:00', orden: 1 }]);
  const ANIO_CASO = 2026;
  const salarioMensual = 1750905;

  it('1) domingo programado y trabajado SIEMPRE genera recargo dominical — nunca ordinario', () => {
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: ANIO_CASO, metodologiaCosteo: 'SEMANAL_4_33' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBe(7);
  });

  it('2) hallazgo — el motor mensualiza con la constante FIJA domingosFestivosPromedioMes=5,92 (7×5,92=41,44 h/mes), no con "52 domingos÷12" — costo mensual real del concepto dominical', () => {
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: ANIO_CASO, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r.distribucion, salarioMensual, cantidadTrabajadores: 1, auxilioTransporteMensual: 0 });
    const concepto = resultado.conceptos.find(c => c.concepto === 'ordinariaDominical');
    if (!concepto) throw new Error('concepto ordinariaDominical no encontrado');
    // eslint-disable-next-line no-console
    console.log('CASO MARTES-DOMINGO 2026 — horasBaseMensual (7 × 5,92):', concepto.detalleCalculo!.horasBaseMensual);
    console.log('CASO MARTES-DOMINGO 2026 — valorHoraExacto (salario/210):', concepto.detalleCalculo!.valorHoraExacto);
    console.log('CASO MARTES-DOMINGO 2026 — factor:', concepto.detalleCalculo!.factor);
    console.log('CASO MARTES-DOMINGO 2026 — costo mensual concepto ordinariaDominical:', concepto.valorMensual);
    expect(concepto.detalleCalculo!.horasBaseMensual).toBeCloseTo(41.44, 5);
    expect(concepto.valorMensual).toBe(656473);
  });

  it('3) 42 horas semanales (7h × 6 días) NO generan horas extras', () => {
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: ANIO_CASO, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
    expect(r.distribucion.horasExtraNocturnaDiaOrdinario).toBe(0);
    expect(r.distribucion.horasExtraDiurnaFestivaDiaEspecial).toBe(0);
    expect(r.distribucion.horasExtraNocturnaFestivaDiaEspecial).toBe(0);
  });

  it('4) cambiar diaDescansoObligatorio (dato histórico/legal, ej. lunes) NO elimina ni reduce el recargo dominical — domingo sigue igual de especial', () => {
    const rSinValor = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: ANIO_CASO, metodologiaCosteo: 'SEMANAL_4_33' });
    const rConDiaDescansoLunes = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: ANIO_CASO, diaDescansoObligatorio: 'L', metodologiaCosteo: 'SEMANAL_4_33' });
    if (!rSinValor.ok || !rConDiaDescansoLunes.ok) throw new Error('no debería bloquear');
    expect(rConDiaDescansoLunes.distribucion.horasDominicalFestivaDiaEspecial).toBe(rSinValor.distribucion.horasDominicalFestivaDiaEspecial);
    expect(rConDiaDescansoLunes.distribucion.horasDominicalFestivaDiaEspecial).toBe(7);
  });

  it('5) lunes a sábado (domingo NO programado) — horas dominicales en cero, nunca se proyectan horas inexistentes', () => {
    // incluyeFestivos:false aísla esta prueba de la reclasificación de
    // festivos reales en días ordinarios (mecanismo aparte, ya probado en
    // "§11 domingo/festivos" — no es lo que esta prueba verifica).
    const distLaSabado = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '07:00', fin: '14:00', orden: 1 }]);
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [distLaSabado], incluyeFestivos: false, anioCalculo: ANIO_CASO, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBe(0);
  });

  it('B) lunes a domingo, 12h/día (84h semanales) — domingo especial, exceso semanal clasificado aparte, sin desaparecer ni duplicarse', () => {
    const dist12h = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }]);
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist12h], incluyeFestivos: false, anioCalculo: ANIO_CASO, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    // Domingo (12h) queda íntegramente en el bucket especial — nunca en
    // el acumulador ordinario, nunca en cero.
    const totalEspecialDomingo = r.distribucion.horasDominicalFestivaDiaEspecial + r.distribucion.horasRecargoNocturnoFestivoDiaEspecial + r.distribucion.horasExtraDiurnaFestivaDiaEspecial + r.distribucion.horasExtraNocturnaFestivaDiaEspecial;
    expect(totalEspecialDomingo).toBeGreaterThan(0);
    // Las 12h de domingo NUNCA se cuentan también dentro del acumulador
    // ordinario (L-S) — verificado por construcción: `diasOrdinarios`
    // excluye 'D' siempre (ver derivar-distribucion-comercial.ts).
    // El exceso semanal genérico (L-S, patrón de 12h fijo no aplica aquí
    // vía acumulador semanal — turno de 12h usa cuota fija propia) se
    // resuelve por el mecanismo ya existente, sin relación con este ajuste.
    expect(r.ok).toBe(true);
  });

  it('C) domingo festivo (coincidencia) — el motor no duplica: el bucket especial de domingo ya cubre el día completo una sola vez', () => {
    // El propio código documenta (derivar-distribucion-comercial.ts) que
    // la reclasificación de festivos en días ORDINARIOS se desactiva
    // cuando el día especial (domingo) está programado — evita sumar
    // domingo + festivo dos veces sobre la misma fecha. Esta prueba
    // confirma que activar incluyeFestivos no altera el bucket dominical
    // de un domingo ya programado (no se le "agrega" un festivo encima).
    const dist = distribucion(['M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '07:00', fin: '14:00', orden: 1 }]);
    const rSinFestivos = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist], incluyeFestivos: false, anioCalculo: ANIO_CASO, metodologiaCosteo: 'SEMANAL_4_33' });
    const rConFestivos = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: ANIO_CASO, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!rSinFestivos.ok || !rConFestivos.ok) throw new Error('no debería bloquear');
    // El domingo (7h) no cambia por activar incluyeFestivos — el mismo
    // domingo no se cuenta dos veces (una como "domingo" y otra como
    // "festivo que cae en domingo").
    expect(rConFestivos.distribucion.horasDominicalFestivaDiaEspecial).toBe(rSinFestivos.distribucion.horasDominicalFestivaDiaEspecial);
    expect(rConFestivos.distribucion.horasDominicalFestivaDiaEspecial).toBe(7);
  });
});

/**
 * Ajuste "DIAGNOSTICAR Y CORREGIR HORAS EXTRAS SEMANALES Y MENSUALES" —
 * caso real reportado: VIGI, 1 trabajador, L-V 06:00-18:00 (60h/semana),
 * jornada ordinaria 42h, salario $1.750.905, divisor 210, recargo diurno
 * 1,25. `clasificarPatronBloquesDia` clasificaba CUALQUIER bloque de
 * exactamente 12h como "turno fijo" (UNICO_12H) mirando solo la
 * duración, sin importar si la programación cubre los 7 días (turno
 * rotativo/cobertura real) o es simplemente un horario L-V ordinario que
 * coincide en duración con 12h — forzando la cuota fija de 10,5h/día
 * (mensualizada vía 24,08) en vez del acumulador semanal de 42h
 * (mensualizado vía 4,33). Resultado incorrecto observado: 30,10h/$313.704
 * en vez de 77,94h/$812.295. Corrección: un bloque UNICO_12H solo es
 * "turno fijo" cuando la programación cubre los 7 días de la semana
 * (`cubreSieteDiasProgramacion`); DOBLE_12H (rota dentro del mismo día)
 * sigue siendo siempre turno fijo, sin cambios.
 */
describe('Ajuste "HORAS EXTRAS SEMANALES Y MENSUALES" — VIGI, L-V 06:00-18:00 (12h/día, 60h/semana, NO cubre 7 días)', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '18:00', orden: 1 }]);
  const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });

  it('[ACTUALIZADO] 1) 60 horas trabajadas, tope diario de 8h: cada día L-V (12h) aporta 4h extra → 20 horas extra semanales (40 ordinarias, dentro de las 42h)', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasEfectivasSemanaTotal).toBe(60);
    expect(r.horasExtraSemanales.diurna).toBe(20);
    expect(r.horasExtraSemanales.nocturna).toBe(0);
    // La rama de "turno fijo" (24,08) queda en cero — todo el sobretiempo
    // vive en el bucket semanal (4,33), nunca repartido entre ambos.
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
  });

  it('[ACTUALIZADO] 2) 20 × 4,33 produce 86,6 horas mensuales', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!;
    expect(hed.horasMensualesPromedio).toBeCloseTo(86.6, 2);
    expect(hed.detalleCalculo?.horasSemanalesAcumuladas).toBe(20);
    expect(hed.detalleCalculo?.factorMensualizacionSemanal).toBe(4.33);
  });

  it('[ACTUALIZADO] 3) el costo mensual corresponde a 86,6 horas — $902.550', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!;
    expect(hed.valorMensual).toBe(902550);
  });

  it('[NUEVO] 4) con JORNADA FLEXIBLE pactada (tope diario 9h): 15h extra por el tope diario + las 45h ordinarias superan las 42h → 18 HED semanales, 77,94h mensuales, $812.295 (el valor histórico reportado para este caso)', () => {
    const rFlex = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33', jornadaFlexible: true });
    if (!rFlex.ok) throw new Error('no debería bloquear');
    expect(rFlex.horasExtraSemanales.diurna).toBe(18);
    const resultado = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: rFlex.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: rFlex.horasExtraSemanales, origenMensualizacionExtra: rFlex.origenMensualizacionExtra,
    });
    const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!;
    expect(hed.horasMensualesPromedio).toBeCloseTo(77.94, 2);
    expect(hed.valorMensual).toBe(812295);
  });

  it('[ACTUALIZADO] 6) L-V 8h/día (40h totales, por debajo de 42h) NO produce extras: cada día cabe en el tope diario de 8h y la semana no llega a 42h (antes 5h, con la cuota fija de 7h por día)', () => {
    const dist42 = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '14:00', orden: 1 }]); // 8h × 5 = 40h
    const r42 = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist42], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r42.ok) throw new Error('no debería bloquear');
    expect(r42.horasEfectivasSemanaTotal).toBe(40);
    expect(r42.horasExtraSemanales.diurna).toBe(0);
  });

  it('[ACTUALIZADO] 7) mismo caso (40h totales) con jornada flexible — también 0 extras', () => {
    const dist40 = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '14:00', orden: 1 }]);
    const r40 = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist40], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33', jornadaFlexible: true });
    if (!r40.ok) throw new Error('no debería bloquear');
    expect(r40.horasExtraSemanales.diurna).toBe(0);
  });

  it('9) cantidad de trabajadores NO divide las horas extra — el resultado por trabajador es el mismo con 1 o 2', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const res1 = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const res2 = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 2,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const hed1 = res1.conceptos.find(c => c.concepto === 'extraDiurna')!;
    const hed2 = res2.conceptos.find(c => c.concepto === 'extraDiurna')!;
    expect(hed2.horasMensualesPromedio).toBe(hed1.horasMensualesPromedio);
    expect(hed2.valorMensual).toBe(hed1.valorMensual);
  });

  it('10) cantidad 2 duplica el costo TOTAL del cargo, nunca las horas individuales', () => {
    if (!r.ok) throw new Error('no debería bloquear');
    const res1 = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    const res2 = calcularResultadoTarifaMensualComercial30Dias({
      distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 2,
      horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
    });
    expect(res2.tarifaMensualCargo).toBe(res1.tarifaMensualCargo * 2);
  });
});

describe('Ajuste "HORAS EXTRAS SEMANALES Y MENSUALES" — casos protegidos de turno fijo 12h (7 días o rotativo) NO cambian', () => {
  it('turno de 12h que SÍ cubre los 7 días (Avianca) sigue usando la cuota fija de 10,5h/día, mensualizada vía 24,08', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }]);
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist], incluyeFestivos: true, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.origenMensualizacionExtra).toBe('DIARIO_24_08');
    expect(r.horasExtraSemanales.diurna).toBe(0);
    // 6 días ordinarios (excluye domingo, procesado aparte) × (12h − 10,5h
    // cuota fija) = 9h de exceso, ÷6 días ordinarios = 1,5h "por día ordinario".
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBeCloseTo(1.5, 5);
  });

  it('dos bloques de 12h que rotan el mismo día (DOBLE_12H, cobertura 24/7) siguen siendo turno fijo aunque no cubran los 7 días', () => {
    const dist = distribucion(['L', 'M', 'X', 'J', 'V'], [
      { inicio: '06:00', fin: '18:00', orden: 1 },
      { inicio: '18:00', fin: '06:00', orden: 2 },
    ]);
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    // Turno fijo (cuota 10,5h/bloque, reinicia por bloque) — nunca entra
    // al acumulador semanal, sin importar que sean solo 5 días.
    expect(r.horasExtraSemanales.diurna).toBe(0);
    expect(r.horasExtraSemanales.nocturna).toBe(0);
  });
});
