/**
 * Persistencia del módulo de proyección decimal TRM.
 *
 *   trm_historico          → serie diaria oficial completa (incluye repetidos).
 *   trm_eventos_efectivos  → solo cambios reales de TRM (serie de entrenamiento).
 *   trm_predicciones       → resultado de cada recalibración del modelo.
 *
 * Solo se importa en contexto servidor. Igual que trmCache.ts, todas las
 * operaciones están protegidas: si el cliente Prisma en memoria no tiene los
 * modelos (cliente antiguo en desarrollo), devuelven valores vacíos.
 */

import prisma from '@/lib/prisma';
import type { ProyeccionDecimalOutput } from './proyeccionDecimal';
import type { TrmHistorialEntry } from './types';

function modelosDisponibles(): boolean {
  const p = prisma as unknown as Record<string, unknown>;
  return (
    typeof p.trmHistorico !== 'undefined' &&
    typeof p.trmEventoEfectivo !== 'undefined' &&
    typeof p.trmPrediccion !== 'undefined'
  );
}

function toDateOnly(str: string): Date {
  return new Date(str + 'T00:00:00.000Z');
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── trm_historico ───────────────────────────────────────────────────────────

/**
 * Upsert masivo de la serie diaria en trm_historico.
 * Guarda todos los registros recibidos, incluso repetidos por domingo/festivo.
 */
export async function upsertHistorico(
  entries: TrmHistorialEntry[],
  fuente = 'datos_gov_co',
): Promise<number> {
  if (!modelosDisponibles()) return 0;
  let escritos = 0;
  for (const { fecha, valor } of entries) {
    const v = Number(valor);
    if (!fecha || !isFinite(v) || v <= 0) continue;
    try {
      await prisma.trmHistorico.upsert({
        where: { fecha: toDateOnly(fecha) },
        create: { fecha: toDateOnly(fecha), trm: v, fuente },
        update: { trm: v, fuente },
      });
      escritos++;
    } catch (e) {
      console.error('[trmStore] upsertHistorico falló para', fecha, e);
    }
  }
  return escritos;
}

/** Serie diaria de trm_historico de los últimos `dias` días, ordenada ascendente. */
export async function leerHistorico(dias: number): Promise<TrmHistorialEntry[]> {
  if (!modelosDisponibles()) return [];
  try {
    const desde = new Date(Date.now() - dias * 86400000);
    const rows = await prisma.trmHistorico.findMany({
      where: { fecha: { gte: desde } },
      orderBy: { fecha: 'asc' },
      select: { fecha: true, trm: true },
    });
    return rows.map(r => ({ fecha: toYmd(r.fecha), valor: Number(r.trm) }));
  } catch (e) {
    console.error('[trmStore] leerHistorico falló:', e);
    return [];
  }
}

/** Cantidad de registros en trm_historico. */
export async function contarHistorico(): Promise<number> {
  if (!modelosDisponibles()) return 0;
  try {
    return await prisma.trmHistorico.count();
  } catch {
    return 0;
  }
}

// ─── trm_eventos_efectivos ───────────────────────────────────────────────────

/**
 * Sincroniza trm_eventos_efectivos con trm_historico de forma incremental:
 * recorre el histórico posterior al último evento registrado e inserta las
 * fechas donde la TRM cambió respecto al valor inmediatamente anterior
 * (primer dato del sistema incluido). Devuelve cuántos eventos nuevos insertó.
 */
export async function sincronizarEventosEfectivos(): Promise<number> {
  if (!modelosDisponibles()) return 0;
  try {
    const ultimo = await prisma.trmEventoEfectivo.findFirst({
      orderBy: { eventoId: 'desc' },
    });

    const rows = await prisma.trmHistorico.findMany({
      where: ultimo ? { fecha: { gt: ultimo.fecha } } : undefined,
      orderBy: { fecha: 'asc' },
      select: { fecha: true, trm: true },
    });
    if (!rows.length) return 0;

    let anterior: number | null = ultimo ? Number(ultimo.trm) : null;
    let eventoId = ultimo ? ultimo.eventoId : -1;
    let insertados = 0;

    for (const r of rows) {
      const valor = Number(r.trm);
      if (!isFinite(valor) || valor <= 0) continue;
      if (anterior === null || valor !== anterior) {
        eventoId++;
        await prisma.trmEventoEfectivo.create({
          data: { fecha: r.fecha, trm: valor, eventoId },
        });
        insertados++;
        anterior = valor;
      }
      // Repetición consecutiva (domingo/festivo/día sin cambio): no entra al modelo
    }
    return insertados;
  } catch (e) {
    console.error('[trmStore] sincronizarEventosEfectivos falló:', e);
    return 0;
  }
}

/** Últimos `limite` eventos efectivos, ordenados ascendente por eventoId. */
export async function leerEventosEfectivos(
  limite: number,
): Promise<{ fecha: string; valor: number; eventoId: number }[]> {
  if (!modelosDisponibles()) return [];
  try {
    const rows = await prisma.trmEventoEfectivo.findMany({
      orderBy: { eventoId: 'desc' },
      take: limite,
    });
    return rows
      .reverse()
      .map(r => ({ fecha: toYmd(r.fecha), valor: Number(r.trm), eventoId: r.eventoId }));
  } catch (e) {
    console.error('[trmStore] leerEventosEfectivos falló:', e);
    return [];
  }
}

/** eventoId más alto registrado, o null si no hay eventos. */
export async function maxEventoId(): Promise<number | null> {
  if (!modelosDisponibles()) return null;
  try {
    const ultimo = await prisma.trmEventoEfectivo.findFirst({
      orderBy: { eventoId: 'desc' },
      select: { eventoId: true },
    });
    return ultimo?.eventoId ?? null;
  } catch {
    return null;
  }
}

// ─── trm_predicciones ────────────────────────────────────────────────────────

export async function guardarPrediccion(
  resultado: ProyeccionDecimalOutput,
  ultimoEvento: number | null,
): Promise<void> {
  if (!modelosDisponibles()) return;
  try {
    await prisma.trmPrediccion.create({
      data: {
        fechaObjetivo: toDateOnly(resultado.fechaObjetivo),
        fechaTRMAplicable: toDateOnly(resultado.fechaTRMAplicable),
        trmMedianaSimulada: resultado.trmMedianaSimulada,
        decimalRecomendado: resultado.decimalRecomendado,
        rangoPliego: resultado.rangoPliego,
        metodoProbable: resultado.metodoProbable,
        probabilidadDecimal: resultado.probabilidadDecimal,
        probabilidadRango: resultado.probabilidadRango,
        nivelConfianza: resultado.nivelConfianza,
        horizonteDiasHabiles: resultado.horizonteDiasHabiles,
        modeloUsado: resultado.modeloUsado,
        advertencia: resultado.advertencia,
        ultimoEventoId: ultimoEvento,
      },
    });
  } catch (e) {
    console.error('[trmStore] guardarPrediccion falló:', e);
  }
}

/**
 * Última predicción almacenada para una fecha objetivo, si sigue vigente
 * (calibrada con el evento efectivo más reciente).
 */
export async function prediccionVigente(
  fechaObjetivo: string,
  eventoActual: number | null,
): Promise<ProyeccionDecimalOutput | null> {
  if (!modelosDisponibles() || eventoActual === null) return null;
  try {
    const row = await prisma.trmPrediccion.findFirst({
      where: { fechaObjetivo: toDateOnly(fechaObjetivo), ultimoEventoId: eventoActual },
      orderBy: { fechaCalculo: 'desc' },
    });
    if (!row) return null;
    return {
      decimalRecomendado: row.decimalRecomendado,
      rangoPliego: row.rangoPliego,
      metodoProbable: row.metodoProbable,
      metodoProbableKey: null,
      nivelConfianza: (row.nivelConfianza as ProyeccionDecimalOutput['nivelConfianza']) ?? null,
      horizonteDiasHabiles: row.horizonteDiasHabiles,
      advertencia: row.advertencia,
      esDatoReal: false,
      fechaObjetivo: toYmd(row.fechaObjetivo),
      fechaTRMAplicable: toYmd(row.fechaTRMAplicable),
      trmMedianaSimulada: row.trmMedianaSimulada != null ? Number(row.trmMedianaSimulada) : null,
      probabilidadDecimal: row.probabilidadDecimal != null ? Number(row.probabilidadDecimal) : null,
      probabilidadRango: row.probabilidadRango != null ? Number(row.probabilidadRango) : null,
      intervalo95: null,
      modeloUsado: row.modeloUsado,
      variablesUsadas: [],
    };
  } catch (e) {
    console.error('[trmStore] prediccionVigente falló:', e);
    return null;
  }
}
