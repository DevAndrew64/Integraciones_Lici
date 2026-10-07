import { describe, it, expect } from 'vitest';
import { resolverFechaTrmAplicable, type CalendarioHabil, type CronogramaVigente } from './resolver-fecha';

// calendario de prueba: hábil = lunes a viernes; festivo fijo 2026-03-16 (lunes).
const cal: CalendarioHabil = {
  id: 'test_cal',
  hash: 'deadbeef',
  esHabil: (iso) => {
    const d = new Date(iso + 'T00:00:00.000Z');
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) return false;
    if (iso === '2026-03-16') return false;
    return true;
  },
};

const crono = (fecha: string | null): CronogramaVigente => ({
  fechaEventoBase: fecha,
  eventoCronogramaRef: { tipo: 'ProcesoCronogramaSecop', id: 123, evento: 'Cierre' },
  cronogramaSnapshot: [{ evento: 'Cierre', fecha }],
  cronogramaHash: 'abc123',
});

describe('resolverFechaTrmAplicable — casos reales de pliegos', () => {
  it('CASO A: TRM del día hábil siguiente al cierre — sobre viernes salta el finde+festivo → martes', () => {
    const r = resolverFechaTrmAplicable(
      { tipoReglaTrm: 'RELATIVA_A_EVENTO', eventoBaseTrm: 'FECHA_CIERRE', fuenteEventoBase: 'cronograma SECOP', offsetDiasHabiles: 1, politicaActualizacionFecha: 'SIGUE_CRONOGRAMA', fechaBaseCongelada: null, fechaFijaTrm: null, calendarioHabil: 'test_cal', zonaHoraria: 'America/Bogota' },
      crono('2026-03-13'), cal,
    );
    expect(r.fechaTrmAplicableResuelta).toBe('2026-03-17'); // 16 es festivo
    expect(r.insumosResolucionFecha.fechaEventoBaseUsada).toBe('2026-03-13');
  });

  it('CASO B: TRM del segundo día hábil después de finalizar el traslado del informe de evaluación', () => {
    const r = resolverFechaTrmAplicable(
      { tipoReglaTrm: 'RELATIVA_A_EVENTO', eventoBaseTrm: 'FIN_TRASLADO_INFORME_EVALUACION', fuenteEventoBase: 'acta de traslado del informe', offsetDiasHabiles: 2, politicaActualizacionFecha: 'SIGUE_CRONOGRAMA', fechaBaseCongelada: null, fechaFijaTrm: null, calendarioHabil: 'test_cal', zonaHoraria: null },
      crono('2026-03-12'), cal, // jueves
    );
    // +1 hábil = viernes 13, +2 hábil = lunes 17 (16 festivo)
    expect(r.fechaTrmAplicableResuelta).toBe('2026-03-17');
  });

  it('CASO C: TRM del día proyectado para audiencia de adjudicación, CONGELADA_INICIAL — ignora el cronograma vigente', () => {
    const r = resolverFechaTrmAplicable(
      { tipoReglaTrm: 'RELATIVA_A_EVENTO', eventoBaseTrm: 'AUDIENCIA_ADJUDICACION', fuenteEventoBase: 'resolución de apertura', offsetDiasHabiles: 0, politicaActualizacionFecha: 'CONGELADA_INICIAL', fechaBaseCongelada: '2026-04-10', fechaFijaTrm: null, calendarioHabil: 'test_cal', zonaHoraria: null },
      crono('2026-05-20'), // el cronograma YA cambió la fecha de audiencia — debe ignorarse
      cal,
    );
    expect(r.fechaTrmAplicableResuelta).toBe('2026-04-10');
    expect(r.insumosResolucionFecha.fechaEventoBaseUsada).toBe('2026-04-10');
    expect(r.insumosResolucionFecha.politicaActualizacionFecha).toBe('CONGELADA_INICIAL');
  });

  it('CONGELADA_INICIAL lanza si falta fechaBaseCongelada', () => {
    expect(() => resolverFechaTrmAplicable(
      { tipoReglaTrm: 'RELATIVA_A_EVENTO', eventoBaseTrm: 'AUDIENCIA_ADJUDICACION', fuenteEventoBase: null, offsetDiasHabiles: 0, politicaActualizacionFecha: 'CONGELADA_INICIAL', fechaBaseCongelada: null, fechaFijaTrm: null, calendarioHabil: null, zonaHoraria: null },
      crono('2026-05-20'), cal,
    )).toThrow(/CONGELADA_INICIAL/);
  });

  it('FECHA_FIJA usa fechaFijaTrm y no toca el cronograma', () => {
    const r = resolverFechaTrmAplicable(
      { tipoReglaTrm: 'FECHA_FIJA', eventoBaseTrm: null, fuenteEventoBase: null, offsetDiasHabiles: null, politicaActualizacionFecha: null, fechaBaseCongelada: null, fechaFijaTrm: '2026-05-02', calendarioHabil: null, zonaHoraria: null },
      crono(null), cal,
    );
    expect(r.fechaTrmAplicableResuelta).toBe('2026-05-02');
    expect(r.insumosResolucionFecha.fechaEventoBaseUsada).toBeNull();
  });

  it('lanza si FECHA_FIJA sin fecha, o si no hay fecha de evento base (SIGUE_CRONOGRAMA)', () => {
    expect(() => resolverFechaTrmAplicable(
      { tipoReglaTrm: 'FECHA_FIJA', eventoBaseTrm: null, fuenteEventoBase: null, offsetDiasHabiles: null, politicaActualizacionFecha: null, fechaBaseCongelada: null, fechaFijaTrm: null, calendarioHabil: null, zonaHoraria: null },
      crono(null), cal,
    )).toThrow(/FECHA_FIJA/);

    expect(() => resolverFechaTrmAplicable(
      { tipoReglaTrm: 'RELATIVA_A_EVENTO', eventoBaseTrm: 'FECHA_CIERRE', fuenteEventoBase: null, offsetDiasHabiles: 0, politicaActualizacionFecha: 'SIGUE_CRONOGRAMA', fechaBaseCongelada: null, fechaFijaTrm: null, calendarioHabil: null, zonaHoraria: null },
      crono(null), cal,
    )).toThrow(/evento base/);
  });

  it('congela insumos completos para auditoría sin re-resolver', () => {
    const r = resolverFechaTrmAplicable(
      { tipoReglaTrm: 'RELATIVA_A_EVENTO', eventoBaseTrm: 'FECHA_CIERRE', fuenteEventoBase: 'cronograma SECOP', offsetDiasHabiles: 1, politicaActualizacionFecha: 'SIGUE_CRONOGRAMA', fechaBaseCongelada: null, fechaFijaTrm: null, calendarioHabil: 'test_cal', zonaHoraria: 'America/Bogota' },
      crono('2026-03-12'), cal, '2026-03-05T10:00:00.000Z',
    );
    expect(r.insumosResolucionFecha).toMatchObject({
      fuenteEventoBase: 'cronograma SECOP',
      eventoCronogramaRef: { tipo: 'ProcesoCronogramaSecop', id: 123 },
      cronogramaHash: 'abc123',
      calendarioHabilId: 'test_cal',
      calendarioHabilHash: 'deadbeef',
      zonaHoraria: 'America/Bogota',
      resueltoEn: '2026-03-05T10:00:00.000Z',
      versionResolutor: expect.stringMatching(/resolver-1\.0\.0/),
    });
  });
});
