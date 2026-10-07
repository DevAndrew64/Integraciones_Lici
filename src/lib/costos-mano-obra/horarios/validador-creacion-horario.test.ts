import { describe, it, expect } from 'vitest';
import {
  validarYCalcularHorario,
  construirPayloadCreacionExterna,
  validarRespuestaCrearTurnoExterno,
  normalizarCodigoExterno,
  decidirAccionPersistencia,
} from './validador-creacion-horario';
import type { DiasJornada } from './tipos';

function dias(overrides: Partial<DiasJornada> = {}): DiasJornada {
  return { lun: false, mar: false, mie: false, jue: false, vie: false, sab: false, dom: false, fes: false, ...overrides };
}

const LUNES_A_SABADO = dias({ lun: true, mar: true, mie: true, jue: true, vie: true, sab: true });

describe('validarYCalcularHorario — el servidor nunca confía en los valores digitados', () => {
  it('valores manuales 40/8 contradicen 44/7h20 — se genera advertencia trazable', () => {
    const r = validarYCalcularHorario({
      empresa: 'aseo', horario: '08:00-12:00 Y 14:00-17:20', dias: LUNES_A_SABADO,
      horasSemanaDeclarada: 40, horasJornadaDeclarada: 8,
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.advertencias).toEqual([
      'Las horas declaradas no coincidían con los bloques del horario. Se utilizaron 7 h 20 min diarias y 44 horas semanales.',
    ]);
  });

  it('el servidor siempre utiliza los valores calculados, nunca los declarados', () => {
    const r = validarYCalcularHorario({
      empresa: 'aseo', horario: '08:00-12:00 Y 14:00-17:20', dias: LUNES_A_SABADO,
      horasSemanaDeclarada: 40, horasJornadaDeclarada: 8,
    });
    expect(r.ok && r.calculo.horasSemanalesDecimal).toBe(44);
    expect(r.ok && r.calculo.minutosDiarios).toBe(440);
  });

  it('sin declarar horasSemana/horasJornada, no genera advertencia (nada que contradecir)', () => {
    const r = validarYCalcularHorario({ empresa: 'aseo', horario: '08:00-12:00 Y 14:00-17:20', dias: LUNES_A_SABADO });
    expect(r.ok).toBe(true);
    expect(r.ok && r.advertencias).toEqual([]);
  });

  it('valores declarados que sí coinciden no generan advertencia', () => {
    const r = validarYCalcularHorario({
      empresa: 'aseo', horario: '08:00-12:00 Y 14:00-17:20', dias: LUNES_A_SABADO,
      horasSemanaDeclarada: 44, horasJornadaDeclarada: 440 / 60,
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.advertencias).toEqual([]);
  });

  it('empresa obligatoria', () => {
    const r = validarYCalcularHorario({ empresa: '', horario: '08:00-12:00', dias: LUNES_A_SABADO });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errores.some(e => e.includes('empresa'))).toBe(true);
  });

  it('horario obligatorio', () => {
    const r = validarYCalcularHorario({ empresa: 'aseo', horario: '', dias: LUNES_A_SABADO });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errores.some(e => e.includes('horario'))).toBe(true);
  });

  it('al menos un día de lunes a domingo (festivo solo no basta)', () => {
    const r = validarYCalcularHorario({ empresa: 'aseo', horario: '08:00-12:00', dias: dias({ fes: true }) });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errores.some(e => e.toLowerCase().includes('día'))).toBe(true);
  });

  it('bloques inválidos se propagan como error, no se corrigen', () => {
    const r = validarYCalcularHorario({ empresa: 'aseo', horario: '10:00-10:00', dias: LUNES_A_SABADO });
    expect(r.ok).toBe(false);
  });
});

