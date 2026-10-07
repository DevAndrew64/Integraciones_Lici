import { describe, it, expect } from 'vitest';
import { esDiaHabil } from '../../calendarioHabil';
import {
  calcularFeaturesEnOrigen,
  generarDatasetCausal,
  verificarNoLeakageFila,
} from './datasetCausal';
import { normalizarRegistrosTrmOficiales, construirEventosTrmDesdeVigencias, type RegistroTrmOficial } from '../vigencias';

function addDias(fecha: string, n: number): string {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function siguienteDiaHabil(fecha: string): string {
  let f = addDias(fecha, 1);
  while (!esDiaHabil(f)) f = addDias(f, 1);
  return f;
}

/** Serie sintética de N eventos consecutivos, 1 por día hábil, valor con paseo determinístico (sin RNG). */
function eventosSinteticos(n: number, valorInicial = 4000): RegistroTrmOficial[] {
  const fechas: string[] = ['2024-01-02'];
  for (let i = 1; i < n; i++) fechas.push(siguienteDiaHabil(fechas[i - 1]));
  const registros: RegistroTrmOficial[] = fechas.map((desde, i) => {
    const hasta = fechas[i + 1] ? addDias(fechas[i + 1], -1) : desde;
    // paseo con componente sinusoidal (evita que las ventanas queden constantes)
    const valor = Math.round((valorInicial + i * 2 + 15 * Math.sin(i / 3)) * 100) / 100;
    return { valor, vigenciaDesde: desde, vigenciaHasta: hasta };
  });
  return registros;
}

const REGISTROS = eventosSinteticos(250);
const { registros: REGISTROS_NORM } = normalizarRegistrosTrmOficiales(REGISTROS);
const EVENTOS = construirEventosTrmDesdeVigencias(REGISTROS_NORM);

describe('calcularFeaturesEnOrigen', () => {
  it('lanza si indiceOrigen < 20 (ventana máxima requerida)', () => {
    expect(() => calcularFeaturesEnOrigen(EVENTOS, 19)).toThrow();
  });

  it('produce todas las claves de feature esperadas, sin NaN', () => {
    const f = calcularFeaturesEnOrigen(EVENTOS, 100);
    const clavesEsperadas = [
      'nivelActual', 'diferenciaPesos', 'retornoPorcentual',
      'lag1', 'lag2', 'lag3', 'lag5', 'lag10', 'lag20',
      'lagDecimal1', 'lagDecimal2', 'lagDecimal3', 'lagDecimal5', 'lagDecimal10', 'lagDecimal20',
      'rollingMean5', 'rollingMedian5', 'rollingStd5', 'rollingMin5', 'rollingMax5', 'rollingRango5',
      'rollingMean10', 'rollingMedian10', 'rollingStd10', 'rollingMin10', 'rollingMax10', 'rollingRango10',
      'rollingMean20', 'rollingMedian20', 'rollingStd20', 'rollingMin20', 'rollingMax20', 'rollingRango20',
      'pendiente', 'aceleracion', 'volatilidad',
      'decimalActual', 'senDecimal', 'cosDecimal',
      'mes', 'diaSemanaSesion', 'posicionHabilMes', 'esInicioMes', 'esFinMes',
    ];
    for (const clave of clavesEsperadas) {
      expect(f).toHaveProperty(clave);
      expect(Number.isNaN(f[clave])).toBe(false);
    }
  });

  it('lag1 coincide con el valor del evento inmediatamente anterior', () => {
    const f = calcularFeaturesEnOrigen(EVENTOS, 100);
    expect(f.lag1).toBe(EVENTOS[99].valor);
  });

  it('rollingMean5 es exactamente el promedio de los últimos 5 valores (incluido el origen)', () => {
    const f = calcularFeaturesEnOrigen(EVENTOS, 100);
    const esperado = EVENTOS.slice(96, 101).reduce((a, e) => a + e.valor, 0) / 5;
    expect(f.rollingMean5).toBeCloseTo(esperado, 9);
  });

  it('senDecimal/cosDecimal corresponden al decimal del evento origen', () => {
    const f = calcularFeaturesEnOrigen(EVENTOS, 100);
    expect(f.senDecimal).toBeCloseTo(Math.sin((2 * Math.PI * EVENTOS[100].decimal) / 100), 9);
    expect(f.cosDecimal).toBeCloseTo(Math.cos((2 * Math.PI * EVENTOS[100].decimal) / 100), 9);
  });
});

describe('generarDatasetCausal', () => {
  it('cada fila tiene indiceTarget = indiceOrigen + horizonte, y decimalTarget/trmTarget del evento correcto', () => {
    const filas = generarDatasetCausal(EVENTOS, [1, 5], 180);
    expect(filas.length).toBeGreaterThan(0);
    for (const f of filas) {
      expect(f.indiceTarget).toBe(f.indiceOrigen + f.horizonte);
      expect(f.decimalTarget).toBe(EVENTOS[f.indiceTarget].decimal);
      expect(f.trmTarget).toBe(EVENTOS[f.indiceTarget].valor);
      expect(f.fechaCorte).toBe(EVENTOS[f.indiceOrigen].vigenciaDesde);
    }
  });

  it('lanza si calentamientoEventos < 20', () => {
    expect(() => generarDatasetCausal(EVENTOS, [1], 10)).toThrow();
  });
});

describe('verificarNoLeakageFila — no-leakage mecánico', () => {
  it('todas las filas pasan la verificación (features recalculadas desde eventos recortados == features originales)', () => {
    const filas = generarDatasetCausal(EVENTOS, [1, 5, 10], 180);
    expect(filas.length).toBeGreaterThan(0);
    for (const f of filas) expect(verificarNoLeakageFila(EVENTOS, f)).toBe(true);
  });

  it('alterar eventos POSTERIORES al origen no cambia las features de esa fila (anti-leakage fuerte)', () => {
    const filasOriginal = generarDatasetCausal(EVENTOS, [5], 180);
    const filaDePrueba = filasOriginal[0];

    // Altera drásticamente todos los eventos DESPUÉS del origen de la primera fila.
    const eventosAlterados = EVENTOS.map((e, i) =>
      i > filaDePrueba.indiceOrigen ? { ...e, valor: 99999.99, decimal: 99 } : e,
    );
    const featuresRecalculadas = calcularFeaturesEnOrigen(eventosAlterados, filaDePrueba.indiceOrigen);
    featuresRecalculadas.horizonteEventos = filaDePrueba.horizonte; // agregado tras el cálculo puro, ver generarDatasetCausal
    expect(featuresRecalculadas).toEqual(filaDePrueba.features);
  });

  it('alterar un evento DENTRO de la ventana de entrenamiento (<=indiceOrigen) SÍ cambia las features', () => {
    const filasOriginal = generarDatasetCausal(EVENTOS, [5], 180);
    const filaDePrueba = filasOriginal[0];
    const eventosAlterados = EVENTOS.map((e, i) =>
      i === filaDePrueba.indiceOrigen - 2 ? { ...e, valor: e.valor + 500 } : e,
    );
    const featuresRecalculadas = calcularFeaturesEnOrigen(eventosAlterados, filaDePrueba.indiceOrigen);
    expect(featuresRecalculadas).not.toEqual(filaDePrueba.features);
  });
});

describe('Varias fechas de la misma vigencia → mismo evento → misma fila (heredado del diseño por índice)', () => {
  it('el dataset vive en espacio de índice de evento — no existe el concepto de "fila por día calendario repetido"', () => {
    // Cada índice de evento aparece como origen A LO SUMO una vez por
    // horizonte (ver también runner.ts: "pares únicos dentro de cada
    // horizonte", ya verificado en backtest.test.ts) — se re-verifica aquí
    // sobre el dataset causal directamente.
    const filas = generarDatasetCausal(EVENTOS, [1], 180);
    const indices = filas.map(f => f.indiceOrigen);
    expect(new Set(indices).size).toBe(indices.length);
  });
});
