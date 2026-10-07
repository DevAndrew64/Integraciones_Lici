import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, puedeVerConsolidadoSimulaciones, canAccessSimulacionPonderacion } from '@/lib/authz';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ESTADOS_VALIDOS = ['borrador', 'guardada', 'revisada', 'archivada'] as const;

// ─── GET /api/simulaciones/ponderacion/[id] ───────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!id || isNaN(id))
    return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 });

  const sim = await prisma.simulacionPonderacion.findUnique({
    where: { id },
    include: {
      competidores: {
        orderBy: { porcentajeOferta: 'asc' },
      },
      resultados: {
        orderBy: { metodo: 'asc' },
      },
      creadoPor: {
        select: { id: true, usuario: true, entidadGrupo: true },
      },
    },
  });

  if (!sim)
    return NextResponse.json({ ok: false, error: 'Simulación no encontrada' }, { status: 404 });

  // ── Permisos: ownership / empresa / consolidado (Fase 2B.2 — anti-IDOR) ───
  const consolidado = await puedeVerConsolidadoSimulaciones(session!);
  const userDb = await prisma.user.findUnique({
    where: { id: session!.id },
    select: { entidadGrupo: true },
  });
  const autorizado = canAccessSimulacionPonderacion(
    session!,
    { creadoPorId: sim.creadoPorId, empresaGrupo: sim.empresaGrupo, razonSocial: sim.razonSocial },
    userDb?.entidadGrupo ?? null,
    consolidado,
  );
  if (!autorizado)
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });

  return NextResponse.json({
    ok: true,
    simulacion: {
      ...sim,
      presupuestoOficial: Number(sim.presupuestoOficial),
      trmValor: Number(sim.trmValor),
      trmFecha: sim.trmFecha.toISOString().slice(0, 10),
      puntajeMaximo: Number(sim.puntajeMaximo),
      miOfertaPorcentaje: sim.miOfertaPorcentaje != null ? Number(sim.miOfertaPorcentaje) : null,
      miOfertaValor: sim.miOfertaValor != null ? Number(sim.miOfertaValor) : null,
      competidores: sim.competidores.map(c => ({
        ...c,
        porcentajeOferta: Number(c.porcentajeOferta),
        valorOferta: c.valorOferta != null ? Number(c.valorOferta) : null,
        probabilidadParticipacion:
          c.probabilidadParticipacion != null ? Number(c.probabilidadParticipacion) : null,
      })),
      resultados: sim.resultados.map(r => ({
        ...r,
        porcentajeOptimo: Number(r.porcentajeOptimo),
        valorOptimo: Number(r.valorOptimo),
        puntajeOptimo: Number(r.puntajeOptimo),
        miOfertaPorcentaje: r.miOfertaPorcentaje != null ? Number(r.miOfertaPorcentaje) : null,
        miOfertaPuntaje: r.miOfertaPuntaje != null ? Number(r.miOfertaPuntaje) : null,
        diferenciaPuntos: r.diferenciaPuntos != null ? Number(r.diferenciaPuntos) : null,
      })),
    },
  });
}

// ─── PATCH /api/simulaciones/ponderacion/[id] ─────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!id || isNaN(id))
    return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 });

  let body: { estado?: string; notas?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  // Solo se permite actualizar estado y notas — sin borrado físico
  const data: { estado?: string; notas?: string } = {};

  if (body.estado !== undefined) {
    if (!(ESTADOS_VALIDOS as readonly string[]).includes(body.estado))
      return NextResponse.json(
        { ok: false, error: `Estado inválido. Válidos: ${ESTADOS_VALIDOS.join(', ')}` },
        { status: 422 },
      );
    data.estado = body.estado;
  }

  if (body.notas !== undefined) {
    data.notas = body.notas;
  }

  if (Object.keys(data).length === 0)
    return NextResponse.json(
      { ok: false, error: 'Nada que actualizar. Solo se permiten campos: estado, notas' },
      { status: 422 },
    );

  const existing = await prisma.simulacionPonderacion.findUnique({
    where: { id },
    select: { id: true, estado: true, creadoPorId: true, empresaGrupo: true, razonSocial: true },
  });

  if (!existing)
    return NextResponse.json({ ok: false, error: 'Simulación no encontrada' }, { status: 404 });

  // ── Permisos: ownership / empresa / consolidado (Fase 2B.2 — anti-IDOR) ───
  const consolidado = await puedeVerConsolidadoSimulaciones(session!);
  const userDb = await prisma.user.findUnique({
    where: { id: session!.id },
    select: { entidadGrupo: true },
  });
  const autorizado = canAccessSimulacionPonderacion(
    session!,
    { creadoPorId: existing.creadoPorId, empresaGrupo: existing.empresaGrupo, razonSocial: existing.razonSocial },
    userDb?.entidadGrupo ?? null,
    consolidado,
  );
  if (!autorizado)
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });

  if (existing.estado === 'archivada' && data.estado && data.estado !== 'archivada')
    return NextResponse.json(
      { ok: false, error: 'Una simulación archivada no puede cambiar de estado' },
      { status: 409 },
    );

  const updated = await prisma.simulacionPonderacion.update({
    where: { id },
    data,
    select: { id: true, estado: true, notas: true, updatedAt: true },
  });

  return NextResponse.json({ ok: true, simulacion: updated });
}