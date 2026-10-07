/**
 * Ajuste "MEJORA DE TRAZABILIDAD VISUAL — ICONO DE DETALLE DE CÁLCULO POR
 * CADA CONCEPTO DE HORAS" — pruebas puras del campo `detalleCalculo`
 * (ConceptoMensual.detalleCalculo, tipos-resultado-mensual.ts), construido
 * por `calcularResultadoTarifaMensualComercial30Dias` a partir de datos
 * reales del motor (nunca reconstruido desde el texto visible de una
 * tabla). Puramente informativo/presentación — no participa de ningún
 * cálculo financiero, no se usa como entrada de nada.
 */
import { describe, expect, it } from 'vitest';
import { derivarDistribucionHorasComercialActivo } from './derivar-distribucion-comercial';
import { calcularResultadoTarifaMensualComercial30Dias } from './motor-comercial-30-dias';
import type { DistribucionHorarioConfigurada } from '../horarios/tipos';

function distribucion(dias: DistribucionHorarioConfigurada['diasSemana'], bloques: DistribucionHorarioConfigurada['bloques']): DistribucionHorarioConfigurada {
  return { idCliente: 'd1', empresa: '', codigo: '', horario: '', jornada: '', turno: '', diasSemana: dias, bloques, excepcionesFecha: [], sincronizadoExterno: false };
}

/**
 * Ex "CT 172" — RECEPCIONISTA, L-V 06:00-18:00 c/1h descanso (11h
 * efectivas/día) + sábado 06:00-12:00 (6h). Ajuste "HORAS EXTRAS POR
 * JORNADA SEMANAL, NO POR DÍA": con tope diario de 8h + jornada semanal de
 * 42h, L-V aporta 8h ordinarias y 3h extra por día (15h) y el sábado 2h
 * ordinarias (la semana llega a 42h) + 4h extra = 19h HED semanales,
 * 82,27h mensuales, $857.422 — el valor histórico que el commit `1028ca1`
 * (27-jul-2026) documentó como validado contra un Excel de referencia (ese
 * artefacto no está en este repositorio; la única evidencia es el comentario
 * del commit). La regla anterior de 7h fijas por día daba 20h / $902.550.
 */
describe('detalleCalculo — motor ACTIVO, ex-"CT 172" (patrón irregular, tope diario 8h + 42h semanales → 19h HED semanales)', () => {
  const dLV = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '12:00', orden: 1 }, { inicio: '13:00', fin: '18:00', orden: 2 }]);
  const dSab = distribucion(['S'], [{ inicio: '06:00', fin: '12:00', orden: 1 }]);
  const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dLV, dSab], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
  if (!r.ok) throw new Error('no debería bloquear');
  const resultado = calcularResultadoTarifaMensualComercial30Dias({
    distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
    horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
  });
  const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.detalleCalculo!;

  it('1) A. origen de las horas: 19h semanales (L-V 3h extra/día × 5 por el tope diario de 8h + sábado 4h por superar las 42h semanales), factor de mensualización 4,33', () => {
    expect(hed.horasSemanalesAcumuladas).toBe(19);
    expect(hed.factorMensualizacionSemanal).toBe(4.33);
    expect(hed.horasDiaOrdinario).toBe(0); // toda la HED del patrón genérico L-S vive en el bucket semanal, nunca en la cuota diaria (24,08)
  });

  it('2) B. mensualización: 19 × 4,33 = 82,27h mensuales, idéntico al horasMensualesPromedio del concepto', () => {
    expect(hed.horasMensualesSemanales).toBeCloseTo(82.27, 2);
    expect(hed.horasMensualesPromedio).toBeCloseTo(82.27, 2);
  });

  it('3) C. cálculo monetario: valorHoraExacto sin redondear, factor total 1,25, valorMensual = $857.422', () => {
    expect(hed.valorHoraExacto).toBeCloseTo(1750905 / 210, 6);
    expect(hed.valorHoraExacto % 1).not.toBe(0); // nunca redondeado anticipadamente
    expect(hed.factor).toBe(1.25);
    expect(hed.factorTipo).toBe('FACTOR_TOTAL');
    expect(hed.valorMensual).toBe(857422);
    expect(hed.reglaRedondeo).toBe('HALF_UP');
  });

  it('4) D. trazabilidad: origen semanal SEMANAL_4_33, base diaria DIARIO_24_08 (aunque horasDiaOrdinario sea 0 para este concepto)', () => {
    expect(hed.origenMensualizacionSemanal).toBe('SEMANAL_4_33');
    expect(hed.origenMensualizacionBase).toBe('DIARIO_24_08');
  });
});

