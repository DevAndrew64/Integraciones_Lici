/**
 * FASE B.3A — pruebas de `aplicarPaginaCanonica` contra un Prisma FAKE en
 * memoria (`FakePrismaAplicador`). NUNCA abre una conexión real — ni a
 * staging ni a producción. Cubre la lista mínima exigida para B.3A.
 */
import { describe, it, expect } from 'vitest';
import { aplicarPaginaCanonica } from './aplicarPaginaCanonica.js';
import { FakePrismaAplicador } from './fakePrismaAplicador.test-helper.js';
import type { PaginaSync, ProcesoCanonico, ProcesoSyncBundle } from '../tipos.js';

function proceso(overrides: Partial<ProcesoCanonico> = {}): ProcesoCanonico {
  return {
    id: 'proc-1',
    aggregateVersion: 'v1',
    codigoProceso: 'CO-001',
    nombre: 'Proceso de prueba',
    entidad: 'Entidad X',
    objeto: 'Objeto de prueba',
    modalidad: 'Licitación',
    perfil: 'PUBLICO',
    departamento: 'Atlántico',
    estado: 'ABIERTO',
    origenFuncional: 'PUBLICO_ABIERTO',
    fechaPublicacion: '2026-01-01T00:00:00.000Z',
    fechaCierre: '2026-02-01T00:00:00.000Z',
    fechaCierreAnterior: null,
    tieneCambioFechaCierre: false,
    valor: 1000,
    duracion: '30 días',
    linkDetalle: 'https://ejemplo.invalid/detalle',
    totalDocumentos: 0,
    totalCronogramas: 0,
    actualizadoEn: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function paginaUpsert(bundles: ProcesoSyncBundle[], overrides: Partial<PaginaSync> = {}): PaginaSync {
  return {
    items: bundles,
    nextPageCursor: null,
    checkpointCursor: 'checkpoint-1',
    hayMas: false,
    snapshotId: null,
    snapshotCompleto: false,
    contratoVersion: '1.0',
    ...overrides,
  };
}

describe('aplicarPaginaCanonica — UPSERT', () => {
  it('proceso nuevo: se crea, disponibleDataApi=true, y genera notificación proceso_nuevo', async () => {
    const prisma = new FakePrismaAplicador();
    const pagina = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso(), documentos: null, cronograma: null }]);

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.procesosCreados).toBe(1);
    expect(prisma.procesos[0].sourceKey).toBe('proc-1');
    expect(prisma.procesos[0].disponibleDataApi).toBe(true);
    expect(r.notificacionesCreadas).toBe(1);
    expect(prisma.notificaciones[0].claveIdempotencia).toBe('proceso_nuevo:proc-1');
  });

  it('proceso existente: se actualiza (no se duplica) y un cambio de solo metadatos NO genera notificación', async () => {
    const prisma = new FakePrismaAplicador();
    // Sembrado con estado/valor IGUALES a los del bundle → el UPDATE solo cambia
    // el nombre; ninguno de los disparadores de notificación (estado/valor/fecha/
    // cronograma) aplica.
    prisma.sembrarProceso({ sourceKey: 'proc-1', nombre: 'Nombre viejo', hashContenido: 'v0', estadoFuente: 'ABIERTO', valor: 1000 });
    const pagina = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso({ nombre: 'Nombre nuevo' }), documentos: null, cronograma: null }]);

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.procesosActualizados).toBe(1);
    expect(r.procesosCreados).toBe(0);
    expect(prisma.procesos).toHaveLength(1);
    expect(prisma.procesos[0].nombre).toBe('Nombre nuevo');
    expect(r.notificacionesCreadas).toBe(0);
  });

  it('la misma página aplicada dos veces es idempotente: segunda vez no crea proceso ni notificación duplicada', async () => {
    const prisma = new FakePrismaAplicador();
    const pagina = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso(), documentos: null, cronograma: null }]);

    await aplicarPaginaCanonica(pagina, { prisma });
    const r2 = await aplicarPaginaCanonica(pagina, { prisma });

    expect(prisma.procesos).toHaveLength(1);
    expect(r2.procesosCreados).toBe(0);
    expect(r2.procesosActualizados).toBe(1);
    expect(prisma.notificaciones).toHaveLength(1); // no se duplicó
  });

  it('reaparición: un proceso previamente retirado (disponibleDataApi=false) vuelve a true y limpia retiradoDataApiEn', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'proc-1', disponibleDataApi: false, retiradoDataApiEn: new Date('2026-01-01') });
    const pagina = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso(), documentos: null, cronograma: null }]);

    await aplicarPaginaCanonica(pagina, { prisma });

    expect(prisma.procesos[0].disponibleDataApi).toBe(true);
    expect(prisma.procesos[0].retiradoDataApiEn).toBeNull();
  });

  it('un proceso NUNCA visto por la Data API (sembrado con el default real, false) permanece false hasta que un UPSERT real lo toque', async () => {
    const prisma = new FakePrismaAplicador();
    const p = prisma.sembrarProceso({ sourceKey: 'proc-nunca-tocado' }); // default false, sin override
    expect(p.disponibleDataApi).toBe(false);

    // Aplicar una página que NO menciona a este proceso no debe alterarlo.
    const pagina = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso({ id: 'proc-otro' }), documentos: null, cronograma: null }]);
    await aplicarPaginaCanonica(pagina, { prisma });

    expect(prisma.procesos.find((x) => x.sourceKey === 'proc-nunca-tocado')!.disponibleDataApi).toBe(false);
  });

  it('MANUAL/local (sourceKey "local:...") nunca se convierte automáticamente en administrado por la Data API', async () => {
    const prisma = new FakePrismaAplicador();
    const manual = prisma.sembrarProceso({ sourceKey: 'local:manual-1' }); // default false
    expect(manual.disponibleDataApi).toBe(false);

    // Ninguna página normal de la Data API referencia jamás un sourceKey "local:" —
    // se confirma que ni siquiera una reconciliación de snapshot completo lo activa.
    const pagina = paginaUpsert(
      [{ tipo: 'UPSERT', proceso: proceso({ id: 'proc-1' }), documentos: null, cronograma: null }],
      { snapshotId: 'snap-x', snapshotCompleto: true },
    );
    await aplicarPaginaCanonica(pagina, { prisma });

    expect(prisma.procesos.find((x) => x.sourceKey === 'local:manual-1')!.disponibleDataApi).toBe(false);
  });

  it('oculto (decisión local) NUNCA es modificado por la Data API, ni al crear ni al actualizar', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'proc-1', oculto: true });
    const pagina = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso(), documentos: null, cronograma: null }]);

    await aplicarPaginaCanonica(pagina, { prisma });

    expect(prisma.procesos[0].oculto).toBe(true); // intacto
  });

  it('rawJson upstream nunca se escribe: ningún campo grabado contiene la palabra "rawJson" ni datos crudos del proveedor', async () => {
    const prisma = new FakePrismaAplicador();
    const pagina = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso(), documentos: null, cronograma: null }]);
    await aplicarPaginaCanonica(pagina, { prisma });
    for (const p of prisma.procesos) {
      expect(Object.keys(p)).not.toContain('rawJson');
      expect(Object.keys(p)).not.toContain('externalId');
    }
  });
});

