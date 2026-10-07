import { describe, it, expect } from 'vitest';
import {
  procesarCargo, distribuirCargoEntreTrabajadores, consolidarHorasMensualesTrabajador,
  type CargoEntrada, type ParamsMotorMO, type DiaSemana,
} from './motor-mano-obra';

const PARAMS: ParamsMotorMO = {
  anio: 2026, jornadaMaxSemana: 44, divisorHora: 220, factorMensual: 4.333,
  metodoPeriodo: 'factor', horaInicioNocturna: 19, horaFinNocturna: 6,
  recargoNocturno: 0.35, recargoExtraDiurno: 0.25, recargoExtraNocturno: 0.75,
  recargoDominical: 0.75, recargoDominicalNoc: 0.75, recargoFestivoDiu: 0.75, recargoFestivoNoc: 0.75,
};

// El caso del conserje: L-V nocturno 18:00-08:00 + bloque continuo S 12:30 → L 08:00 con extensión festiva
const CARGO_CONSERJE: CargoEntrada = {
  cargoNormalizado: 'Conserje/Portero',
  cantidadSolicitada: 1,
  tipoCobertura: 'puesto',
  jornadaSemanalDeclarada: null,
  diaDescansoObligatorio: null,
  turnos: [{
    dias: ['L', 'M', 'X', 'J', 'V'],
    horaInicio: '18:00', horaFin: '08:00',
    descansoMinutos: 0, descansoComputable: false,
  }],
  bloquesContinuos: [{
    diaInicio: 'S', horaInicio: '12:30', diaFin: 'L', horaFin: '08:00',
    descansoMinutos: 0, descansoComputable: false,
    condicionFestivoDiaFin: true, diaFinExtendido: 'M', horaFinExtendido: '08:00',
  }],
  claseRiesgoArl: 'II',
  requiereValidacionArl: false,
  requiereAlturas: false,
};

describe('distribuirCargoEntreTrabajadores', () => {
  it('reparte la cobertura entre N trabajadores en vez de liquidar todo a 1 sola persona', () => {
    const resultado = procesarCargo(CARGO_CONSERJE, PARAMS);
    expect(resultado.cantidadPersonasCalculadas).toBeGreaterThan(1); // 113.5h/44h ≈ 3 personas

    const dist = distribuirCargoEntreTrabajadores('conserje-1', resultado);
    expect(dist.trabajadores.length).toBe(resultado.cantidadPersonasCalculadas);

    // Cada trabajador tiene una fracción de la cobertura total, no la cobertura completa
    const totalCargo = dist.consolidadoCargo.horasMensuales;
    for (const t of dist.trabajadores) {
      expect(t.horasMensuales.ordinarias).toBeLessThan(totalCargo.ordinarias);
    }
  });

  it('la suma de los trabajadores reconstruye el consolidado del cargo (tolerancia de redondeo)', () => {
    const resultado = procesarCargo(CARGO_CONSERJE, PARAMS);
    const dist = distribuirCargoEntreTrabajadores('conserje-1', resultado);
    const sumaOrdinarias = dist.trabajadores.reduce((s, t) => s + t.horasMensuales.ordinarias, 0);
    expect(sumaOrdinarias).toBeCloseTo(dist.consolidadoCargo.horasMensuales.ordinarias, 0);
  });

  it('combina dominical y festivo bajo el bucket "dominical/festiva" (8 buckets, no 11)', () => {
    const resultado = procesarCargo(CARGO_CONSERJE, PARAMS);
    const h = consolidarHorasMensualesTrabajador(resultado.inputsMensuales);
    expect(Object.keys(h).sort()).toEqual([
      'extraDiurnaHabil', 'extraDominicalDiurna', 'extraDominicalNocturna', 'extraNocturnaHabil',
      'ordinariaDominicalDiurna', 'ordinariaDominicalNocturna', 'ordinarias', 'recargoNocturnoHabil',
    ].sort());
  });

  it('un cargo simple (1 persona) también produce el objeto de distribución (n=1)', () => {
    const cargoSimple: CargoEntrada = {
      cargoNormalizado: 'Operario de Aseo', cantidadSolicitada: 1, tipoCobertura: 'persona',
      jornadaSemanalDeclarada: 44, diaDescansoObligatorio: null,
      turnos: [{ dias: ['L', 'M', 'X', 'J', 'V'], horaInicio: '08:00', horaFin: '16:00', descansoMinutos: 60, descansoComputable: false }],
      claseRiesgoArl: 'I', requiereValidacionArl: false, requiereAlturas: false,
    };
    const resultado = procesarCargo(cargoSimple, PARAMS);
    const dist = distribuirCargoEntreTrabajadores('aseo-1', resultado);
    expect(dist.cantidadPersonasCalculada).toBe(1);
    expect(dist.trabajadores.length).toBe(1);
    expect(dist.trabajadores[0].horasMensuales.ordinarias).toBeCloseTo(dist.consolidadoCargo.horasMensuales.ordinarias, 1);
  });
});

describe('festivosIncluidos — override explícito del requisito', () => {
  const cargoBase: CargoEntrada = {
    cargoNormalizado: 'Operario de Aseo', cantidadSolicitada: 1, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    turnos: [{ dias: ['L'], horaInicio: '08:00', horaFin: '17:00', descansoMinutos: 0, descansoComputable: false, tipoDiaGemini: 'festivo' }],
    claseRiesgoArl: 'I', requiereValidacionArl: false, requiereAlturas: false,
  };

  it('sin override: un lunes marcado festivo por la IA se clasifica como festivo', () => {
    const r = procesarCargo(cargoBase, PARAMS, new Set(), new Set<DiaSemana>());
    expect(r.desgloseSemanal.festOrdDiu).toBeGreaterThan(0);
    expect(r.desgloseSemanal.ordDiu).toBe(0);
  });

  it('con festivosIncluidos:false, el turno NO se clasifica como festivo aunque el día lo sea', () => {
    const cargoSinFestivo: CargoEntrada = {
      ...cargoBase,
      turnos: [{ ...cargoBase.turnos[0], festivosIncluidos: false }],
    };
    const r = procesarCargo(cargoSinFestivo, PARAMS, new Set(), new Set<DiaSemana>(['L']));
    expect(r.desgloseSemanal.festOrdDiu).toBe(0);
    expect(r.desgloseSemanal.ordDiu).toBeGreaterThan(0);
  });
});
