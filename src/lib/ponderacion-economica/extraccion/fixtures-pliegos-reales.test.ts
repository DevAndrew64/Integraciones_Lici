/**
 * FASE A.1 §10 — Fixtures SINTÉTICOS basados en la ESTRUCTURA de pliegos
 * reales encontrados (no se suben los PDF originales). Cada fixture es lo
 * que Gemini devolvería (ya parseado por `ExtraccionEconomicaSchema`) para
 * un caso concreto, y se verifica el comportamiento esperado end-to-end de
 * schema + gate (`resolverCriteriosPliego`) + resolutor de fecha, sin BD.
 */

import { describe, it, expect } from 'vitest';
import { ExtraccionEconomicaSchema, reglaTrmExtraidaANegocio } from './schema-economico';
import { resolverCriteriosPliego, type MetodoPliegoEntrada } from '../robusto/criterios-pliego';
import { resolverFechaTrmAplicable, type CalendarioHabil, type CronogramaVigente } from '../regla-trm/resolver-fecha';

const calHabil: CalendarioHabil = { id: 'test', hash: 'h', esHabil: (iso) => { const d = new Date(iso + 'T00:00:00Z').getUTCDay(); return d !== 0 && d !== 6; } };

/** convierte criteriosEconomicos ya "aprobados a mano" en la entrada del gate. */
function comoMetodosAprobados(criterios: ReturnType<typeof ExtraccionEconomicaSchema.parse>['criteriosEconomicos'], equivalencia: 'CONFIRMADA' | 'NO_EVALUADA' = 'CONFIRMADA'): MetodoPliegoEntrada[] {
  return criterios.map((c, i) => ({
    id: i + 1, nombreMetodo: c.nombre, tipoFormula: c.metodoNombre ?? 'desconocida',
    rangoTrmDesde: c.rangoTrmDesde, rangoTrmHasta: c.rangoTrmHasta,
    puntajeMaximo: c.puntajeMaximo ?? 40, estadoRevision: 'aprobado', aprobado: true,
    formulaTexto: c.formulaReferenciaTexto, textoFuente: c.textoFuente,
    formulaKeyMotor: equivalencia === 'CONFIRMADA' ? 'media_aritmetica' : null,
    equivalenciaMotorEstado: equivalencia === 'CONFIRMADA' ? 'EQUIVALENTE_CONFIRMADA' : 'NO_EVALUADA',
  }));
}

describe('NEGATIVO — TRM mencionada pero NO gobierna la evaluación económica', () => {
  it('conversión de moneda: no crea criterios, no se aprueba nada', () => {
    const salida = {
      trmGobiernaEvaluacionEconomica: { valor: false, relacionTrmCriterio: null, textoFuente: 'El valor del contrato se ajustará mensualmente según la TRM certificada por la Superfinanciera para efectos de conversión USD/COP.', paginaReferencia: 12 },
      reglaTrm: { eventoBaseTrm: 'NO_ENCONTRADO' }, reglaCentavos: { regla: 'NO_DEFINIDA' },
      criteriosEconomicos: [],
      advertencias: [{ tipo: 'dato faltante', descripcion: 'TRM solo usada para conversión de moneda; no gobierna el factor económico', paginas: [12] }],
    };
    const ex = ExtraccionEconomicaSchema.parse(salida);
    expect(ex.trmGobiernaEvaluacionEconomica.valor).toBe(false);
    expect(ex.criteriosEconomicos).toHaveLength(0);
    // el backend (route) NO llamaría a crearCandidataRegla/crearConjuntoCandidato en este caso
  });
});

describe('POSITIVO 1 — 00–33 / 34–66 / 67–99', () => {
  it('parsea y el gate confirma cobertura completa', () => {
    const ex = ExtraccionEconomicaSchema.parse({
      trmGobiernaEvaluacionEconomica: { valor: true },
      reglaTrm: { eventoBaseTrm: 'fecha cierre', offsetDiasHabiles: 1, politicaActualizacionFecha: 'sigue cronograma' },
      reglaCentavos: { regla: 'redondeo' },
      criteriosEconomicos: [
        { nombre: 'Media aritmética', rangoTrmDesde: 0, rangoTrmHasta: 33, metodoNombre: 'media_aritmetica', puntajeMaximo: 40 },
        { nombre: 'Media aritmética alta', rangoTrmDesde: 34, rangoTrmHasta: 66, metodoNombre: 'media_aritmetica_alta', puntajeMaximo: 40 },
        { nombre: 'Media geométrica c/presupuesto', rangoTrmDesde: 67, rangoTrmHasta: 99, metodoNombre: 'media_geometrica_con_presupuesto', puntajeMaximo: 40 },
      ],
    });
    const r = resolverCriteriosPliego(comoMetodosAprobados(ex.criteriosEconomicos));
    expect(r.ok).toBe(true);
  });
});

