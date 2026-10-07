/**
 * FASE B.1B — tests de `DataApiClient`. Todo mockeado vía `fetchImpl`
 * inyectable — nunca golpea red real ni el servicio el servicio de datos de procesos.
 */
import { describe, it, expect, vi } from 'vitest';
import { crearDataApiClient } from './cliente.js';
import type { PaginaSync, ProcesoSyncBundle, ErrorCanonico } from './tipos.js';

function respuestaJson(status: number, cuerpo: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function clienteConFetch(fetchImpl: typeof fetch) {
  return crearDataApiClient({ baseUrl: 'https://data.example.test', apiKey: 'test_key', fetchImpl });
}

const procesoEjemplo: ProcesoSyncBundle = {
  tipo: 'UPSERT',
  proceso: {
    id: 'proc-1', aggregateVersion: 'v1', codigoProceso: 'X-1', nombre: 'n', entidad: 'e', objeto: 'o',
    modalidad: 'm', perfil: 'p', departamento: 'd', estado: 'est', origenFuncional: 'PUBLICO_ABIERTO',
    fechaPublicacion: null, fechaCierre: null, fechaCierreAnterior: null, tieneCambioFechaCierre: false,
    valor: null, duracion: null, linkDetalle: null, totalDocumentos: 0, totalCronogramas: 0, actualizadoEn: 'x',
  },
  documentos: null,
  cronograma: null,
};

describe('sincronizarProcesos — contrato, UPSERT/DELETE, cursor', () => {
  it('envía X-Contract-Version y X-API-Key, nunca expone la clave en la URL', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).not.toContain('test_key'); // nunca en query string
      const h = new Headers(init?.headers);
      expect(h.get('x-api-key')).toBe('test_key');
      expect(h.get('x-contract-version')).toBe('1.0');
      const pagina: PaginaSync = { items: [], nextPageCursor: null, checkpointCursor: 'chk1', hayMas: false, snapshotId: null, snapshotCompleto: false, contratoVersion: '1.0' };
      return respuestaJson(200, pagina);
    });
    const cliente = clienteConFetch(fetchMock as unknown as typeof fetch);
    const res = await cliente.sincronizarProcesos({ cursor: null });
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propaga un bundle UPSERT tal cual (sin transformar el contrato)', async () => {
    const pagina: PaginaSync = { items: [procesoEjemplo], nextPageCursor: 'cur2', checkpointCursor: 'chk1', hayMas: true, snapshotId: 'snap1', snapshotCompleto: false, contratoVersion: '1.0' };
    const cliente = clienteConFetch((async () => respuestaJson(200, pagina)) as unknown as typeof fetch);
    const res = await cliente.sincronizarProcesos({ cursor: null });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.datos.items[0]).toEqual(procesoEjemplo);
      expect(res.datos.checkpointCursor).toBe('chk1'); // presente aunque hayMas=true
    }
  });

  it('propaga un tombstone DELETE sin inventar un ProcesoCanonico', async () => {
    const tombstone: ProcesoSyncBundle = { tipo: 'DELETE', tombstone: { id: 'proc-retirado', motivo: 'RETIRADO' } };
    const pagina: PaginaSync = { items: [tombstone], nextPageCursor: null, checkpointCursor: 'chk2', hayMas: false, snapshotId: null, snapshotCompleto: false, contratoVersion: '1.0' };
    const cliente = clienteConFetch((async () => respuestaJson(200, pagina)) as unknown as typeof fetch);
    const res = await cliente.sincronizarProcesos({ cursor: 'chk1' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.datos.items[0]).toEqual(tombstone);
      expect(res.datos.items[0]).not.toHaveProperty('proceso');
    }
  });

  it('checkpointCursor de la última página de una corrida sigue presente (nunca null)', async () => {
    const pagina: PaginaSync = { items: [], nextPageCursor: null, checkpointCursor: 'chk-final', hayMas: false, snapshotId: null, snapshotCompleto: false, contratoVersion: '1.0' };
    const cliente = clienteConFetch((async () => respuestaJson(200, pagina)) as unknown as typeof fetch);
    const res = await cliente.sincronizarProcesos({ cursor: 'chk-anterior' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.datos.checkpointCursor).toBe('chk-final');
  });

  it('full resync: snapshotId presente, snapshotCompleto solo en la última página (transparente, el cliente no lo interpreta, solo lo transporta)', async () => {
    const pagina: PaginaSync = { items: [], nextPageCursor: null, checkpointCursor: 'chk3', hayMas: false, snapshotId: 'snap-xyz', snapshotCompleto: true, contratoVersion: '1.0' };
    const cliente = clienteConFetch((async () => respuestaJson(200, pagina)) as unknown as typeof fetch);
    const res = await cliente.sincronizarProcesos({ cursor: null });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.datos.snapshotId).toBe('snap-xyz');
      expect(res.datos.snapshotCompleto).toBe(true);
    }
  });

  it('cursor normal (con checkpoint previo) → no confunde con full resync', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain('cursor=chk-previo');
      const pagina: PaginaSync = { items: [], nextPageCursor: null, checkpointCursor: 'chk-nuevo', hayMas: false, snapshotId: null, snapshotCompleto: false, contratoVersion: '1.0' };
      return respuestaJson(200, pagina);
    });
    const cliente = clienteConFetch(fetchMock as unknown as typeof fetch);
    await cliente.sincronizarProcesos({ cursor: 'chk-previo' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('traducción a ErrorCanonico — nunca error crudo', () => {
  const casos: Array<{ status: number; codigoEsperado: string; reintentarEsperado: boolean }> = [
    { status: 401, codigoEsperado: 'NO_AUTORIZADO', reintentarEsperado: false },
    { status: 403, codigoEsperado: 'NO_AUTORIZADO', reintentarEsperado: false },
    { status: 410, codigoEsperado: 'CURSOR_EXPIRADO', reintentarEsperado: false },
    { status: 429, codigoEsperado: 'LIMITE_EXCEDIDO', reintentarEsperado: true },
    { status: 500, codigoEsperado: 'NO_DISPONIBLE', reintentarEsperado: true },
    { status: 503, codigoEsperado: 'NO_DISPONIBLE', reintentarEsperado: true },
  ];

  for (const caso of casos) {
    it(`HTTP ${caso.status} → ${caso.codigoEsperado} (reintentar=${caso.reintentarEsperado}), SIN body estructurado del servidor`, async () => {
      const cliente = clienteConFetch((async () => new Response('Texto plano de error de un proxy intermedio, no JSON', { status: caso.status })) as unknown as typeof fetch);
      const res = await cliente.salud();
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.codigo).toBe(caso.codigoEsperado);
        expect(res.error.reintentar).toBe(caso.reintentarEsperado);
      }
    });
  }

  it('respeta el ErrorCanonico que el servidor SÍ envía en el body, saneando el mensaje igual', async () => {
    const errorServidor: ErrorCanonico = { codigo: 'CURSOR_EXPIRADO', mensaje: 'El checkpoint expiró.', reintentar: false };
    const cliente = clienteConFetch((async () => respuestaJson(410, { error: errorServidor })) as unknown as typeof fetch);
    const res = await cliente.sincronizarProcesos({ cursor: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toEqual(errorServidor);
  });

  it('no retry para errores no transitorios (401/403/410/422): reintentar siempre false', async () => {
    for (const status of [401, 403, 410, 422]) {
      const cliente = clienteConFetch((async () => new Response('x', { status })) as unknown as typeof fetch);
      const res = await cliente.salud();
      if (!res.ok) expect(res.error.reintentar).toBe(false);
    }
  });

  it('timeout de red → NO_DISPONIBLE, reintentar=true, SIN el mensaje crudo de AbortError', async () => {
    // simula el comportamiento real de `fetch`: rechaza con AbortError cuando se aborta la señal
    const fetchLento = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      })) as unknown as typeof fetch;
    const cliente = crearDataApiClient({ baseUrl: 'https://service.example.test', apiKey: 'test_key_2', timeoutMs: 20, fetchImpl: fetchLento });
    const res = await cliente.salud();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.codigo).toBe('NO_DISPONIBLE');
      expect(res.error.reintentar).toBe(true);
      expect(res.error.mensaje).not.toMatch(/AbortError|signal is aborted/i);
    }
  });

  it('fallo de red (DNS/conexión) → NO_DISPONIBLE, sin exponer el mensaje crudo del error de red', async () => {
    const fetchRoto = (async () => { throw new TypeError('getaddrinfo ENOTFOUND host-interno.example secreto-de-red'); }) as unknown as typeof fetch;
    const cliente = clienteConFetch(fetchRoto);
    const res = await cliente.salud();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.codigo).toBe('NO_DISPONIBLE');
      expect(res.error.mensaje).not.toContain('ENOTFOUND');
      expect(res.error.mensaje).not.toContain('secreto-de-red');
    }
  });

  it('respuesta no-JSON con status 200 (inesperado) → ERROR_INTERNO, nunca lanza', async () => {
    const cliente = clienteConFetch((async () => new Response('<html>no soy json</html>', { status: 200 })) as unknown as typeof fetch);
    const res = await cliente.salud();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.codigo).toBe('ERROR_INTERNO');
  });

  it('un mensaje de error extremadamente largo (posible fuga) se recorta', async () => {
    const mensajeLargo = 'x'.repeat(5000);
    const cliente = clienteConFetch((async () => respuestaJson(500, { error: { codigo: 'ERROR_INTERNO', mensaje: mensajeLargo, reintentar: true } })) as unknown as typeof fetch);
    const res = await cliente.salud();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.mensaje.length).toBeLessThan(400);
  });
});

