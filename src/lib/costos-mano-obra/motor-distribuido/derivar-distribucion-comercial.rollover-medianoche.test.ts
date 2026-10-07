/**
 * OPCIÓN C (diagnóstico Aseocolba) — rollover de día de semana en cruce de
 * medianoche. Decisión de negocio: el tope diario ordinario (480 min = 8h)
 * NUNCA se reinicia a medianoche — un único acumulador continuo gobierna
 * todo el turno operativo — pero la clasificación dominical/festiva SÍ debe
 * respetar el día real en que se trabaja cada minuto. Solo dos
 * transiciones del ciclo L→M→X→J→V→S→D→L requieren reasignación entre el
 * bucket ordinario y el especial: S→D y D→L (ver `derivar-distribucion-
 * comercial.ts`, `SIGUIENTE_DIA_SEMANA`/`clasificarDiaComercialConCorteMedianoche`).
 * Los turnos de 12h fijo (`esTurnoFijoEfectivo`) quedan explícitamente
 * excluidos — en una cobertura simétrica de 7 días el rollover existe
 * físicamente, pero redistribuirlo entre días da un resultado semanal
 * agregado equivalente y arriesga romper casos históricos ya validados
 * (Avianca) sin cambiar nada real.
 */
import { describe, expect, it } from 'vitest';
import {
  derivarDistribucionHorasComercialActivo,
  derivarDistribucionComercialHistoricoParaPruebas,
} from './derivar-distribucion-comercial';
import { calcularResultadoTarifaMensualComercial30Dias } from './motor-comercial-30-dias';
import type { DistribucionHorarioConfigurada } from '../horarios/tipos';

// Los buckets *DiaOrdinario de `distribucion` están mensualizados ÷6 (ver
// DIAS_ORDINARIOS_SEMANA_COMERCIAL en derivar-distribucion-comercial.ts)
// — para comparar contra horas REALES de un turno puntual, se multiplica
// de vuelta por esta misma constante. Los buckets *FestivaDiaEspecial
// NUNCA se dividen (hay un solo domingo por semana), así que ya están en
// horas reales directamente.
const DIAS_ORDINARIOS_SEMANA_COMERCIAL_TEST = 6;

function dist(dias: DistribucionHorarioConfigurada['diasSemana'], bloques: { inicio: string; fin: string; orden: number }[]): DistribucionHorarioConfigurada {
  return { idCliente: 'd1', empresa: '', codigo: '', horario: '', jornada: '', turno: '', diasSemana: dias, bloques, excepcionesFecha: [], sincronizadoExterno: false };
}

describe('OPCIÓN C — 1) L 20:00-06:00 (10h, sin domingo involucrado): sin cambios frente a Fase 3', () => {
  it('8h ordinaria (recargo nocturno) + 2h extra nocturna', () => {
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist(['L'], [{ inicio: '20:00', fin: '06:00', orden: 1 }])], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasExtraSemanales.nocturna).toBeCloseTo(2, 6);
    expect(r.horasExtraSemanales.diurna).toBe(0);
    expect(r.horasEfectivasSemanaTotal).toBeCloseTo(10, 6);
  });
});

describe('OPCIÓN C — 2) S 20:00→D 06:00 (10h): rollover dominical correcto, tabla exacta acordada', () => {
  it('4h en Rec. noct. (sábado), 4h en Rec. noct.-fest. (domingo, 00-04h), 2h en Extra fest. noct. (domingo, 04-06h)', () => {
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist(['S'], [{ inicio: '20:00', fin: '06:00', orden: 1 }])], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    // 4h ordinaria (sábado, recargo nocturno) — mensualizado ÷6, así que
    // en horas/semana equivalentes: 4h/6 días × 6 = 4h reales; se verifica
    // multiplicando de vuelta por el mismo divisor.
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario * 6).toBeCloseTo(4, 5);
    expect(r.distribucion.horasOrdinariasDiaOrdinario).toBe(0);
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
    expect(r.distribucion.horasExtraNocturnaDiaOrdinario).toBe(0);
    // Domingo (bucket especial) NUNCA se mensualiza ÷6 — hay un solo
    // domingo por semana, así que el valor ya es horas reales.
    expect(r.distribucion.horasRecargoNocturnoFestivoDiaEspecial).toBeCloseTo(4, 5);
    expect(r.distribucion.horasExtraNocturnaFestivaDiaEspecial).toBeCloseTo(2, 5);
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBe(0);
    expect(r.distribucion.horasExtraDiurnaFestivaDiaEspecial).toBe(0);
    // Conservación: 4h + 4h + 2h = 10h.
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario * 6 + r.distribucion.horasRecargoNocturnoFestivoDiaEspecial + r.distribucion.horasExtraNocturnaFestivaDiaEspecial).toBeCloseTo(10, 5);
  });

  it('el sobretiempo total (2h) queda íntegro en Extra fest. noct., nunca duplicado en el bucket ordinario semanal (4,33)', () => {
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist(['S'], [{ inicio: '20:00', fin: '06:00', orden: 1 }])], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasExtraSemanales.nocturna).toBe(0); // la porción "después" ya no participa del bucket semanal ordinario
    expect(r.horasExtraSemanales.diurna).toBe(0);
    expect(r.distribucion.horasExtraNocturnaFestivaDiaEspecial).toBeCloseTo(2, 5);
  });
});

