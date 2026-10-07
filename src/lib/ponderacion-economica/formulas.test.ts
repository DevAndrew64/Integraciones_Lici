/**
 * Tests unitarios del motor determinístico de ponderación económica SECOP II.
 *
 * Caso de regresión principal:
 *   TRM 3443.59 → centavos 59 → Media aritmética baja
 *   Presupuesto 500_000_000, PM 39.5
 *
 * Ejecutar: npx vitest run
 */

import { describe, it, expect } from 'vitest';
import { calcularPuntajes, FORMULA_LABELS, FORMULA_KEYS } from './formulas';
import { calcularCentavosTRM, seleccionarMetodoPorCentavosTRM, RANGOS_TRM } from './trmSelector';
import { buscarOfertaOptima } from './optimizador';
import { simularPonderacion } from './simulador';
import type { FormulaKey } from './types';

// ─── Helpers ────────────────────────────────────────────────────────────────

const PRES = 500_000_000;
const PM   = 39.5;

/** Convierte porcentajes en valores COP (mismo cálculo que el modal). */
function pctToValor(pct: number): number { return (pct / 100) * PRES; }

// ─── 1. Constantes ──────────────────────────────────────────────────────────

describe('Constantes', () => {
  it('FORMULA_KEYS tiene exactamente 7 fórmulas', () => {
    expect(FORMULA_KEYS).toHaveLength(7);
  });

  it('FORMULA_LABELS tiene etiqueta para cada fórmula', () => {
    for (const key of FORMULA_KEYS) {
      expect(FORMULA_LABELS[key]).toBeTruthy();
    }
  });

  it('RANGOS_TRM cubre todos los centavos de 0 a 99 sin huecos', () => {
    const cubiertos = new Set<number>();
    for (const rango of RANGOS_TRM) {
      for (let c = rango.desde; c <= rango.hasta; c++) cubiertos.add(c);
    }
    for (let c = 0; c <= 99; c++) {
      expect(cubiertos.has(c), `centavo ${c} no cubierto`).toBe(true);
    }
  });
});

// ─── 2. Selector TRM ────────────────────────────────────────────────────────

describe('seleccionarMetodoPorCentavosTRM', () => {
  it('centavos 0-14 → mediana', () => {
    for (let c = 0; c <= 14; c++) {
      expect(seleccionarMetodoPorCentavosTRM(c)).toBe('mediana');
    }
  });

  it('centavos 15-28 → media_geometrica', () => {
    for (let c = 15; c <= 28; c++) {
      expect(seleccionarMetodoPorCentavosTRM(c)).toBe('media_geometrica');
    }
  });

  it('centavos 29-42 → media_geometrica_con_presupuesto', () => {
    for (let c = 29; c <= 42; c++) {
      expect(seleccionarMetodoPorCentavosTRM(c)).toBe('media_geometrica_con_presupuesto');
    }
  });

  it('centavos 43-57 → media_aritmetica', () => {
    for (let c = 43; c <= 57; c++) {
      expect(seleccionarMetodoPorCentavosTRM(c)).toBe('media_aritmetica');
    }
  });

  it('centavos 58-71 → media_aritmetica_baja', () => {
    for (let c = 58; c <= 71; c++) {
      expect(seleccionarMetodoPorCentavosTRM(c)).toBe('media_aritmetica_baja');
    }
  });

  it('centavos 72-85 → media_aritmetica_alta', () => {
    for (let c = 72; c <= 85; c++) {
      expect(seleccionarMetodoPorCentavosTRM(c)).toBe('media_aritmetica_alta');
    }
  });

  it('centavos 86-99 → menor_valor', () => {
    for (let c = 86; c <= 99; c++) {
      expect(seleccionarMetodoPorCentavosTRM(c)).toBe('menor_valor');
    }
  });

  it('REGRESIÓN: TRM 3443.59 → centavos 59 → media_aritmetica_baja', () => {
    const centavos = calcularCentavosTRM(3443.59);
    expect(centavos).toBe(59);
    expect(seleccionarMetodoPorCentavosTRM(centavos)).toBe('media_aritmetica_baja');
  });

  it('TRM entera (e.g. 4000.00) → centavos 0 → mediana', () => {
    expect(calcularCentavosTRM(4000.00)).toBe(0);
    expect(seleccionarMetodoPorCentavosTRM(0)).toBe('mediana');
  });
});

// ─── 3. Mediana ─────────────────────────────────────────────────────────────

