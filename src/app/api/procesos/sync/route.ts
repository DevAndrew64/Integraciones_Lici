import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireAdminOrN8N } from '@/lib/authz';
import {
  fachadaSync,
  SyncModoDataApiNoHabilitadoError,
  OperacionMigradaDataApiError,
} from '@/lib/data-api/sync/fachadaSync';
import {
  puedeActualizarProcesoDesdeFuenteExterna,
  puedeRevalidarLinkExistente,
  resolverProcesoIdParaRevalidacionLink,
} from '@/lib/proceso-identidad';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

let syncProcesosRunning = false;

type SyncBody = {
  maxResultados?: number;
  limitPorPagina?: number;
  silencioso?: boolean;
  auto?: boolean;
  forzar?: boolean;
  debugProceso?: string;
  filtrarNuevos?: boolean;
  paginaInicio?: number;
  sinCutoff?: boolean;      // true = traer procesos de cualquier fecha
  cutoffFecha?: string;     // "YYYY-MM-DD" = cutoff personalizado
  // Revalidación explícita y dirigida del linkDetalle (solo S2) — nunca se
  // activa sola: requiere el flag `revalidarLink:true`. La identidad de
  // escritura se resuelve por procesoId/externalId (nunca por `debugProceso`
  // /codigoProceso a secas — puede repetirse entre entidades, ej. SAMC-001-2026).
  // `entidad` solo se usa si hace falta el fallback código+entidad.
  // `debugProceso` es aquí únicamente diagnóstico/fallback, no identidad principal.
  revalidarLink?: boolean;
  procesoId?: number;
  externalId?: string;
  entidad?: string;
};

function toPositiveInt(value: unknown, fallback: number, max?: number) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) return fallback;

  const int = Math.floor(n);

  return typeof max === 'number' ? Math.min(int, max) : int;
}