describe('aplicarPaginaCanonica — UPSERT: fallback de identidad por codigoProceso+entidad', () => {
  it('sourceKey nuevo (Data API lo reasignó) pero mismo codigoProceso+entidad de un proceso ya sincronizado: actualiza esa fila en vez de duplicar', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({
      sourceKey: 'uuid-viejo-1',
      codigoProceso: 'CO-001',
      entidad: 'Entidad X',
      disponibleDataApi: true,
      origenFuncional: 'PUBLICO_ABIERTO',
      nombre: 'Nombre viejo',
    });
    const pagina = paginaUpsert([
      { tipo: 'UPSERT', proceso: proceso({ id: 'uuid-nuevo-2', nombre: 'Nombre actualizado' }), documentos: null, cronograma: null },
    ]);

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(prisma.procesos).toHaveLength(1); // NO se duplicó
    expect(r.procesosCreados).toBe(0);
    expect(r.procesosActualizados).toBe(1);
    expect(prisma.procesos[0].sourceKey).toBe('uuid-nuevo-2'); // convergió al sourceKey actual
    expect(prisma.procesos[0].nombre).toBe('Nombre actualizado');
  });

  it('dos procesos reales distintos comparten codigoProceso+entidad (ambiguo): NO se escribe nada, se omite y queda en detalleAmbiguos', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'uuid-a', codigoProceso: 'CMC-003-2026', entidad: 'Municipio X', disponibleDataApi: true, origenFuncional: 'PUBLICO_ABIERTO' });
    prisma.sembrarProceso({ sourceKey: 'uuid-b', codigoProceso: 'CMC-003-2026', entidad: 'Municipio X', disponibleDataApi: true, origenFuncional: 'PUBLICO_ABIERTO' });
    const pagina = paginaUpsert([
      { tipo: 'UPSERT', proceso: proceso({ id: 'uuid-c', codigoProceso: 'CMC-003-2026', entidad: 'Municipio X' }), documentos: null, cronograma: null },
    ]);

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.procesosCreados).toBe(0); // NO se crea una 3ª copia
    expect(r.procesosActualizados).toBe(0); // NO se elige uno de los 2 candidatos al azar para actualizar
    expect(prisma.procesos).toHaveLength(2); // sin cambios en la tabla
    expect(r.procesosAmbiguosOmitidos).toBe(1);
    expect(r.detalleAmbiguos).toEqual([{ codigoProceso: 'CMC-003-2026', entidad: 'Municipio X', candidatos: 2 }]);
  });

  it('caso ambiguo: no genera notificación "proceso_nuevo" ni ninguna otra (no hay fila a la que asociarlas)', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'uuid-a', codigoProceso: 'CO-AMB', entidad: 'Entidad Y', disponibleDataApi: true, origenFuncional: 'PUBLICO_ABIERTO' });
    prisma.sembrarProceso({ sourceKey: 'uuid-b', codigoProceso: 'CO-AMB', entidad: 'Entidad Y', disponibleDataApi: true, origenFuncional: 'PUBLICO_ABIERTO' });
    const pagina = paginaUpsert([
      {
        tipo: 'UPSERT',
        proceso: proceso({ id: 'uuid-c', codigoProceso: 'CO-AMB', entidad: 'Entidad Y' }),
        documentos: [{ procesoId: 'uuid-c', docId: 'd1', nombre: 'doc.pdf', tipoDocumento: 'base', extension: 'pdf', detectadoEn: '2026-01-01T00:00:00.000Z' }],
        cronograma: null,
      },
    ]);

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.notificacionesCreadas).toBe(0);
    expect(r.documentosCreados).toBe(0);
    expect(prisma.notificaciones).toHaveLength(0);
    expect(prisma.documentos).toHaveLength(0);
  });

  it('candidato con el mismo codigoProceso+entidad pero origenFuncional=MANUAL: se ignora, nunca se fusiona con un proceso registrado a mano', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({
      sourceKey: 'manual:xyz',
      codigoProceso: 'CO-001',
      entidad: 'Entidad X',
      disponibleDataApi: false,
      origenFuncional: 'MANUAL',
    });
    const pagina = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso({ id: 'uuid-nuevo' }), documentos: null, cronograma: null }]);

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.procesosCreados).toBe(1); // no tocó la fila MANUAL
    expect(prisma.procesos).toHaveLength(2);
    expect(prisma.procesos.find((p) => p.sourceKey === 'manual:xyz')!.origenFuncional).toBe('MANUAL'); // intacta
  });

  it('candidato con el mismo codigoProceso+entidad pero disponibleDataApi=false (retirado/nunca sincronizado): se ignora, no se fusiona', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({
      sourceKey: 'uuid-retirado',
      codigoProceso: 'CO-001',
      entidad: 'Entidad X',
      disponibleDataApi: false,
      origenFuncional: 'PUBLICO_ABIERTO',
    });
    const pagina = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso({ id: 'uuid-nuevo' }), documentos: null, cronograma: null }]);

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.procesosCreados).toBe(1);
    expect(prisma.procesos).toHaveLength(2);
  });

  it('sin codigoProceso o sin entidad en el bundle: no intenta el fallback, se comporta como antes (crea nuevo)', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'uuid-viejo', codigoProceso: null, entidad: 'Entidad X', disponibleDataApi: true, origenFuncional: 'PUBLICO_ABIERTO' });
    const pagina = paginaUpsert([
      { tipo: 'UPSERT', proceso: proceso({ id: 'uuid-nuevo', codigoProceso: null, entidad: 'Entidad X' }), documentos: null, cronograma: null },
    ]);

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.procesosCreados).toBe(1);
    expect(prisma.procesos).toHaveLength(2);
  });

  it('D15 — mismo codigoProceso+entidad pero de OTRO origen (SECOP I existente, bundle entrante SECOP II): NO se fusiona, se crea una fila aparte', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({
      sourceKey: 'uuid-s1',
      codigoProceso: 'CO-001',
      entidad: 'Entidad X',
      disponibleDataApi: true,
      origenFuncional: 'PUBLICO_REGISTRADO', // SECOP I
      linkDetalle: 'https://contratos.gov.co/consultas/detalle-s1',
    });
    const pagina = paginaUpsert([
      {
        tipo: 'UPSERT',
        proceso: proceso({ id: 'uuid-s2', origenFuncional: 'PUBLICO_ABIERTO', linkDetalle: 'https://community.secop.gov.co/detalle-s2' }), // SECOP II
        documentos: null,
        cronograma: null,
      },
    ]);

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.procesosCreados).toBe(1); // no lo confunde con el de SECOP I existente
    expect(r.procesosActualizados).toBe(0);
    expect(prisma.procesos).toHaveLength(2);
    const s1 = prisma.procesos.find((p) => p.sourceKey === 'uuid-s1')!;
    expect(s1.origenFuncional).toBe('PUBLICO_REGISTRADO'); // la fila SECOP I queda intacta
    expect(s1.linkDetalle).toBe('https://contratos.gov.co/consultas/detalle-s1');
    const s2 = prisma.procesos.find((p) => p.sourceKey === 'uuid-s2')!;
    expect(s2.origenFuncional).toBe('PUBLICO_ABIERTO');
  });

  it('D16 — el UPDATE conserva el linkDetalle existente cuando el bundle entrante lo trae null', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({
      sourceKey: 'proc-1',
      codigoProceso: 'CO-001',
      entidad: 'Entidad X',
      disponibleDataApi: true,
      origenFuncional: 'PUBLICO_ABIERTO',
      linkDetalle: 'https://ejemplo.invalid/link-ya-resuelto',
    });
    const pagina = paginaUpsert([
      { tipo: 'UPSERT', proceso: proceso({ linkDetalle: null }), documentos: null, cronograma: null },
    ]);

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.procesosActualizados).toBe(1);
    expect(prisma.procesos[0].linkDetalle).toBe('https://ejemplo.invalid/link-ya-resuelto'); // NO se borró
  });

  it('D15+D16 — cuando la fusión ocurre por fallback (sourceKey reasignado) y el bundle trae linkDetalle null, NO se conserva el link viejo (queda null para la resolución bajo demanda)', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({
      sourceKey: 'sourceKey-viejo',
      codigoProceso: 'CO-001',
      entidad: 'Entidad X',
      disponibleDataApi: true,
      origenFuncional: 'PUBLICO_ABIERTO',
      linkDetalle: 'https://ejemplo.invalid/link-atado-al-sourceKey-viejo',
    });
    const pagina = paginaUpsert([
      { tipo: 'UPSERT', proceso: proceso({ id: 'sourceKey-nuevo', linkDetalle: null }), documentos: null, cronograma: null },
    ]);

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.procesosActualizados).toBe(1);
    expect(prisma.procesos).toHaveLength(1);
    expect(prisma.procesos[0].sourceKey).toBe('sourceKey-nuevo'); // convergió al sourceKey nuevo
    expect(prisma.procesos[0].linkDetalle).toBeNull(); // NO conserva el link atado a la identidad anterior
  });

  it('D16 — el UPDATE sí reemplaza el linkDetalle cuando el bundle entrante trae uno nuevo', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({
      sourceKey: 'proc-1',
      codigoProceso: 'CO-001',
      entidad: 'Entidad X',
      disponibleDataApi: true,
      origenFuncional: 'PUBLICO_ABIERTO',
      linkDetalle: 'https://ejemplo.invalid/link-viejo',
    });
    const pagina = paginaUpsert([
      { tipo: 'UPSERT', proceso: proceso({ linkDetalle: 'https://ejemplo.invalid/link-nuevo' }), documentos: null, cronograma: null },
    ]);

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.procesosActualizados).toBe(1);
    expect(prisma.procesos[0].linkDetalle).toBe('https://ejemplo.invalid/link-nuevo');
  });

  // ── D17 — el perfil (empresa del grupo) asignado a mano sobrevive al sync.
  // Caso real: el servicio de datos emite `perfil: null` en TODOS los bundles,
  // así que el UPDATE de cada pasada (cada 5 min) borraba la clasificación que
  // el usuario acababa de poner.
  it('D17 — el UPDATE conserva el perfil asignado a mano cuando el bundle entrante lo trae null', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({
      sourceKey: 'proc-1',
      codigoProceso: 'CO-001',
      entidad: 'Entidad X',
      disponibleDataApi: true,
      origenFuncional: 'PUBLICO_ABIERTO',
      perfil: 'Aseocolba',
    });
    const pagina = paginaUpsert([
      { tipo: 'UPSERT', proceso: proceso({ perfil: null }), documentos: null, cronograma: null },
    ]);

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.procesosActualizados).toBe(1);
    expect(prisma.procesos[0].perfil).toBe('Aseocolba'); // NO se borró
  });

  it('D17 — un perfil entrante vacío tampoco borra el asignado (cadena vacía cuenta como ausencia)', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({
      sourceKey: 'proc-1',
      codigoProceso: 'CO-001',
      entidad: 'Entidad X',
      disponibleDataApi: true,
      origenFuncional: 'PUBLICO_ABIERTO',
      perfil: 'Vigicolba',
    });
    const pagina = paginaUpsert([
      { tipo: 'UPSERT', proceso: proceso({ perfil: '   ' }), documentos: null, cronograma: null },
    ]);

    await aplicarPaginaCanonica(pagina, { prisma });

    expect(prisma.procesos[0].perfil).toBe('Vigicolba');
  });

  it('D17 — el UPDATE sí toma el perfil del bundle cuando el servicio de datos SÍ lo envía', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({
      sourceKey: 'proc-1',
      codigoProceso: 'CO-001',
      entidad: 'Entidad X',
      disponibleDataApi: true,
      origenFuncional: 'PUBLICO_ABIERTO',
      perfil: null,
    });
    const pagina = paginaUpsert([
      { tipo: 'UPSERT', proceso: proceso({ perfil: 'Tempocolba' }), documentos: null, cronograma: null },
    ]);

    await aplicarPaginaCanonica(pagina, { prisma });

    expect(prisma.procesos[0].perfil).toBe('Tempocolba');
  });

  it('D17 — la fusión por fallback (sourceKey reasignado) conserva el perfil, a diferencia del linkDetalle', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({
      sourceKey: 'sourceKey-viejo',
      codigoProceso: 'CO-001',
      entidad: 'Entidad X',
      disponibleDataApi: true,
      origenFuncional: 'PUBLICO_ABIERTO',
      linkDetalle: 'https://ejemplo.invalid/link-atado-al-sourceKey-viejo',
      perfil: 'Aseocolba',
    });
    const pagina = paginaUpsert([
      { tipo: 'UPSERT', proceso: proceso({ id: 'sourceKey-nuevo', perfil: null, linkDetalle: null }), documentos: null, cronograma: null },
    ]);

    await aplicarPaginaCanonica(pagina, { prisma });

    expect(prisma.procesos).toHaveLength(1);
    expect(prisma.procesos[0].sourceKey).toBe('sourceKey-nuevo');
    expect(prisma.procesos[0].linkDetalle).toBeNull(); // atado a la identidad anterior — se suelta
    expect(prisma.procesos[0].perfil).toBe('Aseocolba'); // atado al proceso real — se conserva
  });
});

