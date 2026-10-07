/**
 * Modo de runtime de la sincronización de procesos.
 *
 * Una única fuente de verdad para decidir CÓMO se adquieren/sincronizan
 * procesos en runtime. La leen `fachadaSync` y (para chequeos previos)
 * los disparadores.
 *
 * REPO SHARE-READY (B5): la ÚNICA implementación operativa de adquisición es
 * la Data API. El pipeline legacy (`procesos-sync`, scraping directo al
 * proveedor, resolver-links legacy, `secop/*`) permanece en el árbol como
 * deuda a retirar (`LEGACY_SOURCE_PRESENT_BUT_RUNTIME_UNREACHABLE`), pero:
 *   - ningún entrypoint de runtime lo importa (test estático `antibypass`),
 *   - NINGÚN valor de env puede activarlo,
 *   - no es fallback ante error / timeout / 4xx de la Data API.
 *
 *   SYNC_RUNTIME_MODE ausente / vacío  → 'disabled'  (default seguro)
 *   SYNC_RUNTIME_MODE = 'disabled'     → ninguna adquisición; ninguna escritura por sync
 *   SYNC_RUNTIME_MODE = 'data-api'     → adquisición vía la Data API (B.4.5+)
 *   SYNC_RUNTIME_MODE = 'legacy'       → NO seleccionable: se interpreta como
 *                                        'disabled' y se registra una advertencia.
 *
 * B.4.5 — el interruptor de cutover es el feature flag `DATA_API_RUNTIME_ENABLED`
 * (D5), cuya ÚNICA lectura vive en `../runtimeFlag.ts`. Cuando ese flag está
 * ON, el modo efectivo es SIEMPRE 'data-api', con independencia de
 * `SYNC_RUNTIME_MODE`.
 *
 * Regla dura: NUNCA hay fallback automático a legacy. Un `SYNC_RUNTIME_MODE`
 * desconocido (con el flag OFF) sigue lanzando de forma explícita.
 */
import { dataApiRuntimeEnabled } from '../runtimeFlag';

export type SyncRuntimeMode = 'data-api' | 'disabled';

/** Valores que `modoSyncRuntime` puede devolver. `legacy` NO está aquí: no es un modo operativo. */
export const SYNC_RUNTIME_MODES: readonly SyncRuntimeMode[] = ['data-api', 'disabled'];

/** Valores que el env `SYNC_RUNTIME_MODE` puede traer sin lanzar (incluye el histórico `legacy`, que se coacciona a `disabled`). */
export const SYNC_RUNTIME_MODE_ENV_ACEPTADOS: readonly string[] = ['data-api', 'disabled', 'legacy'];

export const SYNC_RUNTIME_MODE_DEFECTO: SyncRuntimeMode = 'disabled';

/** Se lanza si `SYNC_RUNTIME_MODE` trae un valor que no es aceptado. Nunca se silencia. */
export class SyncRuntimeModeInvalidoError extends Error {
  readonly code = 'SYNC_RUNTIME_MODE_INVALIDO';
  constructor(valor: string) {
    super(
      `SYNC_RUNTIME_MODE='${valor}' no es un valor válido. Aceptados: ` +
        `${SYNC_RUNTIME_MODE_ENV_ACEPTADOS.join(', ')} (o ausente = '${SYNC_RUNTIME_MODE_DEFECTO}'). ` +
        `'legacy' se acepta pero se interpreta como 'disabled'. No hay fallback automático.`,
    );
    this.name = 'SyncRuntimeModeInvalidoError';
  }
}

/**
 * Modo de runtime efectivo. Inyectable para tests (`env`).
 * - flag `DATA_API_RUNTIME_ENABLED` ON → 'data-api' (gana siempre).
 * - ausente/vacío → 'disabled'.
 * - 'data-api' | 'disabled' → ese modo.
 * - 'legacy' → 'disabled' + `console.warn` (legacy no es seleccionable en este repo).
 * - cualquier otro → lanza `SyncRuntimeModeInvalidoError` (no fallback).
 */
export function modoSyncRuntime(env: NodeJS.ProcessEnv = process.env): SyncRuntimeMode {
  if (dataApiRuntimeEnabled(env)) return 'data-api';

  const crudo = (env.SYNC_RUNTIME_MODE ?? '').trim().toLowerCase();
  if (crudo === '') return SYNC_RUNTIME_MODE_DEFECTO;
  if (crudo === 'legacy') {
    console.warn(
      "[sync] SYNC_RUNTIME_MODE='legacy' ignorado — el pipeline legacy no es " +
        "seleccionable en este repositorio. Se usa 'disabled' (ninguna adquisición).",
    );
    return 'disabled';
  }
  if ((SYNC_RUNTIME_MODES as readonly string[]).includes(crudo)) {
    return crudo as SyncRuntimeMode;
  }
  throw new SyncRuntimeModeInvalidoError(crudo);
}

/**
 * `true` solo cuando el runtime debe ejecutar el pipeline legacy real.
 * En este repositorio SIEMPRE es `false` — legacy no es un modo operativo.
 * Se conserva la firma para los call sites históricos.
 */
export function syncRuntimeEsLegacy(_env?: NodeJS.ProcessEnv): boolean {
  return false;
}
