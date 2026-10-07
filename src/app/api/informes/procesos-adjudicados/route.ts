import { NextRequest, NextResponse } from 'next/server';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession, requireNoMercadeo } from '@/lib/authz';
import {
  generarInformeProcesosAdjudicados,
  type SolicitudInformeInput,
  type EventoCronogramaInput,
} from '@/lib/informes/plantilla-procesos-adjudicados';

/**
 * GET /api/informes/procesos-adjudicados?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&empresa=Aseocolba
 *
 * Genera el "INFORME PROCESOS ADJUDICADOS Y NO ADJUDICADOS" reutilizando la
 * plantilla maestra del cliente (nunca se crea un Excel desde cero — ver
 * src/lib/informes/plantilla-procesos-adjudicados.ts).
 *
 * Corrección (confirmada con datos reales — `Solicitud.resultadoFinal` está
 * NULL en el 100% de los registros, columna no poblada en la práctica pese
 * a existir en el schema): el criterio real de "adjudicado"/"no adjudicado"
 * es EXACTAMENTE el mismo que ya usa `GET /api/solicitudes` con
 * `soloCerradas=true&filtroEstadoCerrado=adjudicado|noAdjudicado` (fuente
 * de las hojas "Adjudicados"/"No adjudicados" del export de trazabilidad
 * existente, `page.tsx:2163-2164`) — `estadoSolicitud` cerrado/cancelado/
 * rechazado Y el `estadoRevision` de la ÚLTIMA asignación
 * (`asignaciones[-1]`) es `CERRADO_ADJUDICADO` o `CERRADO_NO_ADJUDICADO`.
 * Ver `src/app/api/solicitudes/route.ts:614-628`.
 */
const RUTA_PLANTILLA = join(process.cwd(), 'data', 'importaciones', 'informes', 'Informe.xlsx');

