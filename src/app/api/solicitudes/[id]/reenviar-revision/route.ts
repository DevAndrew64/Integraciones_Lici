/**
 * POST /api/solicitudes/[id]/reenviar-revision — Fase 2B-2.1.
 *
 * Corrige el bug introducido por Fase 2B-1: al eliminar la ÚLTIMA
 * observación de una fila (dejando `observaciones` en `[]`), la Solicitud
 * debe volver a `EN_REVISION` (acción `REENVIAR_REVISION` de
 * `MATRIZ_ACCIONES`) — pero el PATCH genérico ya no acepta escribir
 * `EN_REVISION` directamente (`ESTADOS_EXCLUSIVOS_TRANSICION_DEDICADA`), así
 * que ese intento (`page.tsx`, antes de esta ruta) devolvía 400.
 *
 * Representa EXCLUSIVAMENTE esa transición — nunca un mecanismo genérico
 * para tocar `asignaciones`/`estadoSolicitud`. NO aplica cuando la fila
 * conserva alguna observación tras eliminar una (eso sigue sin cambio de
 * etapa, vía el PATCH genérico existente).
 *
 * Transacción (mismo patrón que `/observaciones`, `/cerrar`, `/transicion`):
 *  1. Actor resuelto exclusivamente de sesión (nunca del body).
 *  2. Autorización RÁPIDA por fila (`puedeReenviarRevision` sobre una
 *     lectura previa a la transacción) — solo para rechazar cuanto antes a
 *     un usuario obviamente no autorizado, sin gastar una transacción. NO
 *     es la autorización definitiva (ver punto 4).
 *  3. Lock de fila (`SELECT...FOR UPDATE`) + lectura fresca EN LA MISMA
 *     ida-vuelta (una sola sentencia SQL devuelve las columnas que hacen
 *     falta) — nunca se confía en el estado leído antes del lock.
 *  4. Re-autorización DEFINITIVA con los datos FRESCOS recién leídos bajo
 *     el lock (mismo `puedeReenviarRevision`, evaluado de nuevo sobre
 *     `fresh`) — cierra la ventana donde la observación pudo haber sido
 *     eliminada/reemplazada por otra petición entre el paso 2 y el lock;
 *     el backend nunca autoriza con datos potencialmente obsoletos.
 *  5. Revalida que el estado GLOBAL real sea `EN_OBSERVACION`, reutilizando
 *     `resolverTransicion('REENVIAR_REVISION', ...)` — la misma matriz que
 *     ya usa `/transicion` — sin duplicar la regla desde→hasta.
 *  6. Revalida que la fila objetivo exista y tenga observaciones que vaciar.
 *  7. Escritura + lectura de la fila resultante en UNA sola ida-vuelta
 *     (`update` sobre la PK, sin `updateMany` condicional ni un
 *     `findUnique` posterior aparte): el CAS por `estadoSolicitud` que
 *     antes hacía `updateMany` queda cubierto por el LOCK de fila del paso
 *     3 — mientras dura esta transacción, ningún otro escritor puede tocar
 *     esta fila, así que esa condición extra en el WHERE nunca podía
 *     fallar en la práctica y solo costaba una ida-vuelta más a la base de
 *     datos (medido: la transacción completa llegó a tardar ~12.5s contra
 *     un timeout de 5s con las 5 idas-vueltas originales).
 *  8. AuditLog en la MISMA transacción — si falla, Prisma revierte todo
 *     (el `update` de arriba incluido).
 *
 * Solo se toca la fila objetivo (nunca se "espeja" a las demás filas de
 * `asignaciones[]`) — mismo comportamiento que tenía el flujo legado por
 * PATCH que esta ruta reemplaza, para no alterar la experiencia de
 * co-responsables con su propia fila en otro subestado.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { resolverUsuarioSesionActivo, puedeReenviarRevision } from '@/lib/solicitudes/autorizacion-asignacion';
import { normalizarEstadoSolicitudGlobal, estadoRevisionLegadoEquivalente } from '@/lib/solicitudes/estados-canonicos';
import { resolverTransicion } from '@/lib/solicitudes/transiciones-estado';

const CLAVES_BODY_PERMITIDAS = new Set(['idAsignacion']);
const MENSAJE_ESTADO_AMBIGUO = 'Los datos históricos de este proceso son ambiguos (las asignaciones activas tienen subestados contradictorios) — no se puede determinar el subestado exacto. Corrige la inconsistencia antes de continuar.';
const ESTADO_REVISION_DESTINO = estadoRevisionLegadoEquivalente('EN_REVISION') ?? 'EN_REVISION';

function ahoraIso(): string {
  return new Date().toISOString();
}

function filasEstadoRevision(asignaciones: unknown): string[] {
  if (!Array.isArray(asignaciones)) return [];
  return asignaciones.map((a) => {
    const v = (a as Record<string, unknown>)?.estadoRevision;
    return typeof v === 'string' ? v : '';
  });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const noAuth = requireSession(session);
  if (noAuth) return noAuth;

  const { id } = await context.params;
  const dbId = Number(id);
  if (!Number.isFinite(dbId) || dbId <= 0) {
    return NextResponse.json({ ok: false, error: 'ID inválido.' }, { status: 400 });
  }

  let bodyRaw: unknown = {};
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Cuerpo de la petición inválido.' }, { status: 400 });
  }
  if (bodyRaw == null || typeof bodyRaw !== 'object' || Array.isArray(bodyRaw)) {
    return NextResponse.json({ ok: false, error: 'Cuerpo de la petición inválido: se esperaba un objeto.' }, { status: 400 });
  }
  const body = bodyRaw as Record<string, unknown>;

  // Allowlist estricta — nunca acepta `actor`/`usuario`/`rol`/`observaciones`
  // ni ningún otro campo de negocio; cualquier clave ajena rechaza la
  // petición completa con 400, nunca se ignora en silencio.
  for (const clave of Object.keys(body)) {
    if (!CLAVES_BODY_PERMITIDAS.has(clave)) {
      return NextResponse.json({ ok: false, error: `Campo no permitido en el body: "${clave}".` }, { status: 400 });
    }
  }

  if (typeof body.idAsignacion !== 'string' || !body.idAsignacion.trim()) {
    return NextResponse.json({ ok: false, error: 'idAsignacion es requerido y debe ser texto.' }, { status: 400 });
  }
  const idAsignacion = body.idAsignacion.trim();

  // El actor SIEMPRE se resuelve de sesión + BD — nunca del body.
  const usuario = await resolverUsuarioSesionActivo(prisma, session!);
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'Usuario no encontrado o inactivo.' }, { status: 403 });
  }

  const solicitudActual = await prisma.solicitud.findUnique({ where: { id: dbId } });
  if (!solicitudActual) {
    return NextResponse.json({ ok: false, error: 'Solicitud no encontrada.' }, { status: 404 });
  }

  const auth = puedeReenviarRevision(usuario, solicitudActual, idAsignacion);
  if (!auth.autorizado) {
    return NextResponse.json({ ok: false, error: auth.motivo ?? 'No autorizado.' }, { status: 403 });
  }

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      // Lock de fila + lectura fresca en UNA sola ida-vuelta (antes: un
      // `SELECT...FOR UPDATE` seguido de un `findUnique` aparte). Mientras
      // dure esta transacción, Postgres no deja que ningún otro escritor
      // toque esta fila, así que basta con leerla una vez apenas se toma
      // el lock — nunca se confía en el estado leído ANTES del lock.
      const filas = await tx.$queryRaw<Array<{ estadoSolicitud: string; asignaciones: unknown }>>`
        SELECT "estadoSolicitud", "asignaciones" FROM "Solicitud" WHERE id = ${dbId} FOR UPDATE
      `;
      const fresh = filas[0];
      if (!fresh) return { tipo: 'no_encontrada' as const };

      // Re-autorización DEFINITIVA con los datos FRESCOS bajo el lock —
      // cierra la ventana entre la autorización rápida de arriba (sobre
      // `solicitudActual`, leída antes de abrir la transacción) y este
      // punto: si en el medio otra petición ya eliminó/reemplazó esta
      // observación, el backend nunca autoriza con datos obsoletos.
      const authFresca = puedeReenviarRevision(usuario, { estadoSolicitud: String(fresh.estadoSolicitud ?? ''), asignaciones: fresh.asignaciones }, idAsignacion);
      if (!authFresca.autorizado) return { tipo: 'no_autorizado' as const, motivo: authFresca.motivo };

      const resolucion = normalizarEstadoSolicitudGlobal(
        String(fresh.estadoSolicitud ?? ''),
        filasEstadoRevision(fresh.asignaciones),
      );
      if (resolucion.ambiguo) return { tipo: 'ambiguo' as const };

      // Reutiliza la MISMA matriz desde→hasta que ya usa `/transicion` —
      // nunca se duplica la regla "EN_OBSERVACION → EN_REVISION" aquí.
      const resol = resolverTransicion('REENVIAR_REVISION', resolucion.estado);
      if (!resol.ok) return { tipo: 'conflicto' as const };

      const asignaciones = Array.isArray(fresh.asignaciones)
        ? [...(fresh.asignaciones as Record<string, unknown>[])]
        : [];
      const idx = asignaciones.findIndex((a) => String((a as Record<string, unknown>).idAsignacion ?? '') === idAsignacion);
      if (idx < 0) return { tipo: 'fila_no_encontrada' as const };

      const filaActual = asignaciones[idx] as Record<string, unknown>;
      const observacionesActuales = Array.isArray(filaActual.observaciones) ? filaActual.observaciones : [];
      if (observacionesActuales.length === 0) return { tipo: 'sin_observaciones' as const };

      const estadoAnteriorCrudo = String(fresh.estadoSolicitud ?? '');
      const ahora = ahoraIso();
      asignaciones[idx] = {
        ...filaActual,
        observaciones: [],
        estadoRevision: ESTADO_REVISION_DESTINO,
        ultimaActualizacion: ahora,
        gestionadoPor: usuario.usuario,
      };

      // Escritura + lectura de la fila actualizada en UNA sola ida-vuelta
      // (antes: `updateMany` condicional + `findUnique` aparte). El CAS por
      // `estadoSolicitud` que hacía `updateMany` queda cubierto por el lock
      // de fila de arriba — ver comentario del encabezado del archivo.
      const actualizada = await tx.solicitud.update({
        where: { id: dbId },
        data: {
          estadoSolicitud: resol.hasta,
          asignaciones: asignaciones as unknown as Prisma.InputJsonValue,
          updatedAt: new Date(),
        },
      });

      // Si esto falla, Prisma revierte toda la transacción (incluido el
      // `update` de arriba) — nunca queda un cambio de estado sin auditar.
      await tx.auditLog.create({
        data: {
          usuarioId: usuario.id,
          email: usuario.email,
          rol: usuario.rol,
          accion: 'solicitud_reenviar_revision',
          recurso: 'solicitud',
          recursoId: String(dbId),
          metodo: 'POST',
          detalle: {
            solicitudId: dbId,
            idAsignacion,
            accionFlujo: 'REENVIAR_REVISION',
            estadoAnterior: estadoAnteriorCrudo,
            estadoNuevo: resol.hasta,
            actorUsuario: usuario.usuario,
            actorRol: usuario.rol,
            fecha: ahora,
          },
        },
      });

      return { tipo: 'ok' as const, solicitud: actualizada, estadoAnterior: estadoAnteriorCrudo, estadoNuevo: resol.hasta };
    });

    if (resultado.tipo === 'no_encontrada') {
      return NextResponse.json({ ok: false, error: 'Solicitud no encontrada.' }, { status: 404 });
    }
    if (resultado.tipo === 'no_autorizado') {
      return NextResponse.json({ ok: false, error: resultado.motivo ?? 'No autorizado.' }, { status: 403 });
    }
    if (resultado.tipo === 'ambiguo') {
      return NextResponse.json({ ok: false, error: MENSAJE_ESTADO_AMBIGUO }, { status: 422 });
    }
    if (resultado.tipo === 'fila_no_encontrada') {
      return NextResponse.json({ ok: false, error: 'La asignación indicada no existe.' }, { status: 400 });
    }
    if (resultado.tipo === 'sin_observaciones') {
      return NextResponse.json({ ok: false, error: 'La asignación no tiene observaciones para vaciar.' }, { status: 400 });
    }
    if (resultado.tipo === 'conflicto') {
      return NextResponse.json({
        ok: false,
        error: 'La solicitud no está en observación, o fue actualizada por otro usuario — recarga la información antes de continuar.',
      }, { status: 409 });
    }

    return NextResponse.json({
      ok: true,
      estadoAnterior: resultado.estadoAnterior,
      estadoNuevo: resultado.estadoNuevo,
      solicitud: resultado.solicitud,
    });
  } catch (err) {
    console.error('[POST /api/solicitudes/[id]/reenviar-revision]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error interno.' },
      { status: 500 },
    );
  }
}
