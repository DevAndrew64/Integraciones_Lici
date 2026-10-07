import { describe, it, expect } from 'vitest';
import { construirEventosEfectivos } from './eventosEfectivos';
import { esDiaHabil, siguienteDiaHabil, contarDiasHabiles } from './calendarioHabil';
import { ajustarArima, simularFinalesBootstrap, crearRng, hashSemilla } from './arimaBootstrap';
import {
  proyectarDecimalTrm,
  decimalesDe,
  distanciaCircularDecimal,
  RANGOS_PLIEGO_DECIMAL,
} from './proyeccionDecimal';
import type { TrmHistorialEntry } from './types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Genera una serie diaria sintética tipo TRM: camina en días hábiles,
 *  repite el valor en fines de semana/festivos (como la serie oficial). */
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

// ─── Calendario hábil ────────────────────────────────────────────────────────

describe('calendarioHabil', () => {
  it('detecta fines de semana y festivos colombianos', () => {
    expect(esDiaHabil('2026-07-04')).toBe(false); // sábado
    expect(esDiaHabil('2026-07-05')).toBe(false); // domingo
    expect(esDiaHabil('2026-07-20')).toBe(false); // Independencia (lunes)
    expect(esDiaHabil('2026-07-08')).toBe(true);  // miércoles normal
    expect(esDiaHabil('2026-01-01')).toBe(false); // Año Nuevo
    expect(esDiaHabil('2026-04-02')).toBe(false); // Jueves Santo 2026
    expect(esDiaHabil('2026-04-03')).toBe(false); // Viernes Santo 2026
  });

  it('siguienteDiaHabil salta fin de semana y festivo', () => {
    expect(siguienteDiaHabil('2026-07-03')).toBe('2026-07-06'); // vie → lun
    expect(siguienteDiaHabil('2026-07-17')).toBe('2026-07-21'); // vie → mar (lun 20 festivo)
  });

  it('contarDiasHabiles cuenta solo hábiles posteriores', () => {
    expect(contarDiasHabiles('2026-07-08', '2026-07-08')).toBe(0);
    expect(contarDiasHabiles('2026-07-08', '2026-07-09')).toBe(1);
    expect(contarDiasHabiles('2026-07-03', '2026-07-06')).toBe(1); // solo el lunes
    expect(contarDiasHabiles('2026-07-17', '2026-07-21')).toBe(1); // lun 20 festivo
  });
});

// ─── Eventos efectivos ───────────────────────────────────────────────────────

describe('construirEventosEfectivos', () => {
  it('elimina repeticiones consecutivas y conserva cambios (incl. sábados)', () => {
    const eventos = construirEventosEfectivos([
      { fecha: '2026-07-03', valor: 4000.11 }, // viernes
      { fecha: '2026-07-04', valor: 4010.22 }, // sábado con TRM distinta → se conserva
      { fecha: '2026-07-05', valor: 4010.22 }, // domingo repite → fuera
      { fecha: '2026-07-06', valor: 4010.22 }, // lunes repite → fuera
      { fecha: '2026-07-07', valor: 4005.33 }, // cambia → se conserva
    ]);
    expect(eventos.map(e => e.fecha)).toEqual(['2026-07-03', '2026-07-04', '2026-07-07']);
    expect(eventos.map(e => e.eventoId)).toEqual([0, 1, 2]);
  });

  it('ordena por fecha, deduplica y descarta valores inválidos', () => {
    const eventos = construirEventosEfectivos([
      { fecha: '2026-07-07', valor: 4005 },
      { fecha: '2026-07-03', valor: 4000 },
      { fecha: '2026-07-03', valor: 4001 },  // duplicado: gana el último
      { fecha: '2026-07-04', valor: NaN },   // inválido → fuera
      { fecha: '2026-07-05', valor: -1 },    // inválido → fuera
    ]);
    expect(eventos.map(e => e.valor)).toEqual([4001, 4005]);
  });
});

