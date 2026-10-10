import { describe, expect, it, vi } from 'vitest';

// `server-only` (import 'server-only' en el módulo real) falla siempre fuera de un componente de servidor.
vi.mock('server-only', () => ({}));

import { CONTRATOS_POR_DEFECTO, enviarAContratos, leerConfigContratos } from './directo';
import type { PayloadContratosV1 } from './cliente';

const payload = { version: 1 } as unknown as PayloadContratosV1;

describe('leerConfigContratos', () => {
  it('sin variables apunta a la base de Contratos de la intranet en modo escritura', () => {
    expect(leerConfigContratos({})).toEqual({
      modo: 'escritura',
      configMySQL: { host: CONTRATOS_POR_DEFECTO.host, port: 3306, user: 'puente', password: '', database: 'almacen' },
    });
  });

  it('cada valor se puede cambiar en el entorno', () => {
    const config = leerConfigContratos({
      CONTRATOS_MODO: 'dry-run',
      CONTRATOS_MYSQL_HOST: '10.0.0.5',
      CONTRATOS_MYSQL_PORT: '3307',
      CONTRATOS_MYSQL_USER: 'otro',
      CONTRATOS_MYSQL_PASSWORD: 'clave',
      CONTRATOS_MYSQL_DATABASE: 'almacen_prueba',
    });
    expect(config).toEqual({ modo: 'dry-run', configMySQL: { host: '10.0.0.5', port: 3307, user: 'otro', password: 'clave', database: 'almacen_prueba' } });
  });

  it('rechaza un modo o un puerto inválidos', () => {
    expect(() => leerConfigContratos({ CONTRATOS_MODO: 'simular' })).toThrow(/CONTRATOS_MODO/);
    expect(() => leerConfigContratos({ CONTRATOS_MYSQL_PORT: '99999' })).toThrow(/CONTRATOS_MYSQL_PORT/);
  });
});

describe('enviarAContratos', () => {
  it('traduce la respuesta del motor igual que la del servicio puente', async () => {
    const motor = { enviar: vi.fn().mockResolvedValue({ estado: 200, cuerpo: { ok: true, modo: 'escritura', huella: 'abc', advertencias: [], noEscrito: [], escrito: { empresa: '01', undnegocio: 'BOG', numOferta: 931 } } }) };
    const r = await enviarAContratos(payload, {}, motor);
    expect(motor.enviar).toHaveBeenCalledWith(payload);
    expect(r).toEqual({ ok: true, modo: 'escritura', huella: 'abc', advertencias: [], noEscrito: [], oferta: { empresa: '01', undnegocio: 'BOG', numOferta: 931 } });
  });

  it('una base sin conexión llega como un rechazo legible', async () => {
    const motor = { enviar: vi.fn().mockResolvedValue({ estado: 503, cuerpo: { ok: false, error: 'BD_NO_DISPONIBLE', mensaje: 'No se pudo conectar con la base de datos de Contratos.' } }) };
    expect(await enviarAContratos(payload, {}, motor)).toEqual({ ok: false, tipo: 'CONFLICTO', codigo: 'BD_NO_DISPONIBLE', mensaje: 'No se pudo conectar con la base de datos de Contratos.' });
  });

  it('una configuración inválida no intenta enviar', async () => {
    const motor = { enviar: vi.fn() };
    const r = await enviarAContratos(payload, { CONTRATOS_MODO: 'x' }, motor);
    expect(r).toMatchObject({ ok: false, tipo: 'ERROR_PUENTE' });
    expect(motor.enviar).not.toHaveBeenCalled();
  });

  it('con PUENTE_CONTRATOS_URL usa el servicio puente por HTTP', async () => {
    const motor = { enviar: vi.fn() };
    const r = await enviarAContratos(payload, { PUENTE_CONTRATOS_URL: 'http://127.0.0.1:1' }, motor);
    expect(r).toEqual({ ok: false, tipo: 'NO_CONFIGURADO' }); // sin token el servicio puente queda apagado
    expect(motor.enviar).not.toHaveBeenCalled();
  });
});
