import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession, canAccessSolicitud } from '@/lib/authz';
import { auditFromRequest } from '@/lib/audit';
import { cerrarSqrEnGrupoColba } from '@/lib/solicitudes/cerrar-sqr-externo';

/**
 * Ajuste "CIERRE DE SQR AL PRESENTAR" §9 — el flujo real de "Presentar
 * proceso" ya NO llama esta ruta (el cierre se coordina en servidor desde
 * `ejecutarTransicionEstado` → `coordinarCierreSqrParaPresentar`, sin
 * depender de un segundo viaje HTTP). Esta ruta se conserva endurecida
 * (soporte y observación ahora OBLIGATORIOS) para uso directo/manual —
 * reutiliza la MISMA integración externa (`cerrarSqrEnGrupoColba`), nunca
 * una segunda copia del contrato con GrupoColba.
 */
export async function POST(req: NextRequest) {
  // 1. Autenticación — sessionVersion validado dentro de getSession()
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  try {
    const formData = await req.formData();
    const solicitudId = Number(formData.get('solicitudId'));
    const observacion = String(formData.get('observacion') || '').trim();
    const soporte = formData.get('soporte') as File | null;

    if (!solicitudId) return NextResponse.json({ ok: false, error: 'solicitudId requerido' }, { status: 400 });
    if (!observacion) return NextResponse.json({ ok: false, error: 'observacion requerida' }, { status: 400 });
    if (!soporte) {
      return NextResponse.json(
        { ok: false, error: 'La evidencia de presentación es obligatoria para cerrar la SQR.' },
        { status: 400 },
      );
    }

    // 2. Buscar solicitud con campos de propiedad y acceso
    const solicitud = await prisma.solicitud.findUnique({
      where: { id: solicitudId },
      select: {
        id:            true,
        emailRegistro: true,
        asignaciones:  true,
        aprobador:     true,
        revisor:       true,
        sqrNumero:     true,
        sqrCerrada:    true,
      },
    });
    if (!solicitud) return NextResponse.json({ ok: false, error: 'Solicitud no encontrada' }, { status: 404 });

    // 3. Validar ownership — admin siempre puede; operativo solo si está asignado/es propietario
    if (!canAccessSolicitud(session!, solicitud)) {
      return NextResponse.json({ ok: false, error: 'No autorizado para cerrar esta solicitud' }, { status: 403 });
    }

    if (!solicitud.sqrNumero) return NextResponse.json({ ok: false, error: 'La solicitud no tiene SQR' }, { status: 400 });
    if (solicitud.sqrCerrada) return NextResponse.json({ ok: true, mensaje: 'SQR ya cerrada' });

    // 4. Llamar servicio externo SQR — misma integración única del módulo.
    // Esta ruta siempre exige soporte (línea ~30) — equivalente a un cierre
    // "Presentado" (descripción + evidencia obligatorias).
    const resultado = await cerrarSqrEnGrupoColba({
      sqrNumero: solicitud.sqrNumero,
      observacion,
      estadoFinalSqr: true,
      soporte: { nombre: soporte.name, contenido: soporte },
    });
    if (!resultado.ok) throw new Error(resultado.error);

    // 5. Actualizar BD
    // No se degrada `estadoFinalSqr` si ya era `true` (no hay update
    // condicional necesario: aquí siempre lo escribimos como `true`,
    // igual que el propio valor que ya se envió a GrupoColba arriba).
    await prisma.solicitud.update({
      where: { id: solicitudId },
      data: { sqrCerrada: true, sqrCierreEstado: 'CERRADA', fechaCierreSqr: new Date(), sqrError: null, estadoFinalSqr: true },
    });

    // 6. AuditLog — no incluye datos sensibles del solicitante ni base64
    void auditFromRequest(req, session!, {
      accion:    'sqr_cerrado',
      recurso:   'solicitudes/cerrar-sqr',
      recursoId: String(solicitudId),
      detalle: {
        solicitudId,
        sqrCerradaAntes:    false,
        sqrCerradaDespues:  true,
        soporteNombre:      soporte.name,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error interno' },
      { status: 500 },
    );
  }
}