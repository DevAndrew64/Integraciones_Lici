/**
 * Consultas agregadas de indicadores de procesos (API pública).
 *
 * - Unidad: modelo `Proceso` (único por sourceKey). `ProcesoNuevo` se excluye
 *   (staging de detección → evitaría doble conteo).
 * - La Solicitud vinculada se resuelve con LEFT JOIN LATERAL tomando la más
 *   reciente por procesoId o procesoSourceKey (varias solicitudes → 1).
 * - La categoría se calcula EN SQL con la misma lógica de
 *   `clasificarPresentacion` (clasificacion.ts es la referencia; cualquier
 *   cambio debe hacerse en ambos y está cubierto por tests).
 * - Agregaciones 100% en PostgreSQL (GROUP BY); nunca se cargan todos los
 *   procesos en memoria. El detalle va paginado.
 */

import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  construirTotales, porcentajePresentacion, participacionPresentadosSobreTotal,
  type CategoriaPresentacion, type TotalesPresentacion, CATEGORIAS,
} from './clasificacion';

// ─── Filtros permitidos (whitelist) ──────────────────────────────────────────

export const FECHAS_REFERENCIA = ['registro', 'publicacion', 'vencimiento'] as const;
export type FechaReferencia = (typeof FECHAS_REFERENCIA)[number];

export interface FiltrosIndicadores {
  anio?: number;
  mes?: number;
  fechaDesde?: string;      // YYYY-MM-DD
  fechaHasta?: string;      // YYYY-MM-DD
  fechaReferencia: FechaReferencia;
  empresa?: string;         // → Proceso.perfil
  fuente?: string;          // → Proceso.aliasFuente
  departamento?: string;    // → Proceso.departamento
  modalidad?: string;       // → Proceso.modalidad
  categoria?: CategoriaPresentacion;
  responsable?: string;     // → Solicitud.usuarioRegistro
  /** Restricción del ApiClient (empresasPermitidas); vacío = sin restricción */
  empresasPermitidas: string[];
}

export interface ErrorFiltro { campo: string; mensaje: string }

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Valida y normaliza los query params. Solo acepta la whitelist. */
export function parsearFiltros(
  sp: URLSearchParams,
  empresasPermitidas: string[],
): { ok: true; filtros: FiltrosIndicadores } | { ok: false; error: ErrorFiltro } {
  const err = (campo: string, mensaje: string) => ({ ok: false as const, error: { campo, mensaje } });

  const anioRaw = sp.get('anio');
  const mesRaw = sp.get('mes');
  const anio = anioRaw !== null ? Number(anioRaw) : undefined;
  const mes = mesRaw !== null ? Number(mesRaw) : undefined;
  if (anio !== undefined && (!Number.isInteger(anio) || anio < 2000 || anio > 2100)) return err('anio', 'Año inválido (2000-2100)');
  if (mes !== undefined && (!Number.isInteger(mes) || mes < 1 || mes > 12)) return err('mes', 'Mes inválido (1-12)');
  if (mes !== undefined && anio === undefined) return err('mes', 'El filtro mes requiere anio');

  const fechaDesde = sp.get('fechaDesde') ?? undefined;
  const fechaHasta = sp.get('fechaHasta') ?? undefined;
  if (fechaDesde && !RE_FECHA.test(fechaDesde)) return err('fechaDesde', 'Formato esperado YYYY-MM-DD');
  if (fechaHasta && !RE_FECHA.test(fechaHasta)) return err('fechaHasta', 'Formato esperado YYYY-MM-DD');

  const fechaReferencia = (sp.get('fechaReferencia') ?? 'registro') as FechaReferencia;
  if (!FECHAS_REFERENCIA.includes(fechaReferencia)) {
    return err('fechaReferencia', `Valores permitidos: ${FECHAS_REFERENCIA.join(', ')}`);
  }

  const categoriaRaw = sp.get('categoria') ?? undefined;
  if (categoriaRaw && !(CATEGORIAS as readonly string[]).includes(categoriaRaw)) {
    return err('categoria', `Valores permitidos: ${CATEGORIAS.join(', ')}`);
  }

  const texto = (v: string | null) => {
    const t = v?.trim();
    return t ? t.slice(0, 120) : undefined;
  };
  const empresa = texto(sp.get('empresa'));

  if (empresasPermitidas.length > 0 && empresa && !empresasPermitidas.includes(empresa)) {
    return err('empresa', 'Empresa no permitida para esta API Key');
  }

  return {
    ok: true,
    filtros: {
      anio, mes, fechaDesde, fechaHasta, fechaReferencia,
      empresa,
      fuente: texto(sp.get('fuente')),
      departamento: texto(sp.get('departamento')),
      modalidad: texto(sp.get('modalidad')),
      categoria: categoriaRaw as CategoriaPresentacion | undefined,
      responsable: texto(sp.get('responsable')),
      empresasPermitidas,
    },
  };
}

