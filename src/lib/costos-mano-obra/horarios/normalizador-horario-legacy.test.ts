import { describe, expect, it } from 'vitest';
import { normalizarHorarioLegacy } from './normalizador-horario-legacy';

describe('normalizarHorarioLegacy — casos con resultado exacto (obligatorios)', () => {
  it('1) "06:00-13:20 (HORARIO MST2)" → 440 minutos', () => {
    const r = normalizarHorarioLegacy('06:00-13:20 (HORARIO MST2)');
    expect(r.distribuciones).toHaveLength(1);
    expect(r.distribuciones[0].minutosTrabajoCalculados).toBe(440);
    expect(r.distribuciones[0].alias).toBe('HORARIO MST2');
    expect(r.estado).not.toBe('HORARIO_NO_INTERPRETABLE');
  });

  it('2) "08:00-12:00 Y 13:00 A LAS 17:48" → 528 minutos, 60 descanso', () => {
    const r = normalizarHorarioLegacy('08:00-12:00 Y 13:00 A LAS 17:48');
    const d = r.distribuciones[0];
    expect(d.minutosTrabajoCalculados).toBe(528);
    expect(d.descansosDerivados).toHaveLength(1);
    expect(d.descansosDerivados[0].minutos).toBe(60);
  });

  it('3) "7:00-10:44" → 224 minutos', () => {
    const r = normalizarHorarioLegacy('7:00-10:44');
    expect(r.distribuciones[0].minutosTrabajoCalculados).toBe(224);
    expect(r.distribuciones[0].bloques[0].inicio).toBe('07:00');
  });

  it('4) "18:00-24:00 Y 01:10-06:00" → 650 minutos, 70 descanso, offsets correctos', () => {
    const r = normalizarHorarioLegacy('18:00-24:00 Y 01:10-06:00');
    const d = r.distribuciones[0];
    expect(d.minutosTrabajoCalculados).toBe(650);
    expect(d.bloques[0]).toMatchObject({ inicio: '18:00', fin: '00:00', inicioDiaOffset: 0, finDiaOffset: 1, minutos: 360 });
    expect(d.bloques[1]).toMatchObject({ inicio: '01:10', fin: '06:00', inicioDiaOffset: 1, finDiaOffset: 1, minutos: 290 });
    expect(d.descansosDerivados[0].minutos).toBe(70);
    expect(d.cruzaMedianoche).toBe(true);
  });

  it('5) "06:00 AM-01:20 PM // 02:00 PM-09:20 PM" → dos distribuciones de 440 minutos', () => {
    const r = normalizarHorarioLegacy('06:00 AM-01:20 PM // 02:00 PM-09:20 PM');
    expect(r.distribuciones).toHaveLength(2);
    expect(r.distribuciones[0].minutosTrabajoCalculados).toBe(440);
    expect(r.distribuciones[1].minutosTrabajoCalculados).toBe(440);
    expect(r.distribuciones[0].bloques[0].inicio).toBe('06:00');
    expect(r.distribuciones[1].bloques[0].inicio).toBe('14:00');
  });

  it('6) "08:00-17:40 (DOS HORAS DE DESCANSO)" → 460 min trabajados, descanso no ubicado', () => {
    const r = normalizarHorarioLegacy('08:00-17:40 (DOS HORAS DE DESCANSO)');
    const d = r.distribuciones[0];
    expect(d.minutosTrabajoCalculados).toBe(460);
    expect(d.descansoDeclaradoMinutos).toBe(120);
    expect(d.descansoUbicado).toBe(false);
    expect(r.puedeCalcularTiempoTotal).toBe(true);
    expect(r.puedeClasificarCronologicamente).toBe(false);
    expect(r.estado).toBe('REQUIERE_UBICAR_DESCANSO');
  });

  it('7) "09:00-12:00 Y 13:00-17:20" → 440 minutos, 60 descanso', () => {
    const r = normalizarHorarioLegacy('09:00-12:00 Y 13:00-17:20');
    const d = r.distribuciones[0];
    expect(d.minutosTrabajoCalculados).toBe(440);
    expect(d.descansosDerivados[0].minutos).toBe(60);
  });

  it('8) "06:00-18:00 INCLUIDO EL DESCANSO" → tiempo indeterminado, cálculo bloqueado', () => {
    const r = normalizarHorarioLegacy('06:00-18:00 INCLUIDO EL DESCANSO');
    const d = r.distribuciones[0];
    expect(d.minutosTrabajoCalculados).toBeNull();
    expect(r.puedeCalcularTiempoTotal).toBe(false);
    expect(r.estado).toBe('REQUIERE_DETALLE_DESCANSO');
  });
});

