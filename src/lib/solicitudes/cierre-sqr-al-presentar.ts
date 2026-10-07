/**
 * Ajuste "CIERRE DE SQR AL PRESENTAR" §1/§10/§11/§12/§13/§14/§15/§16 +
 * ajuste posterior "PROTEGER CIERRES TERMINALES CONTRA SQR ABIERTA"
 * (confirmados explícitamente) — motor ÚNICO e idempotente de cierre de
 * SQR, reutilizado por:
 *  - `ejecutarTransicionEstado` (transiciones-estado.ts), exclusivamente
 *    cuando `accion==='PRESENTAR'`, vía `coordinarCierreSqrParaPresentar`;
 *  - `POST /api/solicitudes/[id]/cerrar` (todos los cierres terminales:
 *    RECHAZADO, CERRADO_NO_CUMPLIMIENTO, CANCELADO, CERRADO_ADJUDICADO,
 *    CERRADO_NO_ADJUDICADO), directamente vía `intentarCerrarSqrSiCorresponde`.
 *
 * Diseño deliberado sin `SELECT ... FOR UPDATE` ni `$transaction` propios
 * — cada escritura es un `updateMany` con condición exacta sobre el
 * valor leído (mismo patrón CAS que ya usa el resto del módulo), lo cual
 * ya es atómico a nivel de fila sin necesitar mantener un lock de BD
 * abierto durante la llamada HTTP a GrupoColba: "reclamar" (marcar
 * CERRANDO) y "resolver" (marcar CERRADA/ERROR) son escrituras
 * condicionadas independientes, nunca se mantiene una transacción abierta
 * mientras se espera la red.
 *
 * Orden crítico (obligatorio en ambos llamadores): leer estado actual →
 * determinar si corresponde cerrar → si corresponde, preparar
 * observación/soporte (específico de cada llamador, vía `prepararCierre`)
 * → cerrar SQR externamente → SOLO si GrupoColba confirma, persistir
 * `sqrCerrada=true` → recién ahí se le devuelve el control al llamador
 * para que complete SU transición (PRESENTAR o el cierre terminal). Si
 * GrupoColba falla, se persiste el error y se devuelve `ok:false` — el
 * llamador NUNCA debe completar su propia transición en ese caso.
 */
import { resolverEstadoCierreSqrEfectivo } from './estado-cierre-sqr';
import { obtenerEvidenciaMasReciente, evidenciaABlob } from './evidencia-presentacion';
import { construirRespuestaCierreSqrPresentacion } from './respuesta-cierre-sqr';
import { cerrarSqrEnGrupoColba, type ResultadoCierreSqrExterno } from './cerrar-sqr-externo';

/** Subconjunto mínimo de `DbTransiciones`/`PrismaClient` — estructuralmente
 * compatible (nunca importado desde `transiciones-estado.ts` para evitar
 * un import circular; cualquier valor de esos tipos ya satisface esta
 * interfaz tal cual, por tipado estructural). */
