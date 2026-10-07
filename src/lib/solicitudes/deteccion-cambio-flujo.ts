/**
 * FASE 2B-1 — detección centralizada de intentos de cambiar el FLUJO
 * (etapa/subestado) a través del PATCH genérico, más allá de comparar tres
 * strings concretos: cubre alias legados, variantes de mayúsculas/minúsculas,
 * y el intento de colar el cambio dentro de `asignaciones[].estadoRevision`
 * (incluido mandar el arreglo completo con una sola fila modificada).
 *
 * Reemplaza la comparación literal `estadoSolicitud.trim().toUpperCase()`
 * que existía antes en `PATCH /api/solicitudes` — misma lista de valores
 * bloqueados (`ESTADOS_EXCLUSIVOS_TRANSICION_DEDICADA`), detección más
 * amplia.
 */
import type { EstadoCanonico } from './estados-canonicos';

/** Estados cuyo ÚNICO camino de escritura autorizado es
 * `POST /api/solicitudes/[id]/transicion` — ningún llamador activo restante
 * (`guardar()`/`guardarSilencioso()`/PATCH) los envía legítimamente. Se
 * amplía a medida que se migran más acciones (nunca se reduce) — ver
 * inventario completo en el informe de Fase 2B-1. */
export const ESTADOS_EXCLUSIVOS_TRANSICION_DEDICADA: readonly EstadoCanonico[] = [
  'EN_REVISION', 'ASIGNADO_REVISION', 'EN_ELABORACION',
  // Fase 2B-2.2.5 — el único llamador activo (`GestionAsignacionInline`,
  // aprobación tras observación) ya migró a `POST /[id]/finalizar-revision`
  // (Fase 2B-2.2.2). El PATCH genérico nunca vuelve a escribir este token —
  // ni como `estadoSolicitud`, ni dentro de `asignaciones[].estadoRevision`.
  // NO afecta la etiqueta legada en español "Asignado para elaboración"
  // (ver `esValorDeFlujoNoAutorizado`, que compara solo contra el token
  // canónico/alias, nunca contra el texto legado).
  'APROBADO_ELABORACION',
  // Fase 2B-2.2.6 — el único llamador activo de esta transición
  // (`ENVIAR_A_OBSERVACION`) es `POST /[id]/observaciones` (agregar la
  // primera observación), ya transaccional y por-fila desde antes de esta
  // serie de fases. El PATCH genérico nunca vuelve a escribir el estado
  // GLOBAL canónico `EN_OBSERVACION` — el alias de FILA (`CON_OBSERVACIONES`)
  // se bloquea aparte, ver `ALIAS_FILA_EXCLUSIVOS_TRANSICION_DEDICADA`.
  'EN_OBSERVACION',
  // Fase 2B-2.2.8 — el único llamador activo de la transición `PRESENTAR`
  // (EN_ELABORACION→PRESENTADO, `MATRIZ_ACCIONES`) es
  // `POST /[id]/transicion`, ya transaccional con lock/CAS/auditoría propios
  // — a diferencia de FINALIZAR_REVISION/ENVIAR_A_OBSERVACION/
  // REENVIAR_REVISION, esta transición NO requiere un endpoint dedicado
  // por-fila (es una de las 8 transiciones intermedias que `/transicion` sí
  // maneja correctamente); solo se cierra aquí la fuga del PATCH genérico,
  // que hoy podría escribir este estado sin transacción, sin lock y sin
  // AuditLog.
  'PRESENTADO',
];

/**
 * Alias LEGADO de FILA (`asignaciones[].estadoRevision`), NUNCA un
 * `EstadoCanonico` — `estadoRevisionLegadoEquivalente('EN_OBSERVACION')`
 * (`estados-canonicos.ts`) produce `'CON_OBSERVACIONES'`, una ortografía
 * distinta del token canónico global. Se declara en un array propio,
 * separado de `ESTADOS_EXCLUSIVOS_TRANSICION_DEDICADA`, para no forzar ese
 * tipo (que representa `Solicitud.estadoSolicitud`) a aceptar un valor que
 * solo existe a nivel de fila — mantiene separada la semántica de "estado
 * canónico de Solicitud" vs. "alias legado de fila", sin refactorizar el
 * sistema de estados. Reutiliza el MISMO mecanismo de bloqueo
 * (`esValorDeFlujoNoAutorizado`/`SET_BLOQUEADOS`) — nunca una lógica
 * paralela.
 */
