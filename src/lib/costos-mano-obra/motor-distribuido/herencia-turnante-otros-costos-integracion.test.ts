/**
 * Integración numérica REAL (sin readFileSync) de la herencia de
 * Dotación/EPP/Exámenes/Vacunas/Cursos del cargo principal hacia sus
 * turnantes físicos — usa exactamente `consolidarFilasPorIdentidad` +
 * `construirDesgloseOtrosCostosLinea` (motor-distribuido, sin modificar),
 * el mismo camino que page.tsx (`resultadosHerenciaOtrosCostosTurnantes`).
 * Nunca reimplementa la fórmula de costeo — solo arma los insumos
 * (filas consolidadas) y verifica el resultado.
 */
import { describe, it, expect } from 'vitest';
import { construirDesgloseOtrosCostosLinea, type ItemCostoResuelto } from './otros-costos-por-linea';
import {
  consolidarFilasPorIdentidad,
  identidadDotItem, configuracionDotItem,
  type FilaConOrigen, type DotItemRowMin,
} from './herencia-turnante-otros-costos';
import { calcularCostoProporcionalTurnante } from '../turnantes/calculo-turnantes';

function valorMesRow(r: { cant: number; vUnit: number; frec: number }): number {
  return Math.floor((r.cant * r.vUnit * 1.19) / (r.frec || 1));
}

function dotItemsAResuelto(filas: DotItemRowMin[]): ItemCostoResuelto[] {
  return filas.map(f => ({ valorMensual: valorMesRow(f) }));
}

describe('Caso 1 — una posición → un turnante físico', () => {
  it('el cargo principal se cobra 1 vez; el turnante físico (1) recibe la MISMA configuración, cobrada 1 vez más', () => {
    const guante: DotItemRowMin = { codigo: 'G001', cant: 2, frec: 6, vUnit: 10000, medida: 'PAR' };
    const filasCargo: FilaConOrigen<DotItemRowMin>[] = [{ posicionId: 1, fila: guante }];
    const { consolidadas } = consolidarFilasPorIdentidad(filasCargo, identidadDotItem, configuracionDotItem);

    const costoCargo = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 1, dotacion: dotItemsAResuelto([guante]), epp: [], examenes: [], cursos: [], vacunas: [] });
    const costoTurnante = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 1, dotacion: dotItemsAResuelto(consolidadas.map(c => c.fila)), epp: [], examenes: [], cursos: [], vacunas: [] });

    expect(costoCargo.otrosCostosMensualesLinea).toBe(costoTurnante.otrosCostosMensualesLinea);
    expect(costoCargo.otrosCostosMensualesLinea + costoTurnante.otrosCostosMensualesLinea).toBe(costoCargo.otrosCostosMensualesLinea * 2);
  });
});

describe('Caso 2 — una posición → varios turnantes físicos', () => {
  it('2 turnantes físicos → el costo heredado se multiplica × 2, nunca × cantidad de líneas técnicas', () => {
    const guante: DotItemRowMin = { codigo: 'G001', cant: 2, frec: 6, vUnit: 10000, medida: 'PAR' };
    const { consolidadas } = consolidarFilasPorIdentidad([{ posicionId: 1, fila: guante }], identidadDotItem, configuracionDotItem);

    const costo1Fisico = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 1, dotacion: dotItemsAResuelto(consolidadas.map(c => c.fila)), epp: [], examenes: [], cursos: [], vacunas: [] });
    const costo2Fisicos = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 2, dotacion: dotItemsAResuelto(consolidadas.map(c => c.fila)), epp: [], examenes: [], cursos: [], vacunas: [] });

    expect(costo2Fisicos.otrosCostosMensualesLinea).toBe(costo1Fisico.otrosCostosMensualesLinea * 2);
  });
});