async function ejecutarSync(body: SyncBody) {
  const esAuto = body?.silencioso === true || body?.auto === true;

  const maxResultadosDefault = esAuto ? 300 : 3000;
  const limitPorPaginaDefault = 30;

  const maxResultados = toPositiveInt(
    body?.maxResultados,
    maxResultadosDefault,
    5000
  );

  const limitPorPagina = toPositiveInt(
    body?.limitPorPagina,
    limitPorPaginaDefault,
    100
  );

  const forzar = body?.forzar === true;
  // filtrarNuevos solo si se pasa explícitamente — NO forzar en auto:
  // con filtrar_nuevos=1 el portal externo omite procesos existentes aunque hayan cambiado de estado
  const filtrarNuevos = body?.filtrarNuevos === true;

  const debugProceso =
    typeof body?.debugProceso === 'string'
      ? body.debugProceso.trim()
      : '';

  const paginaInicio = toPositiveInt(body?.paginaInicio, 1);

  // cutoffCreacion: null = sin límite (traer cualquier fecha)
  // cutoffFecha = fecha personalizada ISO "YYYY-MM-DD"
  // por defecto = primer día del mes actual
  let cutoffCreacion: Date | null | undefined = undefined;
  if (body?.sinCutoff === true) {
    cutoffCreacion = null;
  } else if (typeof body?.cutoffFecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.cutoffFecha)) {
    cutoffCreacion = new Date(body.cutoffFecha + 'T00:00:00');
  }

  const rSync = await fachadaSync.sincronizarProcesos({
    maxResultados,
    limitPorPagina,
    forzar,
    debugProceso,
    filtrarNuevos,
    paginaInicio,
    ...(cutoffCreacion !== undefined ? { cutoffCreacion } : {}),
  });

  if (rSync.estado === 'deshabilitado') {
    return NextResponse.json(
      { ok: false, deshabilitado: true, mensaje: rSync.mensaje, modo: esAuto ? 'automatico' : 'manual' },
      { status: 503 }
    );
  }
  const metrics = rSync.datos;

  // ── Resolver linkDetalle de todos los procesos pendientes sin link ───────────
  // Corre en modo manual siempre — incluye pendientes históricos + recién sincronizados
  let linksResueltos = 0;
  let linksFallidos  = 0;
  if (!esAuto) {
    try {
      const sinLink = await prisma.proceso.findMany({
        where: {
          AND: [
            { OR: [{ linkDetalle: null }, { linkDetalle: '' }] },
            {
              // D8/D16 — `aliasFuente IN (...)` a secas nunca seleccionaba
              // ninguna fila Data API (esa columna nunca se escribe para
              // esas filas); con `resolverLinkProceso` ya conectado a la
              // Data API real, este bucle necesita el mismo fallback a
              // origenFuncional para poder encontrarlas. La rama legacy se
              // conserva para filas anteriores al cutover.
              OR: [
                { aliasFuente: { in: ['S1', 'S2', 'NC'] } },
                { AND: [{ disponibleDataApi: true }, { origenFuncional: { in: ['PUBLICO_ABIERTO', 'PUBLICO_REGISTRADO'] } }] },
              ],
            },
            { OR: [{ oculto: false }, { oculto: null }] },
          ],
        },
        orderBy: [{ scraperIntentos: 'asc' }, { fechaPublicacion: 'desc' }],
        take: 30,
        select: { id: true },
      });

      for (let i = 0; i < sinLink.length; i++) {
        const rf = await fachadaSync.resolverLinkProceso(sinLink[i].id);
        if (rf.estado === 'ejecutado' && rf.datos.ok) linksResueltos++; else linksFallidos++;
        if (i < sinLink.length - 1) await new Promise(res => setTimeout(res, 2000));
      }
    } catch (err) {
      console.error('[sync POST] resolver-links falló', err instanceof Error ? err.message : err);
    }
  }

  // ── Revalidación dirigida del enlace principal (solo S2) ─────────────────
  // Requiere el flag explícito `revalidarLink:true`. La identidad de escritura
  // se resuelve SIEMPRE por procesoId/externalId primero (resolverProcesoIdParaRevalidacionLink);
  // `debugProceso`/codigoProceso solo se usa como fallback controlado junto con
  // `entidad`, y se rechaza si la coincidencia es ambigua o si procesoId+externalId
  // no corresponden al mismo Proceso. Nunca corre en sync masiva/auto, y nunca
  // en procesos NC/S1 (ver puedeRevalidarLinkExistente).
  let linkRevalidado: { procesoId: number; cambioDetectado: boolean; actualizado: boolean } | null = null;
  if (!esAuto && body?.revalidarLink === true) {
    try {
      const resolucion = await resolverProcesoIdParaRevalidacionLink(prisma, {
        procesoId: body?.procesoId ?? null,
        externalId: body?.externalId ?? null,
        codigoProceso: debugProceso || null,
        entidad: body?.entidad ?? null,
      });

      if (!resolucion.ok) {
        console.warn('[sync POST] revalidarLink: identidad no resuelta de forma segura', resolucion.motivo, {
          procesoId: body?.procesoId ?? null,
          externalId: body?.externalId ?? null,
          debugProceso: debugProceso || null,
        });
      } else {
        const proc = await prisma.proceso.findUnique({
          where: { id: resolucion.procesoId },
          select: { id: true, aliasFuente: true, externalId: true, sourceKey: true, codigoProceso: true },
        });
        if (proc && puedeRevalidarLinkExistente(proc)) {
          const rf = await fachadaSync.revalidarLinkProceso(proc.id, { persistir: true });
          const r = rf.estado === 'ejecutado'
            ? rf.datos
            : { cambioDetectado: false, actualizado: false } as { cambioDetectado: boolean; actualizado: boolean };
          linkRevalidado = { procesoId: proc.id, cambioDetectado: r.cambioDetectado, actualizado: r.actualizado };
          if (r.actualizado) {
            await propagarEstadoFuenteSolicitudes(proc.codigoProceso ?? debugProceso ?? '', { procesoId: proc.id, externalId: proc.externalId });
          }
        }
      }
    } catch (err) {
      console.error('[sync POST] revalidarLink falló', err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json(
    {
      ...metrics,
      linksResueltos,
      linksFallidos,
      linkRevalidado,
      modo: esAuto ? 'automatico' : 'manual',
      parametros: {
        maxResultados,
        limitPorPagina,
        forzar,
        filtrarNuevos,
        paginaInicio,
        debugProceso: debugProceso || null,
        revalidarLink: body?.revalidarLink === true,
      },
    },
    {
      status: metrics.ok ? 200 : 500,
    }
  );
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireAdminOrN8N(req, session);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as SyncBody;

    return await ejecutarSync(body);
  } catch (error) {
    if (error instanceof OperacionMigradaDataApiError) {
      return NextResponse.json({ ok: false, migrado: true, error: error.message }, { status: error.httpStatus });
    }
    if (error instanceof SyncModoDataApiNoHabilitadoError) {
      console.error('[POST /api/procesos/sync] modo data-api no habilitado');
      return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
    }
    console.error('[POST /api/procesos/sync]', error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Error al sincronizar procesos.',
      },
      { status: 500 }
    );
  }
}