describe('construirPayloadCreacionExterna', () => {
  it('h_inicial y h_final en formato HH:mm:ss', () => {
    const payload = construirPayloadCreacionExterna({
      empresa: 'aseo', horario: '08:00-12:00 Y 14:00-17:20', turno: 'Diurno', jornada: 'Lunes a sábado',
      horasSemanalesDecimal: 44, horasDiariasDecimal: 440 / 60,
      horaInicial: '08:00', horaFinal: '17:20',
      dias: LUNES_A_SABADO, bonos: dias({ lun: true, mar: true, mie: true, jue: true, vie: true, sab: true }),
      diaDescansoFijo: false,
    });
    expect(payload.h_inicial).toBe('08:00:00');
    expect(payload.h_final).toBe('17:20:00');
    expect(payload.horas_sem).toBe(44);
  });

  it('nunca omite un campo booleano falso (false no se vuelve ausencia)', () => {
    const payload = construirPayloadCreacionExterna({
      empresa: 'aseo', horario: '08:00-12:00', turno: '', jornada: '',
      horasSemanalesDecimal: 24, horasDiariasDecimal: 4,
      horaInicial: '08:00', horaFinal: '12:00',
      dias: dias({ lun: true, mar: true, mie: true, jue: true, vie: true, sab: true }),
      bonos: dias(), // todos false
      diaDescansoFijo: false,
    });
    expect('snbono_lunes' in payload).toBe(true);
    expect(payload.snbono_lunes).toBe(false);
    expect('sn_jorn_dom' in payload).toBe(true);
    expect(payload.sn_jorn_dom).toBe(false);
  });

  it('no envía undefined para campos opcionales no provistos', () => {
    const payload = construirPayloadCreacionExterna({
      empresa: 'aseo', horario: '08:00-12:00', turno: '', jornada: '',
      horasSemanalesDecimal: 24, horasDiariasDecimal: 4,
      horaInicial: '08:00', horaFinal: '12:00',
      dias: LUNES_A_SABADO, bonos: LUNES_A_SABADO, diaDescansoFijo: false,
    });
    expect('cod_midasoft' in payload).toBe(false);
    expect('porvar' in payload).toBe(false);
    expect(JSON.stringify(payload)).not.toContain('undefined');
  });
});

describe('validarRespuestaCrearTurnoExterno', () => {
  it('respuesta válida', () => {
    const r = validarRespuestaCrearTurnoExterno({ success: true, data: { codigo: '00042' } });
    expect(r.ok).toBe(true);
    expect(r.ok && r.data.codigo).toBe('00042');
  });
  it('success false', () => {
    const r = validarRespuestaCrearTurnoExterno({ success: false, message: 'error interno' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe('error interno');
  });
  it('sin data', () => {
    const r = validarRespuestaCrearTurnoExterno({ success: true });
    expect(r.ok).toBe(false);
  });
  it('sin codigo', () => {
    const r = validarRespuestaCrearTurnoExterno({ success: true, data: {} });
    expect(r.ok).toBe(false);
  });
  it('respuesta no es un objeto', () => {
    const r = validarRespuestaCrearTurnoExterno(null);
    expect(r.ok).toBe(false);
  });
});

describe('normalizarCodigoExterno — código externo como String', () => {
  it('código ya string conserva ceros a la izquierda', () => {
    const r = normalizarCodigoExterno('00042');
    expect(r.codigo).toBe('00042');
    expect(r.advertencia).toBeNull();
  });
  it('código numérico genera advertencia y se convierte a String sin inventar ceros', () => {
    const r = normalizarCodigoExterno(42);
    expect(r.codigo).toBe('42');
    expect(r.advertencia).not.toBeNull();
    expect(r.codigo).not.toBe('00042'); // nunca se inventan ceros
  });
  it('valor no reconocible', () => {
    const r = normalizarCodigoExterno(undefined);
    expect(r.codigo).toBe('');
    expect(r.advertencia).not.toBeNull();
  });
});

describe('decidirAccionPersistencia — identidad empresa+codigo', () => {
  it('sin registro existente → CREAR', () => {
    expect(decidirAccionPersistencia(null)).toBe('CREAR');
  });
  it('con registro existente (misma empresa+codigo) → ACTUALIZAR', () => {
    expect(decidirAccionPersistencia({ id: 1, empresa: 'aseo', codigo: '00042' })).toBe('ACTUALIZAR');
  });
});
