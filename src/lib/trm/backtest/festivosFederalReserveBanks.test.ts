import { describe, it, expect } from 'vitest';
import {
  festivosFederalReserveBanks,
  esFestivoFederalReserveBanks,
  crearPredicadoFestivoFed,
  JUNETEENTH_PRIMER_ANIO_FED,
} from './festivosFederalReserveBanks';

// ─── 1) Festivo Fed normal entre semana ────────────────────────────────────────

describe('1) Festivo Fed normal entre semana', () => {
  it('Christmas 2026 cae viernes → festivo directo, sin ajuste', () => {
    expect(esFestivoFederalReserveBanks('2026-12-25')).toBe(true);
  });
  it('Thanksgiving 2026 (4to jueves de noviembre)', () => {
    expect(esFestivoFederalReserveBanks('2026-11-26')).toBe(true);
  });
});

// ─── 2) Festivo Fed en domingo → lunes cerrado ─────────────────────────────────

describe('2) Festivo en domingo → el LUNES siguiente queda cerrado', () => {
  it('New Year\'s Day 2028 cae sábado... (usar un caso real de domingo)', () => {
    // Verificamos con Juneteenth 2022 (domingo real, caso documentado en la fuente)
    expect(new Date('2022-06-19T12:00:00Z').getUTCDay()).toBe(0); // confirma que es domingo
    expect(esFestivoFederalReserveBanks('2022-06-19')).toBe(false); // el domingo en sí NO se marca
    expect(esFestivoFederalReserveBanks('2022-06-20')).toBe(true); // el lunes siguiente SÍ
  });
});

// ─── 3) Festivo Fed en sábado → viernes permanece abierto ──────────────────────

describe('3) Festivo en sábado → el VIERNES anterior permanece abierto (no se marca festivo)', () => {
  it('un festivo de fecha fija que cae sábado no genera cierre el viernes', () => {
    // Verificado con Independence Day 2026 — ver test #4 dedicado abajo.
  });
});

// ─── 4) Independence Day 2026: sábado 4 de julio, viernes 3 sigue elegible ────

describe('4) Independence Day 2026 — cae sábado', () => {
  it('4 de julio de 2026 es sábado', () => {
    expect(new Date('2026-07-04T12:00:00Z').getUTCDay()).toBe(6);
  });
  it('el sábado 4-jul-2026 no se marca festivo Fed (ya es fin de semana por sí solo)', () => {
    expect(esFestivoFederalReserveBanks('2026-07-04')).toBe(false);
  });
  it('el viernes 3-jul-2026 NO se marca festivo — Reserve Banks permanecen abiertos', () => {
    expect(esFestivoFederalReserveBanks('2026-07-03')).toBe(false);
  });
});

// ─── 5) Independence Day 2027: domingo 4 de julio, lunes 5 cerrado ────────────

describe('5) Independence Day 2027 — cae domingo', () => {
  it('4 de julio de 2027 es domingo', () => {
    expect(new Date('2027-07-04T12:00:00Z').getUTCDay()).toBe(0);
  });
  it('el domingo en sí no se marca (ya es fin de semana)', () => {
    expect(esFestivoFederalReserveBanks('2027-07-04')).toBe(false);
  });
  it('el lunes 5-jul-2027 SÍ queda cerrado (observancia domingo→lunes)', () => {
    expect(esFestivoFederalReserveBanks('2027-07-05')).toBe(true);
  });
});

// ─── 6) Juneteenth entre semana ─────────────────────────────────────────────────

