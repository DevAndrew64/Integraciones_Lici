/**
 * FASE B.3 (licycolba-final) — `aplicarPaginaCanonica()`, construida y
 * probada EN SECO (Prisma fake en memoria, nunca una conexión real).
 *
 * Reglas invariantes:
 *  - Nunca escribe `oculto` — decisión LOCAL del usuario, ajena a la
 *    disponibilidad en la Data API.
 *  - UPSERT siempre deja `disponibleDataApi:true` y `retiradoDataApiEn:null`
 *    (resuelve la reaparición sin lógica especial).
 *  - DELETE/tombstone nunca borra la fila — solo apaga `disponibleDataApi`
 *    y sella `retiradoDataApiEn`; si el proceso no existe localmente, no-op.
 *  - `rawJson` upstream JAMÁS se escribe — no existe en el contrato
 *    canónico, así que es estructuralmente imposible que este módulo lo
 *    persista.
 *  - `origenFuncional` persiste EXCLUSIVAMENTE el concepto canónico
 *    (MANUAL|PUBLICO_ABIERTO|PUBLICO_REGISTRADO|PRIVADO|DESCONOCIDO), nunca
 *    un nombre de proveedor — viene ya resuelto en `ProcesoCanonico`.
 *
 * ── Semántica de checkpoint / full resync (corregida) ──────────────────
 *  - Sync INCREMENTAL normal (`pagina.snapshotId === null`): el
 *    `checkpointCursor` DEFINITIVO avanza atómicamente en cada página
 *    exitosa.
 *  - FULL RESYNC en curso (`pagina.snapshotId` presente, `snapshotCompleto
 *    === false`): una página parcial NUNCA toca el `checkpointCursor`
 *    definitivo. Solo se persiste el estado TRANSITORIO
 *    (`fullResyncSnapshotId`, `fullResyncNextPageCursor`,
 *    `fullResyncIniciadoEn` — este último solo se fija la PRIMERA vez que
 *    se ve ese `snapshotId`, nunca se reescribe en páginas subsiguientes
 *    del mismo resync).
 *  - FULL RESYNC completo (`snapshotCompleto === true`): en la MISMA
 *    transacción se aplica la última página, se ejecuta la reconciliación,
 *    se PROMUEVE `checkpointCursor = pagina.checkpointCursor` y se limpian
 *    los campos transitorios (`fullResyncSnapshotId/NextPageCursor/IniciadoEn
 *    = null`). Si el resync se interrumpe antes de este punto, el estado
 *    transitorio permite retomarlo sin haber tocado nunca el checkpoint
 *    incremental definitivo.
 *  - Reconciliación: SOLO corre en `snapshotCompleto:true`; excluye
 *    siempre los procesos MANUAL. La protección PRIMARIA es la semántica
 *    persistida `origenFuncional = 'MANUAL'`; el prefijo `sourceKey`
 *    `local:%` se mantiene únicamente como compatibilidad para registros
 *    históricos anteriores a que `origenFuncional` se poblara. Los procesos
 *    con `origenFuncional IS NULL` (históricos sin clasificar) NO están
 *    exentos: al ser `{ not: 'MANUAL' }` de Prisma excluyente de NULL, la
 *    rama `origenFuncional: null` se añade a mano para que SÍ se reconcilien.
 *    `oculto` (decisión local) NUNCA se toca.
 *
 * Lo invoca el runner de sincronización (`runner/ejecutarSyncRuntime.ts`), una
 * página por transacción atómica.
 */
import type { PaginaSync, ProcesoSyncBundle } from '../tipos';
import type { PrismaLikeAplicador, ProcesoFilaAplicador } from './tiposPrisma';
import {
  datosCreacionProceso,
  datosActualizacionProceso,
  datosTombstone,
  datosCreacionDocumento,
  datosCreacionCronograma,
  datosNotificacion,
  datosPropagacionSolicitud,
  esManifestacionInteres,
  calcularCambioCronograma,
  claveIdempotenciaProcesoNuevo,
  claveIdempotenciaDocumentoNuevo,
  claveIdempotenciaCambioCronograma,
  claveIdempotenciaCambioEstado,
  claveIdempotenciaCambioValor,
  claveIdempotenciaCambioFechaCierre,
  claveIdempotenciaManifestacionInteres,
  esSourceKeyManual,
} from './mapeoCanonico';

