import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { unstable_cache } from 'next/cache';
import { sqlExcluirManual, sqlAliasFuenteEfectivo } from '@/lib/data-api/origenCanonico';

export const dynamic = 'force-dynamic';

// Datos de agregación global — sin dependencia de usuario ni sesión.
// Se recalcula cada 5 minutos en el servidor.
const getDashboardData = unstable_cache(
  async () => {
    const hoy = new Date();
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    // Mayo (mes 4, 0-indexado) del año en curso — punto de partida fijo pedido para el
    // selector de mes de la tarjeta PROCESOS. Si el año aún no llega a mayo, cae a enero.
    const inicioMayo = new Date(hoy.getFullYear(), Math.min(4, hoy.getMonth()), 1);
    const hace6Meses = new Date(hoy.getFullYear(), hoy.getMonth() - 6, 1);
    const hace30Dias = new Date(hoy.getTime() - 30 * 24 * 60 * 60 * 1000);
    const en30Dias = new Date(hoy.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [
      porEstadoRaw,
      porPerfilRaw,
      porFuenteRaw,
      porModalidadRaw,
      porDeptoRaw,
      porMesRaw,
      esteMesCount,
      procesosMesRaw,
      sqrStats,
      jsonStats,
      proxVencer,
      ultimos,
      procesosNuevosDiaRaw,
    ] = await Promise.all([
      prisma.solicitud.groupBy({ by: ['estadoSolicitud'], _count: { id: true }, _sum: { valor: true } }),
      prisma.solicitud.groupBy({ by: ['perfil'], _count: { id: true }, _sum: { valor: true } }),
      prisma.solicitud.groupBy({ by: ['fuente'], _count: { id: true } }),
      prisma.solicitud.groupBy({ by: ['modalidad'], _count: { id: true }, _sum: { valor: true } }),
      prisma.$queryRawUnsafe<{ depto: string; total: bigint; publicos: bigint }[]>(`
        SELECT departamento as depto, COUNT(*) as total,
          COUNT(CASE WHEN "aliasFuente" IN ('S1','S2') THEN 1 END) as publicos
        FROM "Solicitud"
        WHERE departamento IS NOT NULL AND departamento != ''
        GROUP BY departamento
        ORDER BY total DESC
        LIMIT 50
      `),
      prisma.$queryRawUnsafe<{ mes: string; total: bigint; publicos: bigint }[]>(`
        SELECT TO_CHAR("createdAt", 'YYYY-MM') as mes,
          COUNT(*) as total,
          COUNT(CASE WHEN "aliasFuente" IN ('S1','S2') THEN 1 END) as publicos
        FROM "Solicitud"
        WHERE "createdAt" >= $1
        GROUP BY mes ORDER BY mes
      `, hace6Meses),
      prisma.solicitud.count({ where: { createdAt: { gte: inicioMes } } }),
      // Procesos encontrados por mes (desde mayo) vs. gestionados (con Solicitud creada)
      // — mismo criterio de match que /api/procesos/sin-gestionar (procesoId, código o nombre).
      // D12 — `p."aliasFuente" IN ('S1','S2')` a secas clasificaba TODO
      // proceso Data API como privado (esa columna nunca se escribe para
      // esas filas). `sqlAliasFuenteEfectivo` aplica el mismo fallback a
      // origenFuncional que ya usan /procesos, /sin-gestionar, /gestionados
      // y /procesos/nuevos, con un sentinela '' que nunca cae en el NULL de
      // tres valores de SQL — así "privado" sigue siendo el complemento
      // exacto de "público", nunca de más ni de menos.
      prisma.$queryRawUnsafe<{ mes: string; encontrados_pub: bigint; gestionados_pub: bigint; encontrados_priv: bigint; gestionados_priv: bigint }[]>(`
        SELECT
          TO_CHAR(p."createdAt", 'YYYY-MM') as mes,
          COUNT(CASE WHEN ${sqlAliasFuenteEfectivo('p.')} IN ('S1','S2') THEN 1 END) as encontrados_pub,
          COUNT(CASE WHEN ${sqlAliasFuenteEfectivo('p.')} IN ('S1','S2') AND EXISTS (
            SELECT 1 FROM "Solicitud" s
            WHERE s."procesoId" = p.id
               OR (p."codigoProceso" IS NOT NULL AND s."codigoProceso" = p."codigoProceso")
               OR (p.nombre IS NOT NULL AND s."nombreProceso" = p.nombre)
          ) THEN 1 END) as gestionados_pub,
          COUNT(CASE WHEN ${sqlAliasFuenteEfectivo('p.')} NOT IN ('S1','S2') THEN 1 END) as encontrados_priv,
          COUNT(CASE WHEN ${sqlAliasFuenteEfectivo('p.')} NOT IN ('S1','S2') AND EXISTS (
            SELECT 1 FROM "Solicitud" s
            WHERE s."procesoId" = p.id
               OR (p."codigoProceso" IS NOT NULL AND s."codigoProceso" = p."codigoProceso")
               OR (p.nombre IS NOT NULL AND s."nombreProceso" = p.nombre)
          ) THEN 1 END) as gestionados_priv
        FROM "Proceso" p
        WHERE p."createdAt" >= $1
        GROUP BY mes ORDER BY mes
      `, inicioMayo),
      prisma.$queryRawUnsafe<{ con_sqr: bigint; cerradas: bigint; con_error: bigint }[]>(`
        SELECT
          COUNT(CASE WHEN "sqrCreada" = true THEN 1 END) as con_sqr,
          COUNT(CASE WHEN "sqrCerrada" = true THEN 1 END) as cerradas,
          COUNT(CASE WHEN "sqrError" IS NOT NULL AND "sqrError" != '' THEN 1 END) as con_error
        FROM "Solicitud"
      `),
      prisma.$queryRawUnsafe<{ en_obs: bigint; cerrados: bigint; adjudicados: bigint }[]>(`
        SELECT
          COUNT(CASE WHEN jsonb_array_length(asignaciones) > 0
            AND asignaciones -> -1 ->> 'estadoRevision' = 'CON_OBSERVACIONES' THEN 1 END) as en_obs,
          COUNT(CASE WHEN jsonb_array_length(asignaciones) > 0
            AND asignaciones -> -1 ->> 'estadoRevision' IN ('CERRADO_ADJUDICADO','CERRADO_NO_ADJUDICADO','CERRADO_NO_CUMPLIMIENTO') THEN 1 END) as cerrados,
          COUNT(CASE WHEN jsonb_array_length(asignaciones) > 0
            AND asignaciones -> -1 ->> 'estadoRevision' = 'CERRADO_ADJUDICADO' THEN 1 END) as adjudicados
        FROM "Solicitud"
      `),
      prisma.solicitud.findMany({
        where: {
          estadoSolicitud: { notIn: ['Cerrada', 'Cancelada', 'Rechazada'] },
          OR: [
            { fechaVencimiento: { gte: hoy, lte: en30Dias } },
            { fechaCierre: { gte: hoy, lte: en30Dias } },
          ],
        },
        orderBy: { fechaVencimiento: 'asc' },
        take: 4,
        select: { id: true, codigoProceso: true, entidad: true, objeto: true, perfil: true, fechaVencimiento: true, fechaCierre: true, estadoSolicitud: true, aliasFuente: true },
      }),
      prisma.solicitud.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, codigoProceso: true, entidad: true, objeto: true, perfil: true, estadoSolicitud: true, createdAt: true, aliasFuente: true, valor: true },
      }),
      // B.4.5 — "procesos nuevos por día" se lee de `Proceso` (createdAt ≡ la
      // `fechaDeteccion` histórica de `ProcesoNuevo`), excluyendo altas manuales.
      // C2.2-d: exclusión por origenFuncional='MANUAL' (primaria) + prefijo
      // local:/manual: (compatibilidad) — ver `sqlExcluirManual()`; el
      // inventario de producción probó que `local:%` NUNCA se usó en prod
      // (el prefijo manual legacy real es `manual:%`), así que un filtro que
      // solo excluyera `local:%` habría dejado pasar todo el legado manual
      // migrado como "nuevo Data API".
      prisma.$queryRawUnsafe<{ dia: string; total: bigint }[]>(`
        SELECT TO_CHAR("createdAt", 'YYYY-MM-DD') as dia, COUNT(*) as total
        FROM "Proceso"
        WHERE "createdAt" >= $1 AND ${sqlExcluirManual()}
        GROUP BY dia ORDER BY dia
      `, hace30Dias),
    ]);

    const topAnalistasRaw = await prisma.$queryRawUnsafe<{ analista: string; cnt: bigint }[]>(`
      SELECT asignaciones -> -1 ->> 'analistaAsignado' as analista, COUNT(*) as cnt
      FROM "Solicitud"
      WHERE jsonb_array_length(asignaciones) > 0
        AND asignaciones -> -1 ->> 'analistaAsignado' IS NOT NULL
        AND asignaciones -> -1 ->> 'analistaAsignado' != ''
      GROUP BY analista ORDER BY cnt DESC LIMIT 5
    `);

    const porEstado: Record<string, number> = {};
    let valorTotal = 0;
    let total = 0;
    for (const r of porEstadoRaw) {
      const e = r.estadoSolicitud ?? 'Sin estado';
      porEstado[e] = r._count.id;
      total += r._count.id;
      valorTotal += Number(r._sum.valor ?? 0);
    }

    const porEmpresa: Record<string, { count: number; valor: number }> = {};
    for (const r of porPerfilRaw) {
      const key = r.perfil ?? 'Sin empresa';
      porEmpresa[key] = { count: r._count.id, valor: Number(r._sum.valor ?? 0) };
    }

    const porFuente: Record<string, number> = {};
    for (const r of porFuenteRaw) porFuente[r.fuente ?? 'Sin fuente'] = r._count.id;

    const porModalidad: Record<string, { count: number; valor: number }> = {};
    for (const r of porModalidadRaw) {
      const key = r.modalidad ?? 'Sin modalidad';
      porModalidad[key] = { count: r._count.id, valor: Number(r._sum.valor ?? 0) };
    }

    const porDepto: Record<string, number> = {};
    const porDeptoPublico: Record<string, number> = {};
    for (const r of porDeptoRaw) {
      porDepto[r.depto] = Number(r.total);
      porDeptoPublico[r.depto] = Number(r.publicos);
    }

    const porMes: Record<string, number> = {};
    const porMesPublicos: Record<string, number> = {};
    const porMesPrivados: Record<string, number> = {};
    for (const r of porMesRaw) {
      porMes[r.mes] = Number(r.total);
      porMesPublicos[r.mes] = Number(r.publicos);
      porMesPrivados[r.mes] = Number(r.total) - Number(r.publicos);
    }

    // Mapa mes ("YYYY-MM") → conteos, para el selector de mes de la tarjeta PROCESOS
    // (desde mayo hasta el mes en curso).
    const procesosPorMes: Record<string, {
      encontradosPublicos: number; gestionadosPublicos: number; pendientesPublicos: number;
      encontradosPrivados: number; gestionadosPrivados: number; pendientesPrivados: number;
    }> = {};
    for (const r of procesosMesRaw) {
      const encPub = Number(r.encontrados_pub);
      const gesPub = Number(r.gestionados_pub);
      const encPriv = Number(r.encontrados_priv);
      const gesPriv = Number(r.gestionados_priv);
      procesosPorMes[r.mes] = {
        encontradosPublicos: encPub,
        gestionadosPublicos: gesPub,
        pendientesPublicos: Math.max(0, encPub - gesPub),
        encontradosPrivados: encPriv,
        gestionadosPrivados: gesPriv,
        pendientesPrivados: Math.max(0, encPriv - gesPriv),
      };
    }
    const mesActualKey = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;

    const sqr = sqrStats[0] ?? { con_sqr: BigInt(0), cerradas: BigInt(0), con_error: BigInt(0) };
    const json = jsonStats[0] ?? { en_obs: BigInt(0), cerrados: BigInt(0), adjudicados: BigInt(0) };

    const cerradosCount = Number(json.cerrados);
    const adjudicadosCount = Number(json.adjudicados);

    const procesosNuevosPorDia: number[] = [];
    const procesosNuevosDiaMap: Record<string, number> = {};
    for (const r of procesosNuevosDiaRaw) procesosNuevosDiaMap[r.dia] = Number(r.total);
    for (let i = 29; i >= 0; i--) {
      const d = new Date(hoy); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      procesosNuevosPorDia.push(procesosNuevosDiaMap[key] ?? 0);
    }
    const procesosNuevosHoy = procesosNuevosDiaMap[hoy.toISOString().slice(0, 10)] ?? 0;

    return {
      ok: true,
      total,
      valorTotal,
      porEstado,
      porEmpresa,
      porFuente,
      porModalidad,
      porDepto,
      porDeptoPublico,
      porMes,
      porMesPublicos,
      porMesPrivados,
      esteMes: esteMesCount,
      procesosPorMes,
      mesActualKey,
      conSqr: Number(sqr.con_sqr),
      sqrCerradas: Number(sqr.cerradas),
      sqrError: Number(sqr.con_error),
      enObservacion: Number(json.en_obs),
      cerrados: cerradosCount,
      adjudicados: adjudicadosCount,
      activos: total - cerradosCount,
      tasaAdj: cerradosCount > 0 ? Math.round((adjudicadosCount / cerradosCount) * 100) : 0,
      procesosNuevosPorDia,
      procesosNuevosHoy,
      topAnalistas: topAnalistasRaw.map(r => [r.analista, Number(r.cnt)] as [string, number]),
      proxVencer: proxVencer.map(s => ({
        ...s,
        fechaVencimiento: s.fechaVencimiento?.toISOString() ?? null,
        fechaCierre: s.fechaCierre?.toISOString() ?? null,
      })),
      ultimos: ultimos.map(s => ({
        ...s,
        createdAt: s.createdAt?.toISOString() ?? null,
      })),
    };
  },
  ['solicitudes-dashboard'],
  { revalidate: 300 }
);

export async function GET() {
  try {
    const data = await getDashboardData();
    return NextResponse.json(data);
  } catch (err) {
    console.error('[GET /api/solicitudes/dashboard]', err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}