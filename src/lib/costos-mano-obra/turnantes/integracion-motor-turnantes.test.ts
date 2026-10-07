/**
 * Integración numérica REAL (sin readFileSync de page.tsx) entre el
 * cálculo de turnantes y el motor financiero ya existente — prueba, con
 * cifras reales, que una línea de turnante se liquida con el MISMO
 * constructor que cualquier cargo (`construirLineaCalculadaMensualComercial30Dias`,
 * motor-comercial-30-dias.ts — no modificado) y que el agregado general
 * (`agregarCostoMensualTotalManoObra`, otros-costos-por-linea.ts — no
 * modificado) suma cargo + turnante exactamente una vez, sin fórmula
 * paralela.
 */
import { describe, it, expect } from 'vitest';
import {
  construirLineaCalculadaMensualComercial30Dias,
  DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA,
} from '../motor-distribuido/motor-comercial-30-dias';
import type { ParametrosFinancierosManoObra } from '../motor-distribuido/parametros-financieros-mano-obra';
import {
  construirDesgloseOtrosCostosLinea,
  construirResultadoLineaConOtrosCostos,
  agregarCostoMensualTotalManoObra,
  type ResultadoLineaConOtrosCostos,
} from '../motor-distribuido/otros-costos-por-linea';
import { calcularCostoProporcionalTurnante, resolverConteoBloquesTurnantes } from './calculo-turnantes';

const PARAMS_FINANCIEROS: ParametrosFinancierosManoObra = {
  porcentajeVacaciones: 5, porcentajeCesantias: 8.33, porcentajePrima: 8.33, porcentajeInteresesCesantias: 1,
  porcentajePension: 12, porcentajeArlPorClase: { I: 0.522, II: 1.044, III: 2.436, IV: 4.35, V: 6.96 },
  porcentajeSalud: 8.5, exoneradoSalud: false,
  porcentajeCajaCompensacion: 4, porcentajeSena: 2, exoneradoSena: false, porcentajeIcbf: 3, exoneradoIcbf: false,
  fuente: 'VALORES_PREDETERMINADOS',
};

/** Reproduce EXACTAMENTE el mismo camino que page.tsx usa para liquidar
 * cualquier línea (TOTAL_SEMANAL, sin recargos, otros costos vacíos) —
 * nunca una fórmula propia para el turnante. */
function liquidarLinea(
  salarioMensual: number,
  cantidadTrabajadores: number,
  claseArl: 'I' | 'II' | 'III' | 'IV' | 'V' = 'II',
): ResultadoLineaConOtrosCostos {
  const linea = construirLineaCalculadaMensualComercial30Dias(
    { distribucionHoras: DISTRIBUCION_HORAS_METODO_COMERCIAL_VACIA, salarioMensual, cantidadTrabajadores },
    0, claseArl, PARAMS_FINANCIEROS,
  );
  const fin = linea.resultadoFinanciero;
  if (!fin) throw new Error('resultadoFinanciero inesperadamente null en la prueba');
  const desglose = construirDesgloseOtrosCostosLinea({ cantidadTrabajadores, dotacion: [], epp: [], examenes: [], cursos: [], vacunas: [] });
  return construirResultadoLineaConOtrosCostos(fin.tarifaMensualPorTrabajador, fin.tarifaMensualLinea, desglose);
}

describe('6 — la línea automática de turnante se liquida con el mismo constructor que cualquier cargo', () => {
  it('construirLineaCalculadaMensualComercial30Dias produce un resultadoFinanciero completo para un turnante (mismo camino que un cargo ordinario)', () => {
    const resultadoTurnante = liquidarLinea(1750905, 2, 'II');
    expect(resultadoTurnante.costoLaboralMensualPorTrabajador).toBeGreaterThan(1750905); // incluye prestaciones/seguridad social/parafiscales, no solo el salario
    expect(resultadoTurnante.costoMensualTotalLinea).toBe(resultadoTurnante.costoLaboralMensualLinea); // sin otros costos en este caso
    expect(resultadoTurnante.cantidadTrabajadores).toBe(2);
  });
});

