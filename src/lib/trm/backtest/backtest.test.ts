/**
 * Tests del harness de backtest (FASE 0) sobre datos SINTÉTICOS.
 * No corren el backtest real (eso requiere el snapshot de datos.gov.co,
 * autorizado pero no descargado todavía) — solo validan que el arnés
 * (validación de criterios, modelos, métricas, no-leakage, determinismo)
 * funciona correctamente antes de gastar cómputo en datos reales.
 */

import { describe, it, expect } from 'vitest';
import { esDiaHabil } from '../calendarioHabil';
import { crearRng, hashSemilla } from '../arimaBootstrap';
import { distanciaCircularDecimal } from '../proyeccionDecimal';
import {
  validarConfiguracionCriterios,
  obtenerCriterioPorDecimal,
  obtenerDistribucionPorCriterio,
  obtenerCriterioPorMayorMasa,
} from './criterios';
import { calcularPrediccionModelo, decimalPredichoDeDistribucion } from './modelos';
import { ejecutarBacktest, calcularParesEvaluablesPorHorizonte, contarParesEvaluablesPorHorizonte } from './runner';
import {
  exactDecimal,
  topKDecimal,
  distanciaCircularMedia,
  brierScore,
  logLoss,
  bloqueBootstrapExactDecimal,
  diferenciaParEadaBloqueBootstrap,
  porcentajeProbabilidadCeroEnReal,
} from './metricas';
import {
  normalizarRegistrosTrmOficiales,
  construirEventosTrmDesdeVigencias,
} from './vigencias';
import type { ConfiguracionCriterioTrm, PrediccionEvaluada, BacktestConfig, NombreModeloBacktest } from './types';
import type { TrmHistorialEntry } from '../types';
import type { RegistroTrmOficial } from './vigencias';

// ─── Helper: serie sintética tipo TRM (mismo patrón que proyeccionDecimal.test.ts) ──

