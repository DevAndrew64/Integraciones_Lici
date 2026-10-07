import { describe, expect, it } from 'vitest';
import {
  minutosDesdeMedianoche, formatearMinutosComoHHmm, resolverOffsetsBloque, resolverOffsetsSecuencia,
  minutoAbsoluto, rangoAbsolutoBloque, duracionAbsoluta, seSuperponenRangos, aplicarDescansoRangoAbsoluto,
  bloqueDesdeRangoAbsoluto, validarOrdenYSuperposicionSecuencia,
} from './tiempo-absoluto';

describe('FASE 5 — tiempo-absoluto: aritmética base', () => {
  it('minutosDesdeMedianoche', () => {
    expect(minutosDesdeMedianoche('00:00')).toBe(0);
    expect(minutosDesdeMedianoche('20:00')).toBe(1200);
    expect(minutosDesdeMedianoche('23:59')).toBe(1439);
  });

  it('formatearMinutosComoHHmm envuelve correctamente valores >=1440 y negativos', () => {
    expect(formatearMinutosComoHHmm(1200)).toBe('20:00');
    expect(formatearMinutosComoHHmm(1440)).toBe('00:00');
    expect(formatearMinutosComoHHmm(1470)).toBe('00:30');
    expect(formatearMinutosComoHHmm(-30)).toBe('23:30');
  });

  it('minutoAbsoluto: 20:00 día+0 = 1200; 01:00 día+1 = 1500', () => {
    expect(minutoAbsoluto('20:00', 0)).toBe(1200);
    expect(minutoAbsoluto('23:00', 0)).toBe(1380);
    expect(minutoAbsoluto('01:00', 1)).toBe(1500);
    expect(minutoAbsoluto('06:00', 1)).toBe(1800);
  });
});

describe('FASE 5 — resolverOffsetsBloque: inferencia del offset de fin', () => {
  it('bloque normal (09:00-18:00): offsetDiaInicio=0, offsetDiaFin=0', () => {
    expect(resolverOffsetsBloque({ inicio: '09:00', fin: '18:00' })).toEqual({ offsetDiaInicio: 0, offsetDiaFin: 0 });
  });

  it('bloque que envuelve medianoche (20:00-06:00): offsetDiaFin=1, inferido de forma inequívoca', () => {
    expect(resolverOffsetsBloque({ inicio: '20:00', fin: '06:00' })).toEqual({ offsetDiaInicio: 0, offsetDiaFin: 1 });
  });

  it('offsets explícitos se respetan tal cual, nunca se re-infieren', () => {
    expect(resolverOffsetsBloque({ inicio: '08:00', fin: '10:00', offsetDiaInicio: 1, offsetDiaFin: 1 })).toEqual({ offsetDiaInicio: 1, offsetDiaFin: 1 });
  });
});