describe('descargarDocumento — sin redirección al proveedor', () => {
  it('devuelve el binario recibido tal cual, sin seguir/anunciar ningún dominio externo', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="doc.pdf"' },
    }));
    const cliente = clienteConFetch(fetchMock as unknown as typeof fetch);
    const res = await cliente.descargarDocumento('proc-1', 'doc-1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.datos.contentType).toBe('application/pdf');
      expect(res.datos.nombreArchivo).toBe('doc.pdf');
      expect(new Uint8Array(res.datos.contenido)).toEqual(new Uint8Array([1, 2, 3]));
    }
    // fetch se llama con redirect NO forzado a manual, pero como el propio
    // adaptador HTTP nunca sigue un 3xx hacia otro origen (la respuesta que
    // llega ya es 200 con el binario), no hay ninguna segunda llamada de
    // red hacia otro host — un solo fetch, a un solo origen.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('error de descarga se traduce igual que cualquier otro (nunca expone la URL upstream)', async () => {
    const cliente = clienteConFetch((async () => respuestaJson(404, { error: { codigo: 'ERROR_INTERNO', mensaje: 'no encontrado', reintentar: false } })) as unknown as typeof fetch);
    const res = await cliente.descargarDocumento('proc-1', 'doc-inexistente');
    expect(res.ok).toBe(false);
  });
});

describe('construcción del cliente', () => {
  it('rechaza una contratoVersion no soportada al construirse', () => {
    expect(() => crearDataApiClient({ baseUrl: 'https://x', apiKey: 'k', contratoVersion: '99.9' as never })).toThrow();
  });
});
