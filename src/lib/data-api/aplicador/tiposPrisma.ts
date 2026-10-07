/**
 * Subconjunto MÍNIMO de Prisma que necesita `aplicarPaginaCanonica()`. Se
 * depende de esta interfaz, NUNCA del cliente Prisma real importado
 * directamente — así los tests pueden inyectar un fake en memoria sin tocar
 * ninguna base de datos.
 *
 * El runner de sincronización construye su PROPIO PrismaClient a partir de
 * `DATA_API_RUNTIME_DATABASE_URL` (ver `runner/resolverDestinoRuntime.ts`) y
 * nunca importa el singleton `@/lib/prisma`.
 */

/** Concepto canónico de origen — nunca un nombre de proveedor. Espejo exacto de `OrigenFuncional` en `../tipos.ts`. */
export type OrigenFuncionalPersistido = 'MANUAL' | 'PUBLICO_ABIERTO' | 'PUBLICO_REGISTRADO' | 'PRIVADO' | 'DESCONOCIDO';

export interface ProcesoFilaAplicador {
  id: number;
  sourceKey: string;
  nombre?: string | null;
  disponibleDataApi: boolean;
  retiradoDataApiEn: Date | null;
  ultimoSnapshotId: string | null;
  origenFuncional: OrigenFuncionalPersistido | null;
  oculto: boolean | null;
  hashContenido: string | null;
  codigoProceso: string | null;
  entidad: string | null;
  // B.4.5 — necesarios para detectar cambios (estado/valor/fecha) y propagar
  // a `Solicitud` (por `externalId`) sin re-consultar.
  estadoFuente: string | null;
  valor: number | null;
  fechaVencimiento: Date | null;
  externalId: string | null;
  // D16 — necesario para que el UPDATE pueda conservar el link ya resuelto
  // cuando el bundle entrante llega con `linkDetalle: null` (ver
  // `datosActualizacionProceso` en mapeoCanonico.ts).
  linkDetalle: string | null;
  // D17 — mismo motivo para la empresa del grupo: el bundle canónico hoy
  // siempre trae `perfil: null`, así que el UPDATE necesita el valor
  // persistido para no borrar una clasificación asignada a mano.
  perfil: string | null;
}

export interface DocumentoFilaAplicador {
  id: number;
  procesoId: number;
  dataApiDocId: string | null;
  nombre: string;
  tipoDocumento: string | null;
}

export interface CronogramaFilaAplicador {
  id: number;
  procesoId: number;
  evento: string;
  /** B.4.5 — necesario para el diff applier-side de `cambio_cronograma` (leído ANTES del reemplazo). */
  valorTexto: string | null;
}

export interface NotificacionFilaAplicador {
  id: number;
  claveIdempotencia: string | null;
}

/** B.4.5 — `Solicitud` es una entidad de dominio funcional. El aplicador solo
 *  propaga (updateMany) campos ESPEJO del proceso a las solicitudes vinculadas;
 *  nunca crea ni borra solicitudes. */
export interface SolicitudFilaAplicador {
  id: number;
}

/**
 * Estado ÚNICO e identificable de sincronización — una sola fila con
 * `clave='procesos'` (nunca una colección accidental de estados
 * independientes). `checkpointCursor` es el checkpoint INCREMENTAL
 * definitivo: solo avanza en páginas de sync incremental normal
 * (snapshotId ausente), o al PROMOVERSE explícitamente al completar un
 * full resync (snapshotCompleto=true). Los campos `fullResync*` son
 * exclusivamente el estado TRANSITORIO de un full resync en curso — una
 * página parcial de resync nunca los confunde con el checkpoint definitivo.
 */
export interface SyncStateFilaAplicador {
  clave: string;
  checkpointCursor: string | null;
  checkpointActualizadoEn: Date | null;
  fullResyncSnapshotId: string | null;
  fullResyncNextPageCursor: string | null;
  fullResyncIniciadoEn: Date | null;
}

/** Subconjunto de PrismaClient/tx — cada método es exactamente lo que `aplicarPaginaCanonica` necesita, nada más. */
export interface PrismaLikeAplicador {
  proceso: {
    findUnique(args: { where: { sourceKey: string } }): Promise<ProcesoFilaAplicador | null>;
    /**
     * Fallback de resolución de identidad cuando `sourceKey` no matchea —
     * ver comentario en `aplicarUpsert`. SIEMPRE acotado a
     * `disponibleDataApi:true` + `origenFuncional` EXACTO al del bundle
     * entrante (nunca fusiona con procesos manuales, sin clasificar, ni con
     * uno de OTRO origen — ver D15: dos procesos reales con el mismo
     * codigoProceso+entidad pero de fuentes distintas — p.ej. uno SECOP I y
     * otro SECOP II — ya no se confunden entre sí solo por compartir código
     * y entidad).
     */
    findMany(args: {
      where: {
        codigoProceso: string;
        entidad: string;
        disponibleDataApi: true;
        origenFuncional: OrigenFuncionalPersistido;
      };
    }): Promise<ProcesoFilaAplicador[]>;
    create(args: { data: Record<string, unknown> }): Promise<ProcesoFilaAplicador>;
    update(args: { where: { id: number }; data: Record<string, unknown> }): Promise<ProcesoFilaAplicador>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  procesoDocumentoSecop: {
    // Unicidad compuesta (procesoId, dataApiDocId) — el contrato canónico
    // no garantiza que `docId` sea único globalmente, solo dentro de su
    // `procesoId` (ver `DocumentoCanonico` en ../tipos.ts). El findMany ya
    // viene filtrado por procesoId, así que la comprobación de duplicado en
    // el aplicador opera de forma naturalmente compuesta.
    findMany(args: { where: { procesoId: number } }): Promise<DocumentoFilaAplicador[]>;
    create(args: { data: Record<string, unknown> }): Promise<DocumentoFilaAplicador>;
  };
  procesoCronogramaSecop: {
    // B.4.5 — leído ANTES del reemplazo, para el diff applier-side de
    // `cambio_cronograma` (paridad legacy sin depender de `cambioDetectado`,
    // que el motor de la Data API siempre emite `false`).
    findMany(args: { where: { procesoId: number } }): Promise<CronogramaFilaAplicador[]>;
    deleteMany(args: { where: { procesoId: number } }): Promise<{ count: number }>;
    createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
  };
  notificacion: {
    findUnique(args: { where: { claveIdempotencia: string } }): Promise<NotificacionFilaAplicador | null>;
    create(args: { data: Record<string, unknown> }): Promise<NotificacionFilaAplicador>;
  };
  /** B.4.5 — propagación de campos espejo Proceso→Solicitud (nunca create/delete). */
  solicitud: {
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
  dataApiSyncState: {
    obtenerEstado(): Promise<SyncStateFilaAplicador | null>;
    /** Upsert keyed siempre por `clave='procesos'` — nunca crea una segunda fila. */
    upsertEstado(args: { data: Record<string, unknown> }): Promise<SyncStateFilaAplicador>;
  };
  $transaction<T>(fn: (tx: PrismaLikeAplicador) => Promise<T>): Promise<T>;
}