describe('normalizarHorarioLegacy — familias adicionales', () => {
  it('familia C — cuatro horas sueltas sin "Y" se proponen como dos bloques, con advertencia', () => {
    const r = normalizarHorarioLegacy('08:00-12:00 13:00-17:00 L-V');
    const d = r.distribuciones[0];
    expect(d.bloques).toHaveLength(2);
    expect(d.advertencias.some(a => /separador "Y"/.test(a))).toBe(true);
    expect(r.estado).toBe('NORMALIZADO_CON_ADVERTENCIAS');
  });

  it('rotaciones ("//") nunca se suman como bloques simultáneos', () => {
    const r = normalizarHorarioLegacy('06:00-14:00 // 14:00-22:00 // 22:00-06:00 TURNANTE');
    expect(r.distribuciones).toHaveLength(3);
    expect(r.distribuciones.every(d => d.tipoAplicacion === 'TURNANTE')).toBe(true);
  });

  it('alternativas ("Ó") nunca se suman', () => {
    const r = normalizarHorarioLegacy('08:00-16:00 Ó 09:00-17:00');
    expect(r.distribuciones).toHaveLength(2);
    expect(r.distribuciones.every(d => d.tipoAplicacion === 'ALTERNATIVO')).toBe(true);
  });

  it('12:00 AM → 00:00', () => {
    const r = normalizarHorarioLegacy('12:00 AM-06:00 AM');
    expect(r.distribuciones[0].bloques[0].inicio).toBe('00:00');
  });

  it('12:00 PM → 12:00', () => {
    const r = normalizarHorarioLegacy('12:00 PM-06:00 PM');
    expect(r.distribuciones[0].bloques[0].inicio).toBe('12:00');
  });

  it('12:00 M → 12:00, con advertencia', () => {
    const r = normalizarHorarioLegacy('12:00 M-06:00 PM');
    expect(r.distribuciones[0].bloques[0].inicio).toBe('12:00');
    expect(r.distribuciones[0].advertencias.some(a => /mediodía/.test(a))).toBe(true);
  });

  it('20:40 PM conserva 20:40 con advertencia de marcador redundante', () => {
    const r = normalizarHorarioLegacy('20:40 PM-23:00');
    expect(r.distribuciones[0].bloques[0].inicio).toBe('20:40');
    expect(r.distribuciones[0].advertencias.some(a => /redundante/.test(a))).toBe(true);
  });

  it('cero inicial ausente ("7:00") se completa con advertencia', () => {
    const r = normalizarHorarioLegacy('7:00-10:00');
    expect(r.distribuciones[0].bloques[0].inicio).toBe('07:00');
    expect(r.distribuciones[0].advertencias.some(a => /cero inicial/.test(a))).toBe(true);
  });

  it('minutos > 59 se bloquean, nunca se auto-aceptan', () => {
    const r = normalizarHorarioLegacy('08:75-12:00');
    expect(r.estado).toBe('HORARIO_NO_INTERPRETABLE');
    expect(r.puedeCalcularTiempoTotal).toBe(false);
  });

  it('horas > 24 se bloquean', () => {
    const r = normalizarHorarioLegacy('25:00-12:00');
    expect(r.estado).toBe('HORARIO_NO_INTERPRETABLE');
  });

  it('24:30 no se auto-normaliza — requiere confirmar hora, con sugerencia nunca aplicada', () => {
    const r = normalizarHorarioLegacy('18:00-24:30');
    expect(r.estado).toBe('REQUIERE_CONFIRMAR_HORA');
    expect(r.puedeAplicarse).toBe(false);
    expect(r.camposPendientes.some(c => c.campo === 'hora')).toBe(true);
  });

  it('familia L — descanso con duración conocida pero ubicación desconocida', () => {
    const r = normalizarHorarioLegacy('08:00-17:40 (DOS HORAS DE DESCANSO)');
    const d = r.distribuciones[0];
    expect(d.descansoDeclaradoMinutos).toBe(120);
    expect(d.descansoUbicado).toBe(false);
    expect(r.estado).toBe('REQUIERE_UBICAR_DESCANSO');
  });

  it('familia M — descanso sin duración, cálculo bloqueado', () => {
    const r = normalizarHorarioLegacy('06:00-18:00 INCLUIDO EL DESCANSO');
    expect(r.puedeCalcularTiempoTotal).toBe(false);
    expect(r.estado).toBe('REQUIERE_DETALLE_DESCANSO');
  });

  it('metadata: alias, TURNANTE y días abreviados se extraen sin mezclarse con las horas', () => {
    const r = normalizarHorarioLegacy('07:00-15:00 (HORARIO A1) L-V');
    const d = r.distribuciones[0];
    expect(d.alias).toBe('HORARIO A1');
    expect(d.diasSemana).toEqual(['L', 'M', 'X', 'J', 'V']);
    expect(d.fuenteDias).toBe('TEXTO_HORARIO');
  });

  it('separador degradado "/" simple nunca se aprueba en silencio', () => {
    const r = normalizarHorarioLegacy('08:00-16:00 / 09:00-17:00', {
      jornadaTexto: 'LUNES A VIERNES // SABADO',
    });
    expect(r.estado).toBe('REQUIERE_CONFIRMAR_SEPARADORES');
    expect(r.advertencias.some(a => a.mensaje.includes('/'))).toBe(true);
  });

  it('separador degradado "://" se interpreta como "//" con advertencia', () => {
    const r = normalizarHorarioLegacy('08:00-16:00 :// 09:00-17:00', {
      jornadaTexto: 'LUNES A VIERNES // SABADO',
    });
    expect(r.distribuciones).toHaveLength(2);
    expect(r.estado).toBe('REQUIERE_CONFIRMAR_SEPARADORES');
  });

  it('sin días detectables — requiere asignar días', () => {
    const r = normalizarHorarioLegacy('08:00-16:00');
    expect(r.estado).toBe('REQUIERE_ASIGNAR_DIAS');
    expect(r.puedeCalcularTiempoTotal).toBe(true);
    expect(r.puedeClasificarCronologicamente).toBe(true);
  });

  it('múltiples distribuciones ("//") con auto-asignación de días desde JORNADA cuando coinciden los segmentos', () => {
    const r = normalizarHorarioLegacy('07:00-12:00 Y 13:00-16:07 // 07:00-10:30', {
      jornadaTexto: 'LUNES A VIERNES // SABADO',
    });
    expect(r.distribuciones).toHaveLength(2);
    expect(r.distribuciones[0].diasSemana).toEqual(['L', 'M', 'X', 'J', 'V']);
    expect(r.distribuciones[0].fuenteDias).toBe('TEXTO_JORNADA');
    expect(r.distribuciones[1].diasSemana).toEqual(['S']);
  });

  it('posible intercambio de campos — HORARIO sin horas, JORNADA con horas', () => {
    const r = normalizarHorarioLegacy('TURNANTE L-V', { jornadaTexto: '08:00-16:00' });
    expect(r.estado).toBe('POSIBLE_INTERCAMBIO_DE_CAMPOS');
    expect(r.puedeAplicarse).toBe(false);
  });

  it('difiere de datos declarados — conserva ambos valores, nunca descarta ninguno', () => {
    const r = normalizarHorarioLegacy('08:00-12:00 Y 13:00-17:20 L-V', { horasSemanaDeclaradas: 40 });
    expect(r.estado).toBe('DIFIERE_DE_DATOS_DECLARADOS');
    expect(r.horasSemanaDeclaradas).toBe(40);
    expect(r.minutosSemanaCalculados).toBe(500 * 5);
  });

  it('texto vacío → no interpretable, requiere confirmación', () => {
    const r = normalizarHorarioLegacy('');
    expect(r.estado).toBe('HORARIO_NO_INTERPRETABLE');
    expect(r.requiereConfirmacion).toBe(true);
  });

  it('nunca pierde el texto original', () => {
    const original = '  08:00-12:00   y   13:00-17:20  ';
    const r = normalizarHorarioLegacy(original);
    expect(r.textoOriginal).toBe(original);
  });
});