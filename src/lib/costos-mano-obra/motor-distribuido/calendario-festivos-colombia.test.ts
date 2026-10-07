import { describe, expect, it } from 'vitest';
import { esFestivoColombia, festivosColombiaEnRango, generarFestivosColombia } from './calendario-festivos-colombia';

describe('generarFestivosColombia — pruebas obligatorias', () => {
  it('1) detecta automáticamente 20/07/2026 (Día de la Independencia, fijo)', () => {
    const r = esFestivoColombia('2026-07-20');
    expect(r.esFestivo).toBe(true);
    expect(r.nombre).toBe('Día de la Independencia');
    expect(r.fuente).toBe('CALENDARIO_COLOMBIA');
  });

  it('2) detecta un festivo trasladado al lunes (San José 2026: base 19 marzo, jueves → lunes 23)', () => {
    const r = esFestivoColombia('2026-03-23');
    expect(r.esFestivo).toBe(true);
    expect(r.nombre).toBe('San José');
    expect(esFestivoColombia('2026-03-19').esFestivo).toBe(false); // fecha base, no observada
  });

  it('3) detecta Jueves Santo 2026 (2 de abril)', () => {
    const r = esFestivoColombia('2026-04-02');
    expect(r.esFestivo).toBe(true);
    expect(r.nombre).toBe('Jueves Santo');
  });

  it('4) detecta Viernes Santo 2026 (3 de abril)', () => {
    const r = esFestivoColombia('2026-04-03');
    expect(r.esFestivo).toBe(true);
    expect(r.nombre).toBe('Viernes Santo');
  });

  it('5) detecta Ascensión del Señor 2026 (18 de mayo)', () => {
    const r = esFestivoColombia('2026-05-18');
    expect(r.esFestivo).toBe(true);
    expect(r.nombre).toBe('Ascensión del Señor');
  });

  it('6) detecta Corpus Christi 2026 (8 de junio)', () => {
    const r = esFestivoColombia('2026-06-08');
    expect(r.esFestivo).toBe(true);
    expect(r.nombre).toBe('Corpus Christi');
  });

  it('7) detecta Sagrado Corazón de Jesús 2026 (15 de junio)', () => {
    const r = esFestivoColombia('2026-06-15');
    expect(r.esFestivo).toBe(true);
    expect(r.nombre).toBe('Sagrado Corazón de Jesús');
  });

  it('8) una fecha ordinaria no se marca como festiva', () => {
    expect(esFestivoColombia('2026-07-21').esFestivo).toBe(false);
    expect(esFestivoColombia('2026-02-14').esFestivo).toBe(false);
  });

  it('13) el generador funciona para años distintos de 2026', () => {
    const r2025 = esFestivoColombia('2025-07-20');
    expect(r2025.esFestivo).toBe(true);
    const r2027 = esFestivoColombia('2027-01-01');
    expect(r2027.esFestivo).toBe(true);
    // Jueves/Viernes Santo cambian de fecha cada año (dependen de Pascua) —
    // 2025 y 2026 no deben coincidir en la misma fecha exacta.
    const jueves2025 = generarFestivosColombia(2025).find(f => f.nombre === 'Jueves Santo')!.fecha;
    const jueves2026 = generarFestivosColombia(2026).find(f => f.nombre === 'Jueves Santo')!.fecha;
    expect(jueves2025).not.toBe(jueves2026);
  });

  it('genera 18 festivos históricos por año antes de la Ley 2578/2026, y 19 desde 2026 en adelante', () => {
    expect(generarFestivosColombia(2024)).toHaveLength(18);
    expect(generarFestivosColombia(2025)).toHaveLength(18);
    expect(generarFestivosColombia(2026)).toHaveLength(19);
    expect(generarFestivosColombia(2030)).toHaveLength(19);
  });

  it('sin la coincidencia de fechas de 2025, los 18 históricos siguen bien formados en 2024/2027/2028', () => {
    for (const anio of [2024, 2027, 2028]) {
      expect(generarFestivosColombia(anio)).toHaveLength(anio >= 2026 ? 19 : 18);
    }
    // Coincidencia real y documentada del calendario colombiano de 2025 —
    // no es un error del generador, dos traslados al lunes cayeron en la
    // misma fecha ese año.
    const fechas2025 = generarFestivosColombia(2025).map(f => f.fecha);
    expect(fechas2025.filter(f => f === '2025-06-30')).toHaveLength(2);
  });

  describe('Ley 2578 de 2026 — Nuestra Señora del Rosario de Chiquinquirá (9 julio, trasladable)', () => {
    it('1) no genera el festivo antes de su vigencia (2025)', () => {
      const r = generarFestivosColombia(2025).find(f => f.nombre === 'Nuestra Señora del Rosario de Chiquinquirá');
      expect(r).toBeUndefined();
      expect(esFestivoColombia('2025-07-14').esFestivo).toBe(false); // lunes siguiente al 9 jul 2025, no aplica
    });

    it('2) para 2026, el 9 de julio (jueves) se traslada al lunes 13', () => {
      const r = generarFestivosColombia(2026).find(f => f.nombre === 'Nuestra Señora del Rosario de Chiquinquirá');
      expect(r?.fecha).toBe('2026-07-13');
      expect(r?.tipo).toBe('TRASLADADO_LUNES');
    });

    it('3) el 13/07/2026 se detecta automáticamente como festivo', () => {
      const r = esFestivoColombia('2026-07-13');
      expect(r.esFestivo).toBe(true);
      expect(r.nombre).toBe('Nuestra Señora del Rosario de Chiquinquirá');
    });

    it('4) el 20/07/2026 también se detecta como festivo (los dos festivos del período coexisten)', () => {
      expect(esFestivoColombia('2026-07-20').esFestivo).toBe(true);
    });

    it('la regla sigue vigente en años posteriores a 2026', () => {
      const r2027 = generarFestivosColombia(2027).find(f => f.nombre === 'Nuestra Señora del Rosario de Chiquinquirá');
      expect(r2027).toBeDefined();
    });
  });

  it('festivosColombiaEnRango cubre correctamente un rango que cruza dos años', () => {
    const r = festivosColombiaEnRango('2025-12-20', '2026-01-10');
    expect(r).toContain('2025-12-25');
    expect(r).toContain('2026-01-01');
  });

  it('esFestivoColombia con fecha inválida no arroja, devuelve esFestivo:false', () => {
    expect(esFestivoColombia('no-es-fecha').esFestivo).toBe(false);
  });
});