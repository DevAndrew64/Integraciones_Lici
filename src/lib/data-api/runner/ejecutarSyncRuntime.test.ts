/**
 * FASE B.4.5 — pruebas de `ejecutarSyncRuntime`: orden guardrail-primero,
 * exclusión mutua por advisory lock, y bucle de aplicación. Todo con
 * dobles: NUNCA abre Postgres ni HTTP reales.
 */
import { describe, it, expect, vi } from 'vitest';
import { ejecutarSyncRuntime, LOCK_KEY_SYNC_RUNTIME } from './ejecutarSyncRuntime.js';
import { FakePrismaAplicador } from '../aplicador/fakePrismaAplicador.test-helper.js';
import type { ConsultaIdentidadDestino } from './guardrailDestinoProduccion.js';
import type { DataApiClient } from '../cliente.js';
import type { PaginaSync } from '../tipos.js';

const SID = '1000000000000000001';
const ENV_OK = {
  DATA_API_RUNTIME_DATABASE_URL: 'postgres://u:p@h:5432/d',
  DATA_API_RUNTIME_WRITE_ENABLED: 'true',
  DATA_API_RUNTIME_EXPECTED_SYSTEM_IDENTIFIER: SID,
} as unknown as NodeJS.ProcessEnv;

const identidadOk: ConsultaIdentidadDestino = { obtenerSystemIdentifier: async () => SID };

function pagina(over: Partial<PaginaSync> = {}): PaginaSync {
  return {
    items: [],
    nextPageCursor: null,
    checkpointCursor: 'ck',
    hayMas: false,
    snapshotId: null,
    snapshotCompleto: false,
    contratoVersion: '1.0',
    ...over,
  };
}

/** Pool falso: registra locks y releases. `locked` controla el try-lock. */
function poolFalso(locked = true) {
  const calls: string[] = [];
  let released = 0;
  const pool = {
    connect: async () => ({
      query: async (sql: string) => {
        calls.push(sql);
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked }] };
        return { rows: [] };
      },
      release: () => {
        released++;
      },
    }),
  };
  return { pool, calls, releasedCount: () => released };
}

function clienteConPaginas(paginas: PaginaSync[]): { cliente: DataApiClient; cursores: (string | null)[] } {
  const cursores: (string | null)[] = [];
  let i = 0;
  const cliente = {
    sincronizarProcesos: async ({ cursor }: { cursor: string | null }) => {
      cursores.push(cursor);
      const p = paginas[i];
      i++;
      if (!p) return { ok: true as const, datos: pagina({ hayMas: false, items: [] }) };
      return { ok: true as const, datos: p };
    },
  } as unknown as DataApiClient;
  return { cliente, cursores };
}

describe('ejecutarSyncRuntime — guardrail primero', () => {
  it('si el guardrail falla, NO se crea destino ni cliente', async () => {
    const crearDestino = vi.fn();
    const crearCliente = vi.fn();
    await expect(
      ejecutarSyncRuntime({
        env: { ...ENV_OK, DATA_API_RUNTIME_WRITE_ENABLED: 'false' } as NodeJS.ProcessEnv,
        consultaIdentidad: identidadOk,
        crearDestino: crearDestino as never,
        crearCliente: crearCliente as never,
      }),
    ).rejects.toThrow(/WRITE_ENABLED/);
    expect(crearDestino).not.toHaveBeenCalled();
    expect(crearCliente).not.toHaveBeenCalled();
  });

  it('system_identifier distinto del esperado → aborta antes de tocar el destino', async () => {
    const crearDestino = vi.fn();
    await expect(
      ejecutarSyncRuntime({
        env: ENV_OK,
        consultaIdentidad: { obtenerSystemIdentifier: async () => 'otro' },
        crearDestino: crearDestino as never,
        crearCliente: () => clienteConPaginas([]).cliente,
      }),
    ).rejects.toThrow();
    expect(crearDestino).not.toHaveBeenCalled();
  });
});