// ─── Fragmentos SQL ──────────────────────────────────────────────────────────

/** Columna de fecha de referencia (sobre el alias p). */
function colFecha(ref: FechaReferencia): Prisma.Sql {
  switch (ref) {
    case 'publicacion': return Prisma.sql`p."fechaPublicacion"`;
    case 'vencimiento': return Prisma.sql`p."fechaVencimiento"`;
    default: return Prisma.sql`p."createdAt"`;
  }
}

/**
 * CASE de clasificación — espejo SQL de clasificarPresentacion().
 * Usa asignaciones -> -1 ->> 'estadoRevision' (jsonb), mismo criterio que
 * colba-stats.ts en producción.
 */
const CATEGORIA_SQL = Prisma.sql`CASE
  WHEN p."noViable" = TRUE OR COALESCE(p."oculto", FALSE) = TRUE
       OR LOWER(COALESCE(s."estadoSolicitud", '')) LIKE 'cancelad%'
    THEN 'NO_APLICA'
  WHEN s.id IS NOT NULL AND (
       (s."asignaciones" -> -1 ->> 'estadoRevision') IN ('PRESENTADO','CERRADO_ADJUDICADO','CERRADO_NO_ADJUDICADO','CERRADO_NO_CUMPLIMIENTO')
       OR LOWER(COALESCE(s."estadoSolicitud", '')) LIKE '%presentado%'
       OR s."resultadoFinal" IN ('Adjudicado','No adjudicado')
    ) THEN 'PRESENTADO'
  WHEN s.id IS NOT NULL AND (
       (s."asignaciones" -> -1 ->> 'estadoRevision') = 'RECHAZADO'
       OR s."resultadoFinal" = 'No favorable'
       OR LOWER(COALESCE(s."estadoSolicitud", '')) IN ('cerrada','cerrado','cerrada por observación')
    ) THEN 'NO_PRESENTADO'
  WHEN s.id IS NOT NULL THEN 'PENDIENTE'
  WHEN p."fechaVencimiento" IS NOT NULL AND p."fechaVencimiento" >= NOW() THEN 'PENDIENTE'
  ELSE 'SIN_INFORMACION'
END`;

