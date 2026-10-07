/**
 * Casos del catálogo real reportados por el usuario (BLOQUE: CORRECCIÓN DE
 * ESTADOS DEL CATÁLOGO NORMALIZADO) — verifican que el normalizador NO
 * colapsa todo en un estado genérico, y que el estado de normalización del
 * catálogo es independiente del estado frente a la jornada de un cargo.
 */
import { describe, expect, it } from 'vitest';
import { normalizarHorarioLegacy } from './normalizador-horario-legacy';

describe('catálogo real — códigos reportados por el usuario', () => {
  it('código 1: 44h calculadas vs 48h declaradas → DIFIERE_DE_DATOS_DECLARADOS (no "Requiere revisión")', () => {
    const r = normalizarHorarioLegacy('08:00-12:00 Y 14:00-17:20', {
      jornadaTexto: 'LUNES A SABADO', horasSemanaDeclaradas: 48,
    });
    expect(r.estado).toBe('DIFIERE_DE_DATOS_DECLARADOS');
    expect(r.minutosSemanaCalculados).toBe(2640); // 44h
    expect(r.horasSemanaDeclaradas).toBe(48);
  });

  it('código 4: 44h calculadas = 44h declaradas → NORMALIZADO', () => {
    const r = normalizarHorarioLegacy('06:00-11:00 Y 12:00-14:20', {
      jornadaTexto: 'LUNES A SABADO', horasSemanaDeclaradas: 44,
    });
    expect(r.estado).toBe('NORMALIZADO');
    expect(r.minutosSemanaCalculados).toBe(2640);
  });

  it('código 5: separador "A" → NORMALIZADO (nunca "Requiere revisión")', () => {
    const r = normalizarHorarioLegacy('06:00 A 13:20', {
      jornadaTexto: 'LUNES A SABADO', horasSemanaDeclaradas: 44,
    });
    expect(['NORMALIZADO', 'NORMALIZADO_CON_ADVERTENCIAS']).toContain(r.estado);
    expect(r.distribuciones[0].minutosTrabajoCalculados).toBe(440);
  });

  it('código 7: 33h calculadas = 33h declaradas → NORMALIZADO', () => {
    const r = normalizarHorarioLegacy('07:00-12:30', {
      jornadaTexto: 'LUNES A SABADO', horasSemanaDeclaradas: 33,
    });
    expect(r.estado).toBe('NORMALIZADO');
  });

  it('código 9: 22h calculadas = 22h declaradas → NORMALIZADO', () => {
    const r = normalizarHorarioLegacy('07:00-10:40', {
      jornadaTexto: 'LUNES A SABADO', horasSemanaDeclaradas: 22,
    });
    expect(r.estado).toBe('NORMALIZADO');
  });

  it('código 10/11: 44h calculadas = 44h declaradas → NORMALIZADO', () => {
    const r = normalizarHorarioLegacy('06:00-12:00 Y 14:00-15:20', {
      jornadaTexto: 'LUNES A SABADO', horasSemanaDeclaradas: 44,
    });
    expect(r.estado).toBe('NORMALIZADO');
  });

  it('código 36: dos distribuciones ("//"), nunca se suman como si fueran simultáneas', () => {
    const r = normalizarHorarioLegacy('07:00-12:00 Y 14:00-16:20 // 08:00-11:40', {
      jornadaTexto: 'LUNES A SABADO // DOMINGO Y FESTIVOS',
    });
    expect(r.distribuciones).toHaveLength(2);
    expect(r.distribuciones[0].diasSemana).toEqual(['L', 'M', 'X', 'J', 'V', 'S']);
    expect(r.distribuciones[0].minutosTrabajoCalculados).toBe(440);
    expect(r.distribuciones[1].diasSemana).toEqual(['D']);
    expect(r.distribuciones[1].minutosTrabajoCalculados).toBe(220);
    expect(r.estado).toBe('NORMALIZADO');
    // Nunca una suma simultánea de 44h + horas de domingo como si fuera una
    // sola semana de un mismo trabajador.
    expect(r.minutosSemanaCalculados).toBeNull(); // dos patrones distintos, no se agregan en un único total simple
  });

  it('código 39: cruce de medianoche con datos insuficientes → estado pendiente concreto, no genérico', () => {
    const r = normalizarHorarioLegacy('16:00-08:00', { horasSemanaDeclaradas: 48 });
    expect([
      'REQUIERE_CONFIRMAR_CRUCE_MEDIANOCHE',
      'REQUIERE_DETALLE_DESCANSO',
      'REQUIERE_CONFIRMAR_ROTACION',
      'REQUIERE_ASIGNAR_DIAS',
    ]).toContain(r.estado);
    expect(r.estado).not.toBe('HORARIO_NO_INTERPRETABLE');
  });

  it('código 47/49: turno 7X1 usa el modelo cíclico (7 trabajados + 1 descanso rotativo), nunca "REQUIERE_CONFIRMAR_ROTACION" genérico', () => {
    const r = normalizarHorarioLegacy('06:00-14:00', {
      jornadaTexto: 'LUNES A DOMINGOS Y FESTIVOS', turnoTexto: '7X1', horasSemanaDeclaradas: 44,
    });
    expect(r.estado).not.toBe('REQUIERE_CONFIRMAR_ROTACION');
    expect(r.patronTurnoCiclico).not.toBeNull();
    expect(r.estadoAsignacion).toBe('REQUIERE_FECHA_INICIO_ROTACION');
  });

  it('un horario de 44h correctamente interpretado NO queda pendiente solo por superar 42h — el normalizador no conoce la jornada legal', () => {
    const r = normalizarHorarioLegacy('06:00-11:00 Y 12:00-14:20', {
      jornadaTexto: 'LUNES A SABADO', horasSemanaDeclaradas: 44,
    });
    expect(r.estado).toBe('NORMALIZADO');
    // El normalizador ni siquiera recibe un umbral de 42h — la comparación
    // contra la jornada legal del cargo es un concepto totalmente aparte,
    // que no forma parte de este contrato de salida.
    expect(r).not.toHaveProperty('estadoFrenteAJornada');
  });

  it('el estado de normalización del catálogo es independiente de cuántas horas declare (44/48/22/33 todas pueden ser NORMALIZADO si coinciden con lo calculado)', () => {
    const casos: Array<[string, number]> = [
      ['07:00-10:40', 22],
      ['07:00-12:30', 33],
      ['06:00-11:00 Y 12:00-14:20', 44],
    ];
    for (const [horario, horas] of casos) {
      const r = normalizarHorarioLegacy(horario, { jornadaTexto: 'LUNES A SABADO', horasSemanaDeclaradas: horas });
      expect(r.estado).toBe('NORMALIZADO');
    }
  });

  it('ningún estado real conocido queda fuera del contrato de 13 estados (nunca undefined)', () => {
    const horarios = [
      '08:00-12:00 Y 14:00-17:20', '06:00-11:00 Y 12:00-14:20', '06:00 A 13:20',
      '07:00-12:30', '07:00-10:40', '06:00-12:00 Y 14:00-15:20',
      '07:00-12:00 Y 14:00-16:20 // 08:00-11:40', '16:00-08:00',
    ];
    const ESTADOS_VALIDOS = new Set([
      'NORMALIZADO', 'NORMALIZADO_CON_ADVERTENCIAS', 'DIFIERE_DE_DATOS_DECLARADOS',
      'REQUIERE_ASIGNAR_DIAS', 'REQUIERE_CONFIRMAR_ROTACION', 'REQUIERE_DETALLE_DESCANSO',
      'REQUIERE_UBICAR_DESCANSO', 'REQUIERE_CONFIRMAR_HORA', 'REQUIERE_CONFIRMAR_SEPARADORES',
      'REQUIERE_CONFIRMAR_CRUCE_MEDIANOCHE', 'POSIBLE_INTERCAMBIO_DE_CAMPOS',
      'HORARIO_COMPUESTO_PENDIENTE', 'HORARIO_NO_INTERPRETABLE',
    ]);
    for (const horario of horarios) {
      const r = normalizarHorarioLegacy(horario, { jornadaTexto: 'LUNES A SABADO', horasSemanaDeclaradas: 44 });
      expect(ESTADOS_VALIDOS.has(r.estado)).toBe(true);
    }
  });
});

