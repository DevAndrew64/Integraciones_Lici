/**
 * Ajuste "AJUSTAR INTEGRALMENTE EL MOTOR Y LAS FICHAS DE TURNANTES"
 * (reemplaza la suite anterior, que asumía la "regla de 6 días" —
 * varias posiciones fusionadas en pocos turnantes de tiempo completo).
 *
 * Modelo vigente: cada posición elegible contrata SU PROPIO turnante
 * (`resolverConfiguracionTurnantes` aplicada por posición, nunca
 * combinando primero todas las horas del grupo) — `cantidadTurnantesFisicos`
 * escala linealmente con la cantidad de posiciones, nunca capado por la
 * antigua regla de 6 días. La línea automática (page.tsx) liquida con
 * `cantOpeFijos=cantidadTurnantesFisicos`, así que `costoMensualTotalLinea`
 * (aquí simulado con `COSTO_REFERENCIA_42H × cantidadTurnantesFisicos`)
 * YA es el costo de TODOS los turnantes físicos del grupo a la referencia
 * de 42h — el factor de escala (`bloqueContractual÷42`, nunca
 * `horasContratadasTotal÷42`) lo lleva a su jornada REAL (21h/42h) una
 * sola vez.
 */
import { describe, it, expect } from 'vitest';
import {
  calcularNecesidadTurnantes,
  calcularCoberturaPorPosicion,
  CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO,
  type PosicionParaTurnante,
} from './calculo-turnantes';

const COSTO_REFERENCIA_42H = 2742671;

function minutosPorDiaUniforme(minPorDia: number) {
  return { L: minPorDia, M: minPorDia, X: minPorDia, J: minPorDia, V: minPorDia, S: minPorDia, D: minPorDia };
}

/** Réplica exacta de las fórmulas de page.tsx (costoTurnantePorCargo), en
 * aislamiento — `costoMensualTotalLinea` escala con cantidadTurnantesFisicos
 * porque la línea real se liquida con cantOpeFijos=cantidadTurnantesFisicos. */
function costoAsignado(necesidad: ReturnType<typeof calcularNecesidadTurnantes>, minutosCubiertosCargo: number) {
  const bloqueContractual = necesidad.bloquesTurnantesContratados[0]?.horasContratadas ?? CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO;
  const factorEscalaContrato = bloqueContractual / CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO;
  const costoMensualTotalLinea = COSTO_REFERENCIA_42H * necesidad.cantidadTurnantesFisicos;
  const costoContratoGrupo = costoMensualTotalLinea * factorEscalaContrato;
  const capacidadUtilizada = necesidad.capacidadUtilizadaMinutos;
  return capacidadUtilizada > 0 ? Math.round(costoContratoGrupo * minutosCubiertosCargo / capacidadUtilizada) : 0;
}

function posiciones(n: number): PosicionParaTurnante[] {
  return Array.from({ length: n }, (_, i) => ({ id: String(i), cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaUniforme(480) }));
}

describe('Turnante dedicado — cada posición contrata su propio turnante de 21h; el costo escala linealmente con la cantidad de posiciones', () => {
  it('1) demanda de 7h (1 posición) → 1 contrato de 21h, costo asignado = $1.371.336', () => {
    const necesidad = calcularNecesidadTurnantes(posiciones(1));
    expect(necesidad.horasRelevoSemanales).toBe(7);
    expect(necesidad.horasContratadasTotal).toBe(21);
    expect(necesidad.cantidadTurnantesFisicos).toBe(1);
    const minutosCubiertos = calcularCoberturaPorPosicion(posiciones(1))[0].minutosCubiertos;
    expect(costoAsignado(necesidad, minutosCubiertos)).toBe(1371336);
  });

  it('2) 2 posiciones → 2 contratos de 21h (nunca 1 de 42h), costo total $2.742.671', () => {
    const necesidad = calcularNecesidadTurnantes(posiciones(2));
    expect(necesidad.cantidadTurnantesFisicos).toBe(2);
    expect(necesidad.bloquesTurnantesContratados).toEqual([{ horasContratadas: 21 }, { horasContratadas: 21 }]);
    expect(necesidad.horasContratadasTotal).toBe(42);
    expect(costoAsignado(necesidad, necesidad.capacidadUtilizadaMinutos)).toBe(2742671);
  });

  it('3) 3 posiciones → 3 contratos de 21h (nunca 1 de 42h), costo total $4.114.007', () => {
    const necesidad = calcularNecesidadTurnantes(posiciones(3));
    expect(necesidad.cantidadTurnantesFisicos).toBe(3);
    expect(necesidad.horasContratadasTotal).toBe(63);
    expect(costoAsignado(necesidad, necesidad.capacidadUtilizadaMinutos)).toBe(4114007);
  });

  it('4) 4 posiciones → 4 contratos de 21h, costo total $5.485.342', () => {
    const necesidad = calcularNecesidadTurnantes(posiciones(4));
    expect(necesidad.cantidadTurnantesFisicos).toBe(4);
    expect(necesidad.horasContratadasTotal).toBe(84);
    expect(costoAsignado(necesidad, necesidad.capacidadUtilizadaMinutos)).toBe(5485342);
  });

  it('5) 6 posiciones → 6 contratos de 21h, costo total $8.228.013', () => {
    const necesidad = calcularNecesidadTurnantes(posiciones(6));
    expect(necesidad.cantidadTurnantesFisicos).toBe(6);
    expect(necesidad.horasContratadasTotal).toBe(126);
    expect(costoAsignado(necesidad, necesidad.capacidadUtilizadaMinutos)).toBe(8228013);
  });

  it('quedan 9h "disponibles" (no costeadas dos veces) cuando la demanda dedicada (12h) es menor que el contrato de 21h', () => {
    const necesidad = calcularNecesidadTurnantes(posiciones(1));
    const capacidadUtilizadaSimulada = 12 * 60;
    const horasDisponibles = Math.max(0, necesidad.horasContratadasTotal - capacidadUtilizadaSimulada / 60);
    expect(horasDisponibles).toBe(9);
  });
});

