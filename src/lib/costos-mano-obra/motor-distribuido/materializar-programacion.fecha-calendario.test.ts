/**
 * FASE 5 (diagnóstico Aseocolba) — clasificación por fecha calendario
 * real de un bloque que cruza medianoche. Cada minuto debe atribuirse a
 * SU fecha real (nunca heredar domingo/festivo del día en que comenzó el
 * turno). Capacidad de MATERIALIZACIÓN autocontenida — NO conectada al
 * motor de sobretiempos activo (ver nota en materializar-programacion.ts).
 */
import { describe, expect, it } from 'vitest';
import { materializarBloquePorFechaCalendario } from './materializar-programacion';

const FESTIVO_20_JUL_2026 = '2026-07-20'; // lunes (Batalla de Boyacá)

describe('FASE 5 — A) lunes → martes', () => {
  it('lunes 20:00–24:00 = lunes (13-jul-2026, lunes); martes 00:00–06:00 = martes (14-jul-2026)', () => {
    const seg = materializarBloquePorFechaCalendario({ inicio: '20:00', fin: '06:00' }, '2026-07-13');
    expect(seg).toHaveLength(2);
    expect(seg[0]).toMatchObject({ fecha: '2026-07-13', inicioMinDia: 1200, finMinDia: 1440, minutos: 240 });
    expect(seg[1]).toMatchObject({ fecha: '2026-07-14', inicioMinDia: 0, finMinDia: 360, minutos: 360 });
    expect(seg[0].minutos + seg[1].minutos).toBe(600); // 10h totales, sin duplicar ni omitir
  });
});

describe('FASE 5 — B) sábado → domingo', () => {
  it('sábado antes de 00:00 = sábado (no domingo); después de 00:00 = domingo', () => {
    // 2026-07-18 es sábado.
    const seg = materializarBloquePorFechaCalendario({ inicio: '20:00', fin: '06:00' }, '2026-07-18');
    expect(seg[0]).toMatchObject({ fecha: '2026-07-18', esDomingo: false });
    expect(seg[1]).toMatchObject({ fecha: '2026-07-19', esDomingo: true });
  });
});

describe('FASE 5 — C) domingo → lunes', () => {
  it('domingo antes de 00:00 = dominical; después de 00:00 = lunes ordinario (si no es festivo)', () => {
    // 2026-07-19 es domingo; 2026-07-20 es festivo (Batalla de Boyacá) — se
    // usa un lunes NO festivo para aislar este caso del caso E siguiente.
    const seg = materializarBloquePorFechaCalendario({ inicio: '20:00', fin: '06:00' }, '2026-07-12'); // domingo 12-jul
    expect(seg[0]).toMatchObject({ fecha: '2026-07-12', esDomingo: true, esFestivo: false });
    expect(seg[1]).toMatchObject({ fecha: '2026-07-13', esDomingo: false, esFestivo: false });
  });
});

describe('FASE 5 — D) día ordinario → festivo', () => {
  it('antes de medianoche = ordinario; después de medianoche = festivo (20-jul-2026)', () => {
    const seg = materializarBloquePorFechaCalendario({ inicio: '20:00', fin: '06:00' }, '2026-07-19', [FESTIVO_20_JUL_2026]);
    expect(seg[0]).toMatchObject({ fecha: '2026-07-19', esFestivo: false });
    expect(seg[1]).toMatchObject({ fecha: '2026-07-20', esFestivo: true });
  });
});

describe('FASE 5 — E) festivo → día ordinario', () => {
  it('antes de medianoche = festivo; después de medianoche = ordinario (21-jul-2026, no festivo)', () => {
    const seg = materializarBloquePorFechaCalendario({ inicio: '20:00', fin: '06:00' }, '2026-07-20', [FESTIVO_20_JUL_2026]);
    expect(seg[0]).toMatchObject({ fecha: '2026-07-20', esFestivo: true });
    expect(seg[1]).toMatchObject({ fecha: '2026-07-21', esFestivo: false });
  });
});

describe('FASE 5 — F) 31 diciembre → 1 enero', () => {
  it('cada tramo usa su fecha real y consulta el calendario correspondiente (1-ene marcado festivo en este caso)', () => {
    const FESTIVO_1_ENE_2027 = '2027-01-01';
    const seg = materializarBloquePorFechaCalendario({ inicio: '20:00', fin: '06:00' }, '2026-12-31', [FESTIVO_1_ENE_2027]);
    expect(seg[0]).toMatchObject({ fecha: '2026-12-31', esFestivo: false });
    expect(seg[1]).toMatchObject({ fecha: '2027-01-01', esFestivo: true });
  });
});

describe('FASE 5 — G) cambio de semana domingo → lunes: sin duplicar, sin omitir', () => {
  it('los minutos del domingo y del lunes quedan en segmentos separados y disjuntos, la suma es exacta', () => {
    const seg = materializarBloquePorFechaCalendario({ inicio: '20:00', fin: '06:00' }, '2026-07-19'); // domingo
    const totalMinutos = seg.reduce((s, x) => s + x.minutos, 0);
    expect(totalMinutos).toBe(600);
    // Ningún minuto del domingo aparece en el segmento del lunes y viceversa.
    expect(seg[0].fecha).not.toBe(seg[1].fecha);
    expect(seg[0].finMinDia).toBe(1440);
    expect(seg[1].inicioMinDia).toBe(0);
  });
});

describe('FASE 5 — descanso dentro de un turno + varios bloques cruzando medianoche', () => {
  it('bloque único que ya representa el descanso aplicado (20:00-00:30) se materializa correctamente en 2 fechas', () => {
    const seg = materializarBloquePorFechaCalendario({ inicio: '20:00', fin: '00:30' }, '2026-07-13');
    expect(seg).toHaveLength(2);
    expect(seg[0].minutos).toBe(240); // 20:00-24:00
    expect(seg[1].minutos).toBe(30);  // 00:00-00:30
  });

  it('segundo sub-bloque tras el descanso (01:30-06:00, offsets explícitos día+1) se materializa íntegro en la fecha del día siguiente', () => {
    const seg = materializarBloquePorFechaCalendario({ inicio: '01:30', fin: '06:00', offsetDiaInicio: 1, offsetDiaFin: 1 }, '2026-07-13');
    expect(seg).toHaveLength(1);
    expect(seg[0]).toMatchObject({ fecha: '2026-07-14', minutos: 270 });
  });
});

describe('FASE 5 — regresión: bloque normal del mismo día no se fragmenta', () => {
  it('09:00-18:00 → un único segmento, misma fecha', () => {
    const seg = materializarBloquePorFechaCalendario({ inicio: '09:00', fin: '18:00' }, '2026-07-13');
    expect(seg).toHaveLength(1);
    expect(seg[0]).toMatchObject({ fecha: '2026-07-13', minutos: 540 });
  });
});
