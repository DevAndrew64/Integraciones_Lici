import { describe, expect, it } from 'vitest';
import { CATALOGO_VACUNAS } from './catalogo-vacunas';

describe('CATALOGO_VACUNAS', () => {
  it('§14.1 contiene exactamente 19 vacunas', () => {
    expect(CATALOGO_VACUNAS.length).toBe(19);
  });

  it('§14.2 cada vacuna tiene un código estable y único (VACxxx)', () => {
    const codigos = CATALOGO_VACUNAS.map(v => v.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
    for (const c of codigos) expect(c).toMatch(/^VAC\d{3}$/);
  });

  it('§14.3 se conservan las dos tarifas (preferencial y público general) en cada registro', () => {
    for (const v of CATALOGO_VACUNAS) {
      expect(typeof v.precioPreferencial).toBe('number');
      expect(typeof v.precioPublicoGeneral).toBe('number');
      expect(v.precioPreferencial).toBeGreaterThan(0);
      expect(v.precioPublicoGeneral).toBeGreaterThan(0);
    }
  });

  it('§14.8 el esquema de vacunación se conserva como texto de referencia (nunca vacío)', () => {
    for (const v of CATALOGO_VACUNAS) expect(v.esquemaVacunacion.trim().length).toBeGreaterThan(0);
  });

  it('carga exactamente los registros del catálogo suministrado (influenza como ejemplo de la fórmula del ajuste)', () => {
    const influenza = CATALOGO_VACUNAS.find(v => v.codigo === 'VAC012');
    expect(influenza).toEqual({ codigo: 'VAC012', nombre: 'Influenza', precioPreferencial: 48000, precioPublicoGeneral: 58000, esquemaVacunacion: 'Anual' });
  });
});