describe('ejecutarSyncRuntime — exclusión mutua (advisory lock)', () => {
  it('lock NO adquirido → no aplica ninguna página, no hace unlock, pero libera y cierra', async () => {
    const { pool, calls, releasedCount } = poolFalso(false);
    const aplicador = new FakePrismaAplicador();
    const cerrar = vi.fn(async () => {});
    const { cliente, cursores } = clienteConPaginas([pagina({ hayMas: true })]);

    const r = await ejecutarSyncRuntime({
      env: ENV_OK,
      consultaIdentidad: identidadOk,
      crearDestino: () => ({ aplicador, pool: pool as never, cerrar }),
      crearCliente: () => cliente,
    });

    expect(r.lockNoAdquirido).toBe(true);
    expect(r.paginasConsultadas).toBe(0);
    expect(cursores).toEqual([]); // nunca se pidió una página
    expect(calls.some((c) => c.includes('pg_try_advisory_lock'))).toBe(true);
    expect(calls.some((c) => c.includes('pg_advisory_unlock'))).toBe(false);
    expect(releasedCount()).toBe(1);
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it('lock adquirido → aplica páginas y SIEMPRE hace unlock + release + cierre', async () => {
    const { pool, calls, releasedCount } = poolFalso(true);
    const aplicador = new FakePrismaAplicador();
    const cerrar = vi.fn(async () => {});
    const { cliente } = clienteConPaginas([pagina({ hayMas: true }), pagina({ hayMas: false })]);

    const r = await ejecutarSyncRuntime({
      env: ENV_OK,
      consultaIdentidad: identidadOk,
      crearDestino: () => ({ aplicador, pool: pool as never, cerrar }),
      crearCliente: () => cliente,
    });

    expect(r.ok).toBe(true);
    expect(r.via).toBe('data-api');
    expect(r.paginasConsultadas).toBe(2);
    expect(calls.filter((c) => c.includes('pg_try_advisory_lock'))).toHaveLength(1);
    expect(calls.filter((c) => c.includes('pg_advisory_unlock'))).toHaveLength(1);
    expect(releasedCount()).toBe(1);
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it('la clave del lock es constante y estable', () => {
    expect(LOCK_KEY_SYNC_RUNTIME).toBe(8_440_545);
  });
});

describe('ejecutarSyncRuntime — cursor inicial', () => {
  it('forzarFullResync → primera página se pide con cursor null', async () => {
    const { pool } = poolFalso(true);
    const aplicador = new FakePrismaAplicador();
    // deja un checkpoint que, sin forzar, se usaría como cursor inicial
    await aplicador.dataApiSyncState.upsertEstado({ data: { checkpointCursor: 'ck-previo' } });
    const { cliente, cursores } = clienteConPaginas([pagina({ hayMas: false })]);

    await ejecutarSyncRuntime({
      env: ENV_OK,
      consultaIdentidad: identidadOk,
      crearDestino: () => ({ aplicador, pool: pool as never, cerrar: async () => {} }),
      crearCliente: () => cliente,
      forzarFullResync: true,
    });

    expect(cursores[0]).toBeNull();
  });

  it('sin forzar → primera página usa el checkpoint persistido', async () => {
    const { pool } = poolFalso(true);
    const aplicador = new FakePrismaAplicador();
    await aplicador.dataApiSyncState.upsertEstado({ data: { checkpointCursor: 'ck-previo' } });
    const { cliente, cursores } = clienteConPaginas([pagina({ hayMas: false })]);

    await ejecutarSyncRuntime({
      env: ENV_OK,
      consultaIdentidad: identidadOk,
      crearDestino: () => ({ aplicador, pool: pool as never, cerrar: async () => {} }),
      crearCliente: () => cliente,
    });

    expect(cursores[0]).toBe('ck-previo');
  });
});