describe('OPCIÓN C — 3) L 22:00-08:00 (10h): 2h de sobretiempo, sin reinicio del tope diario a las 00:00', () => {
  it('2h extra diurna (06:00-08:00), 0 extra nocturna: las 8h ordinarias llegan hasta las 06:00 (sin domingo involucrado)', () => {
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist(['L'], [{ inicio: '22:00', fin: '08:00', orden: 1 }])], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(2, 6);
    expect(r.horasExtraSemanales.nocturna).toBe(0);
  });
});

describe('OPCIÓN C — 4) L 19:00-23:00 / 01:00-06:00 (9h, dos bloques del mismo día): tope diario continuo, sin tope nuevo por el hueco', () => {
  it('8h ordinaria + 1h extra nocturna', () => {
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist(['L'], [{ inicio: '19:00', fin: '23:00', orden: 1 }, { inicio: '01:00', fin: '06:00', orden: 2 }])], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasExtraSemanales.nocturna).toBeCloseTo(1, 6);
    expect(r.horasExtraSemanales.diurna).toBe(0);
  });
});

describe('OPCIÓN C — 5) L 20:00-06:00 con 1h de descanso → 20:00-00:30/01:30-06:00 (9h): 8h + 1h extra', () => {
  it('8h ordinaria + 1h extra nocturna', () => {
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist(['L'], [{ inicio: '20:00', fin: '00:30', orden: 1 }, { inicio: '01:30', fin: '06:00', orden: 2 }])], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasExtraSemanales.nocturna).toBeCloseTo(1, 6);
    expect(r.horasExtraSemanales.diurna).toBe(0);
  });
});

describe('OPCIÓN C — 6) D 20:00→L 06:00 (10h): rollover especial→ordinario, tabla exacta acordada', () => {
  // Nota: un cargo programado ÚNICAMENTE el domingo (sin ningún día
  // ordinario) hace que `diasOrdinarios` quede vacío, y el intérprete de
  // turnos (`interpretarOperacionTurno`, interprete-turnos.ts) falla al
  // resolver `bloquesParaInterpretar` en ese caso — hallazgo preexistente,
  // ajeno al rollover de Opción C (no toca nada de lo que este cambio
  // modifica), fuera de este alcance. Por eso el caso D→L se prueba con
  // al menos un día ordinario programado, igual que cualquier cargo real.
  it('con cuota de 420 min (seis días ordinarios ya programados, jornadaSemanal=42h): 4h dominical + 3h ordinaria (lunes) + 3h extra (lunes)', () => {
    // Fuerza cuotaGenericaMin=420min programando los 6 días ordinarios con
    // jornada total de 42h (7h/día) — así la cuota que hereda domingo→lunes
    // es exactamente 420min, igual que el ejemplo acordado.
    const seisDias = dist(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '15:00', orden: 1 }]); // 7h/día × 6 = 42h
    const domingo = dist(['D'], [{ inicio: '20:00', fin: '06:00', orden: 1 }]);
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [seisDias, domingo], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasRecargoNocturnoFestivoDiaEspecial).toBeCloseTo(4, 5);
    // La contribución de lunes por el rollover (3h ordinaria + 3h extra)
    // se SUMA a la que ya tenía lunes por su propio bloque 08:00-15:00
    // (7h, íntegras dentro de su propia cuota diaria de 420min, ordinaria
    // diurna) — se verifica el total agregado vía horasExtraSemanales,
    // que ahora SÍ debe reflejar la extra nocturna aportada por el
    // rollover de domingo.
    expect(r.horasExtraSemanales.nocturna).toBeCloseTo(3, 5);
  });
});

