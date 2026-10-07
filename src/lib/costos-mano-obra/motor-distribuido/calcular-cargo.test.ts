import { describe, it, expect } from 'vitest';
import { calcularCargoDistribuido } from './calcular-cargo';
import { esFechaFestiva } from './festivos';
import { festivosColombiaEnRango } from './calendario-festivos-colombia';

const FESTIVOS_COLOMBIA_2026 = festivosColombiaEnRango('2026-01-01', '2026-12-31');
import type { DistribucionHorarioConfigurada } from '../horarios/tipos';

function distLunAJue(): DistribucionHorarioConfigurada {
  return {
    idCliente: 'd1', empresa: 'aseo', codigo: '1', horario: '08:00-12:30 Y 14:00-18:00', jornada: '', turno: '',
    diasSemana: ['L', 'M', 'X', 'J'],
    bloques: [{ inicio: '08:00', fin: '12:30', orden: 1 }, { inicio: '14:00', fin: '18:00', orden: 2 }],
    excepcionesFecha: [], sincronizadoExterno: false,
  };
}
function distVie(): DistribucionHorarioConfigurada {
  return {
    idCliente: 'd2', empresa: 'aseo', codigo: '2', horario: '08:00-12:00 Y 14:00-18:00', jornada: '', turno: '',
    diasSemana: ['V'],
    bloques: [{ inicio: '08:00', fin: '12:00', orden: 1 }, { inicio: '14:00', fin: '18:00', orden: 2 }],
    excepcionesFecha: [], sincronizadoExterno: false,
  };
}

describe('calcularCargoDistribuido — caso obligatorio ASEADOR 21-25/07/2026', () => {
  const entrada = {
    distribuciones: [distLunAJue(), distVie()],
    fechaInicio: '2026-07-21', fechaFin: '2026-07-25',
    salarioMensual: 1750905, headcount: 1,
  };
  const r = calcularCargoDistribuido(entrada, 249095);

  it('estado CALCULADO', () => {
    expect(r.estado).toBe('CALCULADO');
  });

  it('4 fechas del período, sábado no contado', () => {
    expect(r.cantidadDias).toBe(4);
  });

  it('minutos del período: 2010 (33h30)', () => {
    expect(r.minutosPeriodo).toBe(2010);
  });

  it('ordinaria del período = 2010 min, todo lo demás en cero', () => {
    expect(r.buckets.ordinariaHabil).toBe(2010);
    expect(r.buckets.recargoNocturno).toBe(0);
    expect(r.buckets.extraDiurna).toBe(0);
    expect(r.buckets.extraNocturna).toBe(0);
    expect(r.buckets.ordinariaDominical).toBe(0);
    expect(r.buckets.recargoNocturnoDominical).toBe(0);
    expect(r.buckets.extraDiurnaFestiva).toBe(0);
    expect(r.buckets.extraNocturnaFestiva).toBe(0);
  });

  it('sobretiempo = $0 (sin horas extra, gracias al contexto del lunes)', () => {
    expect(r.costoRecargos).toBe(0);
  });

  it('valor hora exacto = salario/210, mostrado redondeado a $8.338', () => {
    expect(r.valorHoraExacto).toBeCloseTo(1750905 / 210, 6);
    expect(r.valorHoraMostrado).toBe(8338);
    expect(r.valorHoraMostrado).not.toBe(7959); // rechaza el divisor 220 legado
  });

  it('salario básico = $1.750.905 completo, nunca $0 ni prorrateado', () => {
    expect(r.salarioBasico).toBe(1750905);
  });

  it('auxilio de transporte = $249.095 (una sola vez, no $498.190)', () => {
    expect(r.auxTransporte).toBe(249095);
  });

  it('total período = $2.000.000', () => {
    expect(r.totalPeriodo).toBe(2000000);
  });

  it('regresión: no reaparecen los valores falsos 16.04/46.04/38.96 en horas', () => {
    const horasNoCero = Object.values(r.buckets).filter(v => v !== 0 && v !== 2010);
    expect(horasNoCero).toEqual([]);
  });
});

