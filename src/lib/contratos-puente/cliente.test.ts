import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enviarAlPuente, type PayloadContratosV1 } from './cliente';

const payload: PayloadContratosV1 = {
  version: 1,
  origen: { solicitudId: 7, procesoCodigo: 'SED-LP-2026-0091' },
  cliente: { razonSocial: 'Cliente de prueba', nit: '900123456', direccion: null },
  contrato: { objeto: 'Aseo', porcentajeAIU: 12.32, valorMensual: 5000000, plazoMeses: 12 },
};

// Puente simulado con un servidor HTTP real: se prueba el `fetch`, los encabezados, el cuerpo y el tiempo de espera.
let servidor: http.Server;
let url: string;
let ultimaPeticion: { auth: string | undefined; tipo: string | undefined; cuerpo: unknown } | null = null;
let comportamiento: (res: http.ServerResponse) => void = () => {};

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      ultimaPeticion = { auth: req.headers.authorization, tipo: req.headers['content-type'], cuerpo: datos ? JSON.parse(datos) : null };
      comportamiento(res);
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));

const responder = (estado: number, cuerpo: unknown) => (res: http.ServerResponse) => {
  res.writeHead(estado, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
};
const entorno = () => ({ PUENTE_CONTRATOS_URL: `${url}/`, PUENTE_CONTRATOS_TOKEN: 'token-de-prueba-0123456789' });

describe('enviarAlPuente', () => {
  it('sin URL o sin token la integración está apagada y no hace ninguna petición', async () => {
    ultimaPeticion = null;
    expect(await enviarAlPuente(payload, {})).toEqual({ ok: false, tipo: 'NO_CONFIGURADO' });
    expect(await enviarAlPuente(payload, { PUENTE_CONTRATOS_URL: url })).toEqual({ ok: false, tipo: 'NO_CONFIGURADO' });
    expect(await enviarAlPuente(payload, { PUENTE_CONTRATOS_TOKEN: 'x'.repeat(20) })).toEqual({ ok: false, tipo: 'NO_CONFIGURADO' });
    expect(ultimaPeticion).toBeNull();
  });

  it('envía el JSON con el token y devuelve modo, huella y advertencias', async () => {
    comportamiento = responder(200, { ok: true, modo: 'dry-run', huella: 'abc', advertencias: [{ campo: 'cliente.direccion', mensaje: 'Sin dato' }], escribiria: {} });
    const r = await enviarAlPuente(payload, entorno());
    expect(r).toEqual({ ok: true, modo: 'dry-run', huella: 'abc', advertencias: [{ campo: 'cliente.direccion', mensaje: 'Sin dato' }] });
    expect(ultimaPeticion).toEqual({ auth: 'Bearer token-de-prueba-0123456789', tipo: 'application/json', cuerpo: payload });
  });

  it('422 del puente → DATOS_INVALIDOS con los errores por campo', async () => {
    comportamiento = responder(422, { ok: false, error: 'DATOS_INVALIDOS', errores: [{ campo: 'cliente.nit', mensaje: 'Es obligatorio.' }] });
    expect(await enviarAlPuente(payload, entorno())).toEqual({ ok: false, tipo: 'DATOS_INVALIDOS', errores: [{ campo: 'cliente.nit', mensaje: 'Es obligatorio.' }] });
  });

  it('401 → RECHAZADO; otros errores → ERROR_PUENTE; ninguno revela la URL ni el token', async () => {
    comportamiento = responder(401, { ok: false, error: 'NO_AUTORIZADO' });
    const rechazado = await enviarAlPuente(payload, entorno());
    comportamiento = responder(501, { ok: false, error: 'MODO_NO_DISPONIBLE' });
    const roto = await enviarAlPuente(payload, entorno());
    expect(rechazado).toMatchObject({ ok: false, tipo: 'RECHAZADO' });
    expect(roto).toMatchObject({ ok: false, tipo: 'ERROR_PUENTE' });
    expect(JSON.stringify([rechazado, roto])).not.toMatch(/token-de-prueba|127\.0\.0\.1/);
  });

  it('una respuesta que no es JSON se trata como error del puente', async () => {
    comportamiento = (res) => {
      res.writeHead(200);
      res.end('<html>proxy</html>');
    };
    expect(await enviarAlPuente(payload, entorno())).toMatchObject({ ok: false, tipo: 'ERROR_PUENTE' });
  });

  it('si el puente no responde a tiempo → TIMEOUT', async () => {
    comportamiento = () => {}; // nunca responde
    const r = await enviarAlPuente(payload, { ...entorno(), PUENTE_CONTRATOS_TIMEOUT_MS: '500' });
    expect(r).toMatchObject({ ok: false, tipo: 'TIMEOUT' });
  });

  it('si no hay nadie escuchando → NO_DISPONIBLE (sin filtrar la dirección)', async () => {
    const r = await enviarAlPuente(payload, { PUENTE_CONTRATOS_URL: 'http://127.0.0.1:1', PUENTE_CONTRATOS_TOKEN: 'x'.repeat(20) });
    expect(r).toMatchObject({ ok: false, tipo: 'NO_DISPONIBLE' });
    expect(JSON.stringify(r)).not.toContain('127.0.0.1');
  });
});