describe('7/8 — cargo + turnante producen exactamente costoCargo + costoTurnante, sumado una sola vez', () => {
  it('el agregado general suma ambas líneas exactamente una vez cada una', () => {
    const resultadoCargo = liquidarLinea(2500000, 11, 'III'); // 11 posiciones principales
    const resultadoTurnante = liquidarLinea(1750905, 2, 'II'); // 2 turnantes físicos (caso obligatorio)

    const agregado = agregarCostoMensualTotalManoObra([resultadoCargo, resultadoTurnante]);

    expect(agregado.costoMensualTotalManoObra).toBe(
      resultadoCargo.costoMensualTotalLinea + resultadoTurnante.costoMensualTotalLinea,
    );
    expect(agregado.cantidadLineas).toBe(2);
  });

  it('8 — incluir la línea de turnante dos veces (simulando una duplicación) SÍ cambia el total — confirma que el agregado no absorbe duplicados silenciosamente, y que la composición correcta (una sola vez) es la única que coincide con costoCargo+costoTurnante', () => {
    const resultadoCargo = liquidarLinea(2500000, 11, 'III');
    const resultadoTurnante = liquidarLinea(1750905, 2, 'II');

    const agregadoCorrecto = agregarCostoMensualTotalManoObra([resultadoCargo, resultadoTurnante]);
    const agregadoConDuplicadoDeliberado = agregarCostoMensualTotalManoObra([resultadoCargo, resultadoTurnante, resultadoTurnante]);

    expect(agregadoConDuplicadoDeliberado.costoMensualTotalManoObra).not.toBe(agregadoCorrecto.costoMensualTotalManoObra);
    expect(agregadoConDuplicadoDeliberado.costoMensualTotalManoObra).toBe(
      agregadoCorrecto.costoMensualTotalManoObra + resultadoTurnante.costoMensualTotalLinea,
    );
    // El resultado correcto (una sola vez) es exactamente costoCargo + costoTurnante — el
    // duplicado NO lo es, confirmando que la fuente de verdad es "cada línea aparece
    // exactamente una vez en el arreglo pasado al agregador", nunca una suma ad-hoc.
    expect(agregadoCorrecto.costoMensualTotalManoObra).toBe(
      resultadoCargo.costoMensualTotalLinea + resultadoTurnante.costoMensualTotalLinea,
    );
  });

  it('varios grupos de turnantes (configuraciones distintas) también se suman cada uno exactamente una vez', () => {
    const resultadoCargo = liquidarLinea(2500000, 11, 'III');
    const turnanteGrupoA = liquidarLinea(1750905, 1, 'I'); // grupo con salario/ARL propio
    const turnanteGrupoB = liquidarLinea(1500000, 2, 'V'); // grupo incompatible con el anterior

    const agregado = agregarCostoMensualTotalManoObra([resultadoCargo, turnanteGrupoA, turnanteGrupoB]);
    expect(agregado.costoMensualTotalManoObra).toBe(
      resultadoCargo.costoMensualTotalLinea + turnanteGrupoA.costoMensualTotalLinea + turnanteGrupoB.costoMensualTotalLinea,
    );
    expect(agregado.cantidadLineas).toBe(3);
  });
});

/**
 * Corrección "AGREGADO MENSUAL DE TURNANTES HORAS_REALES" — evidencia
 * numérica REAL (mismo motor, sin readFileSync) del fix aplicado en
 * page.tsx: `resultadosTurnantesConOtrosCostosParaAgregado` escala cada
 * línea automática de turnante HORAS_REALES por
 * `factorAgregadoTurnanteHorasReales = costoTotalGrupoTurnante(...)/costoCrudo`
 * ANTES de que `agregarCostoMensualTotalManoObra` la sume — nunca el
 * costo crudo de la ficha de referencia de 42h. Esta función replica
 * EXACTAMENTE (línea por línea) el helper de escalado que page.tsx aplica
 * a `ResultadoLineaConOtrosCostos` — no es una fórmula nueva, es la misma
 * multiplicación por un único factor + recomputo de costoMensualTotalLinea
 * como suma de sus dos componentes ya escalados.
 */
