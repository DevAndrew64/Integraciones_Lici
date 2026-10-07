import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, puedeVerConsolidadoSimulaciones, normalizarEmpresa } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { simularPonderacion } from '@/lib/ponderacion-economica/simulador';
import { FORMULA_KEYS } from '@/lib/ponderacion-economica';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ─── Validación de entrada ────────────────────────────────────────────────────

interface CompetidorInput {
  nombre?: string;
  porcentajeOferta: number;
  fuente?: string;
}

interface PostBody {
  presupuestoOficial: number;
  trmValor: number;
  trmFecha: string;
  trmCentavos: number;
  trmFuente: string;
  metodoActivo: string;
  puntajeMaximo: number;
  miOfertaPorcentaje?: number | null;
  competidores?: CompetidorInput[];
  razonSocial?: string;
  empresaGrupo?: string;
  procesoId?: number | null;
  numeroProceso?: string | null;
  nombre?: string | null;
  notas?: string | null;
}

function validar(body: PostBody): string | null {
  if (!body.presupuestoOficial || body.presupuestoOficial <= 0)
    return 'presupuestoOficial debe ser mayor a 0';
  if (!body.puntajeMaximo || body.puntajeMaximo <= 0)
    return 'puntajeMaximo debe ser mayor a 0';
  if (!body.trmValor || body.trmValor <= 0)
    return 'trmValor debe ser mayor a 0';
  if (body.trmCentavos == null || body.trmCentavos < 0 || body.trmCentavos > 99)
    return 'trmCentavos debe estar entre 0 y 99';
  if (!body.metodoActivo || !(FORMULA_KEYS as readonly string[]).includes(body.metodoActivo))
    return `metodoActivo inválido: "${body.metodoActivo}". Válidos: ${FORMULA_KEYS.join(', ')}`;
  if (!body.trmFuente)
    return 'trmFuente es requerida';
  if (!body.trmFecha || !/^\d{4}-\d{2}-\d{2}$/.test(body.trmFecha))
    return 'trmFecha debe tener formato YYYY-MM-DD';
  if (body.miOfertaPorcentaje != null) {
    if (body.miOfertaPorcentaje < 0 || body.miOfertaPorcentaje > 100)
      return 'miOfertaPorcentaje debe estar entre 0 y 100';
  }
  for (const c of body.competidores ?? []) {
    if (c.porcentajeOferta < 0 || c.porcentajeOferta > 100)
      return `Competidor con porcentajeOferta fuera de rango (${c.porcentajeOferta}). Debe estar entre 0 y 100`;
  }
  return null;
}