export interface DbCierreSqr {
  solicitud: {
    findUnique(args: { where: { id: number } }): Promise<Record<string, unknown> | null>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  auditLog: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
}

export type ResultadoGateCierreSqr =
  | { ok: true }
  | { ok: false; status: 400 | 409 | 500 | 502; error: string };

export const MENSAJE_CIERRE_SQR_EN_CURSO =
  'El cierre de la SQR asociada ya está en proceso. Intenta nuevamente en unos segundos.';
// Ajuste "UN SOLO TIPO DE EVIDENCIA — SIN SEGUNDA CARGA AL PRESENTAR"
// (confirmado explícitamente) — ya no existe un archivo separado "de
// presentación"; el mensaje ahora refleja que basta con lo cargado en
// "Evidencia de elaboración".
export const MENSAJE_FALTA_EVIDENCIA_PRESENTACION =
  'Debes cargar al menos una evidencia de elaboración para continuar.';
export const MENSAJE_FALTA_OBSERVACION_NO_PRESENTADO =
  'Falta la observación del cierre para poder registrar la respuesta de la SQR.';
export const MENSAJE_ERROR_CIERRE_SQR_EXTERNO =
  'No fue posible cerrar la SQR asociada. El proceso no fue enviado a evaluación. Puedes intentarlo nuevamente.';

/** Señal EXPLÍCITA (nunca deducida de `estadoRevision` dentro del motor,
 * y NUNCA confundida con `null`/`undefined`) de si el proceso fue
 * presentado o no — decide qué exige el motor: `true` (Presentado) →
 * descripción + evidencia obligatorias; `false` (No presentado) → solo
 * observación obligatoria, NUNCA se envía evidencia (el motor la descarta
 * igual si un llamador la incluyera por error). Este tipo es siempre un
 * booleano real — nunca `null`; la nulabilidad (histórico/no definido)
 * solo existe en la columna persistida `Solicitud.estadoFinalSqr`, nunca
 * en esta señal viva de un intento de cierre en curso. */
export type EstadoFinalSqr = boolean;

type CerrarSqrExternoFn = (args: {
  sqrNumero: string;
  observacion: string;
  estadoFinalSqr: boolean;
  soporte?: { nombre: string; contenido: Blob };
}) => Promise<ResultadoCierreSqrExterno>;

/** Lo que cada llamador debe entregar para poder intentar el cierre —
 * calculado únicamente cuando el motor ya determinó que SÍ hay que llamar
 * a GrupoColba (nunca antes: un cierre sin SQR pendiente nunca exige
 * evidencia ni ningún otro dato de negocio). `estadoFinalSqr` es
 * obligatorio (booleano real, nunca `null`) y es la ÚNICA fuente que usa
 * el motor para decidir validación/payload — el motor nunca mira
 * `estadoRevision`. */
export type PreparacionCierreSqr =
  | { ok: true; estadoFinalSqr: EstadoFinalSqr; observacion: string; soporte?: { nombre: string; contenido: Blob } }
  | { ok: false; status: 400; error: string };

/**
 * Motor idempotente ÚNICO: sin `sqrNumero` → ok (nada que cerrar); SQR ya
 * `CERRADA` → ok (no-op, nunca se vuelve a llamar); SQR `CERRANDO` (otra
 * petición ya reclamó el cierre) → 409, nunca dispara una segunda llamada
 * externa concurrente; en cualquier otro caso (`PENDIENTE`/`ERROR`) pide al
 * llamador `estadoFinalSqr`+observación/soporte vía `prepararCierre`,
 * VALIDA aquí mismo con comparación estricta (`=== true` / `=== false`,
 * nunca un `if` laxo que trataría `null`/`undefined` como falso) e
 * intenta el cierre.
 */
export async function intentarCerrarSqrSiCorresponde(params: {
  db: DbCierreSqr;
  solicitudId: number;
  actor: { id: number; usuario: string; email: string; rol: string };
  requestId?: string | null;
  prepararCierre: (fresh: Record<string, unknown>) => PreparacionCierreSqr;
  cerrarSqrExterno?: CerrarSqrExternoFn;
}): Promise<ResultadoGateCierreSqr> {
  const { db, solicitudId, actor, requestId, prepararCierre, cerrarSqrExterno = cerrarSqrEnGrupoColba } = params;

  const fresh = await db.solicitud.findUnique({ where: { id: solicitudId } });
  if (!fresh) return { ok: false, status: 400, error: 'Solicitud no encontrada.' };

  const sqrNumero = typeof fresh.sqrNumero === 'string' && fresh.sqrNumero ? fresh.sqrNumero : null;
  // Sin SQR asociada — la transición del llamador sigue su curso normal,
  // sin ninguna llamada externa innecesaria.
  if (!sqrNumero) return { ok: true };

  const valorPrevioCierre = typeof fresh.sqrCierreEstado === 'string' ? fresh.sqrCierreEstado : null;
  const estadoActual = resolverEstadoCierreSqrEfectivo({
    sqrCerrada: fresh.sqrCerrada === true,
    sqrCierreEstado: valorPrevioCierre,
  });

  // Ya cerrada — nunca se vuelve a llamar a GrupoColba. Cubre tanto el
  // caso "se cerró correctamente antes" como registros legacy con
  // `sqrCerrada=true` sin `sqrCierreEstado` explícito.
  if (estadoActual === 'CERRADA') return { ok: true };

  // Otra petición ya reclamó el cierre — nunca se dispara una segunda
  // llamada externa concurrente.
  if (estadoActual === 'CERRANDO') {
    return { ok: false, status: 409, error: MENSAJE_CIERRE_SQR_EN_CURSO };
  }

  // PENDIENTE o ERROR: recién aquí se le pide al llamador `estadoFinalSqr`
  // + observación/soporte específicos de su propio flujo — nunca antes.
  const preparado = prepararCierre(fresh);
  if (!preparado.ok) return preparado;

  // Validación ÚNICA basada en `estadoFinalSqr` — nunca en `estadoRevision`
  // (el motor no lo conoce, ni debe conocerlo). Comparación ESTRICTA
  // (`=== true`/`=== false`) — `estadoFinalSqr` en `PreparacionCierreSqr`
  // siempre es un booleano real (nunca `null`/`undefined` en este punto,
  // ver el tipo), así que no hay ambigüedad que resolver aquí.
  if (!preparado.observacion?.trim()) {
    return {
      ok: false, status: 400,
      error: preparado.estadoFinalSqr === true ? MENSAJE_FALTA_EVIDENCIA_PRESENTACION : MENSAJE_FALTA_OBSERVACION_NO_PRESENTADO,
    };
  }
  if (preparado.estadoFinalSqr === true && !preparado.soporte) {
    return { ok: false, status: 400, error: MENSAJE_FALTA_EVIDENCIA_PRESENTACION };
  }
  // `false` NUNCA envía evidencia — se descarta aunque el llamador la
  // hubiera incluido por error.
  const soporteEfectivo = preparado.estadoFinalSqr === true ? preparado.soporte : undefined;

  const codigoProceso = typeof fresh.codigoProceso === 'string' ? fresh.codigoProceso : null;

  // FASE 1 — claim atómico (CAS sobre el valor EXACTO recién leído). Un
  // único UPDATE condicional ya es atómico a nivel de fila — si otra
  // petición ganó la carrera entre la lectura de arriba y este UPDATE,
  // count===0 y se responde 409 sin llamar nunca dos veces a GrupoColba.
  const claim = await db.solicitud.updateMany({
    where: { id: solicitudId, sqrCierreEstado: valorPrevioCierre },
    data: { sqrCierreEstado: 'CERRANDO' },
  });
  if (claim.count === 0) {
    return { ok: false, status: 409, error: MENSAJE_CIERRE_SQR_EN_CURSO };
  }

  // Ajuste "ESTADOS PARCIALES POR FALLO DE AUDITLOG" (confirmado
  // explícitamente) — este AuditLog es PRE-LLAMADA: GrupoColba todavía no
  // ha sido contactado en este punto. Si `db.auditLog.create` falla (ej.
  // FK violation por un `actor.id` inválido), NUNCA se debe: (a) llamar a
  // GrupoColba con un estado de auditoría roto, ni (b) dejar el claim
  // `CERRANDO` atascado para siempre. Se revierte el claim al valor previo
  // exacto (mismo CAS que lo tomó) y se devuelve un error controlado —
  // nunca una excepción sin capturar que aborte al llamador entero.
  try {
    await db.auditLog.create({
      data: {
        usuarioId: actor.id, email: actor.email, rol: actor.rol,
        accion: 'sqr_cierre_intento', recurso: 'solicitud', recursoId: String(solicitudId),
        metodo: 'POST',
        detalle: { solicitudId, codigoProceso, sqrNumero, soporteNombre: soporteEfectivo?.nombre ?? null, requestId: requestId ?? null },
      },
    });
  } catch (auditError) {
    await db.solicitud.updateMany({
      where: { id: solicitudId, sqrCierreEstado: 'CERRANDO' },
      data: { sqrCierreEstado: valorPrevioCierre },
    });
    const detalle = auditError instanceof Error ? auditError.message : String(auditError);
    return {
      ok: false, status: 500,
      error: `Error registrando auditoría previa al cierre de SQR (${detalle}). GrupoColba NO fue contactado — claim revertido, el registro sigue reintentable.`,
    };
  }

  // FASE 2 — llamada externa, FUERA de cualquier lock/transacción de BD.
  // `estadoFinalSqr` viaja también en el payload real a GrupoColba (ver
  // `cerrarSqrEnGrupoColba` — limitación de protocolo: multipart/form-data
  // no transporta booleanos nativos, llega como texto "true"/"false").
  const resultadoExterno = await cerrarSqrExterno({
    sqrNumero,
    observacion: preparado.observacion,
    estadoFinalSqr: preparado.estadoFinalSqr,
    soporte: soporteEfectivo,
  });

  // FASE 3 — persistir el resultado ANTES de devolver el control al
  // llamador. Si GrupoColba confirmó, `sqrCerrada=true` queda guardado en
  // este UPDATE independiente: si la transición que sigue (PRESENTAR o un
  // cierre terminal) fallara por cualquier razón local, la SQR YA quedó
  // cerrada y el próximo intento no vuelve a llamar a GrupoColba — solo
  // reintenta la transición (ver `estadoActual==='CERRADA'` arriba).
  // A partir de aquí GrupoColba YA fue contactado — estos AuditLog son
  // POST-LLAMADA. Su fallo NUNCA debe revertir nada (el cierre externo ya
  // ocurrió o ya falló de verdad): la escritura crítica en `Solicitud`
  // (sqrCerrada/sqrCierreEstado/sqrError) se persiste ANTES y de forma
  // independiente; el AuditLog es aquí solo un registro complementario —
  // si falla, se reporta a stderr y se sigue, nunca se propaga como
  // excepción sin capturar.
  if (resultadoExterno.ok) {
    await db.solicitud.updateMany({
      where: { id: solicitudId },
      data: { sqrCerrada: true, sqrCierreEstado: 'CERRADA', fechaCierreSqr: new Date(), sqrError: null },
    });
    try {
      await db.auditLog.create({
        data: {
          usuarioId: actor.id, email: actor.email, rol: actor.rol,
          accion: 'sqr_cerrado', recurso: 'solicitud', recursoId: String(solicitudId),
          metodo: 'POST',
          detalle: { solicitudId, codigoProceso, sqrNumero, soporteNombre: soporteEfectivo?.nombre ?? null, requestId: requestId ?? null },
        },
      });
    } catch (auditError) {
      console.error(`AuditLog "sqr_cerrado" falló para solicitud ${solicitudId} (no crítico, el cierre ya quedó persistido):`, auditError instanceof Error ? auditError.message : auditError);
    }
    return { ok: true };
  }

  await db.solicitud.updateMany({
    where: { id: solicitudId },
    data: { sqrCierreEstado: 'ERROR', sqrError: resultadoExterno.error },
  });
  try {
    await db.auditLog.create({
      data: {
        usuarioId: actor.id, email: actor.email, rol: actor.rol,
        accion: 'sqr_cierre_error', recurso: 'solicitud', recursoId: String(solicitudId),
        metodo: 'POST',
        detalle: {
          solicitudId, codigoProceso, sqrNumero, soporteNombre: soporteEfectivo?.nombre ?? null,
          error: resultadoExterno.error, requestId: requestId ?? null,
          // Ajuste "CLASIFICACIÓN INTERNA DE ERRORES EXTERNOS" — solo
          // diagnóstico interno vía AuditLog, nunca expuesto al usuario
          // final (el mensaje funcional sigue siendo
          // MENSAJE_ERROR_CIERRE_SQR_EXTERNO) y nunca usado para decidir
          // `sqrCerrada`/`sqrCierreEstado` — eso lo sigue decidiendo
          // EXCLUSIVAMENTE `resultadoExterno.ok`, sin excepciones.
          httpStatus: resultadoExterno.status ?? null,
          codigoErrorExterno: resultadoExterno.codigo ?? null,
        },
      },
    });
  } catch (auditError) {
    console.error(`AuditLog "sqr_cierre_error" falló para solicitud ${solicitudId} (no crítico, el error ya quedó persistido):`, auditError instanceof Error ? auditError.message : auditError);
  }
  return { ok: false, status: 502, error: MENSAJE_ERROR_CIERRE_SQR_EXTERNO };
}

/**
 * Envoltorio específico de `PRESENTAR` — construye la observación con la
 * plantilla de Presentar.
 *
 * Ajuste "UN SOLO TIPO DE EVIDENCIA — SIN SEGUNDA CARGA AL PRESENTAR"
 * (confirmado explícitamente) — la UI ya no pide un archivo aparte "de
 * presentación"; el soporte enviado a GrupoColba es automáticamente la
 * evidencia MÁS RECIENTE entre todas las cargadas en "Evidencia de
 * elaboración" (`obtenerEvidenciaMasReciente`, determinista por
 * `fechaCarga` — nunca `evidencias[0]` arbitrario). Ya no exige ninguna
 * designación explícita del usuario; basta con que exista al menos una
 * evidencia cargada.
 */
export async function coordinarCierreSqrParaPresentar(params: {
  db: DbCierreSqr;
  solicitudId: number;
  actor: { id: number; usuario: string; email: string; rol: string };
  requestId?: string | null;
  cerrarSqrExterno?: CerrarSqrExternoFn;
}): Promise<ResultadoGateCierreSqr> {
  return intentarCerrarSqrSiCorresponde({
    db: params.db,
    solicitudId: params.solicitudId,
    actor: params.actor,
    requestId: params.requestId,
    cerrarSqrExterno: params.cerrarSqrExterno,
    prepararCierre: (fresh) => {
      const evidencia = obtenerEvidenciaMasReciente(fresh.asignaciones);
      if (!evidencia) return { ok: false, status: 400, error: MENSAJE_FALTA_EVIDENCIA_PRESENTACION };
      const codigoProceso = typeof fresh.codigoProceso === 'string' ? fresh.codigoProceso : null;
      const entidad = typeof fresh.entidad === 'string' ? fresh.entidad : null;
      return {
        ok: true,
        estadoFinalSqr: true,
        observacion: construirRespuestaCierreSqrPresentacion({ codigoProceso, entidad }),
        soporte: { nombre: evidencia.nombre, contenido: evidenciaABlob(evidencia) },
      };
    },
  });
}
