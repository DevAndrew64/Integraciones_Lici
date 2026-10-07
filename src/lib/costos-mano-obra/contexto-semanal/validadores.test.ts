import { describe, it, expect } from 'vitest';
import type { BloqueHorarioContexto, PatronTrabajadorContexto, ReglaSemanalPatronContexto, ExcepcionProgramacionContexto } from './tipos';
import {
  validarMinutosEnterosPositivos,
  validarCantidadTrabajadores,
  validarZonaHorariaContexto,
  validarRangoVigencia,
  validarBloqueHorarioContexto,
  validarBloquesHorarioContexto,
  validarPatronTrabajadorContexto,
  validarParametrosRegimenDisponibles,
  validarReglaSemanalPatronContexto,
  validarReglasSemanalesPatron,
  validarExcepcionProgramacionContexto,
  validarContextoParcial,
  validarContextoListoParaClasificar,
} from './validadores';

// ── Fixtures base (objetos literales, no derivados de los validadores) ─────

function patronBase(overrides: Partial<PatronTrabajadorContexto> = {}): PatronTrabajadorContexto {
  return {
    cargoManoObraId: 1,
    codigo: 'PRINCIPAL-DIURNO',
    nombre: 'Operario principal turno diurno',
    cantidadTrabajadores: 1,
    jornadaContractualSemanalMinutos: 2520,
    modalidadDistribucionJornada: 'ESTANDAR',
    acuerdoJornadaFlexible: null,
    regimenLaboral: 'GENERAL',
    tipoDescanso: 'FIJO',
    diaDescansoObligatorio: 'D',
    zonaHoraria: 'America/Bogota',
    vigenteDesde: '2026-07-15',
    activo: true,
    version: 1,
    origen: 'AJUSTE_MANUAL',
    ...overrides,
  };
}

function bloque(overrides: Partial<BloqueHorarioContexto> = {}): BloqueHorarioContexto {
  return { inicio: '08:00', fin: '12:00', orden: 1, ...overrides };
}

function reglaBase(overrides: Partial<ReglaSemanalPatronContexto> = {}): ReglaSemanalPatronContexto {
  return {
    diaSemana: 'L',
    tipoAsignacion: 'TURNO_ORDINARIO',
    bloques: [bloque()],
    minutosOrdinariosPactados: 240,
    orden: 1,
    activo: true,
    vigenteDesde: '2026-07-15',
    ...overrides,
  };
}

function excepcionBase(overrides: Partial<ExcepcionProgramacionContexto> = {}): ExcepcionProgramacionContexto {
  return {
    fecha: '2026-07-25',
    tipo: 'AUSENCIA',
    motivo: 'Cita médica',
    fuente: 'AJUSTE_MANUAL',
    estadoConfirmacion: 'PENDIENTE',
    ...overrides,
  };
}

// ── Primitivos ────────────────────────────────────────────────────────────

describe('validarMinutosEnterosPositivos', () => {
  it('acepta un entero positivo', () => {
    expect(validarMinutosEnterosPositivos(480).valido).toBe(true);
  });
  it('rechaza cero', () => {
    expect(validarMinutosEnterosPositivos(0).valido).toBe(false);
  });
  it('rechaza decimales', () => {
    expect(validarMinutosEnterosPositivos(480.5).valido).toBe(false);
  });
  it('rechaza no finitos', () => {
    expect(validarMinutosEnterosPositivos(Infinity).valido).toBe(false);
  });
});

describe('validarZonaHorariaContexto', () => {
  it('acepta America/Bogota', () => {
    expect(validarZonaHorariaContexto('America/Bogota').valido).toBe(true);
  });
  it('rechaza cualquier otra zona en esta primera versión', () => {
    expect(validarZonaHorariaContexto('America/Mexico_City').valido).toBe(false);
  });
});

describe('validarRangoVigencia', () => {
  it('acepta vigencia abierta (sin vigenteHasta)', () => {
    expect(validarRangoVigencia('2026-07-15').valido).toBe(true);
  });
  it('rechaza vigenteHasta anterior a vigenteDesde', () => {
    expect(validarRangoVigencia('2026-07-15', '2026-07-01').valido).toBe(false);
  });
  it('rechaza fecha inválida', () => {
    expect(validarRangoVigencia('2026-13-40').valido).toBe(false);
  });
});

// ── Patrón ────────────────────────────────────────────────────────────────

