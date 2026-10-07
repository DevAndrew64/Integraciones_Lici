/**
 * Lógica pura para interpretar la respuesta de `PUT /api/procesos/sync`
 * ("Actualizar ficha") — separada de page.tsx para poder probarla sin
 * renderizar el componente. No hace fetch ni toca React; solo decide qué
 * mensaje mostrar y qué campos aplicar a la Solicitud en pantalla.
 */

export interface RespuestaActualizarFicha {
  actualizados?: number;
  creados?: number;
  sinCambios?: number;
  ignorados?: number;
  errores?: string[];
  error?: string;
  cronogramasActualizados?: number;
  documentosNuevos?: number;
  linkDetalle?: string;
  linkResuelto?: boolean;
  cambioDetectado?: boolean;
}

/**
 * 'ok'      → éxito completo, sin errores.
 * 'parcial' → el enlace SECOP sí se revalidó/persistió, pero la sincronización
 *             general no pudo completarse (típicamente por límite de peticiones).
 * 'error'   → no hubo ningún resultado útil que aplicar.
 */
export type TipoMensajeActualizarFicha = 'ok' | 'parcial' | 'error';

export interface MensajeActualizarFicha {
  tipo: TipoMensajeActualizarFicha;
  texto: string;
}

// ─── Errores de límite de peticiones (rate-limit de la fuente externa) ──────

const PATRONES_LIMITE_PETICIONES = [
  /http\s*429/i,
  /too many requests/i,
  /excede el l[ií]mite de peticiones/i,
  /m[aá]ximo\s*50\s*por\s*minuto/i,
];

/** true si el texto (crudo, técnico) corresponde a un rechazo por rate-limit. */
export function esErrorLimiteDePeticiones(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return PATRONES_LIMITE_PETICIONES.some((patron) => patron.test(texto));
}

/** true si la respuesta completa (errores[] o error) contiene un rechazo por rate-limit. */
export function tieneLimiteDePeticiones(data: RespuestaActualizarFicha): boolean {
  return (data.errores ?? []).some(esErrorLimiteDePeticiones) || esErrorLimiteDePeticiones(data.error);
}

// ─── Errores técnicos crudos (cualquier HTTP de la fuente externa) ──────────
// Convención usada en todo el proyecto para envolver errores de fetch a
// fuente externa: "[nombreFuncion] HTTP ###: {json crudo}" — p.ej.
// "[liciGetProcesos] HTTP 500: {"message":"Server Error"}" o
// "[liciWeb] Login fallido HTTP 401". Nunca debe llegar así a la interfaz,
// sin importar el código HTTP (no solo 429).
const PATRON_ERROR_TECNICO = /\[[\w.-]+\]|\bHTTP\s*\d{3}\b/i;

/** true si el texto trae la marca de un error técnico interno (nombre de función/HTTP crudo). */
export function esErrorTecnicoCrudo(texto: string | null | undefined): boolean {
  if (!texto) return false;
  return PATRON_ERROR_TECNICO.test(texto);
}

const MENSAJE_LIMITE_PETICIONES =
  'Límite temporal de consultas alcanzado. Espera aproximadamente 2 minutos antes de volver a actualizar la ficha.';
const MENSAJE_LIMITE_PETICIONES_CON_LINK =
  'Enlace SECOP actualizado, pero no fue posible completar los demás datos por límite temporal de consultas. Espera aproximadamente 2 minutos antes de intentarlo nuevamente.';
const MENSAJE_ERROR_GENERICO = 'No fue posible actualizar la ficha. Intenta nuevamente más tarde.';

/**
 * Convierte el error crudo de la respuesta (texto técnico interno: nombre de
 * función, perfil, página, JSON de la API externa) en un mensaje apto para
 * mostrar al usuario, para el caso de un error QUE NO es rate-limit. Cualquier
 * texto con la marca de error técnico (`[func] HTTP ###`, sea 429, 500 u otro)
 * se sustituye por el mensaje genérico — el texto técnico original no se
 * pierde: el llamador (page.tsx) debe seguir enviándolo a `console.error`.
 */
function normalizarErrorGenerico(data: RespuestaActualizarFicha): string {
  const bruto = data.errores?.[0] || data.error;
  if (!bruto) return MENSAJE_ERROR_GENERICO;
  return esErrorTecnicoCrudo(bruto) ? MENSAJE_ERROR_GENERICO : bruto;
}

/**
 * Orden funcional de decisión (de mayor a menor prioridad):
 *   1. Límite de peticiones (429) + el enlace SÍ cambió → éxito parcial:
 *      el link se aplica, pero se avisa que el resto quedó incompleto.
 *   2. Límite de peticiones (429) sin cambio de enlace → mensaje amigable,
 *      nunca el texto técnico crudo ni "Actualizado…"/"Sin cambios…".
 *   3. Otro error real (no rate-limit) → mensaje de error existente.
 *   4. Sin errores + el enlace cambió → "Enlace SECOP actualizado."
 *   5. Sin errores + cambios generales → mensaje detallado de cronograma/documentos.
 *   6. Sin errores y sin cambios → "Sin cambios detectados."
 */
