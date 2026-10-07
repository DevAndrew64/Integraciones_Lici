/**
 * Tests unitarios — Motor determinístico Mano de Obra
 * Renombrado de test-motor.ts a *.test.ts para entrar a CI (docs/plan-implementacion-mano-obra.md §7).
 * Contenido de las assertions SIN TOCAR; solo se adaptó el arnés (import de vitest,
 * envoltura en it(), y el resumen final que ya no usa process.exit).
 *
 * Fase 1 original: casos 1-10b (59 assertions)
 * Fase 1.1: casos 11-15 (5 casos nuevos de ajustes finos)
 */

import { it, expect } from 'vitest';
import {
  parseHora,
  calcularHorasBrutas,
  detectarCruceMedianoche,
  dividirTurnoPorDiaCalendario,
  calcularHorasNetas,
  contarHorasNocturnas,
  consultarTipoDia,
  esTurnoMixto,
  procesarCargo,
  calcularFTE,
  detectarNecesidadTurnante,
  generarInputsMensuales,
  type ParamsMotorMO,
  type CargoEntrada,
  type DesgloseSemanal,
} from './motor-mano-obra';

it('Motor determinístico Mano de Obra — Fase 1/1.1 (casos y ajustes finos)', () => {

// ─── Parámetros 2026 ─────────────────────────────────────────────────────────

const PARAMS_2026: ParamsMotorMO = {
  anio: 2026,
  jornadaMaxSemana: 44,
  divisorHora: 240,
  factorMensual: 4.333,
  metodoPeriodo: 'factor',
  horaInicioNocturna: 19,
  horaFinNocturna: 6,
  recargoNocturno: 0.35,
  recargoExtraDiurno: 0.25,
  recargoExtraNocturno: 0.75,
  recargoDominical: 0.75,
  recargoDominicalNoc: 0.75,
  recargoFestivoDiu: 0.75,
  recargoFestivoNoc: 0.75,
};

const FESTIVOS_VACIOS = new Set<string>();
const FESTIVOS_2026   = new Set([
  '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03',
  '2026-05-01', '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29',
  '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02',
  '2026-11-16', '2026-12-08', '2026-12-25',
]);

// ─── Utilidad de assertions ──────────────────────────────────────────────────

let pasados = 0, fallidos = 0;

function assert(desc: string, condicion: boolean, detalle?: string) {
  if (condicion) {
    console.log(`  ✅ ${desc}`);
    pasados++;
  } else {
    console.error(`  ❌ FALLA: ${desc}${detalle ? ' → ' + detalle : ''}`);
    fallidos++;
  }
}

function assertAprox(desc: string, valor: number, esperado: number, margen = 0.15) {
  const ok = Math.abs(valor - esperado) <= margen;
  assert(desc, ok, ok ? '' : `valor=${valor.toFixed(3)}, esperado=${esperado}`);
}

function casoInicio(nombre: string) {
  console.log(`\n▶ ${nombre}`);
}

// ════════════════════════════════════════════════════════════
// FASE 1 — Casos originales (sin modificar)
// ════════════════════════════════════════════════════════════

casoInicio('Caso 1 — Helpers: parseHora, calcularHorasBrutas, detectarCruceMedianoche');

assert('parseHora("21:30") = 21.5',    parseHora('21:30') === 21.5);
assert('parseHora("07:00") = 7',       parseHora('07:00') === 7);
assert('parseHora("00:00") = 0',       parseHora('00:00') === 0);
assertAprox('calcularHorasBrutas 08:00-17:00 = 9h',              calcularHorasBrutas('08:00','17:00'), 9);
assertAprox('calcularHorasBrutas 21:00-07:00 = 10h (cruza)',     calcularHorasBrutas('21:00','07:00'), 10);
// Ajuste #1 Fase 1.1: 07:00-17:00 son 10h brutas, no 9
assertAprox('calcularHorasBrutas 07:00-17:00 = 10h brutas',      calcularHorasBrutas('07:00','17:00'), 10);
assert('detectarCruceMedianoche 21:00-07:00 = true',  detectarCruceMedianoche('21:00','07:00'));
assert('detectarCruceMedianoche 08:00-17:00 = false', !detectarCruceMedianoche('08:00','17:00'));
assert('detectarCruceMedianoche 22:00-06:00 = true',  detectarCruceMedianoche('22:00','06:00'));

// ─────────────────────────────────────────────────────────────────────────────

casoInicio('Caso 2 — contarHorasNocturnas (inicio nocturno 19:00 — Ley 2466/2025)');

const NOC_INI = 19, NOC_FIN = 6;
assert('13:00-21:00 → 2h noc (19,20)',
  contarHorasNocturnas(13, 8, NOC_INI, NOC_FIN) === 2);
assert('08:00-17:00 → 0h noc',
  contarHorasNocturnas(8, 9, NOC_INI, NOC_FIN) === 0);
assert('19:00-23:00 → 4h noc',
  contarHorasNocturnas(19, 4, NOC_INI, NOC_FIN) === 4);
assert('00:00-07:00 → 6h noc (0-5 noc, 6 diu)',
  contarHorasNocturnas(0, 7, NOC_INI, NOC_FIN) === 6);
assert('21:00-24:00 → 3h noc',
  contarHorasNocturnas(21, 3, NOC_INI, NOC_FIN) === 3);

// ─────────────────────────────────────────────────────────────────────────────

casoInicio('Caso 3 — L-V 07:00-16:00, descanso 60min no computable');

{
  // 9h brutas − 1h desc = 8h netas × 5d = 40h
  const cargo: CargoEntrada = {
    cargoNormalizado: 'Operario de Aseo',
    cantidadSolicitada: 1,
    tipoCobertura: 'persona',
    jornadaSemanalDeclarada: 40,
    diaDescansoObligatorio: null,
    turnos: [{
      dias: ['L','M','X','J','V'],
      horaInicio: '07:00', horaFin: '16:00',
      descansoMinutos: 60, descansoComputable: false,
    }],
    claseRiesgoArl: 'II', requiereValidacionArl: false, requiereAlturas: false,
  };
  const r = procesarCargo(cargo, PARAMS_2026, FESTIVOS_VACIOS);

  assertAprox('jornada calculada = 40h/sem', r.jornadaCalculada, 40);
  assert('coincide jornada declarada (40h)', r.coincideJornada);
  assert('0 horas extra', r.desgloseSemanal.horasExtra === 0);
  assert('0 horas nocturnas', r.desgloseSemanal.horasNocturnas === 0);
  assertAprox('40h ord diurnas', r.desgloseSemanal.ordDiu, 40);
  // Ajuste #2 Fase 1.1: horasServicioSemana = 40, no 44
  assert('horasServicioSemana = 40 (no 44)',
    r.inputsMensuales.horasServicioSemana === 40);
  assert('jornadaBaseLegalSemana = 44',
    r.inputsMensuales.jornadaBaseLegalSemana === 44);
  assert('horasOrdinariasSemana = 40',
    r.inputsMensuales.horasOrdinariasSemana === 40);
  assert('exportableAlTabActual = true (persona)',
    r.inputsMensuales.exportableAlTabActual);
}

// ─────────────────────────────────────────────────────────────────────────────

casoInicio('Caso 4 — L-V 13:00-21:00 (2h nocturnas x día)');

{
  const cargo: CargoEntrada = {
    cargoNormalizado: 'Conserje / Portero',
    cantidadSolicitada: 1,
    tipoCobertura: 'persona',
    jornadaSemanalDeclarada: 40,
    diaDescansoObligatorio: null,
    turnos: [{
      dias: ['L','M','X','J','V'],
      horaInicio: '13:00', horaFin: '21:00',
      descansoMinutos: 0, descansoComputable: false,
    }],
    claseRiesgoArl: 'I', requiereValidacionArl: false, requiereAlturas: false,
  };
  const r = procesarCargo(cargo, PARAMS_2026, FESTIVOS_VACIOS);

  assertAprox('jornada calculada = 40h/sem', r.jornadaCalculada, 40);
  assertAprox('10h nocturnas ordinarias', r.desgloseSemanal.ordNoc, 10);
  assertAprox('30h diurnas ordinarias',   r.desgloseSemanal.ordDiu, 30);
  assert('0 horas extra',                 r.desgloseSemanal.horasExtra === 0);
  assertAprox('hRecNocHabil mensual ≈ 43.33h', r.inputsMensuales.hRecNocHabil, 43.33, 0.5);
  assert('metodoPeriodo = factor',        r.inputsMensuales.metodoPeriodo === 'factor');
  // Ajuste #2: horasServicioSemana = 40
  assert('horasServicioSemana = 40',      r.inputsMensuales.horasServicioSemana === 40);
}

// ─────────────────────────────────────────────────────────────────────────────

casoInicio('Caso 5 — S 21:00-D 07:00 (cruce de medianoche)');

{
  const segs = dividirTurnoPorDiaCalendario({
    dias: ['S'], horaInicio: '21:00', horaFin: '07:00',
    descansoMinutos: 0, descansoComputable: false,
  });

  assert('genera 2 segmentos',     segs.length === 2);
  assert('primer seg en S',        segs[0].dias.includes('S'));
  assert('segundo seg en D',       segs[1].dias.includes('D'));
  assertAprox('seg S = 3h',        segs[0].durH, 3);
  assertAprox('seg D = 7h',        segs[1].durH, 7);

  const cargo: CargoEntrada = {
    cargoNormalizado: 'Vigilante',
    cantidadSolicitada: 1,
    tipoCobertura: 'persona',
    jornadaSemanalDeclarada: 10,
    diaDescansoObligatorio: null,
    turnos: [{
      dias: ['S'], horaInicio: '21:00', horaFin: '07:00',
      descansoMinutos: 0, descansoComputable: false,
    }],
    claseRiesgoArl: 'IV', requiereValidacionArl: false, requiereAlturas: false,
  };
  const r = procesarCargo(cargo, PARAMS_2026, FESTIVOS_VACIOS);

  assertAprox('jornada total = 10h', r.jornadaCalculada, 10);
  assertAprox('3h ord noc hábil (S)', r.desgloseSemanal.ordNoc, 3);
  assertAprox('6h dom ord noc',       r.desgloseSemanal.domOrdNoc, 6);
  assertAprox('1h dom ord diu',       r.desgloseSemanal.domOrdDiu, 1);
}

// ─────────────────────────────────────────────────────────────────────────────

casoInicio('Caso 6 — Conserje 24/7: FTE y turnantes');

{
  const cargo: CargoEntrada = {
    cargoNormalizado: 'Conserje / Portero',
    cantidadSolicitada: 1,
    tipoCobertura: 'puesto',
    jornadaSemanalDeclarada: null,
    diaDescansoObligatorio: null,
    turnos: [
      { dias: ['L','M','X','J','V','S','D'], horaInicio: '06:00', horaFin: '14:00', descansoMinutos: 0, descansoComputable: false },
      { dias: ['L','M','X','J','V','S','D'], horaInicio: '14:00', horaFin: '22:00', descansoMinutos: 0, descansoComputable: false },
      { dias: ['L','M','X','J','V','S','D'], horaInicio: '22:00', horaFin: '06:00', descansoMinutos: 0, descansoComputable: false },
    ],
    claseRiesgoArl: 'I', requiereValidacionArl: false, requiereAlturas: false,
  };
  const r = procesarCargo(cargo, PARAMS_2026, FESTIVOS_VACIOS);

  assertAprox('FTE teórico ≈ 3.82', r.fteTeorico, 3.818, 0.05);
  assert('cantidadPersonasCalculadas = 4', r.cantidadPersonasCalculadas === 4);
  assert('requiereTurnante = true',        r.requiereTurnante);
  // Ajuste #3 Fase 1.1: 24/7 no es exportable al tab actual
  assert('exportableAlTabActual = false',  !r.inputsMensuales.exportableAlTabActual);
  assert('modoCosteo = requiere_distribucion_por_rotacion',
    r.inputsMensuales.modoCosteo === 'requiere_distribucion_por_rotacion');
  assert('motivoNoExportable presente',
    typeof r.inputsMensuales.motivoNoExportable === 'string' && r.inputsMensuales.motivoNoExportable.length > 0);
  // Ajuste #4 Fase 1.1: alerta explícita COBERTURA_INSUFICIENTE_FTE
  assert('alerta COBERTURA_INSUFICIENTE_FTE presente',
    r.alertas.some(a => a.codigo === 'COBERTURA_INSUFICIENTE_FTE'));
}

// ─────────────────────────────────────────────────────────────────────────────

casoInicio('Caso 7 — calcularFTE función independiente');

assertAprox('168h/44h = 3.818', calcularFTE(168, 44), 3.818, 0.01);
assertAprox('44h/44h = 1.0',   calcularFTE(44, 44),  1.0,   0.01);
assertAprox('56h/44h = 1.27',  calcularFTE(56, 44),  1.27,  0.01);
assert('detectarNecesidadTurnante(3.82, 1) = true',  detectarNecesidadTurnante(3.82, 1));
assert('detectarNecesidadTurnante(1.0, 1) = false', !detectarNecesidadTurnante(1.0, 1));
assert('detectarNecesidadTurnante(1.5, 2) = false', !detectarNecesidadTurnante(1.5, 2));

// ─────────────────────────────────────────────────────────────────────────────

casoInicio('Caso 8 — Jornada parcial sin turnos definidos');

{
  const cargo: CargoEntrada = {
    cargoNormalizado: 'Auxiliar de Cafetería',
    cantidadSolicitada: 1,
    tipoCobertura: 'persona',
    jornadaSemanalDeclarada: null,
    diaDescansoObligatorio: null,
    turnos: [],
    claseRiesgoArl: 'I', requiereValidacionArl: false, requiereAlturas: false,
    esJornadaParcialSinHoras: true,
  };
  const r = procesarCargo(cargo, PARAMS_2026, FESTIVOS_VACIOS);

  assert('jornada calculada = 0', r.jornadaCalculada === 0);
  assert('alerta JORNADA_PARCIAL_SIN_HORAS',
    r.alertas.some(a => a.codigo === 'JORNADA_PARCIAL_SIN_HORAS'));
  assert('alerta severidad ALTA',
    r.alertas.some(a => a.codigo === 'JORNADA_PARCIAL_SIN_HORAS' && a.severidad === 'ALTA'));
  assert('pregunta urgente sobre horario',
    r.preguntas.some(p => p.prioridad === 'urgente'));
}

// ─────────────────────────────────────────────────────────────────────────────

casoInicio('Caso 9 — Todero sin confirmar alturas');

{
  const cargo: CargoEntrada = {
    cargoNormalizado: 'Todero',
    cantidadSolicitada: 1,
    tipoCobertura: 'persona',
    jornadaSemanalDeclarada: 44,
    diaDescansoObligatorio: null,
    turnos: [{
      dias: ['L','M','X','J','V'],
      horaInicio: '07:00', horaFin: '17:00',
      descansoMinutos: 60, descansoComputable: false,
    }],
    claseRiesgoArl: 'III', requiereValidacionArl: false, requiereAlturas: null,
  };
  const r = procesarCargo(cargo, PARAMS_2026, FESTIVOS_VACIOS);

  assert('alerta ALTURAS_SIN_CONFIRMAR',
    r.alertas.some(a => a.codigo === 'ALTURAS_SIN_CONFIRMAR'));
  assert('alerta severidad ALTA',
    r.alertas.some(a => a.codigo === 'ALTURAS_SIN_CONFIRMAR' && a.severidad === 'ALTA'));
  assert('pregunta sobre alturas generada',
    r.preguntas.some(p => p.pregunta.toLowerCase().includes('altura')));
}

// ─────────────────────────────────────────────────────────────────────────────

casoInicio('Caso 10 — Factor mensual parametrizable (ajuste #6 arquitectura)');

{
  const desgloseMock: DesgloseSemanal = {
    ordDiu: 30, ordNoc: 10, extDiu: 0, extNoc: 0,
    domOrdDiu: 1, domOrdNoc: 6, domExtDiu: 0, domExtNoc: 0,
    festOrdDiu: 0, festOrdNoc: 0, festExtDiu: 0, festExtNoc: 0,
    totalSemana: 47, horasExtra: 0, horasNocturnas: 10,
  };
  const cargoMock: CargoEntrada = {
    cargoNormalizado: 'Mock', cantidadSolicitada: 1, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null, turnos: [],
    claseRiesgoArl: 'I', requiereValidacionArl: false, requiereAlturas: false,
  };

  const imFactor  = generarInputsMensuales(desgloseMock, PARAMS_2026, cargoMock);
  assertAprox('hRecNocHabil con factor 4.333 = 43.33h', imFactor.hRecNocHabil, 43.33, 0.5);
  assert('factorMensual = 4.333',  imFactor.factorMensual === 4.333);

  const paramsDM: ParamsMotorMO = { ...PARAMS_2026, metodoPeriodo: 'dias_mes' };
  const imDM = generarInputsMensuales(desgloseMock, paramsDM, cargoMock);
  assertAprox('hRecNocHabil con dias_mes = 42.86h', imDM.hRecNocHabil, 10 * (30/7), 0.5);
  assert('factorMensual dias_mes ≠ 4.333', Math.abs(imDM.factorMensual - 4.333) > 0.01);

  const params42: ParamsMotorMO = { ...PARAMS_2026, jornadaMaxSemana: 42 };
  const im42 = generarInputsMensuales(desgloseMock, params42, cargoMock);
  assert('jornadaBaseLegalSemana refleja 42', im42.jornadaBaseLegalSemana === 42);
}

// ─────────────────────────────────────────────────────────────────────────────

casoInicio('Caso 10b — consultarTipoDia con CalendarioFestivos real');

assert('Jun 29 (L) festivo = festivo',
  consultarTipoDia('L', FESTIVOS_2026, new Date('2026-06-29T12:00:00Z')) === 'festivo');
assert('Jul 5 (D) = dominical',
  consultarTipoDia('D', FESTIVOS_2026, new Date('2026-07-05T12:00:00Z')) === 'dominical');
assert('Jul 20 (L) = festivo',
  consultarTipoDia('L', FESTIVOS_2026, new Date('2026-07-20T12:00:00Z')) === 'festivo');
assert('Jun 3 (X) sin festivos = habil',
  consultarTipoDia('X', FESTIVOS_VACIOS, new Date('2026-06-03T12:00:00Z')) === 'habil');

// ════════════════════════════════════════════════════════════
// FASE 1.1 — 5 casos nuevos de ajustes finos
// ════════════════════════════════════════════════════════════

casoInicio('Caso 11 — Jornada parcial 10h: horasServicioSemana debe ser 10, no 44');

{
  // Persona que trabaja 2h/día L-V = 10h/sem
  const cargo: CargoEntrada = {
    cargoNormalizado: 'Auxiliar de Cafetería',
    cantidadSolicitada: 1,
    tipoCobertura: 'persona',
    jornadaSemanalDeclarada: 10,
    diaDescansoObligatorio: null,
    turnos: [{
      dias: ['L','M','X','J','V'],
      horaInicio: '10:00', horaFin: '12:00',
      descansoMinutos: 0, descansoComputable: false,
    }],
    claseRiesgoArl: 'I', requiereValidacionArl: false, requiereAlturas: false,
  };
  const r = procesarCargo(cargo, PARAMS_2026, FESTIVOS_VACIOS);

  assertAprox('jornada calculada = 10h/sem', r.jornadaCalculada, 10);
  // Ajuste #2 Fase 1.1: campo no ambiguo
  assert('horasServicioSemana = 10 (no 44)',
    r.inputsMensuales.horasServicioSemana === 10);
  assert('jornadaBaseLegalSemana = 44 (ley)',
    r.inputsMensuales.jornadaBaseLegalSemana === 44);
  assert('horasOrdinariasSemana = 10',
    r.inputsMensuales.horasOrdinariasSemana === 10);
  assert('0 horas extra (dentro del presupuesto)',
    r.desgloseSemanal.horasExtra === 0);
  assert('exportableAlTabActual = true (es persona)',
    r.inputsMensuales.exportableAlTabActual);
  assert('modoCosteo = individual',
    r.inputsMensuales.modoCosteo === 'individual');
}

// ─────────────────────────────────────────────────────────────────────────────

casoInicio('Caso 12 — 24/7 exportableAlTabActual debe ser false');

{
  // Reutiliza estructura de Caso 6
  const cargo: CargoEntrada = {
    cargoNormalizado: 'Conserje / Portero',
    cantidadSolicitada: 1,
    tipoCobertura: 'puesto',
    jornadaSemanalDeclarada: null,
    diaDescansoObligatorio: null,
    turnos: [
      { dias: ['L','M','X','J','V','S','D'], horaInicio: '06:00', horaFin: '14:00', descansoMinutos: 0, descansoComputable: false },
      { dias: ['L','M','X','J','V','S','D'], horaInicio: '14:00', horaFin: '22:00', descansoMinutos: 0, descansoComputable: false },
      { dias: ['L','M','X','J','V','S','D'], horaInicio: '22:00', horaFin: '06:00', descansoMinutos: 0, descansoComputable: false },
    ],
    claseRiesgoArl: 'I', requiereValidacionArl: false, requiereAlturas: false,
  };
  const r = procesarCargo(cargo, PARAMS_2026, FESTIVOS_VACIOS);

  // Ajuste #3 Fase 1.1
  assert('exportableAlTabActual = false',
    r.inputsMensuales.exportableAlTabActual === false);
  assert('modoCosteo = requiere_distribucion_por_rotacion',
    r.inputsMensuales.modoCosteo === 'requiere_distribucion_por_rotacion');
  assert('motivoNoExportable es string con contenido',
    typeof r.inputsMensuales.motivoNoExportable === 'string' &&
    r.inputsMensuales.motivoNoExportable.length > 10);
  // Ajuste #2: horasServicioSemana = 44 por persona (no 168 de cobertura total)
  assert('horasServicioSemana = 44 por persona (no 168)',
    r.inputsMensuales.horasServicioSemana === 44);
  // Ajuste #4: alerta COBERTURA_INSUFICIENTE_FTE
  assert('alerta COBERTURA_INSUFICIENTE_FTE presente',
    r.alertas.some(a => a.codigo === 'COBERTURA_INSUFICIENTE_FTE'));
  assert('alerta COBERTURA_INSUFICIENTE_FTE severidad ALTA',
    r.alertas.some(a => a.codigo === 'COBERTURA_INSUFICIENTE_FTE' && a.severidad === 'ALTA'));
  assert('mensaje incluye número de personas',
    r.alertas.some(a => a.codigo === 'COBERTURA_INSUFICIENTE_FTE' &&
      a.mensaje.includes('4')));
}

// ─────────────────────────────────────────────────────────────────────────────

casoInicio('Caso 13 — 50h semanales: no forzar turnante, alerta de validación horas extra');

{
  // L-V 07:00-17:00 (10h brutas − 1h desc = 9h netas) + S 07:00-12:00 (5h)
  // Total = 9×5 + 5 = 50h → 6h extra. tipoCobertura='persona' → requiereTurnante=false
  const cargo: CargoEntrada = {
    cargoNormalizado: 'Operario de Aseo',
    cantidadSolicitada: 1,
    tipoCobertura: 'persona',  // <-- persona, no puesto
    jornadaSemanalDeclarada: 44,
    diaDescansoObligatorio: null,
    turnos: [
      { dias: ['L','M','X','J','V'], horaInicio: '07:00', horaFin: '17:00', descansoMinutos: 60, descansoComputable: false },
      { dias: ['S'], horaInicio: '07:00', horaFin: '12:00', descansoMinutos: 0, descansoComputable: false },
    ],
    claseRiesgoArl: 'II', requiereValidacionArl: false, requiereAlturas: false,
  };
  const r = procesarCargo(cargo, PARAMS_2026, FESTIVOS_VACIOS);

  assertAprox('jornada calculada = 50h', r.jornadaCalculada, 50);
  assert('6h extra',                     r.desgloseSemanal.horasExtra === 6);
  // Ajuste #5 Fase 1.1: NO es turnante por ser persona con horas extra
  assert('requiereTurnante = false (persona, no puesto)',
    r.requiereTurnante === false);
  // personasConHorasExtra=1 (50h < 56h max), personasSinHorasExtra=2
  assert('personasConHorasExtra = 1 (cabe con sobretiempo)',
    r.personasConHorasExtra === 1);
  assert('personasSinHorasExtra = 2',
    r.personasSinHorasExtra === 2);
  assert('requiereValidacionHorasExtra = true',
    r.requiereValidacionHorasExtra === true);
  // Alerta de validación (no FTE insuficiente, sino sobretiempo a confirmar)
  assert('alerta VALIDAR_HORAS_EXTRA presente',
    r.alertas.some(a => a.codigo === 'VALIDAR_HORAS_EXTRA'));
  // Alerta EXCEDE_JORNADA_LEGAL presente (50h > 44h)
  assert('alerta EXCEDE_JORNADA_LEGAL presente',
    r.alertas.some(a => a.codigo === 'EXCEDE_JORNADA_LEGAL'));
  // SIN alerta COBERTURA_INSUFICIENTE_FTE (no es puesto)
  assert('SIN alerta COBERTURA_INSUFICIENTE_FTE (es persona)',
    !r.alertas.some(a => a.codigo === 'COBERTURA_INSUFICIENTE_FTE'));
}

// ─────────────────────────────────────────────────────────────────────────────

casoInicio('Caso 14 — Turno mixto con descanso sin hora exacta: alerta DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO');

{
  // esTurnoMixto: verificar directamente
  assert('13:00-22:00 es mixto (6 diu + 3 noc)',
    esTurnoMixto('13:00', '22:00', PARAMS_2026));
  assert('14:00-22:00 es mixto (5 diu + 3 noc)',
    esTurnoMixto('14:00', '22:00', PARAMS_2026));
  assert('07:00-16:00 NO es mixto (todo diurno)',
    !esTurnoMixto('07:00', '16:00', PARAMS_2026));
  assert('22:00-06:00 NO es mixto (todo nocturno)',
    !esTurnoMixto('22:00', '06:00', PARAMS_2026));

  // Cargo con turno mixto y descanso sin hora exacta
  const cargo: CargoEntrada = {
    cargoNormalizado: 'Conserje / Portero',
    cantidadSolicitada: 1,
    tipoCobertura: 'persona',
    jornadaSemanalDeclarada: 40,
    diaDescansoObligatorio: null,
    turnos: [{
      dias: ['L','M','X','J','V'],
      horaInicio: '14:00', horaFin: '22:00',
      descansoMinutos: 30,
      descansoComputable: false,
      metodoDistribucionDescanso: 'no_informado',  // sin hora exacta
    }],
    claseRiesgoArl: 'I', requiereValidacionArl: false, requiereAlturas: false,
  };
  const r = procesarCargo(cargo, PARAMS_2026, FESTIVOS_VACIOS);

  assert('alerta DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO presente',
    r.alertas.some(a => a.codigo === 'DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO'));
  assert('alerta severidad MEDIA',
    r.alertas.some(a => a.codigo === 'DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO' && a.severidad === 'MEDIA'));

  // Con hora exacta: NO debe generar alerta
  const cargoConHoraExacta: CargoEntrada = {
    ...cargo,
    turnos: [{
      ...cargo.turnos[0],
      descansoHoraInicio: '18:00',
      descansoHoraFin: '18:30',
      metodoDistribucionDescanso: 'exacto',
    }],
  };
  const r2 = procesarCargo(cargoConHoraExacta, PARAMS_2026, FESTIVOS_VACIOS);
  assert('CON hora exacta: SIN alerta DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO',
    !r2.alertas.some(a => a.codigo === 'DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO'));
}

// ─────────────────────────────────────────────────────────────────────────────

casoInicio('Caso 15 — Festivo lunes con fecha concreta: CalendarioFestivos, no Gemini');

{
  // Jun 29, 2026 = lunes festivo (San Pedro y San Pablo)
  // Gemini sugiere 'habil' (incorrecto); backend debe retornar 'festivo'
  const june29 = new Date('2026-06-29T12:00:00Z');
  const tipoDiaConFecha = consultarTipoDia('L', FESTIVOS_2026, june29);

  assert('Jun 29 con fecha exacta = festivo (desde CalendarioFestivos)',
    tipoDiaConFecha === 'festivo');
  assert('Jun 29 con fecha exacta ≠ habil (Gemini ignorado)',
    tipoDiaConFecha !== 'habil');

  // Un lunes regular (Jun 22, 2026) NO es festivo
  const lunesNormal = new Date('2026-06-22T12:00:00Z');
  assert('Jun 22 (L regular) = habil',
    consultarTipoDia('L', FESTIVOS_2026, lunesNormal) === 'habil');

  // Jul 20, 2026 = lunes festivo (Independencia)
  const jul20 = new Date('2026-07-20T12:00:00Z');
  assert('Jul 20 con fecha exacta = festivo',
    consultarTipoDia('L', FESTIVOS_2026, jul20) === 'festivo');

  // Sin fecha específica, Gemini dice 'habil' → el motor también retorna 'habil'
  // (limitación documentada: sin fecha no puede verificar CalendarioFestivos)
  const sinFecha = consultarTipoDia('L', FESTIVOS_2026);  // sin fechaEspecifica
  assert('Sin fecha específica + L = habil (limitación conocida, no es 24/7)',
    sinFecha === 'habil');

  // Dec 8, 2026 = martes festivo (Inmaculada Concepción)
  const dic8 = new Date('2026-12-08T12:00:00Z');
  assert('Dic 8 (M) = festivo',
    consultarTipoDia('M', FESTIVOS_2026, dic8) === 'festivo');
}

// ─── Resumen ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(55)}`);
const total = pasados + fallidos;
console.log(`Resultado: ${pasados} ✅ pasados / ${fallidos} ❌ fallidos de ${total} assertions`);
expect(fallidos, `${fallidos} de ${total} assertions fallaron — ver log arriba`).toBe(0);

}); // it()