describe('aplicarPaginaCanonica — documentos', () => {
  it('documento nuevo se crea y genera notificación documento_nuevo', async () => {
    const prisma = new FakePrismaAplicador();
    const pagina = paginaUpsert([{
      tipo: 'UPSERT',
      proceso: proceso(),
      documentos: [{ procesoId: 'proc-1', docId: 'doc-1', nombre: 'Pliego.pdf', tipoDocumento: 'base', extension: 'pdf', detectadoEn: '2026-01-01T00:00:00.000Z' }],
      cronograma: null,
    }]);

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.documentosCreados).toBe(1);
    expect(prisma.documentos[0].dataApiDocId).toBe('doc-1');
    expect(r.notificacionesCreadas).toBe(2); // proceso_nuevo + documento_nuevo
  });

  it('documento repetido (mismo docId) no se duplica al reaplicar la página', async () => {
    const prisma = new FakePrismaAplicador();
    const doc = { procesoId: 'proc-1', docId: 'doc-1', nombre: 'Pliego.pdf', tipoDocumento: 'base' as const, extension: 'pdf', detectadoEn: '2026-01-01T00:00:00.000Z' };
    const pagina = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso(), documentos: [doc], cronograma: null }]);

    await aplicarPaginaCanonica(pagina, { prisma });
    await aplicarPaginaCanonica(pagina, { prisma });

    expect(prisma.documentos).toHaveLength(1);
  });

  it('B.4.5 — una adenda produce una notificación de tipo `documento_nuevo` (NO un tipo huérfano `adenda`)', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'proc-1', estadoFuente: 'ABIERTO', valor: 1000 });
    const pagina = paginaUpsert([{
      tipo: 'UPSERT',
      proceso: proceso(),
      documentos: [{ procesoId: 'proc-1', docId: 'doc-adenda', nombre: 'Adenda1.pdf', tipoDocumento: 'adenda', extension: 'pdf', detectadoEn: '2026-01-05T00:00:00.000Z' }],
      cronograma: null,
    }]);

    await aplicarPaginaCanonica(pagina, { prisma });

    const notif = prisma.notificaciones.find((n) => n.claveIdempotencia?.startsWith('documento_nuevo:'));
    expect(notif).toBeTruthy();
    expect((notif as unknown as { tipo: string }).tipo).toBe('documento_nuevo');
    // El vocabulario `adenda` (huérfano en la UI/APIs) NUNCA se emite.
    expect(prisma.notificaciones.some((n) => (n as unknown as { tipo: string }).tipo === 'adenda')).toBe(false);
  });
});