function serieSintetica(desde: string, dias: number, seed = 42): TrmHistorialEntry[] {
  const rng = crearRng(seed);
  const out: TrmHistorialEntry[] = [];
  const d = new Date(desde + 'T12:00:00Z');
  let valor = 4000;
  for (let i = 0; i < dias; i++) {
    const fecha = d.toISOString().slice(0, 10);
    if (esDiaHabil(fecha)) {
      valor = Math.round((valor + (rng() - 0.5) * 30) * 100) / 100;
    }
    out.push({ fecha, valor });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Convierte una serie diaria sintética (un renglón por día calendario, con
 * el valor repetido en fines de semana/festivos — igual a como llega la
 * serie ya "aplanada" de producción) a `RegistroTrmOficial[]` (un renglón
 * por vigencia real), colapsando únicamente días CALENDARIO CONSECUTIVOS
 * con el mismo valor. Correcto para este generador sintético: el valor
 * solo se repite exactamente cuando el día no es hábil (por construcción
 * de `serieSintetica`), nunca por coincidencia entre 2 certificaciones
 * distintas — ese es justamente el caso 0-ocurrencias confirmado en el
 * dataset real (Fase 1).
 */
function comoRegistrosOficiales(serieDiaria: TrmHistorialEntry[]): RegistroTrmOficial[] {
  const ordenada = [...serieDiaria].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const registros: RegistroTrmOficial[] = [];
  for (const e of ordenada) {
    const ultimo = registros[registros.length - 1];
    if (ultimo && ultimo.valor === e.valor) {
      ultimo.vigenciaHasta = e.fecha;
    } else {
      registros.push({ valor: e.valor, vigenciaDesde: e.fecha, vigenciaHasta: e.fecha });
    }
  }
  return registros;
}

const SERIE_GRANDE = serieSintetica('2023-01-02', 900, 7);
const REGISTROS_GRANDE = comoRegistrosOficiales(SERIE_GRANDE);

// ─── 1/2/3) Validación de configuración de criterios ─────────────────────────

describe('1) validarConfiguracionCriterios — configuración correcta', () => {
  it('4 criterios con cobertura completa 00–99: válida, sin errores', () => {
    const criterios: ConfiguracionCriterioTrm[] = [
      { codigo: 'C1', desde: 0, hasta: 23 },
      { codigo: 'C2', desde: 24, hasta: 49 },
      { codigo: 'C3', desde: 50, hasta: 79 },
      { codigo: 'C4', desde: 80, hasta: 99 },
    ];
    const v = validarConfiguracionCriterios(criterios);
    expect(v.valida).toBe(true);
    expect(v.errores).toEqual([]);
    expect(v.coberturaCompleta).toBe(true);
    expect(v.decimalesSinCubrir).toEqual([]);
  });

  it('rango fuera de 00–99 → error', () => {
    const v = validarConfiguracionCriterios([{ codigo: 'C1', desde: -1, hasta: 50 }]);
    expect(v.valida).toBe(false);
    expect(v.errores.some(e => e.includes('fuera de 00–99'))).toBe(true);
  });

  it('desde > hasta → error', () => {
    const v = validarConfiguracionCriterios([{ codigo: 'C1', desde: 50, hasta: 10 }]);
    expect(v.valida).toBe(false);
    expect(v.errores.some(e => e.includes('>'))).toBe(true);
  });

  it('código duplicado → error', () => {
    const v = validarConfiguracionCriterios([
      { codigo: 'C1', desde: 0, hasta: 49 },
      { codigo: 'C1', desde: 50, hasta: 99 },
    ]);
    expect(v.valida).toBe(false);
    expect(v.errores.some(e => e.includes('duplicado'))).toBe(true);
  });
});

describe('2) validarConfiguracionCriterios — detecta solapamientos', () => {
  it('dos criterios que se pisan en un decimal → error de solapamiento', () => {
    const v = validarConfiguracionCriterios([
      { codigo: 'C1', desde: 0, hasta: 50 },
      { codigo: 'C2', desde: 40, hasta: 99 },
    ]);
    expect(v.valida).toBe(false);
    expect(v.errores.some(e => e.includes('Solapamiento'))).toBe(true);
  });
});

describe('3) validarConfiguracionCriterios — cobertura completa vs parcial', () => {
  it('cobertura parcial (solo 3 rangos que no llegan a 99) es VÁLIDA si no se exige cobertura completa', () => {
    const v = validarConfiguracionCriterios([
      { codigo: 'C1', desde: 0, hasta: 23 },
      { codigo: 'C2', desde: 24, hasta: 49 },
      { codigo: 'C3', desde: 50, hasta: 79 },
      // 80-99 sin cubrir, a propósito
    ]);
    expect(v.valida).toBe(true);
    expect(v.coberturaCompleta).toBe(false);
    expect(v.decimalesSinCubrir.length).toBe(20);
  });

  it('la misma configuración parcial es INVÁLIDA si se exige cobertura completa', () => {
    const v = validarConfiguracionCriterios(
      [
        { codigo: 'C1', desde: 0, hasta: 23 },
        { codigo: 'C2', desde: 24, hasta: 49 },
        { codigo: 'C3', desde: 50, hasta: 79 },
      ],
      { exigirCoberturaCompleta: true },
    );
    expect(v.valida).toBe(false);
    expect(v.errores.some(e => e.includes('Cobertura incompleta'))).toBe(true);
  });
});

// ─── 4) decimal → criterio ────────────────────────────────────────────────────

describe('4) obtenerCriterioPorDecimal', () => {
  const criterios: ConfiguracionCriterioTrm[] = [
    { codigo: 'C1', desde: 0, hasta: 23 },
    { codigo: 'C2', desde: 24, hasta: 49 },
    { codigo: 'C3', desde: 50, hasta: 79 },
    { codigo: 'C4', desde: 80, hasta: 99 },
  ];

  it('77 → C3 (caso exacto del ejemplo del usuario)', () => {
    expect(obtenerCriterioPorDecimal(77, criterios)).toBe('C3');
  });
  it('74 → C3 (mismo rango que 77, aunque el decimal exacto difiera)', () => {
    expect(obtenerCriterioPorDecimal(74, criterios)).toBe('C3');
  });
  it('límites de rango inclusivos: 23→C1, 24→C2, 79→C3, 80→C4', () => {
    expect(obtenerCriterioPorDecimal(23, criterios)).toBe('C1');
    expect(obtenerCriterioPorDecimal(24, criterios)).toBe('C2');
    expect(obtenerCriterioPorDecimal(79, criterios)).toBe('C3');
    expect(obtenerCriterioPorDecimal(80, criterios)).toBe('C4');
  });
  it('cobertura parcial: decimal sin criterio → null (nunca inventa uno)', () => {
    const parcial: ConfiguracionCriterioTrm[] = [{ codigo: 'C1', desde: 0, hasta: 50 }];
    expect(obtenerCriterioPorDecimal(90, parcial)).toBeNull();
  });
});

// ─── 5) distribución → masa por criterio ──────────────────────────────────────

describe('5) obtenerDistribucionPorCriterio', () => {
  it('suma la masa de probabilidad correctamente por rango (ejemplo del usuario)', () => {
    const criterios: ConfiguracionCriterioTrm[] = [
      { codigo: 'C1', desde: 0, hasta: 23 },
      { codigo: 'C2', desde: 24, hasta: 49 },
      { codigo: 'C3', desde: 50, hasta: 79 },
      { codigo: 'C4', desde: 80, hasta: 99 },
    ];
    const dist = new Array(100).fill(0);
    dist[10] = 0.18; // dentro de C1
    dist[30] = 0.24; // dentro de C2
    dist[77] = 0.46; // dentro de C3
    dist[90] = 0.12; // dentro de C4
    const porCriterio = obtenerDistribucionPorCriterio(dist, criterios);
    expect(porCriterio.C1).toBeCloseTo(0.18, 9);
    expect(porCriterio.C2).toBeCloseTo(0.24, 9);
    expect(porCriterio.C3).toBeCloseTo(0.46, 9);
    expect(porCriterio.C4).toBeCloseTo(0.12, 9);
    const suma = Object.values(porCriterio).reduce((a, b) => a + b, 0);
    expect(suma).toBeCloseTo(1, 9);
  });

  it('cobertura parcial: la masa de decimales sin criterio no se asigna a nadie (suma < 1)', () => {
    const criterios: ConfiguracionCriterioTrm[] = [{ codigo: 'C1', desde: 0, hasta: 49 }];
    const dist = new Array(100).fill(0.01); // uniforme
    const porCriterio = obtenerDistribucionPorCriterio(dist, criterios);
    expect(porCriterio.C1).toBeCloseTo(0.5, 9); // solo decimales 0-49
  });
});

// ─── 6) criterio por mayor masa ────────────────────────────────────────────────

describe('6) obtenerCriterioPorMayorMasa', () => {
  it('elige el criterio con mayor masa acumulada', () => {
    const criterios: ConfiguracionCriterioTrm[] = [
      { codigo: 'C1', desde: 0, hasta: 23 },
      { codigo: 'C2', desde: 24, hasta: 49 },
      { codigo: 'C3', desde: 50, hasta: 79 },
      { codigo: 'C4', desde: 80, hasta: 99 },
    ];
    const porCriterio = { C1: 0.18, C2: 0.24, C3: 0.46, C4: 0.12 };
    expect(obtenerCriterioPorMayorMasa(porCriterio, criterios)).toBe('C3');
  });
});

// ─── 7) criterio por decimal ≠ criterio por masa (el caso "MUY IMPORTANTE") ──

describe('7) Estrategias A (decimal principal) y B (mayor masa) pueden diferir', () => {
  it('decimal modal en C2 (49) pero la masa acumulada favorece a C3 → las 2 estrategias difieren', () => {
    const criterios: ConfiguracionCriterioTrm[] = [
      { codigo: 'C1', desde: 0, hasta: 23 },
      { codigo: 'C2', desde: 24, hasta: 49 },
      { codigo: 'C3', desde: 50, hasta: 79 },
      { codigo: 'C4', desde: 80, hasta: 99 },
    ];
    const dist = new Array(100).fill(0);
    dist[49] = 0.32; // el decimal individual más probable, cae en C2
    // pero repartida entre varios decimales de C3, la masa de C3 es mayor:
    dist[55] = 0.15;
    dist[60] = 0.13;
    dist[70] = 0.13;
    // resto de masa en C1/C4 para sumar 1
    dist[10] = 0.15;
    dist[90] = 0.12;

    const porCriterio = obtenerDistribucionPorCriterio(dist, criterios);
    expect(porCriterio.C2).toBeCloseTo(0.32, 9);
    expect(porCriterio.C3).toBeCloseTo(0.41, 9);
    expect(porCriterio.C3).toBeGreaterThan(porCriterio.C2);

    const criterioPorDecimalPrincipal = obtenerCriterioPorDecimal(
      decimalPredichoDeDistribucion(dist),
      criterios,
    );
    const criterioPorMayorMasa = obtenerCriterioPorMayorMasa(porCriterio, criterios);

    expect(criterioPorDecimalPrincipal).toBe('C2');
    expect(criterioPorMayorMasa).toBe('C3');
    expect(criterioPorDecimalPrincipal).not.toBe(criterioPorMayorMasa);
  });
});

// ─── 8/9/10) Modelos/baselines ─────────────────────────────────────────────────

describe('8) Modelo uniforme', () => {
  it('devuelve 100 posiciones, todas 1%, sin depender de la serie', () => {
    const pred = calcularPrediccionModelo('uniforme', [], '2024-01-01', 100, 'seed');
    expect(pred).not.toBeNull();
    expect(pred!.distribucion00a99).toHaveLength(100);
    for (const p of pred!.distribucion00a99) expect(p).toBeCloseTo(0.01, 9);
  });
});

describe('9) Modelos de frecuencia histórica', () => {
  it('frecuencia_global refleja la frecuencia real de decimales en la serie', () => {
    // Serie con decimal .50 repetido en TODOS los eventos → frecuencia_global debe concentrar toda la masa ahí
    const serie: TrmHistorialEntry[] = [];
    let valor = 4000.5;
    for (let i = 0; i < 40; i++) {
      const fecha = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
      if (esDiaHabil(fecha)) { serie.push({ fecha, valor }); valor += 1; } // cambia el entero, mantiene .50
    }
    const pred = calcularPrediccionModelo('frecuencia_global', serie, '2024-03-01', 100, 'seed');
    expect(pred).not.toBeNull();
    expect(pred!.decimalPredicho).toBe(50);
    expect(pred!.distribucion00a99[50]).toBeCloseTo(1, 9);
  });

  it('frecuencia_30 usa solo los últimos 30 eventos efectivos, no toda la serie', () => {
    const serie: TrmHistorialEntry[] = [];
    let valor = 4000.1; // primeros 40 eventos con .10
    let dia = 0;
    for (let i = 0; i < 40; i++) {
      const fecha = new Date(Date.UTC(2024, 0, 1 + dia)).toISOString().slice(0, 10);
      if (esDiaHabil(fecha)) { serie.push({ fecha, valor }); valor += 1; }
      dia++;
    }
    valor = 4100.77; // bloque final con .77, suficientes días hábiles para llenar la ventana de 30 por sí solo
    for (let i = 0; i < 50; i++) {
      const fecha = new Date(Date.UTC(2024, 3, 1 + dia)).toISOString().slice(0, 10);
      if (esDiaHabil(fecha)) { serie.push({ fecha, valor }); valor += 1; }
      dia++;
    }
    const pred30 = calcularPrediccionModelo('frecuencia_30', serie, '2024-06-01', 100, 'seed');
    const predGlobal = calcularPrediccionModelo('frecuencia_global', serie, '2024-06-01', 100, 'seed');
    expect(pred30!.decimalPredicho).toBe(77); // ventana reciente dominada por .77
    // La global también puede ser 77 si hay más eventos .77 que .10, pero lo relevante
    // es que frecuencia_30 ignora por completo los eventos .10 más antiguos:
    expect(pred30!.distribucion00a99[10]).toBe(0);
    expect(predGlobal).not.toBeNull();
  });
});

describe('10) Modelo moda', () => {
  it('asigna el 100% de la masa al decimal más frecuente (masa puntual, no distribución suavizada)', () => {
    const serie: TrmHistorialEntry[] = [];
    let valor = 4000.33;
    let dia = 0;
    for (let i = 0; i < 20; i++) {
      const fecha = new Date(Date.UTC(2024, 0, 1 + dia)).toISOString().slice(0, 10);
      if (esDiaHabil(fecha)) { serie.push({ fecha, valor }); valor += 1; }
      dia++;
    }
    const pred = calcularPrediccionModelo('moda', serie, '2024-02-01', 100, 'seed');
    expect(pred).not.toBeNull();
    expect(pred!.decimalPredicho).toBe(33);
    expect(pred!.distribucion00a99[33]).toBe(1);
    const suma = pred!.distribucion00a99.reduce((a, b) => a + b, 0);
    expect(suma).toBeCloseTo(1, 9);
  });
});

// ─── 11) Métricas con predicciones perfectas ───────────────────────────────────

describe('11) Métricas — caso de predicción perfecta', () => {
  function prediccionPerfecta(decimal: number): PrediccionEvaluada {
    const dist = new Array(100).fill(0);
    dist[decimal] = 1;
    return {
      fechaObjetivo: '2024-01-01',
      horizonteEventos: 1,
      modelo: 'moda',
      decimalPredicho: decimal,
      decimalReal: decimal,
      probabilidadDecimalPredicho: 1,
      top3: [decimal, (decimal + 1) % 100, (decimal + 2) % 100],
      top5: [decimal, (decimal + 1) % 100, (decimal + 2) % 100, (decimal + 3) % 100, (decimal + 4) % 100],
      distribucion00a99: dist,
      criterioReal: null,
      criterioPorDecimalPrincipal: null,
      criterioPorMayorMasa: null,
      distribucionPorCriterio: {},
      aciertoDecimal: true,
      aciertoCriterioPorDecimal: null,
      aciertoCriterioPorMasa: null,
    };
  }

  it('exactDecimal=1, top3=1, top5=1, distCircular=0, brier=0, logLoss≈0', () => {
    const predicciones = [prediccionPerfecta(10), prediccionPerfecta(50), prediccionPerfecta(99)];
    expect(exactDecimal(predicciones)).toBe(1);
    expect(topKDecimal(predicciones, 3)).toBe(1);
    expect(topKDecimal(predicciones, 5)).toBe(1);
    expect(distanciaCircularMedia(predicciones)).toBe(0);
    expect(brierScore(predicciones)).toBeCloseTo(0, 9);
    expect(logLoss(predicciones)).toBeCloseTo(0, 6); // ≈0, no exactamente 0 por el epsilon interno
  });
});

// ─── 12) Distancia circular: 99 vs 00 ──────────────────────────────────────────

describe('12) distanciaCircularDecimal — el anillo 00–99', () => {
  it('99 vs 00 → distancia 1 (no 99)', () => {
    expect(distanciaCircularDecimal(99, 0)).toBe(1);
    expect(distanciaCircularDecimal(0, 99)).toBe(1);
  });
  it('50 vs 0 → distancia 50 (caso simétrico, sin acortar por el anillo)', () => {
    expect(distanciaCircularDecimal(50, 0)).toBe(50);
  });
});

// ─── 13) No-leakage ─────────────────────────────────────────────────────────────

describe('13) No-leakage', () => {
  const configBase: BacktestConfig = {
    registrosOficiales: REGISTROS_GRANDE,
    horizontes: [1, 5],
    calentamientoEventos: 180,
    nSimulaciones: 300, // reducido a propósito, el test valida lógica, no precisión
    ventanasIndividuales: [60, 90, 180],
    muestreoOrigenes: 20, // pocos orígenes: el test de leakage no necesita cobertura completa
    modelos: ['uniforme', 'frecuencia_global', 'frecuencia_30', 'moda', 'arima_60', 'ensemble_60_90_180'],
    seedBase: 'no-leakage-test',
  };

  it('agregar un evento nuevo al FINAL de la serie no cambia ninguna predicción PREEXISTENTE', () => {
    const resultadoOriginal = ejecutarBacktest(configBase);
    expect(resultadoOriginal.length).toBeGreaterThan(0);

    // Evento nuevo insertado al final (60 días calendario tras el último
    // dato real) — con el backtest por ÍNDICE de evento, agregar un evento
    // al final SÍ puede habilitar pares nuevos (orígenes que antes no
    // tenían target ahora lo tienen, apuntando al evento insertado) — eso
    // es correcto, no es leakage. Lo que NUNCA debe pasar es que una
    // predicción que YA EXISTÍA (mismo modelo, horizonte y fechaObjetivo)
    // cambie de valor: eso sí sería señal de que el evento nuevo se coló
    // en el entrenamiento de un origen anterior.
    const ultimaFecha = REGISTROS_GRANDE[REGISTROS_GRANDE.length - 1].vigenciaHasta;
    const fechaFutura = new Date(ultimaFecha + 'T12:00:00Z');
    fechaFutura.setUTCDate(fechaFutura.getUTCDate() + 60);
    const fechaFuturaStr = fechaFutura.toISOString().slice(0, 10);
    const registrosConFuga: RegistroTrmOficial[] = [
      ...REGISTROS_GRANDE,
      { valor: 99999.99, vigenciaDesde: fechaFuturaStr, vigenciaHasta: fechaFuturaStr }, // valor absurdo, decimal .99
    ];

    const resultadoConFuga = ejecutarBacktest({ ...configBase, registrosOficiales: registrosConFuga });

    // El evento insertado solo puede habilitar pares NUEVOS, nunca eliminar
    // los existentes.
    expect(resultadoConFuga.length).toBeGreaterThanOrEqual(resultadoOriginal.length);

    const clave = (p: PrediccionEvaluada) => `${p.modelo}::${p.horizonteEventos}::${p.fechaObjetivo}`;
    const porClaveConFuga = new Map(resultadoConFuga.map(p => [clave(p), p]));

    // Cada predicción original debe reaparecer IDÉNTICA (misma distribución completa)
    for (const orig of resultadoOriginal) {
      const conFuga = porClaveConFuga.get(clave(orig));
      expect(conFuga).toBeDefined();
      expect(conFuga!.decimalPredicho).toBe(orig.decimalPredicho);
      expect(conFuga!.decimalReal).toBe(orig.decimalReal);
      expect(conFuga!.distribucion00a99).toEqual(orig.distribucion00a99);
    }

    // Cualquier predicción NUEVA (que no existía en el original) debe tener
    // como target exclusivamente el evento insertado (decimal .99) — nunca
    // debe cambiar el target de un par preexistente.
    const clavesOriginales = new Set(resultadoOriginal.map(clave));
    const nuevas = resultadoConFuga.filter(p => !clavesOriginales.has(clave(p)));
    for (const p of nuevas) expect(p.decimalReal).toBe(99);
  });
});

// ─── 14) Determinismo ───────────────────────────────────────────────────────────

describe('14) Determinismo', () => {
  it('misma config + mismos datos → resultado idéntico entre 2 corridas', () => {
    const config: BacktestConfig = {
      registrosOficiales: REGISTROS_GRANDE,
      horizontes: [1, 3],
      calentamientoEventos: 180,
      nSimulaciones: 200,
      ventanasIndividuales: [60, 90, 180],
      muestreoOrigenes: 30,
      modelos: ['arima_60', 'ensemble_60_90_180', 'frecuencia_global'],
      seedBase: 'determinismo-test',
    };
    const r1 = ejecutarBacktest(config);
    const r2 = ejecutarBacktest(config);
    expect(r1).toEqual(r2);
  });
});

// ─── 15) Toda distribución de 100 valores suma 1 ───────────────────────────────

describe('15) Toda PrediccionModelo tiene 100 posiciones, sin negativos, suma 1', () => {
  const modelos = [
    'uniforme', 'uniforme_aleatorio_sembrado', 'frecuencia_global', 'frecuencia_30', 'frecuencia_60', 'frecuencia_90',
    'moda', 'arima_60', 'arima_90', 'arima_180', 'ensemble_60_90_180',
  ] as const;

  it.each(modelos)('%s', modelo => {
    const pred = calcularPrediccionModelo(modelo, SERIE_GRANDE, '2025-06-02', 300, 'suma-test');
    expect(pred).not.toBeNull();
    expect(pred!.distribucion00a99).toHaveLength(100);
    for (const p of pred!.distribucion00a99) expect(p).toBeGreaterThanOrEqual(0);
    const suma = pred!.distribucion00a99.reduce((a, b) => a + b, 0);
    expect(suma).toBeCloseTo(1, 6);
  });
});

// ─── Extra: pares evaluables / muestreo (soporte para estimar costo) ────────

describe('calcularParesEvaluablesPorHorizonte / contarParesEvaluablesPorHorizonte', () => {
  it('respeta el calentamiento y el muestreo (1 de cada N)', () => {
    const nSinMuestreo = contarParesEvaluablesPorHorizonte(REGISTROS_GRANDE, 180, [1], 1)[1];
    const nConMuestreo4 = contarParesEvaluablesPorHorizonte(REGISTROS_GRANDE, 180, [1], 4)[1];
    expect(nConMuestreo4).toBeLessThanOrEqual(Math.ceil(nSinMuestreo / 4) + 1);
    expect(nConMuestreo4).toBeGreaterThan(0);
  });
});

// ─── Extra: enriquecimiento por criterios dentro del runner ────────────────────

describe('ejecutarBacktest — enriquecimiento con criterios (integración)', () => {
  const criterios: ConfiguracionCriterioTrm[] = [
    { codigo: 'C1', desde: 0, hasta: 24 },
    { codigo: 'C2', desde: 25, hasta: 49 },
    { codigo: 'C3', desde: 50, hasta: 74 },
    { codigo: 'C4', desde: 75, hasta: 99 },
  ];

  it('cada predicción trae criterioReal/criterioPorDecimalPrincipal/criterioPorMayorMasa consistentes', () => {
    const resultado = ejecutarBacktest({
      registrosOficiales: REGISTROS_GRANDE,
      horizontes: [1],
      calentamientoEventos: 180,
      nSimulaciones: 200,
      ventanasIndividuales: [60, 90, 180],
      muestreoOrigenes: 40,
      modelos: ['frecuencia_global', 'arima_60'],
      criterios,
      seedBase: 'criterios-integracion',
    });
    expect(resultado.length).toBeGreaterThan(0);
    for (const p of resultado) {
      expect(p.criterioReal).not.toBeUndefined();
      expect(['C1', 'C2', 'C3', 'C4']).toContain(p.criterioReal);
      expect(['C1', 'C2', 'C3', 'C4']).toContain(p.criterioPorDecimalPrincipal);
      expect(['C1', 'C2', 'C3', 'C4']).toContain(p.criterioPorMayorMasa);
      // Consistencia interna: aciertoCriterioPorDecimal debe reflejar la comparación real
      expect(p.aciertoCriterioPorDecimal).toBe(p.criterioPorDecimalPrincipal === p.criterioReal);
      expect(p.aciertoCriterioPorMasa).toBe(p.criterioPorMayorMasa === p.criterioReal);
    }
  });

  it('con cobertura parcial, si el decimal real cae fuera de todos los rangos → criterioReal=null, acierto=null (nunca inventa)', () => {
    const parcial: ConfiguracionCriterioTrm[] = [{ codigo: 'C1', desde: 0, hasta: 9 }]; // cubre casi nada
    const resultado = ejecutarBacktest({
      registrosOficiales: REGISTROS_GRANDE,
      horizontes: [1],
      calentamientoEventos: 180,
      nSimulaciones: 100,
      ventanasIndividuales: [60],
      muestreoOrigenes: 60,
      modelos: ['frecuencia_global'],
      criterios: parcial,
      seedBase: 'cobertura-parcial',
    });
    const conCriterioNulo = resultado.filter(p => p.criterioReal === null);
    // Con cobertura de solo 10/100 decimales, es esperable que la mayoría de las
    // fechas evaluadas caigan fuera del rango cubierto.
    for (const p of conCriterioNulo) {
      expect(p.aciertoCriterioPorDecimal).toBeNull();
      expect(p.aciertoCriterioPorMasa).toBeNull();
    }
    expect(resultado.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16-19) AUDITORÍA DE MAPEO TEMPORAL — invariantes obligatorios del runner
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 12 eventos oficiales de control (E1..E12), 1 por día hábil consecutivo
 * desde 2024-01-02 (martes), decimal = índice del evento (E1→01, E2→02...
 * E12→12) para poder verificar a simple vista qué evento responde por cada
 * fechaObjetivo. calentamiento=5 dentro del test.
 */
function eventosDeControl(): RegistroTrmOficial[] {
  const fechas: string[] = [];
  let f = '2024-01-02'; // martes
  fechas.push(f);
  for (let i = 1; i < 12; i++) {
    f = siguienteDiaHabilTest(f);
    fechas.push(f);
  }
  // vigenciaHasta de cada evento = el día calendario anterior a la
  // vigenciaDesde del siguiente (cubre fines de semana intermedios).
  const registros: RegistroTrmOficial[] = fechas.map((desde, i) => {
    const siguienteDesde = fechas[i + 1];
    const hasta = siguienteDesde
      ? addDiasTest(siguienteDesde, -1)
      : desde; // último evento: vigencia de 1 solo día (se extiende en el test de fin de dataset si hace falta)
    // El decimal (00-99) es la parte fraccionaria del valor, no el valor
    // entero — E7 debe tener decimal=07, por eso valor=1000.07, no 1007.
    return { valor: 1000 + (i + 1) / 100, vigenciaDesde: desde, vigenciaHasta: hasta };
  });
  return registros;
}

function addDiasTest(fecha: string, n: number): string {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function siguienteDiaHabilTest(fecha: string): string {
  let f = addDiasTest(fecha, 1);
  while (!esDiaHabil(f)) f = addDiasTest(f, 1);
  return f;
}

describe('16) Definiciones formales — 12 eventos de control (E1..E12), calentamiento=5', () => {
  const registros = eventosDeControl();
  // calentamientoEventos=5 → primerIndiceOrigen = 5-1 = 4 (E5, 0-indexado desde E1=índice 0).

  it('h=1: pares exactos E5→E6 .. E11→E12 (n=7)', () => {
    const eventos = construirEventosTrmDesdeVigencias(normalizarRegistrosTrmOficiales(registros).registros);
    const pares = calcularParesEvaluablesPorHorizonte(eventos, 5, 1, 1);
    expect(pares.map(p => [p.indiceOrigen, p.indiceObjetivo])).toEqual([
      [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11],
    ]);
    expect(pares.length).toBe(7);
  });

  it('h=3: pares exactos E5→E8 .. E9→E12 (n=5)', () => {
    const eventos = construirEventosTrmDesdeVigencias(normalizarRegistrosTrmOficiales(registros).registros);
    const pares = calcularParesEvaluablesPorHorizonte(eventos, 5, 3, 1);
    expect(pares.map(p => [p.indiceOrigen, p.indiceObjetivo])).toEqual([
      [4, 7], [5, 8], [6, 9], [7, 10], [8, 11],
    ]);
    expect(pares.length).toBe(5);
  });

  it('h=5: pares exactos E5→E10, E6→E11, E7→E12 (n=3)', () => {
    const eventos = construirEventosTrmDesdeVigencias(normalizarRegistrosTrmOficiales(registros).registros);
    const pares = calcularParesEvaluablesPorHorizonte(eventos, 5, 5, 1);
    expect(pares.map(p => [p.indiceOrigen, p.indiceObjetivo])).toEqual([
      [4, 9], [5, 10], [6, 11],
    ]);
    expect(pares.length).toBe(3);
  });

  it('decimalReal del primer par de cada horizonte coincide con el evento por índice, vía ejecutarBacktest', () => {
    const resultado = ejecutarBacktest({
      registrosOficiales: registros,
      horizontes: [1, 3, 5],
      calentamientoEventos: 5,
      nSimulaciones: 50,
      ventanasIndividuales: [30],
      muestreoOrigenes: 1,
      modelos: ['uniforme'],
      seedBase: 'control-12-eventos-pares',
    });
    // El primer par generado para cada horizonte corresponde siempre al primer
    // origen (E5, índice 4) — se toma el primer match, no un Map (que con
    // varios orígenes por horizonte se quedaría con el ÚLTIMO, no el primero).
    const primerPorHorizonte = (h: number) => resultado.find(r => r.horizonteEventos === h);
    // Primer origen = E5 (índice 4). h=1 → E6 (decimal 06); h=3 → E8 (decimal 08); h=5 → E10 (decimal 10).
    expect(primerPorHorizonte(1)?.decimalReal).toBe(6);
    expect(primerPorHorizonte(3)?.decimalReal).toBe(8);
    expect(primerPorHorizonte(5)?.decimalReal).toBe(10);
  });
});

describe('16b) Anti-leakage fuerte — par E5→E8 (índices 4→7, h=3)', () => {
  // Cada evento de control tiene un decimal ÚNICO (01..12), así que filtrar
  // por decimalReal===8 aísla exactamente las predicciones cuyo target es E8
  // — es decir, exclusivamente el par de origen E5 (único origen con h=3 cuyo
  // objetivo es E8; los demás orígenes de esta corrida targetean E9..E12).
  function soloParE5E8(predicciones: PrediccionEvaluada[]): PrediccionEvaluada[] {
    return predicciones.filter(p => p.decimalReal === 8);
  }

  it('cambiar E6/E7 (futuro intermedio, NO usado para entrenar el origen E5) no altera la predicción de E5→E8', () => {
    const base = eventosDeControl();
    const configBase = {
      horizontes: [3],
      calentamientoEventos: 5,
      nSimulaciones: 80,
      ventanasIndividuales: [30],
      muestreoOrigenes: 1,
      // arima_60 exige ≥30 eventos de entrenamiento — con solo 12 eventos de
      // control siempre da null, así que se usan 2 baselines que sí producen
      // predicción con pocos datos (frecuencia_global, moda).
      modelos: ['frecuencia_global', 'moda'] as NombreModeloBacktest[],
      seedBase: 'anti-leakage-fuerte',
    };
    const parBase = soloParE5E8(ejecutarBacktest({ ...configBase, registrosOficiales: base }));
    expect(parBase.length).toBe(2); // 2 modelos, mismo par (E5→E8)

    // E6 y E7 son índices 5 y 6 — futuro intermedio entre el origen E5 (índice 4)
    // y el objetivo E8 (índice 7). Cambiarlos radicalmente NO debe afectar la
    // predicción de ningún modelo entrenado solo con eventos[0..4].
    const conE6E7Alterados = base.map((r, i) =>
      i === 5 || i === 6 ? { ...r, valor: 9999.55 } : r,
    );
    const parAlterado = soloParE5E8(ejecutarBacktest({ ...configBase, registrosOficiales: conE6E7Alterados }));
    expect(parAlterado).toEqual(parBase);
  });

  it('cambiar E4 (parte del entrenamiento, índice 3) SÍ puede alterar la predicción de E5→E8', () => {
    const base = eventosDeControl();
    const configBase = {
      horizontes: [3],
      calentamientoEventos: 5,
      nSimulaciones: 80,
      ventanasIndividuales: [30],
      muestreoOrigenes: 1,
      modelos: ['frecuencia_global'] as NombreModeloBacktest[],
      seedBase: 'anti-leakage-fuerte-entrenamiento',
    };
    const parBase = soloParE5E8(ejecutarBacktest({ ...configBase, registrosOficiales: base }));
    const conE4Alterado = base.map((r, i) => (i === 3 ? { ...r, valor: 9999.55 } : r));
    const parAlterado = soloParE5E8(ejecutarBacktest({ ...configBase, registrosOficiales: conE4Alterado }));

    expect(parBase.length).toBe(1);
    expect(parAlterado.length).toBe(1);
    // decimalReal (el target, E8) es idéntico — solo cambió entrenamiento.
    expect(parAlterado[0].decimalReal).toBe(parBase[0].decimalReal);
    // La distribución de frecuencia_global SÍ debe reflejar el cambio en E4
    // (parte de eventos[0..4], el conjunto de entrenamiento del origen E5).
    expect(parAlterado[0].distribucion00a99).not.toEqual(parBase[0].distribucion00a99);
  });
});

describe('17) Fin de dataset — nunca se fabrica un target más allá del último evento real', () => {
  it('un horizonte que excede eventos.length - 1 desde el último origen simplemente no genera pares (sin fallback)', () => {
    const registros = eventosDeControl(); // 12 eventos, índices 0..11
    const eventos = construirEventosTrmDesdeVigencias(normalizarRegistrosTrmOficiales(registros).registros);

    // h=30 desde cualquier origen con calentamiento=5 excede por mucho los 12
    // eventos disponibles (índiceObjetivo = indiceOrigen+30 >= 34, inexistente).
    const pares = calcularParesEvaluablesPorHorizonte(eventos, 5, 30, 1);
    expect(pares.length).toBe(0);

    const resultado = ejecutarBacktest({
      registrosOficiales: registros,
      horizontes: [1, 30],
      calentamientoEventos: 5,
      nSimulaciones: 50,
      ventanasIndividuales: [30],
      muestreoOrigenes: 1,
      modelos: ['uniforme'],
      seedBase: 'fin-de-dataset',
    });
    expect(resultado.filter(r => r.horizonteEventos === 30).length).toBe(0);
    // h=1 sí produce evaluaciones (7, ver test 16).
    expect(resultado.filter(r => r.horizonteEventos === 1).length).toBe(7);
  });
});

describe('18) Invariantes A-G sobre datos reales sintéticos grandes (REGISTROS_GRANDE)', () => {
  const resultado = ejecutarBacktest({
    registrosOficiales: REGISTROS_GRANDE,
    horizontes: [1, 5, 15, 30],
    calentamientoEventos: 180,
    nSimulaciones: 50,
    ventanasIndividuales: [60],
    muestreoOrigenes: 15,
    modelos: ['uniforme', 'frecuencia_global'],
    seedBase: 'invariantes-A-G',
  });
  const { registros: registrosNormalizados } = normalizarRegistrosTrmOficiales(REGISTROS_GRANDE);
  const eventos = construirEventosTrmDesdeVigencias(registrosNormalizados);
  const fechaMaximaReal = eventos[eventos.length - 1].vigenciaHasta;

  it('A) fechaObjetivo nunca es posterior a la última fecha real del dataset', () => {
    expect(resultado.length).toBeGreaterThan(0);
    for (const p of resultado) expect(p.fechaObjetivo <= fechaMaximaReal).toBe(true);
  });

  it('B/C) decimalReal siempre coincide con el decimal de ALGÚN evento real de la serie (nunca un valor inventado)', () => {
    const decimalesReales = new Set(eventos.map(e => e.decimal));
    for (const p of resultado) expect(decimalesReales.has(p.decimalReal)).toBe(true);
  });

  it('D) el evento objetivo siempre tiene índice estrictamente mayor que el de origen (garantizado por construcción, h≥1)', () => {
    for (const h of [1, 5, 15, 30]) {
      const pares = calcularParesEvaluablesPorHorizonte(eventos, 180, h, 15);
      for (const par of pares) expect(par.indiceObjetivo).toBeGreaterThan(par.indiceOrigen);
    }
  });

  it('F) el número de evaluaciones NO es constante entre horizontes (horizontes largos deben perder orígenes cercanos al final del dataset)', () => {
    const nPorHorizonte = new Map<number, number>();
    for (const p of resultado) {
      if (p.modelo !== 'uniforme') continue;
      nPorHorizonte.set(p.horizonteEventos, (nPorHorizonte.get(p.horizonteEventos) ?? 0) + 1);
    }
    // El defecto auditado producía n idéntico en TODOS los horizontes — aquí
    // exigimos que el horizonte más largo (30) tenga ESTRICTAMENTE menos
    // evaluaciones que el más corto (1).
    expect(nPorHorizonte.get(30)!).toBeLessThan(nPorHorizonte.get(1)!);
  });

  it('G) ningún decimalReal proviene de extrapolación: coincide exactamente con eventos[indiceObjetivo].decimal', () => {
    // Verificación cruzada de una muestra (no de las miles para no encarecer el test).
    const muestra = resultado.filter((_, i) => i % 25 === 0);
    for (const p of muestra) {
      const eventoPorFecha = eventos.find(e => e.vigenciaDesde === p.fechaObjetivo);
      expect(eventoPorFecha).toBeDefined();
      expect(eventoPorFecha!.decimal).toBe(p.decimalReal);
    }
  });
});

describe('19) Fórmula de conteo n(h) = N - calentamiento - h + 1, monótona decreciente', () => {
  it('n teórico coincide EXACTAMENTE con la fórmula para cada horizonte auditado', () => {
    const horizontesAuditados = [1, 2, 3, 5, 7, 10, 15, 20, 30];
    const nTeorico = contarParesEvaluablesPorHorizonte(REGISTROS_GRANDE, 180, horizontesAuditados, 1);
    const { registros: registrosNormalizados } = normalizarRegistrosTrmOficiales(REGISTROS_GRANDE);
    const N = construirEventosTrmDesdeVigencias(registrosNormalizados).length;

    for (const h of horizontesAuditados) {
      expect(nTeorico[h]).toBe(N - 180 - h + 1);
    }
    // Monotonía estricta (fórmula lineal decreciente en h).
    for (let i = 1; i < horizontesAuditados.length; i++) {
      expect(nTeorico[horizontesAuditados[i]]).toBeLessThan(nTeorico[horizontesAuditados[i - 1]]);
    }
  });

  it('n REAL (salida de ejecutarBacktest, modelo uniforme — nunca falla por datos insuficientes) coincide con n teórico', () => {
    const horizontesAuditados = [1, 2, 3, 5, 7, 10, 15, 20, 30];
    const resultado = ejecutarBacktest({
      registrosOficiales: REGISTROS_GRANDE,
      horizontes: horizontesAuditados,
      calentamientoEventos: 180,
      nSimulaciones: 50,
      ventanasIndividuales: [60],
      muestreoOrigenes: 1,
      modelos: ['uniforme'],
      seedBase: 'tabla-n-auditoria',
    });
    const nTeorico = contarParesEvaluablesPorHorizonte(REGISTROS_GRANDE, 180, horizontesAuditados, 1);
    for (const h of horizontesAuditados) {
      const nReal = resultado.filter(p => p.horizonteEventos === h).length;
      expect(nReal).toBe(nTeorico[h]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 20-22) SALVAGUARDAS METODOLÓGICAS — corrida completa corregida
// ═══════════════════════════════════════════════════════════════════════════

describe('20) uniforme_aleatorio_sembrado — desempate no colapsa siempre en el mismo decimal', () => {
  it('a diferencia de "uniforme" (siempre decimal 0), el decimal predicho varía entre orígenes', () => {
    const resultado = ejecutarBacktest({
      registrosOficiales: REGISTROS_GRANDE,
      horizontes: [1],
      calentamientoEventos: 180,
      nSimulaciones: 50,
      ventanasIndividuales: [60],
      muestreoOrigenes: 1,
      modelos: ['uniforme', 'uniforme_aleatorio_sembrado'],
      seedBase: 'uniforme-aleatorio-test',
    });
    const uniforme = resultado.filter(p => p.modelo === 'uniforme');
    const aleatorio = resultado.filter(p => p.modelo === 'uniforme_aleatorio_sembrado');
    expect(uniforme.every(p => p.decimalPredicho === 0)).toBe(true);
    expect(new Set(aleatorio.map(p => p.decimalPredicho)).size).toBeGreaterThan(1);
  });

  it('determinismo: misma config → mismo decimalPredicho por origen', () => {
    const config: BacktestConfig = {
      registrosOficiales: REGISTROS_GRANDE,
      horizontes: [1],
      calentamientoEventos: 180,
      nSimulaciones: 50,
      ventanasIndividuales: [60],
      muestreoOrigenes: 100,
      modelos: ['uniforme_aleatorio_sembrado'],
      seedBase: 'uniforme-aleatorio-determinismo',
    };
    expect(ejecutarBacktest(config)).toEqual(ejecutarBacktest(config));
  });

  it('Brier y LogLoss prácticamente idénticos a "uniforme" (perturbación despreciable, ~1e-9)', () => {
    const resultado = ejecutarBacktest({
      registrosOficiales: REGISTROS_GRANDE,
      horizontes: [1],
      calentamientoEventos: 180,
      nSimulaciones: 50,
      ventanasIndividuales: [60],
      muestreoOrigenes: 10,
      modelos: ['uniforme', 'uniforme_aleatorio_sembrado'],
      seedBase: 'uniforme-aleatorio-brier',
    });
    const uniforme = resultado.filter(p => p.modelo === 'uniforme');
    const aleatorio = resultado.filter(p => p.modelo === 'uniforme_aleatorio_sembrado');
    expect(brierScore(aleatorio)).toBeCloseTo(brierScore(uniforme), 6);
    expect(logLoss(aleatorio)).toBeCloseTo(logLoss(uniforme), 6);
  });
});

describe('21) Block bootstrap (moving block) — ExactDecimal y diferencia pareada', () => {
  it('bloqueBootstrapExactDecimal devuelve null con muestra menor que 2×longitudBloque', () => {
    const pocas = ejecutarBacktest({
      registrosOficiales: REGISTROS_GRANDE,
      horizontes: [30],
      calentamientoEventos: 180,
      nSimulaciones: 50,
      ventanasIndividuales: [60],
      muestreoOrigenes: 999999,
      modelos: ['uniforme'],
      seedBase: 'bloque-insuficiente',
    });
    expect(bloqueBootstrapExactDecimal(pocas, 20, 100, crearRng(1))).toBeNull();
  });

  it('con muestra suficiente, el IC contiene la media observada', () => {
    const resultado = ejecutarBacktest({
      registrosOficiales: REGISTROS_GRANDE,
      horizontes: [1],
      calentamientoEventos: 180,
      nSimulaciones: 50,
      ventanasIndividuales: [60],
      muestreoOrigenes: 1,
      modelos: ['uniforme'],
      seedBase: 'bloque-suficiente',
    });
    const ic = bloqueBootstrapExactDecimal(resultado, 20, 200, crearRng(2));
    expect(ic).not.toBeNull();
    expect(ic!.inferior).toBeLessThanOrEqual(ic!.media);
    expect(ic!.superior).toBeGreaterThanOrEqual(ic!.media);
  });

  it('diferenciaParEadaBloqueBootstrap: un modelo idéntico a sí mismo tiene diferencia observada 0 y contiene el 0', () => {
    const resultado = ejecutarBacktest({
      registrosOficiales: REGISTROS_GRANDE,
      horizontes: [1],
      calentamientoEventos: 180,
      nSimulaciones: 50,
      ventanasIndividuales: [60],
      muestreoOrigenes: 1,
      modelos: ['uniforme'],
      seedBase: 'diferencia-pareada-identidad',
    });
    const diff = diferenciaParEadaBloqueBootstrap(resultado, resultado, 20, 200, crearRng(3));
    expect(diff).not.toBeNull();
    expect(diff!.diferenciaObservada).toBe(0);
    expect(diff!.contieneCero).toBe(true);
  });

  it('diferenciaParEadaBloqueBootstrap: devuelve null si las longitudes no coinciden', () => {
    const resultado = ejecutarBacktest({
      registrosOficiales: REGISTROS_GRANDE,
      horizontes: [1, 3],
      calentamientoEventos: 180,
      nSimulaciones: 50,
      ventanasIndividuales: [60],
      muestreoOrigenes: 1,
      modelos: ['uniforme'],
      seedBase: 'diferencia-pareada-desalineada',
    });
    const h1 = resultado.filter(p => p.horizonteEventos === 1);
    const h3 = resultado.filter(p => p.horizonteEventos === 3);
    expect(h1.length).not.toBe(h3.length); // distintos n por horizonte (ver fórmula §19)
    expect(diferenciaParEadaBloqueBootstrap(h1, h3, 20, 100, crearRng(4))).toBeNull();
  });
});

describe('22) porcentajeProbabilidadCeroEnReal', () => {
  it('el modelo "moda" (masa puntual) asigna 0% de probabilidad al decimal real en la mayoría de los casos', () => {
    const resultado = ejecutarBacktest({
      registrosOficiales: REGISTROS_GRANDE,
      horizontes: [1],
      calentamientoEventos: 180,
      nSimulaciones: 50,
      ventanasIndividuales: [60],
      muestreoOrigenes: 5,
      modelos: ['moda', 'uniforme'],
      seedBase: 'prob-cero-real',
    });
    const moda = resultado.filter(p => p.modelo === 'moda');
    const uniforme = resultado.filter(p => p.modelo === 'uniforme');
    // 'uniforme' nunca asigna 0 a ningún decimal (todos tienen 1%).
    expect(porcentajeProbabilidadCeroEnReal(uniforme)).toBe(0);
    // 'moda' concentra el 100% de la masa en un solo decimal — la mayoría
    // de los targets reales caen fuera de ese decimal.
    expect(porcentajeProbabilidadCeroEnReal(moda)).toBeGreaterThan(0.5);
  });
});
