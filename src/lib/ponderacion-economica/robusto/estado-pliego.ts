/**
 * Estado global `Proceso.estadoRevisionPliego` — función PURA (sin BD).
 * FASE A.1. Fuente de verdad única del estado del pliego.
 */

export type EstadoRevisionPliego =
  | 'SIN_ANALIZAR' | 'PENDIENTE_REVISION' | 'REQUIERE_REVISION_PLIEGO' | 'PLIEGO_VERIFICADO' | 'NO_APLICA_TRM';

// ─────────────────────────── §1 — gate USA_PONDERACION_TRM ───────────────────────────

export type UsoPonderacionTrm = 'SI' | 'NO' | 'NO_DETERMINADO';

export interface InsumosEstadoPliego {
  /** Confirmación humana (§1) — NUNCA la escribe Gemini. Sin 'SI' explícito
   *  ninguna configuración puede considerarse PRODUCTIVAMENTE verificada,
   *  sin importar cuán completa/válida esté internamente (§3 de la
   *  microauditoría). */
  usaPonderacionTrm: UsoPonderacionTrm;
  reglaActiva: { reglaCentavos: string } | null;
  reglaCandidataPendiente: boolean;
  conjuntoActivo: {
    criteriosOk: boolean;
    presupuestoOficialAprobado: number | null;
    puntajeMaximoEconomicoAprobado: number | null;
  } | null;
  conjuntoCandidatoPendiente: boolean;
  huboAlgunAnalisis: boolean;
}

/**
 * usaPonderacionTrm='NO' ⟹ SIEMPRE 'NO_APLICA_TRM'. Sin excepción y sin
 * importar ningún otro insumo (huboAlgunAnalisis, candidatas pendientes,
 * regla/conjunto ACTIVA históricos): es una decisión HUMANA explícita y
 * auditada (§4 de la 2ª microauditoría) de que este proceso no pertenece al
 * workflow productivo de ponderación TRM. Se comprueba ANTES que cualquier
 * otra condición — en particular antes de `huboAlgunAnalisis` — para que no
 * exista ninguna combinación de insumos que produzca otra cosa. Nada de lo
 * histórico se borra ni se toca; solo cambia lo que el estado GLOBAL reporta.
 *
 * SIN_ANALIZAR ⟺ usaPonderacionTrm ≠ 'NO' (o sea 'SI' o 'NO_DETERMINADO') +
 * NO hubo ningún análisis ni configuración que indique trabajo iniciado. En
 * la práctica, dado que 'SI' solo lo confirma un humano después de revisar
 * un análisis ya hecho, esto es casi siempre 'NO_DETERMINADO' + sin analizar.
 *
 * PLIEGO_VERIFICADO ⟺ usaPonderacionTrm='SI' (confirmación humana) + regla
 * ACTIVA válida (centavos resueltos) + conjunto ACTIVO válido (criterios OK +
 * presupuesto + PM aprobados) + sin CANDIDATAS pendientes.
 *
 * NO_DETERMINADO NUNCA resulta en PLIEGO_VERIFICADO ni en NO_APLICA_TRM —
 * ninguno de los dos representa la realidad de "todavía no se decidió":
 * usa SIN_ANALIZAR si no hubo ningún análisis, PENDIENTE_REVISION si hay
 * candidatas por revisar, o REQUIERE_REVISION_PLIEGO si no hay nada
 * pendiente (p. ej. el humano acaba de pasar de SI a NO_DETERMINADO).
 */
export function computarEstadoRevisionPliego(x: InsumosEstadoPliego): EstadoRevisionPliego {
  if (x.usaPonderacionTrm === 'NO') return 'NO_APLICA_TRM';

  if (!x.huboAlgunAnalisis) return 'SIN_ANALIZAR';

  const hayPendientes = x.reglaCandidataPendiente || x.conjuntoCandidatoPendiente;

  if (x.usaPonderacionTrm === 'NO_DETERMINADO') {
    return hayPendientes ? 'PENDIENTE_REVISION' : 'REQUIERE_REVISION_PLIEGO';
  }

  const reglaCentavosOk = x.reglaActiva?.reglaCentavos === 'REDONDEO' || x.reglaActiva?.reglaCentavos === 'TRUNCADO';
  const reglaOk = !!x.reglaActiva && reglaCentavosOk;
  const conjOk = !!x.conjuntoActivo
    && x.conjuntoActivo.criteriosOk
    && (x.conjuntoActivo.presupuestoOficialAprobado ?? 0) > 0
    && (x.conjuntoActivo.puntajeMaximoEconomicoAprobado ?? 0) > 0;

  if (reglaOk && conjOk && !hayPendientes) return 'PLIEGO_VERIFICADO';
  if (hayPendientes && (reglaOk || conjOk || (!x.reglaActiva && !x.conjuntoActivo))) return 'PENDIENTE_REVISION';
  return 'REQUIERE_REVISION_PLIEGO';
}

export type ResultadoGateUsoPonderacionTrm =
  | { ok: true }
  | { ok: false; motivo: 'NO_ES_PONDERACION_TRM' | 'PENDIENTE_CONFIRMACION_HUMANA'; detalle: string };

/**
 * Este flujo NO es un analizador general de pliegos: solo se genera
 * recomendación cuando un HUMANO confirmó `Proceso.usaPonderacionTrm = 'SI'`
 * (nunca Gemini). `NO_DETERMINADO` bloquea igual que `NO` — la ausencia de
 * confirmación humana no habilita nada.
 */
export function evaluarGateUsoPonderacionTrm(usaPonderacionTrm: UsoPonderacionTrm): ResultadoGateUsoPonderacionTrm {
  if (usaPonderacionTrm === 'NO') {
    return { ok: false, motivo: 'NO_ES_PONDERACION_TRM', detalle: 'Un humano confirmó que la TRM NO gobierna la evaluación económica de este proceso.' };
  }
  if (usaPonderacionTrm === 'NO_DETERMINADO') {
    return { ok: false, motivo: 'PENDIENTE_CONFIRMACION_HUMANA', detalle: 'Falta confirmación humana de si la TRM gobierna la evaluación económica (Proceso.usaPonderacionTrm).' };
  }
  return { ok: true };
}
