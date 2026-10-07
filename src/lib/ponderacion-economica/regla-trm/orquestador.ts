/**
 * Orquestadores con BD del ciclo de vida de `ReglaTrmProceso` — FASE A.1.
 *
 * Concurrency-safe: advisory lock de PostgreSQL por procesoId (MISMO namespace
 * que el orquestador de conjuntos → toda la config del pliego de un proceso se
 * serializa) + `$transaction` + índices únicos parciales como backstop + retry.
 *
 * La lógica de decisión vive en `lifecycle.ts` (pura, testeada). Aquí solo se
 * ejecuta el plan contra la BD. El estado global `Proceso.estadoRevisionPliego`
 * se recalcula con `sincronizarEstadoRevisionPliego` al final.
 */

import prisma from '@/lib/prisma';
import { conLockDePliego } from '../lock-pliego';
import { sincronizarEstadoRevisionPliego } from '../sincronizar-estado-pliego';
import { evaluarGateUsoPonderacionTrm, type UsoPonderacionTrm } from '../robusto/estado-pliego';
import {
  planearCrearCandidata, planearAprobar, planearRechazar, validarInvariante,
  type EstadoRegla, type ReglaLite,
} from './lifecycle';

const SEL_LITE = { id: true, procesoId: true, version: true, estadoVersion: true, reglaCentavos: true } as const;

async function leerEstado(procesoId: number): Promise<EstadoRegla> {
  const todas = (await prisma.reglaTrmProceso.findMany({ where: { procesoId }, select: SEL_LITE })) as unknown as ReglaLite[];
  validarInvariante(todas);
  return {
    activa: todas.find(r => r.estadoVersion === 'ACTIVA') ?? null,
    candidata: todas.find(r => r.estadoVersion === 'CANDIDATA') ?? null,
    versionMaxima: todas.reduce((m, r) => Math.max(m, r.version), 0),
  };
}

export interface DatosCandidata {
  procesoId: number;
  documentoId: number;
  analisisEconomicoId: number;
  tipoReglaTrm: string;               // 'RELATIVA_A_EVENTO' | 'FECHA_FIJA' | 'NO_APLICA' | 'OTRA'
  eventoBaseTrm: string | null;
  fuenteEventoBase: string | null;
  offsetDiasHabiles: number | null;
  politicaActualizacionFecha: string | null;
  fechaBaseCongelada: string | null;
  fechaFijaTrm: string | null;
  reglaCentavos: string;
  textoReglaTrm: string | null;
  textoFuente: string | null;
  paginaReferencia: number | null;
  confianzaExtraccion: number | null;
  advertencias?: unknown;
  creadoPorId: number;
  origenCambio?: string;
}

export async function crearCandidataRegla(d: DatosCandidata): Promise<{ reglaId: number; version: number }> {
  return conLockDePliego(d.procesoId, async () => {
    const estado = await leerEstado(d.procesoId);
    const plan = planearCrearCandidata(estado);
    const res = await prisma.$transaction(async (tx) => {
      if (plan.autoRechazar) {
        await tx.reglaTrmProceso.update({
          where: { id: plan.autoRechazar.id },
          data: {
            estadoVersion: 'RECHAZADA', origenTransicion: 'SISTEMA',
            rechazadoPorId: null, rechazadoEn: new Date(), motivoRechazo: plan.autoRechazar.motivoRechazo,
          },
        });
      }
      const creada = await tx.reglaTrmProceso.create({
        data: {
          procesoId: d.procesoId, version: plan.nuevaVersion, estadoVersion: 'CANDIDATA',
          origenCambio: d.origenCambio ?? 'EXTRACCION',
          tipoReglaTrm: d.tipoReglaTrm as never,
          eventoBaseTrm: (d.eventoBaseTrm ?? null) as never,
          fuenteEventoBase: d.fuenteEventoBase,
          offsetDiasHabiles: d.offsetDiasHabiles,
          politicaActualizacionFecha: (d.politicaActualizacionFecha ?? null) as never,
          fechaBaseCongelada: d.fechaBaseCongelada ? new Date(d.fechaBaseCongelada) : null,
          fechaFijaTrm: d.fechaFijaTrm ? new Date(d.fechaFijaTrm) : null,
          calendarioHabil: 'colombia_trm', zonaHoraria: 'America/Bogota',
          reglaCentavos: d.reglaCentavos as never,
          documentoId: d.documentoId, analisisEconomicoId: d.analisisEconomicoId,
          textoReglaTrm: d.textoReglaTrm, textoFuente: d.textoFuente,
          paginaReferencia: d.paginaReferencia, confianzaExtraccion: d.confianzaExtraccion,
          advertencias: (d.advertencias ?? undefined) as never,
          fuenteExtraccion: 'gemini_pdf', origenTransicion: 'HUMANO', creadoPorId: d.creadoPorId,
        },
        select: { id: true, version: true },
      });
      return { reglaId: creada.id, version: creada.version };
    });
    await sincronizarEstadoRevisionPliego(d.procesoId);
    return res;
  });
}

