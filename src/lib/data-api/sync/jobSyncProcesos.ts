/**
 * JOB de sincronización automática de procesos vía Data API.
 *
 * Envuelve `fachadaSync.sincronizarProcesos` con:
 *   1. Guardia de solapamiento IN-PROCESS: si una corrida sigue viva en esta
 *      misma instancia, la siguiente NO arranca (evita abrir conexiones y
 *      pedir el advisory lock en vano). Complementa —no reemplaza— el
 *      `pg_advisory_lock` de `ejecutarSyncRuntime`, que es la exclusión mutua
 *      REAL entre múltiples instancias / procesos.
 *   2. Logs operativos con prefijo `[data-api-sync]`, SIN secretos: nunca
 *      imprime `DATA_API_KEY`, `DATABASE_URL`, `DATA_API_RUNTIME_DATABASE_URL`,
 *      headers ni payloads.
 *   3. Captura de errores: un fallo se loguea de forma neutral y NO se
 *      relanza — el scheduler no debe caerse ni entrar en bucle. Los errores
 *      permanentes de la Data API (4xx≠429, cursor expirado) abortan la
 *      corrida en el runner; aquí solo se registran.
 *
 * Los guardrails de identidad de destino (`DATA_API_RUNTIME_*`) y el modo
 * efectivo (`SYNC_RUNTIME_MODE` / `DATA_API_RUNTIME_ENABLED`) se evalúan
 * aguas abajo, en `fachadaSync` y `ejecutarSyncRuntime`. Este módulo no los
 * duplica ni los relaja.
 */
import { fachadaSync } from './fachadaSync';

export type ResultadoJobSync =
  | { estado: 'ejecutado'; profundo: boolean; durationMs: number; paginas: number; creados: number; actualizados: number }
  | { estado: 'desactivado' }
  | { estado: 'omitido-en-proceso' }
  | { estado: 'omitido-lock' }
  | { estado: 'error'; mensaje: string };

/** Guardia in-process. Módulo singleton ⇒ una sola bandera por proceso Node. */
let ejecucionActiva = false;

/** `true` si hay una corrida del job viva en esta instancia (para tests / diagnóstico). */
export function jobSyncEnEjecucion(): boolean {
  return ejecucionActiva;
}

export interface OpcionesJobSync {
  /** `true` = sync profundo diario (full resync, ventana amplia). */
  profundo?: boolean;
}

export async function ejecutarJobSyncProcesos(opts: OpcionesJobSync = {}): Promise<ResultadoJobSync> {
  const profundo = opts.profundo === true;
  const etiqueta = profundo ? 'profundo' : 'principal';

  if (ejecucionActiva) {
    console.log(`[data-api-sync] omitido: otra ejecución activa (${etiqueta})`);
    return { estado: 'omitido-en-proceso' };
  }

  ejecucionActiva = true;
  const t0 = Date.now();
  console.log(`[data-api-sync] inicio ${etiqueta}`);

  try {
    const r = profundo
      ? await fachadaSync.sincronizarProcesos(
          { cutoffCreacion: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
          { fullResync: true },
        )
      : await fachadaSync.sincronizarProcesos();

    if (r.estado === 'deshabilitado') {
      console.log('[data-api-sync] desactivado por configuración');
      return { estado: 'desactivado' };
    }

    const m = r.datos as {
      lockNoAdquirido?: boolean;
      duracionMs?: number;
      paginasConsultadas?: number;
      creados?: number;
      actualizados?: number;
    };

    if (m.lockNoAdquirido === true) {
      console.log('[data-api-sync] omitido: otra ejecución activa (advisory lock)');
      return { estado: 'omitido-lock' };
    }

    const durationMs = Date.now() - t0;
    const paginas = m.paginasConsultadas ?? 0;
    const creados = m.creados ?? 0;
    const actualizados = m.actualizados ?? 0;
    console.log(
      `[data-api-sync] finalizado durationMs=${durationMs} paginas=${paginas} creados=${creados} actualizados=${actualizados}`,
    );
    return { estado: 'ejecutado', profundo, durationMs, paginas, creados, actualizados };
  } catch (err) {
    // Mensaje neutral: los errores de la Data API ya vienen saneados; los de
    // guardrail no incluyen URLs ni credenciales. Aun así recortamos.
    const mensaje = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 300);
    console.error(`[data-api-sync] error ${etiqueta}: ${mensaje}`);
    return { estado: 'error', mensaje };
  } finally {
    ejecucionActiva = false;
  }
}
