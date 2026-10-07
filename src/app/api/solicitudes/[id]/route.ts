import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireSession, requireAdmin, isAdmin, canAccessSolicitud } from '@/lib/authz';
import prisma from '@/lib/prisma';
import {
  resolverUsuarioSesionActivo, puedeRevisarProceso, puedeAgregarObservacion,
  puedeCerrarSolicitud, puedeRechazarSolicitud, puedeNoAceptarObservacion, puedeReasignarSolicitud, puedeGestionarCualquierAsignacion,
} from '@/lib/solicitudes/autorizacion-asignacion';

/** Ajuste "PERMISOS DEVUELTOS AL FRONTEND" — calculados con el usuario
 * ACTIVO real (sesión + BD), nunca con el rol crudo del cliente. Un usuario
 * inactivo/inexistente recibe `null` (el caller decide 403). `puedeAgregarObservacion`
 * aquí es una capacidad GENERAL ("¿existe alguna fila donde podría observar?"),
 * no por-fila — el endpoint real (`POST .../observaciones`) revalida por
 * `idAsignacion` de todos modos, esto es solo para que el frontend no
 * tenga que adivinar. */
async function calcularPermisosFicha(
  session: Awaited<ReturnType<typeof getSession>>,
  // Ajuste "PERMISOS DE CIERRE — PRIVADOS PARA MERCADEO" — `aliasFuente` se
  // agrega solo para que `puedeCerrarSolicitud` (más abajo) pueda leerlo
  // (`Solicitud` no tiene columna `tipoProceso` — ver el comentario de
  // `SolicitudConAsignaciones` en autorizacion-asignacion.ts); el resto de
  // este cuerpo no cambia.
  solicitud: { estadoSolicitud: string; asignaciones: unknown; aliasFuente?: string | null },
) {
  if (!session) return null;
  const usuario = await resolverUsuarioSesionActivo(prisma, session);
  if (!usuario) return null;
  const revision = puedeRevisarProceso(usuario, solicitud);
  const esAdministradorProcesos = puedeGestionarCualquierAsignacion(usuario);
  return {
    esAdministradorProcesos,
    puedeRevisarProceso: revision.autorizado,
    puedeGestionarCualquierAsignacion: esAdministradorProcesos,
    puedeAgregarObservacion: esAdministradorProcesos || revision.esResponsable,
    puedeCerrarSolicitud: puedeCerrarSolicitud(usuario, solicitud).autorizado,
    // Ajuste "RECHAZO PRIVADO — DIRECTOR/COORDINADOR COMERCIAL" — permiso
    // específico de la acción RECHAZAR, distinto de `puedeCerrarSolicitud`
    // (que en un Privado NO incluye a Director/Coordinador Comercial para
    // ningún otro resultado terminal). El frontend debe usar este campo
    // para mostrar el botón/flujo de "Rechazar", nunca `puedeCerrarSolicitud`.
    puedeRechazarSolicitud: puedeRechazarSolicitud(usuario, solicitud).autorizado,
    // "Observación no aceptada" — superconjunto de `puedeRechazarSolicitud`
    // (agrega al comercial responsable en Privados, ver autorizacion-asignacion.ts).
    puedeNoAceptarObservacion: puedeNoAceptarObservacion(usuario, solicitud).autorizado,
    puedeReasignarSolicitud: puedeReasignarSolicitud(usuario.rol),
    puedeEliminarLogicamente: esAdministradorProcesos,
    puedeRestaurar: esAdministradorProcesos,
  };
}


/** Ajuste "BLOQUE 0 — CONTENCIÓN PATCH SINGULAR" — este endpoint dejó de
 * ser un segundo camino genérico de escritura sobre `Solicitud` (el PATCH
 * plural `/api/solicitudes` sigue siendo el único camino para reglas de
 * negocio: estado, asignaciones, cierre, etc. — ver `deteccion-cambio-flujo`,
 * `ESTADOS_QUE_EXIGEN_RESPONSABLE`). Un caller sin las protecciones del PATCH
 * plural permitía dejar `estadoSolicitud:"Asignado para revisión"` con
 * `asignaciones:[]` (caso real de producción). Ahora solo admite, de forma
 * mutuamente excluyente, las dos operaciones puntuales que sí tienen caller
 * legítimo en `page.tsx` (modal "Fecha de entrega de info"): guardar una
 * fecha nueva, o eliminar una entrada específica del historial — nunca
 * `procData` crudo enviado por el cliente. */
type FechaEntregaHistorialEntry = { fecha: string | null; por: string; en: string };