describe('FASE 5 — resolverOffsetsSecuencia: el día avanza por un bloque que envuelve medianoche por sí mismo, o por inferencia automática de secuencia', () => {
  it('dos bloques normales del mismo día: ambos offsetDiaInicio=0, offsetDiaFin=0, sin avance inferido', () => {
    const r = resolverOffsetsSecuencia([
      { inicio: '09:00', fin: '13:00', orden: 1 },
      { inicio: '14:00', fin: '18:00', orden: 2 },
    ]);
    expect(r).toEqual([
      { offsetDiaInicio: 0, offsetDiaFin: 0, avanceInferido: false },
      { offsetDiaInicio: 0, offsetDiaFin: 0, avanceInferido: false },
    ]);
  });

  it('primer bloque envuelve medianoche → el segundo hereda el día ya avanzado, sin necesitar inferencia propia', () => {
    const r = resolverOffsetsSecuencia([
      { inicio: '22:00', fin: '06:00', orden: 1 },
      { inicio: '08:00', fin: '10:00', orden: 2 },
    ]);
    expect(r).toEqual([
      { offsetDiaInicio: 0, offsetDiaFin: 1, avanceInferido: false },
      { offsetDiaInicio: 1, offsetDiaFin: 1, avanceInferido: false },
    ]);
  });

  it('[FASE 5, reapertura UX] ningún bloque envuelve individualmente (20:00-23:00 / 01:00-06:00): el segundo se infiere automáticamente como día siguiente, marcado avanceInferido:true', () => {
    const r = resolverOffsetsSecuencia([
      { inicio: '20:00', fin: '23:00', orden: 1 },
      { inicio: '01:00', fin: '06:00', orden: 2 },
    ]);
    expect(r).toEqual([
      { offsetDiaInicio: 0, offsetDiaFin: 0, avanceInferido: false },
      { offsetDiaInicio: 1, offsetDiaFin: 1, avanceInferido: true },
    ]);
  });

  it('[FASE 5, reapertura UX — caso dudoso] 14:00-18:00 / 08:00-12:00: se infiere día siguiente igual (nunca falla solo por hora menor), y queda marcado avanceInferido:true para que la UI advierta', () => {
    const r = resolverOffsetsSecuencia([
      { inicio: '14:00', fin: '18:00', orden: 1 },
      { inicio: '08:00', fin: '12:00', orden: 2 },
    ]);
    expect(r[1]).toEqual({ offsetDiaInicio: 1, offsetDiaFin: 1, avanceInferido: true });
    const conOrden = [{ inicio: '14:00', fin: '18:00', orden: 1 }, { inicio: '08:00', fin: '12:00', orden: 2 }];
    const validacion = validarOrdenYSuperposicionSecuencia(conOrden, r);
    expect(validacion.ok).toBe(true); // nunca se rechaza automáticamente solo por tener una hora menor
  });

  it('[FASE 5, reapertura UX — superposición real tras normalizar] 20:00-03:00 / 02:00-06:00: la inferencia avanza el día, pero la superposición real (02:00-03:00 duplicado) sigue rechazándose', () => {
    const r = resolverOffsetsSecuencia([
      { inicio: '20:00', fin: '03:00', orden: 1 },
      { inicio: '02:00', fin: '06:00', orden: 2 },
    ]);
    expect(r).toEqual([
      { offsetDiaInicio: 0, offsetDiaFin: 1, avanceInferido: false },
      { offsetDiaInicio: 1, offsetDiaFin: 1, avanceInferido: false },
    ]);
    const conOrden = [{ inicio: '20:00', fin: '03:00', orden: 1 }, { inicio: '02:00', fin: '06:00', orden: 2 }];
    const validacion = validarOrdenYSuperposicionSecuencia(conOrden, r);
    expect(validacion.ok).toBe(false);
    expect(validacion.codigo).toBe('BLOQUES_SUPERPUESTOS');
  });

  it('bloque único (offsets ya explícitos, ej. restaurado desde catálogo) se respeta tal cual, sin marcar avanceInferido', () => {
    const r = resolverOffsetsSecuencia([
      { inicio: '20:00', fin: '23:00', orden: 1 },
      { inicio: '01:00', fin: '06:00', orden: 2, offsetDiaInicio: 1, offsetDiaFin: 1 },
    ]);
    expect(r[1]).toEqual({ offsetDiaInicio: 1, offsetDiaFin: 1, avanceInferido: false });
  });
});

