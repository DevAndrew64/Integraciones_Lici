import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';

export interface SessionUser {
  id: number;
  email: string;
  rol: string;
  exp: number;
  sv: number; // sessionVersion — para revocación de sesiones
  usuario?: string; // username real (puede diferir del prefijo del email)
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function decodeBase64url(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

export async function getSession(req: NextRequest): Promise<SessionUser | null> {
  const secret = process.env.SESSION_SECRET ?? '';
  if (!secret) return null;

  const token = req.cookies.get('licy_session')?.value ?? '';
  if (!token) return null;

  const dotIdx = token.lastIndexOf('.');
  if (dotIdx < 0) return null;

  const payload = token.slice(0, dotIdx);
  const signature = token.slice(dotIdx + 1);
  if (!payload || signature.length !== 64) return null;

  try {
    const keyBytes = new TextEncoder().encode(secret);
    const key = await crypto.subtle.importKey(
      'raw', keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'HMAC', key,
      hexToBytes(signature).buffer as ArrayBuffer,
      new TextEncoder().encode(payload).buffer as ArrayBuffer,
    );
    if (!valid) return null;

    const data = JSON.parse(decodeBase64url(payload)) as SessionUser;
    if (typeof data.exp !== 'number' || data.exp <= Math.floor(Date.now() / 1000)) return null;

    // Cookies sin sv (emitidas antes de Fase E2.2) quedan inválidas → forzar relogin
    if (typeof data.sv !== 'number') return null;

    // Verificar sessionVersion contra BD — detecta revocación o cambio de contraseña
    try {
      const user = await prisma.user.findUnique({
        where: { id: data.id },
        select: { sessionVersion: true, usuario: true },
      });
      if (!user || user.sessionVersion !== data.sv) return null;
      // Hidratar usuario desde BD si el token no lo trae (sesiones emitidas antes del cambio)
      if (!data.usuario && user.usuario) {
        data.usuario = user.usuario;
      }
    } catch {
      // Si la BD no está disponible, dejar pasar (fail-open para no bloquear servicio)
      // El proxy HMAC ya garantiza que la cookie es legítima
    }

    return data;
  } catch {
    return null;
  }
}