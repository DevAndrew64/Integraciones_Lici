/**
 * Operaciones de caché TRM en base de datos (Prisma).
 * Solo se importa en contexto servidor (API routes).
 *
 * HOTFIX: todas las operaciones de BD están envueltas en try/catch.
 * Si el cliente Prisma no tiene el modelo TrmCache (ej. cliente antiguo en
 * globalThis durante desarrollo), las funciones devuelven null/undefined
 * de forma silenciosa y el flujo continúa con el fetch externo.
 */

import prisma from '@/lib/prisma';
import { calcularCentavosTRM } from '@/lib/ponderacion-economica';
import type { TrmFetchResult } from './types';

/** Verifica que el modelo TrmCache existe en el cliente Prisma en memoria.
 *  Protege contra el caso en que el servidor de desarrollo tenga cargado un
 *  PrismaClient antiguo (pre-migración) en globalThis. */
function cacheDisponible(): boolean {
  return typeof (prisma as unknown as Record<string, unknown>).trmCache !== 'undefined';
}

/** Convierte 'YYYY-MM-DD' a Date UTC medianoche para comparar con @db.Date */
function toDateOnly(str: string): Date {
  return new Date(str + 'T00:00:00.000Z');
}

/** Hoy en formato 'YYYY-MM-DD' (UTC) */
export function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Lectura ─────────────────────────────────────────────────────────────────

/**
 * Busca el valor TRM de una fecha en caché.
 * Retorna null si no está en caché o si el modelo no está disponible.
 */
export async function buscarEnCache(fecha: string, fuente = 'datos_gov_co') {
  if (!cacheDisponible()) return null;
  try {
    return await prisma.trmCache.findUnique({
      where: { fecha_fuente: { fecha: toDateOnly(fecha), fuente } },
    });
  } catch (e) {
    console.error('[trmCache] buscarEnCache falló:', e);
    return null;
  }
}

/**
 * Devuelve el último valor conocido en caché (cualquier fecha, cualquier fuente).
 * Útil como fallback si el fetch falla y la fecha solicitada no está cacheada.
 */
export async function ultimoValorCache() {
  if (!cacheDisponible()) return null;
  try {
    return await prisma.trmCache.findFirst({
      orderBy: { fecha: 'desc' },
    });
  } catch (e) {
    console.error('[trmCache] ultimoValorCache falló:', e);
    return null;
  }
}

/**
 * Lee el historial TRM desde el caché BD (últimos `dias` días).
 * Fallback para cuando el fetch externo no está disponible.
 */
export async function listarHistorialCache(dias: number): Promise<{ fecha: string; valor: number }[]> {
  if (!cacheDisponible()) return [];
  try {
    const desde = new Date(Date.now() - dias * 86400000);
    const rows = await prisma.trmCache.findMany({
      where: { fecha: { gte: desde } },
      orderBy: { fecha: 'asc' },
      select: { fecha: true, valor: true },
    });
    return rows.map(r => ({
      fecha: r.fecha.toISOString().slice(0, 10),
      valor: Number(r.valor),
    }));
  } catch (e) {
    console.error('[trmCache] listarHistorialCache falló:', e);
    return [];
  }
}

// ─── Escritura ────────────────────────────────────────────────────────────────

/**
 * Guarda o actualiza un valor TRM en caché.
 */
export async function guardarEnCache(params: {
  fecha: string;
  valor: number;
  vigenciaDesde?: string;
  vigenciaHasta?: string;
  fuente?: string;
  fuenteUrl?: string;
  esOficial?: boolean;
}) {
  if (!cacheDisponible()) return;
  const {
    fecha,
    valor,
    vigenciaDesde,
    vigenciaHasta,
    fuente = 'datos_gov_co',
    fuenteUrl,
    esOficial = true,
  } = params;

  const centavos = calcularCentavosTRM(valor);

  try {
    await prisma.trmCache.upsert({
      where: { fecha_fuente: { fecha: toDateOnly(fecha), fuente } },
      create: {
        fecha: toDateOnly(fecha),
        valor,
        centavos,
        vigenciaDesde: vigenciaDesde ? toDateOnly(vigenciaDesde) : null,
        vigenciaHasta: vigenciaHasta ? toDateOnly(vigenciaHasta) : null,
        fuente,
        fuenteUrl: fuenteUrl ?? null,
        esOficial,
      },
      update: {
        valor,
        centavos,
        vigenciaDesde: vigenciaDesde ? toDateOnly(vigenciaDesde) : null,
        vigenciaHasta: vigenciaHasta ? toDateOnly(vigenciaHasta) : null,
        fuenteUrl: fuenteUrl ?? null,
        esOficial,
      },
    });
  } catch (e) {
    console.error('[trmCache] guardarEnCache falló:', e);
  }
}

/**
 * Guarda múltiples entradas de historial en caché (upsert silencioso por conflicto).
 * Usado para poblar la caché a partir del historial traído de la API.
 */
export async function guardarHistorialEnCache(
  entries: { fecha: string; valor: number }[],
  fuente = 'datos_gov_co',
  fuenteUrl?: string,
) {
  if (!cacheDisponible()) return;
  for (const { fecha, valor } of entries) {
    try {
      await guardarEnCache({ fecha, valor, fuente, fuenteUrl, esOficial: true });
    } catch {
      // Si ya existe o falla, ignorar
    }
  }
}

// ─── Auditoría ────────────────────────────────────────────────────────────────

/**
 * Registra un intento de consulta TRM (exitoso o fallido) en TrmConsultaLog.
 */
export async function guardarLog(params: {
  fechaConsultada: string;
  fuente: string;
  fuenteUrl?: string;
  resultado: TrmFetchResult;
}) {
  if (!cacheDisponible()) return;
  const { fechaConsultada, fuente, fuenteUrl, resultado } = params;

  try {
    await prisma.trmConsultaLog.create({
      data: {
        fechaConsultada: toDateOnly(fechaConsultada),
        fuente,
        fuenteUrl: fuenteUrl ?? null,
        httpStatus: resultado.httpStatus ?? null,
        exito: resultado.ok,
        valor: resultado.valor != null ? resultado.valor : null,
        centavos:
          resultado.valor != null ? calcularCentavosTRM(resultado.valor) : null,
        vigenciaDesde: resultado.vigenciaDesde
          ? toDateOnly(resultado.vigenciaDesde)
          : null,
        vigenciaHasta: resultado.vigenciaHasta
          ? toDateOnly(resultado.vigenciaHasta)
          : null,
        error: resultado.error ?? null,
        respuestaRaw: resultado.respuestaRaw
          ? resultado.respuestaRaw.slice(0, 2000)
          : null,
      },
    });
  } catch (e) {
    console.error('[trmCache] Error guardando log:', e);
  }
}