// 300 procesos / 30 por página = 10 páginas por sync
// ceil(4581 / 300) = 16 batches para cubrir todos los procesos (~4 días con 4 syncs/día)
const PAGINAS_POR_SYNC = 10;
const CICLO_BATCHES = 16;

export async function GET(req: NextRequest) {
  if (syncProcesosRunning) {
    return NextResponse.json({ ok: true, skipped: true, motivo: 'sync ya en curso' }, { status: 429 });
  }
  syncProcesosRunning = true;
  try {
    // ?batch=0..15 para barrido manual; ?paginaInicio=N para página exacta
    const url = new URL(req.url);
    const batchParam = url.searchParams.get('batch');
    const paginaParam = url.searchParams.get('paginaInicio');

    let paginaInicio: number;
    if (paginaParam && Number.isInteger(Number(paginaParam)) && Number(paginaParam) >= 1) {
      paginaInicio = Number(paginaParam);
    } else if (batchParam !== null && Number.isInteger(Number(batchParam))) {
      const batch = Math.max(0, Math.min(Number(batchParam), CICLO_BATCHES - 1));
      paginaInicio = batch * PAGINAS_POR_SYNC + 1;
    } else {
      // Auto: ventana de 4h → batch diferente cada llamada del cron
      const ventanas4h = Math.floor(Date.now() / (4 * 60 * 60 * 1000));
      const batchIndex = ventanas4h % CICLO_BATCHES;
      paginaInicio = batchIndex * PAGINAS_POR_SYNC + 1;
    }

    return await ejecutarSync({
      maxResultados: 300,
      limitPorPagina: 30,
      silencioso: true,
      auto: true,
      forzar: false,
      paginaInicio,
      // Sin filtrarNuevos: trae los 300 del batch actual en orden descendente,
      // incluyendo procesos nuevos y actualizados (cambio de estado, fechas, docs)
    });
  } catch (error) {
    if (error instanceof OperacionMigradaDataApiError) {
      return NextResponse.json({ ok: false, migrado: true, error: error.message }, { status: error.httpStatus });
    }
    if (error instanceof SyncModoDataApiNoHabilitadoError) {
      console.error('[GET /api/procesos/sync] modo data-api no habilitado');
      return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
    }
    console.error('[GET /api/procesos/sync]', error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Error al sincronizar procesos automáticamente.',
      },
      { status: 500 }
    );
  } finally {
    syncProcesosRunning = false;
  }
}