export async function aprobarCandidataRegla(procesoId: number, candidataId: number, aprobadoPorId: number): Promise<void> {
  await conLockDePliego(procesoId, async () => {
    // §1 — invariante NO_DETERMINADO/ANALIZAR: la extracción de Gemini y la
    // creación de CANDIDATAS NUNCA pasan por este gate (eso permite analizar
    // sin confirmación previa). Pero la ACTIVACIÓN (CANDIDATA → ACTIVA) SÍ lo
    // exige: sin `Proceso.usaPonderacionTrm = 'SI'` confirmado por un humano,
    // ninguna candidata puede volverse productiva, sin importar cuán buena sea
    // la extracción.
    const proceso = await prisma.proceso.findUnique({ where: { id: procesoId }, select: { usaPonderacionTrm: true } });
    if (!proceso) throw new Error('Proceso no encontrado.');
    const gate = evaluarGateUsoPonderacionTrm(proceso.usaPonderacionTrm as UsoPonderacionTrm);
    if (!gate.ok) throw new Error(`No se puede activar la regla TRM: ${gate.detalle} Confirma primero Proceso.usaPonderacionTrm = SI (PATCH /analisis-economico { accion: "confirmarUsoTrm", valor: "SI" }).`);

    const estado = await leerEstado(procesoId);
    if (!estado.candidata || estado.candidata.id !== candidataId) throw new Error('La CANDIDATA indicada ya no está vigente.');
    const plan = planearAprobar(estado); // lanza si reglaCentavos no está resuelta
    await prisma.$transaction(async (tx) => {
      if (plan.supersederActivaId != null) {
        await tx.reglaTrmProceso.update({ where: { id: plan.supersederActivaId }, data: { estadoVersion: 'SUPERSEDED', supersedidaEn: new Date() } });
      }
      await tx.reglaTrmProceso.update({
        where: { id: plan.candidataId },
        data: { estadoVersion: 'ACTIVA', supersedeAId: plan.supersederActivaId, origenTransicion: 'HUMANO', aprobadoPorId, aprobadoEn: new Date() },
      });
      await tx.decisionExcepcionCandidata.updateMany({ where: { reglaTrmCandidataId: plan.candidataId, vigente: true }, data: { vigente: false } });
    });
    await sincronizarEstadoRevisionPliego(procesoId);
  });
}

export async function rechazarCandidataRegla(procesoId: number, candidataId: number, rechazadoPorId: number, motivoRechazo: string): Promise<void> {
  await conLockDePliego(procesoId, async () => {
    const estado = await leerEstado(procesoId);
    if (!estado.candidata || estado.candidata.id !== candidataId) throw new Error('La CANDIDATA indicada ya no está vigente.');
    await prisma.$transaction(async (tx) => {
      await tx.reglaTrmProceso.update({
        where: { id: candidataId },
        data: { estadoVersion: 'RECHAZADA', origenTransicion: 'HUMANO', rechazadoPorId, rechazadoEn: new Date(), motivoRechazo },
      });
      await tx.decisionExcepcionCandidata.updateMany({ where: { reglaTrmCandidataId: candidataId, vigente: true }, data: { vigente: false } });
    });
    await sincronizarEstadoRevisionPliego(procesoId);
  });
}
