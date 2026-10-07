import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import {
  checkLoginRateLimitPg,
  recordLoginFailurePg,
  clearLoginAttemptsPg,
} from '@/lib/rate-limit';
import { auditLog } from '@/lib/audit';
import { SESION_DURACION_SEG } from '@/lib/duracion-sesion';

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = String(body?.email ?? '').trim().toLowerCase();
    const password = String(body?.password ?? '');

    if (!email || !password) {
      return NextResponse.json(
        { ok: false, error: 'Email y contraseña son obligatorios.' },
        { status: 400 }
      );
    }

    const ip = getClientIp(request);

    // ── Rate limit por IP y email (Postgres persistente) ──────────────────────
    const rl = await checkLoginRateLimitPg(ip, email);
    if (rl.bloqueado) {
      const segundos = Math.ceil(rl.retryAfterMs / 1000);
      void auditLog({ accion: 'login_rate_limited', email, ip, metodo: 'POST', userAgent: request.headers.get('user-agent'), detalle: { resultado: 'rate_limited' } });
      return NextResponse.json(
        { ok: false, error: `Demasiados intentos. Intente en ${Math.ceil(segundos / 60)} min.` },
        { status: 429, headers: { 'Retry-After': String(segundos) } }
      );
    }

    // ── Lookup de usuario ──────────────────────────────────────────────────────
    const user = await prisma.user.findUnique({ where: { email } });

    // No revelar si el usuario existe o no
    if (!user) {
      void recordLoginFailurePg(ip, email);
      void auditLog({ accion: 'login_fallido', email, ip, metodo: 'POST', userAgent: request.headers.get('user-agent'), detalle: { resultado: 'usuario_no_existe' } });
      return NextResponse.json(
        { ok: false, error: 'Credenciales incorrectas.' },
        { status: 401 }
      );
    }

    if (user.estado !== 'Activo') {
      return NextResponse.json(
        { ok: false, error: 'El usuario está inactivo.' },
        { status: 403 }
      );
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      void recordLoginFailurePg(ip, email);
      void auditLog({ accion: 'login_fallido', email, ip, metodo: 'POST', userAgent: request.headers.get('user-agent'), detalle: { resultado: 'password_incorrecto' } });
      return NextResponse.json(
        { ok: false, error: 'Credenciales incorrectas.' },
        { status: 401 }
      );
    }

    // ── Login exitoso — limpiar contador ──────────────────────────────────────
    void clearLoginAttemptsPg(ip, email);
    void auditLog({ accion: 'login_ok', usuarioId: user.id, email: user.email, rol: user.rol, ip, metodo: 'POST', userAgent: request.headers.get('user-agent'), detalle: { resultado: 'ok' } });

    // Buscar permisos del rol en PerfilRol
    let permisosRol: Record<string, boolean> = {};
    try {
      type PrismaExt = { perfilRol: { findFirst(a: { where: { nombre: string } }): Promise<{ permisos: unknown } | null> } };
      const perfilRol = await (prisma as unknown as PrismaExt).perfilRol.findFirst({
        where: { nombre: user.rol },
      });
      if (perfilRol?.permisos) {
        const raw = perfilRol.permisos;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === 'object') {
          permisosRol = parsed as Record<string, boolean>;
        }
      }
    } catch {
      // PerfilRol no existe o falla — usar fallback hardcodeado en permisos.ts
    }

    // Token firmado HMAC SHA-256
    const secret = process.env.SESSION_SECRET ?? '';
    const payload = Buffer.from(JSON.stringify({
      id: user.id,
      email: user.email,
      rol: user.rol,
      exp: Math.floor(Date.now() / 1000) + SESION_DURACION_SEG,
      sv: user.sessionVersion,
      usuario: user.usuario,
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const token = `${payload}.${signature}`;

    const response = NextResponse.json({
      usuario: user.usuario,
      cargo: user.cargo,
      email: user.email,
      entidadGrupo: user.entidadGrupo,
      rol: user.rol,
      proceso: user.proceso ?? '',
      subproceso: user.subproceso ?? '',
      uen: user.uen ?? '',
      permisosRol,
    });

    response.cookies.set('licy_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESION_DURACION_SEG,
    });

    return response;
  } catch (error) {
    console.error('[POST /api/auth/login] error interno');
    return NextResponse.json(
      { ok: false, error: 'Error interno del servidor.' },
      { status: 500 }
    );
  }
}