/**
 * /api/solicitudes/[id]/seguimiento — historial de anotaciones de
 * seguimiento de la Solicitud (POST crear, PATCH editar, DELETE eliminar).
 *
 * AUTORIZACIÓN (misma regla para las 3 operaciones —
 * `puedeGestionarSeguimiento`, `@/lib/solicitudes/seguimiento.ts`):
 * Administrador global, o Mercadeo sobre un proceso Privado. Mercadeo
 * NUNCA gestiona seguimiento en un proceso Público. No basta con ocultar
 * los botones en el frontend: un POST/PATCH/DELETE directo con Comercial
 * u otro rol no autorizado recibe 403 aquí, la fuente real de autoridad.
 *
 * `creadoPor`/`rol`/`creadoEn`/`actualizadoPor`/`actualizadoEn` se
 * reconstruyen SIEMPRE desde la sesión real (nunca del body).
 *
 * NUMERACIÓN: cada anotación recibe un `numero` estable al crearse
 * (`siguienteNumeroSeguimiento` — máximo existente + 1). Eliminar una
 * anotación NUNCA renumera las demás — un hueco en la secuencia es
 * aceptable, un número reutilizado no.
 *
 * Concurrencia: mismo patrón que `/observaciones` — lock de fila
 * (`SELECT ... FOR UPDATE`) dentro de una transacción antes de leer el
 * arreglo, para que dos operaciones casi simultáneas nunca se pisen.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { resolverUsuarioSesionActivo } from '@/lib/solicitudes/autorizacion-asignacion';
import {
  puedeGestionarSeguimiento, validarTextoSeguimiento, ordenarSeguimientoMasRecientePrimero,
  siguienteNumeroSeguimiento, type AnotacionSeguimiento,
} from '@/lib/solicitudes/seguimiento';

function ahoraLegible(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function parsearBody(req: NextRequest): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return { ok: false, error: 'Cuerpo de la petición inválido.' };
  }
  if (bodyRaw == null || typeof bodyRaw !== 'object' || Array.isArray(bodyRaw)) {
    return { ok: false, error: 'Cuerpo de la petición inválido: se esperaba un objeto.' };
  }
  return { ok: true, body: bodyRaw as Record<string, unknown> };
}

function verificarClavesPermitidas(body: Record<string, unknown>, permitidas: readonly string[]): string | null {
  for (const clave of Object.keys(body)) {
    if (!permitidas.includes(clave)) return clave;
  }
  return null;
}

async function resolverIdYUsuario(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const noAuth = requireSession(session);
  if (noAuth) return { ok: false as const, respuesta: noAuth };

  const { id } = await context.params;
  const dbId = Number(id);
  if (!Number.isFinite(dbId) || dbId <= 0) {
    return { ok: false as const, respuesta: NextResponse.json({ ok: false, error: 'ID inválido.' }, { status: 400 }) };
  }

  const usuario = await resolverUsuarioSesionActivo(prisma, session!);
  if (!usuario) {
    return { ok: false as const, respuesta: NextResponse.json({ ok: false, error: 'Usuario no encontrado o inactivo.' }, { status: 403 }) };
  }
  return { ok: true as const, dbId, usuario };
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resuelto = await resolverIdYUsuario(req, context);
  if (!resuelto.ok) return resuelto.respuesta;
  const { dbId, usuario } = resuelto;

  const bodyResuelto = await parsearBody(req);
  if (!bodyResuelto.ok) return NextResponse.json({ ok: false, error: bodyResuelto.error }, { status: 400 });
  const body = bodyResuelto.body;

  const clave = verificarClavesPermitidas(body, ['texto']);
  if (clave) return NextResponse.json({ ok: false, error: `Campo no permitido en el body: "${clave}".` }, { status: 400 });

  const textoValidado = validarTextoSeguimiento(body.texto);
  if (!textoValidado.ok) {
    return NextResponse.json({ ok: false, error: textoValidado.error }, { status: 400 });
  }

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Solicitud" WHERE id = ${dbId} FOR UPDATE`;

      const solicitud = await tx.solicitud.findUnique({ where: { id: dbId } });
      if (!solicitud) {
        return { tipo: 'no_encontrada' as const };
      }

      const auth = puedeGestionarSeguimiento(usuario.rol, solicitud);
      if (!auth.autorizado) {
        return { tipo: 'no_autorizado' as const, motivo: auth.motivo ?? 'No autorizado.' };
      }

      const actuales = Array.isArray(solicitud.observacionesSeguimiento)
        ? (solicitud.observacionesSeguimiento as unknown[])
        : [];

      const nuevaAnotacion: AnotacionSeguimiento = {
        id: crypto.randomUUID(),
        numero: siguienteNumeroSeguimiento(actuales),
        texto: textoValidado.valor,
        creadoEn: ahoraLegible(),
        creadoPor: usuario.usuario,
        rol: usuario.rol,
      };

      const actualizada = await tx.solicitud.update({
        where: { id: dbId },
        data: {
          observacionesSeguimiento: [...actuales, nuevaAnotacion] as unknown as Prisma.InputJsonValue,
          updatedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          usuarioId: usuario.id,
          email: usuario.email,
          rol: usuario.rol,
          accion: 'solicitud_seguimiento_agregado',
          recurso: 'solicitud',
          recursoId: String(dbId),
          metodo: 'POST',
          detalle: { solicitudId: dbId, creadoPor: usuario.usuario, anotacionId: nuevaAnotacion.id, numero: nuevaAnotacion.numero },
        },
      });

      return { tipo: 'ok' as const, solicitud: actualizada, anotacion: nuevaAnotacion };
    });

    if (resultado.tipo === 'no_encontrada') {
      return NextResponse.json({ ok: false, error: 'Solicitud no encontrada.' }, { status: 404 });
    }
    if (resultado.tipo === 'no_autorizado') {
      return NextResponse.json({ ok: false, error: resultado.motivo }, { status: 403 });
    }
    return NextResponse.json({
      ok: true,
      anotacion: resultado.anotacion,
      observacionesSeguimiento: ordenarSeguimientoMasRecientePrimero(resultado.solicitud.observacionesSeguimiento),
      solicitud: resultado.solicitud,
    });
  } catch (err) {
    console.error('[POST /api/solicitudes/[id]/seguimiento]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error interno.' },
      { status: 500 },
    );
  }
}

/** PATCH — edita ÚNICAMENTE `texto` de una anotación existente (por `id`).
 * `numero`/`creadoEn`/`creadoPor` se conservan intactos; se agregan
 * `actualizadoEn`/`actualizadoPor` desde la sesión real. */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resuelto = await resolverIdYUsuario(req, context);
  if (!resuelto.ok) return resuelto.respuesta;
  const { dbId, usuario } = resuelto;

  const bodyResuelto = await parsearBody(req);
  if (!bodyResuelto.ok) return NextResponse.json({ ok: false, error: bodyResuelto.error }, { status: 400 });
  const body = bodyResuelto.body;

  const clave = verificarClavesPermitidas(body, ['id', 'texto']);
  if (clave) return NextResponse.json({ ok: false, error: `Campo no permitido en el body: "${clave}".` }, { status: 400 });

  if (typeof body.id !== 'string' || !body.id.trim()) {
    return NextResponse.json({ ok: false, error: 'id es requerido y debe ser texto.' }, { status: 400 });
  }
  const anotacionId = body.id.trim();

  const textoValidado = validarTextoSeguimiento(body.texto);
  if (!textoValidado.ok) {
    return NextResponse.json({ ok: false, error: textoValidado.error }, { status: 400 });
  }

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Solicitud" WHERE id = ${dbId} FOR UPDATE`;

      const solicitud = await tx.solicitud.findUnique({ where: { id: dbId } });
      if (!solicitud) return { tipo: 'no_encontrada' as const };

      const auth = puedeGestionarSeguimiento(usuario.rol, solicitud);
      if (!auth.autorizado) {
        return { tipo: 'no_autorizado' as const, motivo: auth.motivo ?? 'No autorizado.' };
      }

      const actuales = Array.isArray(solicitud.observacionesSeguimiento)
        ? (solicitud.observacionesSeguimiento as Record<string, unknown>[])
        : [];
      // Nunca se edita una anotación ya eliminada (`activo:false`).
      const idx = actuales.findIndex((a) => String(a.id ?? '') === anotacionId && a.activo !== false);
      if (idx < 0) return { tipo: 'anotacion_no_encontrada' as const };

      // Solo `texto` cambia — numero/creadoEn/creadoPor/rol se conservan
      // EXACTAMENTE tal cual (nunca se toman del body).
      const nuevas = [...actuales];
      nuevas[idx] = {
        ...nuevas[idx],
        texto: textoValidado.valor,
        actualizadoEn: ahoraLegible(),
        actualizadoPor: usuario.usuario,
      };

      const actualizada = await tx.solicitud.update({
        where: { id: dbId },
        data: { observacionesSeguimiento: nuevas as unknown as Prisma.InputJsonValue, updatedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          usuarioId: usuario.id, email: usuario.email, rol: usuario.rol,
          accion: 'solicitud_seguimiento_editado', recurso: 'solicitud', recursoId: String(dbId), metodo: 'PATCH',
          detalle: { solicitudId: dbId, editadoPor: usuario.usuario, anotacionId },
        },
      });

      return { tipo: 'ok' as const, solicitud: actualizada };
    });

    if (resultado.tipo === 'no_encontrada') return NextResponse.json({ ok: false, error: 'Solicitud no encontrada.' }, { status: 404 });
    if (resultado.tipo === 'anotacion_no_encontrada') return NextResponse.json({ ok: false, error: 'La anotación indicada no existe.' }, { status: 404 });
    if (resultado.tipo === 'no_autorizado') return NextResponse.json({ ok: false, error: resultado.motivo }, { status: 403 });
    return NextResponse.json({
      ok: true,
      observacionesSeguimiento: ordenarSeguimientoMasRecientePrimero(resultado.solicitud.observacionesSeguimiento),
      solicitud: resultado.solicitud,
    });
  } catch (err) {
    console.error('[PATCH /api/solicitudes/[id]/seguimiento]', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error interno.' }, { status: 500 });
  }
}

