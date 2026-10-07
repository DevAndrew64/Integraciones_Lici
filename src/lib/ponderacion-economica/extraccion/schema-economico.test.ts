import { describe, it, expect } from 'vitest';
import { ExtraccionEconomicaSchema, reglaTrmExtraidaANegocio } from './schema-economico';

const completo = {
  trmGobiernaEvaluacionEconomica: { valor: true, relacionTrmCriterio: 'los centavos de la TRM determinan la fórmula económica', textoFuente: '...', paginaReferencia: 30, confianzaExtraccion: 92 },
  reglaTrm: { eventoBaseTrm: 'fecha cierre', fuenteEventoBase: 'cronograma SECOP', offsetDiasHabiles: 1, politicaActualizacionFecha: 'sigue cronograma', fechaBaseCongelada: null, fechaFijaTrm: null, textoReglaTrm: 'la TRM del día hábil siguiente a la fecha de cierre', textoFuente: '...', paginaReferencia: 51, confianzaExtraccion: 94 },
  reglaCentavos: { regla: 'redondeo', textoFuente: 'se aproximará al centavo', paginaReferencia: 51, confianzaExtraccion: 0.7 },
  criteriosEconomicos: [
    { nombre: 'Media aritmética baja', rangoTrmDesde: 0, rangoTrmHasta: 49, condicionTrmTexto: null, metodoNombre: 'media aritmetica baja', formulaReferenciaTexto: 'XB = (Vmin + X)/2', reglaPuntuacionTexto: 'el más cercano a XB obtiene el máximo', puntajeMaximo: 40, baseEconomicaEvaluada: 'total oferta', descripcionBaseEconomica: null, baseEconomicaTextoFuente: null, baseEconomicaPaginaReferencia: null, textoFuente: '...', paginaReferencia: 31, confianzaExtraccion: 92 },
    { nombre: 'Menor valor', rangoTrmDesde: 50, rangoTrmHasta: 99, condicionTrmTexto: null, metodoNombre: 'menor_valor', formulaReferenciaTexto: 'el menor valor ofertado', reglaPuntuacionTexto: 'proporcional al menor valor', puntajeMaximo: 40, baseEconomicaEvaluada: 'total oferta', descripcionBaseEconomica: null, baseEconomicaTextoFuente: null, baseEconomicaPaginaReferencia: null, textoFuente: '...', paginaReferencia: 31, confianzaExtraccion: 0.88 },
  ],
  advertencias: [{ tipo: 'inconsistencia documental', descripcion: 'tabla dice 40, fórmula usa 39', paginas: [30, 31], fuentes: ['tabla resumen', 'fórmula detallada'] }],
  preguntasPendientes: [],
};