describe('6) 9 posiciones → 9 turnantes físicos de 21h cada uno (nunca fusionados en pocos turnantes de tiempo completo)', () => {
  it('9 posiciones → 9 contratos de 21h = 189h contratadas, costo total $12.342.020', () => {
    const necesidad = calcularNecesidadTurnantes(posiciones(9));
    expect(necesidad.cantidadTurnantesFisicos).toBe(9);
    expect(necesidad.bloquesTurnantesContratados.every(b => b.horasContratadas === 21)).toBe(true);
    expect(necesidad.horasContratadasTotal).toBe(189);
    expect(costoAsignado(necesidad, necesidad.capacidadUtilizadaMinutos)).toBe(12342020);
  });
});

describe('9/10) Turnante compartido — el costo se distribuye SIN duplicarse; la suma reconstruye el costo contractual total', () => {
  it('3 cargos de 7h cada uno (3 posiciones → 3 contratos de 21h) reparten el costo total en partes iguales, la suma es (casi) exacta', () => {
    const posicionesCompartidas: PosicionParaTurnante[] = [
      { id: 'supervisor', cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaUniforme(480) },
      { id: 'otroCargoA', cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaUniforme(480) },
      { id: 'otroCargoB', cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaUniforme(480) },
    ];
    const necesidad = calcularNecesidadTurnantes(posicionesCompartidas);
    const cobertura = calcularCoberturaPorPosicion(posicionesCompartidas);
    expect(necesidad.cantidadTurnantesFisicos).toBe(3);
    expect(necesidad.horasContratadasTotal).toBe(63);

    const costoSupervisor = costoAsignado(necesidad, cobertura[0].minutosCubiertos); // 7h
    const costoOtroA = costoAsignado(necesidad, cobertura[1].minutosCubiertos); // 7h
    const costoOtroB = costoAsignado(necesidad, cobertura[2].minutosCubiertos); // 7h
    expect(costoSupervisor).toBe(1371336);
    expect(costoOtroA).toBe(1371336);
    expect(costoOtroB).toBe(1371336);
    // La suma puede diferir del contractual en ±1 por redondeo individual — nunca más de eso.
    expect(costoSupervisor + costoOtroA + costoOtroB).toBe(4114008);
  });
});

describe('8) El factor de escala usa la jornada de UN contrato individual, nunca las horas totales del grupo (evita escalar dos veces por N)', () => {
  it('formula correcta (bloqueContractual÷42) vs. fórmula incorrecta (dividir por capacidadOrdinariaMinutos completa) — ambas coinciden solo para 1 posición dedicada que agota su propio contrato', () => {
    const necesidad = calcularNecesidadTurnantes(posiciones(1));
    const minutosCubiertos = necesidad.capacidadUtilizadaMinutos; // 7h, dedicado
    const nuevo = costoAsignado(necesidad, minutosCubiertos);
    const formulaIncorrecta = Math.round(COSTO_REFERENCIA_42H * minutosCubiertos / necesidad.capacidadOrdinariaMinutos);
    expect(nuevo).toBe(1371336); // costo correcto: 1 contrato de 21h
    expect(formulaIncorrecta).toBe(914224); // fórmula incorrecta (divide por la capacidad completa, no por el bloque individual)
    expect(nuevo).toBeGreaterThan(formulaIncorrecta);
  });
});

describe('11) La regla de 7h por programación NO cambia — solo cambia cómo se dimensiona/costea la cantidad física', () => {
  it('horasRelevoSemanales sigue siendo exactamente cantidad×7h, sin importar el bloque contractual resultante', () => {
    for (const n of [1, 2, 3, 4, 6]) {
      expect(calcularNecesidadTurnantes(posiciones(n)).horasRelevoSemanales).toBe(n * 7);
    }
  });
});
