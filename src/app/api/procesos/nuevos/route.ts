import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';
import { whereExcluirManual, condicionFuente } from '@/lib/data-api/origenCanonico';
import { whereProcesoIdentificable } from '@/lib/procesos/proceso-identificable';

// ── Filtro UNSPSC por perfil ───────────────────────────────────────────────
const UNSPSC_PERMITIDOS: Record<string, string[]> = {
  vigicolba: ['92121500','92121502','46171600','92101501','92121504','92121700','46171619'],
  aseocolba: ['76000000','90101700','76110000','76111500','76111501','76111503','76111504','76111505','76111506','76111600','76111601','76111602','76111603','76111604','76111605','76100000','76101500','76101501','76101502','76101503','47120000','47130000','72103300'],
  tempocolba: ['80000000','80111600','80111700','80111701'],
};

function unspscPermitido(unspsc: string | null, perfil: string | null): boolean {
  if (!unspsc || unspsc.trim() === '') return true;
  const perfilKey = (perfil ?? '').toLowerCase().trim();
  const lista = UNSPSC_PERMITIDOS[perfilKey];
  if (!lista) return true;
  const codigo = unspsc.trim().split(' ')[0];
  return lista.includes(codigo);
}

function parseIntSafe(v: string | null, fb: number) {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isNaN(n) ? fb : n;
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;
  try {
    const { searchParams } = new URL(req.url);

    const page = Math.max(1, parseIntSafe(searchParams.get('page'), 1));
    const limit = Math.min(100, Math.max(1, parseIntSafe(searchParams.get('limit'), 30)));
    const filtro = searchParams.get('filtro') ?? 'hoy';
    const desde = searchParams.get('desde') ?? null;
    const hasta = searchParams.get('hasta') ?? null;
    const perfil = searchParams.get('perfil') ?? null;
    const fuente = searchParams.get('fuente') ?? null;

    const now = new Date();

    let fechaDesde: Date | undefined;
    let fechaHasta: Date | undefined;

    if (filtro === 'hoy') {
      fechaDesde = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      fechaHasta = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    } else if (filtro === 'ayer') {
      const ayer = new Date(now);
      ayer.setDate(ayer.getDate() - 1);
      fechaDesde = new Date(ayer.getFullYear(), ayer.getMonth(), ayer.getDate(), 0, 0, 0);
      fechaHasta = new Date(ayer.getFullYear(), ayer.getMonth(), ayer.getDate(), 23, 59, 59);
    } else if (filtro === 'semana') {
      fechaDesde = new Date(now);
      fechaDesde.setDate(fechaDesde.getDate() - 6);
      fechaDesde.setHours(0, 0, 0, 0);
      fechaHasta = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    } else if (filtro === 'rango' && desde) {
      fechaDesde = new Date(`${desde}T00:00:00`);
      fechaHasta = hasta
        ? new Date(`${hasta}T23:59:59`)
        : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    }

    // B.4.5 — el feed "Nuevos" se lee directamente de `Proceso` (antes de una
    // tabla-proyección `ProcesoNuevo` que solo alimentaba el pipeline legacy).
    // Paridad exacta con el comportamiento histórico:
    //  · `fechaDeteccion` ≡ `Proceso.createdAt` (instante de detección/creación).
    //  · exclusión de altas MANUALES — `ProcesoNuevo` tampoco las incluía
    //    (legacy solo insertaba las creadas por sync). C2.2-d: la exclusión
    //    NO puede basarse solo en `sourceKey local:%` — el inventario de
    //    producción probó que el prefijo manual legacy real es `manual:%`
    //    (0 filas `local:%` en prod). `whereExcluirManual()` usa
    //    `origenFuncional='MANUAL'` como señal primaria (fiable para TODO
    //    proceso migrado — ver `10_procesos_manuales.sql`) y ambos prefijos
    //    (`local:`/`manual:`) solo como respaldo de compatibilidad histórica.
    //  · NO se filtra por `disponibleDataApi` — `ProcesoNuevo` tampoco retiraba
    //    tombstones automáticamente.
    //  · Las filas con `origenFuncional = NULL` SÍ se incluyen (no son MANUAL
    //    por defecto) — ver `whereExcluirManual()`.
    // AND plano (no anidado): `whereExcluirManual()` ya devuelve `{ AND: [...] }`
    // y se le suma la condición de identificador como un elemento más.
    const where: Record<string, unknown> = {
      AND: [
        ...((whereExcluirManual().AND ?? []) as Record<string, unknown>[]),
        whereProcesoIdentificable(),
      ],
    };

    if (fechaDesde || fechaHasta) {
      where.fechaPublicacion = {
        ...(fechaDesde ? { gte: fechaDesde } : {}),
        ...(fechaHasta ? { lte: fechaHasta } : {}),
      };
    }

    if (perfil) {
      where.perfil = { contains: perfil, mode: 'insensitive' };
    }

    if (fuente) {
      // D11 — filtrar por aliasFuente a secas excluía TODO proceso Data API
      // (esa columna nunca se escribe para esas filas). condicionFuente()
      // aplica el mismo fallback a origenFuncional que ya usan los
      // endpoints hermanos (/procesos, /sin-gestionar, /gestionados).
      Object.assign(where, condicionFuente(fuente));
    }

    const [total, registros] = await Promise.all([
      prisma.proceso.count({ where }),
      prisma.proceso.findMany({
        where,
        orderBy: { fechaPublicacion: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          sourceKey: true,
          codigoProceso: true,
          nombre: true,
          entidad: true,
          objeto: true,
          fuente: true,
          aliasFuente: true,
          origenFuncional: true,
          modalidad: true,
          perfil: true,
          departamento: true,
          estadoFuente: true,
          fechaPublicacion: true,
          fechaVencimiento: true,
          valor: true,
          linkDetalle: true,
          linkSecop: true,
          linkSecopReg: true,
          duracion: true,
          unspsc: true,
          createdAt: true,
        },
      }),
    ]);

    const procesos = registros
      .map((r: any) => ({
        // Forma idéntica a la histórica de `ProcesoNuevo` (ver `ProcesoNuevoItem`
        // en el frontend). `id` y `procesoId` = `Proceso.id`; `fechaDeteccion` =
        // `Proceso.createdAt`.
        id: r.id,
        procesoId: r.id,
        sourceKey: r.sourceKey,
        codigoProceso: r.codigoProceso,
        nombre: r.nombre,
        entidad: r.entidad,
        objeto: r.objeto,
        duracion: r.duracion,
        fuente: r.fuente,
        aliasFuente: r.aliasFuente,
        origenFuncional: r.origenFuncional ?? null,
        modalidad: r.modalidad,
        perfil: r.perfil,
        departamento: r.departamento,
        estadoFuente: r.estadoFuente,
        valor: r.valor != null ? Number(r.valor) : null,
        linkDetalle: r.linkDetalle || null,
        linkSecop: r.linkSecop || null,
        linkSecopReg: r.linkSecopReg || null,
        fechaPublicacion: r.fechaPublicacion?.toISOString() ?? null,
        fechaVencimiento: r.fechaVencimiento?.toISOString() ?? null,
        fechaDeteccion: r.createdAt?.toISOString() ?? null,
        _unspsc: r.unspsc ?? null,
      }))
      // Filtro UNSPSC: si unspsc existe y no está permitido para el perfil → ocultar
      .filter((p: any) => unspscPermitido(p._unspsc, p.perfil));

    return NextResponse.json({
      ok: true,
      count: procesos.length,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      stats: {
        count: procesos.length,
        total,
      },
      procesos,
    });
  } catch (err) {
    console.error('[GET /api/procesos/nuevos]', err);
    return NextResponse.json(
      {
        ok: false,
        count: 0,
        total: 0,
        page: 1,
        limit: 30,
        totalPages: 1,
        stats: { count: 0, total: 0 },
        procesos: [],
        error: err instanceof Error ? err.message : 'Error interno',
      },
      { status: 500 }
    );
  }
}