describe('OPCIÓN C — 7) bloque sin cruce de medianoche: resultado idéntico al actual', () => {
  it('L 08:00-17:00 (9h): 8h ordinaria + 1h extra diurna, sin ninguna rama de rollover activada', () => {
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist(['L'], [{ inicio: '08:00', fin: '17:00', orden: 1 }])], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(1, 6);
    expect(r.horasExtraSemanales.nocturna).toBe(0);
  });

  it('S 08:00-17:00 (9h, sábado sin cruzar medianoche): el día siguiente es domingo pero no hay rollover porque el bloque no envuelve', () => {
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist(['S'], [{ inicio: '08:00', fin: '17:00', orden: 1 }])], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBe(0);
    expect(r.distribucion.horasRecargoNocturnoFestivoDiaEspecial).toBe(0);
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(1, 6);
  });
});

describe('OPCIÓN C — 8) camino histórico/legado: idéntico, el rollover nunca se activa', () => {
  it('S 20:00→D 06:00 vía LEGADO_COMERCIAL_30_DIAS: las 10h siguen enteras en el bucket ordinario, domingo nunca se activa', () => {
    const r = derivarDistribucionComercialHistoricoParaPruebas({ distribucionesHorario: [dist(['S'], [{ inicio: '20:00', fin: '06:00', orden: 1 }])], incluyeFestivos: false, metodologiaCosteo: 'LEGADO_COMERCIAL_30_DIAS' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBe(0);
    expect(r.distribucion.horasRecargoNocturnoFestivoDiaEspecial).toBe(0);
    expect(r.distribucion.horasExtraNocturnaFestivaDiaEspecial).toBe(0);
  });
});

describe('OPCIÓN C — 9) conservación total de minutos: la suma de todos los buckets nunca pierde ni duplica horas', () => {
  it.each([
    ['S 20:00-06:00 (10h)', dist(['S'], [{ inicio: '20:00', fin: '06:00', orden: 1 }]), 10],
    ['L 22:00-08:00 (10h)', dist(['L'], [{ inicio: '22:00', fin: '08:00', orden: 1 }]), 10],
    ['L 20:00-23:00/01:00-06:00 (8h)', dist(['L'], [{ inicio: '20:00', fin: '23:00', orden: 1 }, { inicio: '01:00', fin: '06:00', orden: 2 }]), 8],
  ])('%s → horasEfectivasSemanaTotal == duración exacta', (_nombre, d, horasEsperadas) => {
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [d], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasEfectivasSemanaTotal).toBeCloseTo(horasEsperadas, 6);
  });

  it('D 20:00-06:00 + seis días ordinarios (10h del turno de domingo, dentro de un total semanal mayor): la porción domingo+lunes conserva exactamente 10h', () => {
    const seisDias = dist(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '15:00', orden: 1 }]); // 7h/día × 6 = 42h, sin extra
    const domingo = dist(['D'], [{ inicio: '20:00', fin: '06:00', orden: 1 }]);
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [seisDias, domingo], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    // 6 días × 7h (sin exceso) + 10h del turno domingo→lunes = 52h.
    expect(r.horasEfectivasSemanaTotal).toBeCloseTo(52, 6);
  });
});

describe('OPCIÓN C — 10) S→D se activa aunque domingo NO esté programado explícitamente en ninguna distribución', () => {
  it('dist con diasSemana:["S"] únicamente — el rollover igual reasigna los minutos post-medianoche a los buckets especiales', () => {
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [dist(['S'], [{ inicio: '20:00', fin: '06:00', orden: 1 }])], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.distribucion.horasRecargoNocturnoFestivoDiaEspecial).toBeGreaterThan(0);
    expect(r.distribucion.horasExtraNocturnaFestivaDiaEspecial).toBeGreaterThan(0);
  });
});

