import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import prisma from '@/lib/prisma';
import { puedeConBD } from '@/lib/licycolba/permisos';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const puedeAsignar = puedeConBD(session.rol, 'asignaciones', 'asignar');
  if (!puedeAsignar) {
    return NextResponse.json({ error: 'Sin permiso' }, { status: 403 });
  }

  try {
    const users = await prisma.user.findMany({
      where: { estado: 'Activo' },
      select: {
        id: true,
        usuario: true,
        cargo: true,
        proceso: true,
        entidadGrupo: true,
        rol: true,
        estado: true,
      },
      orderBy: { usuario: 'asc' },
    });
    return NextResponse.json(users);
  } catch (error) {
    console.error('Error listando usuarios asignables:', error);
    return NextResponse.json({ error: 'Error al consultar usuarios.' }, { status: 500 });
  }
}