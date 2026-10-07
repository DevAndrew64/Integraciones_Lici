/**
 * Schema Zod REDUCIDO — extrae ÚNICAMENTE lo necesario para entender los
 * CRITERIOS DE EVALUACIÓN ECONÓMICA gobernados por la TRM. FASE A.1 §2.
 *
 * NO extrae: requisitos habilitantes, experiencia, jurídicos, técnicos,
 * garantías, personal, cronograma general, presupuesto general, AIU,
 * obligaciones. Nada que no sea el criterio económico/TRM.
 *
 * Dato ausente → null / "NO_ENCONTRADO" / "NO_DEFINIDA". Gemini nunca inventa.
 */

import { z } from 'zod';

export const VERSION_EXTRACTOR = 'schema-economico-2.0.0';

export const TIPOS_EVENTO_BASE = [
  'FECHA_CIERRE', 'FECHA_PRESENTACION_OFERTAS', 'FIN_TRASLADO_INFORME_EVALUACION',
  'AUDIENCIA_ADJUDICACION', 'OTRO', 'NO_ENCONTRADO',
] as const;
export const POLITICAS_ACTUALIZACION = ['SIGUE_CRONOGRAMA', 'CONGELADA_INICIAL', 'OTRA', 'NO_ENCONTRADO'] as const;
export const REGLAS_CENTAVOS = ['REDONDEO', 'TRUNCADO', 'OTRA', 'NO_DEFINIDA'] as const;
export const BASES_ECONOMICAS = ['TOTAL_OFERTA', 'COMPONENTE_ESPECIFICO', 'OTRA', 'NO_ENCONTRADO'] as const;
export const TIPOS_ADVERTENCIA = ['INCONSISTENCIA_DOCUMENTAL', 'AMBIGUEDAD', 'DATO_FALTANTE', 'OTRO'] as const;

const strN = z.string().nullable().optional().default(null);
const pagN = z.number().int().positive().nullable().optional().default(null);
const numPosN = z.number().finite().nullable().optional().transform(v => (v != null && v <= 0 ? null : v)).default(null);
const confN = z.number().min(0).max(100).nullable().optional().transform(v => (v == null ? null : v > 1 ? v / 100 : v)).default(null);
const enumCatch = <T extends readonly [string, ...string[]]>(vals: T, fallback: T[number]) =>
  z.string().transform(v => v.toUpperCase().trim().replace(/\s+/g, '_')).pipe(z.enum(vals)).catch(fallback);

/** ¿La TRM gobierna la evaluación económica de este proceso? (gate del flujo). */
export const TrmGobiernaEsquema = z.object({
  valor: z.boolean().nullable().optional().default(null),  // null = NO_DETERMINADO
  relacionTrmCriterio: strN,   // "la TRM (centavos) determina qué fórmula se aplica" | null
  textoFuente: strN,
  paginaReferencia: pagN,
  confianzaExtraccion: confN,
});

export const ReglaTrmExtraidaSchema = z.object({
  eventoBaseTrm: enumCatch(TIPOS_EVENTO_BASE, 'NO_ENCONTRADO'),
  fuenteEventoBase: strN,                 // "resolución de apertura" | "cronograma SECOP" | ...
  offsetDiasHabiles: z.number().int().nullable().optional().default(null),  // +1, +2 (segundo día hábil), ...
  politicaActualizacionFecha: enumCatch(POLITICAS_ACTUALIZACION, 'NO_ENCONTRADO'),
  fechaBaseCongelada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().default(null),
  fechaFijaTrm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().default(null),
  textoReglaTrm: strN,
  textoFuente: strN,
  paginaReferencia: pagN,
  confianzaExtraccion: confN,
});

export const ReglaCentavosExtraidaSchema = z.object({
  regla: enumCatch(REGLAS_CENTAVOS, 'NO_DEFINIDA'),
  textoFuente: strN,
  paginaReferencia: pagN,
  confianzaExtraccion: confN,
});

/** UN criterio económico gobernado por TRM. */
export const CriterioEconomicoSchema = z.object({
  nombre: z.string().min(1),
  // condición TRM que activa este criterio (rango 00–99 o texto):
  rangoTrmDesde: z.number().int().nullable().optional().transform(v => (v == null || v < 0 || v > 99 ? null : v)).default(null),
  rangoTrmHasta: z.number().int().nullable().optional().transform(v => (v == null || v < 0 || v > 99 ? null : v)).default(null),
  condicionTrmTexto: strN,
  // método + semántica (NO se asume equivalencia con el motor por el nombre):
  metodoNombre: strN,
  formulaReferenciaTexto: strN,   // cómo se calcula el valor de referencia
  reglaPuntuacionTexto: strN,     // cómo se asigna el puntaje (máximo y a las demás ofertas)
  puntajeMaximo: numPosN,         // SOLO si está expresamente dentro del criterio
  // §5 — sobre qué valor se aplica:
  baseEconomicaEvaluada: enumCatch(BASES_ECONOMICAS, 'NO_ENCONTRADO'),
  descripcionBaseEconomica: strN,  // qué componente si COMPONENTE_ESPECIFICO (no se infiere el valor)
  baseEconomicaTextoFuente: strN,
  baseEconomicaPaginaReferencia: pagN,
  textoFuente: strN,
  paginaReferencia: pagN,
  confianzaExtraccion: confN,
});

export const AdvertenciaSchema = z.object({
  tipo: enumCatch(TIPOS_ADVERTENCIA, 'OTRO'),
  descripcion: z.string(),
  paginas: z.array(z.number().int().positive()).default([]),
  fuentes: z.array(z.string()).default([]),
});

export const ExtraccionEconomicaSchema = z.object({
  trmGobiernaEvaluacionEconomica: TrmGobiernaEsquema,
  reglaTrm: ReglaTrmExtraidaSchema,
  reglaCentavos: ReglaCentavosExtraidaSchema,
  criteriosEconomicos: z.array(CriterioEconomicoSchema).min(0).default([]),
  advertencias: z.array(AdvertenciaSchema).default([]),
  preguntasPendientes: z.array(z.string()).default([]),
}).superRefine((data, ctx) => {
  data.criteriosEconomicos.forEach((c, i) => {
    if (c.rangoTrmDesde != null && c.rangoTrmHasta != null && c.rangoTrmDesde > c.rangoTrmHasta) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['criteriosEconomicos', i, 'rangoTrmDesde'], message: `criterio[${i}]: rangoTrmDesde > rangoTrmHasta` });
    }
  });
});

export type ExtraccionEconomica = z.output<typeof ExtraccionEconomicaSchema>;

// ─── mapeo de "NO_ENCONTRADO" a null de negocio ───
const nn = (v: string) => (v === 'NO_ENCONTRADO' || v === 'NO_DEFINIDA' ? null : v);

export function reglaTrmExtraidaANegocio(r: ExtraccionEconomica['reglaTrm']) {
  return {
    eventoBaseTrm: nn(r.eventoBaseTrm),
    fuenteEventoBase: r.fuenteEventoBase,
    offsetDiasHabiles: r.offsetDiasHabiles,
    politicaActualizacionFecha: nn(r.politicaActualizacionFecha),
    fechaBaseCongelada: r.fechaBaseCongelada,
    fechaFijaTrm: r.fechaFijaTrm,
    // clasificador grueso derivado:
    tipoReglaTrm: r.fechaFijaTrm ? 'FECHA_FIJA' : (nn(r.eventoBaseTrm) ? 'RELATIVA_A_EVENTO' : 'OTRA'),
  };
}
