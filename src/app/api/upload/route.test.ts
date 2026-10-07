/**
 * Ajuste "NO EXPONER ERRORES INTERNOS DE UPLOADTHING AL USUARIO" —
 * /api/upload nunca debe reenviar al cliente el mensaje interno del SDK de
 * UploadThing (p.ej. "Invalid token. A token is a base64 encoded JSON
 * object matching {...}", causado por `UPLOADTHING_TOKEN` ausente/inválido
 * en el servidor) ni cualquier otra excepción cruda — solo un mensaje
 * público genérico. El detalle real se registra únicamente con
 * `console.error` (nunca se le pide a estos tests verificar el CONTENIDO
 * de esos logs — solo que no lleguen al cliente).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/session', () => ({
  getSession: async () => ({ id: 1, email: 'admin@grupocolba.com', rol: 'admin', exp: 9999999999, sv: 1, usuario: 'admin.qa' }),
}));

const uploadFilesMock = vi.fn();
vi.mock('uploadthing/server', () => ({
  UTApi: class {
    uploadFiles(...args: unknown[]) {
      return uploadFilesMock(...args);
    }
  },
}));

function mkReqConArchivo(nombreArchivo = 'soporte.png'): NextRequest {
  const fd = new FormData();
  fd.append('file', new File([new Uint8Array([1, 2, 3])], nombreArchivo, { type: 'image/png' }));
  fd.append('contexto', 'rechazo');
  fd.append('solicitudId', '10');
  return new Request('http://x', { method: 'POST', body: fd }) as unknown as NextRequest;
}

function mkReqSinArchivo(): NextRequest {
  const fd = new FormData();
  return new Request('http://x', { method: 'POST', body: fd }) as unknown as NextRequest;
}

const MENSAJE_PUBLICO = 'No fue posible cargar el archivo en este momento. Intenta nuevamente o contacta al administrador.';

beforeEach(() => {
  uploadFilesMock.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('POST /api/upload', () => {
  it('1) sube exitosamente y devuelve url/key/name', async () => {
    uploadFilesMock.mockResolvedValue({ data: { ufsUrl: 'https://ufs.example/x', key: 'k1', name: 'soporte.png' }, error: null });
    const { POST } = await import('./route');
    const res = await POST(mkReqConArchivo());
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toEqual({ ok: true, url: 'https://ufs.example/x', key: 'k1', name: 'soporte.png' });
  });

  it('2) token ausente ("Missing token...") — nunca se reenvía el mensaje del SDK, responde 503 con mensaje genérico', async () => {
    uploadFilesMock.mockResolvedValue({
      data: null,
      error: { message: 'Missing token. Please set the `UPLOADTHING_TOKEN` environment variable or provide a token manually through config.' },
    });
    const { POST } = await import('./route');
    const res = await POST(mkReqConArchivo());
    const data = await res.json();
    expect(res.status).toBe(503);
    expect(data.ok).toBe(false);
    expect(data.error).toBe(MENSAJE_PUBLICO);
    expect(data.error).not.toContain('UPLOADTHING_TOKEN');
    expect(data.error).not.toContain('token');
  });

  it('3) token inválido ("Invalid token...", el caso real reportado) — nunca se reenvía el detalle de formato del SDK, responde 503 con mensaje genérico', async () => {
    uploadFilesMock.mockResolvedValue({
      data: null,
      error: { message: 'Invalid token. A token is a base64 encoded JSON object matching { apiKey: string, appId: string, regions: string[] }.' },
    });
    const { POST } = await import('./route');
    const res = await POST(mkReqConArchivo());
    const data = await res.json();
    expect(res.status).toBe(503);
    expect(data.ok).toBe(false);
    expect(data.error).toBe(MENSAJE_PUBLICO);
    expect(data.error).not.toContain('apiKey');
    expect(data.error).not.toContain('base64');
  });

  it('4) uploadFiles() lanza una excepción cruda (nunca capturada como response.error) — responde 500 con mensaje genérico, nunca String(e)', async () => {
    uploadFilesMock.mockRejectedValue(new Error('ECONNRESET: detalle interno de red que nunca debe llegar al cliente'));
    const { POST } = await import('./route');
    const res = await POST(mkReqConArchivo());
    const data = await res.json();
    expect(res.status).toBe(500);
    expect(data.ok).toBe(false);
    expect(data.error).toBe(MENSAJE_PUBLICO);
    expect(data.error).not.toContain('ECONNRESET');
  });

  it('5) archivo inválido/ausente — 400 "No file", nunca llega a invocar uploadFiles()', async () => {
    const { POST } = await import('./route');
    const res = await POST(mkReqSinArchivo());
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data).toEqual({ ok: false, error: 'No file' });
    expect(uploadFilesMock).not.toHaveBeenCalled();
  });

  it('6) ningún camino de error expone el mensaje técnico interno de UploadThing al cliente', async () => {
    const casos = [
      { data: null, error: { message: 'Missing token. Please set the `UPLOADTHING_TOKEN` environment variable or provide a token manually through config.' } },
      { data: null, error: { message: 'Invalid token. A token is a base64 encoded JSON object matching { apiKey: string, appId: string, regions: string[] }.' } },
    ];
    for (const caso of casos) {
      uploadFilesMock.mockReset();
      uploadFilesMock.mockResolvedValue(caso);
      const { POST } = await import('./route');
      const res = await POST(mkReqConArchivo());
      const data = await res.json();
      expect(data.error).toBe(MENSAJE_PUBLICO);
      expect(data.error).not.toBe(caso.error.message);
    }
  });
});
