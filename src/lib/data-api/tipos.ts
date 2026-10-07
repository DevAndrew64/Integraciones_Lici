/**
 * Contrato canónico consumido por `DataApiClient`.
 *
 * Define la estructura intercambiada con el servicio de datos de procesos.
 * Ningún tipo aquí puede nombrar ni implicar una fuente técnica concreta;
 * ver `contrato-guardrail.test.ts`.
 */

export const CONTRATO_VERSION_ACTUAL = '1.0';
export const CONTRATO_VERSIONES_SOPORTADAS = ['1.0'] as const;
export type ContratoVersion = (typeof CONTRATO_VERSIONES_SOPORTADAS)[number];

export type OrigenFuncional = 'MANUAL' | 'PUBLICO_ABIERTO' | 'PUBLICO_REGISTRADO' | 'PRIVADO' | 'DESCONOCIDO';

export interface ProcesoCanonico {
  id: string;
  aggregateVersion: string;
  codigoProceso: string | null;
  nombre: string | null;
  entidad: string | null;
  objeto: string | null;
  modalidad: string | null;
  perfil: string | null;
  departamento: string | null;
  estado: string | null;
  origenFuncional: OrigenFuncional;
  fechaPublicacion: string | null;
  fechaCierre: string | null;
  fechaCierreAnterior: string | null;
  tieneCambioFechaCierre: boolean;
  valor: number | null;
  duracion: string | null;
  linkDetalle: string | null;
  totalDocumentos: number;
  totalCronogramas: number;
  actualizadoEn: string;
}

export interface DocumentoCanonico {
  procesoId: string;
  docId: string;
  nombre: string;
  tipoDocumento: 'base' | 'adenda' | 'MODIFICACION' | 'DOCUMENTO_NUEVO' | 'OTRO';
  extension: string | null;
  detectadoEn: string;
}

export interface EventoCronogramaCanonico {
  procesoId: string;
  evento: string;
  fecha: string | null;
  fechaResuelta: string | null;
  esCierre: boolean;
  cambioDetectado: boolean;
  valorAnterior: string | null;
  orden: number;
}

export interface TombstoneMinimo {
  id: string;
  motivo?: 'RETIRADO' | 'FUERA_DE_ALCANCE' | 'DESCONOCIDO';
}

export type ProcesoSyncBundle =
  | { tipo: 'UPSERT'; proceso: ProcesoCanonico; documentos: DocumentoCanonico[] | null; cronograma: EventoCronogramaCanonico[] | null }
  | { tipo: 'DELETE'; tombstone: TombstoneMinimo };

export interface PaginaSync {
  items: ProcesoSyncBundle[];
  nextPageCursor: string | null;
  checkpointCursor: string;
  hayMas: boolean;
  snapshotId: string | null;
  snapshotCompleto: boolean;
  contratoVersion: ContratoVersion;
}

/**
 * Estado local de sincronización que se persiste. `checkpointIncremental` y un
 * full resync en curso son estados DISTINTOS — un snapshot incompleto nunca
 * sobreescribe el checkpoint incremental definitivo.
 */
export interface CheckpointIncremental {
  cursor: string;
  actualizadoEn: string;
}
export interface EstadoFullResyncTransitorio {
  snapshotId: string;
  nextPageCursor: string | null;
  iniciadoEn: string;
}

export type CodigoErrorCanonico =
  | 'NO_AUTORIZADO'
  | 'CURSOR_EXPIRADO'
  | 'LIMITE_EXCEDIDO'
  | 'NO_DISPONIBLE'
  | 'ERROR_INTERNO'
  | 'VERSION_NO_SOPORTADA';

export interface ErrorCanonico {
  codigo: CodigoErrorCanonico;
  mensaje: string;
  reintentar: boolean;
}

export type Resultado<T> = { ok: true; datos: T } | { ok: false; error: ErrorCanonico };

export interface RespuestaActualizar { bundle: ProcesoSyncBundle }
export interface RespuestaResolverLink { linkDetalle: string | null; resuelto: boolean }
export interface RespuestaSalud { ok: boolean; ultimaSincronizacionDisponibleEn: string | null; contratoVersion: ContratoVersion }
export interface RespuestaDocumento { contenido: ArrayBuffer; contentType: string; nombreArchivo: string }
