/**
 * `DataApiClient` — cliente HTTP del servicio de datos de procesos.
 *
 * Único punto de acceso al servicio configurado por entorno. Se activa sólo
 * cuando la sincronización está en modo `data-api`.
 *
 * Reglas duras de este archivo:
 *  - Ningún error de red/parseo/upstream se propaga crudo — todo sale como
 *    `ErrorCanonico` (mensaje neutral, sin headers, sin stack trace).
 *  - Nunca se reintenta un error no transitorio (4xx salvo 429).
 *  - Nunca se menciona un proveedor técnico concreto (ver
 *    contrato-guardrail.test.ts).
 */

import {
  CONTRATO_VERSION_ACTUAL,
  CONTRATO_VERSIONES_SOPORTADAS,
  type ContratoVersion,
  type ErrorCanonico,
  type CodigoErrorCanonico,
  type Resultado,
  type PaginaSync,
  type RespuestaActualizar,
  type RespuestaResolverLink,
  type RespuestaSalud,
  type RespuestaDocumento,
} from './tipos';

const MENSAJE_MAX_LARGO = 300;

function sanearMensaje(mensaje: string): string {
  // Cinturón de seguridad adicional del lado cliente: aunque el servidor ya
  // sanea sus propios mensajes, este cliente NUNCA confía ciegamente en la
  // forma de la respuesta — corta cualquier texto sospechosamente largo
  // (p.ej. un stack trace que se hubiera colado) y nunca incluye el texto
  // crudo de una excepción de red.
  const limpio = String(mensaje ?? '').replace(/\s+/g, ' ').trim();
  return limpio.length > MENSAJE_MAX_LARGO ? `${limpio.slice(0, MENSAJE_MAX_LARGO)}…` : limpio || 'Error no especificado.';
}

function errorCanonico(codigo: CodigoErrorCanonico, mensaje: string, reintentar: boolean): ErrorCanonico {
  return { codigo, mensaje: sanearMensaje(mensaje), reintentar };
}

const ERRORES_GENERICOS: Record<string, ErrorCanonico> = {
  401: errorCanonico('NO_AUTORIZADO', 'Credencial inválida o ausente.', false),
  403: errorCanonico('NO_AUTORIZADO', 'La credencial no tiene permiso para esta operación.', false),
  404: errorCanonico('ERROR_INTERNO', 'Recurso no encontrado.', false),
  410: errorCanonico('CURSOR_EXPIRADO', 'El checkpoint ya no es válido. Se requiere una nueva sincronización completa.', false),
  422: errorCanonico('ERROR_INTERNO', 'Solicitud rechazada por datos inválidos.', false),
  429: errorCanonico('LIMITE_EXCEDIDO', 'Límite de solicitudes alcanzado. Reintenta más tarde.', true),
};

/** Traduce cualquier status HTTP no manejado explícitamente por status a un ErrorCanonico neutral. */
function traducirPorStatus(status: number): ErrorCanonico {
  const especifico = ERRORES_GENERICOS[String(status)];
  if (especifico) return especifico;
  if (status >= 500) return errorCanonico('NO_DISPONIBLE', 'El servicio no está disponible temporalmente.', true);
  if (status >= 400) return errorCanonico('ERROR_INTERNO', 'La solicitud no pudo completarse.', false);
  return errorCanonico('ERROR_INTERNO', 'Respuesta inesperada del servicio.', false);
}

/** Si el cuerpo trae la forma { error: ErrorCanonico } se usa (saneando el mensaje igual); si no, se traduce por status. */
function extraerError(status: number, cuerpo: unknown): ErrorCanonico {
  if (cuerpo && typeof cuerpo === 'object' && 'error' in cuerpo) {
    const e = (cuerpo as { error?: unknown }).error;
    if (e && typeof e === 'object' && 'codigo' in e && 'mensaje' in e && 'reintentar' in e) {
      const ec = e as ErrorCanonico;
      return errorCanonico(ec.codigo, ec.mensaje, Boolean(ec.reintentar));
    }
  }
  return traducirPorStatus(status);
}

export interface ConfiguracionDataApiClient {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number; // default 10_000
  contratoVersion?: ContratoVersion; // default CONTRATO_VERSION_ACTUAL
  fetchImpl?: typeof fetch; // inyectable para tests — nunca usado en producción salvo el global real
  /**
   * Logging temporal de diagnóstico (URL sin secretos, status, código de
   * error) — `false` por defecto. Deliberadamente NO se lee ninguna variable
   * de entorno nueva aquí: `cliente.ts` solo puede leer
   * DATA_API_BASE_URL/DATA_API_KEY/DATA_API_TIMEOUT_MS (ver
   * `contrato-guardrail.test.ts`); quien decide activarlo (el caller) lee su
   * propio flag de entorno y lo pasa aquí como booleano ya resuelto.
   */
  debug?: boolean;
}

export interface DataApiClient {
  sincronizarProcesos(params: { cursor: string | null; limite?: number }): Promise<Resultado<PaginaSync>>;
  actualizarFicha(procesoId: string): Promise<Resultado<RespuestaActualizar>>;
  resolverLinkDetalle(procesoId: string): Promise<Resultado<RespuestaResolverLink>>;
  salud(): Promise<Resultado<RespuestaSalud>>;
  descargarDocumento(procesoId: string, docId: string): Promise<Resultado<RespuestaDocumento>>;
}

