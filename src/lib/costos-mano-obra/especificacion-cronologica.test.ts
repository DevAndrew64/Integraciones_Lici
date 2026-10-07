/**
 * ESPECIFICACIÓN CRONOLÓGICA — valida únicamente la posición en el
 * reloj de los segmentos de un turno (Etapas 1-2 del diseño de 5
 * etapas, Bloque 0.3). NO decide ordinaria/extra, NO asigna recargos.
 *
 * Valida segmentador-cronologico-referencia.ts (REFERENCIA EXCLUSIVA DE
 * PRUEBAS — no conectada a producción) contra expectativas explícitas,
 * nunca contra snapshots. El caso 1 usa el fixture objetivo escrito a
 * mano (caso-cronologico-segmentos-codigo47.ts) para no validar la
 * utilidad contra sí misma.
 */
import { describe, it, expect } from 'vitest';
import { segmentarTurnoReferencia } from './__testutils__/segmentador-cronologico-referencia';
import { CASO_CRONOLOGICO_SEGMENTOS_47 } from './__fixtures__/caso-cronologico-segmentos-codigo47';

describe('especificación cronológica — posición de segmentos, no ordinaria/extra', () => {
  it('1. Dos bloques: 05:00-11:00 y 13:00-14:20 (caso código 47)', () => {
    const r = segmentarTurnoReferencia(CASO_CRONOLOGICO_SEGMENTOS_47.entrada);
    expect(r.segmentos).toEqual(CASO_CRONOLOGICO_SEGMENTOS_47.segmentosEsperados);
    expect(r.minutosTrabajados).toBe(CASO_CRONOLOGICO_SEGMENTOS_47.totalesEsperados.minutosTrabajados);
    expect(r.minutosNocturnos).toBe(CASO_CRONOLOGICO_SEGMENTOS_47.totalesEsperados.minutosNocturnos);
    expect(r.minutosDiurnos).toBe(CASO_CRONOLOGICO_SEGMENTOS_47.totalesEsperados.minutosDiurnos);
  });

  it('2. Exclusión del hueco 11:00-13:00 (no aparece en ningún segmento)', () => {
    const r = segmentarTurnoReferencia(CASO_CRONOLOGICO_SEGMENTOS_47.entrada);
    for (const seg of r.segmentos) {
      expect(seg.inicio === '11:00' || seg.inicio === '12:00').toBe(false);
    }
    expect(r.minutosTrabajados).toBe(440); // 60+300+80, no 560 (que incluiría el receso)
  });

  it('3. Franja nocturna: 05:00-06:00 = 60 minutos nocturnos', () => {
    const r = segmentarTurnoReferencia({
      fecha: '2026-07-25', bloques: [{ inicio: '05:00', fin: '11:00' }],
      horaInicioNocturna: '19:00', horaFinNocturna: '06:00',
    });
    expect(r.segmentos[0]).toEqual({ fecha: '2026-07-25', inicio: '05:00', fin: '06:00', minutos: 60, franja: 'NOCTURNA' });
  });

  it('4. Franja diurna: 06:00-11:00 y 13:00-14:20', () => {
    const r = segmentarTurnoReferencia(CASO_CRONOLOGICO_SEGMENTOS_47.entrada);
    expect(r.segmentos[1]).toEqual({ fecha: '2026-07-25', inicio: '06:00', fin: '11:00', minutos: 300, franja: 'DIURNA' });
    expect(r.segmentos[2]).toEqual({ fecha: '2026-07-25', inicio: '13:00', fin: '14:20', minutos: 80, franja: 'DIURNA' });
  });

  it('5. Cero minutos nocturnos en 14:00-14:20', () => {
    const r = segmentarTurnoReferencia({
      fecha: '2026-07-25', bloques: [{ inicio: '14:00', fin: '14:20' }],
      horaInicioNocturna: '19:00', horaFinNocturna: '06:00',
    });
    expect(r.minutosNocturnos).toBe(0);
    expect(r.segmentos).toEqual([{ fecha: '2026-07-25', inicio: '14:00', fin: '14:20', minutos: 20, franja: 'DIURNA' }]);
  });

  it('6. Cruce de medianoche: 22:00-02:00 se divide en dos segmentos por día calendario', () => {
    const r = segmentarTurnoReferencia({
      fecha: '2026-07-25', bloques: [{ inicio: '22:00', fin: '02:00' }],
      horaInicioNocturna: '19:00', horaFinNocturna: '06:00',
    });
    expect(r.segmentos).toEqual([
      { fecha: '2026-07-25', inicio: '22:00', fin: '24:00', minutos: 120, franja: 'NOCTURNA' },
      { fecha: '2026-07-26', inicio: '00:00', fin: '02:00', minutos: 120, franja: 'NOCTURNA' },
    ]);
    expect(r.minutosTrabajados).toBe(240);
    expect(r.minutosNocturnos).toBe(240);
  });

  it('7. Tres bloques mismo día', () => {
    const r = segmentarTurnoReferencia({
      fecha: '2026-07-25',
      bloques: [{ inicio: '05:00', fin: '09:00' }, { inicio: '10:00', fin: '14:00' }, { inicio: '15:00', fin: '17:00' }],
      horaInicioNocturna: '19:00', horaFinNocturna: '06:00',
    });
    expect(r.segmentos.map(s => [s.inicio, s.fin, s.franja])).toEqual([
      ['05:00', '06:00', 'NOCTURNA'],
      ['06:00', '09:00', 'DIURNA'],
      ['10:00', '14:00', 'DIURNA'],
      ['15:00', '17:00', 'DIURNA'],
    ]);
    expect(r.minutosTrabajados).toBe(240 + 240 + 120); // 05:00-09:00 + 10:00-14:00 + 15:00-17:00 (60min de los cuales son nocturnos ya están dentro del primer bloque)
  });

  it('8. Descanso completamente nocturno (hueco 20:00-22:00 excluido, no requiere cruce de medianoche)', () => {
    const r = segmentarTurnoReferencia({
      fecha: '2026-07-25', bloques: [{ inicio: '18:00', fin: '20:00' }, { inicio: '22:00', fin: '23:00' }],
      horaInicioNocturna: '19:00', horaFinNocturna: '06:00',
    });
    expect(r.segmentos.map(s => [s.inicio, s.fin, s.franja])).toEqual([
      ['18:00', '19:00', 'DIURNA'],
      ['19:00', '20:00', 'NOCTURNA'],
      ['22:00', '23:00', 'NOCTURNA'],
    ]);
    // el hueco 20:00-22:00 (100% nocturno) no aparece en ningún segmento
    expect(r.minutosTrabajados).toBe(60 + 60 + 60);
  });

  it('9. Descanso parcialmente nocturno (hueco 18:30-19:30 straddles el límite 19:00, excluido igualmente)', () => {
    const r = segmentarTurnoReferencia({
      fecha: '2026-07-25', bloques: [{ inicio: '17:00', fin: '18:30' }, { inicio: '19:30', fin: '21:00' }],
      horaInicioNocturna: '19:00', horaFinNocturna: '06:00',
    });
    expect(r.segmentos.map(s => [s.inicio, s.fin, s.franja])).toEqual([
      ['17:00', '18:30', 'DIURNA'],
      ['19:30', '21:00', 'NOCTURNA'],
    ]);
  });

  it('10. Inicio exactamente a las 19:00 → nocturno desde el primer minuto', () => {
    const r = segmentarTurnoReferencia({
      fecha: '2026-07-25', bloques: [{ inicio: '19:00', fin: '20:00' }],
      horaInicioNocturna: '19:00', horaFinNocturna: '06:00',
    });
    expect(r.segmentos).toEqual([{ fecha: '2026-07-25', inicio: '19:00', fin: '20:00', minutos: 60, franja: 'NOCTURNA' }]);
  });

  it('11. Final exactamente a las 06:00 → nocturno hasta el último minuto (05:59), boundary exclusivo', () => {
    const r = segmentarTurnoReferencia({
      fecha: '2026-07-25', bloques: [{ inicio: '05:00', fin: '06:00' }],
      horaInicioNocturna: '19:00', horaFinNocturna: '06:00',
    });
    expect(r.segmentos).toEqual([{ fecha: '2026-07-25', inicio: '05:00', fin: '06:00', minutos: 60, franja: 'NOCTURNA' }]);
  });

  it('12. Turno que cruza de sábado (25/07/2026) a domingo (26/07/2026)', () => {
    const r = segmentarTurnoReferencia({
      fecha: '2026-07-25', bloques: [{ inicio: '22:00', fin: '02:00' }],
      horaInicioNocturna: '19:00', horaFinNocturna: '06:00',
    });
    expect(r.segmentos[0].fecha).toBe('2026-07-25'); // sábado
    expect(r.segmentos[1].fecha).toBe('2026-07-26'); // domingo — confirmado día de la semana en el Addendum Bloque 0.2
  });

  it('13. Cruce hacia una fecha que podría ser festiva: esta etapa solo divide por fecha, no evalúa festivo', () => {
    const r = segmentarTurnoReferencia({
      fecha: '2026-07-25', bloques: [{ inicio: '22:00', fin: '02:00' }],
      horaInicioNocturna: '19:00', horaFinNocturna: '06:00',
    });
    // La función no recibe ni conoce CalendarioFestivos — su tipo de entrada
    // no tiene ningún campo de festivos (Etapa 4, fuera de alcance aquí).
    expect(Object.keys(r.segmentos[1])).toEqual(['fecha', 'inicio', 'fin', 'minutos', 'franja']);
    expect(r.segmentos[1].fecha).toBe('2026-07-26');
  });

  it('14. Duraciones no enteras en horas: 14:00-14:20 conserva 20 minutos exactos', () => {
    const r = segmentarTurnoReferencia(CASO_CRONOLOGICO_SEGMENTOS_47.entrada);
    const seg = r.segmentos.find(s => s.inicio === '13:00');
    expect(seg?.minutos).toBe(80); // 60 (13:00-14:00) + 20 (14:00-14:20), un solo segmento diurno
    expect(r.segmentos.find(s => s.fin === '14:20')?.fin).toBe('14:20');
  });

  it('15. Turno de menos de una hora', () => {
    const r = segmentarTurnoReferencia({
      fecha: '2026-07-25', bloques: [{ inicio: '10:00', fin: '10:15' }],
      horaInicioNocturna: '19:00', horaFinNocturna: '06:00',
    });
    expect(r.segmentos).toEqual([{ fecha: '2026-07-25', inicio: '10:00', fin: '10:15', minutos: 15, franja: 'DIURNA' }]);
  });

  it('16. Bloque inválido: inicio igual a fin → excepción controlada', () => {
    expect(() => segmentarTurnoReferencia({
      fecha: '2026-07-25', bloques: [{ inicio: '10:00', fin: '10:00' }],
      horaInicioNocturna: '19:00', horaFinNocturna: '06:00',
    })).toThrowError(/BLOQUE_INVALIDO_INICIO_IGUAL_FIN/);
  });

  it('17. Bloques superpuestos → excepción controlada, nunca normalizados en silencio', () => {
    expect(() => segmentarTurnoReferencia({
      fecha: '2026-07-25', bloques: [{ inicio: '05:00', fin: '11:00' }, { inicio: '10:00', fin: '14:00' }],
      horaInicioNocturna: '19:00', horaFinNocturna: '06:00',
    })).toThrowError(/BLOQUES_SUPERPUESTOS/);
  });

  it('18. Bloques fuera de orden → excepción controlada, nunca reordenados en silencio', () => {
    expect(() => segmentarTurnoReferencia({
      fecha: '2026-07-25', bloques: [{ inicio: '13:00', fin: '14:20' }, { inicio: '05:00', fin: '11:00' }],
      horaInicioNocturna: '19:00', horaFinNocturna: '06:00',
    })).toThrowError(/BLOQUES_FUERA_DE_ORDEN/);
  });
});