/** JOIN de la solicitud más reciente vinculada al proceso. */
const JOIN_SOLICITUD = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT s2.id, s2."estadoSolicitud", s2."asignaciones", s2."resultadoFinal", s2."usuarioRegistro"
    FROM "Solicitud" s2
    WHERE s2."procesoId" = p.id
       OR (s2."procesoSourceKey" IS NOT NULL AND s2."procesoSourceKey" <> '' AND s2."procesoSourceKey" = p."sourceKey")
    ORDER BY s2."updatedAt" DESC
    LIMIT 1
  ) s ON TRUE`;

/** WHERE combinando filtros whitelisted + restricción de empresas de la clave. */
function whereSql(f: FiltrosIndicadores, opts: { incluirPeriodo?: boolean; soloSinFecha?: boolean } = {}): Prisma.Sql {
  const { incluirPeriodo = true, soloSinFecha = false } = opts;
  const fecha = colFecha(f.fechaReferencia);
  const cond: Prisma.Sql[] = [Prisma.sql`TRUE`];

  if (soloSinFecha) {
    cond.push(Prisma.sql`${fecha} IS NULL`);
  } else if (incluirPeriodo) {
    if (f.anio !== undefined) cond.push(Prisma.sql`EXTRACT(YEAR FROM ${fecha}) = ${f.anio}`);
    if (f.mes !== undefined) cond.push(Prisma.sql`EXTRACT(MONTH FROM ${fecha}) = ${f.mes}`);
    if (f.fechaDesde) cond.push(Prisma.sql`${fecha} >= ${f.fechaDesde}::date`);
    if (f.fechaHasta) cond.push(Prisma.sql`${fecha} < (${f.fechaHasta}::date + INTERVAL '1 day')`);
  }

  if (f.empresa) cond.push(Prisma.sql`p."perfil" = ${f.empresa}`);
  else if (f.empresasPermitidas.length > 0) {
    cond.push(Prisma.sql`p."perfil" = ANY(${f.empresasPermitidas})`);
  }
  if (f.fuente) cond.push(Prisma.sql`p."aliasFuente" = ${f.fuente}`);
  if (f.departamento) cond.push(Prisma.sql`p."departamento" = ${f.departamento}`);
  if (f.modalidad) cond.push(Prisma.sql`p."modalidad" = ${f.modalidad}`);
  if (f.responsable) cond.push(Prisma.sql`s."usuarioRegistro" = ${f.responsable}`);

  return Prisma.join(cond, ' AND ');
}

// ─── Consultas ───────────────────────────────────────────────────────────────

type FilaCategoria = { categoria: string; total: bigint };

function aMapa(filas: FilaCategoria[]): Partial<Record<CategoriaPresentacion, number>> {
  const m: Partial<Record<CategoriaPresentacion, number>> = {};
  for (const r of filas) m[r.categoria as CategoriaPresentacion] = Number(r.total);
  return m;
}

export interface ResumenIndicadores {
  totales: TotalesPresentacion;
  indicadores: {
    porcentajePresentacion: number | null;
    participacionPresentadosSobreTotal: number | null;
  };
}

export function calcularIndicadores(t: TotalesPresentacion): ResumenIndicadores['indicadores'] {
  return {
    porcentajePresentacion: porcentajePresentacion(t.presentados, t.noPresentados),
    participacionPresentadosSobreTotal: participacionPresentadosSobreTotal(t.presentados, t.totalProcesos),
  };
}

export async function consultarResumen(f: FiltrosIndicadores): Promise<ResumenIndicadores> {
  const filas = await prisma.$queryRaw<FilaCategoria[]>(Prisma.sql`
    SELECT ${CATEGORIA_SQL} AS categoria, COUNT(*) AS total
    FROM "Proceso" p ${JOIN_SOLICITUD}
    WHERE ${whereSql(f)}
    GROUP BY 1`);

  // Procesos que cumplen los filtros no temporales pero sin fecha de referencia
  const tienePeriodo = f.anio !== undefined || f.fechaDesde !== undefined || f.fechaHasta !== undefined;
  let sinFecha = 0;
  if (f.fechaReferencia !== 'registro') {   // createdAt nunca es null
    const filasSinFecha = await prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS total
      FROM "Proceso" p ${JOIN_SOLICITUD}
      WHERE ${whereSql(f, { soloSinFecha: true })}`);
    sinFecha = Number(filasSinFecha[0]?.total ?? 0);
  }
  void tienePeriodo;

  const totales = construirTotales(aMapa(filas), sinFecha);
  return { totales, indicadores: calcularIndicadores(totales) };
}

export interface FilaMensual { mes: number; resumen: ResumenIndicadores }

export async function consultarMensual(f: FiltrosIndicadores, anio: number): Promise<FilaMensual[]> {
  const fecha = colFecha(f.fechaReferencia);
  const filas = await prisma.$queryRaw<{ mes: number; categoria: string; total: bigint }[]>(Prisma.sql`
    SELECT EXTRACT(MONTH FROM ${fecha})::int AS mes, ${CATEGORIA_SQL} AS categoria, COUNT(*) AS total
    FROM "Proceso" p ${JOIN_SOLICITUD}
    WHERE ${whereSql({ ...f, anio, mes: undefined, fechaDesde: undefined, fechaHasta: undefined })}
    GROUP BY 1, 2`);

  // Devolver SIEMPRE los 12 meses, con ceros donde no hay registros
  const porMes = new Map<number, FilaCategoria[]>();
  for (const r of filas) {
    if (!porMes.has(r.mes)) porMes.set(r.mes, []);
    porMes.get(r.mes)!.push({ categoria: r.categoria, total: r.total });
  }
  return Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    const totales = construirTotales(aMapa(porMes.get(mes) ?? []));
    return { mes, resumen: { totales, indicadores: calcularIndicadores(totales) } };
  });
}

