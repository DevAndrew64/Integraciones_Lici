import { describe, it, expect } from 'vitest';
import { codigoGrupoInsumo, debeExcluirseDeInsumosSNC } from './catalogo-insumos-snc';

describe('codigoGrupoInsumo — prefijo de 2 dígitos de `codigo` (único campo de grupo real)', () => {
  it('extrae los 2 primeros caracteres', () => {
    expect(codigoGrupoInsumo('18173')).toBe('18');
    expect(codigoGrupoInsumo('01050')).toBe('01');
    expect(codigoGrupoInsumo('20418')).toBe('20');
  });
  it('códigos de 1 solo carácter no colapsan a un grupo de 2 dígitos', () => {
    expect(codigoGrupoInsumo('1')).toBe('1');
  });
  it('null/undefined/vacío → cadena vacía, nunca lanza', () => {
    expect(codigoGrupoInsumo(null)).toBe('');
    expect(codigoGrupoInsumo(undefined)).toBe('');
    expect(codigoGrupoInsumo('')).toBe('');
  });
});

describe('debeExcluirseDeInsumosSNC — Aseocolba excluye grupo 01 en Servicios No Continuos, nadie más', () => {
  it('Aseocolba + grupo 01 → excluir', () => {
    expect(debeExcluirseDeInsumosSNC('aseo', '01050')).toBe(true);
  });
  it('Aseocolba + grupo 18 (EPP) → NO excluir — 18 debe estar disponible en SNC', () => {
    expect(debeExcluirseDeInsumosSNC('aseo', '18173')).toBe(false);
  });
  it('Aseocolba + cualquier otro grupo → NO excluir', () => {
    expect(debeExcluirseDeInsumosSNC('aseo', '20418')).toBe(false);
    expect(debeExcluirseDeInsumosSNC('aseo', '11180')).toBe(false);
  });

  // Punto 6/7 del ajuste: nunca reutilizar ciegamente una regla de una
  // empresa para otra — Vigicolba/Tempocolba NO tienen esta exclusión.
  it('Vigicolba + grupo 01 → NO excluir (regla exclusiva de Aseocolba)', () => {
    expect(debeExcluirseDeInsumosSNC('vigi', '01050')).toBe(false);
  });
  it('Tempocolba + grupo 01 → NO excluir (regla exclusiva de Aseocolba)', () => {
    expect(debeExcluirseDeInsumosSNC('tempo', '01050')).toBe(false);
  });
  it('empresa desconocida/vacía + grupo 01 → NO excluir (nunca por defecto)', () => {
    expect(debeExcluirseDeInsumosSNC('', '01050')).toBe(false);
    expect(debeExcluirseDeInsumosSNC('transcolba', '01050')).toBe(false);
  });
});
