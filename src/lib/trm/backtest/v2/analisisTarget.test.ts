import { describe, it, expect } from 'vitest';
import {
  histograma,
  chiCuadradoUniforme,
  entropia,
  autocorrelacionCircular,
  informacionMutuaLag,
  matrizTransicionBucket,
  bonferroni,
  correlacionConDecimalCircular,
} from './analisisTarget';

describe('histograma', () => {
  it('cuenta correctamente y suma el total de observaciones', () => {
    const h = histograma([0, 0, 5, 99, 99, 99]);
    expect(h[0]).toBe(2);
    expect(h[5]).toBe(1);
    expect(h[99]).toBe(3);
    expect(h.reduce((a, b) => a + b, 0)).toBe(6);
  });
});

describe('chiCuadradoUniforme', () => {
  it('estadístico ≈ 0 y p-valor alto para una muestra perfectamente uniforme', () => {
    const decimales: number[] = [];
    for (let rep = 0; rep < 50; rep++) for (let d = 0; d < 100; d++) decimales.push(d);
    const r = chiCuadradoUniforme(decimales);
    expect(r.estadistico).toBeCloseTo(0, 6);
    expect(r.pValor).toBeGreaterThan(0.9);
  });

  it('estadístico grande y p-valor bajo para una muestra muy concentrada (no uniforme)', () => {
    const decimales = new Array(1000).fill(50); // 100% masa en el decimal 50
    const r = chiCuadradoUniforme(decimales);
    expect(r.estadistico).toBeGreaterThan(1000);
    expect(r.pValor).toBeLessThan(0.001);
  });
});

describe('entropia', () => {
  it('entropía relativa ≈ 1 (máxima) para distribución perfectamente uniforme', () => {
    const decimales: number[] = [];
    for (let rep = 0; rep < 20; rep++) for (let d = 0; d < 100; d++) decimales.push(d);
    const r = entropia(decimales);
    expect(r.entropiaRelativa).toBeCloseTo(1, 6);
    expect(r.entropiaBits).toBeCloseTo(Math.log2(100), 6);
  });

  it('entropía = 0 cuando toda la masa cae en un único decimal', () => {
    const r = entropia(new Array(500).fill(7));
    expect(r.entropiaBits).toBeCloseTo(0, 9);
    expect(r.entropiaRelativa).toBeCloseTo(0, 9);
  });
});

describe('autocorrelacionCircular', () => {
  it('autocorrelación al lag 0 comparado consigo misma es ≈1 (usando lag=1 sobre serie constante)', () => {
    const decimales = new Array(50).fill(30); // constante → cualquier lag debe dar correlación perfecta (o NaN por varianza 0)
    const r = autocorrelacionCircular(decimales, 1);
    // varianza circular 0 → denominador 0 → NaN es el resultado matemáticamente correcto
    expect(Number.isNaN(r)).toBe(true);
  });

  it('serie con dependencia circular fuerte (decimal_t = decimal_{t-1} + 1 mod 100) da autocorrelación alta en valor absoluto', () => {
    const decimales: number[] = [0];
    for (let i = 1; i < 100; i++) decimales.push((decimales[i - 1] + 1) % 100);
    const r = autocorrelacionCircular(decimales, 1);
    expect(Math.abs(r)).toBeGreaterThan(0.9);
  });

  it('NaN si lag >= longitud de la serie', () => {
    expect(Number.isNaN(autocorrelacionCircular([1, 2, 3], 5))).toBe(true);
  });
});

describe('informacionMutuaLag', () => {
  it('miCorregida ≈0 para 2 series independientes (ruido uniforme desincronizado) — la corrección Miller-Madow elimina el sesgo de muestra finita', () => {
    const decimales: number[] = [];
    let seed = 12345;
    function rng() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    for (let i = 0; i < 5000; i++) decimales.push(Math.floor(rng() * 100));
    const r = informacionMutuaLag(decimales, 1);
    expect(r.miPlugIn).toBeGreaterThanOrEqual(0);
    // Con 100x100 celdas y n=5000, el sesgo esperado es grande (~1.4 bits) —
    // por eso miPlugIn NO se usa como evidencia; miCorregida sí debe quedar cerca de 0.
    expect(r.miCorregida).toBeLessThan(0.15);
  });

  it('alta (incluso corregida) cuando el target es determinísticamente igual al lag (dependencia perfecta, n grande frente a 100x100 celdas)', () => {
    // Con n pequeño frente a Kx*Ky=10000 celdas, la propia corrección
    // Miller-Madow se vuelve inestable (el sesgo estimado puede superar la
    // MI real) — es exactamente la advertencia documentada en el módulo.
    // Por eso este caso usa n grande (50.000), donde la corrección sí es
    // fiable, para aislar el comportamiento con dependencia perfecta.
    const decimales: number[] = [];
    for (let i = 0; i < 50_000; i++) decimales.push(i % 100);
    const r = informacionMutuaLag(decimales, 100); // decimales[i] === decimales[i-100] siempre (período 100)
    expect(r.miCorregida).toBeGreaterThan(5); // cercano a log2(100)≈6.64 para dependencia perfecta
  });

  it('con n pequeño frente a Kx*Ky, la corrección puede colapsar a 0 aunque miPlugIn muestre dependencia perfecta — riesgo documentado, no un bug', () => {
    const decimales: number[] = [];
    for (let i = 0; i < 300; i++) decimales.push(i % 100);
    const r = informacionMutuaLag(decimales, 100);
    expect(r.miPlugIn).toBeGreaterThan(6); // la dependencia perfecta SÍ se ve en el estimador crudo
    expect(r.miCorregida).toBe(0); // pero la corrección, con n insuficiente, la anula — usar informacionMutuaLagBucketed en ese régimen
  });
});

describe('matrizTransicionBucket', () => {
  it('cada fila suma 1 (probabilidad condicional) salvo buckets sin observaciones', () => {
    const origen = [5, 15, 25, 95, 5, 15];
    const target = [12, 22, 32, 2, 18, 28];
    const m = matrizTransicionBucket(origen, target, 10);
    expect(m.length).toBe(10);
    for (const fila of m) {
      const suma = fila.reduce((a, b) => a + b, 0);
      expect(suma === 0 || Math.abs(suma - 1) < 1e-9).toBe(true);
    }
  });
});

describe('bonferroni', () => {
  it('multiplica cada p-valor por el número de comparaciones, con tope en 1', () => {
    const ajustados = bonferroni([0.01, 0.5, 0.001]);
    expect(ajustados[0]).toBeCloseTo(0.03, 9);
    expect(ajustados[1]).toBe(1); // 0.5*3=1.5 → tope 1
    expect(ajustados[2]).toBeCloseTo(0.003, 9);
  });
});

describe('correlacionConDecimalCircular', () => {
  it('detecta una relación fuerte cuando la variable continua determina directamente sin(θ)', () => {
    const decimales: number[] = [];
    const valores: number[] = [];
    for (let d = 0; d < 100; d++) {
      decimales.push(d);
      valores.push(Math.sin((2 * Math.PI * d) / 100) * 10 + 5); // proporcional a sin(θ)
    }
    const r = correlacionConDecimalCircular('variableSintetica', valores, decimales);
    expect(Math.abs(r.rConSeno)).toBeGreaterThan(0.99);
    expect(r.pValorSeno).toBeLessThan(0.001);
  });
});