describe('validarPatronTrabajadorContexto', () => {
  it('patrón general válido', () => {
    expect(validarPatronTrabajadorContexto(patronBase()).valido).toBe(true);
  });
  it('cantidad cero', () => {
    expect(validarPatronTrabajadorContexto(patronBase({ cantidadTrabajadores: 0 })).valido).toBe(false);
  });
  it('cantidad decimal', () => {
    expect(validarPatronTrabajadorContexto(patronBase({ cantidadTrabajadores: 1.5 })).valido).toBe(false);
  });
  it('jornada cero', () => {
    expect(validarPatronTrabajadorContexto(patronBase({ jornadaContractualSemanalMinutos: 0 })).valido).toBe(false);
  });
  it('minutos decimales en la jornada contractual', () => {
    expect(validarPatronTrabajadorContexto(patronBase({ jornadaContractualSemanalMinutos: 2520.5 })).valido).toBe(false);
  });
  it('zona horaria distinta', () => {
    expect(validarPatronTrabajadorContexto(patronBase({ zonaHoraria: 'America/Lima' })).valido).toBe(false);
  });
  it('flexible sin acuerdo', () => {
    const r = validarPatronTrabajadorContexto(patronBase({ modalidadDistribucionJornada: 'FLEXIBLE_ACORDADA', acuerdoJornadaFlexible: null }));
    expect(r.valido).toBe(false);
  });
  it('flexible con acuerdo', () => {
    const r = validarPatronTrabajadorContexto(patronBase({ modalidadDistribucionJornada: 'FLEXIBLE_ACORDADA', acuerdoJornadaFlexible: true }));
    expect(r.valido).toBe(true);
  });
  it('descanso fijo sin día', () => {
    const r = validarPatronTrabajadorContexto(patronBase({ tipoDescanso: 'FIJO', diaDescansoObligatorio: undefined }));
    expect(r.valido).toBe(false);
  });
  it('descanso PENDIENTE_CONFIRMACION sin día no genera este error específico', () => {
    const r = validarPatronTrabajadorContexto(patronBase({ tipoDescanso: 'PENDIENTE_CONFIRMACION', diaDescansoObligatorio: undefined }));
    expect(r.valido && true).toBe(true);
  });
  it('régimen de vigilancia sin parámetros disponibles', () => {
    const r = validarParametrosRegimenDisponibles('VIGILANCIA_SEGURIDAD_PRIVADA', false);
    expect(r.valido).toBe(false);
  });
  it('régimen general con parámetros disponibles', () => {
    const r = validarParametrosRegimenDisponibles('GENERAL', true);
    expect(r.valido).toBe(true);
  });
  it('régimen general no se bloquea aunque parametrosDisponibles sea false (solo vigilancia lo exige)', () => {
    const r = validarParametrosRegimenDisponibles('GENERAL', false);
    expect(r.valido).toBe(true);
  });
});

// ── Bloques ───────────────────────────────────────────────────────────────

describe('validarBloqueHorarioContexto', () => {
  it('bloque válido', () => {
    expect(validarBloqueHorarioContexto(bloque()).valido).toBe(true);
  });
  it('formato inválido', () => {
    expect(validarBloqueHorarioContexto(bloque({ inicio: '8:00' })).valido).toBe(false);
  });
  it('24:00 inválido', () => {
    expect(validarBloqueHorarioContexto(bloque({ fin: '24:00' })).valido).toBe(false);
  });
  it('inicio igual a fin', () => {
    expect(validarBloqueHorarioContexto(bloque({ inicio: '10:00', fin: '10:00' })).valido).toBe(false);
  });
  it('cruce de medianoche permitido estructuralmente (fin < inicio)', () => {
    expect(validarBloqueHorarioContexto(bloque({ inicio: '22:00', fin: '02:00' })).valido).toBe(true);
  });
});

describe('validarBloquesHorarioContexto', () => {
  it('bloques superpuestos', () => {
    const r = validarBloquesHorarioContexto(
      [bloque({ inicio: '08:00', fin: '12:00', orden: 1 }), bloque({ inicio: '11:00', fin: '14:00', orden: 2 })],
      'TURNO_ORDINARIO',
    );
    expect(r.valido).toBe(false);
  });
  it('órdenes duplicados', () => {
    const r = validarBloquesHorarioContexto(
      [bloque({ inicio: '08:00', fin: '10:00', orden: 1 }), bloque({ inicio: '11:00', fin: '13:00', orden: 1 })],
      'TURNO_ORDINARIO',
    );
    expect(r.valido).toBe(false);
  });
  it('bloques fuera de orden', () => {
    const r = validarBloquesHorarioContexto(
      [bloque({ inicio: '13:00', fin: '14:20', orden: 1 }), bloque({ inicio: '05:00', fin: '11:00', orden: 2 })],
      'TURNO_ORDINARIO',
    );
    expect(r.valido).toBe(false);
  });
  it('asignación laborada sin bloques', () => {
    const r = validarBloquesHorarioContexto([], 'TURNO_ORDINARIO');
    expect(r.valido).toBe(false);
  });
  it('descanso sin bloques (válido)', () => {
    const r = validarBloquesHorarioContexto([], 'DESCANSO');
    expect(r.valido).toBe(true);
  });
});