describe('FASE 5 — rangoAbsolutoBloque/duracionAbsoluta: nunca negativa', () => {
  it('09:00-18:00 → 540 min (9h)', () => {
    const offsets = resolverOffsetsBloque({ inicio: '09:00', fin: '18:00' });
    const rango = rangoAbsolutoBloque({ inicio: '09:00', fin: '18:00' }, offsets);
    expect(duracionAbsoluta(rango)).toBe(540);
  });

  it('20:00-06:00 → 600 min (10h), NUNCA negativa', () => {
    const offsets = resolverOffsetsBloque({ inicio: '20:00', fin: '06:00' });
    const rango = rangoAbsolutoBloque({ inicio: '20:00', fin: '06:00' }, offsets);
    expect(duracionAbsoluta(rango)).toBe(600);
    expect(duracionAbsoluta(rango)).toBeGreaterThan(0);
  });

  it('20:00-23:00 (día+0) + 01:00-06:00 (día+1, offsets explícitos) → 3h + 5h = 8h efectivas totales', () => {
    const b1 = { inicio: '20:00', fin: '23:00', offsetDiaInicio: 0, offsetDiaFin: 0 };
    const b2 = { inicio: '01:00', fin: '06:00', offsetDiaInicio: 1, offsetDiaFin: 1 };
    const d1 = duracionAbsoluta(rangoAbsolutoBloque(b1, resolverOffsetsBloque(b1)));
    const d2 = duracionAbsoluta(rangoAbsolutoBloque(b2, resolverOffsetsBloque(b2)));
    expect(d1).toBe(180);
    expect(d2).toBe(300);
    expect(d1 + d2).toBe(480); // 8h
  });
});

describe('FASE 5 — seSuperponenRangos', () => {
  it('20:00-23:00 día+0 y 01:00-06:00 día+1: NO se superponen (caso válido)', () => {
    const b1 = { inicio: '20:00', fin: '23:00', offsetDiaInicio: 0, offsetDiaFin: 0 };
    const b2 = { inicio: '01:00', fin: '06:00', offsetDiaInicio: 1, offsetDiaFin: 1 };
    const r1 = rangoAbsolutoBloque(b1, resolverOffsetsBloque(b1));
    const r2 = rangoAbsolutoBloque(b2, resolverOffsetsBloque(b2));
    expect(seSuperponenRangos(r1, r2)).toBe(false);
  });

  it('20:00-03:00 día+1 y 02:00-06:00 día+1: SÍ se superponen (02:00-03:00 duplicado) — caso inválido', () => {
    const b1 = { inicio: '20:00', fin: '03:00', offsetDiaInicio: 0, offsetDiaFin: 1 };
    const b2 = { inicio: '02:00', fin: '06:00', offsetDiaInicio: 1, offsetDiaFin: 1 };
    const r1 = rangoAbsolutoBloque(b1, resolverOffsetsBloque(b1));
    const r2 = rangoAbsolutoBloque(b2, resolverOffsetsBloque(b2));
    expect(seSuperponenRangos(r1, r2)).toBe(true);
  });
});

describe('FASE 5 — aplicarDescansoRangoAbsoluto', () => {
  it('09:00-18:00 + 1h descanso → [09:00-13:00, 14:00-18:00], 8h efectivas (regresión — caso estándar)', () => {
    const offsets = resolverOffsetsBloque({ inicio: '09:00', fin: '18:00' });
    const rango = rangoAbsolutoBloque({ inicio: '09:00', fin: '18:00' }, offsets);
    const sub = aplicarDescansoRangoAbsoluto(rango, 60);
    expect(sub).toHaveLength(2);
    expect(bloqueDesdeRangoAbsoluto(sub[0])).toMatchObject({ inicio: '09:00', fin: '13:00' });
    expect(bloqueDesdeRangoAbsoluto(sub[1])).toMatchObject({ inicio: '14:00', fin: '18:00' });
    const efectivas = duracionAbsoluta(sub[0]) + duracionAbsoluta(sub[1]);
    expect(efectivas).toBe(480); // 8h
  });

  it('20:00-06:00 + 1h descanso → 9h efectivas, descanso aplicado sin cruzar a duración negativa', () => {
    const offsets = resolverOffsetsBloque({ inicio: '20:00', fin: '06:00' });
    const rango = rangoAbsolutoBloque({ inicio: '20:00', fin: '06:00' }, offsets);
    const sub = aplicarDescansoRangoAbsoluto(rango, 60);
    expect(sub).toHaveLength(2);
    const efectivas = duracionAbsoluta(sub[0]) + duracionAbsoluta(sub[1]);
    expect(efectivas).toBe(540); // 9h
    // El segundo sub-bloque debe caer en el día+1 (después de medianoche).
    const bq2 = bloqueDesdeRangoAbsoluto(sub[1]);
    expect(bq2.offsetDiaInicio).toBeGreaterThanOrEqual(1);
  });

  it('descanso que no cabe: retorna el rango original sin dividir', () => {
    const offsets = resolverOffsetsBloque({ inicio: '09:00', fin: '10:00' });
    const rango = rangoAbsolutoBloque({ inicio: '09:00', fin: '10:00' }, offsets);
    const sub = aplicarDescansoRangoAbsoluto(rango, 90);
    expect(sub).toHaveLength(1);
    expect(sub[0]).toEqual(rango);
  });
});