describe('aplicarPaginaCanonica — cronograma', () => {
  it('cronograma se reemplaza completo para el proceso', async () => {
    const prisma = new FakePrismaAplicador();
    const p = prisma.sembrarProceso({ sourceKey: 'proc-1' });
    prisma.cronogramas.push({ id: 1, procesoId: p.id, evento: 'viejo', valorTexto: '2026-01-01' });
    const pagina = paginaUpsert([{
      tipo: 'UPSERT',
      proceso: proceso(),
      documentos: null,
      cronograma: [{ procesoId: 'proc-1', evento: 'cierre', fecha: '2026-02-01T00:00:00.000Z', fechaResuelta: '2026-02-01T00:00:00.000Z', esCierre: true, cambioDetectado: false, valorAnterior: null, orden: 1 }],
    }]);

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.cronogramasReemplazados).toBe(1);
    expect(prisma.cronogramas.map((c) => c.evento)).toEqual(['cierre']);
  });

  it('B.4.5 — cambio de fecha en cronograma de un proceso EXISTENTE (diff applier-side) genera UNA `cambio_cronograma`, no duplicada al reaplicar', async () => {
    const prisma = new FakePrismaAplicador();
    // Proceso ya existente CON un cronograma persistido previo (fecha vieja) —
    // el diff applier-side compara este cronograma PERSISTIDO contra el nuevo.
    const p = prisma.sembrarProceso({ sourceKey: 'proc-1', estadoFuente: 'ABIERTO', valor: 1000 });
    prisma.cronogramas.push({ id: 1, procesoId: p.id, evento: 'cierre', valorTexto: '2026-02-01T00:00:00.000Z' });
    const eventoCambio = { procesoId: 'proc-1', evento: 'cierre', fecha: '2026-03-01T00:00:00.000Z', fechaResuelta: '2026-03-01T00:00:00.000Z', esCierre: true, cambioDetectado: false, valorAnterior: null, orden: 1 };
    const pagina = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso(), documentos: null, cronograma: [eventoCambio] }]);

    await aplicarPaginaCanonica(pagina, { prisma });
    const cambioCronograma = prisma.notificaciones.filter((n) => n.claveIdempotencia?.startsWith('cambio_cronograma:'));
    expect(cambioCronograma).toHaveLength(1);
    expect((cambioCronograma[0] as unknown as { tipo: string }).tipo).toBe('cambio_cronograma');

    const antes = prisma.notificaciones.length;
    await aplicarPaginaCanonica(pagina, { prisma });
    // reaplicar el MISMO bundle: el cronograma persistido ya coincide con el
    // entrante → el diff no encuentra cambios → no duplica.
    expect(prisma.notificaciones.length).toBe(antes);

    // NUNCA emite el tipo huérfano histórico `cronograma_cambio`.
    expect(prisma.notificaciones.some((n) => (n as unknown as { tipo: string }).tipo === 'cronograma_cambio')).toBe(false);
  });
});