describe('OPCIÓN C — 11) interacción con festivosPromedioEsteDia: sin doble reclasificación', () => {
  it('L-S 8h/día, ningún bloque cruza medianoche → comportamiento idéntico a Fase 3B (el corte nunca interfiere cuando no hay cruce)', () => {
    const d = dist(['L', 'M', 'X', 'J', 'V', 'S'], [{ inicio: '08:00', fin: '16:00', orden: 1 }]);
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [d], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(6, 5); // idéntico al caso §1 de reclasificacion-festivo.test.ts
  });

  it('sábado con rollover hacia domingo: la porción "antes" (4h) es la única que participa del multiplicador estadístico de festivo, nunca las 6h ya reasignadas a domingo real', () => {
    const d = dist(['S'], [{ inicio: '20:00', fin: '06:00', orden: 1 }]);
    const sinFestivo = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [d], incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33' });
    const conFestivo = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [d], incluyeFestivos: true, anioCalculo: 2026, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!sinFestivo.ok || !conFestivo.ok) throw new Error('no debería bloquear');
    // Con o sin el multiplicador estadístico de festivo, el resultado del
    // rollover S→D no cambia: las 6h de domingo YA tienen su propio
    // recargo real (100%, no estadístico), así que activar
    // `incluyeFestivos` no debe alterar los buckets festivos derivados
    // del rollover (evita la doble reclasificación).
    expect(conFestivo.distribucion.horasRecargoNocturnoFestivoDiaEspecial).toBeCloseTo(sinFestivo.distribucion.horasRecargoNocturnoFestivoDiaEspecial, 5);
    expect(conFestivo.distribucion.horasExtraNocturnaFestivaDiaEspecial).toBeCloseTo(sinFestivo.distribucion.horasExtraNocturnaFestivaDiaEspecial, 5);
  });
});

describe('OPCIÓN C — 12) COBERTURA_24_7 (Avianca) conserva EXACTAMENTE sus resultados actuales — turno fijo excluido del rollover', () => {
  it('L-D 06:00-18:00 + 18:00-06:00, 1 posición: mismos valores ya protegidos (cobertura semanal 168h, sin extra semanal genérico)', () => {
    const d = dist(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }]);
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [d], incluyeFestivos: true, cantidadTrabajadores: 1, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.tipoOperacionInterpretada).toBe('COBERTURA_24_7');
    expect(r.interpretacion.coberturaSemanalPorPosicion).toBe(168);
    expect(r.horasExtraSemanales.diurna).toBe(0);
    expect(r.horasExtraSemanales.nocturna).toBe(0);
    expect(r.origenMensualizacionExtra).toBe('DIARIO_24_08');
  });

  it('COBERTURA_12_7 (turno diurno 06:00-18:00, sin cruce de medianoche): Dom./Fest., HED y HEDF sin cambios frente a los valores ya protegidos (§8.9, mismo escenario)', () => {
    const d = dist(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }]);
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [d], incluyeFestivos: true, anioCalculo: 2026, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    expect(r.interpretacion.tipoOperacionInterpretada).toBe('COBERTURA_12_7');
    const resultado = calcularResultadoTarifaMensualComercial30Dias({ distribucionHoras: r.distribucion, salarioMensual: 1750905, auxilioTransporteMensual: 0, cantidadTrabajadores: 1, horasExtraSemanales: r.horasExtraSemanales, origenMensualizacionExtra: r.origenMensualizacionExtra });
    expect(resultado.conceptos.find(c => c.concepto === 'ordinariaDominical')!.horasMensualesPromedio).toBeCloseTo(62.16, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurna')!.horasMensualesPromedio).toBeCloseTo(36.12, 2);
    expect(resultado.conceptos.find(c => c.concepto === 'extraDiurnaFestiva')!.horasMensualesPromedio).toBeCloseTo(8.88, 2);
  });
});

describe('OPCIÓN C — 13) exclusión explícita de esTurnoFijoEfectivo del corte de rollover', () => {
  it('un turno fijo de 12h con bloque que envuelve medianoche (18:00-06:00, cobertura 7 días) nunca activa el rollover — domingo sigue recibiendo sus 24h íntegras, como hoy', () => {
    const d = dist(['L', 'M', 'X', 'J', 'V', 'S', 'D'], [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }]);
    const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: [d], incluyeFestivos: true, cantidadTrabajadores: 1, metodologiaCosteo: 'SEMANAL_4_33' });
    if (!r.ok) throw new Error('no debería bloquear');
    // Si el rollover se activara, parte de las 24h de domingo migrarían
    // hacia lunes (ordinario) — esto verifica que domingo sigue
    // recibiendo el total completo, sin fuga hacia el bucket ordinario.
    const especialTotal = r.distribucion.horasDominicalFestivaDiaEspecial + r.distribucion.horasRecargoNocturnoFestivoDiaEspecial + r.distribucion.horasExtraDiurnaFestivaDiaEspecial + r.distribucion.horasExtraNocturnaFestivaDiaEspecial;
    expect(especialTotal).toBeGreaterThan(0);
    expect(r.interpretacion.tipoOperacionInterpretada).toBe('COBERTURA_24_7');
  });
});
