import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';

import prisma from '@/lib/prisma';
import { normalizarPerfil } from '@/lib/normalizar-perfil';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;
  try {
    const solicitudes = await prisma.solicitud.findMany({
      select: { id: true, perfil: true },
    });

    let corregidas = 0;
    for (const s of solicitudes) {
      // Un perfil ausente se deja ausente: `normalizarPerfil(null)` devuelve
      // cadena vacía, así que sin este guard la normalización convertía todos
      // los NULL en '' — escribiendo un valor donde no había ninguno.
      if (!s.perfil) continue;
      const normalizado = normalizarPerfil(s.perfil);
      if (normalizado !== s.perfil) {
        await prisma.solicitud.update({
          where: { id: s.id },
          data: { perfil: normalizado },
        });
        corregidas++;
      }
    }

    const procesos = await prisma.proceso.findMany({
      select: { id: true, perfil: true },
    });

    let corregidosProcesos = 0;
    for (const p of procesos) {
      if (!p.perfil) continue; // mismo criterio: sin perfil ≠ perfil vacío
      const normalizado = normalizarPerfil(p.perfil);
      if (normalizado !== p.perfil) {
        await prisma.proceso.update({
          where: { id: p.id },
          data: { perfil: normalizado },
        });
        corregidosProcesos++;
      }
    }

    return NextResponse.json({
      ok: true,
      solicitudesCorregidas: corregidas,
      procesosCorregidos: corregidosProcesos,
      totalSolicitudes: solicitudes.length,
      totalProcesos: procesos.length,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error' },
      { status: 500 }
    );
  }
}