// ─── POST /api/simulaciones/ponderacion ──────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  const errorValidacion = validar(body);
  if (errorValidacion)
    return NextResponse.json({ ok: false, error: errorValidacion }, { status: 422 });

  // Obtener entidadGrupo del usuario desde la BD (fuente autoritativa)
  const userDb = await prisma.user.findUnique({
    where: { id: session!.id },
    select: { id: true, entidadGrupo: true },
  });

  const empresaGrupo = body.empresaGrupo ?? userDb?.entidadGrupo ?? null;
  const razonSocial = body.razonSocial ?? empresaGrupo;

  // ── Recalcular en backend ─────────────────────────────────────────────────
  const competidoresPct = (body.competidores ?? []).map(c => c.porcentajeOferta);
  const output = simularPonderacion({
    presupuesto: body.presupuestoOficial,
    puntajeMaximo: body.puntajeMaximo,
    competidoresPct,
    miOfertaPct: body.miOfertaPorcentaje ?? undefined,
    trmValor: body.trmValor,
  });

  // ── Buscar TrmCache relacionado ───────────────────────────────────────────
  let trmCacheId: number | null = null;
  try {
    const cached = await prisma.trmCache.findFirst({
      where: {
        fuente: body.trmFuente === 'cache' ? 'datos_gov_co' : body.trmFuente,
      },
      orderBy: { fecha: 'desc' },
      select: { id: true },
    });
    trmCacheId = cached?.id ?? null;
  } catch {
    // No crítico — continuar sin el vínculo
  }

  // ── Guardar simulación y sus relaciones ───────────────────────────────────
  const sim = await prisma.simulacionPonderacion.create({
    data: {
      procesoId: body.procesoId ?? null,
      solicitudId: null,
      numeroProceso: body.numeroProceso ?? null,
      razonSocial,
      empresaGrupo,
      nombre: body.nombre ?? null,
      presupuestoOficial: body.presupuestoOficial,
      trmValor: body.trmValor,
      trmFecha: new Date(body.trmFecha + 'T00:00:00.000Z'),
      trmCentavos: body.trmCentavos,
      trmFuente: body.trmFuente,
      trmCacheId,
      metodoActivo: body.metodoActivo,
      puntajeMaximo: body.puntajeMaximo,
      miOfertaPorcentaje: body.miOfertaPorcentaje ?? null,
      miOfertaValor:
        body.miOfertaPorcentaje != null
          ? (body.miOfertaPorcentaje / 100) * body.presupuestoOficial
          : null,
      creadoPorId: session!.id,
      estado: (body.competidores ?? []).length === 0 ? 'borrador' : 'guardada',
      notas: body.notas ?? null,
    },
  });

  // Competidores
  if ((body.competidores ?? []).length > 0) {
    await prisma.simulacionCompetidor.createMany({
      data: (body.competidores!).map(c => ({
        simulacionId: sim.id,
        nombre: c.nombre ?? null,
        porcentajeOferta: c.porcentajeOferta,
        valorOferta: (c.porcentajeOferta / 100) * body.presupuestoOficial,
        fuente: c.fuente ?? 'manual',
      })),
    });
  }

  // Resultados por método (recalculados en backend)
  await prisma.simulacionResultadoMetodo.createMany({
    data: output.resultados.map(r => ({
      simulacionId: sim.id,
      metodo: r.formula,
      porcentajeOptimo: r.ofertaOptima.pct,
      valorOptimo: (r.ofertaOptima.pct / 100) * body.presupuestoOficial,
      puntajeOptimo: r.ofertaOptima.puntaje,
      miOfertaPorcentaje: body.miOfertaPorcentaje ?? null,
      miOfertaPuntaje: r.miPuntaje,
      diferenciaPuntos:
        r.miPuntaje != null
          ? Math.round((r.ofertaOptima.puntaje - r.miPuntaje) * 10000) / 10000
          : null,
      esMetodoActivo: r.formula === body.metodoActivo,
    })),
  });

  const resultadoActivo = output.resultados.find(r => r.formula === body.metodoActivo);
  const sinCompetidores = (body.competidores ?? []).length === 0;

  return NextResponse.json({
    ok: true,
    simulacionId: sim.id,
    mensaje: sinCompetidores
      ? 'Simulación guardada sin competidores. No permite análisis competitivo completo.'
      : 'Simulación guardada correctamente',
    advertencia: sinCompetidores
      ? 'Sin competidores — guardada como borrador.'
      : undefined,
    resumen: {
      metodoActivo: body.metodoActivo,
      trmValor: body.trmValor,
      trmCentavos: body.trmCentavos,
      competidores: (body.competidores ?? []).length,
      resultadoMetodoActivo: resultadoActivo
        ? {
            porcentajeOptimo: resultadoActivo.ofertaOptima.pct,
            puntajeOptimo: resultadoActivo.ofertaOptima.puntaje,
            miPuntaje: resultadoActivo.miPuntaje,
          }
        : null,
    },
  });
}