export interface ResultadoAplicacion {
  procesosCreados: number;
  procesosActualizados: number;
  tombstonesAplicados: number;
  documentosCreados: number;
  cronogramasReemplazados: number;
  notificacionesCreadas: number;
  /** B.4.5 — filas `Solicitud` actualizadas por propagación de campos espejo. */
  solicitudesPropagadas: number;
  reconciliacionEjecutada: boolean;
  procesosRetiradosPorReconciliacion: number;
  /** El checkpoint INCREMENTAL definitivo tras esta página — null si la página era un full resync incompleto (no se promovió). */
  checkpointDefinitivoPersistido: string | null;
  /** true si esta página dejó/actualizó estado transitorio de full resync (resync en curso, aún no completo). */
  estadoTransitorioActualizado: boolean;
  /**
   * Procesos que el fallback de identidad por `codigoProceso+entidad`
   * encontró AMBIGUOS (2+ candidatos ya existentes) — NO se escribió nada
   * para ellos (ni create ni update), quedan pendientes de resolución
   * manual. Ver comentario en `aplicarUpsert`.
   */
  procesosAmbiguosOmitidos: number;
  detalleAmbiguos: Array<{ codigoProceso: string; entidad: string; candidatos: number }>;
}

export interface DependenciasAplicador {
  prisma: PrismaLikeAplicador;
}

async function crearNotificacionIdempotente(
  tx: PrismaLikeAplicador,
  claveIdempotencia: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  const existente = await tx.notificacion.findUnique({ where: { claveIdempotencia } });
  if (existente) return false;
  await tx.notificacion.create({ data: { ...data, claveIdempotencia } });
  return true;
}