export const ALIAS_FILA_EXCLUSIVOS_TRANSICION_DEDICADA: readonly string[] = [
  'CON_OBSERVACIONES',
  // Fase 2B-2.2.9 — estados de CIERRE a nivel de fila. La única autoridad
  // para producirlos es `POST /[id]/cerrar` (transaccional, `FOR UPDATE`,
  // allowlist estricta por `estadoRevision` con coherencia
  // resultadoFinal/causaNoPresentacion/tipoCausa, y actualización atómica
  // de `Solicitud.estadoSolicitud` en la misma transacción — ver
  // `RESULTADO_ESTADO_POR_ESTADO_REVISION`, `cerrar/route.ts`). El PATCH
  // genérico ya bloqueaba `Solicitud.estadoSolicitud` terminal
  // (`ESTADOS_SOLICITUD_TERMINALES`, `estados-solicitud.ts`) pero nunca
  // había bloqueado estos mismos estados cuando aparecen únicamente en
  // `asignaciones[].estadoRevision` — permitía dejar una fila "cerrada"
  // sin CAS, sin validación de coherencia, y sin que `Solicitud.
  // estadoSolicitud` cambiara (inconsistencia entre ambos).
  'RECHAZADO',
  'CERRADO_ADJUDICADO',
  'CERRADO_NO_ADJUDICADO',
  'CERRADO_NO_CUMPLIMIENTO',
  'CANCELADO',
];

const SET_BLOQUEADOS = new Set<string>([
  ...ESTADOS_EXCLUSIVOS_TRANSICION_DEDICADA,
  ...ALIAS_FILA_EXCLUSIVOS_TRANSICION_DEDICADA,
]);

/**
 * Compara SOLO contra la forma canónica/alias snake_case exacta (con
 * tolerancia a mayúsculas/minúsculas y espacios) — deliberadamente NO usa
 * `normalizarEstadoSolicitud` (que también traduce etiquetas legadas en
 * español como "Asignado para revisión"): esa etiqueta sigue siendo un
 * valor LEGÍTIMO que otros flujos aún no migrados (`agregarResponsables`,
 * `estadoSolicitudOverride`) escriben de verdad — bloquearla rompería esos
 * caminos activos. Lo que se bloquea es específicamente el token
 * canónico/alias (`EN_REVISION`, `en_revision`, `ASIGNADO_REVISION`,
 * `EN_ELABORACION`...), que ningún llamador legítimo restante produce.
 */
function esValorDeFlujoNoAutorizado(valor: unknown): boolean {
  if (typeof valor !== 'string') return false;
  const v = valor.trim().toUpperCase();
  return v !== '' && SET_BLOQUEADOS.has(v);
}

export interface ResultadoDeteccionCambioFlujo {
  detectado: boolean;
  /** Campo/ubicación donde se detectó el intento — para logging/depuración,
   * nunca se expone tal cual al cliente. */
  motivo?: string;
}

/**
 * `body`: el cuerpo crudo del PATCH tal como llega del cliente.
 * `asignacionesEnBd`: `Solicitud.asignaciones` REAL, leído del servidor
 * ANTES de aplicar el PATCH — nunca se compara contra lo que el propio
 * cliente afirma que había antes (eso permitiría evadir la detección).
 */
export function detectarCambioDeFlujoNoAutorizado(
  body: { estadoSolicitud?: unknown; asignaciones?: unknown },
  asignacionesEnBd: unknown,
): ResultadoDeteccionCambioFlujo {
  if (esValorDeFlujoNoAutorizado(body.estadoSolicitud)) {
    return { detectado: true, motivo: 'estadoSolicitud' };
  }

  if (Array.isArray(body.asignaciones)) {
    const filasBd = Array.isArray(asignacionesEnBd) ? (asignacionesEnBd as Record<string, unknown>[]) : [];
    for (const filaBody of body.asignaciones as Record<string, unknown>[]) {
      if (!filaBody || typeof filaBody !== 'object') continue;
      const id = String(filaBody.idAsignacion ?? '');
      const filaBd = filasBd.find((f) => String(f?.idAsignacion ?? '') === id);
      const estadoRevisionBody = filaBody.estadoRevision;
      const estadoRevisionBd = filaBd?.estadoRevision;
      // Solo cuenta si REALMENTE cambia respecto a BD — un PATCH que
      // reenvía el arreglo intacto (ej. para agregar una observación en
      // otra fila) nunca debe bloquearse por esto.
      if (esValorDeFlujoNoAutorizado(estadoRevisionBody) && estadoRevisionBody !== estadoRevisionBd) {
        return { detectado: true, motivo: `asignaciones[].estadoRevision (idAsignacion=${id || '(sin id)'})` };
      }
    }
  }

  return { detectado: false };
}