describe('FASE 5 (reapertura UX) — inferencia automática vía resolverOffsetsSecuencia, sin checkbox manual', () => {
  it('1) 20:00-23:00 / 01:00-06:00, offsets inferidos automáticamente → 8h efectivas, sin ninguna marca manual', () => {
    const bloques = [
      { inicio: '20:00', fin: '23:00', orden: 1 },
      { inicio: '01:00', fin: '06:00', orden: 2 },
    ];
    const offsets = resolverOffsetsSecuencia(bloques);
    expect(offsets).toEqual([
      { offsetDiaInicio: 0, offsetDiaFin: 0, avanceInferido: false },
      { offsetDiaInicio: 1, offsetDiaFin: 1, avanceInferido: true },
    ]);
    const d1 = duracionAbsoluta(rangoAbsolutoBloque(bloques[0], offsets[0]));
    const d2 = duracionAbsoluta(rangoAbsolutoBloque(bloques[1], offsets[1]));
    expect(d1 + d2).toBe(480); // 8h
  });

  it('7) 14:00-18:00 / 08:00-12:00 (caso dudoso): se infiere día siguiente igual — nunca falla automáticamente solo por tener una hora menor — pero queda marcado para que la UI muestre advertencia', () => {
    const bloques = [{ inicio: '14:00', fin: '18:00', orden: 1 }, { inicio: '08:00', fin: '12:00', orden: 2 }];
    const offsets = resolverOffsetsSecuencia(bloques);
    expect(offsets[1].avanceInferido).toBe(true);
    const validacion = validarOrdenYSuperposicionSecuencia(bloques, offsets);
    expect(validacion.ok).toBe(true);
  });

  it('5) superposición 20:00-03:00 (día+1) / 02:00-06:00 → sigue rechazándose (02:00-03:00 duplicado) aun con inferencia automática', () => {
    const bloques = [{ inicio: '20:00', fin: '03:00', orden: 1 }, { inicio: '02:00', fin: '06:00', orden: 2 }];
    const offsets = resolverOffsetsSecuencia(bloques);
    // El primer bloque ya envuelve medianoche por sí mismo → offsetDiaFin=1;
    // el segundo se infiere automáticamente en día 1 respecto del primero.
    expect(offsets).toEqual([
      { offsetDiaInicio: 0, offsetDiaFin: 1, avanceInferido: false },
      { offsetDiaInicio: 1, offsetDiaFin: 1, avanceInferido: false },
    ]);
    const validacion = validarOrdenYSuperposicionSecuencia(bloques, offsets);
    expect(validacion.ok).toBe(false);
    expect(validacion.codigo).toBe('BLOQUES_SUPERPUESTOS');
  });

  it('9) fecha real: domingo 20:00-23:00 / lunes 01:00-06:00 (vía materializarBloquePorFechaCalendario) — cada tramo en su propia fecha', () => {
    // Se verifica aquí solo la resolución automática de offsets; la
    // materialización por fecha calendario real se prueba en
    // materializar-programacion.fecha-calendario.test.ts (Fase 5 original).
    const bloques = [{ inicio: '20:00', fin: '23:00', orden: 1 }, { inicio: '01:00', fin: '06:00', orden: 2 }];
    const offsets = resolverOffsetsSecuencia(bloques);
    expect(offsets[0].offsetDiaInicio).toBe(0);
    expect(offsets[1].offsetDiaInicio).toBe(1);
  });
});