async function aplicarUpsert(
  tx: PrismaLikeAplicador,
  bundle: Extract<ProcesoSyncBundle, { tipo: 'UPSERT' }>,
  snapshotId: string | null,
  resultado: ResultadoAplicacion,
): Promise<void> {
  const { proceso, documentos, cronograma } = bundle;
  let existente = await tx.proceso.findUnique({ where: { sourceKey: proceso.id } });

  // Fallback de identidad por `codigoProceso+entidad` — la Data API NO
  // garantiza `sourceKey` (`proceso.id`) estable para procesos sin
  // `externalId` propio: en cada barrido/full-resync puede reasignarle un
  // identificador nuevo al mismo proceso real, y sin este fallback cada
  // pasada creaba una fila duplicada (bug real observado: 200+ grupos
  // duplicados en producción). Solo se activa cuando NO hubo match directo
  // por sourceKey, y solo resuelve contra OTROS procesos ya sincronizados
  // desde la Data API (`disponibleDataApi:true`) del MISMO `origenFuncional`
  // que el bundle entrante — nunca fusiona con un proceso registrado
  // manualmente, con uno sin clasificar (`origenFuncional` nulo), NI con uno
  // de OTRO origen (D15: `codigoProceso`+`entidad` puede repetirse entre un
  // proceso real de SECOP I y uno de SECOP II — sin este filtro, el fallback
  // los confundía y una fila cambiaba de fuente entre sync y sync, junto con
  // su link y sus datos contractuales). Exigir igualdad exacta de
  // `origenFuncional` ya cubre por sí solo la exclusión de MANUAL/nulo, así
  // que no hace falta una condición aparte para esos casos.
  // Si hay más de un candidato del MISMO origen (mismo código+entidad ya
  // usado por 2+ procesos reales de esa fuente — codigoProceso puede
  // repetirse, incluso para la misma entidad), es AMBIGUO: NUNCA se resuelve
  // automáticamente. A diferencia de la primera versión de este fix, ahora NO
  // se trata como "proceso nuevo" (eso seguiría creando una 3ª/4ª copia en
  // los grupos que ya están duplicados) — se OMITE por completo (ni create
  // ni update, sin tocar documentos/cronograma/notificaciones de este
  // bundle) y queda registrado en `detalleAmbiguos` para revisión manual
  // fuera de esta función. El universo limpio (sin duplicar) sigue
  // beneficiándose del merge normal de abajo.
  let fusionadoPorFallback = false;
  if (!existente && proceso.codigoProceso && proceso.entidad) {
    const candidatos = await tx.proceso.findMany({
      where: {
        codigoProceso: proceso.codigoProceso,
        entidad: proceso.entidad,
        disponibleDataApi: true,
        origenFuncional: proceso.origenFuncional,
      },
    });
    if (candidatos.length === 1) {
      existente = candidatos[0];
      fusionadoPorFallback = true;
    } else if (candidatos.length > 1) {
      resultado.procesosAmbiguosOmitidos++;
      resultado.detalleAmbiguos.push({
        codigoProceso: proceso.codigoProceso,
        entidad: proceso.entidad,
        candidatos: candidatos.length,
      });
      return;
    }
  }

  // Contexto compartido por todas las notificaciones de este bundle —
  // `ProcesoCanonico` siempre trae codigoProceso/entidad/perfil, así que no
  // hay razón para dejarlos en NULL como antes (ver `ContextoNotificacion`).
  const ctx = { codigoProceso: proceso.codigoProceso, entidad: proceso.entidad, perfil: proceso.perfil };
  const idProceso = proceso.codigoProceso ?? proceso.entidad ?? 'sin identificar';

  let fila: ProcesoFilaAplicador;
  const esProcesoNuevo = !existente;
  if (!existente) {
    fila = await tx.proceso.create({ data: datosCreacionProceso(proceso, snapshotId) });
    resultado.procesosCreados++;
    const creada = await crearNotificacionIdempotente(
      tx,
      claveIdempotenciaProcesoNuevo(proceso.id),
      datosNotificacion('proceso_nuevo', fila.id, {
        ...ctx,
        descripcion: `Nuevo proceso disponible: ${idProceso}${proceso.entidad && proceso.codigoProceso ? ` — ${proceso.entidad}` : ''}`,
      }),
    );
    if (creada) resultado.notificacionesCreadas++;
  } else {
    fila = await tx.proceso.update({
      where: { id: existente.id },
      data: {
        // D16 — se pasa `existente.linkDetalle` para que, si el bundle de
        // esta página en particular trae `linkDetalle: null`, el UPDATE
        // conserve el que la fila ya tenía en vez de borrarlo. EXCEPTO
        // cuando `fusionadoPorFallback` (D15): ahí el `sourceKey` cambió,
        // señal de que la Data API re-indexó el proceso — el link viejo
        // está atado a esa identidad anterior y puede ya no ser válido, así
        // que se deja pasar `null` sin fallback. La fila queda con
        // `linkDetalle:null` hasta que la resolución bajo demanda (ver
        // `GET /api/procesos`) lo repida con el `sourceKey` nuevo.
        // D17 — el perfil (empresa del grupo) SÍ se conserva siempre, incluso
        // en una fusión por fallback: a diferencia del link, no está atado a
        // la identidad que la Data API le asignó al proceso, sino al proceso
        // real, que es el mismo. Hoy el bundle siempre trae `perfil: null`,
        // así que sin esto cada pasada del sync borraba la clasificación.
        ...datosActualizacionProceso(
          proceso,
          snapshotId,
          fusionadoPorFallback ? null : existente.linkDetalle,
          existente.perfil,
        ),
        // Converge el sourceKey al que la Data API está usando AHORA, para
        // que la próxima página matchee directo por sourceKey y este
        // fallback deje de ser necesario para este proceso.
        ...(fusionadoPorFallback ? { sourceKey: proceso.id } : {}),
      },
    });
    resultado.procesosActualizados++;
  }

  if (documentos !== null) {
    const existentes = await tx.procesoDocumentoSecop.findMany({ where: { procesoId: fila.id } });
    const idsExistentes = new Set(existentes.map((d) => d.dataApiDocId).filter((v): v is string => v !== null));
    for (const doc of documentos) {
      if (idsExistentes.has(doc.docId)) continue; // documento repetido (procesoId+dataApiDocId) — no duplica
      await tx.procesoDocumentoSecop.create({ data: datosCreacionDocumento(fila.id, doc) });
      resultado.documentosCreados++;
      // B.4.5 — vocabulario oficial: TODA novedad de documento (incl. adenda)
      // es `documento_nuevo` (el tab "Adendas" de la UI filtra por ese tipo).
      // Título/descripción reproducen el patrón real de
      // `/api/procesos/actualizar-documentos` (legacy) para que se vean
      // igual en la UI, en vez del genérico "Nuevo documento en un proceso".
      const creada = await crearNotificacionIdempotente(
        tx,
        claveIdempotenciaDocumentoNuevo(proceso.id, doc.docId),
        datosNotificacion('documento_nuevo', fila.id, {
          ...ctx,
          titulo: `Documento nuevo: ${proceso.entidad ?? idProceso}`,
          descripcion: `Se publicó "${doc.nombre}" en el proceso ${idProceso}`,
        }),
      );
      if (creada) resultado.notificacionesCreadas++;
    }
  }

  if (cronograma !== null) {
    // ── B.4.5 · `cambio_cronograma` — diff APPLIER-SIDE (Opción B, decidida).
    // El cronograma PERSISTIDO se lee ANTES del reemplazo — es el único punto
    // donde existen a la vez "viejo" (BD) y "nuevo" (bundle), igual que legacy.
    // NO usa `cambioDetectado` (el motor de la Data API lo emite SIEMPRE
    // `false`). Reproduce exactamente `fechasModificadas`/`eventosEliminados`
    // de legacy, SIN la "protección de fecha" (auditada y descartada: workaround
    // específico del proveedor legacy, sin consumidor Data-API — ver informe
    // C2.2-b · punto 2/3).
    const cronogramaViejo = esProcesoNuevo ? [] : await tx.procesoCronogramaSecop.findMany({ where: { procesoId: fila.id } });

    await tx.procesoCronogramaSecop.deleteMany({ where: { procesoId: fila.id } });
    if (cronograma.length > 0) {
      await tx.procesoCronogramaSecop.createMany({ data: cronograma.map((ev) => datosCreacionCronograma(fila.id, ev)) });
    }
    resultado.cronogramasReemplazados++;

    // B.4.5 — `manifestacion_interes`: una notificación por etapa de
    // manifestación de interés presente en el cronograma (mismos patrones que
    // legacy). Idempotente por (proceso, evento) — legacy no dedup, así que el
    // aplicador NUNCA crea más que legacy.
    for (const ev of cronograma) {
      if (!esManifestacionInteres(ev.evento)) continue;
      const creada = await crearNotificacionIdempotente(
        tx,
        claveIdempotenciaManifestacionInteres(proceso.id, ev.evento),
        datosNotificacion('manifestacion_interes', fila.id, {
          ...ctx,
          descripcion: `Se detectó manifestación de interés ("${ev.evento}") en el proceso ${idProceso}`,
        }),
      );
      if (creada) resultado.notificacionesCreadas++;
    }

    // `cambio_cronograma`: solo en UPDATE de un proceso EXISTENTE (un proceso
    // nuevo solo produce `proceso_nuevo`), y solo si el diff dice `notificar`.
    if (!esProcesoNuevo) {
      const diff = calcularCambioCronograma(cronogramaViejo, cronograma);
      if (diff.notificar) {
        const creada = await crearNotificacionIdempotente(
          tx,
          claveIdempotenciaCambioCronograma(proceso.id, proceso.aggregateVersion),
          datosNotificacion('cambio_cronograma', fila.id, {
            ...ctx,
            descripcion: `El proceso ${idProceso} actualizó su cronograma.`,
          }),
        );
        if (creada) resultado.notificacionesCreadas++;
      }
    }
  }

  // ── B.4.5 — side effects funcionales que legacy producía en el sync masivo
  // y que `aplicarPaginaCanonica` no reproducía. Solo en UPDATE de un proceso
  // EXISTENTE; usando fila-vieja (`existente`) vs canónico-nuevo (`proceso`).
  if (existente) {
    const estadoAnterior = existente.estadoFuente;
    const estadoNuevo = proceso.estado;
    const huboCambioEstado = !!estadoAnterior && !!estadoNuevo && estadoAnterior !== estadoNuevo;
    if (huboCambioEstado) {
      const creada = await crearNotificacionIdempotente(
        tx,
        claveIdempotenciaCambioEstado(proceso.id, estadoNuevo!),
        datosNotificacion('cambio_estado', fila.id, {
          ...ctx,
          descripcion: `El proceso ${idProceso} cambió de "${estadoAnterior}" a "${estadoNuevo}".`,
        }),
      );
      if (creada) resultado.notificacionesCreadas++;
    }

    // Cambio de valor: legacy exige `valorAnterior !== valorNuevo && valorNuevo !== null`.
    if (existente.valor !== proceso.valor && proceso.valor !== null && proceso.valor !== undefined) {
      const creada = await crearNotificacionIdempotente(
        tx,
        claveIdempotenciaCambioValor(proceso.id, proceso.valor),
        datosNotificacion('cambio_valor', fila.id, {
          ...ctx,
          descripcion: `El proceso ${idProceso} cambió su valor a ${proceso.valor.toLocaleString('es-CO')}.`,
        }),
      );
      if (creada) resultado.notificacionesCreadas++;
    }

    // Cambio de fecha de cierre. El flag canónico `tieneCambioFechaCierre` HOY
    // no lo puebla el motor (siempre `false` — ver informe C2.2-b · punto 2),
    // así que se reproduce la comparación EXACTA de legacy applier-side:
    // `fechaAnteriorTime !== null && fechaNuevaTime !== null && distintas`,
    // usando la fecha PERSISTIDA (`existente.fechaVencimiento`) vs la del
    // bundle (`proceso.fechaCierre`, ya resuelta por el motor). NO es una
    // heurística nueva: es la misma condición de legacy.
    const fechaAnt = existente.fechaVencimiento ? existente.fechaVencimiento.getTime() : null;
    const fechaNueva = proceso.fechaCierre ? new Date(proceso.fechaCierre).getTime() : null;
    const huboCambioFechaCierre =
      fechaAnt !== null && fechaNueva !== null && fechaAnt !== fechaNueva;
    if (huboCambioFechaCierre) {
      const creada = await crearNotificacionIdempotente(
        tx,
        claveIdempotenciaCambioFechaCierre(proceso.id, proceso.fechaCierre!),
        datosNotificacion('cambio_fecha_cierre', fila.id, {
          ...ctx,
          descripcion: `El proceso ${idProceso} cambió su fecha de cierre a ${new Date(proceso.fechaCierre!).toLocaleDateString('es-CO')}.`,
        }),
      );
      if (creada) resultado.notificacionesCreadas++;
    }

    // Propagación de campos ESPEJO Proceso→Solicitud (legacy: bloque
    // `solicitud.updateMany` del sync masivo). Disparador EXACTO de legacy
    // (`procesos-sync.ts`): `(dataBase.estadoFuente && estadoAnterior !== estadoNuevo) || hayCambioFechaCierre`.
    // OJO: es LIGERAMENTE más ancho que el de la NOTIFICACIÓN `cambio_estado`
    // (que exige ambos estados no-nulos) — la propagación también dispara en
    // `null → estado`. Se reproduce tal cual, sin "mejora" no demostrada.
    const estadoDisparaPropagacion =
      !!proceso.estado && existente.estadoFuente !== proceso.estado;
    if (estadoDisparaPropagacion || huboCambioFechaCierre) {
      const espejo = datosPropagacionSolicitud(proceso, huboCambioFechaCierre);
      if (Object.keys(espejo).length > 0) {
        const where =
          typeof existente.externalId === 'string' && existente.externalId.length > 0
            ? { OR: [{ procesoId: fila.id }, { externalId: existente.externalId }] }
            : { procesoId: fila.id };
        const { count } = await tx.solicitud.updateMany({ where, data: espejo });
        resultado.solicitudesPropagadas += count;
      }
    }
  }
}

