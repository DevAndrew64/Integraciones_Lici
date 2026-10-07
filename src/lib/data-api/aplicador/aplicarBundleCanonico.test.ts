/**
 * FASE B.4.5 — `aplicarBundleCanonico`: aplicación de UN bundle (actualización
 * puntual de ficha) + side effects funcionales trasladados desde legacy.
 * Prisma FAKE en memoria — nunca una conexión real.
 */
import { describe, it, expect } from 'vitest';
import { aplicarBundleCanonico, aplicarPaginaCanonica } from './aplicarPaginaCanonica.js';
import { FakePrismaAplicador } from './fakePrismaAplicador.test-helper.js';
import type { ProcesoCanonico, ProcesoSyncBundle, PaginaSync, DocumentoCanonico, EventoCronogramaCanonico } from '../tipos.js';

function proceso(over: Partial<ProcesoCanonico> = {}): ProcesoCanonico {
  return {
    id: 'uuid-1',
    aggregateVersion: 'v1',
    codigoProceso: 'CO-1',
    nombre: 'P',
    entidad: 'E',
    objeto: 'O',
    modalidad: 'M',
    perfil: 'PUBLICO',
    departamento: 'D',
    estado: 'ABIERTO',
    origenFuncional: 'PUBLICO_ABIERTO',
    fechaPublicacion: '2026-01-01T00:00:00.000Z',
    fechaCierre: '2026-02-01T00:00:00.000Z',
    fechaCierreAnterior: null,
    tieneCambioFechaCierre: false,
    valor: 1000,
    duracion: '30d',
    linkDetalle: 'https://x/y',
    totalDocumentos: 0,
    totalCronogramas: 0,
    actualizadoEn: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}
const bundleUpsert = (
  p: ProcesoCanonico = proceso(),
  documentos: DocumentoCanonico[] | null = null,
  cronograma: EventoCronogramaCanonico[] | null = null,
): ProcesoSyncBundle => ({ tipo: 'UPSERT', proceso: p, documentos, cronograma });
function paginaIncremental(items: ProcesoSyncBundle[]): PaginaSync {
  return { items, nextPageCursor: 'n', checkpointCursor: 'ck-incremental', hayMas: false, snapshotId: null, snapshotCompleto: false, contratoVersion: '1.0' };
}

describe('aplicarBundleCanonico — NUNCA toca DataApiSyncState', () => {
  it('un bundle puntual no crea ni modifica el estado de sincronización', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarSyncState({ checkpointCursor: 'ck-previo', fullResyncSnapshotId: null });
    const antes = JSON.stringify(prisma.syncState);

    await aplicarBundleCanonico(bundleUpsert(), { prisma });

    expect(JSON.stringify(prisma.syncState)).toBe(antes); // idéntico: cursor/full-resync intactos
    expect(prisma.syncState?.checkpointCursor).toBe('ck-previo');
  });

  it('sin estado previo, tampoco lo crea (queda null)', async () => {
    const prisma = new FakePrismaAplicador();
    await aplicarBundleCanonico(bundleUpsert(), { prisma });
    expect(prisma.syncState).toBeNull();
  });

  it('EN CONTRASTE: el sync PAGINADO sí avanza el checkpoint incremental', async () => {
    const prisma = new FakePrismaAplicador();
    await aplicarPaginaCanonica(paginaIncremental([bundleUpsert()]), { prisma });
    expect(prisma.syncState?.checkpointCursor).toBe('ck-incremental');
  });
});

