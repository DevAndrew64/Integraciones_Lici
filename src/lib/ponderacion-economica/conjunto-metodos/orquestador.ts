/**
 * Orquestadores con BD del ciclo de vida de `ConjuntoMetodosPonderacionProceso`
 * — FASE A.1. Mismo lock (`conLockDePliego`) que la regla TRM.
 */

import prisma from '@/lib/prisma';
import { conLockDePliego } from '../lock-pliego';
import { sincronizarEstadoRevisionPliego } from '../sincronizar-estado-pliego';
import { resolverCriteriosDeConjunto, estadoRevisionMetodosDeConjunto } from '../robusto/gate-conjunto';
import { evaluarGateUsoPonderacionTrm, type UsoPonderacionTrm } from '../robusto/estado-pliego';
import {
  planearCrearConjuntoCandidato, planearAprobarConjunto, planearRechazarConjunto,
  validarInvarianteConjunto, type EstadoConjunto, type ConjuntoLite,
} from './lifecycle';

const SEL = { id: true, procesoId: true, version: true, estadoVersion: true } as const;

async function leerEstado(procesoId: number): Promise<EstadoConjunto> {
  const todas = (await prisma.conjuntoMetodosPonderacionProceso.findMany({ where: { procesoId }, select: SEL })) as unknown as ConjuntoLite[];
  validarInvarianteConjunto(todas);
  return {
    activa: todas.find(c => c.estadoVersion === 'ACTIVA') ?? null,
    candidata: todas.find(c => c.estadoVersion === 'CANDIDATA') ?? null,
    versionMaxima: todas.reduce((m, c) => Math.max(m, c.version), 0),
  };
}

export interface DatosConjuntoCandidato {
  procesoId: number;
  documentoId: number;
  analisisEconomicoId: number;
  creadoPorId: number;
  origenCambio?: string;
  advertencias?: unknown;
  /** criterios ya extraídos por Gemini (se crean dentro de la TX, ligados al nuevo conjunto).
   *  tipoFormula/formulaReferenciaTexto/reglaPuntuacionTexto son TAL COMO aparecen en el pliego —
   *  NO implican equivalencia con el motor (eso se confirma aparte, §6). */
  criterios: Array<{
    nombreMetodo: string; tipoFormula: string;
    rangoTrmDesde: number | null; rangoTrmHasta: number | null;
    condicionTrmTexto: string | null;
    puntajeMaximo: number | null;
    formulaReferenciaTexto: string | null;
    reglaPuntuacionTexto: string | null;
    baseEconomicaEvaluada: string | null;
    descripcionBaseEconomica: string | null;
    baseEconomicaTextoFuente: string | null;
    baseEconomicaPaginaReferencia: number | null;
    textoFuente: string | null; paginaReferencia: number | null; confianzaExtraccion: number | null;
  }>;
}

/** T1 — crea un CONJUNTO CANDIDATO + sus métodos. NO toca el ACTIVO.
 *  Si había un CANDIDATO previo: se auto-rechaza (SISTEMA) y sus métodos → descartado. */
export async function crearConjuntoCandidato(d: DatosConjuntoCandidato): Promise<{ conjuntoId: number; version: number; metodos: number }> {
  return conLockDePliego(d.procesoId, async () => {
    const estado = await leerEstado(d.procesoId);
    const plan = planearCrearConjuntoCandidato(estado);
    const res = await prisma.$transaction(async (tx) => {
      if (plan.autoRechazar) {
        await tx.conjuntoMetodosPonderacionProceso.update({
          where: { id: plan.autoRechazar.id },
          data: { estadoVersion: 'RECHAZADA', origenTransicion: 'SISTEMA', rechazadoPorId: null, rechazadoEn: new Date(), motivoRechazo: plan.autoRechazar.motivoRechazo },
        });
        await tx.metodoPonderacionProceso.updateMany({ where: { conjuntoMetodosId: plan.autoRechazar.id }, data: { estadoRevision: 'descartado' } });
      }
      const conjunto = await tx.conjuntoMetodosPonderacionProceso.create({
        data: {
          procesoId: d.procesoId, version: plan.nuevaVersion, estadoVersion: 'CANDIDATA',
          origenCambio: d.origenCambio ?? 'EXTRACCION', advertencias: (d.advertencias ?? undefined) as never,
          documentoId: d.documentoId, analisisEconomicoId: d.analisisEconomicoId,
          origenTransicion: 'HUMANO', creadoPorId: d.creadoPorId,
        },
        select: { id: true, version: true },
      });
      if (d.criterios.length) {
        await tx.metodoPonderacionProceso.createMany({
          data: d.criterios.map(m => ({
            procesoId: d.procesoId,
            conjuntoMetodosId: conjunto.id,
            analisisEconomicoProcesoId: d.analisisEconomicoId,
            nombreMetodo: m.nombreMetodo, tipoFormula: m.tipoFormula,
            rangoTrmDesde: m.rangoTrmDesde, rangoTrmHasta: m.rangoTrmHasta,
            condicionTrmTexto: m.condicionTrmTexto,
            puntajeMaximo: m.puntajeMaximo ?? null,
            formulaReferenciaTexto: m.formulaReferenciaTexto, reglaPuntuacionTexto: m.reglaPuntuacionTexto,
            // equivalenciaMotorEstado nace NO_EVALUADA (@default) — Gemini nunca la confirma.
            baseEconomicaEvaluada: (m.baseEconomicaEvaluada ?? null) as never,
            descripcionBaseEconomica: m.descripcionBaseEconomica,
            baseEconomicaTextoFuente: m.baseEconomicaTextoFuente, baseEconomicaPaginaReferencia: m.baseEconomicaPaginaReferencia,
            textoFuente: m.textoFuente, paginaReferencia: m.paginaReferencia, confianzaExtraccion: m.confianzaExtraccion,
            fuenteExtraccion: 'gemini_pdf', estadoRevision: 'pendiente_revision', aprobado: false,
          })),
        });
      }
      return { conjuntoId: conjunto.id, version: conjunto.version, metodos: d.criterios.length };
    });
    await sincronizarEstadoRevisionPliego(d.procesoId);
    return res;
  });
}