describe('aplicarPaginaCanonica — DELETE / tombstone', () => {
  it('tombstone apaga disponibleDataApi y sella retiradoDataApiEn, sin borrar la fila', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'proc-1', disponibleDataApi: true });
    const pagina = paginaUpsert([{ tipo: 'DELETE', tombstone: { id: 'proc-1' } }]);

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.tombstonesAplicados).toBe(1);
    expect(prisma.procesos).toHaveLength(1); // nunca se borra
    expect(prisma.procesos[0].disponibleDataApi).toBe(false);
    expect(prisma.procesos[0].retiradoDataApiEn).not.toBeNull();
  });

  it('tombstone de un proceso inexistente localmente es no-op (no crea nada)', async () => {
    const prisma = new FakePrismaAplicador();
    const pagina = paginaUpsert([{ tipo: 'DELETE', tombstone: { id: 'proc-nunca-existio' } }]);

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.tombstonesAplicados).toBe(0);
    expect(prisma.procesos).toHaveLength(0);
  });
});

describe('aplicarPaginaCanonica — fallo a mitad de página', () => {
  it('si un paso falla, la transacción revierte todo y el checkpoint NO avanza', async () => {
    const prisma = new FakePrismaAplicador();
    // Se fuerza un fallo: procesoDocumentoSecop.create lanza en el segundo bundle.
    const original = prisma.procesoDocumentoSecop.create;
    let llamadas = 0;
    prisma.procesoDocumentoSecop.create = (async (...args: Parameters<typeof original>) => {
      llamadas++;
      if (llamadas === 1) throw new Error('fallo simulado a mitad de página');
      return original(...args);
    }) as typeof original;

    const pagina = paginaUpsert([
      { tipo: 'UPSERT', proceso: proceso({ id: 'proc-1' }), documentos: [{ procesoId: 'proc-1', docId: 'd1', nombre: 'x.pdf', tipoDocumento: 'base', extension: 'pdf', detectadoEn: '2026-01-01T00:00:00.000Z' }], cronograma: null },
    ]);

    await expect(aplicarPaginaCanonica(pagina, { prisma })).rejects.toThrow('fallo simulado');

    expect(prisma.procesos).toHaveLength(0); // el create del proceso también se revirtió
    expect(prisma.syncState).toBeNull(); // el checkpoint nunca se persistió
  });
});

