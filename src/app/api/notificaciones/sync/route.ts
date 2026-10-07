import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';

let lastSyncAt: Date | null = null;
const BUFFER_MS = 5 * 60 * 1000;
const LOCK_KEY = BigInt(1234567891);

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  const lockRows = await prisma.$queryRaw<[{ pg_try_advisory_lock: boolean }]>(
    Prisma.sql`SELECT pg_try_advisory_lock(${LOCK_KEY})`
  );
  const lockAcquired = lockRows[0]?.pg_try_advisory_lock === true;
  if (!lockAcquired) {
    return NextResponse.json({ ok: true, skipped: true, items: [], nextSince: null }, { status: 429 });
  }

  try {
    const ahora = new Date();

    const desde24h = lastSyncAt
      ? new Date(lastSyncAt.getTime() - BUFFER_MS)
      : new Date(ahora.getTime() - 24 * 60 * 60 * 1000);
    const desde30min = lastSyncAt
      ? new Date(lastSyncAt.getTime() - BUFFER_MS)
      : new Date(ahora.getTime() - 30 * 60 * 1000);

    const sinceParam = req.nextUrl.searchParams.get('since');
    const since = sinceParam ? new Date(sinceParam) : null;

    let creadas = 0;

    // ── Fuentes en paralelo (sin proceso_nuevo: se gestiona en otros módulos) ──
    const [cronogramasActualizados, adendaNuevas, detallesActualizados] =
      await Promise.all([
        // Solo cronogramas con cambio real de fecha
        prisma.procesoCronogramaSecop.findMany({
          where: { updatedAt: { gte: desde30min }, tieneCambioFecha: true },
          select: {
            procesoId: true, evento: true, valorTexto: true, valorTextoAnterior: true, updatedAt: true,
            proceso: { select: { codigoProceso: true, entidad: true, perfil: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: 30,
        }),
        // Solo adendas nuevas (no documentos genéricos)
        prisma.procesoDocumentoSecop.findMany({
          where: { fechaDetectado: { gte: desde24h }, tipoDocumento: 'adenda' },
          select: {
            procesoId: true, nombre: true, fechaDetectado: true,
            proceso: { select: { codigoProceso: true, entidad: true, perfil: true } },
          },
          orderBy: { fechaDetectado: 'desc' },
          take: 30,
        }),
        prisma.procesoDetalleSecop.findMany({
          where: { updatedAt: { gte: desde30min } },
          include: { proceso: { select: { codigoProceso: true, entidad: true, perfil: true, estadoFuente: true } } },
          orderBy: { updatedAt: 'desc' },
          take: 30,
        }),
      ]);

    // ── 1. Cambios en cronograma (solo fechas reales modificadas) ─────────────
    const procesosCronograma = new Map<number, typeof cronogramasActualizados[0]>();
    for (const cr of cronogramasActualizados) {
      if (!procesosCronograma.has(cr.procesoId)) procesosCronograma.set(cr.procesoId, cr);
    }

    const idsCronograma = [...procesosCronograma.keys()];
    if (idsCronograma.length > 0) {
      const yaExisten = await prisma.notificacion.findMany({
        where: { tipo: 'cambio_cronograma', procesoId: { in: idsCronograma }, creadoEn: { gte: desde30min } },
        select: { procesoId: true },
      });
      const setExistentes = new Set(yaExisten.map(n => n.procesoId));

      const lote = [...procesosCronograma.entries()]
        .filter(([procesoId]) => !setExistentes.has(procesoId))
        .map(([procesoId, cr]) => ({
          tipo: 'cambio_cronograma' as const,
          titulo: `Cambio en cronograma: ${cr.proceso.entidad || 'Sin entidad'}`,
          descripcion: `Cambio de fecha en "${cr.evento}"${cr.valorTextoAnterior ? ` (antes: ${cr.valorTextoAnterior})` : ''}`,
          codigoProceso: cr.proceso.codigoProceso ?? null,
          procesoId,
          entidad: cr.proceso.entidad ?? null,
          perfil: cr.proceso.perfil ?? null,
          datos: { evento: cr.evento, valorTexto: cr.valorTexto, valorTextoAnterior: cr.valorTextoAnterior } as Prisma.InputJsonValue,
        }));

      if (lote.length > 0) {
        const r = await prisma.notificacion.createMany({ data: lote, skipDuplicates: true });
        creadas += r.count;
      }
    }

    // ── 2. Adendas nuevas ─────────────────────────────────────────────────────
    const procesosAdenda = new Map<number, typeof adendaNuevas[0]>();
    const countAdendaMap = new Map<number, number>();
    for (const doc of adendaNuevas) {
      if (!procesosAdenda.has(doc.procesoId)) procesosAdenda.set(doc.procesoId, doc);
      countAdendaMap.set(doc.procesoId, (countAdendaMap.get(doc.procesoId) ?? 0) + 1);
    }

    const idsAdenda = [...procesosAdenda.keys()];
    if (idsAdenda.length > 0) {
      const yaExisten = await prisma.notificacion.findMany({
        where: { tipo: 'documento_nuevo', procesoId: { in: idsAdenda }, creadoEn: { gte: desde24h } },
        select: { procesoId: true },
      });
      const setExistentes = new Set(yaExisten.map(n => n.procesoId));

      const lote = [...procesosAdenda.entries()]
        .filter(([procesoId]) => !setExistentes.has(procesoId))
        .map(([procesoId, doc]) => {
          const count = countAdendaMap.get(procesoId) ?? 1;
          return {
            tipo: 'documento_nuevo' as const,
            titulo: `${count > 1 ? `${count} adendas nuevas` : 'Adenda nueva'}: ${doc.proceso.entidad || 'Sin entidad'}`,
            descripcion: count > 1
              ? `Se publicaron ${count} adendas en el proceso`
              : `Se publicó "${doc.nombre}" en el proceso`,
            codigoProceso: doc.proceso.codigoProceso ?? null,
            procesoId,
            entidad: doc.proceso.entidad ?? null,
            perfil: doc.proceso.perfil ?? null,
            datos: { totalAdendas: count, primerAdenda: doc.nombre } as Prisma.InputJsonValue,
          };
        });

      if (lote.length > 0) {
        const r = await prisma.notificacion.createMany({ data: lote, skipDuplicates: true });
        creadas += r.count;
      }
    }

    // ── 3. Cambios de estado ───────────────────────────────────────────────────
    const detallesMap = new Map<number, typeof detallesActualizados[0]>();
    for (const det of detallesActualizados) {
      if (det.estado && !detallesMap.has(det.procesoId)) detallesMap.set(det.procesoId, det);
    }

    const idsEstado = [...detallesMap.keys()];
    if (idsEstado.length > 0) {
      const yaExisten = await prisma.notificacion.findMany({
        where: { tipo: 'cambio_estado', procesoId: { in: idsEstado }, creadoEn: { gte: desde30min } },
        select: { procesoId: true },
      });
      const setExistentes = new Set(yaExisten.map(n => n.procesoId));

      const lote = [...detallesMap.entries()]
        .filter(([procesoId]) => !setExistentes.has(procesoId))
        .map(([procesoId, det]) => ({
          tipo: 'cambio_estado' as const,
          titulo: `Cambio de estado: ${det.proceso.entidad || 'Sin entidad'}`,
          descripcion: `Estado actualizado a "${det.estado}"`,
          codigoProceso: det.proceso.codigoProceso ?? null,
          procesoId,
          entidad: det.proceso.entidad ?? null,
          perfil: det.proceso.perfil ?? null,
          datos: { estadoNuevo: det.estado, fase: det.fase } as Prisma.InputJsonValue,
        }));

      if (lote.length > 0) {
        const r = await prisma.notificacion.createMany({ data: lote, skipDuplicates: true });
        creadas += r.count;
      }
    }

    lastSyncAt = ahora;

    const whereNuevas = since
      ? { creadoEn: { gt: since } }
      : { creadoEn: { gte: new Date(ahora.getTime() - 5 * 60 * 1000) } };

    const items = await prisma.notificacion.findMany({
      where: whereNuevas,
      orderBy: { creadoEn: 'desc' },
      take: 50,
    });

    return NextResponse.json({
      ok: true,
      notificacionesCreadas: creadas,
      items,
      nextSince: ahora.toISOString(),
    });

  } catch (error) {
    console.error('[GET /api/notificaciones/sync]', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error en sync' },
      { status: 500 }
    );
  } finally {
    if (lockAcquired) {
      await prisma.$executeRaw(Prisma.sql`SELECT pg_advisory_unlock(${LOCK_KEY})`);
    }
  }
}