/**
 * T3 — aprobar el CONJUNTO CANDIDATO. Valida precondiciones de dominio.
 * Presupuesto/PM son OPCIONALES en la llamada: solo se EXIGEN (y el plan
 * lanza si faltan) cuando alguna fórmula del conjunto los necesita (§3).
 */
export async function aprobarConjunto(
  procesoId: number, candidatoId: number, aprobadoPorId: number,
  presupuestoOficialAprobado: number | null, puntajeMaximoEconomicoAprobado: number | null,
  provenance?: { presupuestoTextoFuente?: string | null; presupuestoPaginaReferencia?: number | null; presupuestoOrigen?: string | null; puntajeMaximoTextoFuente?: string | null; puntajeMaximoPaginaReferencia?: number | null },
): Promise<void> {
  await conLockDePliego(procesoId, async () => {
    // §1 — mismo gate que la regla TRM: sin confirmación humana de
    // usaPonderacionTrm = SI, ningún CONJUNTO puede pasar a ACTIVO.
    const proceso = await prisma.proceso.findUnique({ where: { id: procesoId }, select: { usaPonderacionTrm: true } });
    if (!proceso) throw new Error('Proceso no encontrado.');
    const gate = evaluarGateUsoPonderacionTrm(proceso.usaPonderacionTrm as UsoPonderacionTrm);
    if (!gate.ok) throw new Error(`No se puede activar el conjunto de métodos: ${gate.detalle} Confirma primero Proceso.usaPonderacionTrm = SI (PATCH /analisis-economico { accion: "confirmarUsoTrm", valor: "SI" }).`);

    const estado = await leerEstado(procesoId);
    if (!estado.candidata || estado.candidata.id !== candidatoId) throw new Error('El CONJUNTO CANDIDATO indicado ya no está vigente.');

    const [criterios, rev] = await Promise.all([resolverCriteriosDeConjunto(candidatoId), estadoRevisionMetodosDeConjunto(candidatoId)]);
    const requierePresupuestoPorFormula = criterios.ok && criterios.requierePresupuesto;

    // persiste presupuesto/PM aprobados + flag derivado (para que el gate los vea)
    await prisma.conjuntoMetodosPonderacionProceso.update({
      where: { id: candidatoId },
      data: {
        presupuestoRequeridoPorFormula: requierePresupuestoPorFormula,
        presupuestoOficialAprobado, puntajeMaximoEconomicoAprobado,
        presupuestoTextoFuente: provenance?.presupuestoTextoFuente ?? null,
        presupuestoPaginaReferencia: provenance?.presupuestoPaginaReferencia ?? null,
        presupuestoOrigen: provenance?.presupuestoOrigen ?? null,
        puntajeMaximoTextoFuente: provenance?.puntajeMaximoTextoFuente ?? null,
        puntajeMaximoPaginaReferencia: provenance?.puntajeMaximoPaginaReferencia ?? null,
      },
    });

    const plan = planearAprobarConjunto(estado, {
      totalMetodos: rev.total, metodosPendientes: rev.pendientes, metodosRechazados: rev.rechazados,
      gateCriteriosOk: criterios.ok,
      requierePresupuestoPorFormula, todosMetodosTienenPM: rev.todosMetodosTienenPM,
      presupuestoOficialAprobado, puntajeMaximoEconomicoAprobado,
    }); // lanza con la lista de errores si no es aprobable

    await prisma.$transaction(async (tx) => {
      if (plan.supersederActivaId != null) {
        await tx.conjuntoMetodosPonderacionProceso.update({ where: { id: plan.supersederActivaId }, data: { estadoVersion: 'SUPERSEDED', supersedidoEn: new Date() } });
        // los métodos del conjunto anterior quedan como historial (no se tocan)
      }
      await tx.conjuntoMetodosPonderacionProceso.update({
        where: { id: plan.candidataId },
        data: { estadoVersion: 'ACTIVA', supersedeAId: plan.supersederActivaId, origenTransicion: 'HUMANO', aprobadoPorId, aprobadoEn: new Date() },
      });
    });
    await sincronizarEstadoRevisionPliego(procesoId);
  });
}

/** T2 — rechazar el CONJUNTO CANDIDATO. El ACTIVO anterior permanece intacto. */
export async function rechazarConjunto(procesoId: number, candidatoId: number, rechazadoPorId: number, motivoRechazo: string): Promise<void> {
  await conLockDePliego(procesoId, async () => {
    const estado = await leerEstado(procesoId);
    if (!estado.candidata || estado.candidata.id !== candidatoId) throw new Error('El CONJUNTO CANDIDATO indicado ya no está vigente.');
    planearRechazarConjunto(estado);
    await prisma.$transaction(async (tx) => {
      await tx.conjuntoMetodosPonderacionProceso.update({
        where: { id: candidatoId },
        data: { estadoVersion: 'RECHAZADA', origenTransicion: 'HUMANO', rechazadoPorId, rechazadoEn: new Date(), motivoRechazo },
      });
      await tx.metodoPonderacionProceso.updateMany({ where: { conjuntoMetodosId: candidatoId }, data: { estadoRevision: 'descartado' } });
    });
    await sincronizarEstadoRevisionPliego(procesoId);
  });
}
