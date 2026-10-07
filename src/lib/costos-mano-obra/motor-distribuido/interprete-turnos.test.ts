/**
 * Intérprete automático de turnos — pruebas obligatorias A/B/F del cierre
 * "IMPLEMENTACIÓN DEFINITIVA — INTÉRPRETE AUTOMÁTICO DE TURNOS" (metadata
 * de interpretación, sin cálculo monetario — eso se prueba en
 * derivar-distribucion-comercial.test.ts, casos C/D).
 */
import { describe, expect, it } from 'vitest';
import { interpretarOperacionTurno, notasInterpretacionTurno, VERSION_INTERPRETADOR_TURNOS } from './interprete-turnos';
import { normalizarBloques24Horas } from './normalizar-bloques-turno';
import type { DiaSemanaHorario } from '../horarios/tipos';

const LUNES_A_DOMINGO: DiaSemanaHorario[] = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const LUNES_A_SABADO: DiaSemanaHorario[] = ['L', 'M', 'X', 'J', 'V', 'S'];

describe('A) Avianca — una posición 24/7', () => {
  const bloques = normalizarBloques24Horas([{ inicio: '06:00', fin: '06:00', orden: 1 }]); // se divide en 06-18 + 18-06
  const r = interpretarOperacionTurno({ diasSemana: LUNES_A_DOMINGO, bloques, incluyeFestivos: true, cantidad: 1 });

  it('tipo COBERTURA_24_7', () => { expect(r.tipoOperacionInterpretada).toBe('COBERTURA_24_7'); });
  it('significadoCantidad = POSICIONES', () => { expect(r.significadoCantidad).toBe('POSICIONES'); });
  it('cantidadPosiciones = 1', () => { expect(r.cantidadPosiciones).toBe(1); });
  it('dos turnos de 12 horas', () => { expect(r.turnosInterpretados).toBe(2); expect(r.duracionTurnoHoras).toBe(12); });
  it('cobertura semanal por posición = 168 horas', () => { expect(r.coberturaSemanalPorPosicion).toBe(168); });
  it('cobertura semanal total = 168 (1 posición)', () => { expect(r.coberturaSemanalTotal).toBe(168); });
  it('requiereTurnantes y brechaCoberturaPendiente en true', () => {
    expect(r.requiereTurnantes).toBe(true);
    expect(r.brechaCoberturaPendiente).toBe(true);
  });
  it('cruza medianoche', () => { expect(r.cruzaMedianoche).toBe(true); });
  it('versionInterpretador presente', () => { expect(r.versionInterpretador).toBe(VERSION_INTERPRETADOR_TURNOS); });
});

describe('B) Avianca — tres posiciones 24/7 (no tres trabajadores)', () => {
  const bloques = [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }];
  const r = interpretarOperacionTurno({ diasSemana: LUNES_A_DOMINGO, bloques, incluyeFestivos: true, cantidad: 3 });

  it('tipo COBERTURA_24_7', () => { expect(r.tipoOperacionInterpretada).toBe('COBERTURA_24_7'); });
  it('cantidad interpretada como 3 posiciones, no 3 trabajadores', () => {
    expect(r.significadoCantidad).toBe('POSICIONES');
    expect(r.cantidadPosiciones).toBe(3);
  });
  it('cobertura total 504 horas (3 × 168)', () => { expect(r.coberturaSemanalTotal).toBe(504); });
  it('cobertura por posición sigue siendo 168 (no se reparte)', () => { expect(r.coberturaSemanalPorPosicion).toBe(168); });
});

describe('E) Bloque 06:00–06:00', () => {
  it('se divide automáticamente en dos turnos, sin preguntar, sin cero horas, sin ser una persona 24h', () => {
    const bloquesNormalizados = normalizarBloques24Horas([{ inicio: '06:00', fin: '06:00', orden: 1 }]);
    expect(bloquesNormalizados).toHaveLength(2);
    const r = interpretarOperacionTurno({ diasSemana: LUNES_A_DOMINGO, bloques: bloquesNormalizados, incluyeFestivos: true, cantidad: 1 });
    expect(r.tipoOperacionInterpretada).toBe('COBERTURA_24_7');
    expect(r.turnosInterpretados).toBe(2);
    expect(r.coberturaSemanalPorPosicion).toBe(168); // nunca 24×7=168 atribuido a 1 sola persona sin turnos
    expect(r.requiereTurnantes).toBe(true);
  });
});