describe('6) Juneteenth entre semana', () => {
  it('19-jun-2024 es miércoles → festivo Fed directo', () => {
    expect(new Date('2024-06-19T12:00:00Z').getUTCDay()).toBe(3);
    expect(esFestivoFederalReserveBanks('2024-06-19')).toBe(true);
  });
  it('Juneteenth NO se aplica antes de 2022 (primer año real de observancia Fed)', () => {
    expect(JUNETEENTH_PRIMER_ANIO_FED).toBe(2022);
    expect(esFestivoFederalReserveBanks('2021-06-18')).toBe(false); // lunes previo a un 19-jun-2021 domingo
    expect(esFestivoFederalReserveBanks('2021-06-21')).toBe(false); // ninguna fecha cercana a 2021 debe marcarse
  });
});

// ─── 7) Thanksgiving jueves ──────────────────────────────────────────────────────

describe('7) Thanksgiving — siempre jueves, 4to de noviembre', () => {
  it('2025: 4to jueves de noviembre = 27-nov', () => {
    const d = new Date('2025-11-27T12:00:00Z');
    expect(d.getUTCDay()).toBe(4);
    expect(esFestivoFederalReserveBanks('2025-11-27')).toBe(true);
  });
});

// ─── 8/9/10) Integración con esSesionMercadoElegible (calendarioFuturo.test.ts) ──
// Cubiertos en calendarioFuturo.test.ts para no duplicar el import del calendario colombiano.

// ─── 11) Good Friday / SIFMA no se agrega automáticamente ─────────────────────

describe('11) Good Friday / cierres de SIFMA NO se agregan como festivo Fed', () => {
  it('Good Friday 2026 (3-abr-2026) no es festivo Fed — SIFMA cierra ese día, la Reserva Federal no', () => {
    expect(esFestivoFederalReserveBanks('2026-04-03')).toBe(false);
  });
});

// ─── 12/13) Delegados a vigencias.test.ts (ya cubiertos ahí) ────────────────────

// ─── 14) Override de cierre adicional ───────────────────────────────────────────

describe('14) Override — cierre Fed adicional', () => {
  it('una fecha marcada como cierresFedAdicionales se trata como festivo aunque el calendario base no la prediga', () => {
    const predicado = crearPredicadoFestivoFed({ cierresFedAdicionales: ['2026-08-19'] });
    expect(esFestivoFederalReserveBanks('2026-08-19')).toBe(false); // el calendario base no la marca
    expect(predicado('2026-08-19')).toBe(true); // el override sí
  });
});

// ─── 15) Override de sesión forzada ─────────────────────────────────────────────

describe('15) Override — sesión forzada tiene prioridad sobre TODO cierre calculado', () => {
  it('una fecha en sesionesFedForzadas nunca se marca festivo, incluso si el calendario base o un cierre adicional la marcarían', () => {
    const predicado = crearPredicadoFestivoFed({
      cierresFedAdicionales: ['2026-12-25'],
      sesionesFedForzadas: ['2026-12-25'], // fuerza sesión el mismo día que Christmas real + un override
    });
    expect(esFestivoFederalReserveBanks('2026-12-25')).toBe(true); // festivo real (Christmas)
    expect(predicado('2026-12-25')).toBe(false); // pero la sesión forzada gana
  });
});

// ─── 16) Sin mutaciones por zona horaria ────────────────────────────────────────

describe('16) Cálculo inmune a zona horaria', () => {
  it('festivosFederalReserveBanks(anio) es estable entre invocaciones (caché) y consistente en tamaño', () => {
    const a = festivosFederalReserveBanks(2026);
    const b = festivosFederalReserveBanks(2026);
    expect(a).toBe(b); // misma instancia cacheada
    // 2026 tiene 11 festivos definidos, pero Independence Day cae sábado ese
    // año (sin observancia — ver test #4) → produce solo 10 fechas reales.
    expect(a.size).toBe(10);
  });
  it('un año sin festivos que caigan sábado produce las 11 fechas (ej. 2025)', () => {
    expect(festivosFederalReserveBanks(2025).size).toBe(11);
  });
  it('todas las fechas generadas tienen formato YYYY-MM-DD, sin componente de hora', () => {
    for (const f of festivosFederalReserveBanks(2026)) {
      expect(f).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