async function aplicarTombstone(
  tx: PrismaLikeAplicador,
  tombstone: { id: string },
  resultado: ResultadoAplicacion,
): Promise<void> {
  const existente = await tx.proceso.findUnique({ where: { sourceKey: tombstone.id } });
  if (!existente) return; // no-op — nunca crea una fila solo para retirarla
  await tx.proceso.update({ where: { id: existente.id }, data: datosTombstone() });
  resultado.tombstonesAplicados++;
}

/** Resultado en cero — una sola definición para página y bundle puntual. */
function nuevoResultado(): ResultadoAplicacion {
  return {
    procesosCreados: 0,
    procesosActualizados: 0,
    tombstonesAplicados: 0,
    documentosCreados: 0,
    cronogramasReemplazados: 0,
    notificacionesCreadas: 0,
    solicitudesPropagadas: 0,
    reconciliacionEjecutada: false,
    procesosRetiradosPorReconciliacion: 0,
    checkpointDefinitivoPersistido: null,
    estadoTransitorioActualizado: false,
    procesosAmbiguosOmitidos: 0,
    detalleAmbiguos: [],
  };
}

/**
 * Aplica UN bundle canónico DENTRO de una transacción ya abierta (`tx`).
 * NO toca `DataApiSyncState` — eso es responsabilidad exclusiva del nivel
 * página. Es la unidad compartida entre `aplicarPaginaCanonica` (bucle de
 * página) y `aplicarBundleCanonico` (actualización puntual).
 */