describe('F) Cobertura 12/7', () => {
  const bloques = [{ inicio: '06:00', fin: '18:00', orden: 1 }];
  const r = interpretarOperacionTurno({ diasSemana: LUNES_A_DOMINGO, bloques, incluyeFestivos: true, cantidad: 1 });

  it('tipo COBERTURA_12_7', () => { expect(r.tipoOperacionInterpretada).toBe('COBERTURA_12_7'); });
  it('un turno de 12 horas', () => { expect(r.turnosInterpretados).toBe(1); expect(r.duracionTurnoHoras).toBe(12); });
  it('cobertura semanal por posición = 84 horas', () => { expect(r.coberturaSemanalPorPosicion).toBe(84); });
  it('requiereTurnantes = true', () => { expect(r.requiereTurnantes).toBe(true); });
  it('significadoCantidad = POSICIONES', () => { expect(r.significadoCantidad).toBe('POSICIONES'); });
});

describe('TURNO_12_HORAS_INDIVIDUAL — no es cobertura permanente', () => {
  it('un bloque de 12h en solo L-V (sin domingo/festivos) no es COBERTURA_12_7', () => {
    const bloques = [{ inicio: '06:00', fin: '18:00', orden: 1 }];
    const r = interpretarOperacionTurno({ diasSemana: ['L', 'M', 'X', 'J', 'V'], bloques, incluyeFestivos: false, cantidad: 1 });
    expect(r.tipoOperacionInterpretada).toBe('TURNO_12_HORAS_INDIVIDUAL');
    expect(r.significadoCantidad).toBe('TRABAJADORES');
    expect(r.requiereTurnantes).toBe(false);
    expect(r.brechaCoberturaPendiente).toBe(false);
  });

  it('un bloque de 12h en L-D pero sin incluirFestivos no es COBERTURA_12_7', () => {
    const bloques = [{ inicio: '06:00', fin: '18:00', orden: 1 }];
    const r = interpretarOperacionTurno({ diasSemana: LUNES_A_DOMINGO, bloques, incluyeFestivos: false, cantidad: 1 });
    expect(r.tipoOperacionInterpretada).toBe('TURNO_12_HORAS_INDIVIDUAL');
  });
});

describe('G) Jornadas normales anteriores — sin regresión', () => {
  it('jornada estándar diurna 8h, L-S, no es ninguno de los patrones de 12h/cobertura', () => {
    const bloques = [{ inicio: '08:00', fin: '17:00', orden: 1 }];
    const r = interpretarOperacionTurno({ diasSemana: LUNES_A_SABADO, bloques, incluyeFestivos: false, cantidad: 1 });
    expect(r.tipoOperacionInterpretada).toBe('JORNADA_INDIVIDUAL');
    expect(r.significadoCantidad).toBe('TRABAJADORES');
    expect(r.requiereTurnantes).toBe(false);
  });
});

describe('H) Jornada parcial sin sábado', () => {
  it('L-V (sin sábado) se clasifica como JORNADA_PARCIAL', () => {
    const bloques = [{ inicio: '08:00', fin: '17:00', orden: 1 }];
    const r = interpretarOperacionTurno({ diasSemana: ['L', 'M', 'X', 'J', 'V'], bloques, incluyeFestivos: false, cantidad: 1 });
    expect(r.tipoOperacionInterpretada).toBe('JORNADA_PARCIAL');
    expect(r.significadoCantidad).toBe('TRABAJADORES');
  });
});