describe('calcularCargoDistribuido — contexto semanal (B)', () => {
  it('lunes de contexto (dentro del patrón) hace que el acumulado semanal llegue a 2520 sin generar extra', () => {
    const r = calcularCargoDistribuido({
      distribuciones: [distLunAJue(), distVie()],
      fechaInicio: '2026-07-21', fechaFin: '2026-07-25',
      salarioMensual: 1750905, headcount: 1,
    }, 0);
    // El lunes 20 (L está en el patrón de distLunAJue) se materializa como
    // contexto: 510 min, pero nunca se cuenta en minutosPeriodo.
    expect(r.minutosPeriodo).toBe(2010);
    expect(r.costoRecargos).toBe(0);
  });

  it('sin lunes en ningún patrón (contexto=0), el resultado del período es el mismo (0 extra)', () => {
    const soloMarAVie: DistribucionHorarioConfigurada = {
      idCliente: 'd3', empresa: 'aseo', codigo: '3', horario: '08:00-12:30 Y 14:00-18:00', jornada: '', turno: '',
      diasSemana: ['M', 'X', 'J', 'V'],
      bloques: [{ inicio: '08:00', fin: '12:30', orden: 1 }, { inicio: '14:00', fin: '18:00', orden: 2 }],
      excepcionesFecha: [], sincronizadoExterno: false,
    };
    const r = calcularCargoDistribuido({
      distribuciones: [soloMarAVie],
      fechaInicio: '2026-07-21', fechaFin: '2026-07-24',
      salarioMensual: 1750905, headcount: 1,
    }, 0);
    expect(r.costoRecargos).toBe(0);
  });
});

describe('calcularCargoDistribuido — nocturnas (C)', () => {
  it('horario completamente diurno: todos los conceptos nocturnos en cero', () => {
    const r = calcularCargoDistribuido({
      distribuciones: [distLunAJue(), distVie()],
      fechaInicio: '2026-07-21', fechaFin: '2026-07-25',
      salarioMensual: 1750905, headcount: 1,
    }, 0);
    expect(r.buckets.recargoNocturno).toBe(0);
    expect(r.buckets.extraNocturna).toBe(0);
    expect(r.buckets.recargoNocturnoDominical).toBe(0);
    expect(r.buckets.extraNocturnaFestiva).toBe(0);
  });
});

describe('calcularCargoDistribuido — auxilio (D)', () => {
  it('dos y tres distribuciones no duplican ni triplican el auxilio (se recibe ya calculado una vez)', () => {
    const r2 = calcularCargoDistribuido({ distribuciones: [distLunAJue(), distVie()], fechaInicio: '2026-07-21', fechaFin: '2026-07-25', salarioMensual: 1750905, headcount: 1 }, 249095);
    expect(r2.auxTransporte).toBe(249095);
  });

  it('dos trabajadores: el auxilio recibido ya viene multiplicado por el llamador, aquí solo se suma una vez al total', () => {
    const r = calcularCargoDistribuido({ distribuciones: [distLunAJue(), distVie()], fechaInicio: '2026-07-21', fechaFin: '2026-07-25', salarioMensual: 1750905, headcount: 2 }, 249095 * 2);
    expect(r.auxTransporte).toBe(498190);
    expect(r.totalPeriodo).toBe(r.salarioBasico + r.costoRecargos + 498190);
  });
});

