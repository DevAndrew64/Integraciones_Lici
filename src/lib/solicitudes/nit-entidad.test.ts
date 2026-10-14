import { describe, expect, it } from 'vitest';
import { nitVerificado, validarNitConDv } from './nit-entidad';

describe('validarNitConDv', () => {
  it('acepta el NIT con su DV correcto, con o sin puntos, y lo deja como «base-DV»', () => {
    expect(validarNitConDv('900.123.456-8')).toEqual({ ok: true, base: '900123456', dv: 8, nit: '900123456-8' });
    expect(validarNitConDv(' 890399010-6 ')).toMatchObject({ ok: true, nit: '890399010-6' });
    expect(validarNitConDv('890399010 6')).toMatchObject({ ok: true, nit: '890399010-6' });
  });

  it('rechaza un DV que no corresponde (NIT mal digitado o inventado)', () => {
    const r = validarNitConDv('900123456-1');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/no corresponde/);
  });

  it('pide el DV si llega solo la base, y rechaza vacíos o textos', () => {
    expect(validarNitConDv('900123456')).toMatchObject({ ok: false, error: expect.stringMatching(/Falta el dígito/) });
    expect(validarNitConDv('')).toMatchObject({ ok: false });
    expect(validarNitConDv(null)).toMatchObject({ ok: false });
    expect(validarNitConDv('NIT-1')).toMatchObject({ ok: false });
  });
});

describe('nitVerificado', () => {
  it('solo cuenta un «base-DV» con DV correcto', () => {
    expect(nitVerificado('900123456-8')).toBe(true);
    expect(nitVerificado('900123456-1')).toBe(false);
    expect(nitVerificado('900123456')).toBe(false); // de antes, sin DV
    expect(nitVerificado('900.123.456-8')).toBe(false); // se guarda sin puntos
    expect(nitVerificado(null)).toBe(false);
  });
});
