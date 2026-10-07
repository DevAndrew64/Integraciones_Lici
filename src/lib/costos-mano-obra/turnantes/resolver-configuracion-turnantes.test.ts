/**
 * Ajuste "EL MOTOR DEBE DETECTAR AUTOMÁTICAMENTE SI EL TURNANTE ES DE 21 O
 * 42 HORAS" — política central pura, sin campo manual de medio tiempo.
 * Casos 1-6 y 12 del encargo.
 */
import { describe, it, expect } from 'vitest';
import {
  resolverConfiguracionTurnantes,
  calcularNecesidadTurnantes,
  CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO,
  type PosicionParaTurnante,
} from './calculo-turnantes';

function minutosPorDiaUniforme(minPorDia: number) {
  return { L: minPorDia, M: minPorDia, X: minPorDia, J: minPorDia, V: minPorDia, S: minPorDia, D: minPorDia };
}

describe('resolverConfiguracionTurnantes — política central 21h/42h', () => {
  it('0h → sin turnante (arreglo vacío)', () => {
    expect(resolverConfiguracionTurnantes(0)).toEqual([]);
  });

  it('1) 7h requeridas → contrato de 21h', () => {
    expect(resolverConfiguracionTurnantes(7)).toEqual([{ horasContratadas: 21 }]);
  });

  it('2) 14h requeridas → contrato de 21h', () => {
    expect(resolverConfiguracionTurnantes(14)).toEqual([{ horasContratadas: 21 }]);
  });

  it('3) 21h requeridas → medio tiempo de 21h', () => {
    expect(resolverConfiguracionTurnantes(21)).toEqual([{ horasContratadas: 21 }]);
  });

  it('4) 28h requeridas → tiempo completo de 42h', () => {
    expect(resolverConfiguracionTurnantes(28)).toEqual([{ horasContratadas: 42 }]);
  });

  it('5) 42h requeridas → tiempo completo de 42h', () => {
    expect(resolverConfiguracionTurnantes(42)).toEqual([{ horasContratadas: 42 }]);
  });

  it('6) 63h requeridas → 42h + 21h (nunca un tercer bloque ni 42h+42h con ociosidad)', () => {
    expect(resolverConfiguracionTurnantes(63)).toEqual([{ horasContratadas: 42 }, { horasContratadas: 21 }]);
  });

  it('84h (2×42h exactas) → 42h + 42h', () => {
    expect(resolverConfiguracionTurnantes(84)).toEqual([{ horasContratadas: 42 }, { horasContratadas: 42 }]);
  });

  it('12) la referencia de 42h nunca sustituye las horas contratadas — es una constante aparte', () => {
    expect(CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO).toBe(42);
    expect(resolverConfiguracionTurnantes(21)[0].horasContratadas).toBe(21);
  });
});

describe('§7) 7) cada posición contrata su propio bloque (Ajuste "AJUSTAR INTEGRALMENTE EL MOTOR..." — nunca se combinan primero las horas del grupo)', () => {
  it('3 posiciones de 7h cada una (mismo grupo) generan 3 contratos de 21h — nunca 1 contrato de 42h', () => {
    const posiciones: PosicionParaTurnante[] = [
      { id: 'a', cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaUniforme(480) },
      { id: 'b', cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaUniforme(480) },
      { id: 'c', cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaUniforme(480) },
    ];
    const r = calcularNecesidadTurnantes(posiciones);
    expect(r.horasRelevoSemanales).toBe(21);
    // Cada posición contrata SU PROPIO bloque de 21h (resolverConfiguracionTurnantes
    // aplicado por posición) — 3 contratos de 21h, nunca 1 de 42h.
    expect(r.bloquesTurnantesContratados).toEqual([{ horasContratadas: 21 }, { horasContratadas: 21 }, { horasContratadas: 21 }]);
    expect(r.horasContratadasTotal).toBe(63);
    expect(r.cantidadTurnantesFisicos).toBe(3);
  });
});

describe('§6/§13) bloquesTurnantesContratados — un bloque por posición, nunca un tope de capacidad compartida', () => {
  it('excepción con horasEfectivasDescansoTurnante alto: cada posición contrata su propio bloque de 42h (24h>21h), nunca capado a 1 turnante físico', () => {
    const posiciones: PosicionParaTurnante[] = Array.from({ length: 6 }, (_, i) => ({
      id: String(i), cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaUniforme(480),
    }));
    const CONFIG_EXCEPCION = { diasCoberturaSemanal: 7, diasTrabajadosPorEmpleado: 6, diasTrabajadosPorTurnante: 6, jornadaTurnanteHoras: 42, horasEfectivasDescansoTurnante: 24 };
    const r = calcularNecesidadTurnantes(posiciones, CONFIG_EXCEPCION);
    expect(r.cantidadTurnantesFisicos).toBe(6); // 1 contrato de 42h por posición, nunca capado a 1
    expect(r.horasRelevoSemanales).toBe(144);
    expect(r.bloquesTurnantesContratados.length).toBe(6);
    expect(r.bloquesTurnantesContratados.every(b => b.horasContratadas === 42)).toBe(true);
    expect(r.horasContratadasTotal).toBe(252);
    expect(r.coberturaCompleta).toBe(true); // sin déficit — cada posición tiene su propio contrato
  });
});