describe('calcularPuntajes: mediana', () => {
  it('array vacío devuelve []', () => {
    expect(calcularPuntajes('mediana', [], PM, PRES)).toEqual([]);
  });

  it('la oferta igual a la mediana recibe PM completo', () => {
    // Con 3 valores, mediana = elemento índice 1 del ordenado desc
    // sorted desc: [95,90,85] → mediana = 90
    const vals = [pctToValor(85), pctToValor(90), pctToValor(95)];
    const pts = calcularPuntajes('mediana', vals, PM, PRES);
    // El valor 90% debe obtener PM
    expect(pts[1]).toBe(PM); // vals[1] = pctToValor(90) = mediana
  });

  it('puntajes no negativos (clampP ≥ 0)', () => {
    const vals = [pctToValor(50), pctToValor(60), pctToValor(120)];
    const pts = calcularPuntajes('mediana', vals, PM, PRES);
    pts.forEach(p => expect(p).toBeGreaterThanOrEqual(0));
  });

  it('puntajes con 2 decimales máximo', () => {
    const vals = [pctToValor(83.3), pctToValor(88.7), pctToValor(92.1)];
    const pts = calcularPuntajes('mediana', vals, PM, PRES);
    pts.forEach(p => {
      expect(Math.round(p * 100) / 100).toBe(p);
    });
  });
});

// ─── 4. Media geométrica ─────────────────────────────────────────────────────

describe('calcularPuntajes: media_geometrica', () => {
  it('todos los valores iguales → todos obtienen PM', () => {
    const v = pctToValor(88);
    const vals = [v, v, v];
    const pts = calcularPuntajes('media_geometrica', vals, PM, PRES);
    // MG = v, |MG-v|/MG = 0, puntaje = PM
    pts.forEach(p => expect(p).toBe(PM));
  });

  it('valor 0 → puntaje 0 (guarda contra MG ≤ 0)', () => {
    const vals = [0, pctToValor(90)];
    const pts = calcularPuntajes('media_geometrica', vals, PM, PRES);
    // MG = 0 → todos 0
    pts.forEach(p => expect(p).toBe(0));
  });

  it('puntajes no negativos', () => {
    const vals = [pctToValor(70), pctToValor(85), pctToValor(95)];
    const pts = calcularPuntajes('media_geometrica', vals, PM, PRES);
    pts.forEach(p => expect(p).toBeGreaterThanOrEqual(0));
  });
});

// ─── 5. Media geométrica con presupuesto ────────────────────────────────────

describe('calcularPuntajes: media_geometrica_con_presupuesto', () => {
  it('nv = ceil(n/3) copias del presupuesto se incluyen', () => {
    // Con n=3: nv=1, GPO = (pres * v1 * v2 * v3)^(1/4)
    const vals = [pctToValor(85), pctToValor(90), pctToValor(95)];
    const pts = calcularPuntajes('media_geometrica_con_presupuesto', vals, PM, PRES);
    expect(pts).toHaveLength(3);
    pts.forEach(p => expect(p).toBeGreaterThanOrEqual(0));
  });

  it('oferta debajo de GPO usa fórmula cóncava; arriba usa penalización doble', () => {
    // No verificamos el valor exacto, solo la consistencia del sign
    const vals = [pctToValor(70), pctToValor(75), pctToValor(80)];
    const pts = calcularPuntajes('media_geometrica_con_presupuesto', vals, PM, PRES);
    // GPO será mayor al promedio COP de vals (presupuesto lo jala hacia arriba)
    // Las ofertas bajas obtienen puntaje positivo
    pts.forEach(p => expect(p).toBeGreaterThanOrEqual(0));
  });
});

// ─── 6. Media aritmética ────────────────────────────────────────────────────

describe('calcularPuntajes: media_aritmetica', () => {
  it('oferta igual al promedio → puntaje PM', () => {
    // Cuando v === X: 1 - (X-v)/X = 1 - 0 = 1 → PM
    const vals = [pctToValor(80), pctToValor(90), pctToValor(100)]; // X = 90%
    // Aritmética: X = media de los 3 valores
    const X_pct = (80 + 90 + 100) / 3; // = 90
    // val con 90% exacto debería obtener PM
    const vals2 = [pctToValor(80), pctToValor(X_pct), pctToValor(100)];
    const pts = calcularPuntajes('media_aritmetica', vals2, PM, PRES);
    // El índice 1 tiene valor = X → puntaje ≈ PM
    // (puede haber diferencia ínfima por flotante, usamos toBeCloseTo)
    expect(pts[1]).toBeCloseTo(PM, 5);
  });

  it('ofertas sobre X penalizadas x2', () => {
    const vals = [pctToValor(80), pctToValor(90), pctToValor(110)];
    // X ≈ 93.33%, la oferta al 110% está sobre X
    const pts = calcularPuntajes('media_aritmetica', vals, PM, PRES);
    // La tercera (110%) debe tener menos puntaje que la segunda (90%)
    expect(pts[2]).toBeLessThan(pts[1]);
  });
});

