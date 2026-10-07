/**
 * Clasificación de presentación de procesos — API pública de indicadores.
 *
 * Unidad de conteo: modelo `Proceso` (único por sourceKey). `ProcesoNuevo` es
 * staging de detección (puede duplicar procesos vía procesoId/sourceKey) y se
 * EXCLUYE de los indicadores para evitar doble conteo.
 *
 * Evidencia de presentación: la Solicitud vinculada al proceso. El estado real
 * de elaboración vive en `Solicitud.asignaciones[-1].estadoRevision` (mismo
 * criterio que usa colba-stats.ts en producción).
 */

export type CategoriaPresentacion =
  | 'PRESENTADO'
  | 'NO_PRESENTADO'
  | 'PENDIENTE'
  | 'NO_APLICA'
  | 'SIN_INFORMACION';

export const CATEGORIAS: readonly CategoriaPresentacion[] = [
  'PRESENTADO', 'NO_PRESENTADO', 'PENDIENTE', 'NO_APLICA', 'SIN_INFORMACION',
];

/** estadoRevision (última asignación) que demuestran presentación real. */
export const ESTADOS_REVISION_PRESENTADO = [
  'PRESENTADO',
  'CERRADO_ADJUDICADO',
  'CERRADO_NO_ADJUDICADO',
  'CERRADO_NO_CUMPLIMIENTO',
] as const;

/** resultadoFinal que implican que la oferta fue presentada. */
export const RESULTADOS_PRESENTADO = ['Adjudicado', 'No adjudicado'] as const;

/** resultadoFinal que implican decisión definitiva de NO presentarse. */
export const RESULTADOS_NO_PRESENTADO = ['No favorable'] as const;

export interface ProcesoClasificable {
  noViable: boolean;
  oculto: boolean | null;
  /** fechaVencimiento del proceso (cierre de ofertas). */
  fechaVencimiento: Date | null;
  /** Solicitud más reciente vinculada (procesoId o procesoSourceKey); null si nunca se gestionó. */
  solicitud: {
    estadoSolicitud: string | null;
    /** asignaciones[-1].estadoRevision */
    estadoRevisionUltimo: string | null;
    resultadoFinal: string | null;
  } | null;
}

/**
 * Clasifica un proceso. Reglas (en orden de precedencia):
 *
 *  NO_APLICA        → noViable, oculto, o solicitud cancelada.
 *  PRESENTADO       → evidencia real: estadoRevision post-presentación,
 *                     estadoSolicitud que contiene "presentado", o
 *                     resultadoFinal Adjudicado / No adjudicado.
 *  NO_PRESENTADO    → decisión definitiva sin presentación: estadoRevision
 *                     RECHAZADO, resultadoFinal "No favorable", o solicitud
 *                     cerrada sin evidencia de presentación.
 *  PENDIENTE        → solicitud aún en gestión, o proceso sin gestionar cuyo
 *                     cierre no ha vencido.
 *  SIN_INFORMACION  → resto (p.ej. proceso vencido que nunca se gestionó, o
 *                     sin fecha de cierre conocida).
 *
 * Nota: NO se clasifica como NO_PRESENTADO todo lo que no sea PRESENTADO.
 */
export function clasificarPresentacion(p: ProcesoClasificable, ahora: Date = new Date()): CategoriaPresentacion {
  const s = p.solicitud;
  const estadoSol = (s?.estadoSolicitud ?? '').trim().toLowerCase();

  // 1. Excluidos del universo evaluable
  if (p.noViable || p.oculto === true) return 'NO_APLICA';
  if (estadoSol.startsWith('cancelad')) return 'NO_APLICA';

  if (s) {
    const rev = (s.estadoRevisionUltimo ?? '').trim().toUpperCase();
    const resultado = (s.resultadoFinal ?? '').trim();

    // 2. Evidencia real de presentación
    if (
      (ESTADOS_REVISION_PRESENTADO as readonly string[]).includes(rev) ||
      estadoSol.includes('presentado') ||
      (RESULTADOS_PRESENTADO as readonly string[]).includes(resultado)
    ) return 'PRESENTADO';

    // 3. Decisión definitiva de no presentar
    if (
      rev === 'RECHAZADO' ||
      (RESULTADOS_NO_PRESENTADO as readonly string[]).includes(resultado) ||
      estadoSol === 'cerrada' || estadoSol === 'cerrado' || estadoSol === 'cerrada por observación'
    ) return 'NO_PRESENTADO';

    // 4. Sigue en gestión
    return 'PENDIENTE';
  }

  // Sin solicitud: pendiente solo si el proceso aún no vence
  if (p.fechaVencimiento && p.fechaVencimiento.getTime() >= ahora.getTime()) return 'PENDIENTE';

  // Vencido (o sin fecha) y nunca gestionado → no hay datos de decisión
  return 'SIN_INFORMACION';
}

// ─── Fórmulas de indicadores ─────────────────────────────────────────────────

export interface TotalesPresentacion {
  totalProcesos: number;
  presentados: number;
  noPresentados: number;
  pendientes: number;
  noAplica: number;
  sinInformacion: number;
  sinFecha: number;
}

/**
 * porcentajePresentacion = presentados / (presentados + noPresentados) × 100.
 * null cuando el denominador es 0 (nunca división por cero ni 0 engañoso).
 */
export function porcentajePresentacion(presentados: number, noPresentados: number): number | null {
  const den = presentados + noPresentados;
  if (den === 0) return null;
  return Math.round((presentados / den) * 10000) / 100;
}

/**
 * participacionPresentadosSobreTotal = presentados / totalProcesos × 100.
 * Indicador DISTINTO al porcentaje de presentación (denominador = universo total).
 */
export function participacionPresentadosSobreTotal(presentados: number, totalProcesos: number): number | null {
  if (totalProcesos === 0) return null;
  return Math.round((presentados / totalProcesos) * 10000) / 100;
}

/** Construye el bloque de totales a partir del conteo por categoría. */
export function construirTotales(
  porCategoria: Partial<Record<CategoriaPresentacion, number>>,
  sinFecha = 0,
): TotalesPresentacion {
  const presentados = porCategoria.PRESENTADO ?? 0;
  const noPresentados = porCategoria.NO_PRESENTADO ?? 0;
  const pendientes = porCategoria.PENDIENTE ?? 0;
  const noAplica = porCategoria.NO_APLICA ?? 0;
  const sinInformacion = porCategoria.SIN_INFORMACION ?? 0;
  return {
    totalProcesos: presentados + noPresentados + pendientes + noAplica + sinInformacion,
    presentados, noPresentados, pendientes, noAplica, sinInformacion,
    sinFecha,
  };
}