// ─── ARIMA + bootstrap ───────────────────────────────────────────────────────

describe('arimaBootstrap', () => {
  const eventos = construirEventosEfectivos(serieSintetica('2024-01-01', 700));
  const valores = eventos.map(e => e.valor);

  it('ajusta un modelo con d=1 sobre una serie integrada', () => {
    const modelo = ajustarArima(valores);
    expect(modelo.d).toBe(1);
    expect(modelo.p).toBeGreaterThanOrEqual(0);
    expect(modelo.p).toBeLessThanOrEqual(2);
    expect(modelo.sigma2).toBeGreaterThan(0);
    expect(modelo.residuos.length).toBeGreaterThan(100);
  });

  it('rechaza series demasiado cortas', () => {
    expect(() => ajustarArima(valores.slice(0, 10))).toThrow(/mínimo 30/);
  });

  it('la simulación es determinística con la misma semilla', () => {
    const modelo = ajustarArima(valores);
    const a = simularFinalesBootstrap(modelo, 5, 1000, 123);
    const b = simularFinalesBootstrap(modelo, 5, 1000, 123);
    expect(Array.from(a)).toEqual(Array.from(b));
    const c = simularFinalesBootstrap(modelo, 5, 1000, 999);
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it('las simulaciones quedan alrededor del último valor a horizonte corto', () => {
    const modelo = ajustarArima(valores);
    const finales = simularFinalesBootstrap(modelo, 1, 5000, 7);
    const ultimo = valores[valores.length - 1];
    const mediana = Array.from(finales).sort((x, y) => x - y)[2500];
    expect(Math.abs(mediana - ultimo) / ultimo).toBeLessThan(0.02);
  });

  it('hashSemilla y crearRng son estables', () => {
    expect(hashSemilla('abc')).toBe(hashSemilla('abc'));
    const r1 = crearRng(5), r2 = crearRng(5);
    expect(r1()).toBe(r2());
  });
});

// ─── Proyección decimal ──────────────────────────────────────────────────────

describe('proyectarDecimalTrm', () => {
  // Serie que termina el miércoles 2026-07-08
  const serie = serieSintetica('2024-01-01', 920); // hasta ~2026-07-08
  const ultimaFecha = serie[serie.length - 1].fecha;

  it('decimalesDe y distanciaCircularDecimal', () => {
    expect(decimalesDe(4123.45)).toBe(45);
    expect(decimalesDe(4123.0)).toBe(0);
    expect(decimalesDe(4123.995)).toBe(0); // redondea a 4124.00
    expect(distanciaCircularDecimal(2, 98)).toBe(4);
    expect(distanciaCircularDecimal(10, 60)).toBe(50);
  });

  it('fecha en el histórico → dato real, sin proyección', () => {
    const r = proyectarDecimalTrm({ serie, fechaObjetivo: ultimaFecha, hoy: ultimaFecha });
    expect(r.esDatoReal).toBe(true);
    expect(r.horizonteDiasHabiles).toBe(0);
    expect(r.nivelConfianza).toBe('alto');
    expect(r.modeloUsado).toMatch(/sin proyección/i);
    const valorReal = serie[serie.length - 1].valor;
    expect(r.decimalRecomendado).toBe(String(decimalesDe(valorReal)).padStart(2, '0'));
    expect(r.probabilidadDecimal).toBe(1);
  });

  it('horizonte 1–5 días hábiles → predicción operativa con salida completa', () => {
    const objetivo = siguienteDiaHabil(ultimaFecha);
    const r = proyectarDecimalTrm({
      serie, fechaObjetivo: objetivo, hoy: ultimaFecha, nSimulaciones: 20_000,
    });
    expect(r.esDatoReal).toBe(false);
    expect(r.horizonteDiasHabiles).toBe(1);
    expect(r.decimalRecomendado).toMatch(/^\d{2}$/);
    expect(['alto', 'medio', 'bajo']).toContain(r.nivelConfianza);
    expect(r.rangoPliego).toBeTruthy();
    expect(r.metodoProbable).toBeTruthy();
    expect(r.trmMedianaSimulada).toBeGreaterThan(0);
    expect(r.intervalo95!.inferior).toBeLessThanOrEqual(r.intervalo95!.superior);
    expect(r.advertencia).toMatch(/probabilístico/i);
  });

  it('el resultado es reproducible (mismo input → mismo decimal)', () => {
    const objetivo = siguienteDiaHabil(ultimaFecha);
    const a = proyectarDecimalTrm({ serie, fechaObjetivo: objetivo, hoy: ultimaFecha, nSimulaciones: 10_000 });
    const b = proyectarDecimalTrm({ serie, fechaObjetivo: objetivo, hoy: ultimaFecha, nSimulaciones: 10_000 });
    expect(a.decimalRecomendado).toBe(b.decimalRecomendado);
    expect(a.trmMedianaSimulada).toBe(b.trmMedianaSimulada);
  });

  it('horizonte 16–30 → advertencia de escenario estadístico', () => {
    // ~20 días hábiles después
    let objetivo = ultimaFecha;
    for (let i = 0; i < 20; i++) objetivo = siguienteDiaHabil(objetivo);
    const r = proyectarDecimalTrm({
      serie, fechaObjetivo: objetivo, hoy: ultimaFecha, nSimulaciones: 10_000,
    });
    expect(r.horizonteDiasHabiles).toBeGreaterThanOrEqual(16);
    expect(r.horizonteDiasHabiles).toBeLessThanOrEqual(30);
    expect(r.nivelConfianza).toBe('bajo');
    expect(r.advertencia).toMatch(/NO es recomendable/);
    expect(r.decimalRecomendado).toMatch(/^\d{2}$/);
  });

  it('horizonte > 30 días hábiles → sin decimal recomendado', () => {
    let objetivo = ultimaFecha;
    for (let i = 0; i < 45; i++) objetivo = siguienteDiaHabil(objetivo);
    const r = proyectarDecimalTrm({ serie, fechaObjetivo: objetivo, hoy: ultimaFecha });
    expect(r.decimalRecomendado).toBeNull();
    expect(r.rangoPliego).toBeNull();
    expect(r.nivelConfianza).toBeNull();
    expect(r.advertencia).toMatch(/supera el máximo operativo/);
  });

  it('fechaCierre → la TRM aplicable es el día hábil siguiente', () => {
    const r = proyectarDecimalTrm({
      serie, fechaCierre: ultimaFecha, hoy: ultimaFecha, nSimulaciones: 10_000,
    });
    expect(r.fechaTRMAplicable).toBe(siguienteDiaHabil(ultimaFecha));
  });

  it('clasifica el decimal en el rango correcto del pliego', () => {
    const objetivo = siguienteDiaHabil(ultimaFecha);
    const r = proyectarDecimalTrm({
      serie, fechaObjetivo: objetivo, hoy: ultimaFecha, nSimulaciones: 10_000,
    });
    const dec = Number(r.decimalRecomendado);
    const rango = RANGOS_PLIEGO_DECIMAL.find(x => dec >= x.desde && dec <= x.hasta)!;
    expect(r.rangoPliego).toBe(rango.etiqueta);
    expect(r.metodoProbableKey).toBe(rango.formula);
  });

  it('valida entradas', () => {
    expect(() => proyectarDecimalTrm({ serie })).toThrow(/fechaObjetivo o fechaCierre/);
    expect(() => proyectarDecimalTrm({ serie: [], fechaObjetivo: '2026-08-01' })).toThrow(/vacía/);
    expect(() => proyectarDecimalTrm({ serie, fechaObjetivo: '01/08/2026' })).toThrow(/inválida/);
  });
});