export interface FilaAnual { anio: number; resumen: ResumenIndicadores }

export async function consultarAnual(f: FiltrosIndicadores, anioDesde: number, anioHasta: number): Promise<FilaAnual[]> {
  const fecha = colFecha(f.fechaReferencia);
  const filas = await prisma.$queryRaw<{ anio: number; categoria: string; total: bigint }[]>(Prisma.sql`
    SELECT EXTRACT(YEAR FROM ${fecha})::int AS anio, ${CATEGORIA_SQL} AS categoria, COUNT(*) AS total
    FROM "Proceso" p ${JOIN_SOLICITUD}
    WHERE ${whereSql({ ...f, anio: undefined, mes: undefined, fechaDesde: undefined, fechaHasta: undefined })}
      AND EXTRACT(YEAR FROM ${fecha}) BETWEEN ${anioDesde} AND ${anioHasta}
    GROUP BY 1, 2`);

  const porAnio = new Map<number, FilaCategoria[]>();
  for (const r of filas) {
    if (!porAnio.has(r.anio)) porAnio.set(r.anio, []);
    porAnio.get(r.anio)!.push({ categoria: r.categoria, total: r.total });
  }
  const out: FilaAnual[] = [];
  for (let a = anioDesde; a <= anioHasta; a++) {
    const totales = construirTotales(aMapa(porAnio.get(a) ?? []));
    out.push({ anio: a, resumen: { totales, indicadores: calcularIndicadores(totales) } });
  }
  return out;
}

// ─── Detalle paginado ────────────────────────────────────────────────────────

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

export function normalizarPaginacion(pageRaw: string | null, pageSizeRaw: string | null): { page: number; pageSize: number } {
  const page = Math.max(1, Number.parseInt(pageRaw ?? '1', 10) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number.parseInt(pageSizeRaw ?? String(PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT));
  return { page, pageSize };
}

export interface FilaDetalle {
  id: number;
  codigoProceso: string | null;
  nombre: string | null;
  entidad: string | null;
  fuente: string | null;
  aliasFuente: string | null;
  modalidad: string | null;
  empresa: string | null;          // Proceso.perfil
  departamento: string | null;
  fechaPublicacion: Date | null;
  fechaVencimiento: Date | null;
  valor: number | null;
  estadoFuente: string | null;
  categoria: CategoriaPresentacion;
}

export async function consultarDetalle(
  f: FiltrosIndicadores, page: number, pageSize: number,
): Promise<{ filas: FilaDetalle[]; total: number }> {
  const where = whereSql(f);
  const conCategoria = f.categoria
    ? Prisma.sql`${where} AND ${CATEGORIA_SQL} = ${f.categoria}`
    : where;

  const [filas, totalRows] = await Promise.all([
    prisma.$queryRaw<FilaDetalle[]>(Prisma.sql`
      SELECT p.id, p."codigoProceso", p.nombre, p.entidad, p.fuente, p."aliasFuente",
             p.modalidad, p."perfil" AS empresa, p.departamento,
             p."fechaPublicacion", p."fechaVencimiento", p.valor, p."estadoFuente",
             ${CATEGORIA_SQL} AS categoria
      FROM "Proceso" p ${JOIN_SOLICITUD}
      WHERE ${conCategoria}
      ORDER BY ${colFecha(f.fechaReferencia)} DESC NULLS LAST, p.id DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS total
      FROM "Proceso" p ${JOIN_SOLICITUD}
      WHERE ${conCategoria}`),
  ]);

  return { filas, total: Number(totalRows[0]?.total ?? 0) };
}
