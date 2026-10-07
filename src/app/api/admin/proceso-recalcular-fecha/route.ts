import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { detectarFechaPresentacionOfertas, parseFechaCronograma } from '@/lib/procesos/fechas-cronograma';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;

  const { codigoProceso, procesoId } = await req.json().catch(() => ({})) as { codigoProceso?: string; procesoId?: number };
  if (!codigoProceso) {
    return NextResponse.json({ ok: false, error: 'codigoProceso requerido' }, { status: 400 });
  }

  // codigoProceso NO es único en SECOP — si no viene procesoId y hay más de una entidad
  // con el mismo código, se aborta en vez de recalcular la fecha de una arbitraria.
  let proceso: { id: number; codigoProceso: string | null; fechaVencimiento: Date | null } | null;
  if (procesoId) {
    proceso = await prisma.proceso.findUnique({
      where: { id: Number(procesoId) },
      select: { id: true, codigoProceso: true, fechaVencimiento: true },
    });
  } else {
    const candidatos = await prisma.proceso.findMany({
      where: { codigoProceso },
      select: { id: true, entidad: true },
    });
    if (candidatos.length > 1) {
      return NextResponse.json({
        ok: false,
        error: `codigoProceso "${codigoProceso}" es ambiguo: pertenece a ${candidatos.length} entidades distintas. Se requiere procesoId.`,
        candidatos: candidatos.map(c => ({ id: c.id, entidad: c.entidad })),
      }, { status: 409 });
    }
    proceso = candidatos.length === 1
      ? await prisma.proceso.findUnique({ where: { id: candidatos[0].id }, select: { id: true, codigoProceso: true, fechaVencimiento: true } })
      : null;
  }
  if (!proceso) {
    return NextResponse.json({ ok: false, error: `Proceso ${codigoProceso} no encontrado` }, { status: 404 });
  }

  const cronogramas = await prisma.procesoCronogramaSecop.findMany({
    where: { procesoId: proceso.id },
    orderBy: { orden: 'asc' },
    select: { evento: true, valorTexto: true },
  });

  if (cronogramas.length === 0) {
    return NextResponse.json({ ok: false, error: 'El proceso no tiene cronograma en BD' }, { status: 400 });
  }

  const entradas = cronogramas.map(c => ({
    nombre: c.evento,
    fecha: c.valorTexto ?? '',
  }));

  const { fecha: fechaCierre, nombreEvento } = detectarFechaPresentacionOfertas(entradas);

  if (!fechaCierre) {
    return NextResponse.json({
      ok: false,
      error: 'No se detectó evento de Presentación de Ofertas en el cronograma',
      eventos: entradas.map(e => e.nombre),
    }, { status: 422 });
  }

  const fechaAnterior = proceso.fechaVencimiento;
  const cambio = fechaAnterior === null || fechaCierre.getTime() !== fechaAnterior.getTime();

  if (!cambio) {
    return NextResponse.json({
      ok: true,
      sinCambio: true,
      fechaCierre: fechaCierre.toISOString(),
      nombreEvento,
    });
  }

  await prisma.proceso.update({
    where: { id: proceso.id },
    data: {
      fechaVencimiento: fechaCierre,
      fechaVencimientoAnterior: fechaAnterior,
      fechaCambioFechaCierre: new Date(),
      tieneCambioFechaCierre: true,
    },
  });

  return NextResponse.json({
    ok: true,
    codigoProceso,
    fechaAnterior: fechaAnterior?.toISOString() ?? null,
    fechaCierre: fechaCierre.toISOString(),
    nombreEvento,
  });
}