describe('aplicarPaginaCanonica — full resync / snapshot', () => {
  it('full resync incompleto (snapshotCompleto=false) nunca retira procesos no vistos', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'proc-no-visto', disponibleDataApi: true, ultimoSnapshotId: 'snap-anterior' });
    const pagina = paginaUpsert(
      [{ tipo: 'UPSERT', proceso: proceso({ id: 'proc-1' }), documentos: null, cronograma: null }],
      { snapshotId: 'snap-nuevo', snapshotCompleto: false },
    );

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.reconciliacionEjecutada).toBe(false);
    const noVisto = prisma.procesos.find((p) => p.sourceKey === 'proc-no-visto')!;
    expect(noVisto.disponibleDataApi).toBe(true); // no se retiró
  });

  it('full resync completo (snapshotCompleto=true) reconcilia: retira lo no visto en el snapshot', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'proc-no-visto', disponibleDataApi: true, ultimoSnapshotId: 'snap-anterior' });
    const pagina = paginaUpsert(
      [{ tipo: 'UPSERT', proceso: proceso({ id: 'proc-1' }), documentos: null, cronograma: null }],
      { snapshotId: 'snap-nuevo', snapshotCompleto: true },
    );

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.reconciliacionEjecutada).toBe(true);
    expect(r.procesosRetiradosPorReconciliacion).toBe(1);
    const noVisto = prisma.procesos.find((p) => p.sourceKey === 'proc-no-visto')!;
    expect(noVisto.disponibleDataApi).toBe(false);
    // el proceso SÍ visto en este snapshot conserva disponibilidad
    const visto = prisma.procesos.find((p) => p.sourceKey === 'proc-1')!;
    expect(visto.disponibleDataApi).toBe(true);
  });

  it('MANUAL (sourceKey "local:...") queda excluido de la reconciliación aunque no aparezca en el snapshot', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'local:manual-1', disponibleDataApi: true, ultimoSnapshotId: null });
    const pagina = paginaUpsert(
      [{ tipo: 'UPSERT', proceso: proceso({ id: 'proc-1' }), documentos: null, cronograma: null }],
      { snapshotId: 'snap-nuevo', snapshotCompleto: true },
    );

    await aplicarPaginaCanonica(pagina, { prisma });

    const manual = prisma.procesos.find((p) => p.sourceKey === 'local:manual-1')!;
    expect(manual.disponibleDataApi).toBe(true); // nunca tocado
  });

  it('cada UPSERT dentro de un run con snapshotId marca ultimoSnapshotId aunque el contenido no cambie', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'proc-1', hashContenido: 'v1' });
    const pagina = paginaUpsert(
      [{ tipo: 'UPSERT', proceso: proceso({ aggregateVersion: 'v1' }), documentos: null, cronograma: null }],
      { snapshotId: 'snap-x', snapshotCompleto: false },
    );

    await aplicarPaginaCanonica(pagina, { prisma });

    expect(prisma.procesos[0].ultimoSnapshotId).toBe('snap-x');
  });
});

describe('aplicarPaginaCanonica — reconciliación: protección MANUAL y semántica nullable de Prisma', () => {
  // Un snapshot completo que NO menciona ninguno de los procesos sembrados,
  // para que la reconciliación los evalúe a todos.
  const paginaCierre = () =>
    paginaUpsert(
      [{ tipo: 'UPSERT', proceso: proceso({ id: 'proc-visto-en-snapshot' }), documentos: null, cronograma: null }],
      { snapshotId: 'snap-nuevo', snapshotCompleto: true },
    );

  it('origenFuncional=null (histórico sin clasificar) → SÍ se reconcilia', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'hist-null', origenFuncional: null, disponibleDataApi: true, ultimoSnapshotId: 'snap-viejo' });

    const r = await aplicarPaginaCanonica(paginaCierre(), { prisma });

    expect(r.procesosRetiradosPorReconciliacion).toBe(1);
    expect(prisma.procesos.find((p) => p.sourceKey === 'hist-null')!.disponibleDataApi).toBe(false);
  });

  it('origenFuncional=MANUAL (sourceKey SIN prefijo local:) → NUNCA se reconcilia', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'manual-migrado', origenFuncional: 'MANUAL', disponibleDataApi: true, ultimoSnapshotId: 'snap-viejo' });

    const r = await aplicarPaginaCanonica(paginaCierre(), { prisma });

    expect(r.procesosRetiradosPorReconciliacion).toBe(0);
    expect(prisma.procesos.find((p) => p.sourceKey === 'manual-migrado')!.disponibleDataApi).toBe(true);
  });

  it('sourceKey=local:* (origenFuncional sin poblar) → NUNCA se reconcilia (compatibilidad histórica)', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'local:manual-legacy', origenFuncional: null, disponibleDataApi: true, ultimoSnapshotId: 'snap-viejo' });

    const r = await aplicarPaginaCanonica(paginaCierre(), { prisma });

    expect(r.procesosRetiradosPorReconciliacion).toBe(0);
    expect(prisma.procesos.find((p) => p.sourceKey === 'local:manual-legacy')!.disponibleDataApi).toBe(true);
  });

  it('los tres a la vez: solo el histórico null se retira; MANUAL y local:* quedan intactos', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'hist-null', origenFuncional: null, disponibleDataApi: true, ultimoSnapshotId: 'snap-viejo' });
    prisma.sembrarProceso({ sourceKey: 'manual-migrado', origenFuncional: 'MANUAL', disponibleDataApi: true, ultimoSnapshotId: 'snap-viejo' });
    prisma.sembrarProceso({ sourceKey: 'local:manual-legacy', origenFuncional: null, disponibleDataApi: true, ultimoSnapshotId: 'snap-viejo' });

    const r = await aplicarPaginaCanonica(paginaCierre(), { prisma });

    expect(r.procesosRetiradosPorReconciliacion).toBe(1);
    expect(prisma.procesos.find((p) => p.sourceKey === 'hist-null')!.disponibleDataApi).toBe(false);
    expect(prisma.procesos.find((p) => p.sourceKey === 'manual-migrado')!.disponibleDataApi).toBe(true);
    expect(prisma.procesos.find((p) => p.sourceKey === 'local:manual-legacy')!.disponibleDataApi).toBe(true);
  });

  it('el fake imita la semántica real: { not: "MANUAL" } por sí solo NO matchearía los NULL (de ahí el OR explícito)', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'p-null', origenFuncional: null, disponibleDataApi: true, ultimoSnapshotId: 'snap-viejo' });
    // updateMany directo con SOLO { not: 'MANUAL' } — sin la rama OR { origenFuncional: null }.
    const { count } = await prisma.proceso.updateMany({
      where: { disponibleDataApi: true, origenFuncional: { not: 'MANUAL' } } as unknown as Record<string, unknown>,
      data: { disponibleDataApi: false },
    });
    expect(count).toBe(0); // el NULL quedó fuera, igual que en PostgreSQL
    expect(prisma.procesos.find((p) => p.sourceKey === 'p-null')!.disponibleDataApi).toBe(true);
  });
});