async function aplicarBundleEnTx(
  tx: PrismaLikeAplicador,
  bundle: ProcesoSyncBundle,
  snapshotId: string | null,
  resultado: ResultadoAplicacion,
): Promise<void> {
  if (bundle.tipo === 'DELETE') {
    await aplicarTombstone(tx, bundle.tombstone, resultado);
  } else {
    await aplicarUpsert(tx, bundle, snapshotId, resultado);
  }
}

/**
 * B.4.5 — aplica UN `ProcesoSyncBundle` (p.ej. el de `POST /v1/procesos/:id/
 * actualizar`) en su propia transacción atómica e idempotente.
 *
 * GARANTÍA DURA: NUNCA toca `DataApiSyncState` — ni `checkpointCursor`, ni
 * `fullResync*`, ni ningún cursor/snapshot. Una actualización puntual jamás
 * mueve el estado de sincronización. (Estructural: este código no tiene
 * ninguna llamada a `tx.dataApiSyncState`.)
 *
 * Cubre lo mismo que una página: UPSERT/tombstone de Proceso, documentos,
 * cronograma, notificaciones (`proceso_nuevo`/`documento_nuevo`/`cambio_*`/
 * `manifestacion_interes`) y la propagación de campos espejo a `Solicitud`.
 */
export async function aplicarBundleCanonico(
  bundle: ProcesoSyncBundle,
  deps: DependenciasAplicador,
): Promise<ResultadoAplicacion> {
  return deps.prisma.$transaction(async (tx) => {
    const resultado = nuevoResultado();
    await aplicarBundleEnTx(tx, bundle, null, resultado);
    return resultado;
  });
}

