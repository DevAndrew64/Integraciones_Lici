import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';

/* =========================================================
   Estados de proceso que ya no son relevantes para notificar
========================================================= */
const ESTADOS_OBSOLETOS = [
  'adjudicado',
  'cerrado',
  'cancelado',
  'desierto',
  'vencido',
  'no adjudicado',
  'terminado',
];

function esEstadoObsoleto(estado: string | null | undefined): boolean {
  if (!estado) return false;
  const norm = estado.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return ESTADOS_OBSOLETOS.some(e => norm.includes(e));
}

// GET /api/notificaciones?limit=20&page=1&soloNoLeidas=true
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);
    const limit        = Math.min(Number(searchParams.get('limit') ?? '20'), 200);
    const page         = Math.max(Number(searchParams.get('page') ?? '1'), 1);
    const soloNoLeidas = searchParams.get('soloNoLeidas') === 'true';

    // Solo notificaciones de los últimos 30 días
    const hace30dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const where = {
      ...(soloNoLeidas ? { leida: false } : {}),
      creadoEn: { gte: hace30dias },
    };

    const skip = (page - 1) * limit;
    const notifsRaw = await prisma.notificacion.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      take: limit * 3, // traer más para filtrar obsoletos
      skip,
    });

    // Obtener IDs de procesos referenciados
    const procesoIds = [...new Set(
      notifsRaw
        .map(n => n.procesoId)
        .filter((id): id is number => id !== null && id !== undefined)
    )];

    // Traer estados de esos procesos
    const procesosMap = new Map<number, string | null>();
    if (procesoIds.length > 0) {
      const procesos = await prisma.proceso.findMany({
        where: { id: { in: procesoIds } },
        select: { id: true, estadoFuente: true, fechaVencimiento: true },
      });
      for (const p of procesos) {
        procesosMap.set(p.id, p.estadoFuente);
      }
    }

    // Filtrar notificaciones obsoletas
    const notificacionesFiltradas = notifsRaw.filter(n => {
      // Si tiene procesoId, verificar que el proceso no esté en estado obsoleto
      if (n.procesoId) {
        const estadoProceso = procesosMap.get(n.procesoId);
        if (esEstadoObsoleto(estadoProceso)) return false;
      }

      // Para alertas de manifestación: verificar que la fecha de la etapa no haya pasado
      if (n.tipo === 'alerta_manifestacion' || n.tipo === 'manifestacion_interes') {
        const datos = n.datos as Record<string, unknown> | null;
        const fechaEtapa = datos?.fechaEtapa as string | null;

        if (fechaEtapa) {
          const fecha = new Date(fechaEtapa);
          // Si la fecha ya pasó hace más de 1 día, no mostrar
          if (!isNaN(fecha.getTime()) && fecha.getTime() < Date.now() - 15 * 24 * 60 * 60 * 1000) {
            return false;
          }
        } else {
          // Sin fechaEtapa: intentar parsear desde descripción
          const desc = String(n.descripcion ?? '');
          const match = desc.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (match) {
            const [, d, m, y] = match;
            const fecha = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
            if (!isNaN(fecha.getTime()) && fecha.getTime() < Date.now() - 15 * 24 * 60 * 60 * 1000) {
              return false;
            }
          }
        }
      }

      return true;
    });

    // Limitar al número solicitado
    const notificaciones = notificacionesFiltradas
      .slice(0, limit)
      .map(n => {
        const datos = n.datos as Record<string, unknown> | null;
        return {
          ...n,
          fechaPublicacion: datos?.fechaPublicacion ?? null,
          datos,
        };
      });

    // Contar no leídas reales (con el mismo filtro)
    const totalNoLeidas = notificacionesFiltradas.filter(n => !n.leida).length;

    return NextResponse.json(
      { ok: true, notificaciones, totalNoLeidas, page, limit },
      { headers: { 'Cache-Control': 'private, max-age=30' } }
    );
  } catch (error) {
    console.error('Error listando notificaciones:', error);
    return NextResponse.json({ error: 'No se pudieron obtener las notificaciones.' }, { status: 500 });
  }
}

// POST /api/notificaciones — crear notificación
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  try {
    const body = await req.json();

    const tipo          = String(body.tipo          ?? '').trim();
    const titulo        = String(body.titulo        ?? '').trim();
    const descripcion   = String(body.descripcion   ?? '').trim() || null;
    const codigoProceso = String(body.codigoProceso ?? '').trim() || null;
    const procesoId     = body.procesoId ? Number(body.procesoId) : null;
    const entidad       = String(body.entidad       ?? '').trim() || null;
    const perfil        = String(body.perfil        ?? '').trim() || null;
    const datos         = body.datos ?? null;

    if (!tipo || !titulo) {
      return NextResponse.json({ error: 'tipo y titulo son obligatorios.' }, { status: 400 });
    }

    const notif = await prisma.notificacion.create({
      data: { tipo, titulo, descripcion, codigoProceso, procesoId, entidad, perfil, datos },
    });

    return NextResponse.json({ ok: true, notificacion: notif }, { status: 201 });
  } catch (error) {
    console.error('Error creando notificación:', error);
    return NextResponse.json({ error: 'No se pudo crear la notificación.' }, { status: 500 });
  }
}

// PATCH /api/notificaciones — marcar todas como leídas
export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  try {
    await prisma.notificacion.updateMany({
      where: { leida: false },
      data: { leida: true, leidaEn: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error marcando notificaciones:', error);
    return NextResponse.json({ error: 'No se pudo actualizar.' }, { status: 500 });
  }
}