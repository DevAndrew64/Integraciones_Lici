import { describe, it, expect } from 'vitest';
import { reconstruirBloquesDesdeTexto } from './reconstruir-horario-catalogo';
import type { DiasJornada } from './tipos';

function dias(overrides: Partial<DiasJornada> = {}): DiasJornada {
  return { lun: false, mar: false, mie: false, jue: false, vie: false, sab: false, dom: false, fes: false, ...overrides };
}
const LUNES_A_SABADO = dias({ lun: true, mar: true, mie: true, jue: true, vie: true, sab: true });

describe('reconstruirBloquesDesdeTexto', () => {
  it('un bloque después de GET', () => {
    const r = reconstruirBloquesDesdeTexto('08:00-17:00', LUNES_A_SABADO);
    expect(r.bloquesReconstruidos).toBe(true);
    expect(r.bloques).toEqual([{ inicio: '08:00', fin: '17:00', orden: 1 }]);
    expect(r.advertencia).toBeNull();
  });

  it('dos bloques después de GET, con el descanso conservado por ausencia de bloque', () => {
    const r = reconstruirBloquesDesdeTexto('08:00-12:00 Y 14:00-17:20', LUNES_A_SABADO);
    expect(r.bloquesReconstruidos).toBe(true);
    expect(r.bloques).toEqual([
      { inicio: '08:00', fin: '12:00', orden: 1 },
      { inicio: '14:00', fin: '17:20', orden: 2 },
    ]);
    expect(r.calculo?.minutosDiarios).toBe(440);
    expect(r.calculo?.descansoMinutos).toBe(120);
    expect(r.calculo?.minutosSemanales).toBe(2640);
    expect(r.resumen?.horarioTexto).toBe('08:00-12:00 / 14:00-17:20');
  });

  it('tres bloques', () => {
    const r = reconstruirBloquesDesdeTexto('05:00-09:00 Y 10:00-14:00 Y 15:00-17:00', LUNES_A_SABADO);
    expect(r.bloquesReconstruidos).toBe(true);
    expect(r.bloques).toHaveLength(3);
  });

  it('texto no parseable — no inventa bloques', () => {
    const r = reconstruirBloquesDesdeTexto('turno rotativo variable', LUNES_A_SABADO);
    expect(r.bloquesReconstruidos).toBe(false);
    expect(r.bloques).toEqual([]);
    expect(r.resumen).toBeNull();
    expect(r.advertencia).not.toBeNull();
  });

  it('horario vacío', () => {
    const r = reconstruirBloquesDesdeTexto('', LUNES_A_SABADO);
    expect(r.bloquesReconstruidos).toBe(false);
    expect(r.bloques).toEqual([]);
  });

  it('[ACTUALIZADO — Fase 5] cruce de medianoche permitido (un solo bloque), ahora con offsetDiaInicio/offsetDiaFin', () => {
    const r = reconstruirBloquesDesdeTexto('22:00-06:00', LUNES_A_SABADO);
    expect(r.bloquesReconstruidos).toBe(true);
    expect(r.bloques).toEqual([{ inicio: '22:00', fin: '06:00', orden: 1, offsetDiaInicio: 0, offsetDiaFin: 1 }]);
  });

  it('[ACTUALIZADO — Fase 5] varios bloques donde el primero ya cruza medianoche: el segundo hereda el día siguiente sin ambigüedad — YA NO se rechaza (ver parser-horario.test.ts para el detalle de la regla de continuidad)', () => {
    const r = reconstruirBloquesDesdeTexto('22:00-06:00 Y 08:00-10:00', LUNES_A_SABADO);
    expect(r.bloquesReconstruidos).toBe(true);
    expect(r.bloques).toEqual([
      { inicio: '22:00', fin: '06:00', orden: 1, offsetDiaInicio: 0, offsetDiaFin: 1 },
      { inicio: '08:00', fin: '10:00', orden: 2, offsetDiaInicio: 1, offsetDiaFin: 1 },
    ]);
    expect(r.advertencia).toBeNull();
  });
});
