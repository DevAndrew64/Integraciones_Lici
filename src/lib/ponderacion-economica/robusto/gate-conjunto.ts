/**
 * Gate de criterios acotado a UN conjunto versionado — FASE A.1.
 *
 * NUNCA valida "todos los MetodoPonderacionProceso con aprobado=true del
 * proceso". Siempre el subconjunto de UN `ConjuntoMetodosPonderacionProceso`
 * (el ACTIVO para recomendar, el CANDIDATO para revisar).
 *
 * `computarEstadoRevisionPliego` es la única fuente de verdad del estado
 * global `Proceso.estadoRevisionPliego`.
 */

import prisma from '@/lib/prisma';
import { resolverCriteriosPliego, type MetodoPliegoEntrada, type ResultadoCriteriosPliego } from './criterios-pliego';

export { computarEstadoRevisionPliego } from './estado-pliego';
export type { EstadoRevisionPliego, InsumosEstadoPliego } from './estado-pliego';

/** Métodos de un conjunto → entrada del validador. */
export async function cargarMetodosDeConjunto(conjuntoId: number): Promise<MetodoPliegoEntrada[]> {
  const ms = await prisma.metodoPonderacionProceso.findMany({
    where: { conjuntoMetodosId: conjuntoId },
    select: {
      id: true, nombreMetodo: true, tipoFormula: true, rangoTrmDesde: true, rangoTrmHasta: true,
      puntajeMaximo: true, estadoRevision: true, aprobado: true, formulaTexto: true, textoFuente: true,
      formulaKeyMotor: true, equivalenciaMotorEstado: true,
    },
  });
  return ms.map(m => ({
    id: m.id, nombreMetodo: m.nombreMetodo, tipoFormula: m.tipoFormula,
    rangoTrmDesde: m.rangoTrmDesde, rangoTrmHasta: m.rangoTrmHasta,
    puntajeMaximo: m.puntajeMaximo != null ? Number(m.puntajeMaximo) : null,
    estadoRevision: m.estadoRevision, aprobado: m.aprobado,
    formulaTexto: m.formulaTexto, textoFuente: m.textoFuente,
    formulaKeyMotor: m.formulaKeyMotor, equivalenciaMotorEstado: m.equivalenciaMotorEstado,
  }));
}

export async function resolverCriteriosDeConjunto(conjuntoId: number): Promise<ResultadoCriteriosPliego> {
  return resolverCriteriosPliego(await cargarMetodosDeConjunto(conjuntoId));
}

/** Conteo de revisión individual + §3: ¿el conjunto NECESITA presupuesto/PM a nivel de conjunto? */
export async function estadoRevisionMetodosDeConjunto(conjuntoId: number): Promise<{
  total: number; pendientes: number; rechazados: number; aprobados: number; todosMetodosTienenPM: boolean;
}> {
  const ms = await prisma.metodoPonderacionProceso.findMany({
    where: { conjuntoMetodosId: conjuntoId },
    select: { estadoRevision: true, aprobado: true, puntajeMaximo: true },
  });
  const aprobados = ms.filter(m => m.aprobado === true && m.estadoRevision === 'aprobado');
  return {
    total: ms.length,
    pendientes: ms.filter(m => m.estadoRevision !== 'aprobado' && m.estadoRevision !== 'rechazado' && m.estadoRevision !== 'descartado').length,
    rechazados: ms.filter(m => m.estadoRevision === 'rechazado').length,
    aprobados: aprobados.length,
    todosMetodosTienenPM: aprobados.length > 0 && aprobados.every(m => m.puntajeMaximo != null && Number(m.puntajeMaximo) > 0),
  };
}
