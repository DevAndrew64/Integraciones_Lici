import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;
  try {
    const roles = await prisma.perfilRol.findMany({ orderBy: { nombre: 'asc' } });
    return NextResponse.json({ ok: true, roles });
  } catch(e) {
    console.error('[GET /api/roles]', e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Error al obtener roles' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const sessionPost = await getSession(req);
  const dp = requireAdmin(sessionPost);
  if (dp) return dp;
  try {
    const body = await req.json();
    const nombre = String(body.nombre ?? '').trim();
    const descripcion = String(body.descripcion ?? '').trim() || null;
    if (!nombre) return NextResponse.json({ ok: false, error: 'El nombre es obligatorio' }, { status: 400 });
    const existe = await prisma.perfilRol.findUnique({ where: { nombre } });
    if (existe) return NextResponse.json({ ok: false, error: 'Ya existe un rol con ese nombre' }, { status: 409 });
    const rol = await prisma.perfilRol.create({ data: { nombre, descripcion, permisos: {} } });
    return NextResponse.json({ ok: true, rol }, { status: 201 });
  } catch(e) {
    console.error('[POST /api/roles]', e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Error al crear rol' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const sessionPatch = await getSession(req);
  const deniedPatch = requireAdmin(sessionPatch);
  if (deniedPatch) return deniedPatch;
  try {
    const body = await req.json();
    const { id, nombre, descripcion, permisos } = body;
    if (!id) return NextResponse.json({ ok: false, error: 'id es requerido' }, { status: 400 });
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (nombre != null) data.nombre = String(nombre).trim();
    if (descripcion != null) data.descripcion = String(descripcion).trim() || null;
    if (permisos != null) data.permisos = permisos;
    const rol = await prisma.perfilRol.update({ where: { id: Number(id) }, data });
    return NextResponse.json({ ok: true, rol });
  } catch {
    return NextResponse.json({ ok: false, error: 'Error al actualizar rol' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const sessionDel = await getSession(req);
  const deniedDel = requireAdmin(sessionDel);
  if (deniedDel) return deniedDel;
  try {
    const body = await req.json();
    const { id } = body;
    if (!id) return NextResponse.json({ ok: false, error: 'id es requerido' }, { status: 400 });
    await prisma.perfilRol.delete({ where: { id: Number(id) } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'Error al eliminar rol' }, { status: 500 });
  }
}