describe('Caso 3 — dos posiciones con configuración IDÉNTICA → un turnante: consolidar una sola vez, nunca duplicar costo', () => {
  it('ASEADOR turno 1 y turno 2 con el mismo Guante X (cant 2, frec 6, valor 10000) → una sola fila consolidada, costo NUNCA el doble', () => {
    const guanteTurno1: DotItemRowMin = { codigo: 'G001', cant: 2, frec: 6, vUnit: 10000, medida: 'PAR' };
    const guanteTurno2: DotItemRowMin = { ...guanteTurno1 };
    const { consolidadas, conflictos } = consolidarFilasPorIdentidad(
      [{ posicionId: 1, fila: guanteTurno1 }, { posicionId: 2, fila: guanteTurno2 }],
      identidadDotItem, configuracionDotItem,
    );
    expect(consolidadas).toHaveLength(1);
    expect(conflictos).toHaveLength(0);

    const costoUnaPosicion = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 1, dotacion: dotItemsAResuelto([guanteTurno1]), epp: [], examenes: [], cursos: [], vacunas: [] });
    const costoConsolidado = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 1, dotacion: dotItemsAResuelto(consolidadas.map(c => c.fila)), epp: [], examenes: [], cursos: [], vacunas: [] });
    // NUNCA el doble por venir de 2 posiciones — exactamente igual que si viniera de 1 sola.
    expect(costoConsolidado.otrosCostosMensualesLinea).toBe(costoUnaPosicion.otrosCostosMensualesLinea);
  });
});

describe('Caso 4 — dos posiciones con elementos DISTINTOS → un turnante: hereda ambos', () => {
  it('turno 1 aporta Guante, turno 2 aporta Casco → el turnante hereda los 2, suma de ambos costos', () => {
    const guante: DotItemRowMin = { codigo: 'G001', cant: 2, frec: 6, vUnit: 10000, medida: 'PAR' };
    const casco: DotItemRowMin = { codigo: 'C001', cant: 1, frec: 12, vUnit: 25000, medida: 'UND' };
    const { consolidadas, conflictos } = consolidarFilasPorIdentidad(
      [{ posicionId: 1, fila: guante }, { posicionId: 2, fila: casco }],
      identidadDotItem, configuracionDotItem,
    );
    expect(consolidadas).toHaveLength(2);
    expect(conflictos).toHaveLength(0);

    const costo = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 1, dotacion: dotItemsAResuelto(consolidadas.map(c => c.fila)), epp: [], examenes: [], cursos: [], vacunas: [] });
    const costoGuanteSolo = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 1, dotacion: dotItemsAResuelto([guante]), epp: [], examenes: [], cursos: [], vacunas: [] });
    const costoCascoSolo = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 1, dotacion: dotItemsAResuelto([casco]), epp: [], examenes: [], cursos: [], vacunas: [] });
    expect(costo.otrosCostosMensualesLinea).toBe(costoGuanteSolo.otrosCostosMensualesLinea + costoCascoSolo.otrosCostosMensualesLinea);
  });
});

describe('Caso 5 — dos posiciones con el mismo elemento pero configuración DISTINTA → conflicto, nunca resuelto en silencio', () => {
  it('turno 1: Guante cant=2; turno 2: Guante cant=4 → conflicto detectado, el elemento queda FUERA del costeo (nunca 2, nunca 4, nunca 6, nunca 3)', () => {
    const guanteCant2: DotItemRowMin = { codigo: 'G001', cant: 2, frec: 6, vUnit: 10000, medida: 'PAR' };
    const guanteCant4: DotItemRowMin = { codigo: 'G001', cant: 4, frec: 6, vUnit: 10000, medida: 'PAR' };
    const { consolidadas, conflictos } = consolidarFilasPorIdentidad(
      [{ posicionId: 1, fila: guanteCant2 }, { posicionId: 2, fila: guanteCant4 }],
      identidadDotItem, configuracionDotItem,
    );
    expect(consolidadas).toHaveLength(0);
    expect(conflictos).toHaveLength(1);

    const costo = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 1, dotacion: dotItemsAResuelto(consolidadas.map(c => c.fila)), epp: [], examenes: [], cursos: [], vacunas: [] });
    expect(costo.otrosCostosMensualesLinea).toBe(0); // el conflicto nunca se costea en silencio
  });
});

