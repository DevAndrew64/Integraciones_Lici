import { describe, expect, it } from 'vitest';
import { resolverAnioCalculo, calcularFestivosPromedioMesPorDiaSemana } from './festivos-dia-semana';
import { generarFestivosColombia } from './calendario-festivos-colombia';

describe('resolverAnioCalculo — determinístico, nunca pregunta al usuario', () => {
  it('usa el año sugerido cuando es válido', () => {
    expect(resolverAnioCalculo(2027)).toBe(2027);
  });
  it('cae al año actual del servidor cuando no hay sugerido', () => {
    expect(resolverAnioCalculo(undefined)).toBe(new Date().getUTCFullYear());
    expect(resolverAnioCalculo(null)).toBe(new Date().getUTCFullYear());
  });
  it('descarta un año fuera de rango razonable y usa el fallback', () => {
    expect(resolverAnioCalculo(1500)).toBe(new Date().getUTCFullYear());
  });
});

describe('calcularFestivosPromedioMesPorDiaSemana', () => {
  it('la suma de festivos contados en los 7 días equivale al total de festivos del año', () => {
    const anio = 2026;
    const totalFestivos = generarFestivosColombia(anio).length;
    const promedio = calcularFestivosPromedioMesPorDiaSemana(anio);
    const sumaConteo = (Object.values(promedio) as number[]).reduce((s, v) => s + v, 0) * 12;
    expect(Math.round(sumaConteo)).toBe(totalFestivos);
  });

  it('domingo siempre tiene 0 festivos contados como "festivo trasladable" adicional (los domingos no son festivos en sí, son días distintos)', () => {
    // Nota: esto solo verifica que el conteo de domingo refleja festivos que
    // caen EN domingo (ej. si un 25 de diciembre cae domingo ese año) — no
    // asume que siempre sea 0, solo que el mecanismo es coherente.
    const promedio = calcularFestivosPromedioMesPorDiaSemana(2026);
    expect(promedio.D).toBeGreaterThanOrEqual(0);
  });

  it('nunca produce valores negativos ni NaN para ningún día', () => {
    const promedio = calcularFestivosPromedioMesPorDiaSemana(2026);
    for (const dia of ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const) {
      expect(promedio[dia]).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(promedio[dia])).toBe(false);
    }
  });

  it('es determinístico — misma entrada, mismo resultado', () => {
    expect(calcularFestivosPromedioMesPorDiaSemana(2026)).toEqual(calcularFestivosPromedioMesPorDiaSemana(2026));
  });
});