// ─── GET /api/simulaciones/ponderacion ───────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const procesoId       = sp.get('procesoId')     ? Number(sp.get('procesoId'))   : undefined;
  const numeroProceso   = sp.get('numeroProceso') ?? undefined;
  const razonSocial     = sp.get('razonSocial')   ?? undefined;
  const empresaGrupo    = sp.get('empresaGrupo')  ?? undefined;
  const estado          = sp.get('estado')         ?? undefined;
  const fechaDesde      = sp.get('fechaDesde')     ?? undefined;
  const fechaHasta      = sp.get('fechaHasta')     ?? undefined;
  const includeArchived = sp.get('includeArchived') === 'true';
  const page            = Math.max(1, Number(sp.get('page') ?? '1'));
  const limit           = Math.min(50, Math.max(1, Number(sp.get('limit') ?? '20')));

  // ── Permisos: scope por usuario/empresa (Fase 2B.2) ───────────────────────
  const consolidado = await puedeVerConsolidadoSimulaciones(session!);
  const userDb = await prisma.user.findUnique({
    where: { id: session!.id },
    select: { entidadGrupo: true },
  });
  const empresaUsuario = normalizarEmpresa(userDb?.entidadGrupo);

  const where: Record<string, unknown> = {};
  if (procesoId)     where.procesoId     = procesoId;
  if (numeroProceso) where.numeroProceso = { contains: numeroProceso, mode: 'insensitive' };
  if (razonSocial)   where.razonSocial   = { equals: razonSocial, mode: 'insensitive' };
  if (empresaGrupo)  where.empresaGrupo  = { equals: empresaGrupo, mode: 'insensitive' };
  if (fechaDesde || fechaHasta) {
    where.createdAt = {};
    if (fechaDesde) (where.createdAt as Record<string,unknown>).gte = new Date(fechaDesde + 'T00:00:00.000Z');
    if (fechaHasta) (where.createdAt as Record<string,unknown>).lte = new Date(fechaHasta + 'T23:59:59.999Z');
  }

  // Archivadas excluidas por defecto, salvo filtro explícito estado=archivada o includeArchived=true
  if (estado) {
    where.estado = estado;
  } else if (!includeArchived) {
    where.estado = { not: 'archivada' };
  }

  // Si no tiene acceso consolidado: restringir a lo propio + su empresa (AND con los filtros de arriba)
  if (!consolidado) {
    where.OR = empresaUsuario
      ? [
          { creadoPorId: session!.id },
          { empresaGrupo: { equals: empresaUsuario, mode: 'insensitive' } },
          { razonSocial: { equals: empresaUsuario, mode: 'insensitive' } },
        ]
      : [{ creadoPorId: session!.id }];
  }

  const [total, sims] = await Promise.all([
    prisma.simulacionPonderacion.count({ where }),
    prisma.simulacionPonderacion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        nombre: true,
        razonSocial: true,
        empresaGrupo: true,
        numeroProceso: true,
        presupuestoOficial: true,
        trmValor: true,
        trmCentavos: true,
        trmFuente: true,
        metodoActivo: true,
        puntajeMaximo: true,
        miOfertaPorcentaje: true,
        estado: true,
        createdAt: true,
        updatedAt: true,
        resultados: {
          where: { esMetodoActivo: true },
          select: { porcentajeOptimo: true, puntajeOptimo: true, miOfertaPuntaje: true },
          take: 1,
        },
        _count: { select: { competidores: true } },
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    total,
    page,
    limit,
    simulaciones: sims.map(s => ({
      ...s,
      presupuestoOficial: Number(s.presupuestoOficial),
      trmValor: Number(s.trmValor),
      puntajeMaximo: Number(s.puntajeMaximo),
      miOfertaPorcentaje: s.miOfertaPorcentaje != null ? Number(s.miOfertaPorcentaje) : null,
      resultadoActivo: s.resultados[0]
        ? {
            porcentajeOptimo: Number(s.resultados[0].porcentajeOptimo),
            puntajeOptimo: Number(s.resultados[0].puntajeOptimo),
            miOfertaPuntaje:
              s.resultados[0].miOfertaPuntaje != null
                ? Number(s.resultados[0].miOfertaPuntaje)
                : null,
          }
        : null,
      cantidadCompetidores: s._count.competidores,
      resultados: undefined,
      _count: undefined,
    })),
  });
}