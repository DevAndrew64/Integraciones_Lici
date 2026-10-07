/**
 * Ciclo de vida de `ConjuntoMetodosPonderacionProceso` — FASE A.1.
 * Mismo núcleo genérico que `ReglaTrmProceso`; añade las precondiciones de
 * dominio para aprobar un conjunto de métodos.
 *
 * NUNCA se activan métodos uno a uno mezclándolos con el conjunto activo.
 * El conjunto CANDIDATO solo pasa a ACTIVO cuando TODOS sus métodos fueron
 * revisados/aprobados y `resolverCriteriosPliego(conjuntoCandidato).ok`.
 */

import {
  validarInvarianteVersionado, planearCrearCandidataV, planearAprobarV, planearRechazarV,
  type EstadoVersionado, type VersionLite,
} from '../versionado/lifecycle-versionado';

export type { EstadoVersion as EstadoVersionConjunto } from '../versionado/lifecycle-versionado';

const MOTIVO_AUTO_RECHAZO =
  'Conjunto de métodos auto-reemplazado por un reanálisis/adenda más reciente (transición de SISTEMA, sin revisión humana).';

export interface ConjuntoLite extends VersionLite { procesoId: number; }
export type EstadoConjunto = EstadoVersionado<ConjuntoLite>;

export function validarInvarianteConjunto(filas: Pick<VersionLite, 'estadoVersion'>[]): void {
  validarInvarianteVersionado(filas);
}

export function planearCrearConjuntoCandidato(estado: EstadoConjunto) {
  return planearCrearCandidataV(estado, MOTIVO_AUTO_RECHAZO);
}

// ─── precondiciones de aprobación del CONJUNTO ───

export interface PreAprobacionConjunto {
  totalMetodos: number;
  metodosPendientes: number;      // estadoRevision != aprobado && != rechazado
  metodosRechazados: number;
  gateCriteriosOk: boolean;       // resolverCriteriosPliego(métodos aprobados del conjunto).ok
  /** true si ALGÚN método aprobado usa una fórmula que necesita presupuesto (p.ej. media_geometrica_con_presupuesto). */
  requierePresupuestoPorFormula: boolean;
  /** true si TODOS los métodos aprobados ya tienen su propio puntajeMaximo (por criterio). */
  todosMetodosTienenPM: boolean;
  presupuestoOficialAprobado: number | null;
  puntajeMaximoEconomicoAprobado: number | null;
}

export type ResultadoPreAprobacion =
  | { ok: true }
  | { ok: false; errores: string[] };

/**
 * El presupuesto NO es requisito universal (FASE A.1 §3): solo se exige
 * cuando alguna fórmula ACTIVA del conjunto lo necesita matemáticamente
 * (p. ej. media_geometrica_con_presupuesto). El PM se exige a nivel de
 * conjunto SOLO si no todos los métodos ya traen su propio PM explícito.
 */
export function validarPreAprobacionConjunto(p: PreAprobacionConjunto): ResultadoPreAprobacion {
  const errores: string[] = [];
  if (p.totalMetodos === 0) errores.push('El conjunto no tiene métodos.');
  if (p.metodosPendientes > 0) errores.push(`${p.metodosPendientes} método(s) sin revisar. Revísalos/apruébalos individualmente antes de activar el conjunto.`);
  if (p.metodosRechazados > 0) errores.push(`${p.metodosRechazados} método(s) rechazado(s) siguen en el conjunto. Corrige el pliego o descártalos.`);
  if (!p.gateCriteriosOk) errores.push('resolverCriteriosPliego(conjunto): huecos, solapamientos, fórmula no equivalente al motor o PM inválido en la cobertura 00–99.');
  if (p.requierePresupuestoPorFormula && (p.presupuestoOficialAprobado == null || !(p.presupuestoOficialAprobado > 0))) {
    errores.push('Al menos una fórmula del conjunto requiere presupuesto oficial (p.ej. media geométrica con presupuesto) y falta el valor VERIFICADO (dato canónico del proceso, revisión humana o fuente explícita — no basta el detectado por IA).');
  }
  if (!p.todosMetodosTienenPM && (p.puntajeMaximoEconomicoAprobado == null || !(p.puntajeMaximoEconomicoAprobado > 0))) {
    errores.push('Falta el puntaje máximo económico APROBADO por el humano (o que cada método tenga su propio PM explícito).');
  }
  return errores.length ? { ok: false, errores } : { ok: true };
}

export function planearAprobarConjunto(estado: EstadoConjunto, pre: PreAprobacionConjunto): { candidataId: number; supersederActivaId: number | null } {
  const r = validarPreAprobacionConjunto(pre);
  if (!r.ok) throw new Error('Conjunto no aprobable: ' + r.errores.join(' | '));
  return planearAprobarV(estado);
}

export function planearRechazarConjunto(estado: EstadoConjunto) {
  return planearRechazarV(estado);
}
