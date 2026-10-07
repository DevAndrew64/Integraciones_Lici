// src/app/api/users/cambiar-password/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import { auditFromRequest } from '@/lib/audit';
import bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  try {
    const body = await req.json();
    const email  = String(body?.email  ?? '').trim().toLowerCase();
    const actual = String(body?.actual ?? '');
    const nueva  = String(body?.nueva  ?? '');

    // ── Validaciones básicas ──────────────────────────────────
    // Solo puede cambiar su propia contraseña
    if (session!.email.toLowerCase() !== email) {
      return NextResponse.json({ ok: false, message: 'Solo puede cambiar su propia contraseña.' }, { status: 403 });
    }

    if (!email || !actual || !nueva) {
      return NextResponse.json(
        { ok: false, message: 'Faltan campos requeridos.' },
        { status: 400 }
      );
    }

    if (nueva.length < 6) {
      return NextResponse.json(
        { ok: false, message: 'La nueva contraseña debe tener al menos 6 caracteres.' },
        { status: 400 }
      );
    }

    if (actual === nueva) {
      return NextResponse.json(
        { ok: false, message: 'La nueva contraseña no puede ser igual a la actual.' },
        { status: 400 }
      );
    }

    // ── Buscar usuario ────────────────────────────────────────
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return NextResponse.json(
        { ok: false, message: 'Usuario no encontrado.' },
        { status: 404 }
      );
    }

    // ── Verificar contraseña actual ───────────────────────────
    const coincide = await bcrypt.compare(actual, user.passwordHash);

    if (!coincide) {
      return NextResponse.json(
        { ok: false, message: 'La contraseña actual es incorrecta.' },
        { status: 401 }
      );
    }

    // ── Actualizar contraseña e invalidar sesiones anteriores ─
    const nuevoHash = await bcrypt.hash(nueva, 10);

    await prisma.user.update({
      where: { email },
      data: {
        passwordHash: nuevoHash,
        sessionVersion: { increment: 1 }, // invalida tokens emitidos antes del cambio
      },
    });

    void auditFromRequest(req, session, {
      accion: 'password_change',
      recurso: 'user',
      recursoId: String(user.id),
      detalle: { emailAfectado: email },
    });

    return NextResponse.json({ ok: true, message: 'Contraseña actualizada correctamente. Inicie sesión nuevamente.' });

  } catch (err) {
    console.error('[cambiar-password]', err);
    return NextResponse.json(
      { ok: false, message: 'Error interno del servidor.' },
      { status: 500 }
    );
  }
}