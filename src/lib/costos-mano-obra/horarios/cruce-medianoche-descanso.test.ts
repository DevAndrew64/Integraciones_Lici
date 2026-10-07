/**
 * FASE 1→5 (diagnóstico Aseocolba) — tests permanentes para cruce de
 * medianoche y descanso. Los `.todo()` originales de Fase 1 (10 en total)
 * quedaron activados en Fase 5, ahora que existe implementación real:
 * `offsetDiaInicio`/`offsetDiaFin` en `BloqueHorario`, el módulo
 * compartido `tiempo-absoluto.ts` (usado por `parser-horario.ts` y por
 * `bloquesConDescansoAplicado` en page.tsx) y
 * `materializarBloquePorFechaCalendario` en `materializar-programacion.ts`.
 *
 * De los 10 `.todo()` originales, los 10 quedan activados como tests
 * reales en este archivo (ver detalle en cada describe). El de la línea
 * 43 original ("20:00-23:00 y 01:00-06:00") pasó por dos decisiones de
 * diseño sucesivas dentro de la Fase 5: primero se dejó rechazado como
 * BLOQUES_FUERA_DE_ORDEN por ser indistinguible de texto (ej.
 * "14:00-18:00 y 08:00-12:00") de una lista mal ordenada; en la
 * reapertura de UX de la Fase 5, esa ambigüedad se resolvió NO ocultando
 * el caso ni bloqueándolo, sino infiriendo automáticamente el offset
 * mínimo necesario (`resolverOffsetsSecuencia`) y reportando una
 * ADVERTENCIA informativa no bloqueante — nunca un error de orden.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsearBloquesHorario } from './parser-horario';
import { resolverOffsetsBloque, rangoAbsolutoBloque, aplicarDescansoRangoAbsoluto, bloqueDesdeRangoAbsoluto, duracionAbsoluta } from './tiempo-absoluto';
import { materializarBloquePorFechaCalendario } from '../motor-distribuido/materializar-programacion';

describe('FASE 1 — cruce de medianoche: comportamiento REAL de parsearBloquesHorario', () => {
  it('[VERDE — ya funcionaba en Fase 1, sigue igual] un solo bloque que cruza medianoche (20:00-06:00) se parsea correctamente, ahora con offsetDiaFin=1', () => {
    const r = parsearBloquesHorario('20:00-06:00');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bloques).toHaveLength(1);
    expect(r.bloques[0]).toMatchObject({ inicio: '20:00', fin: '06:00', offsetDiaFin: 1 });
  });

  it('[ACTUALIZADO — Fase 5] dos bloques donde el PRIMERO ya cruza medianoche (22:00-06:00 y 08:00-10:00): el segundo hereda el día siguiente sin ambigüedad — YA NO se rechaza', () => {
    const r = parsearBloquesHorario('22:00-06:00 y 08:00-10:00');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bloques[0]).toMatchObject({ offsetDiaInicio: 0, offsetDiaFin: 1 });
    expect(r.bloques[1]).toMatchObject({ offsetDiaInicio: 1, offsetDiaFin: 1 });
  });

  it('[DECISIÓN FINAL DE FASE 5, reapertura UX — activa el .todo() original de esta línea] "20:00-23:00 y 01:00-06:00": NINGÚN bloque cruza medianoche individualmente, pero la secuencia se interpreta automáticamente como continuación al día siguiente (offset mínimo inferido), con una advertencia informativa — nunca un error de orden.', () => {
    const r = parsearBloquesHorario('20:00-23:00 y 01:00-06:00');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bloques).toEqual([
      { inicio: '20:00', fin: '23:00', orden: 1 },
      { inicio: '01:00', fin: '06:00', orden: 2, offsetDiaInicio: 1, offsetDiaFin: 1 },
    ]);
    expect(r.advertencias?.length).toBe(1);
  });

  it('[VERDE — regresión, comportamiento correcto ya vigente] bloques normales sin cruce de medianoche siguen validando orden/solape igual que siempre', () => {
    const r = parsearBloquesHorario('09:00-13:00 y 14:00-18:00');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bloques).toEqual([
      { inicio: '09:00', fin: '13:00', orden: 1 },
      { inicio: '14:00', fin: '18:00', orden: 2 },
    ]);
  });

  it('[NUEVO — Fase 5, superposición inválida tras medianoche] "20:00-03:00 y 02:00-06:00": el primer bloque cruza medianoche, el segundo (02:00-06:00) se superpone con él entre las 02:00 y las 03:00 del día siguiente', () => {
    const r = parsearBloquesHorario('20:00-03:00 y 02:00-06:00');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errores[0].codigo).toBe('BLOQUES_SUPERPUESTOS');
  });
});

describe('FASE 1→5 — descanso: caso estándar (activado — NO se rompió)', () => {
  it('[ACTIVADO — antes .todo(), ahora ejecutable vía tiempo-absoluto.ts] 09:00-18:00 + descanso 1h → [09:00-13:00, 14:00-18:00], 8h efectivas', () => {
    const offsets = resolverOffsetsBloque({ inicio: '09:00', fin: '18:00' });
    const rango = rangoAbsolutoBloque({ inicio: '09:00', fin: '18:00' }, offsets);
    const sub = aplicarDescansoRangoAbsoluto(rango, 60);
    expect(bloqueDesdeRangoAbsoluto(sub[0])).toMatchObject({ inicio: '09:00', fin: '13:00' });
    expect(bloqueDesdeRangoAbsoluto(sub[1])).toMatchObject({ inicio: '14:00', fin: '18:00' });
    expect(duracionAbsoluta(sub[0]) + duracionAbsoluta(sub[1])).toBe(480);
  });
});

describe('FASE 1→5 — descanso cruzando medianoche (BUG CONFIRMADO en Fase 1 — CORREGIDO en Fase 5)', () => {
  it('[ACTIVADO — antes .todo(), ahora corregido] 20:00-06:00 + descanso 1h → 9h efectivas, NUNCA se ignora el descanso ni da duración negativa', () => {
    const offsets = resolverOffsetsBloque({ inicio: '20:00', fin: '06:00' });
    const rango = rangoAbsolutoBloque({ inicio: '20:00', fin: '06:00' }, offsets);
    const sub = aplicarDescansoRangoAbsoluto(rango, 60);
    expect(sub).toHaveLength(2); // el descanso SÍ se aplicó (antes: se ignoraba)
    const efectivas = duracionAbsoluta(sub[0]) + duracionAbsoluta(sub[1]);
    expect(efectivas).toBe(540); // 9h — nunca negativo
    expect(efectivas).toBeGreaterThan(0);
  });

  it('20:00-06:00 sin descanso → 10h efectivas (regresión de la duración base, para contraste con el caso con descanso)', () => {
    const offsets = resolverOffsetsBloque({ inicio: '20:00', fin: '06:00' });
    const rango = rangoAbsolutoBloque({ inicio: '20:00', fin: '06:00' }, offsets);
    expect(duracionAbsoluta(rango)).toBe(600);
  });
});

describe('FASE 1→5 — clasificación por fecha calendario real (ACTIVADO — materializarBloquePorFechaCalendario)', () => {
  it('lunes 20:00 → martes 06:00: tramo antes de medianoche clasifica como lunes; tramo después, como martes', () => {
    const seg = materializarBloquePorFechaCalendario({ inicio: '20:00', fin: '06:00' }, '2026-07-13'); // lunes
    expect(seg[0].fecha).toBe('2026-07-13');
    expect(seg[1].fecha).toBe('2026-07-14');
  });

  it('sábado 20:00 → domingo 06:00: tramo antes clasifica como sábado (ordinario); tramo después, como domingo (dominical)', () => {
    const seg = materializarBloquePorFechaCalendario({ inicio: '20:00', fin: '06:00' }, '2026-07-18'); // sábado
    expect(seg[0].esDomingo).toBe(false);
    expect(seg[1].esDomingo).toBe(true);
  });

  it('domingo 20:00 → lunes 06:00: tramo antes clasifica como domingo (dominical); tramo después, como lunes (ordinario)', () => {
    const seg = materializarBloquePorFechaCalendario({ inicio: '20:00', fin: '06:00' }, '2026-07-12'); // domingo
    expect(seg[0].esDomingo).toBe(true);
    expect(seg[1].esDomingo).toBe(false);
  });

  it('día ordinario 20:00 → festivo 06:00: tramo antes ordinario; tramo después festivo', () => {
    const seg = materializarBloquePorFechaCalendario({ inicio: '20:00', fin: '06:00' }, '2026-07-19', ['2026-07-20']);
    expect(seg[0].esFestivo).toBe(false);
    expect(seg[1].esFestivo).toBe(true);
  });

  it('festivo 20:00 → día ordinario 06:00: tramo antes festivo; tramo después ordinario', () => {
    const seg = materializarBloquePorFechaCalendario({ inicio: '20:00', fin: '06:00' }, '2026-07-20', ['2026-07-20']);
    expect(seg[0].esFestivo).toBe(true);
    expect(seg[1].esFestivo).toBe(false);
  });

  it('31-dic 20:00 → 1-ene 06:00: cada tramo según si su fecha calendario real está configurada como festivo', () => {
    const seg = materializarBloquePorFechaCalendario({ inicio: '20:00', fin: '06:00' }, '2026-12-31', ['2027-01-01']);
    expect(seg[0]).toMatchObject({ fecha: '2026-12-31', esFestivo: false });
    expect(seg[1]).toMatchObject({ fecha: '2027-01-01', esFestivo: true });
  });

  it('cambio de semana (domingo 20:00 → lunes 06:00): sin duplicar ni omitir minutos entre los dos tramos', () => {
    const seg = materializarBloquePorFechaCalendario({ inicio: '20:00', fin: '06:00' }, '2026-07-19');
    expect(seg.reduce((s, x) => s + x.minutos, 0)).toBe(600);
    expect(seg[0].fecha).not.toBe(seg[1].fecha);
  });
});