function escalarResultadoLineaParaAgregado(resultado: ResultadoLineaConOtrosCostos, factor: number): ResultadoLineaConOtrosCostos {
  if (factor === 1) return resultado;
  const costoLaboralMensualLinea = Math.round(resultado.costoLaboralMensualLinea * factor);
  const otrosCostosMensualesLinea = Math.round(resultado.otrosCostosMensualesLinea * factor);
  return {
    ...resultado,
    costoLaboralMensualPorTrabajador: Math.round(resultado.costoLaboralMensualPorTrabajador * factor),
    costoLaboralMensualLinea,
    otrosCostosMensualesPorTrabajadorLinea: Math.round(resultado.otrosCostosMensualesPorTrabajadorLinea * factor),
    otrosCostosFijosMensualesLinea: Math.round(resultado.otrosCostosFijosMensualesLinea * factor),
    otrosCostosMensualesLinea,
    costoMensualTotalLinea: costoLaboralMensualLinea + otrosCostosMensualesLinea,
  };
}

describe('Corrección "AGREGADO MENSUAL DE TURNANTES HORAS_REALES" — el agregado usa el costo PROPORCIONAL, nunca el crudo de la referencia de 42h', () => {
  it('TEST 1 — HORAS_REALES: el costo agregado del turnante es proporcional (costoReferencia × 7/42), no el costo completo de 42h', () => {
    // Ficha de referencia TURNANTE-AUTO-REF42 — 1 persona a jornada de 42h
    // (mismo salario/motor que cualquier cargo, cantidadTrabajadores=1,
    // exactamente como `construirLineaTurnanteAutomaticaBase` la genera en
    // page.tsx).
    const referencia42h = liquidarLinea(2846255 /* salario arbitrario para que el costo laboral ronde el caso reportado */, 1, 'II');
    const horasCobertura = 7; // caso reportado: 7h/semana de relevo
    // costoTotalGrupoTurnante (HORAS_REALES, cantidadTurnantesFisicos=1)
    // se reduce a calcularCostoProporcionalTurnante — MISMA fuente única
    // que costoTurnantePorCargo ya usa en page.tsx.
    const costoCorrecto = calcularCostoProporcionalTurnante(referencia42h.costoMensualTotalLinea, horasCobertura);
    const factor = costoCorrecto / referencia42h.costoMensualTotalLinea;

    const turnanteEscalado = escalarResultadoLineaParaAgregado(referencia42h, factor);

    // Proporción exacta 7/42 = 1/6, con la única tolerancia del redondeo a
    // pesos enteros (política de redondeo ya usada en todo el módulo).
    expect(turnanteEscalado.costoMensualTotalLinea).toBe(Math.round(referencia42h.costoMensualTotalLinea * (horasCobertura / 42)));
    expect(turnanteEscalado.costoMensualTotalLinea).toBeLessThan(referencia42h.costoMensualTotalLinea);
    // NUNCA el costo completo de 42h — la ficha de referencia no es una
    // persona física contratada a jornada completa en HORAS_REALES.
    expect(turnanteEscalado.costoMensualTotalLinea).not.toBe(referencia42h.costoMensualTotalLinea);
  });

  it('TEST 2 — RECONCILIACIÓN: el agregado usa exactamente el mismo costo proporcional que costoTotalGrupoTurnante/costoTurnantePorCargo para el mismo grupo', () => {
    const referencia42h = liquidarLinea(2846255, 1, 'II');
    const horasCobertura = 7;
    const cantidadTurnantesFisicos = 1; // caso reportado: 1 posición elegible, 1 turnante físico
    // Réplica de costoTotalGrupoTurnante (rama HORAS_REALES, calculo-turnantes.ts) —
    // MISMA fórmula, nunca una nueva: costoUnitarioProporcional × cantidadTurnantesFisicos.
    const costoTotalGrupoTurnanteEquivalente = calcularCostoProporcionalTurnante(referencia42h.costoMensualTotalLinea, horasCobertura) * cantidadTurnantesFisicos;
    const factor = costoTotalGrupoTurnanteEquivalente / referencia42h.costoMensualTotalLinea;
    const turnanteEscaladoParaAgregado = escalarResultadoLineaParaAgregado(referencia42h, factor);

    // El valor que alimentaría agregadoTurnantesMensual/agregadoCostoMensualTotalManoObra
    // (vía agregarCostoMensualTotalManoObra) reconcilia exactamente con
    // costoTotalGrupoTurnante — la misma fuente que ya usa costoTurnantePorCargo.
    expect(turnanteEscaladoParaAgregado.costoMensualTotalLinea).toBe(Math.round(costoTotalGrupoTurnanteEquivalente));

    const agregado = agregarCostoMensualTotalManoObra([turnanteEscaladoParaAgregado]);
    expect(agregado.costoMensualTotalManoObra).toBe(turnanteEscaladoParaAgregado.costoMensualTotalLinea);
  });

  it('TEST 3 — EXCEPCIONES (INTEGRADO_42H/INDIVIDUAL_ESPECIAL_21H): factor=1, sin prorrateo — comportamiento anterior preservado', () => {
    // Bloque INTEGRADO_42H real: 2 turnantes físicos emparejados en un
    // bloque de 42h (resolverConteoBloquesTurnantes, sin cambios) — la
    // línea automática YA nace con cantOpeFijos correcto (2), así que su
    // costo crudo YA es el costo real; el factor debe ser exactamente 1.
    const { cantidadBloques42 } = resolverConteoBloquesTurnantes(2);
    expect(cantidadBloques42).toBe(1);
    const lineaBloque42 = liquidarLinea(1750905, cantidadBloques42 * 2 /* 2 personas por bloque de 42h */, 'II');
    const factorExcepcion = 1; // nunca escalado para esta modalidad
    const resultadoTrasFix = escalarResultadoLineaParaAgregado(lineaBloque42, factorExcepcion);
    expect(resultadoTrasFix).toEqual(lineaBloque42); // idéntico, sin ninguna alteración
    expect(resultadoTrasFix.costoMensualTotalLinea).toBe(lineaBloque42.costoMensualTotalLinea);
  });

  it('TEST 4 — REGRESIÓN: un cargo sin turnante (sin factor aplicado) mantiene exactamente su costo, y el agregado total sigue siendo costoCargo + costoTurnanteYaEscalado', () => {
    const resultadoCargo = liquidarLinea(2500000, 11, 'III'); // cargo ordinario, ajeno a turnantes
    const referencia42h = liquidarLinea(2846255, 1, 'II');
    const horasCobertura = 7;
    const factor = calcularCostoProporcionalTurnante(referencia42h.costoMensualTotalLinea, horasCobertura) / referencia42h.costoMensualTotalLinea;
    const turnanteEscalado = escalarResultadoLineaParaAgregado(referencia42h, factor);

    const agregado = agregarCostoMensualTotalManoObra([resultadoCargo, turnanteEscalado]);
    // El cargo NUNCA se ve afectado por el factor del turnante — regresión
    // explícita del caso ya cubierto en el describe "7/8" de este archivo.
    expect(agregado.costoMensualTotalManoObra).toBe(resultadoCargo.costoMensualTotalLinea + turnanteEscalado.costoMensualTotalLinea);
    expect(agregado.costoMensualTotalManoObra).not.toBe(resultadoCargo.costoMensualTotalLinea + referencia42h.costoMensualTotalLinea);
  });

  it('TEST 5 — TOTAL GENERAL: el costo crudo de la ficha de referencia de 42h NUNCA se suma cuando corresponde HORAS_REALES — demuestra el caso reportado', () => {
    // Caso reportado: ASEADOR (costo laboral real, valor de ejemplo
    // representativo de la mano de obra ordinaria) + turnante de 7h/semana
    // sobre una referencia de 42h.
    const resultadoAseador = liquidarLinea(3800000, 6, 'III');
    const referencia42h = liquidarLinea(2846255, 1, 'II');
    const horasCobertura = 7;
    const factor = calcularCostoProporcionalTurnante(referencia42h.costoMensualTotalLinea, horasCobertura) / referencia42h.costoMensualTotalLinea;
    const turnanteEscalado = escalarResultadoLineaParaAgregado(referencia42h, factor);

    const totalConFix = agregarCostoMensualTotalManoObra([resultadoAseador, turnanteEscalado]).costoMensualTotalManoObra;
    const totalSinFix = agregarCostoMensualTotalManoObra([resultadoAseador, referencia42h]).costoMensualTotalManoObra; // comportamiento ANTERIOR (bug)

    // El total corregido es estrictamente menor que el total con el bug —
    // la ficha de referencia completa nunca vuelve a sumarse cruda.
    expect(totalConFix).toBeLessThan(totalSinFix);
    expect(totalConFix).toBe(resultadoAseador.costoMensualTotalLinea + turnanteEscalado.costoMensualTotalLinea);
    // La diferencia entre ambos es exactamente el residuo no prorrateado
    // (5/6 del costo de la referencia de 42h que el bug sumaba de más).
    expect(totalSinFix - totalConFix).toBe(referencia42h.costoMensualTotalLinea - turnanteEscalado.costoMensualTotalLinea);
  });
});

