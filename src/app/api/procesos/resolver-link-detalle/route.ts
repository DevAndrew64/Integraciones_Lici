import { NextRequest, NextResponse } from 'next/server';
import {
  fachadaSync,
  SyncModoDataApiNoHabilitadoError,
  ESTADO_MIGRADO_DATA_API,
} from '@/lib/data-api/sync/fachadaSync';
import { resolverProcesoIdParaLinkDetalle } from '@/lib/proceso-identidad';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function validarToken(req: NextRequest): boolean {
  const esperado = process.env.N8N_SYNC_TOKEN?.trim();
  if (!esperado) return false;
  return req.headers.get('authorization') === `Bearer ${esperado}`;
}

export async function POST(req: NextRequest) {
  if (!validarToken(req)) {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });
  }

  let body: { id?: number; externalId?: string; sourceKey?: string; codigoProceso?: string; entidad?: string; perfil?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido.' }, { status: 400 });
  }

  const { id, externalId, sourceKey, codigoProceso, entidad } = body;
  if (!id && !externalId && !sourceKey && !codigoProceso) {
    return NextResponse.json({ ok: false, error: 'Se requiere id, externalId/sourceKey o codigoProceso.' }, { status: 400 });
  }

  // Identidad segura: nunca resuelve por codigoProceso solo — ver diagnóstico
  // (MC-002-2026, SAMC-001-2026, SAMC-012-2026, CM-MC-001-2026, LP-002-2026
  // existen en varias entidades con el mismo código).
  const resolucion = await resolverProcesoIdParaLinkDetalle(prisma, { id, externalId, sourceKey, codigoProceso, entidad });
  if (!resolucion.ok) {
    const mensajes: Record<typeof resolucion.motivo, string> = {
      no_encontrado: 'Proceso no encontrado.',
      ambiguo: 'El codigoProceso corresponde a más de una entidad — no se puede resolver sin desambiguar.',
      entidad_requerida: 'Se requiere entidad junto con codigoProceso para resolver sin ambigüedad.',
    };
    const status = resolucion.motivo === 'no_encontrado' ? 404 : 422;
    return NextResponse.json({ ok: false, error: mensajes[resolucion.motivo] }, { status });
  }

  let rFachada;
  try {
    rFachada = await fachadaSync.resolverLinkProceso(resolucion.procesoId);
  } catch (error) {
    if (error instanceof SyncModoDataApiNoHabilitadoError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
    }
    throw error;
  }

  if (rFachada.estado === 'deshabilitado') {
    return NextResponse.json({ ok: false, deshabilitado: true, mensaje: rFachada.mensaje }, { status: 503 });
  }

  const resultado = rFachada.datos;

  if (resultado.ok) {
    return NextResponse.json(resultado);
  }

  // Cutover activo (modo data-api): la resolución de enlace está migrada —
  // el linkDetalle llega en el bundle canónico. No hay fallback legacy.
  if (resultado.estado === ESTADO_MIGRADO_DATA_API) {
    return NextResponse.json({ ...resultado, migrado: true }, { status: 410 });
  }

  const status = resultado.estado === 'NOT_FOUND' ? 404 : 422;
  return NextResponse.json(resultado, { status });
}