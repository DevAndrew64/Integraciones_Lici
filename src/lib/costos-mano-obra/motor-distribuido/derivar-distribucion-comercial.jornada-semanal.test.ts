/**
 * Ajuste "HORAS EXTRAS POR JORNADA SEMANAL, NO POR DÍA" — tests permanentes de
 * la regla de sobretiempo del patrón genérico L-S (reemplaza a la antigua
 * regla de 7h fijas por día, que generaba extras en un trabajador que cumplía
 * exactamente las 42h de la semana).
 *
 * Regla (jornada máxima 8h diarias / 42h semanales, art. 161 CST):
 *   - Sin jornada flexible: tope diario 8h + tope semanal 42h.
 *   - Con jornada flexible PACTADA: tope diario 9h + tope semanal 42h.
 *   - Un minuto es ordinario solo si cabe en AMBOS topes; lo demás es extra
 *     (diurna o nocturna según la hora real). El tope semanal solo cuenta
 *     horas ordinarias y se recorre L→S, así que el exceso semanal cae en las
 *     últimas horas de la semana.
 *   - Mensualización del sobretiempo: bucket semanal × 4,33 (nunca 24,08).
 *   - Domingo/festivo permanece aislado (5,92), fuera de los topes.
 */
import { describe, expect, it } from 'vitest';
import { derivarDistribucionHorasComercialActivo, derivarDistribucionComercialHistoricoParaPruebas } from './derivar-distribucion-comercial';
import type { EntradaDerivacionComercial } from './derivar-distribucion-comercial';
import type { DistribucionHorarioConfigurada } from '../horarios/tipos';

const FACTOR_SEMANAS_MES = 4.33;
type Dia = DistribucionHorarioConfigurada['diasSemana'][number];
type Bloque = { inicio: string; fin: string; orden: number };

function distribucion(dias: Dia[], bloques: Bloque[]): DistribucionHorarioConfigurada {
  return {
    idCliente: 'd1', empresa: '', codigo: '', horario: '', jornada: '', turno: '',
    diasSemana: dias, bloques, excepcionesFecha: [], sincronizadoExterno: false,
  };
}

/** Un solo bloque continuo. */
function continuo(dias: Dia[], inicio: string, fin: string): DistribucionHorarioConfigurada {
  return distribucion(dias, [{ inicio, fin, orden: 1 }]);
}

/** Horario partido con 1h de almuerzo (12:00-13:00) — el hueco nunca cuenta. */
function partido(dias: Dia[], inicio: string, fin: string): DistribucionHorarioConfigurada {
  return distribucion(dias, [{ inicio, fin: '12:00', orden: 1 }, { inicio: '13:00', fin, orden: 2 }]);
}

function derivar(dists: DistribucionHorarioConfigurada[], extra: Partial<EntradaDerivacionComercial> = {}) {
  const r = derivarDistribucionHorasComercialActivo({ distribucionesHorario: dists, incluyeFestivos: false, metodologiaCosteo: 'SEMANAL_4_33', ...extra });
  if (!r.ok) throw new Error('no debería bloquear: ' + r.motivo);
  return r;
}

/** Horas extra semanales brutas (diurna + nocturna) del patrón genérico. */
function extras(r: ReturnType<typeof derivar>): number {
  return r.horasExtraSemanales.diurna + r.horasExtraSemanales.nocturna;
}

/** Horas ordinarias semanales reales (ordinaria + recargo nocturno), sin ÷6. */
function ordinarias(r: ReturnType<typeof derivar>): number {
  return (r.distribucion.horasOrdinariasDiaOrdinario + r.distribucion.horasRecargoNocturnoDiaOrdinario) * 6;
}

describe('Caso de la norma — L-J 07:30-17:00 (8:30) + V 08:00-17:00 (8:00), 1h de almuerzo = 42h exactas', () => {
  const semana = [partido(['L', 'M', 'X', 'J'], '07:30', '17:00'), partido(['V'], '08:00', '17:00')];

  it('horas efectivas: 4 × 8:30 + 8:00 = 42h (el almuerzo no cuenta)', () => {
    expect(derivar(semana).horasEfectivasSemanaTotal).toBeCloseTo(42, 6);
  });

  it('SIN jornada flexible: compara cada día contra 8h → 0:30 extra L-J = 2h extra, 40h ordinarias', () => {
    const r = derivar(semana);
    expect(extras(r)).toBeCloseTo(2, 6);
    expect(ordinarias(r)).toBeCloseTo(40, 6);
  });

  it('CON jornada flexible: la semana suma 42h → 0 extras, 42h ordinarias', () => {
    const r = derivar(semana, { jornadaFlexible: true });
    expect(extras(r)).toBe(0);
    expect(ordinarias(r)).toBeCloseTo(42, 6);
    expect(r.origenMensualizacionExtra).toBe('DIARIO_24_08'); // sin exceso no hay mensualización semanal
  });
});

