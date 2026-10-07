import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';
import { auditFromRequest } from '@/lib/audit';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';


type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(req: NextRequest, context: RouteContext) {
  const session = await getSession(req);
  const denied = requireAdmin(session);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const userId = Number.parseInt(id, 10);
    if (!Number.isInteger(userId) || userId <= 0)
      return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });

    const body = await req.json();

    const cedula       = String(body.cedula       ?? '').trim();
    const celular      = String(body.celular      ?? '').trim();
    const entidadGrupo = String(body.entidadGrupo ?? '').trim();
    const cargo        = String(body.cargo        ?? '').trim();
    const email        = String(body.email        ?? '').trim().toLowerCase();
    const usuario      = String(body.usuario      ?? '').trim().toLowerCase();
    const rol          = String(body.rol          ?? '').trim();
    const estado       = String(body.estado       ?? 'Activo').trim();
    const firmaDigital = String(body.firmaDigital ?? '').trim();
    const password     = String(body.password     ?? '').trim();
    const proceso      = String(body.proceso      ?? '').trim() || null;
    const subproceso   = String(body.subproceso   ?? '').trim() || null;
    const uen          = String(body.uen          ?? '').trim() || null;

    if (!cedula)       return NextResponse.json({ error: 'La cédula es obligatoria.' },            { status: 400 });
    if (!celular)      return NextResponse.json({ error: 'El celular es obligatorio.' },           { status: 400 });
    if (!entidadGrupo) return NextResponse.json({ error: 'La entidad del grupo es obligatoria.' }, { status: 400 });
    if (!cargo)        return NextResponse.json({ error: 'El cargo es obligatorio.' },             { status: 400 });
    if (!email)        return NextResponse.json({ error: 'El email es obligatorio.' },             { status: 400 });
    if (!usuario)      return NextResponse.json({ error: 'El usuario es obligatorio.' },           { status: 400 });
    if (!rol)          return NextResponse.json({ error: 'El rol es obligatorio.' },               { status: 400 });
    if (password && password.length < 6)
      return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres.' }, { status: 400 });

    const existente = await prisma.user.findUnique({ where: { id: userId } });
    if (!existente) return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 });

    const cedulaDup = await prisma.user.findFirst({ where: { cedula, NOT: { id: userId } } });
    if (cedulaDup) return NextResponse.json({ error: 'Ya existe un usuario con esa cédula.' }, { status: 409 });

    const emailDup = await prisma.user.findFirst({ where: { email, NOT: { id: userId } } });
    if (emailDup) return NextResponse.json({ error: 'Ya existe un usuario con ese email.' }, { status: 409 });

    const usuarioDup = await prisma.user.findFirst({ where: { usuario, NOT: { id: userId } } });
    if (usuarioDup) return NextResponse.json({ error: 'Ya existe un usuario con ese nombre de usuario.' }, { status: 409 });

    const data: {
      cedula: string; celular: string; entidadGrupo: string; cargo: string;
      email: string; usuario: string; rol: string; estado: string;
      firmaDigital: string | null; proceso: string | null;
      subproceso: string | null; uen: string | null; passwordHash?: string;
    } = {
      cedula, celular, entidadGrupo, cargo, email, usuario, rol, estado,
      firmaDigital: firmaDigital || null,
      proceso, subproceso, uen,
    };

    if (password) data.passwordHash = await bcrypt.hash(password, 10);

    const updated = await prisma.user.update({ where: { id: userId }, data });
    const { passwordHash: _ph, ...userSinHash } = updated;
    const accionPut = existente.rol !== rol ? 'user_role_change' : 'user_update';
    void auditFromRequest(req, session, {
      accion: accionPut,
      recurso: 'user',
      recursoId: String(userId),
      detalle: accionPut === 'user_role_change'
        ? { emailAfectado: existente.email, rolAnterior: existente.rol, rolNuevo: rol }
        : { emailAfectado: existente.email },
    });
    return NextResponse.json(userSinHash);

  } catch (error) {
    console.error('Error actualizando usuario:', error);
    return NextResponse.json({ error: 'No se pudo actualizar el usuario.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const sessionD = await getSession(req);
  const deniedD = requireAdmin(sessionD);
  if (deniedD) return deniedD;
  try {
    const { id } = await context.params;
    const userId = Number.parseInt(id, 10);
    if (!Number.isInteger(userId) || userId <= 0)
      return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });

    let deletedByUsuario: string | null = null;
    let deletedByEmail: string | null = null;
    let deletedByCargo: string | null = null;

    try {
      const body = await req.json();
      deletedByUsuario = String(body.deletedByUsuario ?? '').trim() || null;
      deletedByEmail   = String(body.deletedByEmail   ?? '').trim() || null;
      deletedByCargo   = String(body.deletedByCargo   ?? '').trim() || null;
    } catch { /* body vacío */ }

    const existente = await prisma.user.findUnique({ where: { id: userId } });
    if (!existente) return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 });

    await prisma.deletedUser.create({
      data: {
        originalUserId:  existente.id,
        cedula:          existente.cedula,
        celular:         existente.celular,
        entidadGrupo:    existente.entidadGrupo,
        cargo:           existente.cargo,
        email:           existente.email,
        usuario:         existente.usuario,
        rol:             existente.rol,
        estado:          existente.estado,
        firmaDigital:    existente.firmaDigital ?? null,
        proceso:         existente.proceso      ?? null,
        subproceso:      existente.subproceso   ?? null,
        uen:             existente.uen          ?? null,
        createdAt:       existente.createdAt,
        updatedAt:       existente.updatedAt,
        deletedByUsuario,
        deletedByEmail,
        deletedByCargo,
      },
    });

    await prisma.user.delete({ where: { id: userId } });
    void auditFromRequest(req, sessionD, {
      accion: 'user_delete',
      recurso: 'user',
      recursoId: String(userId),
      detalle: { emailEliminado: existente.email, rol: existente.rol },
    });
    return NextResponse.json({ ok: true, id: userId });

  } catch (error) {
    console.error('Error eliminando usuario:', error);
    return NextResponse.json({ error: 'No se pudo eliminar el usuario.' }, { status: 500 });
  }
}