async function propagarEstadoFuenteSolicitudes(
  codigoProceso: string,
  opts?: { procesoId?: number | null; externalId?: string | null }
): Promise<void> {
  try {
    // `codigoProceso` NO es único en SECOP (varias entidades pueden compartir el mismo
    // número visible). Solo se resuelve el Proceso por codigoProceso cuando el caller no
    // trae un identificador preciso (procesoId/externalId) Y además ese código es
    // inequívoco en BD; si hay más de una entidad con el mismo código y no vino un
    // identificador preciso, se aborta sin propagar en vez de adivinar.
    let proceso: { id: number; sourceKey: string; externalId: string | null; estadoFuente: string | null; fechaVencimiento: Date | null; linkDetalle: string | null; linkSecop: string | null; linkSecopReg: string | null } | null = null;

    if (opts?.procesoId) {
      proceso = await prisma.proceso.findUnique({
        where: { id: opts.procesoId },
        select: { id: true, sourceKey: true, externalId: true, estadoFuente: true, fechaVencimiento: true, linkDetalle: true, linkSecop: true, linkSecopReg: true },
      });
    } else if (opts?.externalId) {
      proceso = await prisma.proceso.findFirst({
        where: { externalId: opts.externalId },
        select: { id: true, sourceKey: true, externalId: true, estadoFuente: true, fechaVencimiento: true, linkDetalle: true, linkSecop: true, linkSecopReg: true },
      });
    } else {
      const candidatos = await prisma.proceso.findMany({
        where: { codigoProceso },
        select: { id: true, entidad: true },
      });
      if (candidatos.length > 1) {
        console.warn(
          '[PUT sync] codigoProceso ambiguo entre varias entidades — no se propaga automáticamente',
          codigoProceso,
          candidatos.map((c) => ({ id: c.id, entidad: c.entidad }))
        );
        return;
      }
      if (candidatos.length === 1) {
        proceso = await prisma.proceso.findUnique({
          where: { id: candidatos[0].id },
          select: { id: true, sourceKey: true, externalId: true, estadoFuente: true, fechaVencimiento: true, linkDetalle: true, linkSecop: true, linkSecopReg: true },
        });
      }
    }
    if (!proceso) return;

    const data: Record<string, unknown> = {};
    if (proceso.estadoFuente) data.estadoFuente = proceso.estadoFuente;
    if (proceso.fechaVencimiento) data.fechaVencimiento = proceso.fechaVencimiento;
    if (proceso.linkDetalle) data.linkDetalle = proceso.linkDetalle;
    if (proceso.linkSecop) data.linkSecop = proceso.linkSecop;
    if (proceso.linkSecopReg) data.linkSecopReg = proceso.linkSecopReg;
    if (Object.keys(data).length === 0) return;

    // Match seguro: procesoId exacto o externalId (idContrato real del portal externo,
    // único por proceso aunque el código se repita entre entidades). Nunca por codigoProceso.
    const matchSeguro = {
      OR: [
        { procesoId: proceso.id },
        ...(proceso.externalId ? [{ externalId: proceso.externalId }] : []),
      ],
    };
    const candidatas = await prisma.solicitud.count({ where: matchSeguro });
    if (candidatas === 0) {
      console.log('[PUT sync] sin Solicitud vinculada de forma segura (procesoId/externalId) — no se propaga', codigoProceso, proceso.externalId);
      return;
    }
    await prisma.solicitud.updateMany({ where: matchSeguro, data });
    console.log('[PUT sync] estadoFuente/fechaVencimiento/link propagados a solicitudes', codigoProceso, data);
  } catch (e) {
    console.warn('[PUT sync] error propagando estadoFuente/fechaVencimiento', codigoProceso, e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { codigoProceso, procesoId, externalId } = await req.json();
    if (!codigoProceso) {
      return NextResponse.json({ ok: false, error: 'codigoProceso requerido' }, { status: 400 });
    }
    const procesoIdNum = Number.isFinite(Number(procesoId)) && Number(procesoId) > 0 ? Number(procesoId) : null;
    const externalIdStr = typeof externalId === 'string' && externalId.trim() ? externalId.trim() : null;

    // Protección: rechazar sincronización de procesos manuales ANTES de
    // llamar a la fuente externa o tocar la base de datos — nunca por
    // codigoProceso solo cuando hay más de una entidad con ese código (se
    // deja sin validar en ese caso, igual que el resto de este endpoint).
    const SELECT_VALIDACION = { id: true, externalId: true, sourceKey: true } as const;
    let procesoParaValidar: { id: number; externalId: string | null; sourceKey: string } | null = null;
    if (procesoIdNum) {
      procesoParaValidar = await prisma.proceso.findUnique({ where: { id: procesoIdNum }, select: SELECT_VALIDACION });
      if (!procesoParaValidar) {
        return NextResponse.json({ ok: false, error: 'Proceso no encontrado.' }, { status: 404 });
      }
    } else if (externalIdStr) {
      procesoParaValidar = await prisma.proceso.findFirst({ where: { externalId: externalIdStr }, select: SELECT_VALIDACION });
    } else {
      const candidatos = await prisma.proceso.findMany({ where: { codigoProceso }, select: SELECT_VALIDACION });
      if (candidatos.length === 1) procesoParaValidar = candidatos[0];
    }

    if (procesoParaValidar && !puedeActualizarProcesoDesdeFuenteExterna(procesoParaValidar)) {
      return NextResponse.json(
        { ok: false, error: 'Este proceso fue creado manualmente y no tiene una fuente externa para actualizar.' },
        { status: 409 }
      );
    }

    // Busca primero con ascending:1 (más antiguos primero) — procesos que llevan días
    // sin modificarse aparecen en páginas tempranas de ascending:1 pero en páginas 80+
    // de ascending:0, lo que hace que ascending:0 no los encuentre en 120 páginas.
    const rAsc = await fachadaSync.sincronizarProcesos({
      maxResultados: 3600,
      limitPorPagina: 30,
      forzar: true,
      debugProceso: codigoProceso,
      soloEste: codigoProceso,
      ascending: 1,
      cutoffCreacion: null,
    });
    if (rAsc.estado === 'deshabilitado') {
      return NextResponse.json({ ok: false, deshabilitado: true, mensaje: rAsc.mensaje, modo: 'puntual' }, { status: 503 });
    }
    const metricsAsc = rAsc.datos;

    // Helper: resolver/revalidar linkDetalle tras encontrar el proceso — codigoProceso NO
    // es único, así que se prioriza procesoId/externalId cuando el caller los trae; si no
    // vienen y hay más de una entidad con el mismo código, se aborta en vez de tomar una
    // arbitraria. Si el proceso ya tiene linkDetalle Y es S2, se REVALIDA (el principal
    // puede haber cambiado); si es S1/NC, se conserva el comportamiento actual (nunca
    // se re-consulta solo por tener ya un valor).
    const resolverLink = async (): Promise<{ linkDetalle?: string; tipoFuente?: string; linkResuelto?: boolean; cambioDetectado?: boolean }> => {
      try {
        let proc: { id: number; linkDetalle: string | null; aliasFuente: string | null; externalId: string | null; sourceKey: string } | null = null;
        const SELECT_LINK = { id: true, linkDetalle: true, aliasFuente: true, externalId: true, sourceKey: true } as const;
        if (procesoIdNum) {
          proc = await prisma.proceso.findUnique({ where: { id: procesoIdNum }, select: SELECT_LINK });
        } else if (externalIdStr) {
          proc = await prisma.proceso.findFirst({ where: { externalId: externalIdStr }, select: SELECT_LINK });
        } else {
          const candidatos = await prisma.proceso.findMany({ where: { codigoProceso }, select: { id: true, entidad: true } });
          if (candidatos.length > 1) {
            console.warn('[PUT sync] resolverLink: codigoProceso ambiguo, se omite resolución de link', codigoProceso, candidatos.map((c) => ({ id: c.id, entidad: c.entidad })));
            return {};
          }
          if (candidatos.length === 1) {
            proc = await prisma.proceso.findUnique({ where: { id: candidatos[0].id }, select: SELECT_LINK });
          }
        }
        if (!proc) return {};

        if (proc.linkDetalle?.trim() && puedeRevalidarLinkExistente(proc)) {
          const rf = await fachadaSync.revalidarLinkProceso(proc.id, { persistir: true });
          if (rf.estado !== 'ejecutado') return {};
          const r = rf.datos;
          return {
            linkDetalle: (r.actualizado ? r.linkPrincipalActual : r.linkAnterior) ?? undefined,
            tipoFuente: r.fuenteResolucion ?? undefined,
            linkResuelto: r.actualizado,
            cambioDetectado: r.cambioDetectado,
          };
        }

        if (proc.linkDetalle?.trim()) {
          // S1/NC con link ya existente: se conserva, sin re-consultar la fuente externa.
          return { linkDetalle: proc.linkDetalle, linkResuelto: false };
        }

        // Sin link todavía (cualquier fuente): modo completar, sin cambios de comportamiento.
        const rf = await fachadaSync.resolverLinkProceso(proc.id);
        if (rf.estado !== 'ejecutado') return {};
        const r = rf.datos;
        return { linkDetalle: r.linkDetalle, tipoFuente: r.tipoFuente, linkResuelto: r.ok };
      } catch (e) {
        console.warn('[PUT sync] resolverLink falló', codigoProceso, e instanceof Error ? e.message : e);
        return {};
      }
    };

    // Si el proceso fue encontrado en ascending:1 (recibidos>0), no correr ascending:0.
    // Evita que versiones distintas del mismo proceso en la API dupliquen documentos.
    if (metricsAsc.recibidos > 0) {
      const linkData = await resolverLink();
      // Propagar DESPUÉS de resolver/revalidar el link, para que la propagación
      // incluya el linkDetalle recién actualizado (no el valor previo a la revalidación).
      await propagarEstadoFuenteSolicitudes(codigoProceso, { procesoId: procesoIdNum, externalId: externalIdStr });
      return NextResponse.json({ ...metricsAsc, ...linkData, modo: 'puntual' }, { status: 200 });
    }

    // Si no se encontró con ascending:1, intentar con ascending:0 (más recientes primero)
    const rDesc = await fachadaSync.sincronizarProcesos({
      maxResultados: 3600,
      limitPorPagina: 30,
      forzar: true,
      debugProceso: codigoProceso,
      soloEste: codigoProceso,
      ascending: 0,
      cutoffCreacion: null,
    });
    if (rDesc.estado === 'deshabilitado') {
      return NextResponse.json({ ok: false, deshabilitado: true, mensaje: rDesc.mensaje, modo: 'puntual' }, { status: 503 });
    }
    const metricsDesc = rDesc.datos;

    const linkData = await resolverLink();
    // Propagar DESPUÉS de resolver/revalidar el link (mismo motivo que en el branch anterior).
    await propagarEstadoFuenteSolicitudes(codigoProceso, { procesoId: procesoIdNum, externalId: externalIdStr });

    const merged = {
      ...metricsDesc,
      ...linkData,
      paginasConsultadas: metricsAsc.paginasConsultadas + metricsDesc.paginasConsultadas,
    };
    return NextResponse.json({ ...merged, modo: 'puntual' }, { status: merged.ok ? 200 : 500 });
  } catch (error) {
    if (error instanceof OperacionMigradaDataApiError) {
      // Cutover activo: la actualización dirigida de un proceso concreto está
      // migrada — la cubre la sincronización periódica vía Data API.
      return NextResponse.json(
        { ok: false, migrado: true, error: error.message, modo: 'puntual' },
        { status: error.httpStatus },
      );
    }
    if (error instanceof SyncModoDataApiNoHabilitadoError) {
      return NextResponse.json({ ok: false, error: error.message, modo: 'puntual' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Error' }, { status: 500 });
  }
}