function toDateInicioDia(v: string | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDateFinDia(v: string | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  // Regla "INFORMES GERENCIALES — TODOS EXCEPTO MERCADEO": el informe de
  // procesos adjudicados es la única descarga de ese módulo, y también se
  // dispara desde el botón del Dashboard — la autorización va en el backend,
  // nunca solo en la UI. `requireNoMercadeo` (fuente única `@/lib/roles`,
  // mismo guard que ya protege `GET /api/trm`): 401 sin sesión, 403 Mercadeo.
  const denied = requireSession(session) ?? requireNoMercadeo(session);
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const desde = toDateInicioDia(searchParams.get('desde'));
    const hasta = toDateFinDia(searchParams.get('hasta'));
    const empresa = searchParams.get('empresa')?.trim() || null;

    if (!desde || !hasta) {
      return NextResponse.json({ ok: false, error: 'Debe indicar "desde" y "hasta" en formato YYYY-MM-DD.' }, { status: 400 });
    }

    const condicionEmpresa = empresa
      ? Prisma.sql`AND "perfil" ILIKE ${empresa}`
      : Prisma.empty;

    const solicitudesCrudo = await prisma.$queryRaw<{
      id: number; createdAt: Date; modalidad: string | null; nombreProceso: string | null;
      codigoProceso: string | null; entidad: string | null; perfil: string | null;
      ciudad: string | null; objeto: string | null; valor: number | null;
      fechaCierre: Date | null; sqrNumero: string | null; revisor: string | null;
      plataforma: string | null; asignaciones: unknown; ultimoEstadoRevision: string | null;
      procesoId: number | null;
    }[]>`
      SELECT id, "createdAt", modalidad, "nombreProceso", "codigoProceso", entidad, perfil,
             ciudad, objeto, valor, "fechaCierre", "sqrNumero", revisor, plataforma, asignaciones,
             asignaciones -> -1 ->> 'estadoRevision' AS "ultimoEstadoRevision", "procesoId"
      FROM "Solicitud"
      WHERE "estadoSolicitud" IN ('Cerrada','Cancelada','Rechazada','CERRADA','CANCELADA')
        AND asignaciones IS NOT NULL AND jsonb_array_length(asignaciones) > 0
        AND asignaciones -> -1 ->> 'estadoRevision' IN ('CERRADO_ADJUDICADO','CERRADO_NO_ADJUDICADO')
        AND "createdAt" >= ${desde} AND "createdAt" <= ${hasta}
        ${condicionEmpresa}
      ORDER BY "createdAt" ASC
    `;

    if (solicitudesCrudo.length === 0) {
      return NextResponse.json({ ok: false, error: 'No hay procesos adjudicados/no adjudicados en el rango de fechas indicado.' }, { status: 404 });
    }

    const solicitudes = solicitudesCrudo.map(s => ({
      ...s,
      resultadoFinal: s.ultimoEstadoRevision === 'CERRADO_ADJUDICADO' ? 'Adjudicado' : 'No adjudicado',
    }));

    // Indicadores financieros — misma consulta que ya usa el export general
    // (GET /api/solicitudes/indicadores-financieros), pero acotada a los ids
    // resueltos arriba para no traer el histórico completo de la BD.
    const ids = solicitudes.map(s => s.id);
    const filasIndicadores = await prisma.$queryRaw<{ id: number; nombreIndicador: string | null; valorEvidenciado: string | null; fecha: string | null }[]>`
      SELECT s.id,
             ind->>'subcausa' AS "nombreIndicador",
             ind->>'valorEvidenciado' AS "valorEvidenciado",
             obs->>'fecha' AS fecha
      FROM "Solicitud" s,
        LATERAL jsonb_array_elements(COALESCE(s.asignaciones, '[]'::jsonb)) AS asig,
        LATERAL jsonb_array_elements(COALESCE(asig->'observaciones', '[]'::jsonb)) AS obs,
        LATERAL jsonb_array_elements(COALESCE(obs->'indicadores', '[]'::jsonb)) AS ind
      WHERE obs->>'tipoCausa' = 'Indicador' AND s.id = ANY(${ids})
    `;
    const indicadoresPorSolicitud = new Map<number, Map<string, { valor: string; fecha: string }>>();
    for (const f of filasIndicadores) {
      const nombre = (f.nombreIndicador ?? '').trim();
      const valorTexto = (f.valorEvidenciado ?? '').trim();
      if (!nombre || !valorTexto) continue;
      let mapa = indicadoresPorSolicitud.get(f.id);
      if (!mapa) { mapa = new Map(); indicadoresPorSolicitud.set(f.id, mapa); }
      const fecha = f.fecha ?? '';
      const existente = mapa.get(nombre);
      if (!existente || fecha >= existente.fecha) mapa.set(nombre, { valor: valorTexto, fecha });
    }

    // Cronograma — Ajuste "COLUMNAS DE CRONOGRAMA" (petición directa,
    // revertida tras confirmar con la ficha real del proceso, ver
    // resolverFechasCronograma en la librería): se trae el cronograma crudo
    // (evento/fecha/orden) de cada Proceso vinculado, y el MATCH por
    // palabras clave se resuelve en la librería (nunca aquí, para que sea
    // testeable sin BD). Solicitudes sin `procesoId` (ej. Especializada sin
    // scraping) simplemente no traen eventos — columnas quedan en blanco.
    const procesoIds = [...new Set(solicitudes.map(s => s.procesoId).filter((id): id is number => id != null))];
    const eventosCrudo = procesoIds.length > 0
      ? await prisma.procesoCronogramaSecop.findMany({
          where: { procesoId: { in: procesoIds } },
          select: { procesoId: true, evento: true, fechaInicio: true, fechaFin: true, orden: true },
        })
      : [];
    const eventosPorProceso = new Map<number, EventoCronogramaInput[]>();
    for (const e of eventosCrudo) {
      const lista = eventosPorProceso.get(e.procesoId) ?? [];
      // El scraper (confirmado con datos reales) casi siempre escribe la
      // fecha del evento en `fechaFin`, dejando `fechaInicio` en null — se
      // usa el primero que exista, nunca se prefiere uno sobre el otro por
      // suposición.
      lista.push({ evento: e.evento, fecha: e.fechaInicio ?? e.fechaFin, orden: e.orden });
      eventosPorProceso.set(e.procesoId, lista);
    }

    const filas: SolicitudInformeInput[] = solicitudes.map(s => ({
      createdAt: s.createdAt,
      modalidad: s.modalidad,
      nombreProceso: s.nombreProceso,
      codigoProceso: s.codigoProceso,
      entidad: s.entidad,
      perfil: s.perfil,
      ciudad: s.ciudad,
      objeto: s.objeto,
      valor: s.valor,
      resultadoFinal: s.resultadoFinal,
      fechaCierre: s.fechaCierre,
      sqrNumero: s.sqrNumero,
      revisor: s.revisor,
      plataforma: s.plataforma,
      asignaciones: s.asignaciones,
      indicadores: Object.fromEntries([...(indicadoresPorSolicitud.get(s.id)?.entries() ?? [])].map(([n, v]) => [n, v.valor])),
      eventosCronograma: s.procesoId != null ? (eventosPorProceso.get(s.procesoId) ?? []) : [],
    }));

    const buffer = await generarInformeProcesosAdjudicados({ rutaPlantilla: RUTA_PLANTILLA, filas });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Informe_Procesos_Adjudicados_${searchParams.get('desde')}_${searchParams.get('hasta')}.xlsx"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error generando el informe de procesos adjudicados.' },
      { status: 500 },
    );
  }
}
