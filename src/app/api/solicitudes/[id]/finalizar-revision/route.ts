/**
 * POST /api/solicitudes/[id]/finalizar-revision — Fase 2B-2.2.1.
 *
 * Migra a un mecanismo transaccional dedicado la rama de APROBACIÓN del
 * flujo `EN_OBSERVACION → APROBADO_ELABORACION` (acción `FINALIZAR_REVISION`
 * de `MATRIZ_ACCIONES`), que hoy (`page.tsx`, sin tocar en esta etapa)
 * sigue usando el PATCH genérico sin lock/CAS/auditoría, y con `validadoPor`/
 * `fechaValidacion` controlables por el cliente (ver AUDITORÍA DE IMPACTO —
 * FASE 2B-2.2).
 *
 * Representa EXCLUSIVAMENTE esa transición, para la fila que aprueba su
 * propia observación (`decisionObservaciones: 'aceptada'`) — la rama
 * "no_aceptada" pertenece al flujo de rechazo, ya seguro vía
 * `POST /[id]/cerrar`, y NO se toca aquí.
 *
 * Reutiliza `resolverTransicion('FINALIZAR_REVISION', ...)` (la matriz
 * desde→hasta de `transiciones-estado.ts`) para no duplicar la regla de
 * negocio — pero NUNCA `ejecutarTransicionEstado`, que espeja el estado
 * nuevo a TODAS las filas de `asignaciones[]`: esta operación es por-fila
 * (solo `idAsignacion` cambia; cualquier otra fila permanece intacta).
 *
 * Transacción (mismo patrón que `/observaciones`, `/cerrar`, `/transicion`,
 * `/reenviar-revision`):
 *  1. Actor resuelto exclusivamente de sesión (nunca del body).
 *  2. Autorización por fila (`puedeFinalizarRevision` — dueño de la fila, o
 *     administrador funcional de Procesos).
 *  3. Lock de fila (`SELECT...FOR UPDATE`) + relectura fresca dentro de la
 *     transacción — nunca se confía en el estado leído antes del lock.
 *  4. Revalida que el estado GLOBAL real sea `EN_OBSERVACION`, reutilizando
 *     `resolverTransicion('FINALIZAR_REVISION', ...)`.
 *  5. Revalida que la fila objetivo exista.
 *  6. CAS: `updateMany` condicionado al `estadoSolicitud` crudo recién
 *     leído — si otra transacción ganó la carrera, 409 sin escribir nada.
 *  7. AuditLog en la MISMA transacción — si falla, Prisma revierte todo
 *     (el `updateMany` de arriba incluido).
 */
import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import prisma from '@/lib/prisma';
import { resolverUsuarioSesionActivo, puedeFinalizarRevision } from '@/lib/solicitudes/autorizacion-asignacion';
import { normalizarEstadoSolicitudGlobal } from '@/lib/solicitudes/estados-canonicos';
import { resolverTransicion } from '@/lib/solicitudes/transiciones-estado';

