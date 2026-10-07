import { z } from 'zod';

export const TIPOS_FORMULA_VALIDOS = [
  'mediana',
  'media_geometrica',
  'media_geometrica_presupuesto',
  'media_aritmetica',
  'media_aritmetica_baja',
  'media_aritmetica_alta',
  'menor_valor',
  'desconocida',
  'personalizada',
] as const;

export type TipoFormulaExtraccion = (typeof TIPOS_FORMULA_VALIDOS)[number];

export const ESTADOS_REVISION = [
  'pendiente_revision',
  'revisado',
  'aprobado',
  'descartado',
] as const;

const MetodoExtraidoSchema = z.object({
  nombreMetodo: z.string().min(1, 'nombreMetodo requerido'),
  tipoFormula: z
    .string()
    .transform(v => {
      const lower = v.toLowerCase().trim().replace(/\s+/g, '_');
      return (TIPOS_FORMULA_VALIDOS as readonly string[]).includes(lower) ? lower : 'desconocida';
    })
    .pipe(z.enum(TIPOS_FORMULA_VALIDOS)),
  rangoTrmDesde: z
    .number()
    .int()
    .nullable()
    .optional()
    .transform(v => {
      if (v == null || v === -1) return null;
      if (v < 0 || v > 99) return null;
      return v;
    }),
  rangoTrmHasta: z
    .number()
    .int()
    .nullable()
    .optional()
    .transform(v => {
      if (v == null || v === -1) return null;
      if (v < 0 || v > 99) return null;
      return v;
    }),
  puntajeMaximo: z
    .number()
    .nullable()
    .optional()
    .transform(v => (v != null && v <= 0 ? null : v))
    .default(null),
  formulaTexto: z.string().nullable().optional().default(null),
  notasFormula: z.string().nullable().optional().default(null),
  paginaReferencia: z.number().int().positive().nullable().optional().default(null),
  seccionReferencia: z.string().nullable().optional().default(null),
  textoFuente: z.string().nullable().optional().default(null),
  confianzaExtraccion: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .optional()
    .transform(v => {
      if (v == null) return null;
      // Normaliza a 0-1 si viene como 0-100
      return v > 1 ? v / 100 : v;
    })
    .default(null),
  requiereRevision: z.boolean().optional().default(true),
  advertencias: z.array(z.string()).optional().default([]),
});

export type MetodoExtraido = z.output<typeof MetodoExtraidoSchema>;

export const ExtraccionPonderacionSchema = z
  .object({
    presupuestoOficial: z
      .number()
      .nullable()
      .optional()
      .transform(v => (v != null && v <= 0 ? null : v))
      .default(null),
    puntajeMaximoEconomico: z
      .number()
      .nullable()
      .optional()
      .transform(v => (v != null && v <= 0 ? null : v))
      .default(null),
    moneda: z.enum(['COP', 'USD', 'OTRA']).nullable().optional().default(null),
    metodos: z.array(MetodoExtraidoSchema).min(0).default([]),
    advertenciasGenerales: z.array(z.string()).optional().default([]),
    preguntasPendientes: z.array(z.string()).optional().default([]),
  })
  .superRefine((data, ctx) => {
    data.metodos.forEach((m, i) => {
      const desde = m.rangoTrmDesde ?? null;
      const hasta = m.rangoTrmHasta ?? null;
      if (desde !== null && hasta !== null && desde > hasta) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `metodos[${i}]: rangoTrmDesde (${desde}) no puede ser mayor que rangoTrmHasta (${hasta})`,
          path: ['metodos', i, 'rangoTrmDesde'],
        });
      }
    });
  });

export type ExtraccionPonderacion = z.output<typeof ExtraccionPonderacionSchema>;

/**
 * Convierte la estructura `ponderacion_economica` del JSON de LecturaAnalisis
 * al formato normalizado del schema Zod.
 * Maneja variaciones de campo usadas en el prompt actual:
 * - trm_centavos_desde / rangoTrmDesde
 * - tipo_formula / tipoFormula
 */
export function normalizarEstructuraGemini(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;

  const metodosBrutos = (Array.isArray(r.metodos) ? r.metodos : []) as Record<string, unknown>[];

  const metodos = metodosBrutos.map(m => ({
    nombreMetodo: m.nombre ?? m.nombreMetodo ?? 'Método desconocido',
    tipoFormula:
      m.tipo_formula ??
      m.tipoFormula ??
      (typeof m.nombre === 'string'
        ? mapearNombreAFormula(m.nombre as string)
        : 'desconocida'),
    rangoTrmDesde: m.trm_centavos_desde ?? m.rangoTrmDesde ?? null,
    rangoTrmHasta: m.trm_centavos_hasta ?? m.rangoTrmHasta ?? null,
    puntajeMaximo: m.puntaje ?? m.puntajeMaximo ?? null,
    formulaTexto: m.formulaTexto ?? m.formula_texto ?? null,
    notasFormula: m.notasFormula ?? m.notas_formula ?? null,
    paginaReferencia: m.paginaReferencia ?? m.pagina_referencia ?? null,
    seccionReferencia: m.seccionReferencia ?? m.seccion_referencia ?? null,
    textoFuente: m.textoFuente ?? m.texto_fuente ?? null,
    confianzaExtraccion: m.confianzaExtraccion ?? m.confianza_extraccion ?? null,
    requiereRevision: true,
    advertencias: Array.isArray(m.advertencias) ? m.advertencias : [],
  }));

  return {
    presupuestoOficial:
      r.presupuesto_oficial ?? r.presupuestoOficial ?? null,
    puntajeMaximoEconomico:
      r.puntaje_maximo ?? r.puntajeMaximoEconomico ?? null,
    moneda: r.moneda ?? null,
    metodos,
    advertenciasGenerales: Array.isArray(r.advertencias_generales)
      ? r.advertencias_generales
      : Array.isArray(r.advertenciasGenerales)
      ? r.advertenciasGenerales
      : [],
    preguntasPendientes: Array.isArray(r.preguntasPendientes)
      ? r.preguntasPendientes
      : [],
  };
}

function mapearNombreAFormula(nombre: string): string {
  const n = nombre.toLowerCase().trim();
  if (n.includes('mediana')) return 'mediana';
  if (n.includes('geométrica') || n.includes('geometrica')) {
    if (n.includes('presupuesto')) return 'media_geometrica_presupuesto';
    return 'media_geometrica';
  }
  if (n.includes('aritmética') || n.includes('aritmetica')) {
    if (n.includes('baja')) return 'media_aritmetica_baja';
    if (n.includes('alta')) return 'media_aritmetica_alta';
    return 'media_aritmetica';
  }
  if (n.includes('menor valor') || n.includes('menor_valor')) return 'menor_valor';
  return 'desconocida';
}