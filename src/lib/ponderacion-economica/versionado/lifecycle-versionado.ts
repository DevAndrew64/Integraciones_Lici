/**
 * Núcleo PURO del ciclo de vida versionado (append + supersede) — FASE A.1.
 * Compartido por `ReglaTrmProceso` y `ConjuntoMetodosPonderacionProceso`.
 *
 *   CANDIDATA --aprobar--> ACTIVA --(nueva aprobada)--> SUPERSEDED
 *   CANDIDATA --rechazar--> RECHAZADA
 *   CANDIDATA --(llega otra extracción)--> RECHAZADA (transición de SISTEMA, sin actor)
 *
 * Invariantes (BD los garantiza con índices únicos parciales):
 *   <= 1 ACTIVA por procesoId   ·   <= 1 CANDIDATA por procesoId
 */

export type EstadoVersion = 'CANDIDATA' | 'ACTIVA' | 'SUPERSEDED' | 'RECHAZADA';

export interface VersionLite {
  id: number;
  version: number;
  estadoVersion: EstadoVersion;
}

export interface EstadoVersionado<T extends VersionLite = VersionLite> {
  activa?: T | null;
  candidata?: T | null;
  /** máx(version) de TODAS las filas del proceso (incluye RECHAZADA/SUPERSEDED). */
  versionMaxima: number;
}

export function validarInvarianteVersionado(filas: Pick<VersionLite, 'estadoVersion'>[]): void {
  const a = filas.filter(f => f.estadoVersion === 'ACTIVA').length;
  const c = filas.filter(f => f.estadoVersion === 'CANDIDATA').length;
  if (a > 1) throw new Error(`Invariante violada: ${a} filas ACTIVA para el mismo proceso (máx 1).`);
  if (c > 1) throw new Error(`Invariante violada: ${c} filas CANDIDATA para el mismo proceso (máx 1).`);
}

export interface PlanCrearCandidataV {
  autoRechazar?: { id: number; motivoRechazo: string; origenTransicion: 'SISTEMA'; rechazadoPorId: null };
  nuevaVersion: number;
  estadoRevisionPliego: 'PENDIENTE_REVISION';
}

/** T1 — nueva extracción/corrección/adenda. NO toca la ACTIVA. */
export function planearCrearCandidataV(estado: EstadoVersionado, motivoAutoRechazo: string): PlanCrearCandidataV {
  const plan: PlanCrearCandidataV = { nuevaVersion: estado.versionMaxima + 1, estadoRevisionPliego: 'PENDIENTE_REVISION' };
  if (estado.candidata) {
    plan.autoRechazar = { id: estado.candidata.id, motivoRechazo: motivoAutoRechazo, origenTransicion: 'SISTEMA', rechazadoPorId: null };
  }
  return plan;
}

export interface PlanAprobarV {
  candidataId: number;
  supersederActivaId: number | null;
}

/** T3 — el humano aprueba la CANDIDATA. Precondiciones de dominio las valida el caller. */
export function planearAprobarV(estado: EstadoVersionado): PlanAprobarV {
  if (!estado.candidata) throw new Error('No hay CANDIDATA que aprobar.');
  if (estado.candidata.estadoVersion !== 'CANDIDATA') throw new Error('La fila indicada no está en estado CANDIDATA.');
  return { candidataId: estado.candidata.id, supersederActivaId: estado.activa?.id ?? null };
}

export interface PlanRechazarV {
  candidataId: number;
  origenTransicion: 'HUMANO';
  hayActivaPrevia: boolean;
}

/** T2 — el humano rechaza la CANDIDATA. La ACTIVA anterior NO se toca. */
export function planearRechazarV(estado: EstadoVersionado): PlanRechazarV {
  if (!estado.candidata) throw new Error('No hay CANDIDATA que rechazar.');
  return { candidataId: estado.candidata.id, origenTransicion: 'HUMANO', hayActivaPrevia: !!estado.activa };
}
