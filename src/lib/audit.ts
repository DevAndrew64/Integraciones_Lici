import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { SessionUser } from '@/lib/session';

/** Cliente mínimo que necesita auditLog — el default `prisma` o un `tx` de `prisma.$transaction`. */
type AuditClient = { auditLog: { create: (args: { data: Prisma.AuditLogUncheckedCreateInput }) => Promise<unknown> } };

// Campos que NUNCA se guardan aunque lleguen en detalle
const CAMPOS_PROHIBIDOS = new Set([
  'password', 'passwordHash', 'password_hash', 'pass', 'token', 'secret',
  'cookie', 'authorization', 'apiKey', 'api_key', 'pdfBase64', 'archivoBase64',
  'pdfBlob', 'prompt', 'promptFull', 'resultado_completo', 'documento_texto',
]);

export type AuditParams = {
  accion: string;
  usuarioId?: number | null;
  email?: string | null;
  rol?: string | null;
  recurso?: string | null;
  recursoId?: string | null;
  metodo?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  detalle?: Record<string, unknown> | null;
};

function sanitizeDetalle(raw: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (CAMPOS_PROHIBIDOS.has(k.toLowerCase())) continue;
    if (typeof v === 'string' && v.length > 500) {
      out[k] = v.slice(0, 500) + '…';
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Registra un evento de auditoría.
 *
 * Por defecto (sin `client`, o con el `prisma` global) NO lanza excepción si
 * falla — así se comporta desde siempre en todos los `void auditLog(...)`
 * "fire and forget" ya existentes en el resto del código, y ese
 * comportamiento no cambia.
 *
 * Cuando se llama con un `client` explícito (el `tx` de un
 * `prisma.$transaction(...)`) el error SÍ se relanza — es la única forma de
 * que un fallo al escribir el AuditLog haga rollback de todo el bloque, en
 * vez de dejar un UPDATE aplicado sin su rastro de auditoría.
 */
export async function auditLog(params: AuditParams, client: AuditClient = prisma): Promise<void> {
  const dentroDeTransaccion = client !== (prisma as unknown as AuditClient);
  try {
    await client.auditLog.create({
      data: {
        accion:    params.accion,
        usuarioId: params.usuarioId ?? null,
        email:     params.email?.slice(0, 254) ?? null,
        rol:       params.rol?.slice(0, 50) ?? null,
        recurso:   params.recurso?.slice(0, 200) ?? null,
        recursoId: params.recursoId?.slice(0, 100) ?? null,
        metodo:    params.metodo?.slice(0, 10) ?? null,
        ip:        params.ip?.slice(0, 45) ?? null,
        userAgent: params.userAgent?.slice(0, 200) ?? null,
        detalle:   (sanitizeDetalle(params.detalle) ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    console.error('[AuditLog] Error:', err instanceof Error ? err.message.slice(0, 100) : 'desconocido');
    if (dentroDeTransaccion) throw err;
  }
}

/** Extrae IP del request. */
export function getAuditIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

/** Versión conveniente: toma req + session y construye los campos comunes. */
export function auditFromRequest(
  req: NextRequest,
  session: SessionUser | null,
  params: Omit<AuditParams, 'usuarioId' | 'email' | 'rol' | 'ip' | 'userAgent' | 'metodo'>,
): Promise<void> {
  return auditLog({
    ...params,
    usuarioId: session?.id ?? null,
    email:     session?.email ?? null,
    rol:       session?.rol ?? null,
    ip:        getAuditIp(req),
    userAgent: req.headers.get('user-agent'),
    metodo:    req.method,
  });
}