import { describe, expect, it } from 'vitest';
import { construirCalculoLaboralAgregado } from './calculo-laboral-unitario-agregado';

describe('construirCalculoLaboralAgregado — costoMensualTotalCargo = costoMensualUnitario × cantidadTrabajadores', () => {
  it('cantidad 2: 2742671 × 2 = 5485342 (caso ASEADOR reportado)', () => {
    const r = construirCalculoLaboralAgregado(2742671, 2);
    expect(r.costoMensualUnitario).toBe(2742671);
    expect(r.cantidadTrabajadores).toBe(2);
    expect(r.costoMensualTotalCargo).toBe(5485342);
  });

  it('cantidad 4: 2742671 × 4 = 10970684', () => {
    const r = construirCalculoLaboralAgregado(2742671, 4);
    expect(r.costoMensualTotalCargo).toBe(10970684);
  });

  it('cantidad 1: el total y el unitario coinciden', () => {
    const r = construirCalculoLaboralAgregado(2742671, 1);
    expect(r.costoMensualTotalCargo).toBe(2742671);
  });

  it('cambiar solo la cantidad no altera costoMensualUnitario', () => {
    const cantidad2 = construirCalculoLaboralAgregado(2742671, 2);
    const cantidad3 = construirCalculoLaboralAgregado(2742671, 3);
    expect(cantidad2.costoMensualUnitario).toBe(cantidad3.costoMensualUnitario);
    expect(cantidad3.costoMensualTotalCargo).toBe(2742671 * 3);
  });
});
