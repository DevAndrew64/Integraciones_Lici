/**
 * FASE B.3 (licycolba-final) — Prisma FAKE en memoria, usado únicamente por
 * los tests de `aplicarPaginaCanonica`. Nunca abre ninguna conexión real.
 * `$transaction` simula atomicidad mediante snapshot/restore de las tablas
 * en memoria: si el callback lanza, el estado se revierte exactamente como
 * lo haría un ROLLBACK real.
 */
import type {
  PrismaLikeAplicador,
  ProcesoFilaAplicador,
  DocumentoFilaAplicador,
  CronogramaFilaAplicador,
  NotificacionFilaAplicador,
  SyncStateFilaAplicador,
} from './tiposPrisma.js';

const CLAVE_ESTADO = 'procesos';

/**
 * Evaluador de `where` que imita la LÓGICA TERNARIA real de Prisma/PostgreSQL
 * para el subconjunto de operadores que usan las consultas del aplicador
 * (`proceso.updateMany` en la reconciliación). Lo esencial que replica y que
 * antes el fake NO replicaba:
 *
 *  - `{ campo: { not: valor } }` compila a `campo <> valor`, que en SQL
 *    NUNCA matchea filas con `campo IS NULL`. El fake ahora también las
 *    excluye — por eso el aplicador añade explícitamente `{ campo: null }`
 *    en un `OR` cuando quiere incluir los NULL.
 *  - `{ campo: null }` es `IS NULL` (no `= NULL`).
 *  - `{ campo: { startsWith } }` sobre NULL es falso, no error.
 */
function coincideWhere(fila: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [clave, cond] of Object.entries(where)) {
    if (cond === undefined) continue;

    if (clave === 'OR') {
      const ramas = cond as Record<string, unknown>[];
      if (!ramas.some((r) => coincideWhere(fila, r))) return false;
      continue;
    }
    if (clave === 'AND') {
      const ramas = cond as Record<string, unknown>[];
      if (!ramas.every((r) => coincideWhere(fila, r))) return false;
      continue;
    }
    if (clave === 'NOT') {
      if (coincideWhere(fila, cond as Record<string, unknown>)) return false;
      continue;
    }

    const valor = fila[clave] ?? null;

    if (cond === null) {
      if (valor !== null) return false; // IS NULL
      continue;
    }
    if (typeof cond === 'object') {
      const op = cond as { not?: unknown; startsWith?: string };
      if ('not' in op) {
        if (op.not === null) {
          if (valor === null) return false; // IS NOT NULL
        } else if (valor === null || valor === op.not) {
          return false; // `<> valor` no incluye NULL
        }
      }
      if ('startsWith' in op && op.startsWith !== undefined) {
        if (typeof valor !== 'string' || !valor.startsWith(op.startsWith)) return false;
      }
      continue;
    }
    // Igualdad escalar simple (`campo: valor`): NULL nunca iguala a un valor.
    if (valor !== cond) return false;
  }
  return true;
}

/** Fila mínima de Solicitud para el fake (solo lo que toca la propagación). */
export interface SolicitudFilaFake {
  id: number;
  procesoId: number | null;
  externalId: string | null;
  estadoFuente: string | null;
  fechaVencimiento: Date | null;
  linkDetalle: string | null;
  linkSecop: string | null;
  linkSecopReg: string | null;
}

interface Tablas {
  procesos: ProcesoFilaAplicador[];
  documentos: DocumentoFilaAplicador[];
  cronogramas: CronogramaFilaAplicador[];
  notificaciones: NotificacionFilaAplicador[];
  solicitudes: SolicitudFilaFake[];
  /** Estado ÚNICO — 0 o 1 fila, siempre con clave='procesos'. Nunca una colección. */
  syncState: SyncStateFilaAplicador | null;
  siguienteId: { proceso: number; documento: number; notificacion: number; solicitud: number };
}

function clonar<T>(v: T): T {
  return JSON.parse(JSON.stringify(v), (_k, val) => {
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) return new Date(val);
    return val;
  });
}

export class FakePrismaAplicador implements PrismaLikeAplicador {
  private t: Tablas;

  constructor() {
    this.t = { procesos: [], documentos: [], cronogramas: [], notificaciones: [], solicitudes: [], syncState: null, siguienteId: { proceso: 1, documento: 1, notificacion: 1, solicitud: 1 } };
  }

  // Helpers de inspección para los tests (fuera de la interfaz PrismaLikeAplicador).
  get procesos() { return this.t.procesos; }
  get documentos() { return this.t.documentos; }
  get cronogramas() { return this.t.cronogramas; }
  get notificaciones() { return this.t.notificaciones; }
  get solicitudes() { return this.t.solicitudes; }
  get syncState() { return this.t.syncState; }

  /** Siembra una Solicitud vinculada (para probar la propagación de campos espejo). */
  sembrarSolicitud(fila: Partial<SolicitudFilaFake> & { id?: number }): SolicitudFilaFake {
    const completa: SolicitudFilaFake = {
      id: fila.id ?? this.t.siguienteId.solicitud++,
      procesoId: null,
      externalId: null,
      estadoFuente: null,
      fechaVencimiento: null,
      linkDetalle: null,
      linkSecop: null,
      linkSecopReg: null,
      ...fila,
    };
    this.t.solicitudes.push(completa);
    return completa;
  }

