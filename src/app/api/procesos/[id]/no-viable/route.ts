import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, hasPermiso, esAdministradorProcesos } from '@/lib/authz';
import { resolverUsuarioSesionActivo } from '@/lib/solicitudes/autorizacion-asignacion';
import { auditFromRequest } from '@/lib/audit';
import prisma from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  // Usuario real desde sesión+BD — nunca el rol crudo de la cookie: un
  // usuario inactivo recibe 403 aunque conserve una cookie válida.
  const usuarioActivo = await resolverUsuarioSesionActivo(prisma, session!);
  if (!usuarioActivo) {
    return NextResponse.json({ ok: false, error: 'Usuario no encontrado o inactivo.' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await req.json();
    const { noViable, observacionNoViable, usuario } = body;

    if (!id) return NextResponse.json({ ok: false, error: 'id requerido' }, { status: 400 });

    // "Marcar/revertir no viable" forma parte del acceso funcional completo
    // al módulo Procesos (Administrador global, Director Comercial,
    // Coordinador Comercial) — se autoriza directamente sin depender de la
    // configuración de PerfilRol en BD. Otros roles siguen dependiendo de
    // la clave funcional ('busqueda_marcar_no_viable'/'busqueda_revertir_no_viable').
    const clavePermiso = noViable ? 'busqueda_marcar_no_viable' : 'busqueda_revertir_no_viable';
    const permitido = esAdministradorProcesos(usuarioActivo.rol) || await hasPermiso(session!, clavePermiso);
    if (!permitido) {
      void auditFromRequest(req, session!, {
        accion: 'access_denied',
        recurso: 'Proceso',
        recursoId: id,
        detalle: { endpoint: 'PATCH /api/procesos/[id]/no-viable', motivo: 'sin_permiso_funcional', clave: clavePermiso },
      });
      return NextResponse.json(
        { ok: false, error: 'No tienes permiso para esta acción. Contacta al administrador si crees que es un error.' },
        { status: 403 }
      );
    }

    if (noViable && !observacionNoViable?.trim()) {
      return NextResponse.json({ ok: false, error: 'La observación es obligatoria.' }, { status: 400 });
    }

    // Leer estado anterior para trazabilidad
    const anterior = await prisma.proceso.findUnique({
      where: { id: Number(id) },
      select: { noViable: true, codigoProceso: true },
    });

    const updated = await prisma.proceso.update({
      where: { id: Number(id) },
      data: {
        noViable: Boolean(noViable),
        observacionNoViable: noViable ? String(observacionNoViable).trim() : null,
        noViableRegistradoPor: noViable ? String(usuario || session!.email) : null,
        noViableFecha: noViable ? new Date() : null,
      },
    });

    void auditFromRequest(req, session!, {
      accion: 'proceso_no_viable',
      recurso: 'Proceso',
      recursoId: String(updated.id),
      detalle: {
        codigoProceso: updated.codigoProceso,
        noViableAnterior: anterior?.noViable ?? null,
        noViableNuevo: updated.noViable,
      },
    });

    return NextResponse.json({ ok: true, proceso: updated });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 }
    );
  }
}