// ── Reglas semanales ──────────────────────────────────────────────────────

describe('validarReglaSemanalPatronContexto', () => {
  it('regla válida', () => {
    expect(validarReglaSemanalPatronContexto(reglaBase()).valido).toBe(true);
  });
  it('minutos negativos', () => {
    expect(validarReglaSemanalPatronContexto(reglaBase({ minutosOrdinariosPactados: -10 })).valido).toBe(false);
  });
  it('vigencia invertida', () => {
    expect(validarReglaSemanalPatronContexto(reglaBase({ vigenteDesde: '2026-08-01', vigenteHasta: '2026-07-01' })).valido).toBe(false);
  });
});

describe('validarReglasSemanalesPatron', () => {
  it('reglas duplicadas (mismo día, orden y vigencia superpuesta)', () => {
    const r = validarReglasSemanalesPatron([
      reglaBase({ diaSemana: 'L', orden: 1, vigenteDesde: '2026-07-01' }),
      reglaBase({ diaSemana: 'L', orden: 1, vigenteDesde: '2026-07-01' }),
    ]);
    expect(r.valido).toBe(false);
  });
  it('vigencias superpuestas (mismo día/orden, periodos distintos que se cruzan)', () => {
    const r = validarReglasSemanalesPatron([
      reglaBase({ diaSemana: 'L', orden: 1, vigenteDesde: '2026-01-01', vigenteHasta: '2026-12-31' }),
      reglaBase({ diaSemana: 'L', orden: 1, vigenteDesde: '2026-06-01' }),
    ]);
    expect(r.valido).toBe(false);
  });
  it('patrón sin días trabajados', () => {
    const r = validarReglasSemanalesPatron([
      reglaBase({ diaSemana: 'L', tipoAsignacion: 'DESCANSO', bloques: [], minutosOrdinariosPactados: 0 }),
      reglaBase({ diaSemana: 'M', tipoAsignacion: 'DESCANSO', bloques: [], minutosOrdinariosPactados: 0, orden: 1 }),
    ]);
    expect(r.valido).toBe(false);
  });
  it('no exige que existan los 7 días (una sola regla activa es válida por sí sola)', () => {
    const r = validarReglasSemanalesPatron([reglaBase()]);
    expect(r.valido).toBe(true);
  });
});

// ── Excepciones ───────────────────────────────────────────────────────────

describe('validarExcepcionProgramacionContexto', () => {
  it('excepción válida', () => {
    expect(validarExcepcionProgramacionContexto(excepcionBase()).valido).toBe(true);
  });
  it('fecha inválida', () => {
    expect(validarExcepcionProgramacionContexto(excepcionBase({ fecha: '2026-02-30' })).valido).toBe(false);
  });
  it('confirmada sin usuario', () => {
    const r = validarExcepcionProgramacionContexto(excepcionBase({ estadoConfirmacion: 'CONFIRMADO', fechaConfirmacion: '2026-07-20' }));
    expect(r.valido).toBe(false);
  });
  it('confirmada sin fecha de confirmación', () => {
    const r = validarExcepcionProgramacionContexto(excepcionBase({ estadoConfirmacion: 'CONFIRMADO', usuarioConfirmo: 'adminqa' }));
    expect(r.valido).toBe(false);
  });
  it('cambio de turno sin turno ni bloques sustitutos', () => {
    const r = validarExcepcionProgramacionContexto(excepcionBase({ tipo: 'CAMBIO_TURNO' }));
    expect(r.valido).toBe(false);
  });
  it('ausencia sin bloques (válida — AUSENCIA no exige sustitución)', () => {
    const r = validarExcepcionProgramacionContexto(excepcionBase({ tipo: 'AUSENCIA' }));
    expect(r.valido).toBe(true);
  });
});

// ── Contexto ──────────────────────────────────────────────────────────────

const SEMANA_COMPLETA = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26'];
const FIN_DE_SEMANA = ['2026-07-25', '2026-07-26'];

