/**
 * FASE B.4.5 · C2.2-b punto 2/4 — matriz de paridad EXACTA de `cambio_cronograma`
 * (Opción B: diff APPLIER-SIDE, decidida). Cubre tanto la función pura
 * `calcularCambioCronograma` (mapeoCanonico.ts) como el flujo end-to-end vía
 * `aplicarPaginaCanonica`/`aplicarBundleCanonico`.
 *
 * Reglas reproducidas de legacy (`sincronizarCronograma`, `procesos-sync.ts`),
 * SIN la "protección de fecha" (auditada y descartada — informe C2.2-b · punto 3):
 *   fechasModificadas = etapas en AMBOS (viejo y nuevo) cuya fecha-texto
 *                        normalizada difiere.
 *   eventosEliminados = etapas del viejo ausentes en el nuevo.
 *   notificar = fechasModificadas > 0 || eventosEliminados > 0.
 *   (una etapa añadida SOLA nunca notifica.)
 */
import { describe, it, expect } from 'vitest';
import { calcularCambioCronograma } from './mapeoCanonico.js';
import { aplicarPaginaCanonica, aplicarBundleCanonico } from './aplicarPaginaCanonica.js';
import { FakePrismaAplicador } from './fakePrismaAplicador.test-helper.js';
import type { ProcesoCanonico, ProcesoSyncBundle, PaginaSync, EventoCronogramaCanonico } from '../tipos.js';

// ─── función pura: la matriz de 7 casos ──────────────────────────────────────

const ev = (evento: string, valorTexto: string | null) => ({ evento, valorTexto });
const evN = (evento: string, fecha: string | null) => ({ evento, fecha });

describe('calcularCambioCronograma — matriz de paridad legacy (función pura)', () => {
  it('1. ningún cambio (mismo conjunto exacto) → NO notifica', () => {
    const viejo = [ev('Cierre', '2026-03-01'), ev('Apertura', '2026-01-01')];
    const nuevo = [evN('Cierre', '2026-03-01'), evN('Apertura', '2026-01-01')];
    expect(calcularCambioCronograma(viejo, nuevo).notificar).toBe(false);
  });

  it('2. solo cambio irrelevante (reorden + espacios/mayúsculas distintas) → mismo resultado que legacy (NO notifica)', () => {
    const viejo = [ev('Cierre', '2026-03-01'), ev('Apertura', '2026-01-01')];
    const nuevo = [evN('  APERTURA  ', '2026-01-01'), evN('cierre', '2026-03-01')]; // reordenado + case/espacios distintos
    const r = calcularCambioCronograma(viejo, nuevo);
    expect(r.notificar).toBe(false);
    expect(r.fechasModificadas).toBe(0);
    expect(r.eventosEliminados).toBe(0);
  });

  it('3. fecha modificada en etapa existente → SÍ notifica', () => {
    const viejo = [ev('Cierre', '2026-02-01')];
    const nuevo = [evN('Cierre', '2026-03-01')];
    const r = calcularCambioCronograma(viejo, nuevo);
    expect(r.notificar).toBe(true);
    expect(r.fechasModificadas).toBe(1);
    expect(r.eventosEliminados).toBe(0);
  });

  it('4. etapa eliminada (presente en viejo, ausente en nuevo) → SÍ notifica', () => {
    const viejo = [ev('Cierre', '2026-03-01'), ev('Audiencia', '2026-02-15')];
    const nuevo = [evN('Cierre', '2026-03-01')];
    const r = calcularCambioCronograma(viejo, nuevo);
    expect(r.notificar).toBe(true);
    expect(r.fechasModificadas).toBe(0);
    expect(r.eventosEliminados).toBe(1);
  });

  it('5. etapa AÑADIDA sola (presente en nuevo, ausente en viejo) → NO notifica (paridad exacta legacy)', () => {
    const viejo = [ev('Cierre', '2026-03-01')];
    const nuevo = [evN('Cierre', '2026-03-01'), evN('Adenda 1', '2026-02-20')];
    const r = calcularCambioCronograma(viejo, nuevo);
    expect(r.notificar).toBe(false);
    expect(r.fechasModificadas).toBe(0);
    expect(r.eventosEliminados).toBe(0);
  });

  it('6. múltiples cambios simultáneos (fecha modificada + etapa eliminada + etapa añadida) → notificar=true (la clave del aplicador garantiza máx. 1 notificación)', () => {
    const viejo = [ev('Cierre', '2026-02-01'), ev('Audiencia', '2026-02-15')];
    const nuevo = [evN('Cierre', '2026-03-01'), evN('Adenda 1', '2026-02-20')]; // Cierre modificado, Audiencia eliminada, Adenda añadida
    const r = calcularCambioCronograma(viejo, nuevo);
    expect(r.notificar).toBe(true);
    expect(r.fechasModificadas).toBe(1);
    expect(r.eventosEliminados).toBe(1);
  });

  it('cronograma vacío en ambos lados → NO notifica', () => {
    expect(calcularCambioCronograma([], []).notificar).toBe(false);
  });
});