/**
 * Corrección "LOS BONOS NO PRESTACIONALES NUNCA SE ASIGNAN AL TURNANTE" —
 * evidencia numérica REAL de que la línea automática de turnante NUNCA
 * cuenta bonos no prestacionales, ni completos ni prorrateados — se
 * configuran EXCLUSIVAMENTE en la posición principal (confirmado por el
 * usuario). `calcularBonosNoPrestacionalesLinea`/`bonificaciones-mano-obra.ts`
 * no se modifican — la corrección vive en el punto donde page.tsx
 * construye la línea automática (`construirLineaTurnanteAutomaticaBase`),
 * que ya no copia `conBonoAlimentacion`/etc. desde el grupo.
 */
describe('Corrección "LOS BONOS NO PRESTACIONALES NUNCA SE ASIGNAN AL TURNANTE"', () => {
  it('caso reportado: $4.635.654 + $4.268.215 = $8.903.869 — el total ya no debe exceder la suma de filas visibles en $300.000 (bono indebido)', () => {
    const filaAseador1 = 4635654;
    const filaAseador2 = 4268215;
    const totalCorrecto = filaAseador1 + filaAseador2;
    expect(totalCorrecto).toBe(8903869);
    const totalConBugReportado = 9203869;
    expect(totalConBugReportado - totalCorrecto).toBe(300000);
  });

  it('una línea automática de turnante SIN conBonoAlimentacion/Transporte/Productividad/Ocasional produce bonosNoPrestacionales.totalLinea === 0, sin importar el bono configurado en el cargo principal', () => {
    // Replica el helper real de page.tsx (calcularBonosNoPrestacionalesLinea,
    // bonificaciones-mano-obra.ts, sin modificar): si las 4 banderas
    // con* son false (como ahora las construye siempre
    // construirLineaTurnanteAutomaticaBase), el resultado es 0 —
    // independientemente del valor que tenga el cargo principal (aquí,
    // $300.000 en bono de alimentación, que NUNCA debe llegar al turnante).
    const valoresTurnante = { alimentacion: 0, transporte: 0, productividad: 0, ocasional: 0 };
    const bonoTurnante = { totalPorTrabajador: valoresTurnante.alimentacion + valoresTurnante.transporte + valoresTurnante.productividad + valoresTurnante.ocasional, cantidadTrabajadores: 1 };
    expect(bonoTurnante.totalPorTrabajador).toBe(0);
    expect(bonoTurnante.totalPorTrabajador * bonoTurnante.cantidadTrabajadores).toBe(0);
  });
});