describe('aplicarBundleCanonico — transacción e idempotencia', () => {
  it('reaplicar el mismo bundle no duplica proceso, documentos ni notificaciones', async () => {
    const prisma = new FakePrismaAplicador();
    const b = bundleUpsert(proceso(), [{ procesoId: 'uuid-1', docId: 'd1', nombre: 'A.pdf', tipoDocumento: 'base', extension: 'pdf', detectadoEn: '2026-01-02T00:00:00.000Z' }], null);
    await aplicarBundleCanonico(b, { prisma });
    await aplicarBundleCanonico(b, { prisma });
    expect(prisma.procesos).toHaveLength(1);
    expect(prisma.documentos).toHaveLength(1);
    expect(prisma.notificaciones.filter((n) => n.claveIdempotencia?.startsWith('documento_nuevo:'))).toHaveLength(1);
  });

  it('si el aplicador lanza a mitad, revierte todo (rollback lógico)', async () => {
    const prisma = new FakePrismaAplicador();
    const original = prisma.procesoCronogramaSecop.createMany;
    prisma.procesoCronogramaSecop.createMany = async () => {
      throw new Error('fallo simulado');
    };
    await expect(
      aplicarBundleCanonico(bundleUpsert(proceso(), null, [{ procesoId: 'uuid-1', evento: 'x', fecha: null, fechaResuelta: null, esCierre: false, cambioDetectado: false, valorAnterior: null, orden: 1 }]), { prisma }),
    ).rejects.toThrow('fallo simulado');
    prisma.procesoCronogramaSecop.createMany = original;
    expect(prisma.procesos).toHaveLength(0); // el UPSERT del proceso se revirtió
    expect(prisma.notificaciones).toHaveLength(0);
  });
});

describe('aplicarBundleCanonico — notificaciones de cambio (paridad legacy)', () => {
  it('cambio_estado: solo cuando estado viejo≠nuevo y ambos no-nulos, y solo en UPDATE', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'uuid-1', estadoFuente: 'ABIERTO', valor: 1000 });
    await aplicarBundleCanonico(bundleUpsert(proceso({ estado: 'CERRADO' })), { prisma });
    const n = prisma.notificaciones.filter((x) => (x as unknown as { tipo: string }).tipo === 'cambio_estado');
    expect(n).toHaveLength(1);
    expect(n[0].claveIdempotencia).toBe('cambio_estado:uuid-1:CERRADO');
  });

  it('cambio_estado NO se emite para un proceso NUEVO (solo proceso_nuevo)', async () => {
    const prisma = new FakePrismaAplicador();
    await aplicarBundleCanonico(bundleUpsert(proceso({ estado: 'ABIERTO' })), { prisma });
    expect(prisma.notificaciones.map((n) => (n as unknown as { tipo: string }).tipo)).toEqual(['proceso_nuevo']);
  });

  it('cambio_valor: viejo≠nuevo y nuevo no-nulo', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'uuid-1', estadoFuente: 'ABIERTO', valor: 1000 });
    await aplicarBundleCanonico(bundleUpsert(proceso({ valor: 2000 })), { prisma });
    expect(prisma.notificaciones.some((n) => n.claveIdempotencia === 'cambio_valor:uuid-1:2000')).toBe(true);
  });

  it('cambio_valor NO se emite si el valor nuevo es null', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'uuid-1', estadoFuente: 'ABIERTO', valor: 1000 });
    await aplicarBundleCanonico(bundleUpsert(proceso({ valor: null })), { prisma });
    expect(prisma.notificaciones.some((n) => n.claveIdempotencia?.startsWith('cambio_valor:'))).toBe(false);
  });

  it('cambio_fecha_cierre: comparación applier-side `existente.fechaVencimiento` vs `proceso.fechaCierre` (paridad legacy, NO depende del flag canónico)', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'uuid-1', estadoFuente: 'ABIERTO', valor: 1000, fechaVencimiento: new Date('2026-02-01T00:00:00.000Z') });
    // El bundle NO trae `tieneCambioFechaCierre` (el motor lo emite false): la
    // detección la hace el aplicador comparando fechas.
    await aplicarBundleCanonico(bundleUpsert(proceso({ fechaCierre: '2026-03-01T00:00:00.000Z', tieneCambioFechaCierre: false })), { prisma });
    expect(prisma.notificaciones.some((n) => n.claveIdempotencia === 'cambio_fecha_cierre:uuid-1:2026-03-01T00:00:00.000Z')).toBe(true);
  });

  it('cambio_fecha_cierre NO se emite si la fecha vieja o la nueva es null, ni si son iguales', async () => {
    // vieja null
    let prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'uuid-1', estadoFuente: 'ABIERTO', valor: 1000, fechaVencimiento: null });
    await aplicarBundleCanonico(bundleUpsert(proceso({ fechaCierre: '2026-03-01T00:00:00.000Z' })), { prisma });
    expect(prisma.notificaciones.some((n) => n.claveIdempotencia?.startsWith('cambio_fecha_cierre:'))).toBe(false);
    // iguales
    prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'uuid-1', estadoFuente: 'ABIERTO', valor: 1000, fechaVencimiento: new Date('2026-02-01T00:00:00.000Z') });
    await aplicarBundleCanonico(bundleUpsert(proceso({ fechaCierre: '2026-02-01T00:00:00.000Z' })), { prisma });
    expect(prisma.notificaciones.some((n) => n.claveIdempotencia?.startsWith('cambio_fecha_cierre:'))).toBe(false);
  });

  it('manifestacion_interes: una por etapa cuyo nombre matchea; idempotente', async () => {
    const prisma = new FakePrismaAplicador();
    const crono = [
      { procesoId: 'uuid-1', evento: 'Presentación de Manifestaciones de Interés', fecha: null, fechaResuelta: null, esCierre: false, cambioDetectado: false, valorAnterior: null, orden: 1 },
      { procesoId: 'uuid-1', evento: 'Cierre', fecha: null, fechaResuelta: null, esCierre: true, cambioDetectado: false, valorAnterior: null, orden: 2 },
    ];
    await aplicarBundleCanonico(bundleUpsert(proceso(), null, crono), { prisma });
    await aplicarBundleCanonico(bundleUpsert(proceso(), null, crono), { prisma });
    const n = prisma.notificaciones.filter((x) => (x as unknown as { tipo: string }).tipo === 'manifestacion_interes');
    expect(n).toHaveLength(1);
  });

  it('CERO tipos huérfanos: nunca emite `cronograma_cambio` ni `adenda`', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'uuid-1', estadoFuente: 'VIEJO', valor: 1 });
    prisma.procesos[0].fechaVencimiento = new Date('2026-01-01T00:00:00.000Z');
    await aplicarBundleCanonico(
      bundleUpsert(
        proceso({ estado: 'NUEVO', valor: 9, fechaCierre: '2026-05-01T00:00:00.000Z' }),
        [{ procesoId: 'uuid-1', docId: 'ad1', nombre: 'Adenda 1.pdf', tipoDocumento: 'adenda', extension: 'pdf', detectadoEn: '2026-01-02T00:00:00.000Z' }],
        [{ procesoId: 'uuid-1', evento: 'Cierre', fecha: null, fechaResuelta: null, esCierre: true, cambioDetectado: true, valorAnterior: '2026-01-01', orden: 1 }],
      ),
      { prisma },
    );
    const tipos = new Set(prisma.notificaciones.map((n) => (n as unknown as { tipo: string }).tipo));
    expect(tipos.has('cronograma_cambio')).toBe(false);
    expect(tipos.has('adenda')).toBe(false);
    // Vocabulario oficial:
    for (const t of tipos) {
      expect(['proceso_nuevo', 'documento_nuevo', 'cambio_estado', 'cambio_valor', 'cambio_fecha_cierre', 'cambio_cronograma', 'manifestacion_interes']).toContain(t);
    }
  });
});