/**
 * Aplica una página canónica dentro de una única transacción. Si cualquier
 * paso falla, toda la página se revierte — incluyendo cualquier avance de
 * checkpoint o estado transitorio, que nunca se persisten fuera de una
 * transacción exitosa.
 */
export async function aplicarPaginaCanonica(pagina: PaginaSync, deps: DependenciasAplicador): Promise<ResultadoAplicacion> {
  return deps.prisma.$transaction(async (tx) => {
    const resultado = nuevoResultado();

    for (const bundle of pagina.items) {
      await aplicarBundleEnTx(tx, bundle, pagina.snapshotId, resultado);
    }

    const esFullResync = pagina.snapshotId !== null;
    const esCompletado = esFullResync && pagina.snapshotCompleto === true;

    if (!esFullResync) {
      // Sync incremental normal: el checkpoint definitivo avanza atómicamente, página por página.
      await tx.dataApiSyncState.upsertEstado({
        data: { checkpointCursor: pagina.checkpointCursor, checkpointActualizadoEn: new Date() },
      });
      resultado.checkpointDefinitivoPersistido = pagina.checkpointCursor;
    } else if (!esCompletado) {
      // Full resync EN CURSO: nunca toca checkpointCursor definitivo — solo estado transitorio.
      const estadoActual = await tx.dataApiSyncState.obtenerEstado();
      const esInicioDeEsteSnapshot = estadoActual?.fullResyncSnapshotId !== pagina.snapshotId;
      await tx.dataApiSyncState.upsertEstado({
        data: {
          fullResyncSnapshotId: pagina.snapshotId,
          fullResyncNextPageCursor: pagina.nextPageCursor,
          ...(esInicioDeEsteSnapshot ? { fullResyncIniciadoEn: new Date() } : {}),
        },
      });
      resultado.estadoTransitorioActualizado = true;
    } else {
      // Full resync COMPLETO: aplica (ya aplicado arriba), reconcilia, promueve checkpoint, limpia transitorio — todo en esta misma transacción.
      const { count } = await tx.proceso.updateMany({
        where: {
          disponibleDataApi: true,
          ultimoSnapshotId: { not: pagina.snapshotId },
          // Protección PRIMARIA de los procesos MANUAL: la semántica
          // persistida `origenFuncional = 'MANUAL'`.
          //
          // OJO semántica Prisma/PostgreSQL: en un campo nullable,
          // `{ not: 'MANUAL' }` compila a `origenFuncional <> 'MANUAL'`, que
          // NO incluye las filas con `origenFuncional IS NULL`. Los procesos
          // históricos sin clasificar (NULL) SÍ deben poder reconciliarse,
          // así que se añaden explícitamente con la rama `origenFuncional: null`.
          OR: [
            { origenFuncional: null },
            { origenFuncional: { not: 'MANUAL' } },
          ],
          // Compatibilidad histórica: registros previos a que
          // `origenFuncional` se poblara y que usan la convención `local:%`.
          NOT: { sourceKey: { startsWith: 'local:' } },
        } as unknown as Record<string, unknown>,
        data: datosTombstone(),
      });
      resultado.reconciliacionEjecutada = true;
      resultado.procesosRetiradosPorReconciliacion = count;

      await tx.dataApiSyncState.upsertEstado({
        data: {
          checkpointCursor: pagina.checkpointCursor,
          checkpointActualizadoEn: new Date(),
          fullResyncSnapshotId: null,
          fullResyncNextPageCursor: null,
          fullResyncIniciadoEn: null,
        },
      });
      resultado.checkpointDefinitivoPersistido = pagina.checkpointCursor;
    }

    return resultado;
  });
}

// Reexportado para que los tests puedan usar el mismo helper sin duplicar lógica.
export { esSourceKeyManual };