function esFechaSolo(valor: unknown): valor is string {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

function esHistorialValido(valor: unknown): valor is FechaEntregaHistorialEntry[] {
  return Array.isArray(valor);
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSession(req);
  const noAuth = requireSession(session);
  if (noAuth) return noAuth;
  try {
    const { id } = await context.params;
    const dbId = Number(id);
    if (isNaN(dbId) || dbId <= 0) {
      return NextResponse.json({ ok: false, error: 'ID inválido.' }, { status: 400 });
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Payload inválido.' }, { status: 400 });
    }
    if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
      return NextResponse.json({ ok: false, error: 'Payload inválido.' }, { status: 400 });
    }
    const body = rawBody as Record<string, unknown>;
    const claves = Object.keys(body);

    const CLAVES_GUARDAR = new Set(['fechaEntregaInfo', 'registradoPor']);
    const esModoGuardar = claves.includes('fechaEntregaInfo');
    const esModoEliminar = claves.includes('eliminarEntradaHistorial');

    if (esModoGuardar === esModoEliminar) {
      // ambos ausentes (payload vacío/irrelevante) o ambos presentes (mezcla no permitida)
      return NextResponse.json(
        { ok: false, error: 'Payload inválido: envíe exactamente fechaEntregaInfo o eliminarEntradaHistorial.' },
        { status: 400 }
      );
    }

    let nuevaFechaEntregaInfo: string | null = null;
    let registradoPor = 'Sistema';
    let indiceEliminar = -1;
    let valorEsperadoEliminar: string | null = null;

    if (esModoGuardar) {
      const desconocidas = claves.filter(k => !CLAVES_GUARDAR.has(k));
      if (desconocidas.length > 0) {
        return NextResponse.json({ ok: false, error: `Campo(s) no permitido(s): ${desconocidas.join(', ')}` }, { status: 400 });
      }
      const valor = body.fechaEntregaInfo;
      if (valor !== null && !esFechaSolo(valor)) {
        return NextResponse.json({ ok: false, error: 'fechaEntregaInfo debe ser una fecha YYYY-MM-DD o null.' }, { status: 400 });
      }
      nuevaFechaEntregaInfo = valor;
      if ('registradoPor' in body) {
        const rp = body.registradoPor;
        if (typeof rp !== 'string' || rp.length === 0 || rp.length > 200) {
          return NextResponse.json({ ok: false, error: 'registradoPor inválido.' }, { status: 400 });
        }
        registradoPor = rp;
      }
    } else {
      const desconocidas = claves.filter(k => k !== 'eliminarEntradaHistorial');
      if (desconocidas.length > 0) {
        return NextResponse.json({ ok: false, error: `Campo(s) no permitido(s): ${desconocidas.join(', ')}` }, { status: 400 });
      }
      const op = body.eliminarEntradaHistorial;
      if (typeof op !== 'object' || op === null || Array.isArray(op)) {
        return NextResponse.json({ ok: false, error: 'eliminarEntradaHistorial debe ser un objeto {indice, valorEsperado}.' }, { status: 400 });
      }
      const opClaves = Object.keys(op as Record<string, unknown>);
      const opDesconocidas = opClaves.filter(k => k !== 'indice' && k !== 'valorEsperado');
      if (opDesconocidas.length > 0) {
        return NextResponse.json({ ok: false, error: `Campo(s) no permitido(s) en eliminarEntradaHistorial: ${opDesconocidas.join(', ')}` }, { status: 400 });
      }
      const indice = (op as Record<string, unknown>).indice;
      if (typeof indice !== 'number' || !Number.isInteger(indice) || indice < 0) {
        return NextResponse.json({ ok: false, error: 'eliminarEntradaHistorial.indice debe ser un entero no negativo.' }, { status: 400 });
      }
      if (!('valorEsperado' in (op as Record<string, unknown>))) {
        return NextResponse.json({ ok: false, error: 'eliminarEntradaHistorial.valorEsperado es requerido.' }, { status: 400 });
      }
      const valorEsperado = (op as Record<string, unknown>).valorEsperado;
      if (valorEsperado !== null && !esFechaSolo(valorEsperado)) {
        return NextResponse.json({ ok: false, error: 'eliminarEntradaHistorial.valorEsperado debe ser una fecha YYYY-MM-DD o null.' }, { status: 400 });
      }
      indiceEliminar = indice;
      valorEsperadoEliminar = valorEsperado;
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const solicitud = await tx.solicitud.findUnique({
        where: { id: dbId },
        select: {
          id: true, procData: true, fechaEntregaInfo: true,
          emailRegistro: true, usuarioRegistro: true, asignaciones: true,
          aprobador: true, revisor: true,
        },
      });
      if (!solicitud) {
        return { status: 404 as const, error: 'No encontrada.' };
      }

      if (!isAdmin(session!.rol) && !canAccessSolicitud(session!, solicitud)) {
        return { status: 403 as const, error: 'No autorizado.' };
      }
      const usuario = await resolverUsuarioSesionActivo(tx, session!);
      if (!usuario) {
        return { status: 403 as const, error: 'No autorizado.' };
      }

      const procDataActual = (solicitud.procData ?? {}) as Record<string, unknown>;
      const historialCrudo = procDataActual.fechaEntregaHistorial;
      const historialActual = esHistorialValido(historialCrudo) ? historialCrudo : [];

      const fechaAnterior = solicitud.fechaEntregaInfo
        ? solicitud.fechaEntregaInfo.toISOString().slice(0, 10)
        : null;

      let nuevoHistorial: FechaEntregaHistorialEntry[];
      let fechaFinal: string | null;
      let accion: string;
      let detalleExtra: Record<string, unknown>;

      if (esModoGuardar) {
        fechaFinal = nuevaFechaEntregaInfo;
        nuevoHistorial = [
          { fecha: nuevaFechaEntregaInfo, por: registradoPor, en: new Date().toISOString() },
          ...historialActual,
        ];
        accion = 'solicitud_fecha_entrega_info_update';
        detalleExtra = { registradoPor };
      } else {
        // Nunca se confía en un arreglo reconstruido por el frontend — se
        // relee procData fresco (arriba) y se opera únicamente sobre esa
        // copia server-side.
        if (indiceEliminar >= historialActual.length) {
          return { status: 400 as const, error: 'Índice fuera de rango.' };
        }
        const entradaActual = historialActual[indiceEliminar];
        if ((entradaActual?.fecha ?? null) !== valorEsperadoEliminar) {
          // CAS: el histórico cambió entre que el cliente lo leyó y este
          // request — dato obsoleto, no se modifica nada.
          return { status: 409 as const, error: 'La entrada del historial ya no coincide con lo mostrado; recargue e intente de nuevo.' };
        }
        nuevoHistorial = historialActual.filter((_, i) => i !== indiceEliminar);
        fechaFinal = nuevoHistorial[0]?.fecha ?? null;
        accion = 'solicitud_fecha_entrega_info_historial_delete';
        detalleExtra = { indiceEliminado: indiceEliminar, valorEliminado: entradaActual?.fecha ?? null };
      }

      const actualizada = await tx.solicitud.update({
        where: { id: dbId },
        data: {
          fechaEntregaInfo: fechaFinal ? new Date(fechaFinal + 'T12:00:00.000Z') : null,
          // Se preservan todas las demás claves de procData — solo se
          // reemplaza fechaEntregaHistorial por la copia reconstruida
          // en servidor.
          procData: { ...procDataActual, fechaEntregaHistorial: nuevoHistorial },
        },
        select: { fechaEntregaInfo: true },
      });

      await tx.auditLog.create({
        data: {
          usuarioId: usuario.id,
          email: usuario.email,
          rol: usuario.rol,
          accion,
          recurso: 'solicitud',
          recursoId: String(dbId),
          metodo: 'PATCH',
          detalle: {
            solicitudId: dbId,
            campo: 'fechaEntregaInfo',
            valorAnterior: fechaAnterior,
            valorNuevo: fechaFinal,
            resultado: 'ok',
            origen: 'PATCH /api/solicitudes/[id]',
            ...detalleExtra,
          },
        },
      });

      return {
        status: 200 as const,
        fechaEntregaInfo: actualizada.fechaEntregaInfo,
        fechaEntregaHistorial: nuevoHistorial,
      };
    });

    if (resultado.status !== 200) {
      return NextResponse.json({ ok: false, error: resultado.error }, { status: resultado.status });
    }
    return NextResponse.json({
      ok: true,
      fechaEntregaInfo: resultado.fechaEntregaInfo,
      fechaEntregaHistorial: resultado.fechaEntregaHistorial,
    });
  } catch (error) {
    console.error('[PATCH /api/solicitudes/[id]]', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error.' },
      { status: 500 }
    );
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const sessionG = await getSession(req);
  const noAuthG = requireSession(sessionG);
  if (noAuthG) return noAuthG;
  try {
    const { id } = await context.params;
    const dbId = Number(id);
    if (isNaN(dbId) || dbId <= 0) {
      return NextResponse.json({ ok: false, error: 'ID inválido.' }, { status: 400 });
    }

    // Vistas que solo necesitan la lista de responsables (p.ej. el modal de
    // gestión) piden esto para no traer docData/procData/obsData — pueden
    // pesar varios MB por los documentos y adjuntos embebidos — ni los
    // archivos de evidencia dentro de cada asignación.
    const sinEvidencias = req.nextUrl.searchParams.get('sinEvidencias') === 'true';

    // Fichas abiertas desde listados livianos (p.ej. soloParaValidar, que no
    // trae docData) piden esto para completar únicamente los documentos
    // propios de la Solicitud, sin traer asignaciones ni procData/obsData.
    const soloDocumentos = req.nextUrl.searchParams.get('soloDocumentos') === 'true';

    if (soloDocumentos) {
      const solicitudDocumentos = await prisma.solicitud.findUnique({
        where: { id: dbId },
        select: { id: true, docData: true },
      });
      if (!solicitudDocumentos) {
        return NextResponse.json({ ok: false, error: 'No encontrada.' }, { status: 404 });
      }
      return NextResponse.json({ ok: true, solicitud: solicitudDocumentos });
    }

    if (sinEvidencias) {
      const solicitudLiviana = await prisma.solicitud.findUnique({
        where: { id: dbId },
        select: {
          id: true, procesoId: true, procesoSourceKey: true, externalId: true,
          codigoProceso: true, nombreProceso: true, entidad: true, objeto: true,
          fuente: true, aliasFuente: true, modalidad: true, perfil: true,
          departamento: true, ciudad: true, sede: true, plataforma: true,
          estadoSolicitud: true, estadoFuente: true, origenSolicitud: true,
          fechaPublicacion: true, fechaVencimiento: true, fechaCierre: true,
          valor: true, linkDetalle: true, linkSecop: true, linkSecopReg: true,
          sqrNumero: true, sqrCreada: true, sqrCerrada: true, sqrError: true,
          fechaAperturaSqr: true, fechaCierreSqr: true, fechaEntregaInfo: true,
          asignaciones: true, revisor: true, aprobador: true, observacion: true,
          resultadoFinal: true, causalCierre: true, usuarioRegistro: true,
          emailRegistro: true, cargoRegistro: true, entidadRegistro: true,
          nitContacto: true, personaContacto: true, telefonoContacto: true,
          direccionContacto: true, correoContacto: true, procStep: true,
          createdAt: true, updatedAt: true,
          // Ajuste "SEGUIMIENTO — MERCADEO" — a nivel de Solicitud completa
          // (no por fila), así que el detalle liviano de la ficha también
          // debe traerlo para que el panel se pueda pintar sin un segundo
          // fetch. Migración `20260825180000_add_seguimiento_solicitud` ya
          // aplicada contra la BD real — columna existente, seguro incluirla.
          observacionesSeguimiento: true,
        },
      });
      if (!solicitudLiviana) {
        return NextResponse.json({ ok: false, error: 'No encontrada.' }, { status: 404 });
      }
      const asignacionesLivianas = Array.isArray(solicitudLiviana.asignaciones)
        ? (solicitudLiviana.asignaciones as Record<string, unknown>[]).map(a => {
            const copia = { ...a };
            delete copia.evidencias;
            delete copia.evidenciaCierre;
            delete copia.evidenciaCierreDirecto;
            return copia;
          })
        : solicitudLiviana.asignaciones;
      const permisos = await calcularPermisosFicha(sessionG, {
        estadoSolicitud: solicitudLiviana.estadoSolicitud,
        asignaciones: asignacionesLivianas,
        aliasFuente: solicitudLiviana.aliasFuente,
      });
      return NextResponse.json({ ok: true, solicitud: { ...solicitudLiviana, asignaciones: asignacionesLivianas }, permisos });
    }

    const solicitud = await prisma.solicitud.findUnique({
      where: { id: dbId },
    });

    if (!solicitud) {
      return NextResponse.json({ ok: false, error: 'No encontrada.' }, { status: 404 });
    }

    const permisos = await calcularPermisosFicha(sessionG, {
      estadoSolicitud: solicitud.estadoSolicitud,
      asignaciones: solicitud.asignaciones,
      aliasFuente: solicitud.aliasFuente,
    });
    return NextResponse.json({ ok: true, solicitud, permisos });
  } catch (error) {
    console.error('[GET /api/solicitudes/[id]]', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error.' },
      { status: 500 }
    );
  }
}
