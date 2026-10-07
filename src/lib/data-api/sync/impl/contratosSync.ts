/**
 * Contratos (tipos) de la fachada de sincronización de procesos.
 *
 * Módulo NEUTRAL: no importa ningún proveedor ni el pipeline de adquisición.
 * Antes estos tipos se re-exportaban desde el adaptador legacy; ahora viven
 * aquí para que `fachadaSync` y `implDataApi` no dependan de ese árbol.
 */

/** Métricas de una sincronización masiva/incremental. */
export interface SyncMetrics {
  ok: boolean;
  totalApi: number;
  paginasConsultadas: number;
  recibidos: number;
  creados: number;
  actualizados: number;
  sinCambios: number;
  ignorados: number;
  nuevosRegistrados: number;
  cambiosEstado: number;
  cambiosFechaCierre: number;
  cambiosValor: number;
  documentosNuevos: number;
  cronogramasActualizados: number;
  ignoradosEstadoTerminal: number;
  errores: string[];
  duracionMs: number;
}

/** Parámetros de la sincronización de procesos. */
export interface SincronizarProcesosParams {
  maxResultados?: number;
  limitPorPagina?: number;
  forzar?: boolean;
  debugProceso?: string;
  soloEste?: string;
  filtrarNuevos?: boolean;
  ascending?: 0 | 1;
  paginaInicio?: number;
  /** null = sin límite; omitir = usar default. */
  cutoffCreacion?: Date | null;
}

/** Resultado de resolver el `linkDetalle` de un proceso. */
export interface ResolverResult {
  ok: boolean;
  yaExistia?: boolean;
  linkDetalle?: string;
  tipoFuente?: string;
  score?: number;
  intentos?: number;
  estrategia?: string;
  error?: string;
  estado?: string;
}

export interface OpcionesResolverLinkDetalle {
  revalidarExistente?: boolean;
  persistir?: boolean;
}

/** Resultado de revalidar un `linkDetalle` ya existente. */
export interface ResultadoRevalidacionLink {
  ok: boolean;
  linkAnterior: string | null;
  linkPrincipalActual: string | null;
  cambioDetectado: boolean;
  actualizado: boolean;
  fuenteResolucion: string | null;
  noticeAnterior: string | null;
  noticeActual: string | null;
  motivo?: string;
  error?: string;
}

export type EstadoActualizacionPuntual =
  | 'completa'
  | 'parcial'
  | 'sin_cambios'
  | 'reciente'
  | 'en_curso'
  | 'limite_peticiones'
  | 'error'
  | 'fuente_no_disponible';

/** Resultado de la actualización puntual de la ficha de un proceso. */
export interface ResultadoActualizacionPuntual {
  ok: boolean;
  modo: 'actualizacion_puntual';
  subModo?: 'completar_datos';
  estado: EstadoActualizacionPuntual;
  procesoId?: number;
  externalId?: string | null;
  operacionesExternas: { detalle: number; perfiles: number; apiGeneral: number };
  paginasConsultadas?: number;
  perfilConsultado?: string | null;
  duracionMs: number;
  camposActualizados: string[];
  linkDetalle?: string | null;
  cambioDetectado?: boolean;
  fechaVencimiento?: string | null;
  cronogramasActualizados?: number;
  documentosNuevos?: number;
  omitidoPorActualizacionReciente?: boolean;
  omitioRevalidacionLink?: boolean;
  motivoOmitirRevalidacion?: string;
  puedeCompletarDatos?: boolean;
  continuacionActualizacion?: string;
  continuacionExpiraEn?: string;
  noticeConfirmado?: string;
  solicitudesPropagadas?: number;
  retryAfterSegundos?: number;
  mensaje?: string;
  error?: string;
  actualizadoEn?: string;
}

export interface InputActualizacionPuntual {
  procesoId?: number | string | null;
  externalId?: string | null;
  codigoProceso?: string | null;
  entidad?: string | null;
  modo?: 'completar_datos';
  continuacionActualizacion?: string | null;
  usuarioId?: number | null;
}

export interface OpcionesActualizacionPuntual {
  forzar?: boolean;
  ventanaFrescuraMs?: number;
}

export interface DetallePublicoDocumento {
  nombre: string;
  href?: string;
}
export interface DetallePublicoEvento {
  evento: string;
  valor: string;
}
export interface DetallePublicoRaw {
  url: string;
  urlFinal?: string;
  titulo?: string;
  estado?: string;
  documentos: DetallePublicoDocumento[];
  cronograma: DetallePublicoEvento[];
  textoPlano?: string;
}

/** Resultado neutro de la adquisición de detalle público. */
export interface ResultadoDetallePublico {
  detalle: DetallePublicoRaw;
  persisted: unknown;
}