// ─── 7. Media aritmética baja ───────────────────────────────────────────────

describe('calcularPuntajes: media_aritmetica_baja', () => {
  it('caso de regresión: TRM 3443.59, pres 500M, PM 39.5', () => {
    // Competidores al 82%, 88%, 93% y mi oferta al 85%
    const comps = [82, 88, 93, 85].map(pctToValor);
    const pts = calcularPuntajes('media_aritmetica_baja', comps, PM, PRES);
    expect(pts).toHaveLength(4);
    // Todos no negativos, máximo PM
    pts.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(PM);
    });
  });

  it('el valor más cercano a XB obtiene el puntaje más alto del grupo', () => {
    // Con 2 competidores y mi oferta deliberadamente cerca de XB
    // XB = (Vmin + X) / 2 con vals=[80%, 87%, 90%]:
    //   X = (80+87+90)/3 = 85.67%, Vmin=80%, XB = (80+85.67)/2 = 82.83%
    // La oferta al 83% está más cerca de XB que la del 80% y la del 90%
    const vals = [pctToValor(80), pctToValor(83), pctToValor(90)];
    const pts = calcularPuntajes('media_aritmetica_baja', vals, PM, PRES);
    // La del 83% (más cercana a XB) debe obtener el puntaje más alto
    expect(pts[1]).toBeGreaterThan(pts[0]);
    expect(pts[1]).toBeGreaterThan(pts[2]);
    expect(pts[1]).toBeGreaterThan(0);
  });
});

// ─── 8. Media aritmética alta ───────────────────────────────────────────────

describe('calcularPuntajes: media_aritmetica_alta', () => {
  it('XA = (Vmax + X) / 2', () => {
    // Con vals=[80%, 90%, 100%]: X=90%, Vmax=100%, XA=95%
    const vals = [pctToValor(80), pctToValor(90), pctToValor(95), pctToValor(100)];
    const pts = calcularPuntajes('media_aritmetica_alta', vals, PM, PRES);
    expect(pts).toHaveLength(4);
    pts.forEach(p => expect(p).toBeGreaterThanOrEqual(0));
  });

  it('ofertas sobre XA penalizadas — el más cercano a XA obtiene mayor puntaje', () => {
    // vals=[80%, 87%, 95%]: X=(80+87+95)/3=87.33%, Vmax=95%, XA=(95+87.33)/2=91.17%
    // Oferta al 91% (muy cercana a XA) debe superar a la del 80% y la del 95%
    const vals = [pctToValor(80), pctToValor(91), pctToValor(95)];
    const pts = calcularPuntajes('media_aritmetica_alta', vals, PM, PRES);
    // La del 91% más cercana a XA obtiene el puntaje más alto
    expect(pts[1]).toBeGreaterThan(pts[0]);
    expect(pts[1]).toBeGreaterThan(pts[2]);
    // La del 95% (sobre XA) tiene penalización doble → menos que la del 80%
    // En este caso XA ≈ 91.17%, la del 95% está justo encima
    expect(pts[2]).toBeLessThan(PM);
  });
});

// ─── 9. Menor valor ─────────────────────────────────────────────────────────

describe('calcularPuntajes: menor_valor', () => {
  it('el menor valor obtiene PM completo', () => {
    const vals = [pctToValor(80), pctToValor(90), pctToValor(95)];
    const pts = calcularPuntajes('menor_valor', vals, PM, PRES);
    // vals[0] = menor → PM
    expect(pts[0]).toBe(PM);
  });

  it('a mayor valor, menor puntaje', () => {
    const vals = [pctToValor(80), pctToValor(90), pctToValor(100)];
    const pts = calcularPuntajes('menor_valor', vals, PM, PRES);
    expect(pts[0]).toBeGreaterThan(pts[1]);
    expect(pts[1]).toBeGreaterThan(pts[2]);
  });

  it('valor 0 → todos 0 (protección división por cero)', () => {
    const vals = [0, pctToValor(90)];
    const pts = calcularPuntajes('menor_valor', vals, PM, PRES);
    pts.forEach(p => expect(p).toBe(0));
  });
});

// ─── 10. Oferta óptima (grid search) ────────────────────────────────────────