describe('Caso de la norma — L-J 9:00 + V 8:00 = 44h', () => {
  const semana = [partido(['L', 'M', 'X', 'J'], '07:00', '17:00'), partido(['V'], '08:00', '17:00')];

  it('CON jornada flexible: cada día ≤ 9h pero la semana pasa de 42h → 2h extra, 42h ordinarias (no "0 porque es flexible")', () => {
    const r = derivar(semana, { jornadaFlexible: true });
    expect(r.horasEfectivasSemanaTotal).toBeCloseTo(44, 6);
    expect(extras(r)).toBeCloseTo(2, 6);
    expect(ordinarias(r)).toBeCloseTo(42, 6);
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
  });

  it('SIN jornada flexible: 1h extra por día L-J sobre las 8h = 4h extra, 40h ordinarias', () => {
    const r = derivar(semana);
    expect(extras(r)).toBeCloseTo(4, 6);
    expect(ordinarias(r)).toBeCloseTo(40, 6);
  });

  it('el exceso se mensualiza ×4,33 (nunca ×24,08): 2h semanales = 8,66h/mes', () => {
    const r = derivar(semana, { jornadaFlexible: true });
    expect(extras(r) * FACTOR_SEMANAS_MES).toBeCloseTo(8.66, 2);
  });
});

describe('Jornada por debajo de 42h NO genera extras (el bug de "extras por día")', () => {
  it('L-V 8h/día = 40h → 0 extras con y sin flexible (antes: 5h extra, 1h por día sobre 7h)', () => {
    const dist = [partido(['L', 'M', 'X', 'J', 'V'], '08:00', '17:00')];
    expect(extras(derivar(dist))).toBe(0);
    expect(extras(derivar(dist, { jornadaFlexible: true }))).toBe(0);
  });

  it('L-S 7h/día = 42h exactas → 0 extras (la jornada máxima semanal cumplida)', () => {
    const dist = [continuo(['L', 'M', 'X', 'J', 'V', 'S'], '06:00', '13:00')];
    const r = derivar(dist);
    expect(extras(r)).toBe(0);
    expect(ordinarias(r)).toBeCloseTo(42, 6);
  });

  it('horario irregular L 8h, M 7h, X 6h, J 8h30, S 4h = 33,5h: un día corto compensa a otro; solo los 0:30 sobre las 8h del jueves son extra (sin flexible); con flexible, 0', () => {
    const dist = [
      continuo(['L'], '06:00', '14:00'),
      continuo(['M'], '06:00', '13:00'),
      continuo(['X'], '06:00', '12:00'),
      continuo(['J'], '06:00', '14:30'),
      continuo(['S'], '06:00', '10:00'),
    ];
    expect(extras(derivar(dist))).toBeCloseTo(0.5, 6);
    expect(extras(derivar(dist, { jornadaFlexible: true }))).toBe(0);
  });
});

describe('Exceso semanal con días dentro del tope diario', () => {
  it('L-S 7h30/día = 45h → 3h extra (las últimas de la semana) = 12,99h/mes, con y sin flexible', () => {
    const dist = [continuo(['L', 'M', 'X', 'J', 'V', 'S'], '06:00', '13:30')];
    for (const jornadaFlexible of [false, true]) {
      const r = derivar(dist, { jornadaFlexible });
      expect(extras(r)).toBeCloseTo(3, 6);
      expect(extras(r) * FACTOR_SEMANAS_MES).toBeCloseTo(12.99, 2);
    }
  });

  it('L-S 8h/día = 48h → 6h extra = 25,98h/mes, 42h ordinarias', () => {
    const r = derivar([continuo(['L', 'M', 'X', 'J', 'V', 'S'], '06:00', '14:00')]);
    expect(extras(r)).toBeCloseTo(6, 6);
    expect(ordinarias(r)).toBeCloseTo(42, 6);
    expect(extras(r) * FACTOR_SEMANAS_MES).toBeCloseTo(25.98, 2);
  });
});

describe('Exceso sobre el tope diario (8h, o 9h con flexible) aunque la semana no llegue a 42h', () => {
  it('L-J 10h + V 4h = 44h: sin flexible 2h/día = 8h extra (36 ordinarias); con flexible 1h/día = 4h extra (40 ordinarias)', () => {
    const dist = [continuo(['L', 'M', 'X', 'J'], '08:00', '18:00'), continuo(['V'], '08:00', '12:00')];
    const sin = derivar(dist);
    expect(extras(sin)).toBeCloseTo(8, 6);
    expect(ordinarias(sin)).toBeCloseTo(36, 6);
    const con = derivar(dist, { jornadaFlexible: true });
    expect(extras(con)).toBeCloseTo(4, 6);
    expect(ordinarias(con)).toBeCloseTo(40, 6);
  });

  it('L 6h, M 10h, X 6h, J 10h, V 8h = 40h (< 42h): los días de 10h generan extra igual — 4h sin flexible, 2h con flexible', () => {
    const dist = [
      continuo(['L', 'X'], '06:00', '12:00'),
      continuo(['M', 'J'], '06:00', '16:00'),
      continuo(['V'], '06:00', '14:00'),
    ];
    expect(extras(derivar(dist))).toBeCloseTo(4, 6);
    expect(extras(derivar(dist, { jornadaFlexible: true }))).toBeCloseTo(2, 6);
  });
});

