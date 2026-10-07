import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  ExtraccionPonderacionSchema,
  normalizarEstructuraGemini,
} from './extraccionSchema';

interface OpcionesNormalizacion {
  procesoId?: number | null;
  codigoProceso?: string | null;
  lecturaAnalisisId?: number | null;
  razonSocial?: string | null;
  empresaGrupo?: string | null;
  fuenteExtraccion?: string;
}

interface ResultadoNormalizacion {
  ok: boolean;
  metodosCreados: number;
  advertencias: string[];
  presupuestoOficial: number | null;
  puntajeMaximoEconomico: number | null;
  error?: string;
}

/**
 * Toma el campo `ponderacion_economica` del JSON de LecturaAnalisis,
 * lo normaliza con el schema Zod y persiste registros MetodoPonderacionProceso.
 * Todos los registros quedan con estadoRevision = 'pendiente_revision'.
 *
 * Si ya existen métodos pendientes_revision para el mismo lecturaAnalisisId,
 * los elimina antes de recriar (idempotente).
 */
export async function normalizarPonderacionEconomicaDesdeLecturaAnalisis(
  ponderacionRaw: unknown,
  opts: OpcionesNormalizacion,
): Promise<ResultadoNormalizacion> {
  const { procesoId, codigoProceso, lecturaAnalisisId, razonSocial, empresaGrupo } = opts;
  const fuenteExtraccion = opts.fuenteExtraccion ?? 'lectura_analisis';

  // Normalizar variaciones de campo del JSON de Gemini
  const normalizado = normalizarEstructuraGemini(ponderacionRaw);

  // Validar con Zod
  const parsed = ExtraccionPonderacionSchema.safeParse(normalizado);
  if (!parsed.success) {
    return {
      ok: false,
      metodosCreados: 0,
      advertencias: [],
      presupuestoOficial: null,
      puntajeMaximoEconomico: null,
      error: `Schema inválido: ${parsed.error.issues.map(i => i.message).join('; ')}`,
    };
  }

  const data = parsed.data;
  const advertenciasGlobales: string[] = [...(data.advertenciasGenerales ?? [])];

  // Si no hay métodos, retornar sin crear registros
  if (data.metodos.length === 0) {
    return {
      ok: true,
      metodosCreados: 0,
      advertencias: ['No se encontraron métodos de ponderación económica en el análisis.'],
      presupuestoOficial: data.presupuestoOficial ?? null,
      puntajeMaximoEconomico: data.puntajeMaximoEconomico ?? null,
    };
  }

  // Eliminar métodos pendientes anteriores para la misma fuente (idempotencia)
  if (lecturaAnalisisId) {
    await prisma.metodoPonderacionProceso.deleteMany({
      where: {
        lecturaAnalisisId,
        estadoRevision: 'pendiente_revision',
        fuenteExtraccion,
      },
    });
  }

  const presupuesto = data.presupuestoOficial ?? null;
  const puntajeMaxGlobal = data.puntajeMaximoEconomico ?? null;

  const registros = data.metodos.map(m => {
    const advMetodo = m.advertencias ?? [];
    advertenciasGlobales.push(...advMetodo);

    return {
      procesoId: procesoId ?? null,
      codigoProceso: codigoProceso ?? null,
      lecturaAnalisisId: lecturaAnalisisId ?? null,
      razonSocial: razonSocial ?? null,
      empresaGrupo: empresaGrupo ?? null,
      presupuestoOficial: presupuesto != null ? presupuesto : null,
      puntajeMaximo:
        m.puntajeMaximo != null
          ? m.puntajeMaximo
          : puntajeMaxGlobal != null
          ? puntajeMaxGlobal
          : null,
      nombreMetodo: m.nombreMetodo,
      tipoFormula: m.tipoFormula,
      rangoTrmDesde: m.rangoTrmDesde ?? null,
      rangoTrmHasta: m.rangoTrmHasta ?? null,
      formulaTexto: m.formulaTexto ?? null,
      notasFormula: m.notasFormula ?? null,
      paginaReferencia: m.paginaReferencia ?? null,
      seccionReferencia: m.seccionReferencia ?? null,
      textoFuente: m.textoFuente ?? null,
      confianzaExtraccion: m.confianzaExtraccion ?? null,
      fuenteExtraccion,
      estadoRevision: 'pendiente_revision' as const,
      aprobado: false,
      advertencias: advMetodo.length > 0 ? (advMetodo as Prisma.InputJsonValue) : Prisma.JsonNull,
    };
  });

  await prisma.metodoPonderacionProceso.createMany({ data: registros });

  return {
    ok: true,
    metodosCreados: registros.length,
    advertencias: advertenciasGlobales,
    presupuestoOficial: presupuesto,
    puntajeMaximoEconomico: puntajeMaxGlobal,
  };
}