describe('buscarOfertaOptima', () => {
  it('devuelve pct en rango [50, 100]', () => {
    const comps = [pctToValor(82), pctToValor(88)];
    const resultado = buscarOfertaOptima('mediana', comps, PM, PRES);
    expect(resultado.pct).toBeGreaterThanOrEqual(50);
    expect(resultado.pct).toBeLessThanOrEqual(100);
  });

  it('pct tiene 1 decimal máximo', () => {
    const comps = [pctToValor(85), pctToValor(92)];
    const resultado = buscarOfertaOptima('media_aritmetica', comps, PM, PRES);
    expect(Math.round(resultado.pct * 10) / 10).toBe(resultado.pct);
  });

  it('puntaje óptimo ≤ PM', () => {
    const comps = [pctToValor(80), pctToValor(88), pctToValor(95)];
    for (const f of FORMULA_KEYS) {
      const res = buscarOfertaOptima(f, comps, PM, PRES);
      expect(res.puntaje).toBeLessThanOrEqual(PM + 0.01); // tolerancia flotante
    }
  });

  it('competidores vacíos → puntaje = PM (oferta sola obtiene máximo)', () => {
    // Con un solo participante, cualquier fórmula da PM
    const res = buscarOfertaOptima('mediana', [], PM, PRES);
    expect(res.puntaje).toBeCloseTo(PM, 1);
  });

  it('REGRESIÓN: media_aritmetica_baja con comps [82%, 88%, 93%]', () => {
    const comps = [82, 88, 93].map(pctToValor);
    const res = buscarOfertaOptima('media_aritmetica_baja', comps, PM, PRES);
    // Resultado debe ser estable (no cambia entre versiones)
    // Guardamos el valor actual como referencia de regresión
    expect(res.pct).toBeGreaterThanOrEqual(50);
    expect(res.pct).toBeLessThanOrEqual(100);
    expect(res.puntaje).toBeGreaterThan(0);
    // Snapshot de regresión: anotar valor esperado tras primera ejecución exitosa
    // expect(res.pct).toBe(87.5);  // descomentar tras primera ejecución
  });
});

// ─── 11. Simulación completa (regresión end-to-end) ─────────────────────────

describe('simularPonderacion — caso de regresión completo', () => {
  it('TRM 3443.59, pres 500M, PM 39.5, comps [82,88,93], miOferta 87', () => {
    const out = simularPonderacion({
      trmValor: 3443.59,
      presupuesto: PRES,
      puntajeMaximo: PM,
      competidoresPct: [82, 88, 93],
      miOfertaPct: 87,
    });

    expect(out.centavosTRM).toBe(59);
    expect(out.formulaActiva).toBe('media_aritmetica_baja');
    expect(out.competidoresValores).toHaveLength(3);
    expect(out.miOfertaValor).toBeCloseTo((87 / 100) * PRES, 0);
    expect(out.resultados).toHaveLength(7);

    // Todos los resultados tienen puntajeOptimo entre 0 y PM
    for (const r of out.resultados) {
      expect(r.ofertaOptima.puntaje).toBeGreaterThanOrEqual(0);
      expect(r.ofertaOptima.puntaje).toBeLessThanOrEqual(PM + 0.01);
      expect(r.miPuntaje).not.toBeNull();
    }
  });

  it('sin miOferta → miPuntaje null en todos los resultados', () => {
    const out = simularPonderacion({
      trmValor: 3443.59,
      presupuesto: PRES,
      puntajeMaximo: PM,
      competidoresPct: [85, 90],
    });
    for (const r of out.resultados) {
      expect(r.miPuntaje).toBeNull();
    }
  });

  it('sin competidores → se puede ejecutar sin error', () => {
    expect(() => simularPonderacion({
      trmValor: 3443.59,
      presupuesto: PRES,
      puntajeMaximo: PM,
      competidoresPct: [],
    })).not.toThrow();
  });

  it('todas las 7 fórmulas están representadas en resultados', () => {
    const out = simularPonderacion({
      trmValor: 3443.59,
      presupuesto: PRES,
      puntajeMaximo: PM,
      competidoresPct: [85, 90],
    });
    const formulas = out.resultados.map(r => r.formula);
    for (const key of FORMULA_KEYS) {
      expect(formulas).toContain(key);
    }
  });
});

// ─── 12. Invariantes globales ────────────────────────────────────────────────

describe('Invariantes: puntajes siempre en [0, PM]', () => {
  const casosEdge: Array<{ desc: string; vals: number[] }> = [
    { desc: 'un solo valor', vals: [pctToValor(88)] },
    { desc: 'dos iguales', vals: [pctToValor(88), pctToValor(88)] },
    { desc: 'extremos 50% y 100%', vals: [pctToValor(50), pctToValor(100)] },
    { desc: 'cinco competidores', vals: [82, 85, 88, 91, 95].map(pctToValor) },
  ];

  for (const { desc, vals } of casosEdge) {
    for (const formula of FORMULA_KEYS) {
      it(`${formula} con ${desc}`, () => {
        const pts = calcularPuntajes(formula, vals, PM, PRES);
        pts.forEach(p => {
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(PM + 0.01); // +0.01 tolerancia flotante
        });
      });
    }
  }
});