describe('aplicarPaginaCanonica — checkpoint (sync incremental normal)', () => {
  it('persiste el checkpointCursor de la página tras una aplicación exitosa', async () => {
    const prisma = new FakePrismaAplicador();
    const pagina = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso(), documentos: null, cronograma: null }], { checkpointCursor: 'cursor-abc' });

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(prisma.syncState!.checkpointCursor).toBe('cursor-abc');
    expect(r.checkpointDefinitivoPersistido).toBe('cursor-abc');
  });
});

describe('aplicarPaginaCanonica — semántica de checkpoint durante full resync (corregida)', () => {
  it('una página PARCIAL de full resync (snapshotCompleto=false) NUNCA toca el checkpointCursor definitivo', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarSyncState({ checkpointCursor: 'checkpoint-incremental-previo' });
    const pagina = paginaUpsert(
      [{ tipo: 'UPSERT', proceso: proceso({ id: 'proc-1' }), documentos: null, cronograma: null }],
      { checkpointCursor: 'cursor-parcial-de-resync', nextPageCursor: 'next-1', snapshotId: 'snap-x', snapshotCompleto: false },
    );

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(prisma.syncState!.checkpointCursor).toBe('checkpoint-incremental-previo'); // intacto
    expect(r.checkpointDefinitivoPersistido).toBeNull(); // no se promovió nada
    expect(r.estadoTransitorioActualizado).toBe(true);
    expect(prisma.syncState!.fullResyncSnapshotId).toBe('snap-x');
    expect(prisma.syncState!.fullResyncNextPageCursor).toBe('next-1');
    expect(prisma.syncState!.fullResyncIniciadoEn).not.toBeNull();
  });

  it('páginas sucesivas del MISMO full resync no reescriben fullResyncIniciadoEn (solo se fija en la primera)', async () => {
    const prisma = new FakePrismaAplicador();
    const pagina1 = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso({ id: 'proc-1' }), documentos: null, cronograma: null }], { snapshotId: 'snap-x', snapshotCompleto: false, nextPageCursor: 'next-1' });
    await aplicarPaginaCanonica(pagina1, { prisma });
    const iniciadoEnPrimeraPagina = prisma.syncState!.fullResyncIniciadoEn;

    const pagina2 = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso({ id: 'proc-2' }), documentos: null, cronograma: null }], { snapshotId: 'snap-x', snapshotCompleto: false, nextPageCursor: 'next-2' });
    await aplicarPaginaCanonica(pagina2, { prisma });

    expect(prisma.syncState!.fullResyncIniciadoEn).toEqual(iniciadoEnPrimeraPagina); // no se reescribió
    expect(prisma.syncState!.fullResyncNextPageCursor).toBe('next-2'); // pero el cursor sí avanza
  });

  it('un full resync interrumpido (nunca llega snapshotCompleto=true) deja el checkpoint incremental intacto para poder retomarse', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarSyncState({ checkpointCursor: 'checkpoint-antes-del-resync' });
    const pagina = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso({ id: 'proc-1' }), documentos: null, cronograma: null }], { snapshotId: 'snap-interrumpido', snapshotCompleto: false });

    await aplicarPaginaCanonica(pagina, { prisma });
    // ...aquí, en un escenario real, el proceso se interrumpe (crash/timeout) sin recibir más páginas...

    expect(prisma.syncState!.checkpointCursor).toBe('checkpoint-antes-del-resync'); // NUNCA se transformó en un checkpoint incremental válido
    expect(prisma.syncState!.fullResyncSnapshotId).toBe('snap-interrumpido'); // el estado transitorio permite retomar
  });

  it('al completar (snapshotCompleto=true) PROMUEVE el checkpointCursor y limpia el estado transitorio, todo junto', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarSyncState({ checkpointCursor: 'checkpoint-viejo', fullResyncSnapshotId: 'snap-x', fullResyncNextPageCursor: 'next-anterior', fullResyncIniciadoEn: new Date('2026-01-01T00:00:00.000Z') });
    const pagina = paginaUpsert(
      [{ tipo: 'UPSERT', proceso: proceso({ id: 'proc-1' }), documentos: null, cronograma: null }],
      { checkpointCursor: 'checkpoint-final-del-resync', snapshotId: 'snap-x', snapshotCompleto: true },
    );

    const r = await aplicarPaginaCanonica(pagina, { prisma });

    expect(r.checkpointDefinitivoPersistido).toBe('checkpoint-final-del-resync');
    expect(prisma.syncState!.checkpointCursor).toBe('checkpoint-final-del-resync');
    expect(prisma.syncState!.fullResyncSnapshotId).toBeNull();
    expect(prisma.syncState!.fullResyncNextPageCursor).toBeNull();
    expect(prisma.syncState!.fullResyncIniciadoEn).toBeNull();
  });

  it('si la página de cierre (snapshotCompleto=true) falla a mitad, ni la reconciliación ni la promoción del checkpoint se aplican', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarSyncState({ checkpointCursor: 'checkpoint-viejo', fullResyncSnapshotId: 'snap-x', fullResyncNextPageCursor: 'next-anterior', fullResyncIniciadoEn: new Date('2026-01-01T00:00:00.000Z') });
    prisma.sembrarProceso({ sourceKey: 'proc-no-visto', disponibleDataApi: true, ultimoSnapshotId: 'snap-anterior' });

    const original = prisma.proceso.create;
    prisma.proceso.create = (async () => { throw new Error('fallo simulado en la página de cierre'); }) as typeof original;

    const pagina = paginaUpsert(
      [{ tipo: 'UPSERT', proceso: proceso({ id: 'proc-nuevo' }), documentos: null, cronograma: null }],
      { checkpointCursor: 'checkpoint-final-del-resync', snapshotId: 'snap-x', snapshotCompleto: true },
    );

    await expect(aplicarPaginaCanonica(pagina, { prisma })).rejects.toThrow('fallo simulado en la página de cierre');

    // Nada se promovió ni se reconcilió — el resync sigue "en curso" según el estado persistido.
    expect(prisma.syncState!.checkpointCursor).toBe('checkpoint-viejo');
    expect(prisma.syncState!.fullResyncSnapshotId).toBe('snap-x');
    const noVisto = prisma.procesos.find((p) => p.sourceKey === 'proc-no-visto')!;
    expect(noVisto.disponibleDataApi).toBe(true); // no se retiró
  });
});

