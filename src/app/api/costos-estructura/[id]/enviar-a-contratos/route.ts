import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireEditarCostos } from '@/lib/authz';
import { auditFromRequest } from '@/lib/audit';
import { CLAVES_MODULO_NO_APLICA, obtenerModulo, resolverPendientesModulos } from '@/lib/costos-estructura/guardado-modular';
import type { ClaveModulo, EstadoModuloResultado } from '@/lib/costos-estructura/guardado-modular';
import { validarCostosPantallaDto, type CostosPantallaDto } from '@/lib/costos-estructura/exportacion/costos-pantalla';
import type { ResultadoGuardado } from '@/lib/costos-estructura/exportacion/contratos';
import { cargosParaPuente, validarCargosPantalla } from '@/lib/contratos-puente/cargos';
import { enviarAlPuente } from '@/lib/contratos-puente/cliente';
import { armarPayloadContratos, describirCampo, describirError, etiquetaCampo, insumosParaPuente, leerDestino } from '@/lib/contratos-puente/payload';

/**
 * Puente a Contratos (módulos 2 y 4) — envía a Contratos (vía `puente-contratos/`) los datos de la oferta con el JSON v1:
 * razón social, NIT, dirección, objeto, % A.I.U. (el % de I.U. del costeo), valor mensual, plazo, la clave de la oferta
 * (empresa, UEN, tipo de tarifa, origen y concepto, que elige quien envía) y los seis valores de la tarifa. En modo prueba
 * el puente valida y NO escribe; en modo escritura crea la oferta en Contratos y responde su número.
 *
 * Mismo criterio que el export: los módulos de costos deben estar resueltos (fuente de verdad server-side) y los totales
 * llegan de la pantalla (`costosDto`, validado). El vínculo Solicitud↔Costeo es EXPLÍCITO: la pantalla manda el
 * `solicitudId` de la ficha desde la que se abrió el costeo, y el servidor comprueba que el código de proceso coincida.
 * Lee `Resultado` de lo guardado: sin esa pestaña guardada el valor mensual, el plazo, el A.I.U. y la tarifa viajan vacíos.
 * Solo se envía con la solicitud cerrada como Adjudicada; lo enviado queda pactado (un reenvío responde 409 y no cambia nada).
 * Requiere el permiso de editar costos (Administrador o Equipo Comercial).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const denied = requireEditarCostos(session);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as { solicitudId?: unknown; costosDto?: unknown; contratos?: unknown; cargos?: unknown } | null;
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

    // Módulo 5: las líneas de cargo de la pantalla deben sumar la Mano de Obra del panel; si no, no se envía nada.
    let cargos: ReturnType<typeof cargosParaPuente> | null = null;
    if (body?.cargos !== undefined && body.cargos !== null) {
      const vc = validarCargosPantalla(body.cargos, (body.costosDto as CostosPantallaDto).totales.manoObra);
      if (!vc.ok) return NextResponse.json({ ok: false, error: 'CARGOS_INVALIDOS', mensaje: `Los cargos de la pantalla no son válidos: ${vc.errores.join(' ')} Recargue e intente de nuevo.` }, { status: 400 });
      cargos = cargosParaPuente(vc.cargos);
    }

    // `select` explícito: no depende de columnas ajenas a este envío (incidente «column does not exist»).
    const solicitud = await prisma.solicitud.findUnique({
      where: { id: solicitudId },
      select: { id: true, codigoProceso: true, resultadoFinal: true, entidad: true, objeto: true, nitContacto: true, direccionContacto: true },
    });
    if (!solicitud) return NextResponse.json({ ok: false, error: 'SOLICITUD_NO_ENCONTRADA', mensaje: 'La solicitud no existe.' }, { status: 404 });
    if (solicitud.resultadoFinal !== 'Adjudicado') {
      return NextResponse.json({ ok: false, error: 'SOLICITUD_NO_ADJUDICADA', mensaje: 'Solo se puede enviar a Contratos un proceso Adjudicado. Cierre la solicitud como Adjudicada y vuelva a intentarlo.' }, { status: 409 });
    }
    if (solicitud.codigoProceso && registro.procesoCodigo && solicitud.codigoProceso !== registro.procesoCodigo) {
      return NextResponse.json({ ok: false, error: 'SOLICITUD_NO_CORRESPONDE', mensaje: 'La solicitud no corresponde a este costeo (el código de proceso no coincide).' }, { status: 409 });
    }

    const payload = armarPayloadContratos({
      solicitud,
      procesoCodigo: registro.procesoCodigo,
      resultado: obtenerModulo<ResultadoGuardado>(registro.datos, 'resultado')?.datos ?? null,
      totales: (body?.costosDto as CostosPantallaDto).totales, // ya validado arriba
      destino: leerDestino(body?.contratos),
      cargos,
      insumos: insumosParaPuente((body?.costosDto as CostosPantallaDto).insumos?.filas),
    });
    const r = await enviarAlPuente(payload);

    // Auditoría sin datos del cliente: solo ids, el resultado y la huella del contenido enviado.
    void auditFromRequest(req, session, {
      accion: 'CONTRATOS_PUENTE_ENVIO',
      recurso: 'costos-estructura',
      recursoId: String(registro.id),
      detalle: {
        solicitudId,
        resultado: r.ok ? 'OK' : r.tipo,
        ...(r.ok ? { modo: r.modo, huella: r.huella, advertencias: r.advertencias.length, ...(r.oferta ?? {}) } : {}),
        ...(!r.ok && r.tipo === 'YA_ENVIADA' ? (r.oferta ?? {}) : {}),
      },
    });

    if (r.ok) {
      const creada = r.oferta ? `Oferta ${r.oferta.numOferta} creada en Contratos (empresa ${r.oferta.empresa}, UEN ${r.oferta.undnegocio}).` : null;
      const nota = r.modo === 'dry-run' ? ' (modo prueba: aún no se escribe en Contratos)' : '';
      const avisos = r.advertencias.length > 0 ? ` Quedan por revisar: ${r.advertencias.map((a) => describirCampo(a.campo, payload.cargos)).join(', ')}.` : '';
      const etiquetaNoEscrito = (campo: string) => (campo === 'cargos' ? 'sección, estudios, dotación, bonos y recargos de los cargos' : etiquetaCampo(campo));
      const aparte = r.noEscrito.length > 0 ? ` Se digitan en Contratos: ${r.noEscrito.map((n) => etiquetaNoEscrito(n.campo)).join(', ')}.` : '';
      return NextResponse.json({
        ok: true,
        modo: r.modo,
        huella: r.huella,
        advertencias: r.advertencias,
        oferta: r.oferta,
        noEscrito: r.noEscrito,
        mensaje: `${creada ?? `Datos validados por el puente de Contratos${nota}.`}${avisos}${aparte}`,
      });
    }
    switch (r.tipo) {
      case 'NO_CONFIGURADO':
        return NextResponse.json({ ok: false, error: 'PUENTE_NO_CONFIGURADO', mensaje: 'La integración con Contratos aún no está habilitada en este ambiente.' }, { status: 503 });
      case 'DATOS_INVALIDOS':
        return NextResponse.json({ ok: false, error: 'DATOS_INVALIDOS', mensaje: `Corrija antes de enviar: ${r.errores.map((e) => describirError(e, payload.cargos)).join(' · ')}`, errores: r.errores }, { status: 422 });
      case 'YA_ENVIADA': {
        const donde = r.oferta ? ` como la oferta ${r.oferta.numOferta} (empresa ${r.oferta.empresa}, UEN ${r.oferta.undnegocio})` : '';
        const cambios = r.sinCambios ? '' : ' Los datos cambiaron desde entonces: Contratos conserva lo enviado la primera vez; modifíquelo allá.';
        return NextResponse.json({ ok: false, error: 'YA_ENVIADA', mensaje: `Esta solicitud ya se envió a Contratos${donde}.${cambios}`, oferta: r.oferta, sinCambios: r.sinCambios }, { status: 409 });
      }
      case 'CONFLICTO':
        return NextResponse.json({ ok: false, error: r.codigo, mensaje: r.mensaje }, { status: 409 });
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

/**
 * GET ?solicitudId=N — ¿esa solicitud ya se envió a Contratos? Se deduce de la auditoría del envío (solo cuentan los
 * envíos que escribieron en Contratos o los reenvíos rechazados por ya existir); un envío en modo prueba no cuenta.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const denied = requireEditarCostos(session);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const solicitudId = Number(new URL(req.url).searchParams.get('solicitudId'));
    if (!Number.isInteger(solicitudId) || solicitudId < 1) {
      return NextResponse.json({ ok: false, error: 'SOLICITUD_REQUERIDA', mensaje: 'Falta la solicitud.' }, { status: 400 });
    }
    const envios = await prisma.auditLog.findMany({
      where: { accion: 'CONTRATOS_PUENTE_ENVIO', recurso: 'costos-estructura', recursoId: String(Number(id)) },
      orderBy: { creadoEn: 'desc' },
      take: 50,
      select: { detalle: true, creadoEn: true },
    });
    const enviado = envios.find(({ detalle }) => {
      const d = (detalle ?? {}) as Record<string, unknown>;
      return d.solicitudId === solicitudId && (d.resultado === 'YA_ENVIADA' || (d.resultado === 'OK' && d.modo !== 'dry-run'));
    });
    if (!enviado) return NextResponse.json({ ok: true, enviada: false });
    const d = enviado.detalle as Record<string, unknown>;
    const oferta = d.numOferta != null ? { numOferta: d.numOferta, empresa: d.empresa ?? null, undnegocio: d.undnegocio ?? null } : null;
    return NextResponse.json({ ok: true, enviada: true, oferta, fecha: enviado.creadoEn });
  } catch (e) {
    console.error('[GET /api/costos-estructura/[id]/enviar-a-contratos]', e);
    return NextResponse.json({ ok: false, error: 'ERROR_CONSULTA_ENVIO', mensaje: 'No se pudo consultar si ya se envió a Contratos.' }, { status: 500 });
  }
}