  /**
   * Inserta un proceso preexistente directamente (para preparar el estado
   * "antes" de un test). Default `disponibleDataApi: false` — espeja el
   * `@default(false)` real del schema: un proceso nunca tocado por la Data
   * API nunca aparece falsamente como "disponible en la Data API".
   */
  sembrarProceso(fila: Partial<ProcesoFilaAplicador> & { sourceKey: string }): ProcesoFilaAplicador {
    const completa: ProcesoFilaAplicador = {
      id: this.t.siguienteId.proceso++,
      disponibleDataApi: false,
      retiradoDataApiEn: null,
      ultimoSnapshotId: null,
      origenFuncional: null,
      oculto: false,
      hashContenido: null,
      codigoProceso: null,
      entidad: null,
      estadoFuente: null,
      valor: null,
      fechaVencimiento: null,
      externalId: null,
      linkDetalle: null,
      perfil: null,
      ...fila,
    };
    this.t.procesos.push(completa);
    return completa;
  }

  /** Siembra el estado transitorio/checkpoint directamente (para preparar escenarios de resync interrumpido/retomado). */
  sembrarSyncState(estado: Partial<SyncStateFilaAplicador>): void {
    this.t.syncState = {
      clave: CLAVE_ESTADO,
      checkpointCursor: null,
      checkpointActualizadoEn: null,
      fullResyncSnapshotId: null,
      fullResyncNextPageCursor: null,
      fullResyncIniciadoEn: null,
      ...estado,
    };
  }

  proceso = {
    findUnique: async ({ where }: { where: { sourceKey: string } }) =>
      this.t.procesos.find((p) => p.sourceKey === where.sourceKey) ?? null,
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      this.t.procesos.filter((p) => coincideWhere(p as unknown as Record<string, unknown>, where)),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const fila = { id: this.t.siguienteId.proceso++, ...data } as unknown as ProcesoFilaAplicador;
      this.t.procesos.push(fila);
      return fila;
    },
    update: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
      const idx = this.t.procesos.findIndex((p) => p.id === where.id);
      if (idx === -1) throw new Error('proceso no encontrado (fake)');
      this.t.procesos[idx] = { ...this.t.procesos[idx], ...data } as ProcesoFilaAplicador;
      return this.t.procesos[idx];
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (let i = 0; i < this.t.procesos.length; i++) {
        const p = this.t.procesos[i];
        if (coincideWhere(p as unknown as Record<string, unknown>, where)) {
          this.t.procesos[i] = { ...p, ...data } as ProcesoFilaAplicador;
          count++;
        }
      }
      return { count };
    },
  };

  procesoDocumentoSecop = {
    findMany: async ({ where }: { where: { procesoId: number } }) =>
      this.t.documentos.filter((d) => d.procesoId === where.procesoId),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const fila = { id: this.t.siguienteId.documento++, ...data } as unknown as DocumentoFilaAplicador;
      this.t.documentos.push(fila);
      return fila;
    },
  };

  procesoCronogramaSecop = {
    findMany: async ({ where }: { where: { procesoId: number } }) =>
      this.t.cronogramas.filter((c) => c.procesoId === where.procesoId),
    deleteMany: async ({ where }: { where: { procesoId: number } }) => {
      const antes = this.t.cronogramas.length;
      this.t.cronogramas = this.t.cronogramas.filter((c) => c.procesoId !== where.procesoId);
      return { count: antes - this.t.cronogramas.length };
    },
    createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
      for (const d of data) this.t.cronogramas.push(d as unknown as CronogramaFilaAplicador);
      return { count: data.length };
    },
  };

  notificacion = {
    findUnique: async ({ where }: { where: { claveIdempotencia: string } }) =>
      this.t.notificaciones.find((n) => n.claveIdempotencia === where.claveIdempotencia) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const fila = { id: this.t.siguienteId.notificacion++, ...data } as unknown as NotificacionFilaAplicador;
      this.t.notificaciones.push(fila);
      return fila;
    },
  };

  solicitud = {
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (let i = 0; i < this.t.solicitudes.length; i++) {
        const s = this.t.solicitudes[i];
        if (coincideWhere(s as unknown as Record<string, unknown>, where)) {
          this.t.solicitudes[i] = { ...s, ...data } as SolicitudFilaFake;
          count++;
        }
      }
      return { count };
    },
  };

  dataApiSyncState = {
    obtenerEstado: async () => this.t.syncState,
    upsertEstado: async ({ data }: { data: Record<string, unknown> }) => {
      const base: SyncStateFilaAplicador = this.t.syncState ?? {
        clave: CLAVE_ESTADO,
        checkpointCursor: null,
        checkpointActualizadoEn: null,
        fullResyncSnapshotId: null,
        fullResyncNextPageCursor: null,
        fullResyncIniciadoEn: null,
      };
      this.t.syncState = { ...base, ...data, clave: CLAVE_ESTADO };
      return this.t.syncState;
    },
  };

  async $transaction<T>(fn: (tx: PrismaLikeAplicador) => Promise<T>): Promise<T> {
    const respaldo = clonar(this.t);
    try {
      return await fn(this);
    } catch (err) {
      this.t = respaldo; // rollback lógico — idéntico efecto observable a un ROLLBACK real
      throw err;
    }
  }
}