describe('calcularCargoDistribuido — caso de regresión 46 horas, clasificación cronológica', () => {
  const distLunAJue720: DistribucionHorarioConfigurada = {
    idCliente: 'r1', empresa: 'aseo', codigo: '1', horario: '08:00-12:30 Y 14:00-18:00', jornada: '', turno: '',
    diasSemana: ['L', 'M', 'X', 'J'],
    bloques: [{ inicio: '08:00', fin: '12:30', orden: 1 }, { inicio: '14:00', fin: '18:00', orden: 2 }],
    excepcionesFecha: [], sincronizadoExterno: false,
  };
  const distVie720: DistribucionHorarioConfigurada = {
    idCliente: 'r2', empresa: 'aseo', codigo: '2', horario: '08:00-12:00 Y 14:00-22:00', jornada: '', turno: '',
    diasSemana: ['V'],
    bloques: [{ inicio: '08:00', fin: '12:00', orden: 1 }, { inicio: '14:00', fin: '22:00', orden: 2 }],
    excepcionesFecha: [], sincronizadoExterno: false,
  };
  // Lunes 20/07/2026 a viernes 24/07/2026 — semana completa dentro del período.
  const r = calcularCargoDistribuido({
    distribuciones: [distLunAJue720, distVie720],
    fechaInicio: '2026-07-20', fechaFin: '2026-07-24',
    salarioMensual: 1750905, headcount: 1,
  }, 249095);

  it('1. caso exacto: ordinaria 42h, RN 0, HED 1h, HEN 3h', () => {
    expect(r.buckets.ordinariaHabil / 60).toBeCloseTo(42, 6);
    expect(r.buckets.recargoNocturno).toBe(0);
    expect(r.buckets.extraDiurna / 60).toBeCloseTo(1, 6);
    expect(r.buckets.extraNocturna / 60).toBeCloseTo(3, 6);
    expect(r.buckets.ordinariaDominical).toBe(0);
    expect(r.buckets.recargoNocturnoDominical).toBe(0);
    expect(r.buckets.extraDiurnaFestiva).toBe(0);
    expect(r.buckets.extraNocturnaFestiva).toBe(0);
  });

  it('2. no hay reparto proporcional: nunca produce ordinaria 40 / RN 2 / HED 3 / HEN 1', () => {
    expect(r.buckets.ordinariaHabil).not.toBe(2400); // 40h en minutos
    expect(r.buckets.recargoNocturno).not.toBe(120); // 2h
  });

  it('3-4. el corte ocurre exactamente en el minuto 2520 (18:00) y el nocturno exactamente a las 19:00', () => {
    // 240(ord)+240(ord)=2520 en 18:00 -> a partir de ahí todo es extra.
    // Verificado indirectamente: HED=60min (18:00-19:00) y HEN=180min (19:00-22:00).
    expect(r.buckets.extraDiurna).toBe(60);
    expect(r.buckets.extraNocturna).toBe(180);
  });

  it('5. sobretiempo = $54.195 (HED $10.422 + HEN $43.773), con RN adicional 0.35', () => {
    const valorHoraExacto = 1750905 / 210;
    const hed = Math.round(valorHoraExacto * 1.25 * (60 / 60));
    const hen = Math.round(valorHoraExacto * 1.75 * (180 / 60));
    expect(hed).toBe(10422);
    expect(hen).toBe(43773);
    expect(r.costoRecargos).toBe(54195);
  });

  it('6. total principal = $2.054.195, valor hora exacto sin redondeo prematuro', () => {
    expect(r.valorHoraExacto).toBeCloseTo(8337.642857142857, 6);
    expect(r.totalPeriodo).toBe(2054195);
  });
});

describe('calcularCargoDistribuido — estados (G)', () => {
  it('caso obligatorio = CALCULADO', () => {
    const r = calcularCargoDistribuido({ distribuciones: [distLunAJue(), distVie()], fechaInicio: '2026-07-21', fechaFin: '2026-07-25', salarioMensual: 1750905, headcount: 1 }, 249095);
    expect(r.estado).toBe('CALCULADO');
  });

  it('sin distribuciones = INCONSISTENTE', () => {
    const r = calcularCargoDistribuido({ distribuciones: [], fechaInicio: '2026-07-21', fechaFin: '2026-07-25', salarioMensual: 1750905, headcount: 1 }, 0);
    expect(r.estado).toBe('INCONSISTENTE');
  });

  it('plazo inválido (fin antes de inicio) = INCONSISTENTE', () => {
    const r = calcularCargoDistribuido({ distribuciones: [distLunAJue()], fechaInicio: '2026-07-25', fechaFin: '2026-07-21', salarioMensual: 1750905, headcount: 1 }, 0);
    expect(r.estado).toBe('INCONSISTENTE');
  });

  it('distribución sin bloques = INCONSISTENTE', () => {
    const sinBloques: DistribucionHorarioConfigurada = { idCliente: 'x', empresa: 'aseo', codigo: '1', horario: '', jornada: '', turno: '', diasSemana: ['L'], bloques: [], excepcionesFecha: [], sincronizadoExterno: false };
    const r = calcularCargoDistribuido({ distribuciones: [sinBloques], fechaInicio: '2026-07-21', fechaFin: '2026-07-25', salarioMensual: 1750905, headcount: 1 }, 0);
    expect(r.estado).toBe('INCONSISTENTE');
  });
});

