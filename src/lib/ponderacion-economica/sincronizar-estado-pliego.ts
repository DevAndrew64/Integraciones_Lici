/**
 * Recalcula y persiste `Proceso.estadoRevisionPliego` a partir del estado
 * REAL de la regla TRM ACTIVA/CANDIDATA y del conjunto de métodos ACTIVO/
 * CANDIDATO — FASE A.1.
 *
 * Se llama después de CUALQUIER transición (crear candidata / aprobar /
 * rechazar, de regla o de conjunto) y después de aprobar/rechazar métodos
 * individuales. Fuente de verdad única: `computarEstadoRevisionPliego`.
 */

import prisma from '@/lib/prisma';
import {
  computarEstadoRevisionPliego, resolverCriteriosDeConjunto, type InsumosEstadoPliego,
} from './robusto/gate-conjunto';

/** Subconjunto de PrismaClient/tx que esta función necesita — permite pasar
 *  el `tx` de un `prisma.$transaction(...)` para que el UPDATE final quede
 *  en la MISMA transacción que el cambio que lo disparó (§2 de la
 *  microauditoría). Por defecto usa el cliente global (comportamiento previo
 *  sin cambios para los callers que no pasan `client`). */
type ClienteEstadoPliego = Pick<typeof prisma, 'reglaTrmProceso' | 'conjuntoMetodosPonderacionProceso' | 'analisisEconomicoProceso' | 'proceso'>;

export async function sincronizarEstadoRevisionPliego(procesoId: number, client: ClienteEstadoPliego = prisma): Promise<string> {
  const [proc, reglas, conjuntos, algunAnalisis] = await Promise.all([
    client.proceso.findUnique({ where: { id: procesoId }, select: { usaPonderacionTrm: true } }),
    client.reglaTrmProceso.findMany({
      where: { procesoId, estadoVersion: { in: ['ACTIVA', 'CANDIDATA'] } },
      select: { id: true, estadoVersion: true, reglaCentavos: true },
    }),
    client.conjuntoMetodosPonderacionProceso.findMany({
      where: { procesoId, estadoVersion: { in: ['ACTIVA', 'CANDIDATA'] } },
      select: { id: true, estadoVersion: true, presupuestoOficialAprobado: true, puntajeMaximoEconomicoAprobado: true },
    }),
    client.analisisEconomicoProceso.count({ where: { procesoId } }),
  ]);
  if (!proc) throw new Error(`Proceso ${procesoId} no encontrado al sincronizar estadoRevisionPliego.`);

  const reglaActiva = reglas.find(r => r.estadoVersion === 'ACTIVA') ?? null;
  const conjuntoActivoRow = conjuntos.find(c => c.estadoVersion === 'ACTIVA') ?? null;

  let conjuntoActivo: InsumosEstadoPliego['conjuntoActivo'] = null;
  if (conjuntoActivoRow) {
    const criterios = await resolverCriteriosDeConjunto(conjuntoActivoRow.id);
    conjuntoActivo = {
      criteriosOk: criterios.ok,
      presupuestoOficialAprobado: conjuntoActivoRow.presupuestoOficialAprobado != null ? Number(conjuntoActivoRow.presupuestoOficialAprobado) : null,
      puntajeMaximoEconomicoAprobado: conjuntoActivoRow.puntajeMaximoEconomicoAprobado != null ? Number(conjuntoActivoRow.puntajeMaximoEconomicoAprobado) : null,
    };
  }

  const estado = computarEstadoRevisionPliego({
    usaPonderacionTrm: proc.usaPonderacionTrm as InsumosEstadoPliego['usaPonderacionTrm'],
    reglaActiva: reglaActiva ? { reglaCentavos: reglaActiva.reglaCentavos } : null,
    reglaCandidataPendiente: reglas.some(r => r.estadoVersion === 'CANDIDATA'),
    conjuntoActivo,
    conjuntoCandidatoPendiente: conjuntos.some(c => c.estadoVersion === 'CANDIDATA'),
    huboAlgunAnalisis: algunAnalisis > 0,
  });

  await client.proceso.update({ where: { id: procesoId }, data: { estadoRevisionPliego: estado as never } });
  return estado;
}
