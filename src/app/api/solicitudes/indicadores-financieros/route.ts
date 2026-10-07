import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { requireSession } from '@/lib/authz';

/**
 * Ajuste "HOJA INDICADORES EN EL EXPORT DE PROCESOS PÚBLICOS" — fuente para
 * la hoja `Indicadores` del export general: consolida, POR SOLICITUD, los
 * indicadores financieros REALMENTE registrados en observaciones de tipo
 * "Indicador" (`asignaciones[].observaciones[].tipoCausa==='Indicador'`,
 * `asignaciones[].observaciones[].indicadores[]` con `{subcausa,
 * valorEvidenciado,...}` — ver `POST /api/solicitudes/[id]/observaciones`).
 *
 * DELIBERADAMENTE distinto del listado principal (`GET /api/solicitudes`):
 * ese endpoint devuelve `asignaciones` recortado al ÚLTIMO elemento
 * (`SQL_ASIG_LAST`, `serializar-solicitud.ts`) — correcto para mostrar la
 * causa/observación VIGENTE de cada bandeja, pero insuficiente aquí: un
 * indicador pudo registrarse en una asignación anterior (ej. mientras el
 * proceso estaba "En observación") y el proceso haber avanzado después a
 * otro estado (Ejecución/Evaluación/Adjudicado/...), perdiendo esa
 * asignación como "última". Esta ruta recorre el arreglo `asignaciones`
 * COMPLETO de cada Solicitud (`jsonb_array_elements`, sin `-> -1`) — nunca
 * filtra por `estadoSolicitud`/bandeja actual, exactamente lo pedido.
 *
 * Regla de "mismo indicador registrado más de una vez" (confirmado con
 * datos reales: hoy no ocurre — 0 casos de duplicado — pero se programa
 * para el caso general): se usa el ÚLTIMO valor por `subcausa` distinta,
 * ordenando por `fecha` de la observación (string "YYYY-MM-DD HH:mm:ss",
 * ordenable lexicográficamente igual que el resto del código de
 * observaciones). Una fila de indicador SIN `valorEvidenciado` real
 * (vacío/solo espacios) NUNCA cuenta como "registrado" — ni entra al mapa
 * de indicadores del proceso ni, por sí sola, hace que el proceso aparezca
 * en el resultado (coherente con "no basta con que exista el texto
 * Tipo de causa=Indicador si no se guardaron valores").
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const denied = requireSession(session);
  if (denied) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const aliasFuentePublico = searchParams.get('aliasFuentePublico') === 'true';
    const aliasFuentePrivado = searchParams.get('aliasFuentePrivado') === 'true';

    // Mismo criterio ya usado por el resto de `/api/solicitudes` para
    // separar público/privado (`aliasFuente IN ('S1','S2')` = público).
    const condicionesAlias: Prisma.Sql[] = [];
    if (aliasFuentePublico) condicionesAlias.push(Prisma.sql`"aliasFuente" IN ('S1','S2')`);
    if (aliasFuentePrivado) condicionesAlias.push(Prisma.sql`"aliasFuente" NOT IN ('S1','S2')`);
    const whereAlias = condicionesAlias.length > 0
      ? Prisma.sql`AND ${Prisma.join(condicionesAlias, ' AND ')}`
      : Prisma.empty;

    const filas = await prisma.$queryRaw<{
      id: number;
      codigoProceso: string | null;
      entidad: string | null;
      perfil: string | null;
      objeto: string | null;
      valor: number | null;
      modalidad: string | null;
      nombreIndicador: string | null;
      valorEvidenciado: string | null;
      fecha: string | null;
    }[]>(Prisma.sql`
      SELECT s.id, s."codigoProceso", s.entidad, s.perfil, s.objeto, s.valor, s.modalidad,
             ind->>'subcausa' AS "nombreIndicador",
             ind->>'valorEvidenciado' AS "valorEvidenciado",
             obs->>'fecha' AS fecha
      FROM "Solicitud" s,
        LATERAL jsonb_array_elements(COALESCE(s.asignaciones, '[]'::jsonb)) AS asig,
        LATERAL jsonb_array_elements(COALESCE(asig->'observaciones', '[]'::jsonb)) AS obs,
        LATERAL jsonb_array_elements(COALESCE(obs->'indicadores', '[]'::jsonb)) AS ind
      WHERE obs->>'tipoCausa' = 'Indicador'
      ${whereAlias}
    `);

    interface AcumuladoSolicitud {
      id: number;
      codigoProceso: string | null;
      entidad: string | null;
      perfil: string | null;
      objeto: string | null;
      valor: number | null;
      modalidad: string | null;
      indicadores: Map<string, { valor: string; fecha: string }>;
    }
    const porSolicitud = new Map<number, AcumuladoSolicitud>();
    for (const f of filas) {
      const nombre = (f.nombreIndicador ?? '').trim();
      const valorTexto = (f.valorEvidenciado ?? '').trim();
      // Sin nombre o sin valor real → esta fila NUNCA cuenta como indicador
      // "registrado" (ver docblock).
      if (!nombre || !valorTexto) continue;

      let entrada = porSolicitud.get(f.id);
      if (!entrada) {
        entrada = { id: f.id, codigoProceso: f.codigoProceso, entidad: f.entidad, perfil: f.perfil, objeto: f.objeto, valor: f.valor, modalidad: f.modalidad, indicadores: new Map() };
        porSolicitud.set(f.id, entrada);
      }
      const fecha = f.fecha ?? '';
      const existente = entrada.indicadores.get(nombre);
      // Último valor vigente por nombre — en empate de fecha, se queda con
      // el último recorrido (mismo orden que ya usan `getUA`/`getUACierre`
      // en el export: el array de observaciones ya es cronológico).
      if (!existente || fecha >= existente.fecha) entrada.indicadores.set(nombre, { valor: valorTexto, fecha });
    }

    const data = [...porSolicitud.values()].map(e => ({
      id: e.id,
      codigoProceso: e.codigoProceso,
      entidad: e.entidad,
      perfil: e.perfil,
      objeto: e.objeto,
      valor: e.valor,
      modalidad: e.modalidad,
      indicadores: Object.fromEntries([...e.indicadores.entries()].map(([nombre, v]) => [nombre, v.valor])),
    }));

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Error consultando indicadores financieros' },
      { status: 500 },
    );
  }
}
