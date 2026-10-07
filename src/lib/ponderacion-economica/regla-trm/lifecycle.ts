/**
 * Ciclo de vida de `ReglaTrmProceso` — FASE A.1.
 * Delega el núcleo genérico en `versionado/lifecycle-versionado.ts` y añade
 * la lógica específica de la regla TRM (reglaCentavos, gate G3).
 *
 * Gemini nunca aprueba una regla. Solo el humano, o una transición de SISTEMA
 * explícitamente marcada (sin actor).
 */

import {
  validarInvarianteVersionado, planearCrearCandidataV, planearAprobarV, planearRechazarV,
  type EstadoVersionado,
} from '../versionado/lifecycle-versionado';

export type EstadoVersionRegla = 'CANDIDATA' | 'ACTIVA' | 'SUPERSEDED' | 'RECHAZADA';
export type OrigenTransicion = 'HUMANO' | 'SISTEMA';
export type ReglaCentavos = 'NO_DEFINIDA' | 'REDONDEO' | 'TRUNCADO' | 'OTRA';

export interface ReglaLite {
  id: number;
  procesoId: number;
  version: number;
  estadoVersion: EstadoVersionRegla;
  reglaCentavos: ReglaCentavos;
}

const MOTIVO_AUTO_RECHAZO =
  'Auto-reemplazada por una extracción/edición más reciente (transición de SISTEMA, sin revisión humana).';

// ─────────────────────────── invariante ───────────────────────────

export function validarInvariante(reglasDelProceso: Pick<ReglaLite, 'estadoVersion'>[]): void {
  validarInvarianteVersionado(reglasDelProceso);
}

// ─────────────────────────── planear transiciones (puro) ───────────────────────────

export interface EstadoRegla {
  activa?: ReglaLite | null;
  candidata?: ReglaLite | null;
  versionMaxima: number;
}

export interface PlanCrearCandidata {
  autoRechazar?: { id: number; motivoRechazo: string; origenTransicion: 'SISTEMA'; rechazadoPorId: null };
  nuevaVersion: number;
  estadoRevisionPliego: 'PENDIENTE_REVISION';
}

export function planearCrearCandidata(estado: EstadoRegla): PlanCrearCandidata {
  return planearCrearCandidataV(estado as EstadoVersionado, MOTIVO_AUTO_RECHAZO);
}

export interface PlanAprobar {
  candidataId: number;
  supersederActivaId: number | null;
  estadoRevisionPliegoSiGatePasa: 'PLIEGO_VERIFICADO';
  estadoRevisionPliegoSiGateFalla: 'REQUIERE_REVISION_PLIEGO';
}

export function planearAprobar(estado: EstadoRegla): PlanAprobar {
  const base = planearAprobarV(estado as EstadoVersionado);
  const rc = estado.candidata!.reglaCentavos;
  if (rc === 'NO_DEFINIDA' || rc === 'OTRA') {
    throw new Error(`No se puede aprobar una regla con reglaCentavos = ${rc}. Debe ser REDONDEO o TRUNCADO.`);
  }
  return {
    ...base,
    estadoRevisionPliegoSiGatePasa: 'PLIEGO_VERIFICADO',
    estadoRevisionPliegoSiGateFalla: 'REQUIERE_REVISION_PLIEGO',
  };
}

export interface PlanRechazar {
  candidataId: number;
  origenTransicion: 'HUMANO';
  estadoRevisionPliegoResultante: 'PLIEGO_VERIFICADO' | 'REQUIERE_REVISION_PLIEGO';
}

export function planearRechazar(estado: EstadoRegla, gateConActivaPasa: boolean): PlanRechazar {
  const base = planearRechazarV(estado as EstadoVersionado);
  return {
    candidataId: base.candidataId,
    origenTransicion: 'HUMANO',
    estadoRevisionPliegoResultante: base.hayActivaPrevia && gateConActivaPasa ? 'PLIEGO_VERIFICADO' : 'REQUIERE_REVISION_PLIEGO',
  };
}

// ─────────────────────────── reglaCentavos → modo ───────────────────────────

export function reglaCentavosAModo(rc: ReglaCentavos): 'redondeo' | 'truncado' {
  if (rc === 'REDONDEO') return 'redondeo';
  if (rc === 'TRUNCADO') return 'truncado';
  throw new Error(`reglaCentavos no resuelta para cálculo: ${rc}. Requiere revisión del pliego.`);
}

// ─────────────────────────── gate G3 (parte regla) ───────────────────────────

export interface ContextoRecomendacion {
  activa?: ReglaLite | null;
  candidataPendiente?: ReglaLite | null;
  excepcionVigente?: { id: number; actorId: number; motivo: string } | null;
}

export type ResultadoGateRegla =
  | { ok: true; reglaId: number }
  | { ok: false; motivo: 'SIN_REGLA_ACTIVA' | 'REGLA_CENTAVOS_NO_RESUELTA' | 'CANDIDATA_PENDIENTE_SIN_EXCEPCION'; detalle: string };

export function evaluarGateRegla(ctx: ContextoRecomendacion): ResultadoGateRegla {
  if (!ctx.activa || ctx.activa.estadoVersion !== 'ACTIVA') {
    return { ok: false, motivo: 'SIN_REGLA_ACTIVA', detalle: 'No hay una ReglaTrmProceso ACTIVA aprobada para este proceso.' };
  }
  if (ctx.activa.reglaCentavos !== 'REDONDEO' && ctx.activa.reglaCentavos !== 'TRUNCADO') {
    return { ok: false, motivo: 'REGLA_CENTAVOS_NO_RESUELTA', detalle: `reglaCentavos = ${ctx.activa.reglaCentavos}.` };
  }
  if (ctx.candidataPendiente && ctx.candidataPendiente.estadoVersion === 'CANDIDATA') {
    if (!ctx.excepcionVigente || !ctx.excepcionVigente.actorId || !ctx.excepcionVigente.motivo?.trim()) {
      return {
        ok: false,
        motivo: 'CANDIDATA_PENDIENTE_SIN_EXCEPCION',
        detalle: 'Hay una regla CANDIDATA pendiente de revisión. Requiere una DecisionExcepcionCandidata humana (actor + motivo) para recomendar.',
      };
    }
  }
  return { ok: true, reglaId: ctx.activa.id };
}
