// src/app/api/deleted-solicitudes/route.ts
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireAdmin } from '@/lib/authz';
import { validarMotivo } from '@/lib/solicitudes/validar-motivo';

function str(v: unknown, fb = '') { return v != null ? String(v) : fb; }

function serializeDeleted(s: Record<string, unknown>) {
  return {
    ...s,
    valor:            s.valor != null ? Number(s.valor) : null,
    fechaPublicacion: s.fechaPublicacion instanceof Date ? s.fechaPublicacion.toISOString() : (s.fechaPublicacion ?? null),
    fechaVencimiento: s.fechaVencimiento instanceof Date ? s.fechaVencimiento.toISOString() : (s.fechaVencimiento ?? null),
    fechaCierre:      s.fechaCierre      instanceof Date ? s.fechaCierre.toISOString()      : (s.fechaCierre      ?? null),
    createdAt:        s.createdAt        instanceof Date ? s.createdAt.toISOString()        : (s.createdAt        ?? null),
    updatedAt:        s.updatedAt        instanceof Date ? s.updatedAt.toISOString()        : (s.updatedAt        ?? null),
    deletedAt:        s.deletedAt        instanceof Date ? s.deletedAt.toISOString()        : s.deletedAt,
  };
}

// ── GET /api/deleted-solicitudes ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  // Ajuste "SOLICITUDES ELIMINADAS — SOLO ADMINISTRADOR" (decisión
  // explícita del usuario) — reemplaza `requireAdministradorProcesos`
  // (que también autorizaba a Director/Coordinador Comercial, ver
  // historial de este archivo) por `requireAdmin` (isAdmin puro, sin
  // ampliar). 401 sin sesión, 403 con sesión pero sin nivel Admin.
  const denied = requireAdmin(session);
  if (denied) return denied;
  try {
    const registros = await prisma.deletedSolicitud.findMany({
      orderBy: { deletedAt: 'desc' },
    });

    return NextResponse.json({
      ok: true,
      solicitudes: registros.map((s: unknown) =>
        serializeDeleted(s as Record<string, unknown>)
      ),
    });
  } catch (err) {
    console.error('[GET /api/deleted-solicitudes]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 }
    );
  }
}

