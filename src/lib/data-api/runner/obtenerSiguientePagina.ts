/**
 * `obtenerSiguientePagina` del runner de sincronización.
 *
 * Traduce `DataApiClient.sincronizarProcesos({ cursor })` a la firma
 * `(cursor) => Promise<PaginaSync | null>` que espera el bucle del runner.
 *
 * Cadena: runner → DataApiClient (HTTP) → servicio de datos de procesos →
 * contrato canónico → (aquí) → aplicarPaginaCanonica → PostgreSQL destino.
 *
 * NUNCA llama a la fuente pública directamente — solo al cliente HTTP.
 * Un `ErrorCanonico` del cliente se propaga como excepción (el runner
 * aborta la corrida sin aplicar nada más); el detalle interno de la fuente
 * nunca se expone porque el cliente ya lo neutralizó.
 */
import type { DataApiClient } from '../cliente';
import type { PaginaSync, ErrorCanonico } from '../tipos';

export class RunnerDataApiError extends Error {
  constructor(public readonly errorCanonico: ErrorCanonico) {
    super(`Data API respondió ${errorCanonico.codigo}: ${errorCanonico.mensaje}`);
    this.name = 'RunnerDataApiError';
  }
}

export interface OpcionesObtenerPagina {
  /** Tamaño de página pedido a la Data API (el servidor puede acotarlo). */
  limite?: number;
}

export function crearObtenerSiguientePagina(
  cliente: DataApiClient,
  opciones: OpcionesObtenerPagina = {},
): (cursor: string | null) => Promise<PaginaSync | null> {
  return async (cursor: string | null): Promise<PaginaSync | null> => {
    const resultado = await cliente.sincronizarProcesos({ cursor, limite: opciones.limite });
    if (!resultado.ok) {
      throw new RunnerDataApiError(resultado.error);
    }
    return resultado.datos;
  };
}