/**
 * NOTA — `LEGADO_COMERCIAL_30_DIAS` NO reproduce $857.422 para este
 * escenario: siempre usó cuota diaria = jornadaSemanal÷díasProgramados
 * (aquí 42÷6=7h) mensualizada con 24,08, y produce 20h de exceso brutas
 * (80,27h, no 82,27h). El valor $857.422 lo produce ahora el motor ACTIVO
 * (describe de arriba). La reproducibilidad del camino histórico está
 * demostrada para su propio caso (Conserje/Aseador, $250.963) en
 * derivar-distribucion-comercial.test.ts, sección "Caso real —
 * Conserje/Aseador... LEGADO_COMERCIAL_30_DIAS reproduce exactamente el
 * Excel histórico".
 */

describe('detalleCalculo — caso obligatorio L-S 08:00-15:20 (2h HED semanal)', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '15:20', orden: 1 }]);
  const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
  if (!r.ok) throw new Error('no debería bloquear');
  const resultado = calcularResultadoTarifaMensualComercial30Dias({
    distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
    horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
  });
  const hed = resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.detalleCalculo!;

  it('5) 2h semanales × 4,33 = 8,66h mensuales, $90.255 — nunca 0,333333×24,08=8,03h ni $83.654', () => {
    expect(hed.horasSemanalesAcumuladas).toBe(2);
    expect(hed.horasMensualesSemanales).toBeCloseTo(8.66, 2);
    expect(hed.valorMensual).toBe(90255);
    expect(hed.horasMensualesPromedio).not.toBeCloseTo(8.03, 2);
    expect(hed.valorMensual).not.toBe(83654);
  });

  it('6) valorSinRedondear y valorMensual son consistentes con la política HALF_UP (redondeo de un único número, sin desvíos)', () => {
    expect(Math.round(hed.valorSinRedondear)).toBe(hed.valorMensual);
  });
});

describe('detalleCalculo — conceptos sin exceso semanal (recargoNocturno) nunca reportan mensualización 4,33 falsa', () => {
  const dLV = distribucion(['L', 'M', 'X', 'J', 'V'], [{ inicio: '06:00', fin: '12:00', orden: 1 }, { inicio: '13:00', fin: '18:00', orden: 2 }]);
  const dSab = distribucion(['S'], [{ inicio: '06:00', fin: '12:00', orden: 1 }]);
  const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dLV, dSab], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
  if (!r.ok) throw new Error('no debería bloquear');
  const resultado = calcularResultadoTarifaMensualComercial30Dias({
    distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
    horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
  });
  const recNoct = resultado.conceptos.find(c => c.concepto === 'recargoNocturno')!.detalleCalculo!;

  it('7) sin horas semanales acumuladas: factorMensualizacionSemanal=0, origenMensualizacionSemanal=NO_APLICA', () => {
    expect(recNoct.horasSemanalesAcumuladas).toBe(0);
    expect(recNoct.factorMensualizacionSemanal).toBe(0);
    expect(recNoct.origenMensualizacionSemanal).toBe('NO_APLICA');
    expect(recNoct.horasMensualesSemanales).toBe(0);
  });

  it('8) es RECARGO_ADICIONAL (0,35), nunca FACTOR_TOTAL — coherente con la convención de liquidación (§Q, sesión anterior)', () => {
    expect(recNoct.factorTipo).toBe('RECARGO_ADICIONAL');
    expect(recNoct.factor).toBe(0.35);
  });
});

describe('detalleCalculo — origen de mensualización base distingue conceptos diarios (24,08) de dominicales/festivos (5,92)', () => {
  const dist = distribucion(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '07:00', fin: '15:00', orden: 1 }]);
  const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist], incluyeFestivos: true, anioCalculo: 2026, metodologiaCosteo: 'SEMANAL_4_33' });
  if (!r.ok) throw new Error('no debería bloquear');
  const resultado = calcularResultadoTarifaMensualComercial30Dias({
    distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1,
    horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra,
  });

  it('9) extraDiurna (HED genérica L-S): origenMensualizacionBase=DIARIO_24_08', () => {
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.detalleCalculo!.origenMensualizacionBase).toBe('DIARIO_24_08');
  });

  it('10) ordinariaDominical (domingo/festivo): origenMensualizacionBase=DOMINGO_FESTIVO_5_92, diasPromedioMes=5,92', () => {
    const dom = resultado.conceptos.find(c => c.concepto === 'ordinariaDominical')!.detalleCalculo!;
    expect(dom.origenMensualizacionBase).toBe('DOMINGO_FESTIVO_5_92');
    expect(dom.diasPromedioMes).toBe(5.92);
  });
});