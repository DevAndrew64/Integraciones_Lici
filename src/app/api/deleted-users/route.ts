import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';

import  prisma  from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;
  try {
    const deletedUsers = await prisma.deletedUser.findMany({
      orderBy: { deletedAt: 'desc' },
    });

    return NextResponse.json(deletedUsers);
  } catch (error) {
    console.error('Error listando usuarios eliminados:', error);
    return NextResponse.json(
      { error: 'No se pudieron consultar los usuarios eliminados.' },
      { status: 500 }
    );
  }
}