describe('POSITIVO 2 — cuatro rangos de 25 centavos', () => {
  it('00-24 / 25-49 / 50-74 / 75-99', () => {
    const ex = ExtraccionEconomicaSchema.parse({
      trmGobiernaEvaluacionEconomica: { valor: true },
      reglaTrm: { eventoBaseTrm: 'fecha cierre' }, reglaCentavos: { regla: 'truncado' },
      criteriosEconomicos: [0, 25, 50, 75].map((d, i) => ({ nombre: `Criterio ${i + 1}`, rangoTrmDesde: d, rangoTrmHasta: d + 24, metodoNombre: 'media_aritmetica', puntajeMaximo: 40 })),
    });
    expect(ex.criteriosEconomicos).toHaveLength(4);
    const r = resolverCriteriosPliego(comoMetodosAprobados(ex.criteriosEconomicos));
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.values(r.probabilidadEstructural).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});

describe('POSITIVO 3 — segundo día hábil después de traslado del informe de evaluación', () => {
  it('CASO B de la regla temporal', () => {
    const ex = ExtraccionEconomicaSchema.parse({
      trmGobiernaEvaluacionEconomica: { valor: true },
      reglaTrm: {
        eventoBaseTrm: 'fin traslado informe evaluacion', fuenteEventoBase: 'acta de traslado del informe de evaluación',
        offsetDiasHabiles: 2, politicaActualizacionFecha: 'sigue cronograma',
        textoReglaTrm: 'la TRM del segundo día hábil siguiente a la finalización del traslado del informe de evaluación',
      },
      reglaCentavos: { regla: 'redondeo' }, criteriosEconomicos: [],
    });
    const rtn = reglaTrmExtraidaANegocio(ex.reglaTrm);
    expect(rtn.eventoBaseTrm).toBe('FIN_TRASLADO_INFORME_EVALUACION');
    expect(rtn.offsetDiasHabiles).toBe(2);
    const crono: CronogramaVigente = { fechaEventoBase: '2026-03-12', eventoCronogramaRef: null, cronogramaSnapshot: null, cronogramaHash: 'h' };
    const res = resolverFechaTrmAplicable({ tipoReglaTrm: rtn.tipoReglaTrm as never, eventoBaseTrm: rtn.eventoBaseTrm as never, fuenteEventoBase: rtn.fuenteEventoBase, offsetDiasHabiles: rtn.offsetDiasHabiles, politicaActualizacionFecha: rtn.politicaActualizacionFecha as never, fechaBaseCongelada: rtn.fechaBaseCongelada, fechaFijaTrm: rtn.fechaFijaTrm, calendarioHabil: 'test', zonaHoraria: null }, crono, calHabil);
    expect(res.fechaTrmAplicableResuelta).toBe('2026-03-16'); // jueves +2 hábil = lunes (13,16)
  });
});

describe('POSITIVO 4 — audiencia de adjudicación con fecha inicial CONGELADA', () => {
  it('CASO C: la política CONGELADA_INICIAL se extrae y se respeta al resolver', () => {
    const ex = ExtraccionEconomicaSchema.parse({
      trmGobiernaEvaluacionEconomica: { valor: true },
      reglaTrm: {
        eventoBaseTrm: 'audiencia adjudicacion', fuenteEventoBase: 'resolución de apertura',
        offsetDiasHabiles: 0, politicaActualizacionFecha: 'congelada inicial', fechaBaseCongelada: '2026-04-10',
        textoReglaTrm: 'se tomará la TRM del día previsto para la audiencia de adjudicación según la resolución de apertura, sin perjuicio de que el cronograma se modifique posteriormente',
      },
      reglaCentavos: { regla: 'redondeo' }, criteriosEconomicos: [],
    });
    expect(ex.reglaTrm.politicaActualizacionFecha).toBe('CONGELADA_INICIAL');
    const rtn = reglaTrmExtraidaANegocio(ex.reglaTrm);
    const cronogramaYaCambiado: CronogramaVigente = { fechaEventoBase: '2026-06-01', eventoCronogramaRef: null, cronogramaSnapshot: null, cronogramaHash: 'h' };
    const res = resolverFechaTrmAplicable({ tipoReglaTrm: rtn.tipoReglaTrm as never, eventoBaseTrm: rtn.eventoBaseTrm as never, fuenteEventoBase: rtn.fuenteEventoBase, offsetDiasHabiles: rtn.offsetDiasHabiles, politicaActualizacionFecha: rtn.politicaActualizacionFecha as never, fechaBaseCongelada: rtn.fechaBaseCongelada, fechaFijaTrm: rtn.fechaFijaTrm, calendarioHabil: 'test', zonaHoraria: null }, cronogramaYaCambiado, calHabil);
    expect(res.fechaTrmAplicableResuelta).toBe('2026-04-10'); // NO usa 2026-06-01
  });
});

describe('POSITIVO 5 — criterio aplicado solo a un componente económico parcial', () => {
  it('baseEconomicaEvaluada = COMPONENTE_ESPECIFICO, sin inferir el valor', () => {
    const ex = ExtraccionEconomicaSchema.parse({
      trmGobiernaEvaluacionEconomica: { valor: true },
      reglaTrm: { eventoBaseTrm: 'fecha cierre' }, reglaCentavos: { regla: 'redondeo' },
      criteriosEconomicos: [{
        nombre: 'Media aritmética', rangoTrmDesde: 0, rangoTrmHasta: 99, metodoNombre: 'media_aritmetica', puntajeMaximo: 40,
        baseEconomicaEvaluada: 'componente especifico',
        descripcionBaseEconomica: 'Solo el valor ofertado para medios tecnológicos NO regulados. Excluye el componente de vigilancia regulada.',
        baseEconomicaTextoFuente: 'Anexo 3, numeral 2.1', baseEconomicaPaginaReferencia: 44,
      }],
    });
    const c = ex.criteriosEconomicos[0];
    expect(c.baseEconomicaEvaluada).toBe('COMPONENTE_ESPECIFICO');
    expect(c.descripcionBaseEconomica).toMatch(/medios tecnológicos/);
    // NO existe ningún campo de "valor" inferido — solo la descripción textual.
    expect('valorComponente' in c).toBe(false);
  });
});

describe('POSITIVO 6 — mismo nombre de método, distinta regla de puntuación', () => {
  it('dos pliegos con "Media Aritmética Alta" pero reglaPuntuacionTexto distinto → NO se asume equivalencia', () => {
    const pliegoA = ExtraccionEconomicaSchema.parse({
      trmGobiernaEvaluacionEconomica: { valor: true }, reglaTrm: { eventoBaseTrm: 'fecha cierre' }, reglaCentavos: { regla: 'redondeo' },
      criteriosEconomicos: [{ nombre: 'Media Aritmética Alta', rangoTrmDesde: 0, rangoTrmHasta: 99, metodoNombre: 'media_aritmetica_alta', reglaPuntuacionTexto: 'penaliza 2x a los que ofertan por encima de XA', puntajeMaximo: 40 }],
    });
    const pliegoB = ExtraccionEconomicaSchema.parse({
      trmGobiernaEvaluacionEconomica: { valor: true }, reglaTrm: { eventoBaseTrm: 'fecha cierre' }, reglaCentavos: { regla: 'redondeo' },
      criteriosEconomicos: [{ nombre: 'Media Aritmética Alta', rangoTrmDesde: 0, rangoTrmHasta: 99, metodoNombre: 'media_aritmetica_alta', reglaPuntuacionTexto: 'descalifica ofertas que superen XA en más de 10%', puntajeMaximo: 50 }],
    });
    expect(pliegoA.criteriosEconomicos[0].reglaPuntuacionTexto).not.toBe(pliegoB.criteriosEconomicos[0].reglaPuntuacionTexto);
    // el gate exige EQUIVALENTE_CONFIRMADA por separado para cada uno — nunca por el nombre
    const rSinEvaluar = resolverCriteriosPliego(comoMetodosAprobados(pliegoA.criteriosEconomicos, 'NO_EVALUADA'));
    expect(rSinEvaluar.ok).toBe(false);
  });
});

describe('POSITIVO 7 — inconsistencia de puntaje máximo (tabla vs fórmula)', () => {
  it('se registra como advertencia, Gemini NO decide cuál es correcto', () => {
    const ex = ExtraccionEconomicaSchema.parse({
      trmGobiernaEvaluacionEconomica: { valor: true },
      reglaTrm: { eventoBaseTrm: 'fecha cierre' }, reglaCentavos: { regla: 'redondeo' },
      criteriosEconomicos: [{ nombre: 'Media geométrica', rangoTrmDesde: 0, rangoTrmHasta: 99, metodoNombre: 'media_geometrica', puntajeMaximo: 55.5 }],
      advertencias: [{
        tipo: 'inconsistencia documental',
        descripcion: 'La tabla resumen del numeral 4.1 indica puntaje máximo 55,5, pero la fórmula detallada del numeral 4.3 usa 53,5 como PM.',
        paginas: [30, 33], fuentes: ['tabla resumen numeral 4.1', 'fórmula detallada numeral 4.3'],
      }],
    });
    expect(ex.advertencias[0].tipo).toBe('INCONSISTENCIA_DOCUMENTAL');
    expect(ex.advertencias[0].paginas).toEqual([30, 33]);
    // el criterio queda con el valor de UNA fuente (55.5); la advertencia es la que fuerza revisión humana
    expect(ex.criteriosEconomicos[0].puntajeMaximo).toBe(55.5);
  });
});
