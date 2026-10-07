import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, puedeVerConsolidadoSimulaciones, normalizarEmpresa } from '@/lib/authz';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ── GET /api/ponderacion/metodos ──────────────────────────────────────────────
// Lista métodos extraídos para un proceso, filtrados por permisos de empresa.
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const procesoId       = sp.get('procesoId')     ? Number(sp.get('procesoId'))     : undefined;
  const codigoProceso   = sp.get('codigoProceso') ?? undefined;
  const estadoRevision  = sp.get('estadoRevision') ?? undefined;

  if (!procesoId && !codigoProceso) {
    return NextResponse.json(
      { ok: false, error: 'Se requiere procesoId o codigoProceso' },
      { status: 422 },
    );
  }

  const consolidado = await puedeVerConsolidadoSimulaciones(session!);
  const userDb = await prisma.user.findUnique({
    where: { id: session!.id },
    select: { entidadGrupo: true },
  });
  const empresaUsuario = normalizarEmpresa(userDb?.entidadGrupo);

  const where: Record<string, unknown> = {};
  if (procesoId)      where.procesoId     = procesoId;
  if (codigoProceso)  where.codigoProceso = codigoProceso;
  if (estadoRevision) where.estadoRevision = estadoRevision;

  // Aislamiento por empresa (mismo patrón Fase 2B.2)
  if (!consolidado) {
    where.OR = empresaUsuario
      ? [
          { empresaGrupo: { equals: empresaUsuario, mode: 'insensitive' } },
          { razonSocial:  { equals: empresaUsuario, mode: 'insensitive' } },
        ]
      : [{ id: -1 }]; // sin empresa → sin acceso a registros ajenos
  }

  const metodos = await prisma.metodoPonderacionProceso.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      procesoId: true,
      codigoProceso: true,
      lecturaAnalisisId: true,
      razonSocial: true,
      empresaGrupo: true,
      presupuestoOficial: true,
      puntajeMaximo: true,
      nombreMetodo: true,
      tipoFormula: true,
      rangoTrmDesde: true,
      rangoTrmHasta: true,
      formulaTexto: true,
      notasFormula: true,
      paginaReferencia: true,
      seccionReferencia: true,
      textoFuente: true,
      confianzaExtraccion: true,
      fuenteExtraccion: true,
      estadoRevision: true,
      aprobado: true,
      advertencias: true,
      revisadoEn: true,
      createdAt: true,
      revisadoPor: { select: { id: true, usuario: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    total: metodos.length,
    metodos: metodos.map(m => ({
      ...m,
      presupuestoOficial: m.presupuestoOficial != null ? Number(m.presupuestoOficial) : null,
      puntajeMaximo: m.puntajeMaximo != null ? Number(m.puntajeMaximo) : null,
      confianzaExtraccion: m.confianzaExtraccion != null ? Number(m.confianzaExtraccion) : null,
    })),
  });
}