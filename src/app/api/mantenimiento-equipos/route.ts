import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession, hasPermiso } from '@/lib/authz';

export const dynamic = 'force-dynamic';

/**
 * Ajuste "DIAGNOSTICAR E IMPORTAR LA BASE DE TARIFAS DE MANTENIMIENTO DE
 * EQUIPOS" ETAPA 7 — API interna de SOLO CONSULTA sobre
 * TarifaMantenimientoEquipo (histórico por contrato/sitio, nunca una
 * tarifa "oficial" única — ver comentario del modelo en schema.prisma).
 * La pestaña Maquinaria y Equipos consume esta API, nunca el Excel
 * directamente.
 *
 * Requiere sesión + permiso 'ver_equipos' (mismo permiso ya usado por el
 * módulo "Equipos" existente — no se inventa uno nuevo en esta etapa; la
 * separación import/editar/activar de ETAPA 9 queda para cuando esas
 * acciones se implementen realmente).
 *
 * IMPORTANTE: esta ruta consulta la tabla `TarifaMantenimientoEquipo`,
 * que todavía NO está migrada en la base de datos (solo existe en
 * schema.prisma + Prisma Client regenerado) — devolverá un error 500
 * hasta que se apruebe y ejecute la migración. Se entrega así,
 * deliberadamente, para completar el contrato de API sin migrar.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  if (!(await hasPermiso(session!, 'ver_equipos'))) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const empresaPrestadora = searchParams.get('empresaPrestadora')?.trim() || undefined;
    const uen = searchParams.get('uen')?.trim() || undefined;
    const grupoActivo = searchParams.get('grupoActivo')?.trim() || undefined;
    const tipoActivo = searchParams.get('tipoActivo')?.trim() || undefined;
    const subtipoActivo = searchParams.get('subtipoActivo')?.trim() || undefined;
    const cliente = searchParams.get('cliente')?.trim() || undefined;
    const contrato = searchParams.get('contrato')?.trim() || undefined;
    const puntoEntrega = searchParams.get('puntoEntrega')?.trim() || undefined;
    const busqueda = searchParams.get('busqueda')?.trim() || undefined;
    const activoParam = searchParams.get('activo');
    // Por defecto solo activo=true — un usuario que necesite ver
    // inactivas debe pedirlo explícitamente (?activo=false o ?activo=todos).
    const activo = activoParam === 'todos' ? undefined : activoParam !== 'false';
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 50));

    const where: Record<string, unknown> = {};
    if (empresaPrestadora) where.empresaPrestadora = empresaPrestadora;
    if (uen) where.uen = uen;
    if (grupoActivo) where.grupoActivo = grupoActivo;
    if (tipoActivo) where.tipoActivo = tipoActivo;
    if (subtipoActivo) where.subtipoActivo = subtipoActivo;
    if (contrato) where.contrato = contrato;
    if (puntoEntrega) where.puntoEntrega = puntoEntrega;
    if (cliente) where.clienteRazonSocial = { contains: cliente, mode: 'insensitive' };
    if (busqueda) where.descripcionEquipo = { contains: busqueda, mode: 'insensitive' };
    if (activo !== undefined) where.activo = activo;

    const [total, filas] = await Promise.all([
      prisma.tarifaMantenimientoEquipo.count({ where }),
      prisma.tarifaMantenimientoEquipo.findMany({
        where,
        orderBy: [{ grupoActivo: 'asc' }, { tipoActivo: 'asc' }, { subtipoActivo: 'asc' }, { contrato: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // Nunca selecciona una fila automáticamente — la API SIEMPRE devuelve
    // todas las coincidencias reales; la pestaña Maquinaria y Equipos es
    // quien decide mostrar el selector cuando hay más de una (§8).
    const data = filas.map(f => ({
      id: f.id,
      empresaPrestadora: f.empresaPrestadora,
      uen: f.uen,
      clienteRazonSocial: f.clienteRazonSocial,
      contrato: f.contrato,
      puntoEntrega: f.puntoEntrega,
      grupoActivo: f.grupoActivo,
      tipoActivo: f.tipoActivo,
      subtipoActivo: f.subtipoActivo,
      descripcionEquipo: f.descripcionEquipo,
      frecuencia: f.frecuencia,
      valorMesMantenimiento: f.valorMesMantenimiento,
      fuenteArchivo: f.fuenteArchivo,
      fuenteHoja: f.fuenteHoja,
      fuenteFila: f.fuenteFila,
    }));

    return NextResponse.json({
      ok: true,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      data,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error consultando tarifas de mantenimiento' },
      { status: 500 },
    );
  }
}