/** DELETE — elimina (soft delete, `activo:false`) una anotación (por `id`,
 * en el body). NUNCA renumera las restantes ni reutiliza su `numero`. */
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resuelto = await resolverIdYUsuario(req, context);
  if (!resuelto.ok) return resuelto.respuesta;
  const { dbId, usuario } = resuelto;

  const bodyResuelto = await parsearBody(req);
  if (!bodyResuelto.ok) return NextResponse.json({ ok: false, error: bodyResuelto.error }, { status: 400 });
  const body = bodyResuelto.body;

  const clave = verificarClavesPermitidas(body, ['id']);
  if (clave) return NextResponse.json({ ok: false, error: `Campo no permitido en el body: "${clave}".` }, { status: 400 });

  if (typeof body.id !== 'string' || !body.id.trim()) {
    return NextResponse.json({ ok: false, error: 'id es requerido y debe ser texto.' }, { status: 400 });
  }
  const anotacionId = body.id.trim();

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Solicitud" WHERE id = ${dbId} FOR UPDATE`;

      const solicitud = await tx.solicitud.findUnique({ where: { id: dbId } });
      if (!solicitud) return { tipo: 'no_encontrada' as const };

      const auth = puedeGestionarSeguimiento(usuario.rol, solicitud);
      if (!auth.autorizado) {
        return { tipo: 'no_autorizado' as const, motivo: auth.motivo ?? 'No autorizado.' };
      }

      const actuales = Array.isArray(solicitud.observacionesSeguimiento)
        ? (solicitud.observacionesSeguimiento as Record<string, unknown>[])
        : [];
      // Solo se puede eliminar una anotación ACTIVA — ya eliminada (o
      // inexistente) responde 404 igual, nunca un soft-delete duplicado.
      const idx = actuales.findIndex((a) => String(a.id ?? '') === anotacionId && a.activo !== false);
      if (idx < 0) return { tipo: 'anotacion_no_encontrada' as const };

      // Soft delete (`activo:false`) — NUNCA se quita del arreglo ni se
      // renumeran las demás. Protege el `numero` de esta anotación para
      // siempre (ver `siguienteNumeroSeguimiento`, que sigue contándola al
      // calcular el máximo) — un número reutilizado sería peor que un
      // hueco en la secuencia.
      const nuevas = [...actuales];
      nuevas[idx] = { ...nuevas[idx], activo: false, eliminadoEn: ahoraLegible(), eliminadoPor: usuario.usuario };

      const actualizada = await tx.solicitud.update({
        where: { id: dbId },
        data: { observacionesSeguimiento: nuevas as unknown as Prisma.InputJsonValue, updatedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          usuarioId: usuario.id, email: usuario.email, rol: usuario.rol,
          accion: 'solicitud_seguimiento_eliminado', recurso: 'solicitud', recursoId: String(dbId), metodo: 'DELETE',
          detalle: { solicitudId: dbId, eliminadoPor: usuario.usuario, anotacionId },
        },
      });

      return { tipo: 'ok' as const, solicitud: actualizada };
    });

    if (resultado.tipo === 'no_encontrada') return NextResponse.json({ ok: false, error: 'Solicitud no encontrada.' }, { status: 404 });
    if (resultado.tipo === 'anotacion_no_encontrada') return NextResponse.json({ ok: false, error: 'La anotación indicada no existe.' }, { status: 404 });
    if (resultado.tipo === 'no_autorizado') return NextResponse.json({ ok: false, error: resultado.motivo }, { status: 403 });
    return NextResponse.json({
      ok: true,
      observacionesSeguimiento: ordenarSeguimientoMasRecientePrimero(resultado.solicitud.observacionesSeguimiento),
      solicitud: resultado.solicitud,
    });
  } catch (err) {
    console.error('[DELETE /api/solicitudes/[id]/seguimiento]', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error interno.' }, { status: 500 });
  }
}