describe('aplicarPaginaCanonica — notificaciones enriquecidas (codigoProceso/entidad/descripcion)', () => {
  it('proceso_nuevo incluye codigoProceso/entidad/perfil y una descripcion legible (antes quedaban en null)', async () => {
    const prisma = new FakePrismaAplicador();
    const pagina = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso({ codigoProceso: 'CO-001', entidad: 'Entidad X', perfil: 'Aseocolba' }), documentos: null, cronograma: null }]);

    await aplicarPaginaCanonica(pagina, { prisma });

    const n = prisma.notificaciones[0] as unknown as { codigoProceso: string; entidad: string; perfil: string; descripcion: string };
    expect(n.codigoProceso).toBe('CO-001');
    expect(n.entidad).toBe('Entidad X');
    expect(n.perfil).toBe('Aseocolba');
    expect(n.descripcion).toContain('CO-001');
  });

  it('documento_nuevo: titulo y descripcion reproducen el patrón legacy ("Se publicó \\"<nombre>\\" en el proceso <codigo>")', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'proc-1', codigoProceso: 'CO-001', entidad: 'Entidad X' });
    const pagina = paginaUpsert([{
      tipo: 'UPSERT',
      proceso: proceso({ codigoProceso: 'CO-001', entidad: 'Entidad X' }),
      documentos: [{ procesoId: 'proc-1', docId: 'd1', nombre: 'Adenda 1.pdf', tipoDocumento: 'adenda', extension: 'pdf', detectadoEn: '2026-01-01T00:00:00.000Z' }],
      cronograma: null,
    }]);

    await aplicarPaginaCanonica(pagina, { prisma });

    const n = prisma.notificaciones.find((x) => (x as unknown as { tipo: string }).tipo === 'documento_nuevo') as unknown as { titulo: string; descripcion: string; codigoProceso: string; entidad: string };
    expect(n.descripcion).toBe('Se publicó "Adenda 1.pdf" en el proceso CO-001');
    expect(n.titulo).toContain('Entidad X');
    expect(n.codigoProceso).toBe('CO-001');
    expect(n.entidad).toBe('Entidad X');
  });

  it('cambio_estado: descripcion menciona el estado anterior y el nuevo, con codigoProceso/entidad poblados', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'proc-1', codigoProceso: 'CO-001', entidad: 'Entidad X', estadoFuente: 'Adjudicado', valor: 1000 });
    const pagina = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso({ codigoProceso: 'CO-001', entidad: 'Entidad X', estado: 'Liquidado' }), documentos: null, cronograma: null }]);

    await aplicarPaginaCanonica(pagina, { prisma });

    const n = prisma.notificaciones.find((x) => (x as unknown as { tipo: string }).tipo === 'cambio_estado') as unknown as { descripcion: string; codigoProceso: string; entidad: string };
    expect(n.descripcion).toBe('El proceso CO-001 cambió de "Adjudicado" a "Liquidado".');
    expect(n.codigoProceso).toBe('CO-001');
    expect(n.entidad).toBe('Entidad X');
  });

  it('cambio_valor: descripcion incluye el nuevo valor formateado, con codigoProceso poblado', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'proc-1', codigoProceso: 'CO-001', entidad: 'Entidad X', estadoFuente: 'ABIERTO', valor: 1000 });
    const pagina = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso({ codigoProceso: 'CO-001', entidad: 'Entidad X', valor: 5000000 }), documentos: null, cronograma: null }]);

    await aplicarPaginaCanonica(pagina, { prisma });

    const n = prisma.notificaciones.find((x) => (x as unknown as { tipo: string }).tipo === 'cambio_valor') as unknown as { descripcion: string; codigoProceso: string };
    expect(n.descripcion).toContain('CO-001');
    expect(n.descripcion).toContain('5.000.000');
    expect(n.codigoProceso).toBe('CO-001');
  });

  it('caso ambiguo sigue sin generar NINGUNA notificación (ni siquiera con el contexto enriquecido)', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'uuid-a', codigoProceso: 'CO-AMB', entidad: 'Entidad Y', disponibleDataApi: true, origenFuncional: 'PUBLICO_ABIERTO' });
    prisma.sembrarProceso({ sourceKey: 'uuid-b', codigoProceso: 'CO-AMB', entidad: 'Entidad Y', disponibleDataApi: true, origenFuncional: 'PUBLICO_ABIERTO' });
    const pagina = paginaUpsert([{ tipo: 'UPSERT', proceso: proceso({ id: 'uuid-c', codigoProceso: 'CO-AMB', entidad: 'Entidad Y' }), documentos: null, cronograma: null }]);

    await aplicarPaginaCanonica(pagina, { prisma });

    expect(prisma.notificaciones).toHaveLength(0);
  });
});