describe('Caso 6 — varias posiciones + varios turnantes físicos → configuración derivada × headcount físico correcto', () => {
  it('2 posiciones (1 elemento común consolidado + 1 elemento exclusivo de la posición 2) × 3 turnantes físicos', () => {
    const comun: DotItemRowMin = { codigo: 'G001', cant: 2, frec: 6, vUnit: 10000, medida: 'PAR' };
    const exclusivoPos2: DotItemRowMin = { codigo: 'C001', cant: 1, frec: 12, vUnit: 25000, medida: 'UND' };
    const { consolidadas } = consolidarFilasPorIdentidad(
      [{ posicionId: 1, fila: comun }, { posicionId: 2, fila: { ...comun } }, { posicionId: 2, fila: exclusivoPos2 }],
      identidadDotItem, configuracionDotItem,
    );
    expect(consolidadas).toHaveLength(2); // comun consolidado 1 vez + exclusivo

    const costoUnitario = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 1, dotacion: dotItemsAResuelto(consolidadas.map(c => c.fila)), epp: [], examenes: [], cursos: [], vacunas: [] });
    const costo3Fisicos = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores: 3, dotacion: dotItemsAResuelto(consolidadas.map(c => c.fila)), epp: [], examenes: [], cursos: [], vacunas: [] });
    expect(costo3Fisicos.otrosCostosMensualesLinea).toBe(costoUnitario.otrosCostosMensualesLinea * 3);
  });
});

describe('Caso 9 — CORRECCIÓN DE REGLA DE NEGOCIO: el heredado entra en "Otros costos" de la ficha BASE del turnante ANTES del factor laboral, nunca sumado aparte después', () => {
  it('caso exacto ASEADOR: base laboral $2.846.255 + otros heredados $177.532 = base total $3.023.787; factor 7/42 → $503.965 (NUNCA $474.376+$177.532=$651.908)', () => {
    const baseLaboralSinOtros = 2_846_255; // salario+auxilio+prestaciones+seguridad social+parafiscales del motor salarial, intacto (NO TOCAR)
    const desgloseHeredado = construirDesgloseOtrosCostosLinea({
      cantidadTrabajadores: 1, // la línea de referencia 42h de HORAS_REALES representa UNA persona
      dotacion: [{ valorMensual: 177_532 }], epp: [], examenes: [], cursos: [], vacunas: [],
    });
    expect(desgloseHeredado.otrosCostosMensualesLinea).toBe(177_532);

    // Ficha BASE del turnante = costo laboral + otros costos heredados (§ regla de negocio) — ANTES del factor.
    const costoBaseDelTurnante = baseLaboralSinOtros + desgloseHeredado.otrosCostosMensualesLinea;
    expect(costoBaseDelTurnante).toBe(3_023_787);

    const costoMensualTurnante = calcularCostoProporcionalTurnante(costoBaseDelTurnante, 7); // factor 7/42 = 1/6
    expect(costoMensualTurnante).toBe(503_965);

    // Nunca el patrón "laboral escalado aparte + heredado tal cual sin escalar".
    const patronIncorrecto = calcularCostoProporcionalTurnante(baseLaboralSinOtros, 7) + 177_532;
    expect(patronIncorrecto).toBe(651_908);
    expect(costoMensualTurnante).not.toBe(patronIncorrecto);
  });

  it('1 turnante físico: (base laboral + otros heredados) × factor — una sola multiplicación, el heredado nunca se suma una segunda vez', () => {
    const baseLaboralSinOtros = 2_846_255;
    const otrosHeredados = 177_532;
    const costoUnitarioProporcional = calcularCostoProporcionalTurnante(baseLaboralSinOtros + otrosHeredados, 7);
    const costoTotalGrupo = costoUnitarioProporcional * 1; // cantidadTurnantesFisicos=1
    expect(costoTotalGrupo).toBe(503_965);
    expect(costoTotalGrupo).not.toBe(calcularCostoProporcionalTurnante(baseLaboralSinOtros, 7) + otrosHeredados);
  });

  it('2 turnantes físicos: [(base laboral + otros heredados) × factor] × 2 — nunca una segunda suma independiente de otros costos heredados', () => {
    const baseLaboralSinOtros = 2_846_255;
    const otrosHeredados = 177_532;
    const costoUnitarioProporcional = calcularCostoProporcionalTurnante(baseLaboralSinOtros + otrosHeredados, 7);
    const costoTotalGrupo = costoUnitarioProporcional * 2; // cantidadTurnantesFisicos=2
    expect(costoTotalGrupo).toBe(503_965 * 2);
    // nunca sumar el heredado una vez más por fuera (ni tal cual ni escalado)
    expect(costoTotalGrupo).not.toBe(calcularCostoProporcionalTurnante(baseLaboralSinOtros, 7) * 2 + otrosHeredados);
    expect(costoTotalGrupo).not.toBe(calcularCostoProporcionalTurnante(baseLaboralSinOtros, 7) * 2 + otrosHeredados * 2);
  });
});
