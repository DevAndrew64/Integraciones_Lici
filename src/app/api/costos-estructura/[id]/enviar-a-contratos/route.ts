import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireEditarCostos } from '@/lib/authz';
import { auditFromRequest } from '@/lib/audit';
import { CLAVES_MODULO_NO_APLICA, obtenerModulo, resolverPendientesModulos } from '@/lib/costos-estructura/guardado-modular';
import type { ClaveModulo, EstadoModuloResultado } from '@/lib/costos-estructura/guardado-modular';
import { validarCostosPantallaDto } from '@/lib/costos-estructura/exportacion/costos-pantalla';
import type { ResultadoGuardado } from '@/lib/costos-estructura/exportacion/contratos';
import { enviarAlPuente } from '@/lib/contratos-puente/cliente';
import { armarPayloadContratos, describirError, etiquetaCampo } from '@/lib/contratos-puente/payload';

/**
 * Módulo 2 del puente — envía a Contratos (vía `puente-contratos/`) los datos de la oferta con el JSON v1: razón social,
 * NIT, dirección, objeto, % A.I.U. (el % de I.U. del costeo), valor mensual y plazo. Hoy el puente responde en modo prueba (valida y
 * no escribe en MySQL).
 *
 * Mismo criterio que el export: los módulos de costos deben estar resueltos (fuente de verdad server-side) y los totales
 * llegan de la pantalla (`costosDto`, validado). El vínculo Solicitud↔Costeo es EXPLÍCITO: la pantalla manda el
 * `solicitudId` de la ficha desde la que se abrió el costeo, y el servidor comprueba que el código de proceso coincida.
 * Lee `Resultado` de lo guardado: sin esa pestaña guardada el valor mensual, el plazo y el A.I.U. viajan vacíos.
 * Requiere el permiso de editar costos (Administrador o Equipo Comercial).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const denied = requireEditarCostos(session);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as { solicitudId?: unknown; costosDto?: unknown } | null;
    const solicitudId = Number(body?.solicitudId);
    if (!Number.isInteger(solicitudId) || solicitudId < 1) {
      return NextResponse.json({ ok: false, error: 'SOLICITUD_REQUERIDA', mensaje: 'Abra los costos desde la ficha de la solicitud para enviarlos a Contratos.' }, { status: 400 });
    }

    const registro = await prisma.costoEstructura.findUnique({ where: { id: Number(id) } });
    if (!registro) return NextResponse.json({ ok: false, error: 'No encontrado' }, { status: 404 });

    const estados: Partial<Record<ClaveModulo, EstadoModuloResultado>> = {};
    for (const clave of CLAVES_MODULO_NO_APLICA) estados[clave] = obtenerModulo(registro.datos, clave)?.estado;
    const { completo, pendientes } = resolverPendientesModulos(estados, CLAVES_MODULO_NO_APLICA);
    if (!completo) {
      return NextResponse.json({ ok: false, error: 'Existen módulos de costos pendientes por definir.', mensaje: 'Existen módulos de costos pendientes por definir.', pendientes }, { status: 409 });
    }

    const validacion = validarCostosPantallaDto(body?.costosDto);
    if (!validacion.ok) return NextResponse.json({ ok: false, error: 'COSTOS_DTO_INVALIDO', mensaje: 'Los totales de la pantalla no son válidos. Recargue e intente de nuevo.' }, { status: 400 });

    // `select` explícito: no depende de columnas ajenas a este envío (incidente «column does not exist»).
    const solicitud = await prisma.solicitud.findUnique({
      where: { id: solicitudId },
      select: { id: true, codigoProceso: true, entidad: true, objeto: true, nitContacto: true, direccionContacto: true },
    });
    if (!solicitud) return NextResponse.json({ ok: false, error: 'SOLICITUD_NO_ENCONTRADA', mensaje: 'La solicitud no existe.' }, { status: 404 });
    if (solicitud.codigoProceso && registro.procesoCodigo && solicitud.codigoProceso !== registro.procesoCodigo) {
      return NextResponse.json({ ok: false, error: 'SOLICITUD_NO_CORRESPONDE', mensaje: 'La solicitud no corresponde a este costeo (el código de proceso no coincide).' }, { status: 409 });
    }

    const payload = armarPayloadContratos({
      solicitud,
      procesoCodigo: registro.procesoCodigo,
      resultado: obtenerModulo<ResultadoGuardado>(registro.datos, 'resultado')?.datos ?? null,
    });
    const r = await enviarAlPuente(payload);

    // Auditoría sin datos del cliente: solo ids, el resultado y la huella del contenido enviado.
    void auditFromRequest(req, session, {
      accion: 'CONTRATOS_PUENTE_ENVIO',
      recurso: 'costos-estructura',
      recursoId: String(registro.id),
      detalle: { solicitudId, resultado: r.ok ? 'OK' : r.tipo, ...(r.ok ? { modo: r.modo, huella: r.huella, advertencias: r.advertencias.length } : {}) },
    });

    if (r.ok) {
      const nota = r.modo === 'dry-run' ? ' (modo prueba: aún no se escribe en Contratos)' : '';
      const avisos = r.advertencias.length > 0 ? ` Quedan por completar en Contratos: ${r.advertencias.map((a) => etiquetaCampo(a.campo)).join(', ')}.` : '';
      return NextResponse.json({ ok: true, modo: r.modo, huella: r.huella, advertencias: r.advertencias, mensaje: `Datos validados por el puente de Contratos${nota}.${avisos}` });
    }
    switch (r.tipo) {
      case 'NO_CONFIGURADO':
        return NextResponse.json({ ok: false, error: 'PUENTE_NO_CONFIGURADO', mensaje: 'La integración con Contratos aún no está habilitada en este ambiente.' }, { status: 503 });
      case 'DATOS_INVALIDOS':
        return NextResponse.json({ ok: false, error: 'DATOS_INVALIDOS', mensaje: `Corrija antes de enviar: ${r.errores.map(describirError).join(' · ')}`, errores: r.errores }, { status: 422 });
      case 'TIMEOUT':
        return NextResponse.json({ ok: false, error: 'PUENTE_TIMEOUT', mensaje: r.mensaje }, { status: 504 });
      default:
        return NextResponse.json({ ok: false, error: 'PUENTE_NO_DISPONIBLE', mensaje: r.mensaje }, { status: 502 });
    }
  } catch (e) {
    console.error('[POST /api/costos-estructura/[id]/enviar-a-contratos]', e);
    return NextResponse.json({ ok: false, error: 'ERROR_ENVIO_CONTRATOS', mensaje: 'No se pudo enviar a Contratos. Intente de nuevo.' }, { status: 500 });
  }
}
