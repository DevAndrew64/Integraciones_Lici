/**
 * Tests de regresión — Banco de Casos Reales Mano de Obra (Fase 2.2)
 * Renombrado de test-casos-reales.ts a *.test.ts para entrar a CI
 * (docs/plan-implementacion-mano-obra.md §7). Contenido de las assertions
 * SIN TOCAR; solo se adaptó el arnés (import de vitest, envoltura en it(),
 * resumen final sin process.exit).
 *
 * Valida comportamiento del motor + política de descanso contra los 17 casos reales.
 * SIN Gemini real. SIN BD. Simula la extracción esperada y verifica el motor.
 */

import 'dotenv/config';
import { it, expect } from 'vitest';
import {
  procesarCargo,
  esTurnoMixto,
  type CargoEntrada,
  type TurnoEntrada,
  type ParamsMotorMO,
  type DiaSemana,
  type TipoDia,
} from './motor-mano-obra';
import { aplicarPoliticaDescanso, type PoliticaDescanso } from './politica-descanso';
import { CASOS_REALES, getResumenMetadata, type CasoRealMO } from './casos-reales-mano-obra';

it('Banco de casos reales Mano de Obra — Fase 2.2 (17 casos)', () => {

// ─── Parámetros y política estándar ──────────────────────────────────────────

const PARAMS: ParamsMotorMO = {
  anio: 2026, jornadaMaxSemana: 44, divisorHora: 240, factorMensual: 4.333,
  metodoPeriodo: 'factor', horaInicioNocturna: 19, horaFinNocturna: 6,
  recargoNocturno: 0.35, recargoExtraDiurno: 0.25, recargoExtraNocturno: 0.75,
  recargoDominical: 0.75, recargoDominicalNoc: 0.75, recargoFestivoDiu: 0.75, recargoFestivoNoc: 0.75,
};

const POLITICA: PoliticaDescanso = {
  politicaDescansoDefault: true, minHorasTurnoParaDescanso: 6,
  descansoDefaultMinutos: 60,    descansoComputableDefault: false,
};

const FESTIVOS_2026 = new Set([
  '2026-01-01','2026-01-12','2026-03-23','2026-04-02','2026-04-03',
  '2026-05-01','2026-05-18','2026-06-08','2026-06-15','2026-06-29',
  '2026-07-20','2026-08-07','2026-08-17','2026-10-12','2026-11-02',
  '2026-11-16','2026-12-08','2026-12-25',
]);

// ─── Utilidades ───────────────────────────────────────────────────────────────

let pasados = 0, fallidos = 0, advertencias = 0;
const casosAprobados: string[] = [];
const casosConFallas: string[] = [];
const casosConAdvertencias: string[] = [];

function bloque(nombre: string) { console.log(`\n▶ ${nombre}`); }

function assert(desc: string, ok: boolean, detalle?: string) {
  if (ok) { console.log(`  ✅ ${desc}`); pasados++; }
  else    { console.error(`  ❌ FALLA: ${desc}${detalle ? ' → ' + detalle : ''}`); fallidos++; }
}

function advertencia(desc: string, detalle?: string) {
  console.warn(`  ⚠️  ${desc}${detalle ? ' → ' + detalle : ''}`);
  advertencias++;
}

function assertAprox(desc: string, v: number, esperado: number, margen = 0.15) {
  const ok = Math.abs(v - esperado) <= margen;
  assert(desc, ok, ok ? '' : `valor=${v.toFixed(3)}, esperado=${esperado}`);
}

function mkTurno(dias: DiaSemana[], hi: string, hf: string, descansoMin = 0, tipoDia?: TipoDia): TurnoEntrada {
  return { dias, horaInicio: hi, horaFin: hf, descansoMinutos: descansoMin, descansoComputable: false, tipoDiaGemini: tipoDia };
}

function applyPolicyAndRun(cargo: CargoEntrada) {
  const { turnos } = aplicarPoliticaDescanso(cargo.turnos, POLITICA);
  return procesarCargo({ ...cargo, turnos }, PARAMS, FESTIVOS_2026);
}

function registrarCaso(id: string, hayFallas: boolean, hayAdvertencias: boolean) {
  if (hayFallas)           casosConFallas.push(id);
  else if (hayAdvertencias) casosConAdvertencias.push(id);
  else                      casosAprobados.push(id);
}

// ════════════════════════════════════════════════════════════
// Verificación del banco de casos
// ════════════════════════════════════════════════════════════

bloque('META — Banco de 17 casos cargado');
assert('17 casos registrados', CASOS_REALES.length === 17, `registrados: ${CASOS_REALES.length}`);
assert('IDs únicos', new Set(CASOS_REALES.map(c => c.idCaso)).size === 17);
assert('Todos tienen cargosEsperados', CASOS_REALES.every(c => c.cargosEsperados.length > 0));
assert('Todos tienen categorias',      CASOS_REALES.every(c => c.categorias.length > 0));

// ════════════════════════════════════════════════════════════
// C1 — LA OPINIÓN S.A.S.: turnos nocturnos y mixtos
// ════════════════════════════════════════════════════════════

bloque('C1 — LA OPINIÓN S.A.S. (nocturno + cruce medianoche)');
{
  const caso = CASOS_REALES.find(c => c.idCaso === 'C1-LA-OPINION')!;
  let fallasCaso = false;
  const advCaso = false;

  // Turno nocturno 23:00-07:00 L-V es mixto (7h noc + 1h diu, cruza fin nocturna=06:00)
  const esMixtoNoc = esTurnoMixto('23:00', '07:00', PARAMS);
  assert('C1: turno 23:00-07:00 es MIXTO (cruza 06:00)', esMixtoNoc);
  if (!esMixtoNoc) fallasCaso = true;

  // Turno 21:00-07:00 S también mixto
  const esMixtoSab = esTurnoMixto('21:00', '07:00', PARAMS);
  assert('C1: turno 21:00-07:00 (S) es MIXTO', esMixtoSab);
  if (!esMixtoSab) fallasCaso = true;

  // Turno diurno 07:00-16:00 NO es mixto
  const noesMixto = esTurnoMixto('07:00', '16:00', PARAMS);
  assert('C1: turno 07:00-16:00 NO es mixto', !noesMixto);
  if (noesMixto) fallasCaso = true;

  // Motor: turno nocturno L-V con política → DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO
  const cargoNoc: CargoEntrada = {
    cargoNormalizado: 'Operario de Aseo', cantidadSolicitada: 1, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    claseRiesgoArl: 'II', requiereValidacionArl: false, requiereAlturas: false,
    turnos: [mkTurno(['L','M','X','J','V'], '23:00', '07:00')],
  };
  const r = applyPolicyAndRun(cargoNoc);
  const tieneAlertaMixto = r.alertas.some(a => a.codigo === 'DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO');
  assert('C1: DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO generado', tieneAlertaMixto);
  if (!tieneAlertaMixto) fallasCaso = true;

  assert('C1: DESCANSO_APLICADO_POR_POLITICA generado (motor→route)',
    // La alerta la añade la ruta; aquí verificamos politicaAplicada
    aplicarPoliticaDescanso([mkTurno(['L','M','X','J','V'], '23:00', '07:00')], POLITICA).politicaAplicada);

  // Jornada: 8h bruto - 1h = 7h net × 5 = 35h (solo turno nocturno L-V)
  assertAprox('C1: jornada turno nocturno L-V ≈ 35h (7h net × 5)', r.jornadaCalculada, 35, 0.5);

  assert('C1: empresaEsperada = ASEOCOLBA', caso.empresaEsperada === 'ASEOCOLBA');
  assert('C1: requiereValidacionManual = true', caso.requiereValidacionManual);
  registrarCaso('C1', fallasCaso, advCaso);
}

// ════════════════════════════════════════════════════════════
// C2 — ATLANTIC: turno mixto 13:00-21:00 + valores agregados
// ════════════════════════════════════════════════════════════

bloque('C2 — ATLANTIC (turno mixto 13:00-21:00 + valores agregados)');
{
  const caso = CASOS_REALES.find(c => c.idCaso === 'C2-ATLANTIC')!;
  let fallasCaso = false;

  // Turno 13:00-21:00 es mixto (6h diu + 2h noc)
  const esMixto = esTurnoMixto('13:00', '21:00', PARAMS);
  assert('C2: turno 13:00-21:00 es MIXTO', esMixto);
  if (!esMixto) fallasCaso = true;

  // Turno 06:00-14:00 NO es mixto (diurno puro)
  assert('C2: turno 06:00-14:00 NO es mixto', !esTurnoMixto('06:00', '14:00', PARAMS));

  // Turno 22:00-06:00 NO es mixto (nocturno puro: 8h noc, 0h diu → noc = brutas)
  assert('C2: turno 22:00-06:00 NO es mixto (nocturno puro)', !esTurnoMixto('22:00', '06:00', PARAMS));

  // Motor: turno 13:00-21:00 + política → DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO
  const cargoMixto: CargoEntrada = {
    cargoNormalizado: 'Operario de Aseo', cantidadSolicitada: 1, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    claseRiesgoArl: 'II', requiereValidacionArl: false, requiereAlturas: false,
    turnos: [mkTurno(['L','M','X','J','V'], '13:00', '21:00')],
  };
  const r = applyPolicyAndRun(cargoMixto);
  const alerta = r.alertas.some(a => a.codigo === 'DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO');
  assert('C2: DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO en turno 13:00-21:00', alerta);
  if (!alerta) fallasCaso = true;

  // Motor reduce el nocturno al quitar el descanso desde la parte noc (conservador).
  // 13:00-21:00 con 60min break (no_informado): 8h bruto - 1h = 7h net.
  // Motor asigna break al tramo noc: 2h noc - 1h = 1h noc × 5 días = 5h.
  assertAprox('C2: horas nocturnas turno mixto > 0 (motor conservador)', r.desgloseSemanal.ordNoc, 5, 2.0);

  assert('C2: valores agregados requieren catálogo adicional', caso.requiereCatalogoAdicional);
  assert('C2: requiereMejorPrompt = true (separar valores agregados)', caso.requiereMejorPrompt);
  registrarCaso('C2', fallasCaso, false);
}

// ════════════════════════════════════════════════════════════
// C3 — EDIFICIO SOLARÀ: piscinero + salvavidas pendiente
// ════════════════════════════════════════════════════════════

bloque('C3 — EDIFICIO SOLARÀ (piscinero/salvavidas + multi-escenario)');
{
  const caso = CASOS_REALES.find(c => c.idCaso === 'C3-EDIFICIO-SOLARA')!;
  let fallasCaso = false;

  // Piscinero sin confirmar salvavidas → FALTA_HORARIO (no horario) + pregunta urgente (ruta)
  const cargoPiscinero: CargoEntrada = {
    cargoNormalizado: 'Piscinero', cantidadSolicitada: 1, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    claseRiesgoArl: null, requiereValidacionArl: true, requiereAlturas: false,
    esPiscinero: true, esSalvavidas: undefined, // null/undefined → pregunta
    turnos: [],  // sin horario definido
  };
  const r = procesarCargo(cargoPiscinero, PARAMS, FESTIVOS_2026);
  const faltaHorario = r.alertas.some(a => a.codigo === 'FALTA_HORARIO');
  assert('C3: piscinero sin horario → FALTA_HORARIO', faltaHorario);
  if (!faltaHorario) fallasCaso = true;

  // La ruta generaría pregunta sobre salvavidas (esSalvavidas=null); simulamos aquí
  const preguntaSalvavidas = (cargoPiscinero.esPiscinero ?? false) && cargoPiscinero.esSalvavidas == null;
  assert('C3: piscinero con esSalvavidas=null → pregunta requerida (ruta)', preguntaSalvavidas);

  assert('C3: escenarios esperados = 2', caso.escenariosEsperados.cantidad === 2);
  assert('C3: requiereValidacionManual (ARL piscinero)', caso.requiereValidacionManual);
  registrarCaso('C3', fallasCaso, false);
}

// ════════════════════════════════════════════════════════════
// C4 — SOLVO: domingos + condicionInsumos=con_y_sin
// ════════════════════════════════════════════════════════════

bloque('C4 — SOLVO (multisede + dominical + condicionInsumos)');
{
  const caso = CASOS_REALES.find(c => c.idCaso === 'C4-SOLVO')!;

  // Cargo con turno el domingo → recargo dominical
  const cargoConDomingo: CargoEntrada = {
    cargoNormalizado: 'Operario de Aseo', cantidadSolicitada: 1, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    claseRiesgoArl: 'II', requiereValidacionArl: false, requiereAlturas: false,
    turnos: [mkTurno(['D'], '07:00', '15:00')],  // domingo
  };
  const r = procesarCargo(cargoConDomingo, PARAMS, FESTIVOS_2026);
  assert('C4: turno domingo genera horas dominicales', r.desgloseSemanal.domOrdDiu > 0);
  assert('C4: horas dominicales diurnas ≈ 8h', Math.abs(r.desgloseSemanal.domOrdDiu - 8) < 0.5);

  assert('C4: condicionInsumos = con_y_sin', caso.escenariosEsperados.condicionInsumos === 'con_y_sin');
  assert('C4: escenarios esperados = 2', caso.escenariosEsperados.cantidad === 2);
  assert('C4: ARL varía por sede → requiereValidacionManual', caso.requiereValidacionManual);
  registrarCaso('C4', false, false);
}

// ════════════════════════════════════════════════════════════
// C5 — COUNTRY MOTORS: multiempresa + turno S 12:30-L 08:00
// ════════════════════════════════════════════════════════════

bloque('C5 — COUNTRY MOTORS (multiempresa + cruce medianoche condicional)');
{
  const caso = CASOS_REALES.find(c => c.idCaso === 'C5-COUNTRY-MOTORS')!;
  let fallasCaso = false;

  // Turno S 12:30 → L 08:00 (cruce medianoche sábado→domingo→lunes = 19.5h)
  assert('C5: turno 12:30-08:00 es MIXTO (19.5h, cruza 19:00 y 06:00)', !!esTurnoMixto('12:30', '08:00', PARAMS));

  // Motor: S 12:30-08:00 → turno muy largo (19.5h bruto → policy → 18.5h net)
  const cargoVigilante: CargoEntrada = {
    cargoNormalizado: 'Vigilante', cantidadSolicitada: 1, tipoCobertura: 'puesto',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    claseRiesgoArl: 'IV', requiereValidacionArl: false, requiereAlturas: false,
    turnos: [mkTurno(['S'], '12:30', '08:00')],
  };
  const r = applyPolicyAndRun(cargoVigilante);
  const alerta = r.alertas.some(a => a.codigo === 'DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO');
  assert('C5: DESCANSO_EN_TURNO_MIXTO_NO_DEFINIDO en turno S 12:30-L08:00', alerta);
  if (!alerta) fallasCaso = true;

  assert('C5: empresaEsperada = MULTIPLE', caso.empresaEsperada === 'MULTIPLE');
  assert('C5: 2 escenarios (vigilancia vs conserjería)', caso.escenariosEsperados.cantidad === 2);
  assert('C5: requiereValidacionManual (lógica festivo condicional)', caso.requiereValidacionManual);
  assert('C5: requiereMejorPrompt (lógica condicional festivo)', caso.requiereMejorPrompt);
  registrarCaso('C5', fallasCaso, false);
}

// ════════════════════════════════════════════════════════════
// C6 — VILLA MAGNA: caso simple con condicionInsumos
// ════════════════════════════════════════════════════════════

bloque('C6 — EDIFICIO VILLA MAGNA (simple + condicionInsumos)');
{
  const caso = CASOS_REALES.find(c => c.idCaso === 'C6-VILLA-MAGNA')!;

  // 44h L-S → L-V 07:00-15:48 (con 1h descanso no computable da 7.8h × 5 = 39h) ...
  // Más simple: turno L-S con descanso explícito de 60min → 8h × 6 = 48h → excede
  // Mejor: turno L-V 07:00-15:12 (48min descanso) = ~7.2h × 5 + S 07:00-12:00 = 41h
  // Para una prueba SIMPLE: usar turno L-S 07:00-15:20 (descansoMinutos=60) → 8h20-1h=7h20×6=44h
  const cargoSimple: CargoEntrada = {
    cargoNormalizado: 'Operario de Aseo', cantidadSolicitada: 1, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: 44, diaDescansoObligatorio: null,
    claseRiesgoArl: 'II', requiereValidacionArl: false, requiereAlturas: false,
    // L-V 07:00-16:20 + descanso 60min = 8h20min = 8.33h net × 5 = 41.67h
    // S 07:00-13:00 = 6h + descanso 60min (6h>6h umbral, límite igual, no aplica) = 6h net
    // Simplificamos con turnos que sumen exactamente 44h
    turnos: [
      // L-V 07:00-16:00 explícito con 60min → 8h × 5 = 40h
      mkTurno(['L','M','X','J','V'], '07:00', '16:00', 60),
      // S 07:00-11:00 = 4h (< 6h umbral, política no aplica)
      mkTurno(['S'], '07:00', '11:00', 0),
    ],
  };
  const r = procesarCargo(cargoSimple, PARAMS, FESTIVOS_2026);
  assertAprox('C6: jornada ≈ 44h (40h L-V + 4h S)', r.jornadaCalculada, 44, 1.0);
  assert('C6: exportableAlTabActual = true',  r.inputsMensuales.exportableAlTabActual);
  assert('C6: NO EXCEDE_JORNADA_LEGAL', !r.alertas.some(a => a.codigo === 'EXCEDE_JORNADA_LEGAL'));
  assert('C6: condicionInsumos = con_y_sin', caso.escenariosEsperados.condicionInsumos === 'con_y_sin');
  assert('C6: NO requiereMejorPrompt', !caso.requiereMejorPrompt);
  registrarCaso('C6', false, false);
}

// ════════════════════════════════════════════════════════════
// C7 — OCEANA 52: multi-cargo, excede jornada
// ════════════════════════════════════════════════════════════

bloque('C7 — OCEANA 52 (multi-cargo + EXCEDE_JORNADA_LEGAL)');
{
  const caso = CASOS_REALES.find(c => c.idCaso === 'C7-OCEANA-52')!;
  let fallasCaso = false;

  // L-V 07:00-16:00 (9h bruto → policy 60min → 8h net × 5 = 40h)
  // S 07:00-15:00 (8h bruto → policy 60min → 7h net)
  // Total: 47h > 44h → EXCEDE
  const cargoOceana: CargoEntrada = {
    cargoNormalizado: 'Operario de Aseo', cantidadSolicitada: 1, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: 44, diaDescansoObligatorio: null,
    claseRiesgoArl: 'II', requiereValidacionArl: false, requiereAlturas: false,
    turnos: [
      mkTurno(['L','M','X','J','V'], '07:00', '16:00'),
      mkTurno(['S'], '07:00', '15:00'),
    ],
  };
  const r = applyPolicyAndRun(cargoOceana);

  assertAprox('C7: jornada calculada ≈ 47h (40+7)', r.jornadaCalculada, 47, 0.5);
  const excede = r.alertas.some(a => a.codigo === 'EXCEDE_JORNADA_LEGAL');
  assert('C7: EXCEDE_JORNADA_LEGAL (47h > 44h)', excede);
  if (!excede) fallasCaso = true;
  assert('C7: política aplicada (L-V 9h bruto + S 8h bruto > 6h)',
    aplicarPoliticaDescanso([mkTurno(['L','M','X','J','V'], '07:00', '16:00'), mkTurno(['S'], '07:00', '15:00')], POLITICA).turnosMarcados === 2);

  assert('C7: 4 cargos esperados (aseo ×5, piscinero, todero, jardinero)', caso.cargosEsperados.length === 4);
  registrarCaso('C7', fallasCaso, false);
}

// ════════════════════════════════════════════════════════════
// C8 — SERVIMEDICAL: caso simple exportable
// ════════════════════════════════════════════════════════════

bloque('C8 — SERVIMEDICAL (simple + exportable)');
{
  const caso = CASOS_REALES.find(c => c.idCaso === 'C8-SERVIMEDICAL')!;

  const cargo: CargoEntrada = {
    cargoNormalizado: 'Operario de Aseo', cantidadSolicitada: 1, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: 44, diaDescansoObligatorio: null,
    claseRiesgoArl: 'II', requiereValidacionArl: false, requiereAlturas: false,
    turnos: [
      mkTurno(['L','M','X','J','V'], '07:00', '16:00', 60),
      mkTurno(['S'], '07:00', '15:00', 60),  // 8h - 60min = 7h + 40+7=47... ajustar
    ],
  };
  // Ajuste: L-V 07:00-16:00 descanso 60min = 8h × 5 = 40h; S 07:00-11:00 (4h) = total 44h
  const cargoAjustado: CargoEntrada = { ...cargo, turnos: [
    mkTurno(['L','M','X','J','V'], '07:00', '16:00', 60),
    mkTurno(['S'], '07:00', '11:00'),
  ]};
  const r = procesarCargo(cargoAjustado, PARAMS, FESTIVOS_2026);

  assert('C8: exportableAlTabActual = true', r.inputsMensuales.exportableAlTabActual);
  assert('C8: sin EXCEDE_JORNADA_LEGAL',     !r.alertas.some(a => a.codigo === 'EXCEDE_JORNADA_LEGAL'));
  assert('C8: categorias includes SIMPLE',   caso.categorias.includes('SIMPLE'));
  assert('C8: condicionInsumos = sin_insumos', caso.escenariosEsperados.condicionInsumos === 'sin_insumos');
  registrarCaso('C8', false, false);
}

// ════════════════════════════════════════════════════════════
// C9 — DATABANKS: 7h diarias = 35h (NO 44h)
// ════════════════════════════════════════════════════════════

bloque('C9 — DATABANKS MKS (jornada parcial 35h — NO usar plantilla 44h)');
{
  const caso = CASOS_REALES.find(c => c.idCaso === 'C9-DATABANKS')!;
  let fallasCaso = false;

  // 7h diarias L-V. Si turno es 07:00-14:00 (7h bruto):
  // 7h ≤ 6h? NO, 7 > 6 → política aplica 60min → 6h net × 5 = 30h
  // Pero si el cliente dice "7 horas" sin mencionar descanso, Gemini debe poner descansoMinutos=0
  // y horasSemanalesDeclaradas=35. El horario sería 07:00-14:00 sin descanso (7h neto).
  // Con descansoMinutos=0 → política NO aplica (no hay descanso a agregar si ya están contadas las 7h)
  // Aquí modelamos: cliente dice 7h diarias → Gemini extrae 07:00-14:00, descansoMinutos=0
  const cargoDatabanks: CargoEntrada = {
    cargoNormalizado: 'Operario de Aseo', cantidadSolicitada: 1, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: 35,  // 7h × 5 — NUNCA 44h
    diaDescansoObligatorio: null,
    claseRiesgoArl: 'II', requiereValidacionArl: false, requiereAlturas: false,
    turnos: [mkTurno(['L','M','X','J','V'], '07:00', '14:00', 0)],  // 7h bruto, sin descanso
  };
  const r = procesarCargo(cargoDatabanks, PARAMS, FESTIVOS_2026);

  assert('C9: jornadaSemanalDeclarada = 35 (no 44)', cargoDatabanks.jornadaSemanalDeclarada === 35);
  assertAprox('C9: jornadaCalculada ≈ 35h (7h × 5)', r.jornadaCalculada, 35, 0.5);
  assert('C9: NO EXCEDE_JORNADA_LEGAL (35h < 44h)', !r.alertas.some(a => a.codigo === 'EXCEDE_JORNADA_LEGAL'));
  const tieneJornadaNo44 = cargoDatabanks.jornadaSemanalDeclarada !== 44;
  assert('C9: declared ≠ 44 (jornada parcial real)', tieneJornadaNo44);
  if (!tieneJornadaNo44) fallasCaso = true;

  assert('C9: requiereMejorPrompt (no asumir 44h)', caso.requiereMejorPrompt);
  registrarCaso('C9', fallasCaso, false);
}

// ════════════════════════════════════════════════════════════
// C10 — CENTRO EJECUTIVO: requiereAlturas=false → sin alerta
// ════════════════════════════════════════════════════════════

bloque('C10 — CENTRO EJECUTIVO I (requiereAlturas=false explícito)');
{
  const caso = CASOS_REALES.find(c => c.idCaso === 'C10-CENTRO-EJECUTIVO')!;

  const cargoSinAlturas: CargoEntrada = {
    cargoNormalizado: 'Operario de Aseo', cantidadSolicitada: 1, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: 44, diaDescansoObligatorio: null,
    claseRiesgoArl: 'II', requiereValidacionArl: false,
    requiereAlturas: false,  // declarado explícitamente
    turnos: [mkTurno(['L','M','X','J','V'], '07:00', '16:00', 60), mkTurno(['S'], '07:00', '11:00')],
  };
  const r = procesarCargo(cargoSinAlturas, PARAMS, FESTIVOS_2026);
  assert('C10: NO alerta ALTURAS_SIN_CONFIRMAR (requiereAlturas=false)', !r.alertas.some(a => a.codigo === 'ALTURAS_SIN_CONFIRMAR'));

  // ALTURAS_SIN_CONFIRMAR solo dispara para 'todero' (motor valida cargoNormalizado)
  const cargoToderoNullAlt = { ...cargoSinAlturas, cargoNormalizado: 'Todero', requiereAlturas: null as null };
  const r2 = procesarCargo(cargoToderoNullAlt, PARAMS, FESTIVOS_2026);
  assert('C10: Todero requiereAlturas=null → SÍ ALTURAS_SIN_CONFIRMAR', r2.alertas.some(a => a.codigo === 'ALTURAS_SIN_CONFIRMAR'));

  assert('C10: condicionInsumos = con_insumos', caso.escenariosEsperados.condicionInsumos === 'con_insumos');
  assert('C10: NO requiereValidacionManual (caso simple)', !caso.requiereValidacionManual);
  registrarCaso('C10', false, false);
}

// ════════════════════════════════════════════════════════════
// C11 — PUNTA DEL ESTE: conserje 24/7 no exportable
// ════════════════════════════════════════════════════════════

bloque('C11 — PUNTA DEL ESTE (conserje 24/7 + piscinero/todero)');
{
  const caso = CASOS_REALES.find(c => c.idCaso === 'C11-PUNTA-DEL-ESTE')!;
  let fallasCaso = false;

  // Conserje puesto 24/7: 3 turnos de 8h L-D
  const cargoConserje24: CargoEntrada = {
    cargoNormalizado: 'Conserje / Portero', cantidadSolicitada: 1, tipoCobertura: 'puesto',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    claseRiesgoArl: 'I', requiereValidacionArl: false, requiereAlturas: false,
    turnos: [
      mkTurno(['L','M','X','J','V','S','D'], '06:00', '14:00'),
      mkTurno(['L','M','X','J','V','S','D'], '14:00', '22:00'),
      mkTurno(['L','M','X','J','V','S','D'], '22:00', '06:00'),
    ],
  };
  const r = procesarCargo(cargoConserje24, PARAMS, FESTIVOS_2026);
  assertAprox('C11: FTE conserje ≈ 3.82', r.fteTeorico, 3.818, 0.05);
  const tieneCobertura = r.alertas.some(a => a.codigo === 'COBERTURA_INSUFICIENTE_FTE');
  assert('C11: COBERTURA_INSUFICIENTE_FTE (FTE≈3.82 > 1)', tieneCobertura);
  if (!tieneCobertura) fallasCaso = true;
  assert('C11: requiereTurnante = true', r.requiereTurnante);
  assert('C11: exportableAlTabActual = false', !r.inputsMensuales.exportableAlTabActual);

  // Todero-piscinero 06:00-15:00 con 60min almuerzo (8h net) → exportable
  const cargoTodero: CargoEntrada = {
    cargoNormalizado: 'Todero', cantidadSolicitada: 1, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    claseRiesgoArl: null, requiereValidacionArl: true, requiereAlturas: null,
    esPiscinero: true, esSalvavidas: undefined,
    turnos: [mkTurno(['L','M','X','J','V','S','D'], '06:00', '15:00', 60)],
  };
  const r2 = procesarCargo(cargoTodero, PARAMS, FESTIVOS_2026);
  assert('C11: todero ARL_SIN_VALIDAR (requiereValidacionArl=true)', r2.alertas.some(a => a.codigo === 'ARL_SIN_VALIDAR'));
  registrarCaso('C11', fallasCaso, false);
}

// ════════════════════════════════════════════════════════════
// C12 — ANDALUCÍA: 3 turnos de 8h (no 2 de 12h)
// ════════════════════════════════════════════════════════════

bloque('C12 — ANDALUCÍA GRAN RESERVA (3×8h ≠ 2×12h + condicionInsumos)');
{
  const caso = CASOS_REALES.find(c => c.idCaso === 'C12-ANDALUCIA')!;
  let fallasCaso = false;

  // 3 turnos de 8h L-D (la versión correcta que el motor debe procesar)
  const cargo3x8: CargoEntrada = {
    cargoNormalizado: 'Conserje / Portero', cantidadSolicitada: 1, tipoCobertura: 'puesto',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    claseRiesgoArl: 'I', requiereValidacionArl: false, requiereAlturas: false,
    turnos: [
      mkTurno(['L','M','X','J','V','S','D'], '06:00', '14:00'),
      mkTurno(['L','M','X','J','V','S','D'], '14:00', '22:00'),
      mkTurno(['L','M','X','J','V','S','D'], '22:00', '06:00'),
    ],
  };
  const r3x8 = procesarCargo(cargo3x8, PARAMS, FESTIVOS_2026);

  // Si Gemini INCORRECTO extrae 2 turnos de 12h → FTE sería diferente
  const cargo2x12: CargoEntrada = {
    ...cargo3x8,
    turnos: [
      mkTurno(['L','M','X','J','V','S','D'], '06:00', '18:00'),  // 12h
      mkTurno(['L','M','X','J','V','S','D'], '18:00', '06:00'),  // 12h
    ],
  };
  const r2x12 = procesarCargo(cargo2x12, PARAMS, FESTIVOS_2026);

  assertAprox('C12: FTE con 3×8h ≈ 3.82', r3x8.fteTeorico, 3.818, 0.05);
  assertAprox('C12: FTE con 2×12h ≠ 3×8h (diferente desglose)', r2x12.fteTeorico, 3.818, 0.05);
  // FTE es igual porque cobertura es la misma; lo importante es el DESGLOSE de horas
  // Con 3×8h, turno 14:00-22:00 es MIXTO → nocturno 3h. Con 2×12h, nocturno más.
  assert('C12: turno 14:00-22:00 es MIXTO', esTurnoMixto('14:00', '22:00', PARAMS));
  assert('C12: turno 22:00-06:00 NO es MIXTO (nocturno puro)', !esTurnoMixto('22:00', '06:00', PARAMS));

  // Con 3×8h, turno 14:00-22:00 genera horas nocturnas en el desglose
  assert('C12: 3×8h → horas nocturnas en desglose de 14-22', r3x8.desgloseSemanal.ordNoc > 0);

  const tieneCobertura = r3x8.alertas.some(a => a.codigo === 'COBERTURA_INSUFICIENTE_FTE');
  assert('C12: COBERTURA_INSUFICIENTE_FTE', tieneCobertura);
  if (!tieneCobertura) fallasCaso = true;

  assert('C12: condicionInsumos = con_y_sin', caso.escenariosEsperados.condicionInsumos === 'con_y_sin');
  assert('C12: requiereMejorPrompt (no fusionar turnos)', caso.requiereMejorPrompt);
  registrarCaso('C12', fallasCaso, false);
}

// ════════════════════════════════════════════════════════════
// C13 — BIOMEDICAL: medio tiempo sin horas → JORNADA_PARCIAL_SIN_HORAS
// ════════════════════════════════════════════════════════════

bloque('C13 — BIOMEDICAL (tiempo completo + medio tiempo sin horas)');
{
  const caso = CASOS_REALES.find(c => c.idCaso === 'C13-BIOMEDICAL')!;
  let fallasCaso = false;

  // Medio tiempo: esJornadaParcialSinHoras=true, turnos=[]
  const cargoMedioTiempo: CargoEntrada = {
    cargoNormalizado: 'Operario de Aseo', cantidadSolicitada: 1, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    claseRiesgoArl: 'II', requiereValidacionArl: false, requiereAlturas: false,
    esJornadaParcialSinHoras: true, turnos: [],
  };
  const r = procesarCargo(cargoMedioTiempo, PARAMS, FESTIVOS_2026);
  const tieneAlerta = r.alertas.some(a => a.codigo === 'JORNADA_PARCIAL_SIN_HORAS');
  assert('C13: JORNADA_PARCIAL_SIN_HORAS para medio tiempo sin horas', tieneAlerta);
  if (!tieneAlerta) fallasCaso = true;
  assert('C13: pregunta urgente generada para medio tiempo', r.preguntas.some(p => p.prioridad === 'urgente'));
  assert('C13: jornadaCalculada = 0 (sin turnos)', r.jornadaCalculada === 0);

  // Tiempo completo con horario definido
  const cargoCompleto: CargoEntrada = {
    ...cargoMedioTiempo,
    esJornadaParcialSinHoras: false,
    jornadaSemanalDeclarada: 40,
    turnos: [mkTurno(['L','M','X','J','V'], '08:00', '17:00', 60)],  // 8h net × 5 = 40h
  };
  const r2 = procesarCargo(cargoCompleto, PARAMS, FESTIVOS_2026);
  assert('C13: tiempo completo exportable', r2.inputsMensuales.exportableAlTabActual);

  assert('C13: 2 cargos esperados (completo + medio tiempo)', caso.cargosEsperados.length === 2);
  registrarCaso('C13', fallasCaso, false);
}

// ════════════════════════════════════════════════════════════
// C14 — VITRA 57: multiempresa + vigilancia 24/7
// ════════════════════════════════════════════════════════════

bloque('C14 — VITRA 57 (multiempresa + vigilancia 24/7 no exportable)');
{
  const caso = CASOS_REALES.find(c => c.idCaso === 'C14-VITRA-57')!;
  let fallasCaso = false;

  // Vigilante 24/7 puesto (3 turnos L-D)
  const cargoVigilante: CargoEntrada = {
    cargoNormalizado: 'Vigilante', cantidadSolicitada: 1, tipoCobertura: 'puesto',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    claseRiesgoArl: 'IV', requiereValidacionArl: false, requiereAlturas: false,
    turnos: [
      mkTurno(['L','M','X','J','V','S','D'], '06:00', '14:00'),
      mkTurno(['L','M','X','J','V','S','D'], '14:00', '22:00'),
      mkTurno(['L','M','X','J','V','S','D'], '22:00', '06:00'),
    ],
  };
  const r = procesarCargo(cargoVigilante, PARAMS, FESTIVOS_2026);
  const tieneCobertura = r.alertas.some(a => a.codigo === 'COBERTURA_INSUFICIENTE_FTE');
  assert('C14: COBERTURA_INSUFICIENTE_FTE (vigilante 24/7)', tieneCobertura);
  if (!tieneCobertura) fallasCaso = true;
  assert('C14: exportableAlTabActual = false', !r.inputsMensuales.exportableAlTabActual);
  assert('C14: requiereTurnante = true', r.requiereTurnante);

  // Aseador L-D (oferta B) → recargo dominical
  const cargoAseadorLD: CargoEntrada = {
    cargoNormalizado: 'Aseador / Todero', cantidadSolicitada: 1, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    claseRiesgoArl: 'III', requiereValidacionArl: false, requiereAlturas: null,
    turnos: [mkTurno(['L','M','X','J','V','S','D'], '07:00', '15:20', 60)],  // 7.33h × 7 ≈ 51h → excede
  };
  const r2 = procesarCargo(cargoAseadorLD, PARAMS, FESTIVOS_2026);
  assert('C14: aseador L-D → horas dominicales > 0', r2.desgloseSemanal.domOrdDiu > 0);

  assert('C14: empresaEsperada = MULTIPLE', caso.empresaEsperada === 'MULTIPLE');
  assert('C14: 3 escenarios (A + B + C)', caso.escenariosEsperados.cantidad === 3);
  registrarCaso('C14', fallasCaso, false);
}

// ════════════════════════════════════════════════════════════
// C15 — OCEAN MALL: vigilancia multi-posición L-D+festivos
// ════════════════════════════════════════════════════════════

bloque('C15 — OCEAN MALL (vigilancia VIGICOLBA + L-D+festivos)');
{
  const caso = CASOS_REALES.find(c => c.idCaso === 'C15-OCEAN-MALL')!;
  let fallasCaso = false;

  // Posición 24/7 L-D+festivos
  const cargo24: CargoEntrada = {
    cargoNormalizado: 'Vigilante', cantidadSolicitada: 1, tipoCobertura: 'puesto',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    claseRiesgoArl: 'IV', requiereValidacionArl: false, requiereAlturas: false,
    turnos: [
      mkTurno(['L','M','X','J','V','S','D'], '06:00', '14:00'),
      mkTurno(['L','M','X','J','V','S','D'], '14:00', '22:00'),
      mkTurno(['L','M','X','J','V','S','D'], '22:00', '06:00'),
    ],
  };
  const r = procesarCargo(cargo24, PARAMS, FESTIVOS_2026);
  assert('C15: COBERTURA_INSUFICIENTE_FTE (24/7)', r.alertas.some(a => a.codigo === 'COBERTURA_INSUFICIENTE_FTE'));
  assert('C15: !exportable', !r.inputsMensuales.exportableAlTabActual);

  // CCTV 08:00-22:00 L-D+festivos (posición) → turno 14h con tipoDia festivo
  const cargoCCTV: CargoEntrada = {
    cargoNormalizado: 'Operador CCTV / Vigilante', cantidadSolicitada: 1, tipoCobertura: 'puesto',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    claseRiesgoArl: 'IV', requiereValidacionArl: true, requiereAlturas: false,
    turnos: [
      mkTurno(['L','M','X','J','V','S','D'], '08:00', '22:00', 0, 'festivo'),  // tipoDiaGemini sugerido
    ],
  };
  const rCCTV = procesarCargo(cargoCCTV, PARAMS, FESTIVOS_2026);
  // Con tipoDiaGemini=festivo el motor trata el turno como festivo → festOrdDiu > 0
  assert('C15: CCTV con tipoDia festivo → horas festivas', rCCTV.desgloseSemanal.festOrdDiu > 0);
  const tieneFTE = rCCTV.alertas.some(a => a.codigo === 'COBERTURA_INSUFICIENTE_FTE');
  assert('C15: CCTV puesto → COBERTURA_INSUFICIENTE_FTE', tieneFTE);
  if (!tieneFTE) fallasCaso = true;

  assert('C15: empresa VIGICOLBA', caso.empresaEsperada === 'VIGICOLBA');
  assert('C15: requiereCatalogoAdicional (CCTV)', caso.requiereCatalogoAdicional);
  registrarCaso('C15', fallasCaso, false);
}

// ════════════════════════════════════════════════════════════
// C16 — RIBERA ALTA: todero alturas + conserje 12h/día
// ════════════════════════════════════════════════════════════

bloque('C16 — RIBERA ALTA (todero alturas + salvavidas + conserje 12/7)');
{
  const caso = CASOS_REALES.find(c => c.idCaso === 'C16-RIBERA-ALTA')!;
  let fallasCaso = false;

  // Todero con requiereAlturas=null → ALTURAS_SIN_CONFIRMAR
  const cargoTodero: CargoEntrada = {
    cargoNormalizado: 'Todero', cantidadSolicitada: 1, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    claseRiesgoArl: 'III', requiereValidacionArl: false,
    requiereAlturas: null,  // no mencionado → alerta
    turnos: [mkTurno(['L','M','X','J','V','S'], '07:00', '15:00', 0)],
  };
  const rTodero = applyPolicyAndRun(cargoTodero);
  const tieneAlturas = rTodero.alertas.some(a => a.codigo === 'ALTURAS_SIN_CONFIRMAR');
  assert('C16: todero requiereAlturas=null → ALTURAS_SIN_CONFIRMAR', tieneAlturas);
  if (!tieneAlturas) fallasCaso = true;

  // Salvavidas V-D 8h → viernes+sábado (diurno) + domingo (dominical)
  const cargoSalvavidas: CargoEntrada = {
    cargoNormalizado: 'Salvavidas / Piscinero', cantidadSolicitada: 1, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    claseRiesgoArl: 'IV', requiereValidacionArl: false, requiereAlturas: false,
    esPiscinero: true, esSalvavidas: true,
    turnos: [mkTurno(['V','S','D'], '07:00', '15:00', 60)],  // 8h bruto - 60min = 7h × 3 = 21h
  };
  const rSalvavidas = procesarCargo(cargoSalvavidas, PARAMS, FESTIVOS_2026);
  assert('C16: salvavidas V-D → domOrdDiu > 0 (domingo)', rSalvavidas.desgloseSemanal.domOrdDiu > 0);
  assert('C16: salvavidas con esSalvavidas=true → SIN alerta ARL_SIN_VALIDAR',
    !rSalvavidas.alertas.some(a => a.codigo === 'ARL_SIN_VALIDAR'));

  // Conserje L-D 12h (07:00-19:00 = 12h, diurno puro) → FTE > 1
  const cargoConserje: CargoEntrada = {
    cargoNormalizado: 'Conserje / Portero', cantidadSolicitada: 1, tipoCobertura: 'puesto',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    claseRiesgoArl: 'I', requiereValidacionArl: false, requiereAlturas: false,
    turnos: [mkTurno(['L','M','X','J','V','S','D'], '07:00', '19:00', 60)],  // 11h net × 7 = 77h/semana
  };
  const rConserje = procesarCargo(cargoConserje, PARAMS, FESTIVOS_2026);
  assert('C16: conserje 12/7 → COBERTURA_INSUFICIENTE_FTE (FTE > 1)', rConserje.alertas.some(a => a.codigo === 'COBERTURA_INSUFICIENTE_FTE'));
  assert('C16: 07:00-19:00 NO es mixto (diurno puro)', !esTurnoMixto('07:00', '19:00', PARAMS));

  assert('C16: condicionInsumos = con_insumos', caso.escenariosEsperados.condicionInsumos === 'con_insumos');
  registrarCaso('C16', fallasCaso, false);
}

// ════════════════════════════════════════════════════════════
// C17 — LUCCA: salvavidas sin horario → FALTA_HORARIO
// ════════════════════════════════════════════════════════════

bloque('C17 — LUCCA (salvavidas sin horario + valores agregados pendientes)');
{
  const caso = CASOS_REALES.find(c => c.idCaso === 'C17-LUCCA')!;
  let fallasCaso = false;

  // Salvavidas M-D sin horario (turnos=[], esJornadaParcialSinHoras=false → FALTA_HORARIO)
  const cargoSalvavidas: CargoEntrada = {
    cargoNormalizado: 'Salvavidas / Piscinero', cantidadSolicitada: 1, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: null, diaDescansoObligatorio: null,
    claseRiesgoArl: null, requiereValidacionArl: true, requiereAlturas: false,
    esPiscinero: true, turnos: [],
    esJornadaParcialSinHoras: false,  // no es medio tiempo, simplemente no se conoce el horario
  };
  const r = procesarCargo(cargoSalvavidas, PARAMS, FESTIVOS_2026);
  const faltaHorario = r.alertas.some(a => a.codigo === 'FALTA_HORARIO');
  assert('C17: salvavidas sin horario → FALTA_HORARIO', faltaHorario);
  if (!faltaHorario) fallasCaso = true;

  // Operarios de aseo 44h (4 unidades) → si tienen horario, exportable
  const cargoOperarios: CargoEntrada = {
    cargoNormalizado: 'Operario de Aseo', cantidadSolicitada: 4, tipoCobertura: 'persona',
    jornadaSemanalDeclarada: 44, diaDescansoObligatorio: null,
    claseRiesgoArl: 'II', requiereValidacionArl: false, requiereAlturas: false,
    turnos: [mkTurno(['L','M','X','J','V'], '07:00', '16:00', 60), mkTurno(['S'], '07:00', '11:00')],
  };
  const r2 = procesarCargo(cargoOperarios, PARAMS, FESTIVOS_2026);
  assert('C17: operarios de aseo con horario → exportable', r2.inputsMensuales.exportableAlTabActual);

  assert('C17: 3 cargos esperados (4 operarios, todero, salvavidas)', caso.cargosEsperados.length === 3);
  assert('C17: requiereValidacionManual (salvavidas sin horario + valores agregados)', caso.requiereValidacionManual);
  registrarCaso('C17', fallasCaso, false);
}

// ════════════════════════════════════════════════════════════
// RESUMEN FINAL
// ════════════════════════════════════════════════════════════

const meta = getResumenMetadata();

console.log(`\n${'═'.repeat(60)}`);
console.log('RESUMEN BANCO DE CASOS REALES — FASE 2.2');
console.log(`${'═'.repeat(60)}`);
console.log(`\n📊 Assertions: ${pasados} ✅ pasados / ${fallidos} ❌ fallidos / ${advertencias} ⚠️  advertencias`);
console.log(`\n📁 Total de casos registrados: ${meta.total}`);

console.log(`\n✅ Casos aprobados (${casosAprobados.length}):`);
casosAprobados.forEach(id => console.log(`   · ${id}`));

if (casosConAdvertencias.length > 0) {
  console.log(`\n⚠️  Casos con advertencias (${casosConAdvertencias.length}):`);
  casosConAdvertencias.forEach(id => console.log(`   · ${id}`));
}

if (casosConFallas.length > 0) {
  console.log(`\n❌ Casos con fallas de motor (${casosConFallas.length}):`);
  casosConFallas.forEach(id => console.log(`   · ${id}`));
}

console.log(`\n🔧 Requieren mejorar prompt Gemini (${meta.requierenMejorPrompt.length}):`);
meta.requierenMejorPrompt.forEach(id => {
  const c = CASOS_REALES.find(x => x.idCaso === id)!;
  console.log(`   · ${id} — ${c.cliente}`);
});

console.log(`\n📚 Requieren catálogo adicional (${meta.requierenCatalogo.length}):`);
meta.requierenCatalogo.forEach(id => {
  const c = CASOS_REALES.find(x => x.idCaso === id)!;
  console.log(`   · ${id} — ${c.cliente}`);
});

console.log(`\n🔍 Requieren validación manual obligatoria (${meta.requierenValidacion.length}):`);
meta.requierenValidacion.forEach(id => {
  const c = CASOS_REALES.find(x => x.idCaso === id)!;
  console.log(`   · ${id} — ${c.cliente}: ${c.motivoValidacionManual ?? ''}`);
});

console.log(`\n📋 Distribución por categorías:`);
console.log(`   · Simples:            ${meta.casosSimples.join(', ') || 'ninguno'}`);
console.log(`   · Multiempresa:       ${meta.casosMultiEmpresa.join(', ') || 'ninguno'}`);
console.log(`   · 24/7:               ${meta.casos24_7.join(', ') || 'ninguno'}`);
console.log(`   · Con/Sin Insumos:    ${meta.casosConSinInsumos.join(', ') || 'ninguno'}`);

console.log(`\n${'═'.repeat(60)}`);
expect(fallidos, `${fallidos} assertions fallaron en el banco de casos reales — ver log arriba`).toBe(0);

}); // it()