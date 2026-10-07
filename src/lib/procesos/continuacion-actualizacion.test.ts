import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';

// `server-only` (import 'server-only' en el módulo real) throws siempre bajo
// Node/vitest — su propósito es que un bundler de CLIENTE lo intercepte y
// aborte el build; en el runtime de pruebas (Node puro) no hay ese bundler,
// así que se sustituye por un no-op para poder probar la lógica del módulo.
vi.mock('server-only', () => ({}));

import { emitirTokenContinuacion, verificarTokenContinuacion, DURACION_MAX_CONTINUACION_SEGUNDOS } from './continuacion-actualizacion';

const SECRET_ORIGINAL = process.env.SESSION_SECRET;

beforeEach(() => {
  process.env.SESSION_SECRET = 'secreto-de-prueba-continuacion';
});

afterEach(() => {
  process.env.SESSION_SECRET = SECRET_ORIGINAL;
});

const DATOS = { procesoId: 5812, externalId: '11703150', notice: 'CO1.NTC.10510828', fuente: 'SECOP_II_REGISTRADO' };

describe('emitirTokenContinuacion', () => {
  it('emite un token con formato payload.firma cuando hay SESSION_SECRET', () => {
    const r = emitirTokenContinuacion(DATOS);
    expect(r).not.toBeNull();
    expect(r!.token.split('.')).toHaveLength(2);
    expect(r!.token.split('.')[1]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('la expiración es de 10 minutos exactos desde la emisión', () => {
    const ahora = new Date('2026-07-17T20:15:00.000Z');
    const r = emitirTokenContinuacion(DATOS, ahora);
    expect(r).not.toBeNull();
    expect(DURACION_MAX_CONTINUACION_SEGUNDOS).toBe(600);
    expect(r!.expiraEn).toBe('2026-07-17T20:25:00.000Z');
  });

  it('sin SESSION_SECRET: no emite (nunca firma con clave vacía)', () => {
    delete process.env.SESSION_SECRET;
    const r = emitirTokenContinuacion(DATOS);
    expect(r).toBeNull();
  });

  it('sin datos mínimos (notice vacío): no emite', () => {
    const r = emitirTokenContinuacion({ ...DATOS, notice: '' });
    expect(r).toBeNull();
  });

  it('el token no expone el payload en texto plano legible sin decodificar', () => {
    const r = emitirTokenContinuacion(DATOS)!;
    expect(r.token).not.toContain(DATOS.notice);
    expect(r.token).not.toContain(String(DATOS.procesoId));
  });
});

describe('verificarTokenContinuacion', () => {
  it('token recién emitido: válido, con el payload correcto', () => {
    const emitido = emitirTokenContinuacion(DATOS)!;
    const r = verificarTokenContinuacion(emitido.token);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.procesoId).toBe(DATOS.procesoId);
      expect(r.payload.externalId).toBe(DATOS.externalId);
      expect(r.payload.notice).toBe(DATOS.notice);
      expect(r.payload.fuente).toBe(DATOS.fuente);
      expect(r.payload.tipo).toBe('completar_datos_ficha');
    }
  });

  it('token vencido (más de 10 minutos desde la emisión): inválido', () => {
    const emitidoHace20Min = new Date(Date.now() - 20 * 60 * 1000);
    const emitido = emitirTokenContinuacion(DATOS, emitidoHace20Min)!;
    const r = verificarTokenContinuacion(emitido.token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('expirado');
  });

  it('exactamente en el borde de expiración: inválido (expiraEn <= ahora)', () => {
    const ahoraEmision = new Date('2026-07-17T20:00:00.000Z');
    const emitido = emitirTokenContinuacion(DATOS, ahoraEmision)!;
    const justoAlExpirar = new Date('2026-07-17T20:10:00.000Z'); // exactamente +600s
    const r = verificarTokenContinuacion(emitido.token, justoAlExpirar);
    expect(r.ok).toBe(false);
  });

  it('firma alterada: inválido', () => {
    const emitido = emitirTokenContinuacion(DATOS)!;
    const alterado = emitido.token.slice(0, -1) + (emitido.token.at(-1) === '0' ? '1' : '0');
    const r = verificarTokenContinuacion(alterado);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('firma_invalida');
  });

  it('payload alterado sin recalcular firma: inválido', () => {
    const emitido = emitirTokenContinuacion(DATOS)!;
    const [payloadB64, firma] = emitido.token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    payload.procesoId = 9999; // intento de manipular el proceso sin volver a firmar
    const payloadManipulado = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const r = verificarTokenContinuacion(`${payloadManipulado}.${firma}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('firma_invalida');
  });

  it('token firmado con un secreto distinto (SESSION_SECRET rotado): inválido', () => {
    const emitido = emitirTokenContinuacion(DATOS)!;
    process.env.SESSION_SECRET = 'otro-secreto-completamente-distinto';
    const r = verificarTokenContinuacion(emitido.token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('firma_invalida');
  });

  it('formato inválido (sin punto separador): rechaza sin decodificar', () => {
    const r = verificarTokenContinuacion('esto-no-es-un-token');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('formato_invalido');
  });

  it('vacío/null/undefined: rechaza', () => {
    expect(verificarTokenContinuacion('').ok).toBe(false);
    expect(verificarTokenContinuacion(null).ok).toBe(false);
    expect(verificarTokenContinuacion(undefined).ok).toBe(false);
  });

  it('token de un tipo distinto pero firmado CON el dominio correcto: rechaza por tipo, no por firma', () => {
    const secret = process.env.SESSION_SECRET!;

    const payload = { tipo: 'otro_tipo', procesoId: 1, externalId: 'x', notice: 'x', fuente: 'x', emitidoEn: 0, expiraEn: Math.floor(Date.now() / 1000) + 600 };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const material = `LICYCOLBA:CONTINUACION_ACTUALIZACION_FICHA:V1.${payloadB64}`;
    const firma = createHmac('sha256', secret).update(material).digest('hex');
    const r = verificarTokenContinuacion(`${payloadB64}.${firma}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('tipo_invalido');
  });

  it('PRUEBA 7 — firma generada SIN separación de dominio (payload firmado directo, como una cookie de sesión antigua): rechaza', () => {
    const secret = process.env.SESSION_SECRET!;

    const payload = { tipo: 'completar_datos_ficha', procesoId: 1, externalId: 'x', notice: 'x', fuente: 'SECOP_II_REGISTRADO', emitidoEn: 0, expiraEn: Math.floor(Date.now() / 1000) + 600 };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    // Firma "a la vieja usanza" — igual que session.ts, SIN el prefijo de dominio.
    const firmaSinDominio = createHmac('sha256', secret).update(payloadB64).digest('hex');
    const r = verificarTokenContinuacion(`${payloadB64}.${firmaSinDominio}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('firma_invalida');
  });

  it('PRUEBA 8 — firma con un dominio distinto/incorrecto: rechaza', () => {
    const secret = process.env.SESSION_SECRET!;

    const payload = { tipo: 'completar_datos_ficha', procesoId: 1, externalId: 'x', notice: 'x', fuente: 'SECOP_II_REGISTRADO', emitidoEn: 0, expiraEn: Math.floor(Date.now() / 1000) + 600 };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const materialConDominioIncorrecto = `OTRO:DOMINIO:V1.${payloadB64}`;
    const firma = createHmac('sha256', secret).update(materialConDominioIncorrecto).digest('hex');
    const r = verificarTokenContinuacion(`${payloadB64}.${firma}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('firma_invalida');
  });

  it('PRUEBA 9 — un HMAC firmado con SESSION_SECRET para OTRO propósito (simulando una cookie de sesión) no se acepta como continuación', () => {
    const secret = process.env.SESSION_SECRET!;

    // Simula el formato real de session.ts: payload de sesión, sin dominio de continuación.
    const payloadSesion = { id: 1, email: 'x@x.com', rol: 'Analista', exp: Math.floor(Date.now() / 1000) + 3600, sv: 1 };
    const payloadB64 = Buffer.from(JSON.stringify(payloadSesion)).toString('base64url');
    const firma = createHmac('sha256', secret).update(payloadB64).digest('hex');
    const r = verificarTokenContinuacion(`${payloadB64}.${firma}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('firma_invalida');
  });

  it('sin SESSION_SECRET: rechaza cualquier token', () => {
    const emitido = emitirTokenContinuacion(DATOS)!;
    delete process.env.SESSION_SECRET;
    const r = verificarTokenContinuacion(emitido.token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('sin_secreto');
  });
});
