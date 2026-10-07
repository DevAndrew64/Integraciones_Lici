/**
 * P0 — Compatibilidad de bandejas entre estados LEGADOS (texto libre en
 * español, heurística sobre `asignaciones[-1]`) y estados CANÓNICOS
 * (`estados-canonicos.ts`, escritos por `transiciones-estado.ts` desde el
 * commit 001a496).
 *
 * Única fuente de verdad de "qué bandeja operativa le corresponde a un
 * estado canónico" — reutilizada por las 5 ramas SQL de
 * `GET /api/solicitudes` (route.ts). Cuando `estadoSolicitud` es uno de
 * estos valores canónicos cubiertos, decide la bandeja ÉL SOLO — nunca se
 * consulta `asignaciones[-1]` para esos registros. Cuando NO lo es (texto
 * legado histórico, o un canónico todavía no cubierto), se conserva
 * exactamente la heurística legada existente, sin ningún cambio de
 * comportamiento para esos registros.
 *
 * `REVISION_FINALIZADA` (canónico) / `LISTO_PARA_VALIDAR` (fila legada) —
 * regla funcional aclarada: YA NO existe aprobación posterior de
 * Coordinador/Director Comercial entre observación y ejecución. El flujo
 * vigente es Por validar → En observación (si corresponde) → En ejecución
 * → En evaluación → Cerrado, directo. Por eso `REVISION_FINALIZADA` mapea
 * DIRECTO a `EN_EJECUCION` (no tiene bandeja propia), y el equivalente
 * legado a nivel de fila `LISTO_PARA_VALIDAR` se trata en route.ts como
 * otra forma histórica de "En ejecución" — únicamente para clasificación
 * de lectura, sin migrar los registros históricos con UPDATE.
 * Igual para `SELECCION_PROCESO`/`REVISION_COMERCIAL` (preselección, no
 * tienen bandeja operativa) y `RECHAZADO`/`CERRADO_*`/`CANCELADO` a nivel
 * de fila (esos son subcategorías dentro de "Cerrados", ya resueltas por
 * `filtroEstadoCerrado`, no por este mapa).
 */

export type BandejaOperativa =
  | 'POR_VALIDAR' | 'EN_OBSERVACION' | 'EN_EJECUCION' | 'EN_EVALUACION' | 'CERRADOS';

export const CANONICO_A_BANDEJA: Readonly<Record<string, BandejaOperativa>> = {
  ASIGNADO_REVISION: 'POR_VALIDAR',
  EN_REVISION: 'POR_VALIDAR',
  EN_OBSERVACION: 'EN_OBSERVACION',
  REVISION_FINALIZADA: 'EN_EJECUCION',
  APROBADO_ELABORACION: 'EN_EJECUCION',
  EN_ELABORACION: 'EN_EJECUCION',
  PRESENTADO: 'EN_EVALUACION',
  CERRADA: 'CERRADOS',
  CANCELADA: 'CERRADOS',
};

/** Todos los estados canónicos cubiertos por este mapa (para el "sub-caso
 * B" de cada rama SQL: solo se aplica la heurística legada cuando
 * `estadoSolicitud` NO es ninguno de estos). */
export const ESTADOS_CANONICOS_CUBIERTOS: readonly string[] = Object.keys(CANONICO_A_BANDEJA);

export function estadosCanonicosDeBandeja(bandeja: BandejaOperativa): string[] {
  return ESTADOS_CANONICOS_CUBIERTOS.filter((k) => CANONICO_A_BANDEJA[k] === bandeja);
}

/** `IN ('A','B')` — los valores son constantes fijas del mapa de arriba,
 * nunca input de usuario; no requiere `esc()`. */
export function sqlListaComillas(valores: readonly string[]): string {
  return valores.map((v) => `'${v}'`).join(',');
}

/** Red de seguridad (P0, sección 7): ningún estado terminal — sin importar
 * su forma exacta (legado 'Cerrada'/'Cerrado'/'Cancelada'/'Cancelado', o
 * canónico 'CERRADA'/'CANCELADA') — puede aparecer en una bandeja activa,
 * sin importar qué diga `asignaciones[-1]`. */
export const SQL_NO_TERMINAL =
  `"estadoSolicitud" NOT ILIKE '%cerrad%' AND "estadoSolicitud" NOT ILIKE '%cancelad%'`;