// ── PATCH /api/deleted-solicitudes — recuperar solicitud ─────────────────────
export async function PATCH(req: NextRequest) {
  const sessionPatch = await getSession(req);
  // Ajuste "SOLICITUDES ELIMINADAS — SOLO ADMINISTRADOR" — ver GET arriba.
  const deniedPatch = requireAdmin(sessionPatch);
  if (deniedPatch) return deniedPatch;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Cuerpo de la petición inválido.' }, { status: 400 });
  }

  const { id } = body as { id?: unknown };
  const idNumerico = Number(id);
  if (!id || !Number.isFinite(idNumerico)) {
    return NextResponse.json({ ok: false, error: 'id es requerido' }, { status: 400 });
  }

  const motivoValidado = validarMotivo(body.motivo);
  if (!motivoValidado.ok) {
    return NextResponse.json({ ok: false, error: motivoValidado.error }, { status: 400 });
  }
  const motivo = motivoValidado.valor;

  const actorUsuario = sessionPatch!.usuario ?? '';
  const actorEmail = sessionPatch!.email ?? '';

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      // Lock de la fila objetivo — evita que dos restauraciones simultáneas
      // de la MISMA fila de DeletedSolicitud dupliquen datos: la segunda
      // transacción espera a que la primera confirme (y borre la fila),
      // así que su propio findUnique posterior ya la encuentra ausente (404).
      await tx.$queryRaw`SELECT id FROM "DeletedSolicitud" WHERE id = ${idNumerico} FOR UPDATE`;

      const deleted = await tx.deletedSolicitud.findUnique({ where: { id: idNumerico } });
      if (!deleted) {
        return { tipo: 'no_encontrado' as const };
      }

      // Conflicto de identidad: no se restaura si ya existe una Solicitud
      // viva con el mismo procesoId — evita recrear un duplicado activo.
      // Nulls nunca entran en conflicto entre sí (semántica ya confirmada
      // por auditoría — ver "Análisis de unicidad por procesoId").
      if (deleted.procesoId != null) {
        const conflicto = await tx.solicitud.findFirst({ where: { procesoId: deleted.procesoId } });
        if (conflicto) {
          return { tipo: 'conflicto' as const, procesoId: deleted.procesoId, solicitudConflicto: conflicto.id };
        }
      }

      const originalId = deleted.originalId;
      let idToUse: number | undefined = undefined;
      if (originalId) {
        const existe = await tx.solicitud.findUnique({ where: { id: originalId } });
        if (!existe) idToUse = originalId;
      }

      const restored = await tx.solicitud.create({
        data: {
          ...(idToUse ? { id: idToUse } : {}),
          procesoId:         deleted.procesoId,
          procesoSourceKey:  deleted.procesoSourceKey,
          externalId:        deleted.externalId,
          codigoProceso:     deleted.codigoProceso,
          nombreProceso:     deleted.nombreProceso,
          entidad:           deleted.entidad,
          objeto:            deleted.objeto,
          fuente:            deleted.fuente,
          aliasFuente:       deleted.aliasFuente,
          modalidad:         deleted.modalidad,
          perfil:            deleted.perfil,
          departamento:      deleted.departamento,
          estadoFuente:      deleted.estadoFuente,
          fechaPublicacion:  deleted.fechaPublicacion,
          fechaVencimiento:  deleted.fechaVencimiento,
          valor:             deleted.valor,
          linkDetalle:       deleted.linkDetalle,
          linkSecop:         deleted.linkSecop,
          linkSecopReg:      deleted.linkSecopReg,
          estadoSolicitud:   str(deleted.estadoSolicitud) || 'En revisión',
          observacion:       deleted.observacion,
          ciudad:            deleted.ciudad,
          sede:              deleted.sede,
          plataforma:        deleted.plataforma,
          fechaCierre:       deleted.fechaCierre,
          procStep:          deleted.procStep ?? 0,
          procData:          deleted.procData ?? {},
          obsData:           deleted.obsData ?? [],
          docData:           deleted.docData ?? [],
          asignaciones:      deleted.asignaciones ?? [],
          revisor:           deleted.revisor,
          aprobador:         deleted.aprobador,
          usuarioRegistro:   deleted.usuarioRegistro,
          emailRegistro:     deleted.emailRegistro,
          cargoRegistro:     deleted.cargoRegistro,
          entidadRegistro:   deleted.entidadRegistro,
          origenSolicitud:   deleted.origenSolicitud ?? 'Comercial',
          correoContacto:    deleted.correoContacto,
          direccionContacto: deleted.direccionContacto,
          nitContacto:       deleted.nitContacto,
          personaContacto:   deleted.personaContacto,
          telefonoContacto:  deleted.telefonoContacto,
          duracion:          deleted.duracion,
          causalCierre:      deleted.causalCierre,
          fechaAperturaSqr:  deleted.fechaAperturaSqr,
          fechaCierreSqr:    deleted.fechaCierreSqr,
          resultadoFinal:    deleted.resultadoFinal,
          sqrCerrada:        deleted.sqrCerrada ?? false,
          sqrCreada:         deleted.sqrCreada ?? false,
          sqrError:          deleted.sqrError,
          sqrNumero:         deleted.sqrNumero,
          fechaEntregaInfo:  deleted.fechaEntregaInfo,
        },
      });

      await tx.auditLog.create({
        data: {
          usuarioId: sessionPatch!.id,
          email: actorEmail,
          rol: sessionPatch!.rol,
          accion: 'solicitud_restaurar',
          recurso: 'solicitud',
          recursoId: String(restored.id),
          metodo: 'PATCH',
          detalle: {
            deletedSolicitudId: idNumerico,
            solicitudRestauradaId: restored.id,
            idReutilizado: idToUse === originalId && originalId != null,
            motivo,
            restauradoPorUsuario: actorUsuario,
            restauradoPorEmail: actorEmail,
          },
        },
      });

      await tx.deletedSolicitud.delete({ where: { id: idNumerico } });

      return { tipo: 'ok' as const, solicitud: restored };
    });

    if (resultado.tipo === 'no_encontrado') {
      return NextResponse.json({ ok: false, error: 'Registro no encontrado' }, { status: 404 });
    }
    if (resultado.tipo === 'conflicto') {
      return NextResponse.json(
        { ok: false, error: `Ya existe una solicitud activa (#${resultado.solicitudConflicto}) con el mismo procesoId (${resultado.procesoId}).` },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, solicitud: resultado.solicitud });

  } catch (err) {
    console.error('[PATCH /api/deleted-solicitudes]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 }
    );
  }
}