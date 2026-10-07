/**
 * FASE B.4.5 — `/api/procesos/nuevos` se lee de `Proceso` (antes de la
 * tabla-proyección `ProcesoNuevo`). Se verifica EQUIVALENCIA de comportamiento
 * visible: response shape, `fechaDeteccion = createdAt`, filtros
 * (fechaPublicacion/perfil/alias), orden, paginación, UNSPSC, exclusión de
 * MANUAL (C2.2-d: `origenFuncional='MANUAL'` primaria + prefijos
 * `local:`/`manual:` de compatibilidad — ver `whereExcluirManual()`), y que
 * NO se filtren tombstones ni las filas con `origenFuncional = NULL`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  proceso: { count: vi.fn(), findMany: vi.fn() },
  procesoNuevo: { count: vi.fn(), findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/session', () => ({ getSession: async () => ({ id: 1, rol: 'Analista' }) }));
vi.mock('@/lib/authz', () => ({ requireSession: () => null }));

import { GET } from './route';
import { NextRequest } from 'next/server';

const req = (qs = '') => new NextRequest(`http://localhost/api/procesos/nuevos${qs}`);

const filaProceso = (over: Record<string, unknown> = {}) => ({
  id: 7,
  sourceKey: 'uuid-7',
  codigoProceso: 'CO-7',
  nombre: 'Proc 7',
  entidad: 'Ent',
  objeto: 'Obj',
  fuente: 'F',
  aliasFuente: 'S2',
  modalidad: 'LP',
  perfil: 'aseocolba',
  departamento: 'Atlántico',
  estadoFuente: 'ABIERTO',
  fechaPublicacion: new Date('2026-05-01T00:00:00.000Z'),
  fechaVencimiento: new Date('2026-06-01T00:00:00.000Z'),
  valor: 5000,
  linkDetalle: 'https://d',
  linkSecop: 'https://s',
  linkSecopReg: 'https://sr',
  duracion: '2m',
  unspsc: null,
  origenFuncional: null as string | null,
  createdAt: new Date('2026-04-15T09:30:00.000Z'),
  ...over,
});

beforeEach(() => {
  prismaMock.proceso.count.mockReset().mockResolvedValue(1);
  prismaMock.proceso.findMany.mockReset().mockResolvedValue([filaProceso()]);
});

describe('/api/procesos/nuevos — equivalencia ProcesoNuevo → Proceso', () => {
  it('NO usa `procesoNuevo`; consulta `Proceso` con orden/paginación equivalentes', async () => {
    await GET(req('?filtro=semana&perfil=aseo&fuente=s2&page=2&limit=10'));

    expect(prismaMock.procesoNuevo.count).not.toHaveBeenCalled();
    expect(prismaMock.procesoNuevo.findMany).not.toHaveBeenCalled();

    const args = prismaMock.proceso.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ fechaPublicacion: 'desc' });
    expect(args.skip).toBe(10); // (page 2 - 1) * limit 10
    expect(args.take).toBe(10);
    expect(args.where).toMatchObject({
      perfil: { contains: 'aseo', mode: 'insensitive' },
      // D11 — ya NO filtra por aliasFuente a secas (excluía TODO proceso
      // Data API, que nunca escribe esa columna): aplica el mismo fallback
      // a origenFuncional que /procesos, /sin-gestionar y /gestionados.
      OR: [{ aliasFuente: { equals: 'S2' } }, { AND: [{ aliasFuente: null }, { origenFuncional: 'PUBLICO_REGISTRADO' }] }],
    });
    // C2.2-d: exclusión de MANUAL por origenFuncional (primaria) + ambos
    // prefijos local:/manual: (compatibilidad) — nunca solo por prefijo.
    // La última condición oculta los procesos que la Data API entrega sin
    // `codigoProceso` ni `nombre` (ver `proceso-identificable.ts`).
    expect(args.where.AND).toEqual([
      { OR: [{ origenFuncional: null }, { NOT: { origenFuncional: 'MANUAL' } }] },
      { NOT: { sourceKey: { startsWith: 'local:' } } },
      { NOT: { sourceKey: { startsWith: 'manual:' } } },
      {
        OR: [
          { AND: [{ codigoProceso: { not: null } }, { codigoProceso: { not: '' } }] },
          { AND: [{ nombre: { not: null } }, { nombre: { not: '' } }] },
        ],
      },
    ]);
    expect(args.where.fechaPublicacion).toHaveProperty('gte'); // ventana temporal
    // NO se filtra por disponibilidad; origenFuncional=NULL SÍ se incluye (no se excluye).
    expect(args.where).not.toHaveProperty('disponibleDataApi');
  });

  it('response shape idéntico: campos de `ProcesoNuevoItem` + fechaDeteccion = createdAt', async () => {
    const res = await GET(req('?filtro=rango&desde=2026-01-01'));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body).toMatchObject({ count: 1, total: 1, page: 1, totalPages: 1, stats: { count: 1, total: 1 } });
    const p = body.procesos[0];
    // claves exactas del contrato histórico
    expect(Object.keys(p).sort()).toEqual(
      [
        '_unspsc', 'aliasFuente', 'origenFuncional', 'codigoProceso', 'departamento', 'duracion', 'entidad',
        'estadoFuente', 'fechaDeteccion', 'fechaPublicacion', 'fechaVencimiento', 'fuente',
        'id', 'linkDetalle', 'linkSecop', 'linkSecopReg', 'modalidad', 'nombre', 'objeto',
        'perfil', 'procesoId', 'sourceKey', 'valor',
      ].sort(),
    );
    expect(p.id).toBe(7);
    expect(p.procesoId).toBe(7); // link a Proceso.id (lo que consume handleGestionar)
    expect(p.fechaDeteccion).toBe('2026-04-15T09:30:00.000Z'); // == createdAt
    expect(p.fechaPublicacion).toBe('2026-05-01T00:00:00.000Z');
    expect(p.valor).toBe(5000);
    expect(p.linkSecop).toBe('https://s');
  });

  it('filtro UNSPSC por perfil se preserva (oculta códigos no permitidos)', async () => {
    prismaMock.proceso.findMany.mockResolvedValue([
      filaProceso({ id: 1, perfil: 'aseocolba', unspsc: '76111500' }), // permitido aseocolba
      filaProceso({ id: 2, perfil: 'aseocolba', unspsc: '99999999' }), // NO permitido
    ]);
    prismaMock.proceso.count.mockResolvedValue(2);
    const body = await (await GET(req())).json();
    expect(body.procesos.map((x: { id: number }) => x.id)).toEqual([1]);
  });

  it('tombstones (disponibleDataApi=false) NO se excluyen — paridad con ProcesoNuevo histórico', async () => {
    await GET(req());
    const where = prismaMock.proceso.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('disponibleDataApi');
    expect(where).not.toHaveProperty('retiradoDataApiEn');
  });

  it('C2.2-d — un Proceso `manual:%` MIGRADO desde producción (origenFuncional=MANUAL) NUNCA aparece como "nuevo Data API", aunque el filtro por prefijo `local:%` solo no lo detectaría', async () => {
    // Aplica el where real (evaluado en JS, simulando lo que haría Postgres)
    // sobre un dataset mixto — reproduce exactamente la forma del where que
    // el route construye, para probar la exclusión de punta a punta.
    const dataset = [
      filaProceso({ id: 100, sourceKey: 'manual:legacy-migrado-1', origenFuncional: 'MANUAL' }), // migrado C2.2-c/d
      filaProceso({ id: 101, sourceKey: 'local:candidata-1', origenFuncional: 'MANUAL' }),        // manual nativo candidata
      filaProceso({ id: 102, sourceKey: 'local:sin-backfill', origenFuncional: null }),           // histórico sin origenFuncional
      filaProceso({ id: 103, sourceKey: 'uuid-real-secop', origenFuncional: 'PUBLICO_ABIERTO' }), // sync real → SÍ debe aparecer
    ];

    prismaMock.proceso.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      const condiciones = (where.AND ?? []) as Record<string, unknown>[];
      return dataset.filter((fila) =>
        condiciones.every((c) => {
          if ('OR' in c) {
            const or = c.OR as Record<string, unknown>[];
            return or.some((rama) =>
              'origenFuncional' in rama && rama.origenFuncional === null
                ? fila.origenFuncional === null
                : (fila.origenFuncional as string | null) !== 'MANUAL',
            );
          }
          if ('NOT' in c) {
            const not = c.NOT as { sourceKey?: { startsWith: string } };
            if (not.sourceKey) return !fila.sourceKey.startsWith(not.sourceKey.startsWith);
          }
          return true;
        }),
      );
    });
    prismaMock.proceso.count.mockResolvedValue(1);

    const body = await (await GET(req())).json();
    const ids = body.procesos.map((p: { id: number }) => p.id).sort();

    // El proceso `manual:%` migrado (100) y el `local:%` (101/102) quedan
    // fuera; solo el proceso realmente gestionado por Data API (103) aparece.
    expect(ids).toEqual([103]);
  });

  it('D11 — fuente=s2 SÍ incluye procesos Data API (aliasFuente=null, origenFuncional=PUBLICO_REGISTRADO), antes del fix quedaban excluidos', async () => {
    const dataset = [
      filaProceso({ id: 200, aliasFuente: null, origenFuncional: 'PUBLICO_REGISTRADO' }), // Data API, SECOP II real
      filaProceso({ id: 201, aliasFuente: null, origenFuncional: 'PUBLICO_ABIERTO' }),    // Data API, SECOP I real — NO debe salir
      filaProceso({ id: 202, aliasFuente: 'S2', origenFuncional: null }),                 // legacy SECOP II
      filaProceso({ id: 203, aliasFuente: null, origenFuncional: 'PRIVADO' }),            // Data API privado — NO debe salir
    ];

    prismaMock.proceso.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      const or = (where.OR ?? []) as Record<string, unknown>[];
      return dataset.filter((fila) =>
        or.some((rama) => {
          if ('equals' in ((rama as { aliasFuente?: { equals?: string } }).aliasFuente ?? {})) {
            return fila.aliasFuente === (rama as { aliasFuente: { equals: string } }).aliasFuente.equals;
          }
          if ('AND' in rama) {
            const and = rama.AND as Record<string, unknown>[];
            return and.every((c) =>
              'aliasFuente' in c ? fila.aliasFuente === null : fila.origenFuncional === (c as { origenFuncional: string }).origenFuncional,
            );
          }
          return false;
        }),
      );
    });
    prismaMock.proceso.count.mockResolvedValue(1);

    const body = await (await GET(req('?fuente=s2'))).json();
    const ids = body.procesos.map((p: { id: number }) => p.id).sort();

    expect(ids).toEqual([200, 202]);
  });
});