describe('Clasificación diurna/nocturna del sobretiempo (nocturno desde las 19:00)', () => {
  it('L-S 14:00-22:00 (8h): L-V 8h ordinarias (3h de recargo nocturno c/u); el exceso semanal de 6h cae el sábado — 3h extra diurna (16-19h) + 3h extra nocturna (19-22h)', () => {
    const r = derivar([continuo(['L', 'M', 'X', 'J', 'V', 'S'], '14:00', '22:00')]);
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario * 6).toBeCloseTo(15, 6); // 3h × L-V
    expect(r.horasExtraSemanales.diurna).toBeCloseTo(3, 6);
    expect(r.horasExtraSemanales.nocturna).toBeCloseTo(3, 6);
  });

  it('L-V 07:00-17:00 partido no genera recargo ni extra nocturno (todo diurno)', () => {
    const r = derivar([partido(['L', 'M', 'X', 'J', 'V'], '07:00', '17:00')]);
    expect(r.horasExtraSemanales.nocturna).toBe(0);
    expect(r.distribucion.horasRecargoNocturnoDiaOrdinario).toBe(0);
  });
});

describe('Parámetros de la jornada', () => {
  it('jornadaFlexible omitida equivale a false (jornada fija de 8h)', () => {
    const dist = [partido(['L', 'M', 'X', 'J'], '07:30', '17:00'), partido(['V'], '08:00', '17:00')];
    expect(extras(derivar(dist))).toBeCloseTo(extras(derivar(dist, { jornadaFlexible: false })), 9);
  });

  it('jornadaDiariaOrdinariaHoras=7 reproduce el tope diario anterior: L-V 8h/día → 1h extra por día = 5h', () => {
    const dist = [partido(['L', 'M', 'X', 'J', 'V'], '08:00', '17:00')];
    expect(extras(derivar(dist, { jornadaDiariaOrdinariaHoras: 7 }))).toBeCloseTo(5, 6);
  });

  it('jornadaFlexible ignora jornadaDiariaOrdinariaHoras (el tope diario pasa a 9h)', () => {
    const dist = [partido(['L', 'M', 'X', 'J'], '07:00', '17:00'), partido(['V'], '08:00', '17:00')]; // 9h × 4 + 8h = 44h
    expect(extras(derivar(dist, { jornadaFlexible: true, jornadaDiariaOrdinariaHoras: 7 }))).toBeCloseTo(2, 6);
  });

  it('jornadaOrdinariaSemanalComercial=44 mueve el tope semanal: L-S 8h/día = 48h → 4h extra', () => {
    const dist = [continuo(['L', 'M', 'X', 'J', 'V', 'S'], '06:00', '14:00')];
    expect(extras(derivar(dist, { jornadaOrdinariaSemanalComercial: 44 }))).toBeCloseTo(4, 6);
  });
});

describe('Lo que NO cambia', () => {
  it('domingo/festivo permanece aislado (5,92): L-S 7h + D 7h → 7h dominicales, 0 extra, ajeno a los topes L-S', () => {
    const dist = [continuo(['L', 'M', 'X', 'J', 'V', 'S', 'D'], '06:00', '13:00')];
    const r = derivar(dist, { incluyeFestivos: true });
    expect(r.distribucion.horasDominicalFestivaDiaEspecial).toBe(7);
    expect(r.distribucion.horasExtraDiurnaFestivaDiaEspecial).toBe(0);
    expect(extras(r)).toBe(0);
  });

  it('el camino histórico LEGADO conserva su cuota rígida (42÷5 = 8,4h para L-V) y no usa los topes nuevos', () => {
    const r = derivarDistribucionComercialHistoricoParaPruebas({
      distribucionesHorario: [partido(['L', 'M', 'X', 'J', 'V'], '08:00', '17:00')], incluyeFestivos: false, metodologiaCosteo: 'LEGADO_COMERCIAL_30_DIAS',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cuotaOrdinariaDiariaComercialHoras).toBeCloseTo(8.4, 6);
    expect(r.horasExtraSemanales.diurna).toBe(0);
  });

  it('guardrail: el sobretiempo L-S nunca se mensualiza con 24,08 — solo ×4,33', () => {
    const r = derivar([continuo(['L', 'M', 'X', 'J', 'V', 'S'], '06:00', '14:00')]);
    expect(r.distribucion.horasExtraDiurnaDiaOrdinario).toBe(0);
    expect(r.distribucion.horasExtraNocturnaDiaOrdinario).toBe(0);
    expect(r.origenMensualizacionExtra).toBe('SEMANAL_4_33');
  });
});