describe('calcularCargoDistribuido — festivo trabajado (20/07/2026, lunes festivo)', () => {
  const distLunAJue720: DistribucionHorarioConfigurada = {
    idCliente: 'f1', empresa: 'aseo', codigo: '1', horario: '08:00-12:30 Y 14:00-18:00', jornada: '', turno: '',
    diasSemana: ['L', 'M', 'X', 'J'],
    bloques: [{ inicio: '08:00', fin: '12:30', orden: 1 }, { inicio: '14:00', fin: '18:00', orden: 2 }],
    excepcionesFecha: [], sincronizadoExterno: false,
  };
  const distVie720: DistribucionHorarioConfigurada = {
    idCliente: 'f2', empresa: 'aseo', codigo: '2', horario: '08:00-12:00 Y 14:00-22:00', jornada: '', turno: '',
    diasSemana: ['V'],
    bloques: [{ inicio: '08:00', fin: '12:00', orden: 1 }, { inicio: '14:00', fin: '22:00', orden: 2 }],
    excepcionesFecha: [], sincronizadoExterno: false,
  };

  it('1. 20/07/2026 se detecta como festivo', () => {
    expect(esFechaFestiva('2026-07-20', FESTIVOS_COLOMBIA_2026)).toBe(true);
    expect(esFechaFestiva('2026-07-21', FESTIVOS_COLOMBIA_2026)).toBe(false);
  });

  const r = calcularCargoDistribuido({
    distribuciones: [distLunAJue720, distVie720],
    fechaInicio: '2026-07-20', fechaFin: '2026-07-24',
    salarioMensual: 1750905, headcount: 1,
  }, 249095, FESTIVOS_COLOMBIA_2026);

  it('2. festivo trabajado produce 8,50 h en el bucket dominical/festiva', () => {
    expect(r.buckets.ordinariaDominical / 60).toBeCloseTo(8.5, 6);
  });

  it('3. festivo trabajado por defecto produce cantidadDias=5 (sin checkbox ni bandera)', () => {
    expect(r.cantidadDias).toBe(5);
  });

  it('3b. una excepción explícita EXCLUIR sobre la fecha festiva produce cantidadDias=4, no 5', () => {
    const conExcepcion: DistribucionHorarioConfigurada = {
      ...distLunAJue720,
      excepcionesFecha: [{ fecha: '2026-07-20', accion: 'EXCLUIR' }],
    };
    const r2 = calcularCargoDistribuido({
      distribuciones: [conExcepcion, distVie720],
      fechaInicio: '2026-07-20', fechaFin: '2026-07-24',
      salarioMensual: 1750905, headcount: 1,
    }, 249095, FESTIVOS_COLOMBIA_2026);
    expect(r2.cantidadDias).toBe(4);
  });

  it('4. se mantienen 1 h HED + 3 h HEN del viernes cuando el lunes es trabajado', () => {
    expect(r.buckets.extraDiurna / 60).toBeCloseTo(1, 6);
    expect(r.buckets.extraNocturna / 60).toBeCloseTo(3, 6);
  });

  it('5. total de minutos trabajados = 46 horas (2760 min)', () => {
    expect(r.minutosPeriodo).toBe(2760);
  });

  it('6. total recargos/sobretiempo = $117.978', () => {
    expect(r.costoRecargos).toBe(117978);
  });

  it('7. total principal = $2.117.978', () => {
    expect(r.totalPeriodo).toBe(2117978);
  });

  it('conceptos mutuamente excluyentes: RN=0, extra festiva=0, extra festiva nocturna=0, RN festivo=0', () => {
    expect(r.buckets.recargoNocturno).toBe(0);
    expect(r.buckets.extraDiurnaFestiva).toBe(0);
    expect(r.buckets.extraNocturnaFestiva).toBe(0);
    expect(r.buckets.recargoNocturnoDominical).toBe(0);
  });
});