describe('validarContextoParcial', () => {
  it('semana completa válida', () => {
    const r = validarContextoParcial({
      diasSemanaCompleta: SEMANA_COMPLETA,
      diasSolicitados: SEMANA_COMPLETA,
      diasConProgramacionConocida: SEMANA_COMPLETA,
      acumuladoAnteriorConocido: true,
    });
    expect(r.valido).toBe(true);
    expect(r.valido && r.valor.estado).toBe('COMPLETO');
  });

  it('periodo parcial con acumulado anterior conocido — COMPLETO (el acumulado cubre los días fuera del plazo)', () => {
    const r = validarContextoParcial({
      diasSemanaCompleta: SEMANA_COMPLETA,
      diasSolicitados: FIN_DE_SEMANA,
      diasConProgramacionConocida: FIN_DE_SEMANA,
      acumuladoAnteriorConocido: true,
    });
    expect(r.valido).toBe(true);
    expect(r.valido && r.valor.estado).toBe('COMPLETO');
  });

  it('periodo parcial SIN acumulado anterior conocido — REQUIERE_CONTEXTO_ANTERIOR (caso código 47, Fase 0)', () => {
    const r = validarContextoParcial({
      diasSemanaCompleta: SEMANA_COMPLETA,
      diasSolicitados: FIN_DE_SEMANA,
      diasConProgramacionConocida: FIN_DE_SEMANA,
      acumuladoAnteriorConocido: false,
    });
    expect(r.valido).toBe(true);
    expect(r.valido && r.valor.estado).toBe('REQUIERE_CONTEXTO_ANTERIOR');
    expect(r.valido && r.valor.diasFaltantes).toEqual(['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']);
  });

  it('programación diaria faltante — dentro del propio plazo solicitado, nunca cubierta por acumulado', () => {
    const r = validarContextoParcial({
      diasSemanaCompleta: SEMANA_COMPLETA,
      diasSolicitados: FIN_DE_SEMANA,
      diasConProgramacionConocida: ['2026-07-25'], // falta el 26, que SÍ está dentro del plazo solicitado
      acumuladoAnteriorConocido: true,
    });
    expect(r.valido).toBe(true);
    expect(r.valido && r.valor.estado).toBe('REQUIERE_PROGRAMACION_DIARIA');
  });

  it('nunca asume acumulado cero — el estado REQUIERE_CONTEXTO_ANTERIOR no reporta minutos, solo días faltantes', () => {
    const r = validarContextoParcial({
      diasSemanaCompleta: SEMANA_COMPLETA,
      diasSolicitados: FIN_DE_SEMANA,
      diasConProgramacionConocida: FIN_DE_SEMANA,
      acumuladoAnteriorConocido: false,
    });
    expect(r.valido && r.valor).not.toHaveProperty('minutosOrdinariosAcumulados');
  });
});

describe('validarContextoListoParaClasificar', () => {
  const entradaCompleta = {
    patronValido: true,
    contextoCompleto: true,
    programacionSuficiente: true,
    jornadaContractualDefinida: true,
    descansoObligatorioConfirmado: true,
    regimenConParametrosDisponibles: true,
    calendarioDisponibleParaFechasRequeridas: true,
    alertasBloqueantes: [],
  };

  it('contexto listo para clasificar cuando todo está en orden', () => {
    expect(validarContextoListoParaClasificar(entradaCompleta).valido).toBe(true);
  });

  it('descanso sin confirmar bloquea', () => {
    const r = validarContextoListoParaClasificar({ ...entradaCompleta, descansoObligatorioConfirmado: false });
    expect(r.valido).toBe(false);
  });

  it('calendario incompleto bloquea', () => {
    const r = validarContextoListoParaClasificar({ ...entradaCompleta, calendarioDisponibleParaFechasRequeridas: false });
    expect(r.valido).toBe(false);
  });

  it('régimen sin parámetros bloquea (caso vigilancia)', () => {
    const r = validarContextoListoParaClasificar({ ...entradaCompleta, regimenConParametrosDisponibles: false });
    expect(r.valido).toBe(false);
  });

  it('alerta bloqueante impide el estado listo', () => {
    const r = validarContextoListoParaClasificar({
      ...entradaCompleta,
      alertasBloqueantes: [{ codigo: 'X', mensaje: 'bloqueante', severidad: 'BLOQUEANTE', bloqueaCalculo: true }],
    });
    expect(r.valido).toBe(false);
  });

  it('no clasifica horas ni calcula dinero — el resultado válido solo confirma { listo: true }', () => {
    const r = validarContextoListoParaClasificar(entradaCompleta);
    expect(r.valido && r.valor).toEqual({ listo: true });
  });
});

// ── Validación cantidad de trabajadores (uso directo, además de vía patrón) ─

describe('validarCantidadTrabajadores', () => {
  it('acepta un entero positivo', () => {
    expect(validarCantidadTrabajadores(3).valido).toBe(true);
  });
  it('rechaza cero', () => {
    expect(validarCantidadTrabajadores(0).valido).toBe(false);
  });
  it('rechaza decimales', () => {
    expect(validarCantidadTrabajadores(2.5).valido).toBe(false);
  });
});
