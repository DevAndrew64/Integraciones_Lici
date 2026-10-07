/**
 * Normalizador de bloques — pruebas del intérprete automático de turnos.
 * Cubre: bloque 24h explícito (inicio===fin), bloques normales sin
 * cambio, detección de solapamientos y de duración inválida.
 */
import { describe, expect, it } from 'vitest';
import { normalizarBloques24Horas, duracionBloqueMin, validarBloquesTurno } from './normalizar-bloques-turno';

describe('normalizarBloques24Horas', () => {
  it('E) 06:00–06:00 se divide automáticamente en 06:00-18:00 y 18:00-06:00 (nunca cero horas, nunca pregunta)', () => {
    const r = normalizarBloques24Horas([{ inicio: '06:00', fin: '06:00', orden: 1 }]);
    expect(r).toEqual([
      { inicio: '06:00', fin: '18:00', orden: 1 },
      { inicio: '18:00', fin: '06:00', orden: 2 },
    ]);
  });

  it('cada mitad del bloque 24h dura exactamente 12 horas', () => {
    const r = normalizarBloques24Horas([{ inicio: '06:00', fin: '06:00', orden: 1 }]);
    expect(duracionBloqueMin(r[0])).toBe(720);
    expect(duracionBloqueMin(r[1])).toBe(720);
  });

  it('un bloque normal (inicio!==fin) no se modifica', () => {
    const r = normalizarBloques24Horas([{ inicio: '07:00', fin: '13:00', orden: 1 }, { inicio: '14:00', fin: '17:00', orden: 2 }]);
    expect(r).toEqual([
      { inicio: '07:00', fin: '13:00', orden: 1 },
      { inicio: '14:00', fin: '17:00', orden: 2 },
    ]);
  });

  it('un bloque 00:00–00:00 también se interpreta como 24h (no como cero)', () => {
    const r = normalizarBloques24Horas([{ inicio: '00:00', fin: '00:00', orden: 1 }]);
    expect(r).toEqual([
      { inicio: '00:00', fin: '12:00', orden: 1 },
      { inicio: '12:00', fin: '00:00', orden: 2 },
    ]);
  });
});

describe('duracionBloqueMin', () => {
  it('bloque simple sin cruce de medianoche', () => {
    expect(duracionBloqueMin({ inicio: '06:00', fin: '18:00', orden: 1 })).toBe(720);
  });
  it('bloque que cruza medianoche', () => {
    expect(duracionBloqueMin({ inicio: '18:00', fin: '06:00', orden: 1 })).toBe(720);
  });
  it('bloque 24h explícito (inicio===fin) se lee como 1440', () => {
    expect(duracionBloqueMin({ inicio: '06:00', fin: '06:00', orden: 1 })).toBe(1440);
  });
});

describe('validarBloquesTurno', () => {
  it('sin bloques: ok', () => {
    expect(validarBloquesTurno([])).toEqual({ ok: true, motivo: null });
  });
  it('bloques complementarios sin solape: ok', () => {
    expect(validarBloquesTurno([{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '18:00', fin: '06:00', orden: 2 }])).toEqual({ ok: true, motivo: null });
  });
  it('detecta solapamiento entre bloques', () => {
    const r = validarBloquesTurno([{ inicio: '06:00', fin: '15:00', orden: 1 }, { inicio: '14:00', fin: '20:00', orden: 2 }]);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/superponen/);
  });

  it('§3 ejemplo exacto del cierre — 06:00–18:00 y 17:00–06:00', () => {
    const r = validarBloquesTurno([{ inicio: '06:00', fin: '18:00', orden: 1 }, { inicio: '17:00', fin: '06:00', orden: 2 }]);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('Los bloques 06:00–18:00 y 17:00–06:00 se superponen entre las 17:00 y las 18:00.');
    expect(r.motivo).not.toMatch(/[A-Z_]{4,}/); // nunca un código interno tipo SOLAPE_ERROR
  });

  it('bloques que exceden 24 horas combinadas se bloquean (sin solaparse entre sí)', () => {
    const r = validarBloquesTurno([{ inicio: '00:00', fin: '16:00', orden: 1 }, { inicio: '16:00', fin: '08:00', orden: 2 }]);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/24 horas/);
  });

  it('06:00–06:00 sigue siendo una excepción válida (nunca bloqueada por el validador)', () => {
    const normalizados = normalizarBloques24Horas([{ inicio: '06:00', fin: '06:00', orden: 1 }]);
    expect(validarBloquesTurno(normalizados)).toEqual({ ok: true, motivo: null });
  });
  it('bloques con descanso (no solapados, con hueco) no se marcan como inválidos', () => {
    expect(validarBloquesTurno([{ inicio: '09:00', fin: '13:00', orden: 1 }, { inicio: '14:00', fin: '18:00', orden: 2 }])).toEqual({ ok: true, motivo: null });
  });
});