describe('§10.1/§10.2 — notasInterpretacionTurno: aparece la nota, nunca una pregunta', () => {
  it('1) la nota informativa aparece en coberturas 24/7', () => {
    const bloques = [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }];
    const r = interpretarOperacionTurno({ diasSemana: LUNES_A_DOMINGO, bloques, incluyeFestivos: true, cantidad: 1 });
    const notas = notasInterpretacionTurno(r);
    expect(notas).toContain('Cobertura 24/7 detectada: dos turnos diarios de 12 horas.');
    expect(notas).toContain('Cantidad interpretada como posiciones de servicio.');
    expect(notas).toContain('Resultado provisional pendiente de titulares y turnantes.');
  });

  it('1) la nota informativa aparece en coberturas 12/7', () => {
    const bloques = [{ inicio: '06:00', fin: '18:00', orden: 1 }];
    const r = interpretarOperacionTurno({ diasSemana: LUNES_A_DOMINGO, bloques, incluyeFestivos: true, cantidad: 1 });
    const notas = notasInterpretacionTurno(r);
    expect(notas).toContain('Cobertura 12/7 detectada: un turno diario de 12 horas.');
  });

  it('tres posiciones producen la nota "Tres posiciones simultáneas."', () => {
    const bloques = [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }];
    const r = interpretarOperacionTurno({ diasSemana: LUNES_A_DOMINGO, bloques, incluyeFestivos: true, cantidad: 3 });
    expect(notasInterpretacionTurno(r)).toContain('Tres posiciones simultáneas.');
  });

  it('jornada individual también produce una nota (siempre hay al menos una línea)', () => {
    const bloques = [{ inicio: '08:00', fin: '17:00', orden: 1 }];
    const r = interpretarOperacionTurno({ diasSemana: LUNES_A_SABADO, bloques, incluyeFestivos: false, cantidad: 1 });
    expect(notasInterpretacionTurno(r)).toEqual(['Jornada individual interpretada.']);
  });

  it('2) ninguna nota contiene signo de interrogación (nunca es una pregunta)', () => {
    const casos: Array<[DiaSemanaHorario[], { inicio: string; fin: string; orden: number }[], boolean, number]> = [
      [LUNES_A_DOMINGO, [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }], true, 3],
      [LUNES_A_DOMINGO, [{ inicio: '06:00', fin: '18:00', orden: 1 }], true, 1],
      [LUNES_A_SABADO, [{ inicio: '08:00', fin: '17:00', orden: 1 }], false, 1],
      [['L', 'M', 'X', 'J', 'V'], [{ inicio: '08:00', fin: '17:00', orden: 1 }], false, 1],
    ];
    for (const [dias, bloques, incluyeFestivos, cantidad] of casos) {
      const r = interpretarOperacionTurno({ diasSemana: dias, bloques, incluyeFestivos, cantidad });
      for (const nota of notasInterpretacionTurno(r)) {
        expect(nota).not.toMatch(/\?/);
      }
    }
  });

  it('3/4) cobertura 24/7 y 12/7 quedan marcadas como provisionales (brechaCoberturaPendiente=true)', () => {
    const b24 = [{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }];
    const b12 = [{ inicio: '06:00', fin: '18:00', orden: 1 }];
    const r24 = interpretarOperacionTurno({ diasSemana: LUNES_A_DOMINGO, bloques: b24, incluyeFestivos: true, cantidad: 1 });
    const r12 = interpretarOperacionTurno({ diasSemana: LUNES_A_DOMINGO, bloques: b12, incluyeFestivos: true, cantidad: 1 });
    expect(r24.brechaCoberturaPendiente).toBe(true);
    expect(r12.brechaCoberturaPendiente).toBe(true);
    expect(notasInterpretacionTurno(r24)).toContain('Resultado provisional pendiente de titulares y turnantes.');
    expect(notasInterpretacionTurno(r12)).toContain('Resultado provisional pendiente de titulares y turnantes.');
  });

  it('13) jornadas normales NO se marcan como provisionales', () => {
    const bloques = [{ inicio: '08:00', fin: '17:00', orden: 1 }];
    const r = interpretarOperacionTurno({ diasSemana: LUNES_A_SABADO, bloques, incluyeFestivos: false, cantidad: 1 });
    expect(r.brechaCoberturaPendiente).toBe(false);
    expect(notasInterpretacionTurno(r)).not.toContain('Resultado provisional pendiente de titulares y turnantes.');
  });
});