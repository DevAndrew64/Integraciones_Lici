import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  try {
    type PrismaExt = { perfilRol: { findFirst(a: { where: { nombre: string } }): Promise<{ permisos: unknown } | null> } };
    const perfilRol = await (prisma as unknown as PrismaExt).perfilRol.findFirst({
      where: { nombre: session!.rol },
    });

    let permisosRol: Record<string, boolean> = {};
    if (perfilRol?.permisos) {
      const raw = perfilRol.permisos;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === 'object') {
        permisosRol = parsed as Record<string, boolean>;
      }
    }

    return NextResponse.json({ ok: true, permisosRol });
  } catch {
    return NextResponse.json({ ok: true, permisosRol: {} });
  }
}