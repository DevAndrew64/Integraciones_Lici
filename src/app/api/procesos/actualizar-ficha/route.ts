import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { esAdministradorProcesos } from '@/lib/authz';
import { fachadaSync, SyncModoDataApiNoHabilitadoError } from '@/lib/data-api/sync/fachadaSync';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * PUT /api/procesos/actualizar-ficha — actualización PUNTUAL de una ficha
 * existente. Identidad principal: procesoId + externalId (codigoProceso solo
 * para trazabilidad/fallback). No recorre perfiles ni páginas: máximo una
 * llamada de detalle + una/dos llamadas generales dirigidas al único perfil
 * del Proceso.
 *
 * La sincronización masiva / importación de procesos nuevos permanece en
 * /api/procesos/sync — este endpoint no la reemplaza.
 */
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      procesoId?: number | string | null;
      externalId?: string | null;
      codigoProceso?: string | null;
      entidad?: string | null;
      forzar?: boolean;
      modo?: string;
      continuacionActualizacion?: string | null;
    };

    // `modo` nunca se confía ciegamente: `actualizarFichaPuntual` exige,
    // además, un token de continuación firmado en servidor y lo revalida
    // contra el Proceso real (ver `validarContinuacionActualizacion`) antes
    // de omitir cualquier operación externa.
    const modo = body.modo === 'completar_datos' ? 'completar_datos' as const : undefined;
    const continuacionActualizacion =
      typeof body.continuacionActualizacion === 'string' ? body.continuacionActualizacion : undefined;
    // `forzar` (saltar la ventana de frescura) es de uso administrativo
    // funcional de Procesos (Administrador global, Director Comercial o
    // Coordinador Comercial) — nunca se honra para el botón normal.
    const session = await getSession(req);
    const esAdmin = esAdministradorProcesos(String((session as { rol?: string } | null)?.rol ?? ''));
    const forzar = body.forzar === true && esAdmin;
    // Ajuste "INTEGRACIÓN ACTUALIZAR FICHA — MOTOR ÚNICO" — solo para
    // AuditLog (quién disparó la actualización); nunca decide autorización.
    const usuarioId = (session as { id?: number } | null)?.id ?? null;

    const rFachada = await fachadaSync.actualizarFichaProceso(
      {
        procesoId: body.procesoId,
        externalId: body.externalId,
        codigoProceso: body.codigoProceso,
        entidad: body.entidad,
        modo,
        continuacionActualizacion,
        usuarioId,
      },
      { forzar }
    );

    if (rFachada.estado === 'deshabilitado') {
      return NextResponse.json(
        {
          ok: false,
          modo: 'actualizacion_puntual',
          estado: 'sincronizacion_deshabilitada',
          deshabilitado: true,
          mensaje: rFachada.mensaje,
        },
        { status: 503 }
      );
    }

    const resultado = rFachada.datos;

    // 'parcial' SIEMPRE viaja como 200 — es un resultado funcionalmente
    // exitoso (enlace confirmado, continuación disponible), no un rechazo.
    // 422 queda reservado para 'error' real (identidad inconsistente,
    // proceso no actualizable, payload inválido). 'fuente_no_disponible' es
    // una falla externa total sin nada que ofrecer — 503, no 422.
    const status =
      resultado.estado === 'en_curso' ? 409
      : resultado.estado === 'limite_peticiones' ? 429
      : resultado.estado === 'error' ? 422
      : resultado.estado === 'fuente_no_disponible' ? 503
      : 200;

    return NextResponse.json(resultado, { status });
  } catch (error) {
    if (error instanceof SyncModoDataApiNoHabilitadoError) {
      console.error('[PUT /api/procesos/actualizar-ficha] modo data-api no habilitado');
      return NextResponse.json(
        {
          ok: false,
          modo: 'actualizacion_puntual',
          estado: 'error',
          operacionesExternas: { detalle: 0, perfiles: 0, apiGeneral: 0 },
          duracionMs: 0,
          camposActualizados: [],
          error: error.message,
        },
        { status: 503 }
      );
    }
    console.error('[PUT /api/procesos/actualizar-ficha]', error);
    return NextResponse.json(
      {
        ok: false,
        modo: 'actualizacion_puntual',
        estado: 'error',
        operacionesExternas: { detalle: 0, perfiles: 0, apiGeneral: 0 },
        duracionMs: 0,
        camposActualizados: [],
        error: error instanceof Error ? error.message : 'Error al actualizar la ficha.',
      },
      { status: 500 }
    );
  }
}