describe('validación masiva simulada — distribución por estado', () => {
  // Muestra representativa que combina simples, multibloque, multi-
  // distribución, rotaciones y casos ambiguos — para comprobar que no todo
  // cae en un mismo estado.
  const muestra: Array<{ horario: string; jornada?: string; turno?: string; horasSemana?: number }> = [
    { horario: '08:00-12:00 Y 14:00-17:20', jornada: 'LUNES A SABADO', horasSemana: 48 },
    { horario: '06:00-11:00 Y 12:00-14:20', jornada: 'LUNES A SABADO', horasSemana: 44 },
    { horario: '06:00 A 13:20', jornada: 'LUNES A SABADO', horasSemana: 44 },
    { horario: '07:00-12:30', jornada: 'LUNES A SABADO', horasSemana: 33 },
    { horario: '07:00-10:40', jornada: 'LUNES A SABADO', horasSemana: 22 },
    { horario: '06:00-12:00 Y 14:00-15:20', jornada: 'LUNES A SABADO', horasSemana: 44 },
    { horario: '07:00-12:00 Y 14:00-16:20 // 08:00-11:40', jornada: 'LUNES A SABADO // DOMINGO Y FESTIVOS' },
    { horario: '16:00-08:00', horasSemana: 48 },
    { horario: '06:00-14:00', jornada: 'LUNES A DOMINGOS Y FESTIVOS', turno: '7X1', horasSemana: 44 },
    { horario: '08:00-17:40 (DOS HORAS DE DESCANSO)', jornada: 'LUNES A SABADO' },
    { horario: '06:00-18:00 INCLUIDO EL DESCANSO', jornada: 'LUNES A SABADO' },
    { horario: '08:00-16:00', jornada: 'LUNES A VIERNES' },
    { horario: '08:00-16:00' }, // sin días
  ];

  it('la muestra produce una distribución variada de estados — nunca todo en un mismo estado', () => {
    const conteo: Record<string, number> = {};
    for (const c of muestra) {
      const r = normalizarHorarioLegacy(c.horario, {
        jornadaTexto: c.jornada ?? null, turnoTexto: c.turno ?? null, horasSemanaDeclaradas: c.horasSemana ?? null,
      });
      conteo[r.estado] = (conteo[r.estado] || 0) + 1;
    }
    const estadosDistintos = Object.keys(conteo).length;
    expect(estadosDistintos).toBeGreaterThan(1);
    expect(conteo.NORMALIZADO).toBeGreaterThan(0);
    // Ningún estado inventado ni undefined.
    expect(Object.keys(conteo).every(e => e !== 'undefined' && e.length > 0)).toBe(true);
    // No es razonable que absolutamente todo caiga en un genérico de
    // revisión — el normalizador no produce ese estado en absoluto (no es
    // parte de EstadoNormalizacionHorario), así que esta condición siempre
    // se cumple estructuralmente, pero se deja como guardia explícita.
    expect(conteo['Requiere revisión']).toBeUndefined();
  });
});