export function crearDataApiClient(config: ConfiguracionDataApiClient): DataApiClient {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const timeoutMs = config.timeoutMs ?? 10_000;
  const contratoVersion = config.contratoVersion ?? CONTRATO_VERSION_ACTUAL;
  const fetchFn = config.fetchImpl ?? fetch;

  if (!(CONTRATO_VERSIONES_SOPORTADAS as readonly string[]).includes(contratoVersion)) {
    throw new Error(`Versión de contrato no soportada por este cliente: ${contratoVersion}`);
  }

  // Logging temporal de diagnóstico — SOLO si `config.debug === true`. Nunca
  // imprime apiKey ni ningún header/valor de autenticación; la URL impresa
  // nunca lleva la key (nunca viaja en query string, ver `solicitar`).
  // Quitar este bloque (y sus usos abajo) una vez resuelto el diagnóstico.
  const debugLog = config.debug === true;

  async function solicitar<T>(
    metodo: 'GET' | 'POST',
    ruta: string,
    opciones: { query?: Record<string, string | undefined>; binario?: boolean } = {},
  ): Promise<Resultado<T>> {
    const url = new URL(`${baseUrl}${ruta}`);
    for (const [k, v] of Object.entries(opciones.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, v);
    }

    if (debugLog) {
      console.log(`[data-api-debug] ${metodo} ${url.toString()} contrato=${contratoVersion}`);
    }

    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetchFn(url.toString(), {
        method: metodo,
        headers: {
          'X-API-Key': config.apiKey,
          'X-Contract-Version': contratoVersion,
          Accept: opciones.binario ? '*/*' : 'application/json',
        },
        signal: controlador.signal,
      });
    } catch (err) {
      clearTimeout(temporizador);
      const esAbort = typeof err === 'object' && err !== null && 'name' in err && (err as { name: unknown }).name === 'AbortError';
      // Nunca se propaga `err.message` crudo (podría contener detalles de
      // red/DNS/proxy del entorno) — solo el código neutral.
      return {
        ok: false,
        error: esAbort
          ? errorCanonico('NO_DISPONIBLE', 'Tiempo de espera agotado al contactar el servicio.', true)
          : errorCanonico('NO_DISPONIBLE', 'No se pudo contactar el servicio.', true),
      };
    } finally {
      clearTimeout(temporizador);
    }

    if (debugLog) {
      console.log(`[data-api-debug] status=${res.status} ok=${res.ok} content-type=${res.headers.get('content-type') ?? '(ninguno)'}`);
    }

    if (opciones.binario) {
      if (!res.ok) {
        let cuerpoError: unknown;
        try { cuerpoError = await res.json(); } catch { cuerpoError = undefined; }
        const error = extraerError(res.status, cuerpoError);
        if (debugLog) console.log(`[data-api-debug] error codigo=${error.codigo} mensaje="${error.mensaje}"`);
        return { ok: false, error };
      }
      const contenido = await res.arrayBuffer();
      const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
      const disposicion = res.headers.get('content-disposition') ?? '';
      const nombreMatch = /filename="?([^"]+)"?/.exec(disposicion);
      return {
        ok: true,
        datos: { contenido, contentType, nombreArchivo: nombreMatch?.[1] ?? 'documento' } as unknown as T,
      };
    }

    let cuerpo: unknown;
    try {
      cuerpo = await res.json();
    } catch {
      // Respuesta no-JSON (p.ej. un proxy intermedio devolvió HTML de error) —
      // nunca se intenta leer/propagar ese cuerpo tal cual.
      if (debugLog) console.log('[data-api-debug] respuesta NO-JSON (posible proxy/gateway intermedio, no el handler de la app)');
      return { ok: false, error: res.ok ? errorCanonico('ERROR_INTERNO', 'Respuesta inválida del servicio.', false) : traducirPorStatus(res.status) };
    }

    if (!res.ok) {
      const error = extraerError(res.status, cuerpo);
      if (debugLog) console.log(`[data-api-debug] error codigo=${error.codigo} mensaje="${error.mensaje}" cuerpoTraiaFormaEsperada=${Boolean(cuerpo && typeof cuerpo === 'object' && 'error' in cuerpo)}`);
      return { ok: false, error };
    }

    return { ok: true, datos: cuerpo as T };
  }

  return {
    async sincronizarProcesos(params) {
      return solicitar<PaginaSync>('GET', '/v1/sync/procesos', {
        query: { cursor: params.cursor ?? undefined, limite: params.limite ? String(params.limite) : undefined },
      });
    },
    async actualizarFicha(procesoId) {
      return solicitar<RespuestaActualizar>('POST', `/v1/procesos/${encodeURIComponent(procesoId)}/actualizar`);
    },
    async resolverLinkDetalle(procesoId) {
      return solicitar<RespuestaResolverLink>('POST', `/v1/procesos/${encodeURIComponent(procesoId)}/resolver-link`);
    },
    async salud() {
      return solicitar<RespuestaSalud>('GET', '/v1/salud');
    },
    async descargarDocumento(procesoId, docId) {
      return solicitar<RespuestaDocumento>('GET', `/v1/procesos/${encodeURIComponent(procesoId)}/documento/${encodeURIComponent(docId)}/descargar`, { binario: true });
    },
  };
}

/**
 * Fábrica desde variables de entorno (`DATA_API_BASE_URL`, `DATA_API_KEY`,
 * `DATA_API_TIMEOUT_MS`). La usa el runner de sincronización en modo `data-api`.
 */
export function crearDataApiClientDesdeEnv(opciones: { debug?: boolean } = {}): DataApiClient {
  const baseUrl = process.env.DATA_API_BASE_URL;
  const apiKey = process.env.DATA_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('Variables faltantes: DATA_API_BASE_URL, DATA_API_KEY');
  }
  const timeoutMs = process.env.DATA_API_TIMEOUT_MS ? Number(process.env.DATA_API_TIMEOUT_MS) : undefined;
  return crearDataApiClient({ baseUrl, apiKey, timeoutMs, debug: opciones.debug === true });
}