// ─── flujo end-to-end: orden de lectura + idempotencia + rollback ───────────

function proceso(over: Partial<ProcesoCanonico> = {}): ProcesoCanonico {
  return {
    id: 'uuid-1', aggregateVersion: 'v1', codigoProceso: 'CO-1', nombre: 'P', entidad: 'E', objeto: 'O',
    modalidad: 'M', perfil: 'PUBLICO', departamento: 'D', estado: 'ABIERTO', origenFuncional: 'PUBLICO_ABIERTO',
    fechaPublicacion: '2026-01-01T00:00:00.000Z', fechaCierre: '2026-02-01T00:00:00.000Z', fechaCierreAnterior: null,
    tieneCambioFechaCierre: false, valor: 1000, duracion: '30d', linkDetalle: 'https://x/y',
    totalDocumentos: 0, totalCronogramas: 0, actualizadoEn: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}
const bundleUpsert = (p: ProcesoCanonico, cronograma: EventoCronogramaCanonico[] | null): ProcesoSyncBundle => ({
  tipo: 'UPSERT', proceso: p, documentos: null, cronograma,
});
function paginaIncremental(items: ProcesoSyncBundle[]): PaginaSync {
  return { items, nextPageCursor: 'n', checkpointCursor: 'ck', hayMas: false, snapshotId: null, snapshotCompleto: false, contratoVersion: '1.0' };
}
const eventoCanonico = (evento: string, fecha: string): EventoCronogramaCanonico => ({
  procesoId: 'uuid-1', evento, fecha, fechaResuelta: fecha, esCierre: false, cambioDetectado: false, valorAnterior: null, orden: 1,
});

describe('cambio_cronograma — end-to-end (aplicarBundleCanonico)', () => {
  it('7. reaplicar el MISMO bundle dos veces → 0 duplicados (el cronograma persistido ya coincide en la 2ª pasada)', async () => {
    const prisma = new FakePrismaAplicador();
    prisma.sembrarProceso({ sourceKey: 'uuid-1', estadoFuente: 'ABIERTO', valor: 1000 });
    prisma.cronogramas.push({ id: 1, procesoId: 1, evento: 'Cierre', valorTexto: '2026-02-01T00:00:00.000Z' });
    const bundle = bundleUpsert(proceso(), [eventoCanonico('Cierre', '2026-03-01T00:00:00.000Z')]);

    await aplicarBundleCanonico(bundle, { prisma });
    const primeraPasada = prisma.notificaciones.filter((n) => n.claveIdempotencia?.startsWith('cambio_cronograma:'));
    expect(primeraPasada).toHaveLength(1);

    await aplicarBundleCanonico(bundle, { prisma }); // MISMO bundle otra vez
    const segundaPasada = prisma.notificaciones.filter((n) => n.claveIdempotencia?.startsWith('cambio_cronograma:'));
    expect(segundaPasada).toHaveLength(1); // sin duplicar
  });

  it('8. la comparación se ejecuta ANTES de reemplazar el cronograma — probado por el caso "etapa eliminada": si el orden fuera al revés, el viejo ya estaría borrado y no habría eliminados que detectar', async () => {
    const prisma = new FakePrismaAplicador();
    const p = prisma.sembrarProceso({ sourceKey: 'uuid-1', estadoFuente: 'ABIERTO', valor: 1000 });
    prisma.cronogramas.push(
      { id: 1, procesoId: p.id, evento: 'Cierre', valorTexto: '2026-02-01T00:00:00.000Z' },
      { id: 2, procesoId: p.id, evento: 'Audiencia', valorTexto: '2026-01-15T00:00:00.000Z' },
    );
    // El bundle entrante SOLO trae "Cierre" (misma fecha) — "Audiencia" fue eliminada.
    const bundle = bundleUpsert(proceso(), [eventoCanonico('Cierre', '2026-02-01T00:00:00.000Z')]);

    const res = await aplicarBundleCanonico(bundle, { prisma });

    expect(res.notificacionesCreadas).toBe(1); // si el orden fuese incorrecto, sería 0
    expect(prisma.notificaciones.some((n) => (n as unknown as { tipo: string }).tipo === 'cambio_cronograma')).toBe(true);
    // y el reemplazo sí ocurrió: solo queda "Cierre" en la tabla.
    expect(prisma.cronogramas.filter((c) => c.procesoId === p.id).map((c) => c.evento)).toEqual(['Cierre']);
  });

  it('9. si algo falla a mitad, el rollback revierte TANTO el reemplazo de cronograma como la notificación', async () => {
    const prisma = new FakePrismaAplicador();
    const p = prisma.sembrarProceso({ sourceKey: 'uuid-1', estadoFuente: 'ABIERTO', valor: 1000 });
    prisma.cronogramas.push({ id: 1, procesoId: p.id, evento: 'Cierre', valorTexto: '2026-02-01T00:00:00.000Z' });
    const bundle = bundleUpsert(proceso(), [eventoCanonico('Cierre', '2026-03-01T00:00:00.000Z')]);

    const originalCreate = prisma.notificacion.create;
    prisma.notificacion.create = async () => { throw new Error('boom'); };
    await expect(aplicarBundleCanonico(bundle, { prisma })).rejects.toThrow('boom');
    prisma.notificacion.create = originalCreate;

    // rollback: el cronograma viejo sigue intacto (deleteMany+createMany revertidos)
    // (el fake serializa/clona el estado en el rollback — compara por valor, no por tipo exacto)
    const cronogramasProceso = prisma.cronogramas.filter((c) => c.procesoId === p.id);
    expect(cronogramasProceso).toHaveLength(1);
    expect(cronogramasProceso[0].evento).toBe('Cierre');
    const valorTexto: unknown = cronogramasProceso[0].valorTexto;
    const comoIso = valorTexto instanceof Date ? valorTexto.toISOString() : String(valorTexto);
    expect(comoIso).toBe('2026-02-01T00:00:00.000Z');
    expect(prisma.notificaciones).toHaveLength(0);
  });

  it('un proceso NUEVO (sin cronograma previo) nunca dispara cambio_cronograma, solo proceso_nuevo', async () => {
    const prisma = new FakePrismaAplicador();
    const pagina = paginaIncremental([bundleUpsert(proceso(), [eventoCanonico('Cierre', '2026-03-01T00:00:00.000Z')])]);
    await aplicarPaginaCanonica(pagina, { prisma });
    expect(prisma.notificaciones.map((n) => (n as unknown as { tipo: string }).tipo)).toEqual(['proceso_nuevo']);
  });
});
