import { NextRequest, NextResponse } from 'next/server';
import { buscarServiciosNoContinuos, type ServicioNoContinuoCatalogo } from '@/lib/servicios-no-continuos-buscar';
import { empresaTieneCatalogoSNCPropio } from '@/lib/costos-estructura/catalogo-snc-empresa';
import { getSession } from '@/lib/session';
import { requireSession, hasPermiso } from '@/lib/authz';

/**
 * Ajuste "SERVICIOS NO CONTINUOS — FASE 1: CATÁLOGO ASEOCOLBA" —
 * `POST /api/servicios-no-continuos-ext {empresa}` alimenta el selector
 * "Servicio no continuo" (page.tsx), mismo patrón arquitectónico que
 * `/api/equipos-activos`/`/api/dotacion-ext`/`/api/epp-ext`: el servidor es
 * quien llama a la fuente externa (nunca el navegador directamente), con
 * sesión+permiso (`ver_estructura_costos`, mismo permiso que el resto de
 * catálogos de Estructura de Costos).
 *
 * Caché en memoria del proceso por `empresa` (TTL 10 min, mismo criterio ya
 * usado en `dotacion-ext`/`epp-ext`) — la fuente no acepta búsqueda ni
 * paginación (devuelve el catálogo completo de la empresa en una sola
 * llamada), así que abrir el selector varias veces para la misma empresa
 * nunca repite la llamada externa dentro del TTL.
 */
interface EntradaCache { datos: ServicioNoContinuoCatalogo[]; obtenidoEn: number }
const TTL_CACHE_MS = 10 * 60 * 1000;
const cacheCatalogoNoContinuos = new Map<string, EntradaCache>();

async function obtenerCatalogo(empresa: string): Promise<ServicioNoContinuoCatalogo[]> {
  const entrada = cacheCatalogoNoContinuos.get(empresa);
  if (entrada && Date.now() - entrada.obtenidoEn < TTL_CACHE_MS) return entrada.datos;
  const datos = await buscarServiciosNoContinuos(empresa);
  cacheCatalogoNoContinuos.set(empresa, { datos, obtenidoEn: Date.now() });
  return datos;
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  if (!(await hasPermiso(session!, 'ver_estructura_costos'))) {
    return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const empresa = String(body.empresa ?? '').trim();
    if (!empresa) return NextResponse.json({ ok: false, error: 'Se requiere empresa' }, { status: 400 });

    // Ajuste "UNIFICACIÓN SNC — PROTECCIÓN CONTRA FALLBACK SILENCIOSO DE LA
    // API" — confirmado en vivo que la fuente externa responde 200 para
    // CUALQUIER `empresa`, pero cae de vuelta al catálogo de Aseocolba para
    // cualquiera que no sea 'aseo'/'vigi' (ver catalogo-snc-empresa.ts para
    // la evidencia completa). Nunca se confía solo en el HTTP 200 de la
    // fuente: se rechaza ANTES de invocarla, con catálogo vacío explícito
    // — nunca se expone el catálogo de otra empresa bajo ningún código no
    // reconocido.
    if (!empresaTieneCatalogoSNCPropio(empresa)) {
      return NextResponse.json({ ok: true, servicios: [] });
    }

    const servicios = await obtenerCatalogo(empresa);
    return NextResponse.json({ ok: true, servicios });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error consultando el catálogo de servicios no continuos' },
      { status: 502 },
    );
  }
}