const CLAVES_BODY_PERMITIDAS = new Set(['idAsignacion', 'decisionObservaciones']);
const MENSAJE_ESTADO_AMBIGUO = 'Los datos históricos de este proceso son ambiguos (las asignaciones activas tienen subestados contradictorios) — no se puede determinar el subestado exacto. Corrige la inconsistencia antes de continuar.';

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

  // Allowlist estricta — nunca acepta `validadoPor`/`fechaValidacion`/
  // `actor`/`usuario`/`rol`/`estadoSolicitud`/`estadoRevision` ni ningún
  // otro campo; cualquier clave ajena rechaza la petición completa con 400,
  // nunca se ignora en silencio. El cliente NO puede decidir quién validó.
  for (const clave of Object.keys(body)) {
    if (!CLAVES_BODY_PERMITIDAS.has(clave)) {
      return NextResponse.json({ ok: false, error: `Campo no permitido en el body: "${clave}".` }, { status: 400 });
    }
  }

  if (typeof body.idAsignacion !== 'string' || !body.idAsignacion.trim()) {
    return NextResponse.json({ ok: false, error: 'idAsignacion es requerido y debe ser texto.' }, { status: 400 });
  }
  const idAsignacion = body.idAsignacion.trim();

  // Este endpoint representa EXCLUSIVAMENTE la aprobación — "no_aceptada"
  // pertenece al flujo de rechazo, ya seguro vía `/cerrar`.
  if (body.decisionObservaciones !== 'aceptada') {
    return NextResponse.json({ ok: false, error: 'decisionObservaciones debe ser exactamente "aceptada".' }, { status: 400 });
  }

  // El actor SIEMPRE se resuelve de sesión + BD — nunca del body.
  const usuario = await resolverUsuarioSesionActivo(prisma, session!);
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'Usuario no encontrado o inactivo.' }, { status: 403 });
  }

  const solicitudActual = await prisma.solicitud.findUnique({ where: { id: dbId } });
  if (!solicitudActual) {
    return NextResponse.json({ ok: false, error: 'Solicitud no encontrada.' }, { status: 404 });
  }

  const auth = puedeFinalizarRevision(usuario, solicitudActual, idAsignacion);
  if (!auth.autorizado) {
    return NextResponse.json({ ok: false, error: auth.motivo ?? 'No autorizado.' }, { status: 403 });
  }

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      // Lock de fila + relectura fresca — el estado leído antes de entrar a
      // la transacción puede haber quedado desactualizado.
      await tx.$queryRaw`SELECT id FROM "Solicitud" WHERE id = ${dbId} FOR UPDATE`;
      const fresh = await tx.solicitud.findUnique({ where: { id: dbId } });
      if (!fresh) return { tipo: 'no_encontrada' as const };

      const resolucion = normalizarEstadoSolicitudGlobal(
        String(fresh.estadoSolicitud ?? ''),
        filasEstadoRevision(fresh.asignaciones),
      );
      if (resolucion.ambiguo) return { tipo: 'ambiguo' as const };

      // Reutiliza la MISMA matriz desde→hasta que ya usa `/transicion` —
      // nunca se duplica la regla "EN_OBSERVACION → APROBADO_ELABORACION"
      // aquí, y nunca se usa `ejecutarTransicionEstado` (espejaría a todas
      // las filas).
      const resol = resolverTransicion('FINALIZAR_REVISION', resolucion.estado);
      if (!resol.ok) return { tipo: 'conflicto' as const };

      const asignaciones = Array.isArray(fresh.asignaciones)
        ? [...(fresh.asignaciones as Record<string, unknown>[])]
        : [];
      const idx = asignaciones.findIndex((a) => String(a.idAsignacion ?? '') === idAsignacion);
      if (idx < 0) return { tipo: 'fila_no_encontrada' as const };

      const filaActual = asignaciones[idx] as Record<string, unknown>;
      const estadoAnteriorCrudo = String(fresh.estadoSolicitud ?? '');
      const ahora = ahoraIso();

      // Solo se toca la fila objetivo — nunca un `.map()` sobre todo el
      // arreglo; cualquier otra fila (ej. un segundo responsable en
      // EN_OBSERVACION) permanece bit-a-bit igual.
      asignaciones[idx] = {
        ...filaActual,
        estadoRevision: resol.hasta,
        decisionObservaciones: 'aceptada',
        validadoPor: usuario.usuario,
        fechaValidacion: ahora,
        ultimaActualizacion: ahora,
        gestionadoPor: usuario.usuario,
      };

      const cas = await tx.solicitud.updateMany({
        where: { id: dbId, estadoSolicitud: estadoAnteriorCrudo },
        data: {
          estadoSolicitud: resol.hasta,
          asignaciones: asignaciones as unknown as Prisma.InputJsonValue,
          updatedAt: new Date(),
        },
      });
      if (cas.count === 0) return { tipo: 'conflicto' as const };

      const actualizada = await tx.solicitud.findUnique({ where: { id: dbId } });

      // Si esto falla, Prisma revierte toda la transacción (incluido el
      // `updateMany` de arriba) — nunca queda un cambio de estado sin auditar.
      await tx.auditLog.create({
        data: {
          usuarioId: usuario.id,
          email: usuario.email,
          rol: usuario.rol,
          accion: 'solicitud_finalizar_revision',
          recurso: 'solicitud',
          recursoId: String(dbId),
          metodo: 'POST',
          detalle: {
            solicitudId: dbId,
            idAsignacion,
            accionFlujo: 'FINALIZAR_REVISION',
            estadoAnterior: estadoAnteriorCrudo,
            estadoNuevo: resol.hasta,
            decisionObservaciones: 'aceptada',
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
    if (resultado.tipo === 'ambiguo') {
      return NextResponse.json({ ok: false, error: MENSAJE_ESTADO_AMBIGUO }, { status: 422 });
    }
    if (resultado.tipo === 'fila_no_encontrada') {
      return NextResponse.json({ ok: false, error: 'La asignación indicada no existe.' }, { status: 400 });
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
    console.error('[POST /api/solicitudes/[id]/finalizar-revision]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error interno.' },
      { status: 500 },
    );
  }
}