export function determinarMensajeActualizarFicha(
  data: RespuestaActualizarFicha,
  httpOk: boolean
): MensajeActualizarFicha {
  const limitado = tieneLimiteDePeticiones(data);
  const huboRevalidacionDeLink = data.cambioDetectado === true && !!data.linkDetalle;

  if (limitado && huboRevalidacionDeLink) {
    return { tipo: 'parcial', texto: MENSAJE_LIMITE_PETICIONES_CON_LINK };
  }

  if (limitado) {
    return { tipo: 'error', texto: MENSAJE_LIMITE_PETICIONES };
  }

  if (!httpOk || (data.errores?.length ?? 0) > 0) {
    return { tipo: 'error', texto: normalizarErrorGenerico(data) };
  }

  if (huboRevalidacionDeLink) {
    return { tipo: 'ok', texto: 'Enlace SECOP actualizado.' };
  }

  if ((data.actualizados ?? 0) > 0 || (data.creados ?? 0) > 0) {
    return {
      tipo: 'ok',
      texto: `Actualizado: ${data.cronogramasActualizados ?? 0} cambio(s) en cronograma, ${data.documentosNuevos ?? 0} doc(s) nuevo(s).`,
    };
  }

  if ((data.sinCambios ?? 0) > 0 || (data.ignorados ?? 0) > 0) {
    return { tipo: 'ok', texto: 'Sin cambios detectados.' };
  }

  return { tipo: 'ok', texto: 'Sincronización completada.' };
}

/**
 * Determina si, tras una respuesta del PUT (exitosa o parcial), corresponde
 * aplicar inmediatamente el nuevo `linkDetalle` al estado local de la
 * Solicitud (sin esperar la recarga autoritativa posterior). Es independiente
 * de si hubo límite de peticiones: el resolver del enlace puede haber
 * persistido el cambio aunque la sincronización general haya fallado.
 */
export function debeActualizarLinkInmediato(data: RespuestaActualizarFicha): boolean {
  return typeof data.linkDetalle === 'string' && data.linkDetalle.trim() !== '';
}

// ─── Contrato del endpoint PUNTUAL (PUT /api/procesos/actualizar-ficha) ─────

export interface RespuestaActualizacionPuntual {
  ok?: boolean;
  estado?: string;
  mensaje?: string;
  error?: string;
  linkDetalle?: string | null;
  cambioDetectado?: boolean;
  camposActualizados?: string[];
  cronogramasActualizados?: number;
  documentosNuevos?: number;
  omitidoPorActualizacionReciente?: boolean;
  retryAfterSegundos?: number;
  /** true cuando el detalle SECOP confirmó el notice vigente en esta misma
   *  ejecución (o en una reutilizada válida) pero la API general no pudo
   *  completarse — ver `src/lib/procesos/continuacion-actualizacion.ts`. */
  puedeCompletarDatos?: boolean;
  continuacionActualizacion?: string;
  continuacionExpiraEn?: string;
  noticeConfirmado?: string;
}

/**
 * Mensaje para el nuevo contrato puntual. Un mensaje 'ok' marca la ficha como
 * "Actualizada hoy"; 'parcial' y 'error' no (permiten reintento manual).
 */
export function determinarMensajeActualizacionPuntual(
  data: RespuestaActualizacionPuntual
): MensajeActualizarFicha {
  switch (data.estado) {
    case 'reciente':
      return { tipo: 'ok', texto: data.mensaje || 'La ficha ya fue actualizada recientemente.' };
    case 'en_curso':
      return { tipo: 'parcial', texto: data.mensaje || 'Esta ficha ya se está actualizando.' };
    case 'limite_peticiones': {
      const espera = data.retryAfterSegundos && data.retryAfterSegundos > 0
        ? `${Math.ceil(data.retryAfterSegundos / 60)} minuto(s)`
        : 'aproximadamente 2 minutos';
      return {
        tipo: 'error',
        texto: `Límite temporal de consultas alcanzado. Espera ${espera} antes de volver a actualizar la ficha.`,
      };
    }
    case 'parcial':
      // El enlace SECOP quedó confirmado (haya cambiado o no) pero la API
      // general no completó — se ofrece continuación segura para el
      // siguiente clic. Prioridad sobre el mensaje genérico de "algunos
      // datos no pudieron consultarse": aquí sí sabemos exactamente qué
      // falta y que el próximo intento puede omitir la revalidación del enlace.
      if (data.puedeCompletarDatos) {
        return {
          tipo: 'parcial',
          texto: 'Se confirmó el enlace SECOP, pero el servicio de licitaciones no permitió completar los demás datos. Intenta nuevamente para completar la información pendiente.',
        };
      }
      return {
        tipo: 'parcial',
        texto: data.cambioDetectado && data.linkDetalle
          ? MENSAJE_LIMITE_PETICIONES_CON_LINK
          : 'Ficha actualizada parcialmente — algunos datos no pudieron consultarse. Intenta nuevamente en unos minutos.',
      };
    case 'completa':
      return data.cambioDetectado && data.linkDetalle
        ? { tipo: 'ok', texto: 'Enlace SECOP actualizado.' }
        : { tipo: 'ok', texto: 'Ficha actualizada correctamente.' };
    case 'sin_cambios':
      return { tipo: 'ok', texto: 'Sin cambios detectados.' };
    case 'fuente_no_disponible':
      // Ni el detalle ni la API general pudieron confirmar nada en esta
      // ejecución — a diferencia de 'parcial', aquí no hay continuación
      // posible: el próximo intento debe repetir el flujo completo.
      return { tipo: 'error', texto: 'No fue posible conectar con la fuente externa. Intenta nuevamente más tarde.' };
    default: {
      if (esErrorLimiteDePeticiones(data.error)) {
        return { tipo: 'error', texto: MENSAJE_LIMITE_PETICIONES };
      }
      const bruto = data.error || data.mensaje;
      const texto = bruto && !esErrorTecnicoCrudo(bruto) ? bruto : MENSAJE_ERROR_GENERICO;
      return { tipo: 'error', texto };
    }
  }
}