describe('ExtraccionEconomicaSchema — extractor reducido (solo criterios económicos gobernados por TRM)', () => {
  it('parsea un pliego completo y normaliza enums/confianza', () => {
    const r = ExtraccionEconomicaSchema.parse(completo);
    expect(r.trmGobiernaEvaluacionEconomica.valor).toBe(true);
    expect(r.reglaTrm.eventoBaseTrm).toBe('FECHA_CIERRE');
    expect(r.reglaTrm.politicaActualizacionFecha).toBe('SIGUE_CRONOGRAMA');
    expect(r.reglaCentavos.regla).toBe('REDONDEO');
    expect(r.criteriosEconomicos[0].confianzaExtraccion).toBeCloseTo(0.92);
    expect(r.criteriosEconomicos[0].baseEconomicaEvaluada).toBe('TOTAL_OFERTA');
    expect(r.advertencias[0].tipo).toBe('INCONSISTENCIA_DOCUMENTAL');
  });

  it('NO extrae presupuesto general ni requisitos fuera de criterios económicos (no existen esos campos)', () => {
    const r = ExtraccionEconomicaSchema.parse(completo);
    expect('presupuestoOficial' in r).toBe(false);
    expect('requisitosHabilitantes' in r).toBe(false);
    expect('experiencia' in r).toBe(false);
  });

  it('dato ausente → null / NO_ENCONTRADO / NO_DEFINIDA, nunca inventado', () => {
    const r = ExtraccionEconomicaSchema.parse({
      trmGobiernaEvaluacionEconomica: { valor: null },
      reglaTrm: { eventoBaseTrm: 'algo raro' },
      reglaCentavos: { regla: 'no dice nada' },
      criteriosEconomicos: [],
    });
    expect(r.trmGobiernaEvaluacionEconomica.valor).toBeNull();
    expect(r.reglaTrm.eventoBaseTrm).toBe('NO_ENCONTRADO');
    expect(r.reglaCentavos.regla).toBe('NO_DEFINIDA');
    expect(r.criteriosEconomicos).toEqual([]);
  });

  it('NEGATIVO — TRM mencionada pero NO gobierna la evaluación económica', () => {
    const r = ExtraccionEconomicaSchema.parse({
      trmGobiernaEvaluacionEconomica: { valor: false, relacionTrmCriterio: null, textoFuente: 'la TRM se usará para convertir el valor del contrato a USD', paginaReferencia: 5 },
      reglaTrm: { eventoBaseTrm: 'NO_ENCONTRADO' },
      reglaCentavos: { regla: 'NO_DEFINIDA' },
      criteriosEconomicos: [],
      advertencias: [{ tipo: 'dato faltante', descripcion: 'TRM solo aparece para conversión de moneda, no gobierna el factor económico' }],
    });
    expect(r.trmGobiernaEvaluacionEconomica.valor).toBe(false);
    expect(r.criteriosEconomicos).toEqual([]);
  });

  it('COMPONENTE_ESPECIFICO: conserva la descripción, no infiere el valor', () => {
    const r = ExtraccionEconomicaSchema.parse({
      ...completo,
      criteriosEconomicos: [{
        ...completo.criteriosEconomicos[0],
        baseEconomicaEvaluada: 'componente especifico',
        descripcionBaseEconomica: 'solo el valor de los medios tecnológicos no regulados, excluye vigilancia regulada',
      }],
    });
    expect(r.criteriosEconomicos[0].baseEconomicaEvaluada).toBe('COMPONENTE_ESPECIFICO');
    expect(r.criteriosEconomicos[0].descripcionBaseEconomica).toMatch(/medios tecnológicos/);
  });

  it('rechaza rangoTrmDesde > rangoTrmHasta', () => {
    expect(() => ExtraccionEconomicaSchema.parse({
      ...completo,
      criteriosEconomicos: [{ ...completo.criteriosEconomicos[0], rangoTrmDesde: 60, rangoTrmHasta: 10 }],
    })).toThrow();
  });

  it('puntajeMaximo <= 0 se anula', () => {
    const r = ExtraccionEconomicaSchema.parse({ ...completo, criteriosEconomicos: [{ ...completo.criteriosEconomicos[0], puntajeMaximo: 0 }] });
    expect(r.criteriosEconomicos[0].puntajeMaximo).toBeNull();
  });

  it('reglaTrmExtraidaANegocio mapea NO_ENCONTRADO → null y deriva tipoReglaTrm', () => {
    expect(reglaTrmExtraidaANegocio({ eventoBaseTrm: 'NO_ENCONTRADO', fuenteEventoBase: null, offsetDiasHabiles: null, politicaActualizacionFecha: 'NO_ENCONTRADO', fechaBaseCongelada: null, fechaFijaTrm: null, textoReglaTrm: null, textoFuente: null, paginaReferencia: null, confianzaExtraccion: null } as any))
      .toMatchObject({ eventoBaseTrm: null, politicaActualizacionFecha: null, tipoReglaTrm: 'OTRA' });
    expect(reglaTrmExtraidaANegocio({ eventoBaseTrm: 'FECHA_CIERRE', fuenteEventoBase: 'cronograma', offsetDiasHabiles: 1, politicaActualizacionFecha: 'SIGUE_CRONOGRAMA', fechaBaseCongelada: null, fechaFijaTrm: null, textoReglaTrm: null, textoFuente: null, paginaReferencia: null, confianzaExtraccion: null } as any))
      .toMatchObject({ eventoBaseTrm: 'FECHA_CIERRE', tipoReglaTrm: 'RELATIVA_A_EVENTO' });
    expect(reglaTrmExtraidaANegocio({ eventoBaseTrm: 'NO_ENCONTRADO', fuenteEventoBase: null, offsetDiasHabiles: null, politicaActualizacionFecha: 'NO_ENCONTRADO', fechaBaseCongelada: null, fechaFijaTrm: '2026-05-02', textoReglaTrm: null, textoFuente: null, paginaReferencia: null, confianzaExtraccion: null } as any))
      .toMatchObject({ tipoReglaTrm: 'FECHA_FIJA' });
  });
});