describe('aplicarBundleCanonico — propagación Proceso → Solicitud (los 5 campos espejo)', () => {
  it('propaga estadoFuente + fechaVencimiento + linkDetalle; NO propaga linkSecop/linkSecopReg (gap de contrato documentado)', async () => {
    const prisma = new FakePrismaAplicador();
    const p = prisma.sembrarProceso({
      sourceKey: 'uuid-1', estadoFuente: 'ABIERTO', valor: 1000, externalId: null,
      fechaVencimiento: new Date('2026-02-01T00:00:00.000Z'),
    });
    prisma.sembrarSolicitud({
      procesoId: p.id, estadoFuente: 'ABIERTO',
      fechaVencimiento: new Date('2026-02-01T00:00:00.000Z'),
      linkDetalle: 'https://viejo', linkSecop: 'https://s-viejo', linkSecopReg: 'https://sr-viejo',
    });

    const res = await aplicarBundleCanonico(
      bundleUpsert(proceso({ estado: 'ADJUDICADO', linkDetalle: 'https://nuevo', fechaCierre: '2026-03-01T00:00:00.000Z' })),
      { prisma },
    );

    const s = prisma.solicitudes[0];
    expect(res.solicitudesPropagadas).toBe(1);
    // 1. estadoFuente — SÍ (cambió)
    expect(s.estadoFuente).toBe('ADJUDICADO');
    // 2. fechaVencimiento — SÍ (cambió la fecha de cierre)
    expect(s.fechaVencimiento?.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    // 3. linkDetalle — SÍ
    expect(s.linkDetalle).toBe('https://nuevo');
    // 4 y 5. linkSecop / linkSecopReg — NO cambian: `ProcesoCanonico` no los
    // expone (contrato). Legacy tampoco propagaba `linkSecop` nunca
    // (dataBase.linkSecop == null). `linkSecopReg` es una DIVERGENCIA
    // documentada (legacy sí lo propagaba desde el payload crudo).
    expect(s.linkSecop).toBe('https://s-viejo');       // intacto
    expect(s.linkSecopReg).toBe('https://sr-viejo');   // intacto
  });

  it('links cambian pero NO estado/fecha → legacy NO propagaba (disparo = solo estado o fecha) — sin cambio silencioso', async () => {
    const prisma = new FakePrismaAplicador();
    const p = prisma.sembrarProceso({
      sourceKey: 'uuid-1', estadoFuente: 'ABIERTO', valor: 1000,
      fechaVencimiento: new Date('2026-02-01T00:00:00.000Z'),
    });
    prisma.sembrarSolicitud({ procesoId: p.id, estadoFuente: 'ABIERTO', linkDetalle: 'https://viejo' });

    // Solo cambia linkDetalle; estado y fecha de cierre iguales.
    const res = await aplicarBundleCanonico(
      bundleUpsert(proceso({ linkDetalle: 'https://cambiado', estado: 'ABIERTO', fechaCierre: '2026-02-01T00:00:00.000Z' })),
      { prisma },
    );

    // Legacy: el bloque `solicitud.updateMany` SOLO corre si
    // `(dataBase.estadoFuente && estadoAnterior !== estadoNuevo) || hayCambioFechaCierre`.
    // Un cambio de link SIN cambio de estado/fecha NO dispara la propagación.
    expect(res.solicitudesPropagadas).toBe(0);
    expect(prisma.solicitudes[0].linkDetalle).toBe('https://viejo'); // Solicitud NO se toca
  });

  it('también vincula por externalId cuando el Proceso lo tiene', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'uuid-1', estadoFuente: 'ABIERTO', valor: 1000, externalId: 'EXT-9' });
    prisma.sembrarSolicitud({ procesoId: null, externalId: 'EXT-9', estadoFuente: 'ABIERTO' });

    const res = await aplicarBundleCanonico(bundleUpsert(proceso({ estado: 'CERRADO' })), { prisma });
    expect(res.solicitudesPropagadas).toBe(1);
    expect(prisma.solicitudes[0].estadoFuente).toBe('CERRADO');
  });

  it('NO propaga si no cambió estado ni fecha de cierre', async () => {
    const prisma = new FakePrismaAplicador();
    const p = prisma.sembrarProceso({ sourceKey: 'uuid-1', estadoFuente: 'ABIERTO', valor: 1000 });
    prisma.sembrarSolicitud({ procesoId: p.id, estadoFuente: 'ABIERTO' });
    const res = await aplicarBundleCanonico(bundleUpsert(proceso({ nombre: 'solo cambia el nombre' })), { prisma });
    expect(res.solicitudesPropagadas).toBe(0);
  });

  it('la propagación ocurre EN LA MISMA transacción (rollback la revierte)', async () => {
    const prisma = new FakePrismaAplicador();
    const p = prisma.sembrarProceso({ sourceKey: 'uuid-1', estadoFuente: 'ABIERTO', valor: 1000 });
    prisma.sembrarSolicitud({ procesoId: p.id, estadoFuente: 'ABIERTO' });
    const original = prisma.notificacion.create;
    prisma.notificacion.create = async () => { throw new Error('boom'); };
    await expect(aplicarBundleCanonico(bundleUpsert(proceso({ estado: 'CERRADO' })), { prisma })).rejects.toThrow('boom');
    prisma.notificacion.create = original;
    expect(prisma.solicitudes[0].estadoFuente).toBe('ABIERTO'); // sin cambios: revertido
  });
});
