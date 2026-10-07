import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { caracteresNoGuardables } from '../src/latin1.js';
import { digitoVerificacion, nitConDV } from '../src/nit.js';

describe('NIT: dígito de verificación (módulo 11 de la DIAN)', () => {
  it('coincide con NIT públicos conocidos', () => {
    assert.equal(nitConDV('800197268'), '800197268-4'); // DIAN
    assert.equal(nitConDV('899999068'), '899999068-1'); // Ecopetrol (resto 1 ⇒ DV 1)
    assert.equal(nitConDV('860034313'), '860034313-7'); // Davivienda
  });

  it('el DV siempre es un solo dígito (0-9) y es determinista', () => {
    for (let n = 100000; n < 100500; n += 7) {
      const dv = digitoVerificacion(String(n));
      assert.ok(Number.isInteger(dv) && dv >= 0 && dv <= 9, String(n));
      assert.equal(digitoVerificacion(String(n)), dv);
    }
  });

  it('detecta la digitación errada: en este NIT, cambiar cualquiera de sus 9 dígitos cambia el DV', () => {
    const base = '900123456';
    for (let i = 0; i < base.length; i++) {
      const otro = base.slice(0, i) + String((Number(base[i]) + 1) % 10) + base.slice(i + 1);
      assert.notEqual(digitoVerificacion(base), digitoVerificacion(otro), `posición ${i}`);
    }
  });

  it('rechaza lo que no es una base de NIT', () => {
    for (const malo of ['', '12a45', '900.123.456', '9001234567890123']) assert.throws(() => digitoVerificacion(malo), RangeError);
  });
});

describe('latin1: caracteres que Contratos no puede guardar', () => {
  it('acepta el español completo, las comillas tipográficas y el euro', () => {
    assert.deepEqual(caracteresNoGuardables('Áéíóú ÜÑ ñü ¿¡ ° ª º “comillas” ‘simples’ – — … € •'), []);
  });
  it('lista cada carácter fuera de latin1 una sola vez, en orden', () => {
    assert.deepEqual(caracteresNoGuardables('a ≥ b → c ≥ d 😀 ł'), ['≥', '→', '😀', 'ł']);
  });
  it('rechaza los controles C1 (0x80-0x9F), que no existen en cp1252', () => {
    assert.deepEqual(caracteresNoGuardables('\u0085\u009f'), ['\u0085', '\u009f']);
  });
});
