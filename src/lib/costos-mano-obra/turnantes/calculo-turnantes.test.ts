import { describe, it, expect } from 'vitest';
import {
  calcularNecesidadTurnantes,
  cubreSieteDiasSemana,
  resolverRequiereCoberturaDescanso,
  construirGruposNecesidadTurnantes,
  clasificarModalidadTurnoParaCompensacion,
  agregarNecesidadesTurnantes,
  calcularMinutosPorDiaSemana,
  esHorarioHomogeneo,
  construirClaveCompatibilidadTurnante,
  calcularCoberturaPorPosicion,
  CONFIGURACION_TURNANTES_DEFAULT,
  DIAS_TRABAJADOS_POR_TURNANTE_ESTANDAR,
  HORAS_EFECTIVAS_DESCANSO_TURNANTE,
  resolverConteoBloquesTurnantes,
  resolverComposicionTurnantes,
  esProgramacionLunesADomingo,
  esProgramacionLunesASabado,
  calcularCompensacionLunesDomingoLunesSabado,
  CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO,
  HORAS_POR_DIA_REFERENCIA_TURNANTE,
  calcularCostoProporcionalTurnante,
  type PosicionParaTurnante,
  type PosicionElegibleTurnante,
} from './calculo-turnantes';
import type { DiaSemanaHorario, DistribucionHorarioConfigurada } from '../horarios/tipos';

const SMLMV_PRUEBA = 1750905;

/** Minutos por día homogéneos — todos los 7 días con la misma duración. */
const minutosPorDiaHomogeneo = (horasTurnoDiario: number): Record<DiaSemanaHorario, number> => {
  const min = horasTurnoDiario * 60;
  return { L: min, M: min, X: min, J: min, V: min, S: min, D: min };
};

/** Perfil base para construir PosicionElegibleTurnante sin repetir los 10 campos de configuración en cada test. */
function posicion(overrides: Partial<PosicionElegibleTurnante> & { cantidad: number }): PosicionElegibleTurnante {
  return {
    id: overrides.id ?? 'p',
    cantidad: overrides.cantidad,
    requiereCoberturaDescanso: overrides.requiereCoberturaDescanso ?? true,
    minutosPorDia: overrides.minutosPorDia ?? minutosPorDiaHomogeneo(8),
    salarioBase: overrides.salarioBase ?? 1200000,
    arlKey: overrides.arlKey ?? 'I',
    conBonoPrestacional: overrides.conBonoPrestacional ?? false,
    bonoPrestacionalValor: overrides.bonoPrestacionalValor ?? 0,
    conBonoAlimentacion: overrides.conBonoAlimentacion ?? false,
    bonoAlimentacionValor: overrides.bonoAlimentacionValor ?? 0,
    conBonoTransporte: overrides.conBonoTransporte ?? false,
    bonoTransporteValor: overrides.bonoTransporteValor ?? 0,
    conBonoProductividad: overrides.conBonoProductividad ?? false,
    bonoProductividadValor: overrides.bonoProductividadValor ?? 0,
    conBonoOcasional: overrides.conBonoOcasional ?? false,
    bonoOcasionalValor: overrides.bonoOcasionalValor ?? 0,
    otrosCostosPorTrabajadorFirma: overrides.otrosCostosPorTrabajadorFirma ?? 0,
    perfilCargo: overrides.perfilCargo ?? 'ASEO',
    horaInicioReferencia: overrides.horaInicioReferencia ?? '',
  };
}

describe('cubreSieteDiasSemana', () => {
  it('true cuando la unión de días cubre L-D', () => {
    expect(cubreSieteDiasSemana(['L', 'M', 'X', 'J', 'V', 'S', 'D'])).toBe(true);
  });
  it('false para un cargo de días hábiles (L-S, sin domingo)', () => {
    expect(cubreSieteDiasSemana(['L', 'M', 'X', 'J', 'V', 'S'])).toBe(false);
  });
  it('false si falta cualquier día, no solo domingo', () => {
    expect(cubreSieteDiasSemana(['L', 'M', 'X', 'J', 'S', 'D'])).toBe(false); // falta viernes
  });
});

describe('resolverRequiereCoberturaDescanso — el override manual siempre gana', () => {
  it('sin override, usa la detección automática', () => {
    expect(resolverRequiereCoberturaDescanso(true, undefined)).toBe(true);
    expect(resolverRequiereCoberturaDescanso(false, null)).toBe(false);
  });
  it('con override true, fuerza elegible aunque la detección sea false', () => {
    expect(resolverRequiereCoberturaDescanso(false, true)).toBe(true);
  });
  it('con override false, fuerza no-elegible aunque la detección sea true', () => {
    expect(resolverRequiereCoberturaDescanso(true, false)).toBe(false);
  });
});

describe('§3 — calcularMinutosPorDiaSemana y esHorarioHomogeneo', () => {
  function distribHorarioDetallado(dias: DiaSemanaHorario[], horas: number): DistribucionHorarioConfigurada {
    return {
      idCliente: 'd', empresa: '', codigo: '', horario: '', jornada: '', turno: '',
      diasSemana: dias, excepcionesFecha: [], sincronizadoExterno: false,
      tipoCapturaHorario: 'HORARIO_DETALLADO', distribucionInferida: false,
      bloques: [{ inicio: '08:00', fin: String(8 + horas).padStart(2, '0') + ':00', orden: 1 }],
    };
  }

  it('caso obligatorio 8/6/4 — L-V 8h, Sábado 6h, Domingo 4h: NO homogéneo, minutos correctos por día', () => {
    const distribuciones: DistribucionHorarioConfigurada[] = [
      distribHorarioDetallado(['L', 'M', 'X', 'J', 'V'], 8),
      distribHorarioDetallado(['S'], 6),
      distribHorarioDetallado(['D'], 4),
    ];
    const minutosPorDia = calcularMinutosPorDiaSemana(distribuciones);
    expect(minutosPorDia.L).toBe(8 * 60);
    expect(minutosPorDia.S).toBe(6 * 60);
    expect(minutosPorDia.D).toBe(4 * 60);
    expect(esHorarioHomogeneo(minutosPorDia)).toBe(false);
  });

  it('un horario uniforme de 8h los 7 días SÍ es homogéneo', () => {
    const minutosPorDia = minutosPorDiaHomogeneo(8);
    expect(esHorarioHomogeneo(minutosPorDia)).toBe(true);
  });

  it('TOTAL_SEMANAL siempre produce un resultado homogéneo (reparto uniforme entre los días seleccionados, única fuente disponible)', () => {
    const distribucion: DistribucionHorarioConfigurada = {
      idCliente: 'd', empresa: '', codigo: '', horario: '', jornada: '', turno: '',
      diasSemana: ['L', 'M', 'X', 'J', 'V', 'S', 'D'], bloques: [], excepcionesFecha: [], sincronizadoExterno: false,
      tipoCapturaHorario: 'TOTAL_SEMANAL', horasSemanalesManual: 42, distribucionInferida: false,
    };
    const minutosPorDia = calcularMinutosPorDiaSemana([distribucion]);
    expect(esHorarioHomogeneo(minutosPorDia)).toBe(true);
    expect(minutosPorDia.L).toBeCloseTo((42 * 60) / 7, 5);
  });
});

describe('§12 — Corrección "REGLA DE NEGOCIO — HORAS DEL TURNANTE" — cada descanso equivale SIEMPRE a HORAS_EFECTIVAS_DESCANSO_TURNANTE (7h fijas), nunca a la duración real programada del día', () => {
  it('HORAS_EFECTIVAS_DESCANSO_TURNANTE es 7 — única fuente de verdad, no un literal disperso', () => {
    expect(HORAS_EFECTIVAS_DESCANSO_TURNANTE).toBe(7);
    expect(CONFIGURACION_TURNANTES_DEFAULT.horasEfectivasDescansoTurnante).toBe(7);
  });

  it('una posición de 8h/día (06:00-14:00, 8h de amplitud): el relevo es 7h fijas, NUNCA 8h', () => {
    const r = calcularNecesidadTurnantes([
      { id: 'x', cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaHomogeneo(8) },
    ]);
    expect(r.horasRelevoSemanales).toBe(7);
    expect(r.metodoCalculoRelevo).toBe('EXACTO'); // siempre exacto, nunca un promedio pendiente
  });

  it('una posición con un turno de 12h de amplitud: el relevo sigue siendo 7h fijas, NUNCA 12h', () => {
    const r = calcularNecesidadTurnantes([
      { id: 'x', cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaHomogeneo(12) },
    ]);
    expect(r.horasRelevoSemanales).toBe(7);
  });

  it('una posición de 4h/día: el relevo TAMPOCO se reduce a 4h — sigue siendo 7h fijas (la regla no es un tope, es un valor fijo)', () => {
    const r = calcularNecesidadTurnantes([
      { id: 'x', cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaHomogeneo(4) },
    ]);
    expect(r.horasRelevoSemanales).toBe(7);
  });

  it('horario no homogéneo entre días (L-V 8h, Sáb 6h, Dom 4h): el relevo sigue siendo 7h fijas — la heterogeneidad del horario real es irrelevante para esta regla', () => {
    const minutosPorDia: Record<DiaSemanaHorario, number> = { L: 480, M: 480, X: 480, J: 480, V: 480, S: 360, D: 240 };
    const r = calcularNecesidadTurnantes([{ id: 'x', cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia }]);
    expect(r.horasRelevoSemanales).toBe(7);
    expect(r.metodoCalculoRelevo).toBe('EXACTO');
  });

  it('PRUEBA 5 — cambiar el horario visible (8h → 12h → 4h → no homogéneo) NUNCA cambia las 7 horas por descanso, sin excepción empresarial configurada', () => {
    const variantes = [
      minutosPorDiaHomogeneo(8), minutosPorDiaHomogeneo(12), minutosPorDiaHomogeneo(4),
      { L: 480, M: 480, X: 480, J: 480, V: 480, S: 360, D: 240 } as Record<DiaSemanaHorario, number>,
    ];
    for (const minutosPorDia of variantes) {
      const r = calcularNecesidadTurnantes([{ id: 'x', cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia }]);
      expect(r.horasRelevoSemanales).toBe(7);
    }
  });

  it('config personalizada con horasEfectivasDescansoTurnante distinto (ej. excepción empresarial a 8h) usa ESE valor, no el default hardcodeado', () => {
    const CONFIG_EXCEPCION = { ...CONFIGURACION_TURNANTES_DEFAULT, horasEfectivasDescansoTurnante: 8 };
    const r = calcularNecesidadTurnantes(
      [{ id: 'x', cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaHomogeneo(4) }],
      CONFIG_EXCEPCION,
    );
    expect(r.horasRelevoSemanales).toBe(8); // usa la excepción de config, no el default de 7
  });

  // Ajuste "AJUSTAR INTEGRALMENTE EL MOTOR Y LAS FICHAS DE TURNANTES" — la
  // cantidad física ya NO se calcula agrupando primero todas las horas del
  // grupo ("regla de 6 días"); se calcula POR POSICIÓN: cada posición con
  // 7h de cobertura requiere 1 contrato de 21h (resolverConfiguracionTurnantes,
  // reutilizada sin cambios) — cantidadTurnantesFisicos = 1 × posicionesElegibles,
  // NUNCA ceil(descansosSemanalesACubrir/6). La capacidad contratada por
  // posición (21h) SIEMPRE excede su propia demanda (7h) — utilización
  // 33,33% en todos los casos con cobertura de 7h, sin importar cuántas
  // posiciones haya (cada una tiene SU PROPIO contrato de 21h, nunca
  // comparte capacidad con otra).
  it('CASO 1 — un descanso (1 posición): 7 horas requeridas, 1 turnante de 21h, utilizada 7, disponible 14, utilización 33,33%', () => {
    const r = calcularNecesidadTurnantes([{ id: 'x', cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaHomogeneo(8) }]);
    expect(r.horasRelevoSemanales).toBe(7);
    expect(r.cantidadTurnantesFisicos).toBe(1);
    expect(r.capacidadOrdinariaMinutos / 60).toBe(21);
    expect(r.horasCapacidadUtilizada).toBe(7);
    expect(r.horasCapacidadDisponible).toBe(14);
    expect(r.porcentajeUtilizacion).toBeCloseTo(33.33, 2);
  });

  it('CASO 2 — dos descansos (mismo cargo, 2 posiciones): 2 turnantes de 21h (nunca 1 de 42h), 14 horas requeridas, utilizada 14, disponible 28, utilización 33,33%', () => {
    const r = calcularNecesidadTurnantes([{ id: 'x', cantidad: 2, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaHomogeneo(8) }]);
    expect(r.horasRelevoSemanales).toBe(14);
    expect(r.cantidadTurnantesFisicos).toBe(2); // 2 contratos de 21h, no 1 de 42h
    expect(r.bloquesTurnantesContratados).toEqual([{ horasContratadas: 21 }, { horasContratadas: 21 }]);
    expect(r.capacidadOrdinariaMinutos / 60).toBe(42);
    expect(r.horasCapacidadUtilizada).toBe(14);
    expect(r.horasCapacidadDisponible).toBe(28);
    expect(r.porcentajeUtilizacion).toBeCloseTo(33.33, 2);
  });

  it('CASO 3 — seis descansos (6 posiciones): 6 turnantes de 21h (126h de capacidad), utilizada 42, disponible 84, utilización 33,33% (nunca 100% — cada posición tiene su propio contrato, sin compartir capacidad)', () => {
    const r = calcularNecesidadTurnantes([{ id: 'x', cantidad: 6, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaHomogeneo(8) }]);
    expect(r.horasRelevoSemanales).toBe(42);
    expect(r.cantidadTurnantesFisicos).toBe(6);
    expect(r.capacidadOrdinariaMinutos / 60).toBe(126);
    expect(r.porcentajeUtilizacion).toBeCloseTo(33.33, 2);
    expect(r.horasCapacidadDisponible).toBe(84);
    expect(r.coberturaCompleta).toBe(true);
  });

  it('CASO 4 — siete descansos (7 posiciones): 7 turnantes de 21h (147h de capacidad), utilizada 49, sin horas pendientes (cobertura siempre completa en el modelo por posición)', () => {
    const r = calcularNecesidadTurnantes([{ id: 'x', cantidad: 7, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaHomogeneo(8) }]);
    expect(r.horasRelevoSemanales).toBe(49);
    expect(r.cantidadTurnantesFisicos).toBe(7); // 1 contrato de 21h por posición, nunca ceil(7/6)
    expect(r.capacidadOrdinariaMinutos / 60).toBe(147);
    expect(r.horasCapacidadUtilizada).toBe(49);
    expect(r.horasResiduales).toBe(0);
    expect(r.coberturaCompleta).toBe(true);
  });
});

describe('calcularNecesidadTurnantes — regresiones y bordes', () => {
  it('Ajuste "AJUSTAR INTEGRALMENTE EL MOTOR..." — con horasEfectivasDescansoTurnante:24 (excepción de config), la cobertura por posición (24h) excede 21h → 1 contrato de 42h por posición; 6 posiciones → 6 turnantes de 42h (252h de capacidad), SIEMPRE cubre por completo (nunca déficit, resolverConfiguracionTurnantes garantiza cobertura)', () => {
    const CONFIG_EXCEPCION = { ...CONFIGURACION_TURNANTES_DEFAULT, horasEfectivasDescansoTurnante: 24 };
    const r = calcularNecesidadTurnantes([
      { id: 'x', cantidad: 6, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaHomogeneo(8) },
    ], CONFIG_EXCEPCION);
    expect(r.cantidadTurnantesFisicos).toBe(6); // 1 contrato de 42h por posición, nunca 1 turnante compartido
    expect(r.bloquesTurnantesContratados.every(b => b.horasContratadas === 42)).toBe(true);
    expect(r.horasRelevoSemanales).toBe(144); // 6 × 1 × 24h
    expect(r.capacidadOrdinariaMinutos / 60).toBe(252); // 6 × 42h
    expect(r.coberturaCompleta).toBe(true); // sin déficit — cada posición tiene su propio contrato de 42h
    expect(r.horasResiduales).toBe(0);
  });

  it('cobertura completa: cuando la capacidad ordinaria alcanza (siempre, en el modelo por posición), coberturaCompleta=true, estado COBERTURA_COMPLETA y COSTO_COMPLETO', () => {
    const r = calcularNecesidadTurnantes([
      { id: 'x', cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaHomogeneo(6) },
    ]);
    // El relevo es SIEMPRE 7h fijas (§12), independiente de las 6h reales programadas ese día.
    expect(r.minutosRelevoSemanales).toBe(420);
    expect(r.capacidadOrdinariaMinutos).toBe(1260); // 1 contrato de 21h = 1260min
    expect(r.minutosResiduales).toBe(0);
    expect(r.coberturaCompleta).toBe(true);
    expect(r.estadoCobertura).toBe('COBERTURA_COMPLETA');
    expect(r.estadoCosto).toBe('COSTO_COMPLETO');
    expect(r.advertencias).toEqual([]);
  });

describe('§9 — capacidad utilizada/disponible/utilización (Modelo A, transparencia — corrección DOBLE CONTEO aprobada)', () => {
  it('CASO 1 — una posición L-D 8h/día: relevo 7h (capado por §12 — jornada legal diaria), 1 turnante de 21h, capacidad disponible 14, utilización 33,33%, sin horas duplicadas', () => {
    const r = calcularNecesidadTurnantes([
      { id: 'x', cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaHomogeneo(8) },
    ]);
    // Fórmula de relevo por descanso: 1 día, capado a la jornada legal
    // diaria (§12, 42÷6=7h) aunque el titular tenga 8h programadas ese
    // día — NO se implementa 56-42=14, por instrucción explícita del
    // negocio, y el relevo NUNCA excede la jornada legal diaria.
    expect(r.horasRelevoSemanales).toBe(7);
    expect(r.cantidadTurnantesFisicos).toBe(1);
    expect(r.capacidadOrdinariaMinutos / 60).toBe(21);
    expect(r.horasCapacidadUtilizada).toBe(7);
    expect(r.horasCapacidadDisponible).toBe(14);
    expect(r.porcentajeUtilizacion).toBeCloseTo(33.33, 2);
    expect(r.horasResiduales).toBe(0); // sin déficit — la capacidad contratada alcanza
    expect(r.coberturaCompleta).toBe(true);
    // Invariante: utilizada + disponible = capacidad contratada, siempre.
    expect(r.capacidadUtilizadaMinutos + r.capacidadDisponibleMinutos).toBe(r.capacidadOrdinariaMinutos);
  });

  it('CASO 2 — una posición L-S 8h/día (sin domingo): no requiere turnante por descanso de séptimo día — cubreSieteDiasSemana=false', () => {
    const diasUnion: DiaSemanaHorario[] = ['L', 'M', 'X', 'J', 'V', 'S'];
    expect(cubreSieteDiasSemana(diasUnion)).toBe(false);
    const requiere = resolverRequiereCoberturaDescanso(cubreSieteDiasSemana(diasUnion), undefined);
    const r = calcularNecesidadTurnantes([
      { id: 'x', cantidad: 1, requiereCoberturaDescanso: requiere, minutosPorDia: { L: 480, M: 480, X: 480, J: 480, V: 480, S: 480, D: 0 } },
    ]);
    expect(r.posicionesElegibles).toBe(0);
    expect(r.cantidadTurnantesFisicos).toBe(0);
    expect(r.estadoCobertura).toBe('SIN_NECESIDAD');
  });

  it('CASO 3 — una posición de 42h exactas en seis días: no requiere turnante (mismo mecanismo del CASO 2, confirmado con horas límite exactas)', () => {
    const requiere = resolverRequiereCoberturaDescanso(cubreSieteDiasSemana(['L', 'M', 'X', 'J', 'V', 'S']), undefined);
    const r = calcularNecesidadTurnantes([
      { id: 'x', cantidad: 1, requiereCoberturaDescanso: requiere, minutosPorDia: { L: 420, M: 420, X: 420, J: 420, V: 420, S: 420, D: 0 } },
    ]);
    expect(r.cantidadTurnantesFisicos).toBe(0);
    expect(r.posicionesElegibles).toBe(0);
  });

  it('CASO 4 — seis posiciones L-D 7h/día: 6 turnantes de 21h (126h de capacidad), utilizada 42h, disponible 84h, utilización 33,33% (nunca 100% — cada posición tiene su propio contrato)', () => {
    const r = calcularNecesidadTurnantes([
      { id: 'x', cantidad: 6, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaHomogeneo(7) },
    ]);
    expect(r.cantidadTurnantesFisicos).toBe(6);
    expect(r.horasRelevoSemanales).toBe(42); // 6 × 1 día × 7h
    expect(r.capacidadOrdinariaMinutos / 60).toBe(126);
    expect(r.horasCapacidadUtilizada).toBe(42);
    expect(r.horasCapacidadDisponible).toBe(84);
    expect(r.porcentajeUtilizacion).toBeCloseTo(33.33, 2);
    expect(r.horasResiduales).toBe(0);
    expect(r.coberturaCompleta).toBe(true);
  });

  it('CASO 7 — varias posiciones (varios grupos): agregarNecesidadesTurnantes consolida capacidad utilizada/disponible/utilización sin duplicar', () => {
    const grupoA = calcularNecesidadTurnantes([{ id: 'a', cantidad: 1, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaHomogeneo(8) }]); // CASO 1: util=7, disp=14, capacidad=21
    const grupoB = calcularNecesidadTurnantes([{ id: 'b', cantidad: 6, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaHomogeneo(7) }]); // CASO 4: util=42, disp=84, capacidad=126
    const agregado = agregarNecesidadesTurnantes([grupoA, grupoB]);
    expect(agregado.capacidadOrdinariaMinutos / 60).toBe(147); // 21+126
    expect(agregado.horasCapacidadUtilizada).toBe(49); // 7+42
    expect(agregado.horasCapacidadDisponible).toBe(98); // 14+84
    expect(agregado.porcentajeUtilizacion).toBeCloseTo((49 / 147) * 100, 2);
    expect(agregado.capacidadUtilizadaMinutos + agregado.capacidadDisponibleMinutos).toBe(agregado.capacidadOrdinariaMinutos);
  });

  it('porcentajeUtilizacion es 0 (nunca NaN/Infinity) cuando no hay capacidad contratada', () => {
    const r = calcularNecesidadTurnantes([]);
    expect(r.capacidadOrdinariaMinutos).toBe(0);
    expect(r.porcentajeUtilizacion).toBe(0);
    expect(Number.isFinite(r.porcentajeUtilizacion)).toBe(true);
  });
});

describe('§10 — VALIDAR LINEACUBIERTAPORTURNANTE: cobertura POR POSICIÓN (calcularCoberturaPorPosicion), nunca una condición grupal única', () => {
  it('ESCENARIO A — una sola línea, demanda 8h/día (capada a 7h por §12), capacidad 42h: cubierta completamente', () => {
    const posiciones = [posicion({ id: 'aseador', cantidad: 1, minutosPorDia: minutosPorDiaHomogeneo(8) })];
    const cobertura = calcularCoberturaPorPosicion(posiciones);
    expect(cobertura).toHaveLength(1);
    expect(cobertura[0]).toMatchObject({ id: 'aseador', minutosRelevoPosicion: 420, minutosCubiertos: 420, cubiertaCompleta: true });
  });

  it('ESCENARIO B — varias líneas, demanda total ≤ capacidad: TODAS las posiciones quedan cubiertas completamente', () => {
    // 3 líneas de 1 posición c/u, 8h/día (capado a 7h por §12) → 7h de relevo cada una = 21h totales, capacidad de 1 turnante = 42h.
    const posiciones = [
      posicion({ id: 'p1', cantidad: 1, minutosPorDia: minutosPorDiaHomogeneo(8) }),
      posicion({ id: 'p2', cantidad: 1, minutosPorDia: minutosPorDiaHomogeneo(8) }),
      posicion({ id: 'p3', cantidad: 1, minutosPorDia: minutosPorDiaHomogeneo(8) }),
    ];
    const cobertura = calcularCoberturaPorPosicion(posiciones);
    expect(cobertura).toHaveLength(3);
    for (const c of cobertura) expect(c.cubiertaCompleta).toBe(true);
    expect(cobertura.reduce((s, c) => s + c.minutosCubiertos, 0)).toBe(3 * 420);
  });

  it('ESCENARIO C — Ajuste "AJUSTAR INTEGRALMENTE EL MOTOR..." — cada posición tiene SU PROPIO contrato (nunca capacidad compartida entre posiciones): con 6 líneas de 1 posición cada una, TODAS quedan cubiertas por completo, nunca una "primero en la lista" a costa de otra', () => {
    const CONFIG_EXCEPCION = { ...CONFIGURACION_TURNANTES_DEFAULT, horasEfectivasDescansoTurnante: 8 };
    const posiciones = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id) =>
      posicion({ id, cantidad: 1 }),
    );
    const cobertura = calcularCoberturaPorPosicion(posiciones, CONFIG_EXCEPCION);
    expect(cobertura).toHaveLength(6);
    expect(cobertura.every((c) => c.cubiertaCompleta)).toBe(true);
    // Cada posición recibe exactamente su propia demanda cubierta — nunca
    // un prorrateo ni una cobertura parcial: 1 día × 8h (excepción) = 480min por posición.
    expect(cobertura.every((c) => c.minutosRelevoPosicion === 480 && c.minutosCubiertos === 480)).toBe(true);
  });

  it('ESCENARIO D — Ajuste "AJUSTAR INTEGRALMENTE EL MOTOR..." — cada posición tiene su propio contrato garantizado por resolverConfiguracionTurnantes: incluso con 50 posiciones, coberturaCompleta=true SIEMPRE (nunca un déficit por capacidad compartida)', () => {
    const CONFIG_EXCEPCION = { ...CONFIGURACION_TURNANTES_DEFAULT, horasEfectivasDescansoTurnante: 8 };
    const r = calcularNecesidadTurnantes([posicion({ id: 'masiva', cantidad: 50 })], CONFIG_EXCEPCION);
    expect(r.horasRelevoSemanales).toBe(400); // 50 × 1 día × 8h
    expect(r.cantidadTurnantesFisicos).toBe(50); // 1 contrato de 21h por posición (8h≤21h)
    expect(r.capacidadOrdinariaMinutos / 60).toBe(1050); // 50 × 21h
    expect(r.coberturaCompleta).toBe(true);
    expect(r.horasResiduales).toBe(0);
  });
});

describe('§11 — Corrección "BOLSA CONSOLIDADA DE CAPACIDAD" — casos de prueba aprobados (pool real entre cargos con configuración idéntica)', () => {
  it('CASO 1 — un solo cargo con 12h/día L-D (excepción de negocio, paradigma de bloques): capacidad utilizada 7, disponible 14, no duplica costo (una sola línea de turnante en el grupo)', () => {
    const posiciones = [posicion({ id: 'aseador', cantidad: 1, perfilCargo: 'ASEADOR', minutosPorDia: minutosPorDiaHomogeneo(12) })];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(1); // una sola línea de turnante para todo el pool
    expect(grupos[0].necesidad.horasCapacidadUtilizada).toBe(7);
    expect(grupos[0].necesidad.horasCapacidadDisponible).toBe(14); // 1 contrato de 21h - 7h usadas
    expect(grupos[0].perfilesCargoIncluidos).toEqual(['ASEADOR']);
  });

  it('CASO 2 — Ajuste "NO COMPARTIR TURNANTE ENTRE CARGOS DISTINTOS": dos cargos DISTINTOS con 12h/día L-D cada uno (misma config salarial) YA NO se consolidan — cada uno recibe su propio turnante dedicado', () => {
    const posiciones = [
      posicion({ id: 'aseador', cantidad: 1, perfilCargo: 'ASEADOR', minutosPorDia: minutosPorDiaHomogeneo(12) }),
      posicion({ id: 'conserje', cantidad: 1, perfilCargo: 'CONSERJE', minutosPorDia: minutosPorDiaHomogeneo(12) }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(2); // un turnante dedicado POR CARGO, nunca uno compartido
    for (const g of grupos) {
      expect(g.necesidad.cantidadTurnantesFisicos).toBe(1);
      expect(g.necesidad.horasRelevoSemanales).toBe(7);
      expect(g.necesidad.horasCapacidadUtilizada).toBe(7);
      expect(g.necesidad.horasCapacidadDisponible).toBe(14);
      expect(g.coberturaPorPosicion.every((c) => c.cubiertaCompleta)).toBe(true);
    }
    expect(grupos.map((g) => g.perfilesCargoIncluidos[0]).sort()).toEqual(['ASEADOR', 'CONSERJE']);
  });

  it('CASO 3 — 6 cargos DISTINTOS de 12h/día L-D cada uno YA NO se consolidan en un turnante de 42h: cada cargo recibe su propio turnante, con su propia demanda de 7h (nunca 100% de utilización compartida)', () => {
    const posiciones = Array.from({ length: 6 }, (_, i) => posicion({ id: `p${i}`, cantidad: 1, perfilCargo: `CARGO_${i}`, minutosPorDia: minutosPorDiaHomogeneo(12) }));
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(6);
    for (const g of grupos) {
      expect(g.necesidad.cantidadTurnantesFisicos).toBe(1);
      expect(g.necesidad.horasRelevoSemanales).toBe(7);
      expect(g.necesidad.horasCapacidadDisponible).toBe(14);
      expect(g.coberturaPorPosicion.every((c) => c.cubiertaCompleta)).toBe(true);
    }
  });

  it('CASO 4 — 10 cargos DISTINTOS con misma config salarial YA NO comparten pool: 10 turnantes dedicados, uno por cargo (nunca 2 turnantes consolidados)', () => {
    // Excepción empresarial horasEfectivasDescansoTurnante:5 (§12, mismo
    // mecanismo ya validado en la prueba "config personalizada..." más
    // arriba): cada cargo, 1 posición × 1 día de descanso × 5h = 5h de relevo.
    const CONFIG_EXCEPCION = { ...CONFIGURACION_TURNANTES_DEFAULT, horasEfectivasDescansoTurnante: 5 };
    const posiciones = Array.from({ length: 10 }, (_, i) =>
      posicion({ id: `p${i}`, cantidad: 1, perfilCargo: `CARGO_${i}`, minutosPorDia: minutosPorDiaHomogeneo(12) }),
    );
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA, CONFIG_EXCEPCION);
    expect(grupos).toHaveLength(10); // un turnante dedicado por cada uno de los 10 cargos
    for (const g of grupos) {
      expect(g.necesidad.horasRelevoSemanales).toBe(5);
      expect(g.necesidad.cantidadTurnantesFisicos).toBe(1);
      expect(g.necesidad.capacidadOrdinariaMinutos / 60).toBe(21); // 1 contrato de 21h (5h≤21h)
      expect(g.necesidad.horasCapacidadUtilizada).toBe(5);
      expect(g.necesidad.horasCapacidadDisponible).toBe(16);
      expect(g.perfilesCargoIncluidos).toHaveLength(1);
    }
  });

  it('CASO 5 — varios cargos DISTINTOS, cada uno aislado: la suma de minutosCubiertos por posición coincide EXACTAMENTE con capacidadUtilizadaMinutos de SU PROPIO grupo (sin pérdidas de redondeo, trazabilidad completa)', () => {
    const posiciones = Array.from({ length: 9 }, (_, i) => posicion({ id: `p${i}`, cantidad: 1, perfilCargo: `CARGO_${i}`, minutosPorDia: minutosPorDiaHomogeneo(8) }));
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(9); // cada cargo, su propio grupo aislado
    for (const g of grupos) {
      const sumaCubiertos = g.coberturaPorPosicion.reduce((s, c) => s + c.minutosCubiertos, 0);
      expect(sumaCubiertos).toBe(g.necesidad.capacidadUtilizadaMinutos);
      expect(sumaCubiertos).toBe(g.necesidad.minutosRelevoSemanales); // cobertura completa: todo lo requerido cae dentro de la capacidad
    }
  });

  it('demanda 0 (sin posiciones elegibles): no se crea ningún grupo/línea de turnante', () => {
    const posiciones = [posicion({ id: 'x', cantidad: 5, requiereCoberturaDescanso: false })];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(0);
  });
});

  it('posiciones de días hábiles (requiereCoberturaDescanso:false) no generan necesidad', () => {
    const r = calcularNecesidadTurnantes([
      { id: 'todero', cantidad: 5, requiereCoberturaDescanso: false, minutosPorDia: minutosPorDiaHomogeneo(8) },
      { id: 'jardinero', cantidad: 3, requiereCoberturaDescanso: false, minutosPorDia: minutosPorDiaHomogeneo(8) },
    ]);
    expect(r.posicionesElegibles).toBe(0);
    expect(r.cantidadTurnantesFisicos).toBe(0);
    expect(r.estadoCobertura).toBe('SIN_NECESIDAD');
    expect(r.estadoCosto).toBe('COSTO_COMPLETO');
  });

  it('una posición sin continuidad obligatoria (override false) no genera turnante, aunque cubra 7 días', () => {
    const deteccionAutomatica = cubreSieteDiasSemana(['L', 'M', 'X', 'J', 'V', 'S', 'D']);
    const requiere = resolverRequiereCoberturaDescanso(deteccionAutomatica, false);
    const r = calcularNecesidadTurnantes([
      { id: 'x', cantidad: 4, requiereCoberturaDescanso: requiere, minutosPorDia: minutosPorDiaHomogeneo(8) },
    ]);
    expect(deteccionAutomatica).toBe(true);
    expect(requiere).toBe(false);
    expect(r.cantidadTurnantesFisicos).toBe(0);
  });

  it('cambiar la cantidad recalcula inmediatamente (función pura, sin estado) — 1 contrato de 21h por posición, escala linealmente con la cantidad', () => {
    const base: PosicionParaTurnante = { id: 'x', cantidad: 11, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaHomogeneo(8) };
    expect(calcularNecesidadTurnantes([base]).cantidadTurnantesFisicos).toBe(11);
    expect(calcularNecesidadTurnantes([{ ...base, cantidad: 12 }]).cantidadTurnantesFisicos).toBe(12);
    expect(calcularNecesidadTurnantes([{ ...base, cantidad: 13 }]).cantidadTurnantesFisicos).toBe(13);
  });

  it('estructuras sin posiciones elegibles — resultado estable, todo en cero', () => {
    const r = calcularNecesidadTurnantes([]);
    expect(r.posicionesElegibles).toBe(0);
    expect(r.descansosSemanalesACubrir).toBe(0);
    expect(r.minutosRelevoSemanales).toBe(0);
    expect(r.cantidadTurnantesFisicos).toBe(0);
    expect(r.capacidadOrdinariaMinutos).toBe(0);
    expect(r.minutosResiduales).toBe(0);
    expect(r.coberturaCompleta).toBe(true);
    expect(r.estadoCobertura).toBe('SIN_NECESIDAD');
    expect(r.metodoCalculoRelevo).toBe('EXACTO');
  });

  it('Ajuste "AJUSTAR INTEGRALMENTE EL MOTOR..." — diasTrabajadosPorTurnante ya NO participa del cálculo de cantidadTurnantesFisicos (se conserva por compatibilidad de forma, pero cambiar su valor no altera el resultado)', () => {
    expect(DIAS_TRABAJADOS_POR_TURNANTE_ESTANDAR).toBe(6);
    expect(CONFIGURACION_TURNANTES_DEFAULT.diasTrabajadosPorTurnante).toBe(6);
    const rConfigDistinta = calcularNecesidadTurnantes(
      [{ id: 'x', cantidad: 11, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaHomogeneo(8) }],
      { ...CONFIGURACION_TURNANTES_DEFAULT, diasTrabajadosPorTurnante: 11 },
    );
    expect(rConfigDistinta.cantidadTurnantesFisicos).toBe(11); // 1 contrato de 21h × 11 posiciones, sin importar diasTrabajadosPorTurnante
  });

  it('cantidades negativas o inválidas no producen resultados negativos', () => {
    const r = calcularNecesidadTurnantes([
      { id: 'x', cantidad: -5, requiereCoberturaDescanso: true, minutosPorDia: minutosPorDiaHomogeneo(8) },
    ]);
    expect(r.posicionesElegibles).toBe(0);
    expect(r.cantidadTurnantesFisicos).toBe(0);
  });
});

describe('§1 — cálculo por grupo de configuración laboral EQUIVALENTE (bolsa consolidada — corrección "BOLSA CONSOLIDADA DE CAPACIDAD")', () => {
  it('CASO 2 — Ajuste "NO COMPARTIR TURNANTE ENTRE CARGOS DISTINTOS": 3 cargos DISTINTOS (RECEPCION/ASEO/VIGILANCIA) con la MISMA configuración salarial (salario/ARL/bonos/horario) YA NO comparten pool — cada uno recibe su propio turnante, dimensionado con SUS PROPIAS posiciones (1+1+1, nunca ceil(11/6)=2 consolidado)', () => {
    const posiciones: PosicionElegibleTurnante[] = [
      posicion({ id: 'a', cantidad: 4, perfilCargo: 'RECEPCION' }),
      posicion({ id: 'b', cantidad: 4, perfilCargo: 'ASEO' }),
      posicion({ id: 'c', cantidad: 3, perfilCargo: 'VIGILANCIA' }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    // perfilCargo SÍ es parte de la clave de compatibilidad — los 3
    // cargos, aunque su salario/ARL/bonos/horario sean idénticos (fixture
    // `posicion`), quedan en pools separados.
    expect(grupos).toHaveLength(3);
    expect(grupos.map((g) => g.perfilesCargoIncluidos[0]).sort()).toEqual(['ASEO', 'RECEPCION', 'VIGILANCIA']);
    const totalFisico = grupos.reduce((t, g) => t + g.necesidad.cantidadTurnantesFisicos, 0);
    expect(totalFisico).toBe(11); // RECEPCION: 4, ASEO: 4, VIGILANCIA: 3 — 1 contrato de 21h por posición
  });

  it('cargos con configuración salarial DISTINTA nunca comparten pool (y, desde el ajuste "NO COMPARTIR TURNANTE ENTRE CARGOS DISTINTOS", tampoco lo hacen aunque el salario coincida)', () => {
    const posiciones: PosicionElegibleTurnante[] = [
      posicion({ id: 'a', cantidad: 4, perfilCargo: 'RECEPCION', salarioBase: 1200000 }),
      posicion({ id: 'b', cantidad: 4, perfilCargo: 'ASEO', salarioBase: 1750905 }),
      posicion({ id: 'c', cantidad: 3, perfilCargo: 'VIGILANCIA', salarioBase: 1750905 }), // mismo salario que ASEO, pero cargo distinto → sigue incompatible
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(3); // uno por cargo, sin importar que ASEO/VIGILANCIA compartan salario
    const cantidades = grupos.map(g => g.necesidad.cantidadTurnantesFisicos).sort((a, b) => a - b);
    expect(cantidades).toEqual([3, 4, 4]); // RECEPCION: 4; ASEO: 4; VIGILANCIA: 3 — 1 contrato de 21h por posición
    const totalFisico = grupos.reduce((t, g) => t + g.necesidad.cantidadTurnantesFisicos, 0);
    expect(totalFisico).toBe(11);
  });

  it('un mismo cargo con varias posiciones (misma configuración) se sigue fusionando en 1 solo grupo — la cantidad física es la suma de posiciones (11), nunca ceil(11/6)', () => {
    const posiciones: PosicionElegibleTurnante[] = [
      posicion({ id: 'a', cantidad: 4 }),
      posicion({ id: 'b', cantidad: 4 }),
      posicion({ id: 'c', cantidad: 3 }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(1); // mismo perfilCargo por defecto en el fixture `posicion`
    expect(grupos[0].necesidad.cantidadTurnantesFisicos).toBe(11);
  });
});

describe('§2 — clave de compatibilidad: cada campo que cambia el costo mensual separa grupos', () => {
  it('grupos con igual salario pero distintos otros costos son incompatibles', () => {
    const posiciones: PosicionElegibleTurnante[] = [
      posicion({ id: 'a', cantidad: 6, otrosCostosPorTrabajadorFirma: 0 }),
      posicion({ id: 'b', cantidad: 6, otrosCostosPorTrabajadorFirma: 50000 }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(2);
  });

  it('grupos con distinto bono prestacional son incompatibles', () => {
    const posiciones: PosicionElegibleTurnante[] = [
      posicion({ id: 'a', cantidad: 6, conBonoPrestacional: true, bonoPrestacionalValor: 100000 }),
      posicion({ id: 'b', cantidad: 6, conBonoPrestacional: false }),
    ];
    expect(construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA)).toHaveLength(2);
  });

  it('grupos con distintos bonos no prestacionales son incompatibles (cada uno de los 4 conceptos)', () => {
    const base = posicion({ id: 'a', cantidad: 6 });
    const variantes: PosicionElegibleTurnante[] = [
      { ...base, id: 'alimentacion', conBonoAlimentacion: true, bonoAlimentacionValor: 50000 },
      { ...base, id: 'transporte', conBonoTransporte: true, bonoTransporteValor: 50000 },
      { ...base, id: 'productividad', conBonoProductividad: true, bonoProductividadValor: 50000 },
      { ...base, id: 'ocasional', conBonoOcasional: true, bonoOcasionalValor: 50000 },
    ];
    for (const variante of variantes) {
      const grupos = construirGruposNecesidadTurnantes([base, variante], SMLMV_PRUEBA);
      expect(grupos.length).toBe(2);
    }
  });

  it('Ajuste "NO COMPARTIR TURNANTE ENTRE CARGOS DISTINTOS" — perfil/cargo funcional SÍ separa grupos: variantes de mayúsculas del MISMO cargo se normalizan y fusionan, pero un cargo distinto nunca', () => {
    const posiciones: PosicionElegibleTurnante[] = [
      posicion({ id: 'a', cantidad: 6, perfilCargo: 'RECEPCION' }),
      posicion({ id: 'b', cantidad: 6, perfilCargo: 'recepcion' }),
      posicion({ id: 'c', cantidad: 6, perfilCargo: 'VIGILANCIA' }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(2); // RECEPCION/recepcion (mismo cargo normalizado) vs. VIGILANCIA
    const recepcion = grupos.find((g) => g.perfilesCargoIncluidos[0] === 'RECEPCION')!;
    expect(recepcion.necesidad.posicionesElegibles).toBe(12); // a+b fusionados (mismo cargo)
    const vigilancia = grupos.find((g) => g.perfilesCargoIncluidos[0] === 'VIGILANCIA')!;
    expect(vigilancia.necesidad.posicionesElegibles).toBe(6);
  });

  it('grupos con distinta jornada semanal (minutosPorDia) son incompatibles aunque el total semanal coincida en cantidad de horas', () => {
    const posiciones: PosicionElegibleTurnante[] = [
      posicion({ id: 'a', cantidad: 6, minutosPorDia: minutosPorDiaHomogeneo(8) }),
      posicion({ id: 'b', cantidad: 6, minutosPorDia: { L: 480 * 2, M: 0, X: 480 * 2, J: 0, V: 480 * 2, S: 0, D: 480 } }), // mismo total semanal (3360), patrón distinto
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(2);
  });

  it('Ajuste "NO COMPARTIR TURNANTE ENTRE CARGOS DISTINTOS" — construirClaveCompatibilidadTurnante reporta exactamente los 11 componentes documentados, con perfilCargo PRIMERO en el orden fijado', () => {
    const p = posicion({ id: 'a', cantidad: 1, salarioBase: 1200000, arlKey: 'II', otrosCostosPorTrabajadorFirma: 30000, perfilCargo: 'aseo' });
    const clave = construirClaveCompatibilidadTurnante(p);
    const partes = clave.split('|');
    expect(partes).toHaveLength(11);
    expect(partes[0]).toBe('ASEO'); // perfilCargo normalizado — PRIMER componente
    expect(partes[1]).toBe('1200000'); // salario normalizado
    expect(partes[2]).toBe('II'); // ARL
    expect(partes[3]).toBe('480,480,480,480,480,480,480'); // minutos por día L..D
    expect(partes[4]).toBe('SIN_HORA'); // horaInicioReferencia — Ajuste "COMPENSACIÓN L-D/L-S" §3/§7 (diurno/nocturno nunca deben compartir grupo)
    expect(partes[5]).toBe('0'); // bono prestacional inactivo
    expect(partes[6]).toBe('0'); // bono alimentación
    expect(partes[7]).toBe('0'); // bono transporte
    expect(partes[8]).toBe('0'); // bono productividad
    expect(partes[9]).toBe('0'); // bono ocasional
    expect(partes[10]).toBe('30000'); // otros costos por trabajador — último componente
  });
});

describe('salario — usa SMLMV únicamente cuando no existe una referencia salarial válida', () => {
  it('sin salario válido, hereda SMLMV', () => {
    const grupos = construirGruposNecesidadTurnantes(
      [posicion({ id: 'a', cantidad: 6, salarioBase: 0, arlKey: 'II' })],
      SMLMV_PRUEBA,
    );
    expect(grupos).toHaveLength(1);
    expect(grupos[0].salarioBaseHeredado).toBe(SMLMV_PRUEBA);
    expect(grupos[0].huboReferenciaSalarialValida).toBe(false);
  });

  it('con salario válido compartido, lo hereda directamente (nunca SMLMV)', () => {
    const grupos = construirGruposNecesidadTurnantes(
      [posicion({ id: 'a', cantidad: 6, salarioBase: 1300000 })],
      SMLMV_PRUEBA,
    );
    expect(grupos[0].salarioBaseHeredado).toBe(1300000);
    expect(grupos[0].huboReferenciaSalarialValida).toBe(true);
  });
});

describe('grupos que no alcanzan a generar ningún turnante físico se omiten', () => {
  it('cantidad 0 no genera grupo', () => {
    expect(construirGruposNecesidadTurnantes([posicion({ id: 'a', cantidad: 0 })], SMLMV_PRUEBA)).toEqual([]);
  });
});

describe('§6 — perfil heredado por el grupo (base para la línea automática)', () => {
  it('el grupo hereda bono prestacional, los 4 bonos no prestacionales y los otros costos por trabajador del representante', () => {
    const p = posicion({
      id: 'a', cantidad: 6,
      conBonoPrestacional: true, bonoPrestacionalValor: 120000,
      conBonoAlimentacion: true, bonoAlimentacionValor: 80000,
      conBonoTransporte: true, bonoTransporteValor: 30000,
      conBonoProductividad: false, bonoProductividadValor: 0,
      conBonoOcasional: false, bonoOcasionalValor: 0,
      otrosCostosPorTrabajadorFirma: 45000,
    });
    const grupos = construirGruposNecesidadTurnantes([p], SMLMV_PRUEBA);
    expect(grupos).toHaveLength(1);
    const g = grupos[0];
    expect(g.conBonoPrestacional).toBe(true);
    expect(g.bonoPrestacionalValor).toBe(120000);
    expect(g.conBonoAlimentacion).toBe(true);
    expect(g.bonoAlimentacionValor).toBe(80000);
    expect(g.conBonoTransporte).toBe(true);
    expect(g.bonoTransporteValor).toBe(30000);
    expect(g.conBonoProductividad).toBe(false);
    expect(g.conBonoOcasional).toBe(false);
    expect(g.otrosCostosPorTrabajadorHeredado).toBe(45000);
  });
});

describe('agregarNecesidadesTurnantes — resumen para la sección visual (nunca para el costo)', () => {
  it('Ajuste "AJUSTAR INTEGRALMENTE EL MOTOR..." — suma correctamente varios grupos; la cobertura es SIEMPRE completa en el modelo por posición (nunca un déficit de capacidad compartida)', () => {
    const CONFIG_EXCEPCION = { ...CONFIGURACION_TURNANTES_DEFAULT, horasEfectivasDescansoTurnante: 8 };
    const grupoA = construirGruposNecesidadTurnantes([posicion({ id: 'a', cantidad: 3 })], SMLMV_PRUEBA); // 3 posiciones → 3 turnantes de 21h
    const grupoB = construirGruposNecesidadTurnantes(
      [posicion({ id: 'b', cantidad: 11, salarioBase: 1500000 })],
      SMLMV_PRUEBA,
      CONFIG_EXCEPCION,
    ); // 11 posiciones → 11 turnantes de 21h (8h≤21h)
    const grupos = [...grupoA, ...grupoB];
    const resumen = agregarNecesidadesTurnantes(grupos.map(g => g.necesidad));
    expect(resumen.posicionesElegibles).toBe(14);
    expect(resumen.cantidadTurnantesFisicos).toBe(3 + 11);
    expect(resumen.estadoCobertura).toBe('COBERTURA_COMPLETA'); // siempre completa — cada posición tiene su propio contrato
    expect(resumen.estadoCosto).toBe('COSTO_COMPLETO');
    // §12 — el relevo es SIEMPRE 7h fijas (o la excepción de config
    // configurada), NUNCA derivado de minutosPorDia: metodoCalculoRelevo
    // es SIEMPRE 'EXACTO', sin excepción (ver describe §12 más arriba).
    expect(resumen.metodoCalculoRelevo).toBe('EXACTO');
    expect(resumen.advertencias).toEqual([]);
  });

  it('sin grupos, retorna el resultado neutro de calcularNecesidadTurnantes([])', () => {
    const resumen = agregarNecesidadesTurnantes([]);
    expect(resumen.posicionesElegibles).toBe(0);
    expect(resumen.estadoCobertura).toBe('SIN_NECESIDAD');
    expect(resumen.estadoCosto).toBe('COSTO_COMPLETO');
    expect(resumen.coberturaCompleta).toBe(true);
    expect(resumen.metodoCalculoRelevo).toBe('EXACTO');
  });
});

// ─── Ajuste "AJUSTAR TURNANTES POR BLOQUES DE 21 Y 42 HORAS" ───────────────
describe('resolverConteoBloquesTurnantes — descompone la cantidad física en bloques de 42h + remanente de 21h', () => {
  it('1 turnante físico → 0 bloques + 1 remanente (21h)', () => {
    expect(resolverConteoBloquesTurnantes(1)).toEqual({ cantidadBloques42: 0, cantidadRemanentes21: 1, horasContratadasTotales: 21 });
  });
  it('2 turnantes físicos → 1 bloque + 0 remanente (42h)', () => {
    expect(resolverConteoBloquesTurnantes(2)).toEqual({ cantidadBloques42: 1, cantidadRemanentes21: 0, horasContratadasTotales: 42 });
  });
  it('3 turnantes físicos → 1 bloque + 1 remanente (63h)', () => {
    expect(resolverConteoBloquesTurnantes(3)).toEqual({ cantidadBloques42: 1, cantidadRemanentes21: 1, horasContratadasTotales: 63 });
  });
  it('4 turnantes físicos → 2 bloques + 0 remanente (84h)', () => {
    expect(resolverConteoBloquesTurnantes(4)).toEqual({ cantidadBloques42: 2, cantidadRemanentes21: 0, horasContratadasTotales: 84 });
  });
  it('los bloques nunca superan 42h — cada bloque es SIEMPRE exactamente 2 turnantes de 21h, nunca más', () => {
    for (const n of [5, 6, 7, 8, 11, 12]) {
      const { cantidadBloques42, cantidadRemanentes21 } = resolverConteoBloquesTurnantes(n);
      expect(cantidadBloques42 * 2 + cantidadRemanentes21).toBe(n);
      expect(cantidadRemanentes21).toBeLessThanOrEqual(1); // un remanente siempre se conserva como bloque individual de 21h, nunca se acumulan varios
    }
  });
  it('cantidadTurnantesFisicos<=0 no produce bloques ni remanente', () => {
    expect(resolverConteoBloquesTurnantes(0)).toEqual({ cantidadBloques42: 0, cantidadRemanentes21: 0, horasContratadasTotales: 0 });
  });
});

describe('resolverComposicionTurnantes — costo final del grupo, a partir de costos YA calculados por los motores reales (nunca fórmulas manuales aquí)', () => {
  // Valores de validación del ajuste (configuración actual, NUNCA
  // hardcodeados en la lógica — solo en estas pruebas, como fixtures):
  //  costoBloqueTurnante42 (motor real, línea 42h, cantOpeFijos=1 bloque) = $2.800.556
  //  costoTurnanteOrdinario21 (motor real, línea 21h, cantOpeFijos=1)     = $1.689.958
  const COSTO_BLOQUE_42 = 2800556;
  const COSTO_ORDINARIO_21 = 1689958;

  it('cantidad 1 → costoTotal = costoRemanentes21 exclusivamente (motor ordinario de 21h, nunca el 50% del bloque de 42h)', () => {
    const c = resolverComposicionTurnantes({ cantidadTurnantesFisicos: 1, costoBloques42: 0, costoRemanentes21: COSTO_ORDINARIO_21 });
    expect(c.cantidadBloques42).toBe(0);
    expect(c.cantidadRemanentes21).toBe(1);
    expect(c.costoTotal).toBe(1689958);
  });

  it('cantidad 2 → costoTotal = costoBloques42 exclusivamente (ficha actual integrada de 42h)', () => {
    const c = resolverComposicionTurnantes({ cantidadTurnantesFisicos: 2, costoBloques42: COSTO_BLOQUE_42, costoRemanentes21: 0 });
    expect(c.cantidadBloques42).toBe(1);
    expect(c.cantidadRemanentes21).toBe(0);
    expect(c.costoTotal).toBe(2800556);
  });

  it('cantidad 3 → costoTotal = costoBloques42 + costoRemanentes21 ≈ $4.490.514 (nunca 1.689.958×3 ni el 50% lineal)', () => {
    const c = resolverComposicionTurnantes({ cantidadTurnantesFisicos: 3, costoBloques42: COSTO_BLOQUE_42, costoRemanentes21: COSTO_ORDINARIO_21 });
    expect(c.cantidadBloques42).toBe(1);
    expect(c.cantidadRemanentes21).toBe(1);
    expect(c.costoTotal).toBe(COSTO_BLOQUE_42 + COSTO_ORDINARIO_21);
    expect(c.costoTotal).toBe(4490514);
  });

  it('cantidad 4 → costoTotal = 2×costoBloques42 ≈ $5.601.112 (dos bloques integrados, sin remanente)', () => {
    const c = resolverComposicionTurnantes({ cantidadTurnantesFisicos: 4, costoBloques42: COSTO_BLOQUE_42 * 2, costoRemanentes21: 0 });
    expect(c.cantidadBloques42).toBe(2);
    expect(c.cantidadRemanentes21).toBe(0);
    expect(c.costoTotal).toBe(5601112);
  });

  it('el costo se contabiliza una sola vez — costoTotal es SIEMPRE costoBloques42+costoRemanentes21, nunca una tercera fuente', () => {
    const c = resolverComposicionTurnantes({ cantidadTurnantesFisicos: 3, costoBloques42: 1000, costoRemanentes21: 500 });
    expect(c.costoTotal).toBe(1500);
  });
});

// ─── Ajuste "IMPLEMENTAR REGLA DE COMPENSACIÓN ENTRE POSICIONES DE LUNES A
//      DOMINGO Y POSICIONES EQUIVALENTES DE LUNES A SÁBADO" ───────────────
const minutosLunesASabado = (horasTurnoDiario: number): Record<DiaSemanaHorario, number> => {
  const min = horasTurnoDiario * 60;
  return { L: min, M: min, X: min, J: min, V: min, S: min, D: 0 };
};
const minutosLunesAViernes = (horasTurnoDiario: number): Record<DiaSemanaHorario, number> => {
  const min = horasTurnoDiario * 60;
  return { L: min, M: min, X: min, J: min, V: min, S: 0, D: 0 };
};

describe('esProgramacionLunesADomingo / esProgramacionLunesASabado — clasificación puramente por minutosPorDia', () => {
  it('L-D: los 7 días con minutos > 0', () => {
    expect(esProgramacionLunesADomingo(minutosPorDiaHomogeneo(12))).toBe(true);
    expect(esProgramacionLunesASabado(minutosPorDiaHomogeneo(12))).toBe(false);
  });
  it('L-S: L-M-X-J-V-S > 0 y domingo EXACTAMENTE 0', () => {
    expect(esProgramacionLunesASabado(minutosLunesASabado(12))).toBe(true);
    expect(esProgramacionLunesADomingo(minutosLunesASabado(12))).toBe(false);
  });
  it('L-V (sin sábado) NUNCA se clasifica como L-S', () => {
    expect(esProgramacionLunesASabado(minutosLunesAViernes(8))).toBe(false);
    expect(esProgramacionLunesADomingo(minutosLunesAViernes(8))).toBe(false);
  });
});

describe('calcularCompensacionLunesDomingoLunesSabado — suma y resta, nunca fila por fila', () => {
  it('1) L-D 3 y L-S 2 produce 1 turnante', () => {
    const ld = [posicion({ id: 'ld1', cantidad: 3 })];
    const ls = [posicion({ id: 'ls1', cantidad: 2, requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(8) })];
    const c = calcularCompensacionLunesDomingoLunesSabado('g', ld, ls);
    expect(c.totalPosicionesLunesDomingo).toBe(3);
    expect(c.totalPosicionesLunesSabado).toBe(2);
    expect(c.cantidadPosicionesQueRequierenTurnante).toBe(1);
  });
  it('2) L-D 2 y L-S 2 produce 0 turnantes', () => {
    const c = calcularCompensacionLunesDomingoLunesSabado('g', [posicion({ cantidad: 2 })], [posicion({ cantidad: 2 })]);
    expect(c.cantidadPosicionesQueRequierenTurnante).toBe(0);
  });
  it('3) L-D 1 sin posición L-S produce 1 turnante', () => {
    const c = calcularCompensacionLunesDomingoLunesSabado('g', [posicion({ cantidad: 1 })], []);
    expect(c.totalPosicionesLunesSabado).toBe(0);
    expect(c.cantidadPosicionesQueRequierenTurnante).toBe(1);
  });
  it('4) L-D 2 y L-S 3 produce 0 turnantes (nunca negativo)', () => {
    const c = calcularCompensacionLunesDomingoLunesSabado('g', [posicion({ cantidad: 2 })], [posicion({ cantidad: 3 })]);
    expect(c.cantidadPosicionesQueRequierenTurnante).toBe(0);
  });
  it('5) nunca se generan cantidades negativas, para ninguna combinación', () => {
    for (const [ld, ls] of [[0, 5], [1, 10], [3, 100]]) {
      const c = calcularCompensacionLunesDomingoLunesSabado('g', [posicion({ cantidad: ld })], [posicion({ cantidad: ls })]);
      expect(c.cantidadPosicionesQueRequierenTurnante).toBeGreaterThanOrEqual(0);
    }
  });
  it('6) varias filas L-D equivalentes se SUMAN antes de restar', () => {
    const ld = [posicion({ id: 'a', cantidad: 2 }), posicion({ id: 'b', cantidad: 1 })];
    const c = calcularCompensacionLunesDomingoLunesSabado('g', ld, [posicion({ id: 'ls', cantidad: 2, requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(8) })]);
    expect(c.totalPosicionesLunesDomingo).toBe(3);
    expect(c.cantidadPosicionesQueRequierenTurnante).toBe(1);
  });
  it('7) varias filas L-S equivalentes se SUMAN antes de restar', () => {
    const ls = [posicion({ id: 'x', cantidad: 1, requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(8) }), posicion({ id: 'y', cantidad: 1, requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(8) })];
    const c = calcularCompensacionLunesDomingoLunesSabado('g', [posicion({ cantidad: 3 })], ls);
    expect(c.totalPosicionesLunesSabado).toBe(2);
    expect(c.cantidadPosicionesQueRequierenTurnante).toBe(1);
  });
  it('10) conserva trazabilidad — ids de origen L-D y L-S', () => {
    const c = calcularCompensacionLunesDomingoLunesSabado('g', [posicion({ id: 'ld1', cantidad: 3 })], [posicion({ id: 'ls1', cantidad: 2, requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(8) })]);
    expect(c.distribucionesLunesDomingo).toEqual(['ld1']);
    expect(c.distribucionesLunesSabado).toEqual(['ls1']);
  });
});

describe('construirGruposNecesidadTurnantes — integración de la compensación L-D/L-S', () => {
  it('8) mismo cargo y mismo horario (L-D vs L-S) SÍ se compensan', () => {
    const posiciones = [
      posicion({ id: 'ld', cantidad: 3, perfilCargo: 'VIGILANTE' }),
      posicion({ id: 'ls', cantidad: 2, perfilCargo: 'VIGILANTE', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(8) }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].compensacion.totalPosicionesLunesDomingo).toBe(3);
    expect(grupos[0].compensacion.totalPosicionesLunesSabado).toBe(2);
    expect(grupos[0].compensacion.cantidadPosicionesQueRequierenTurnante).toBe(1);
    expect(grupos[0].necesidad.cantidadTurnantesFisicos).toBe(1); // 1 posición neta → 1 turnante de 21h
  });

  it('9) mismo cargo con HORARIOS DISTINTOS no se compensa (diurno 06:00-18:00 vs nocturno 18:00-06:00, misma duración 12h)', () => {
    const posiciones = [
      posicion({ id: 'diurno-ld', cantidad: 2, perfilCargo: 'VIGILANTE', minutosPorDia: minutosPorDiaHomogeneo(12), horaInicioReferencia: '06:00' }),
      posicion({ id: 'nocturno-ls', cantidad: 1, perfilCargo: 'VIGILANTE', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(12), horaInicioReferencia: '18:00' }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(1);
    // El nocturno L-S no comparte clave de compensación con el diurno L-D (distinta horaInicioReferencia) → no compensa, queda el total L-D bruto.
    expect(grupos[0].compensacion.totalPosicionesLunesSabado).toBe(0);
    expect(grupos[0].compensacion.cantidadPosicionesQueRequierenTurnante).toBe(2);
  });

  it('10) cargo DISTINTO con mismo horario no se compensa', () => {
    const posiciones = [
      posicion({ id: 'ld', cantidad: 3, perfilCargo: 'VIGILANTE' }),
      posicion({ id: 'ls', cantidad: 2, perfilCargo: 'ASEADOR', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(8) }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    const vigilante = grupos.find((g) => g.perfilCargo === 'VIGILANTE')!;
    expect(vigilante.compensacion.totalPosicionesLunesSabado).toBe(0);
    expect(vigilante.compensacion.cantidadPosicionesQueRequierenTurnante).toBe(3);
  });

  it('11) diurno y nocturno NUNCA se compensan L-D/L-S entre sí (cada horario resuelve su propia diferencia primero) — pero SÍ se integran después en un bloque de 42h, por ser la excepción de negocio de 12h con horarios complementarios', () => {
    const posiciones = [
      posicion({ id: 'diurno-ld', cantidad: 3, perfilCargo: 'VIGILANTE', minutosPorDia: minutosPorDiaHomogeneo(12), horaInicioReferencia: '06:00' }),
      posicion({ id: 'diurno-ls', cantidad: 2, perfilCargo: 'VIGILANTE', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(12), horaInicioReferencia: '06:00' }),
      posicion({ id: 'nocturno-ld', cantidad: 3, perfilCargo: 'VIGILANTE', minutosPorDia: minutosPorDiaHomogeneo(12), horaInicioReferencia: '18:00' }),
      posicion({ id: 'nocturno-ls', cantidad: 2, perfilCargo: 'VIGILANTE', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(12), horaInicioReferencia: '18:00' }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    // 3-2=1 diurno + 3-2=1 nocturno → ambos son la excepción de 12h con
    // horarios COMPLEMENTARIOS → se integran en UNA sola ficha de 42h
    // (nunca dos fichas ordinarias independientes de 21h).
    expect(grupos).toHaveLength(1);
    expect(grupos[0].compensacion.totalPosicionesLunesDomingo).toBe(6); // 3+3, ambos horarios
    expect(grupos[0].compensacion.cantidadPosicionesQueRequierenTurnante).toBe(2); // 1 diurno + 1 nocturno, YA compensados por separado
    expect(grupos[0].necesidad.cantidadTurnantesFisicos).toBe(2);
    expect(grupos[0].modalidadCobertura).toBe('INTEGRADO_42H');
  });

  it('12) lunes a viernes (sin sábado) nunca se interpreta como lunes a sábado — no compensa', () => {
    const posiciones = [
      posicion({ id: 'ld', cantidad: 2, perfilCargo: 'VIGILANTE' }),
      posicion({ id: 'lv', cantidad: 5, perfilCargo: 'VIGILANTE', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesAViernes(8) }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].compensacion.totalPosicionesLunesSabado).toBe(0); // la L-V nunca cuenta como compensadora
    expect(grupos[0].compensacion.cantidadPosicionesQueRequierenTurnante).toBe(2);
  });

  it('13) horario nocturno con cruce de medianoche conserva su clasificación L-D/L-S correctamente (clasificación es por minutosPorDia, no por hora de reloj)', () => {
    // minutosPorDia ya representa la duración diaria total del turno,
    // independientemente de si cruza medianoche — la clasificación L-D/L-S
    // no necesita saber la hora de inicio/fin, solo qué días tienen minutos.
    const nocturnoLD = posicion({ id: 'n-ld', cantidad: 2, minutosPorDia: minutosPorDiaHomogeneo(12) });
    const nocturnoLS = posicion({ id: 'n-ls', cantidad: 1, requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(12) });
    expect(esProgramacionLunesADomingo(nocturnoLD.minutosPorDia)).toBe(true);
    expect(esProgramacionLunesASabado(nocturnoLS.minutosPorDia)).toBe(true);
  });

  it('16) una diferencia aislada (sin L-S) de la excepción de 12h conserva la modalidad individual — 1 posición neta = 1 turnante de 21h', () => {
    const grupos = construirGruposNecesidadTurnantes([posicion({ cantidad: 1, perfilCargo: 'VIGILANTE', minutosPorDia: minutosPorDiaHomogeneo(12) })], SMLMV_PRUEBA);
    expect(grupos[0].necesidad.cantidadTurnantesFisicos).toBe(1);
    expect(grupos[0].necesidad.bloquesTurnantesContratados).toEqual([{ horasContratadas: 21 }]);
    expect(grupos[0].modalidadCobertura).toBe('INDIVIDUAL_ESPECIAL_21H');
  });

  it('17/18) cambiar la cantidad L-S hasta igualar/superar la L-D elimina el turnante; volver a bajarla lo regenera', () => {
    const base = (cantidadLS: number) => construirGruposNecesidadTurnantes([
      posicion({ id: 'ld', cantidad: 3, perfilCargo: 'VIGILANTE' }),
      posicion({ id: 'ls', cantidad: cantidadLS, perfilCargo: 'VIGILANTE', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(8) }),
    ], SMLMV_PRUEBA);
    expect(base(2)).toHaveLength(1); // 3-2=1 → sí hay turnante
    expect(base(3)).toHaveLength(0); // 3-3=0 → se retira
    expect(base(1)).toHaveLength(1); // vuelve a subir la diferencia → se regenera
    expect(base(1)[0].necesidad.cantidadTurnantesFisicos).toBe(2); // 3-1=2
  });

  it('19) el costo se contabiliza una sola vez — la necesidad se construye SOLO desde la cantidad compensada, nunca sumando también la cantidad L-D bruta', () => {
    const grupos = construirGruposNecesidadTurnantes([
      posicion({ id: 'ld', cantidad: 3, perfilCargo: 'VIGILANTE' }),
      posicion({ id: 'ls', cantidad: 2, perfilCargo: 'VIGILANTE', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(8) }),
    ], SMLMV_PRUEBA);
    // Si se contara la bruta (3) en vez de la neta (1), cantidadTurnantesFisicos sería 3, no 1.
    expect(grupos[0].necesidad.cantidadTurnantesFisicos).toBe(1);
  });

  it('20) sin ninguna posición L-S existente, el comportamiento es IDÉNTICO al vigente antes del ajuste (retrocompatible)', () => {
    const grupos = construirGruposNecesidadTurnantes([posicion({ id: 'a', cantidad: 6, perfilCargo: 'ASEO' })], SMLMV_PRUEBA);
    expect(grupos[0].compensacion.totalPosicionesLunesSabado).toBe(0);
    expect(grupos[0].necesidad.cantidadTurnantesFisicos).toBe(6);
  });

  it('22) un grupo con patrón irregular (no L-D exacto) nunca se compensa, conserva la lógica vigente', () => {
    const posiciones: PosicionElegibleTurnante[] = [
      posicion({ id: 'a', cantidad: 6, minutosPorDia: minutosPorDiaHomogeneo(8) }),
      posicion({ id: 'b', cantidad: 6, minutosPorDia: { L: 960, M: 0, X: 960, J: 0, V: 960, S: 0, D: 480 } }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(2); // comportamiento vigente sin cambios
  });
});

// ─── Ajuste "COMPENSACIÓN POR MODALIDAD DIURNO/NOCTURNO" (confirmado
//      explícitamente, caso real TODERO-ALTURA) ────────────────────────────
describe('clasificarModalidadTurnoParaCompensacion — DIURNO exige 0 minutos en la ventana nocturna legal (motor-distribuido/tipos.ts); NOCTURNO con cualquier minuto dentro de ella', () => {
  it('11:00-19:00 (7h) es DIURNO', () => {
    expect(clasificarModalidadTurnoParaCompensacion('11:00', 7 * 60)).toBe('DIURNO');
  });
  it('07:00-15:00 (7h) es DIURNO', () => {
    expect(clasificarModalidadTurnoParaCompensacion('07:00', 7 * 60)).toBe('DIURNO');
  });
  it('10:00-18:00 (7h) es DIURNO', () => {
    expect(clasificarModalidadTurnoParaCompensacion('10:00', 7 * 60)).toBe('DIURNO');
  });
  it('06:00-18:00 (12h) es DIURNO', () => {
    expect(clasificarModalidadTurnoParaCompensacion('06:00', 12 * 60)).toBe('DIURNO');
  });
  it('18:00-06:00 (12h) es NOCTURNO — tiene minutos dentro de 19:00-06:00', () => {
    expect(clasificarModalidadTurnoParaCompensacion('18:00', 12 * 60)).toBe('NOCTURNO');
  });
  it('22:00-05:00 (7h) es NOCTURNO', () => {
    expect(clasificarModalidadTurnoParaCompensacion('22:00', 7 * 60)).toBe('NOCTURNO');
  });
  it('sin hora o sin duración es INDETERMINADO, nunca se asume una modalidad', () => {
    expect(clasificarModalidadTurnoParaCompensacion('', 7 * 60)).toBe('INDETERMINADO');
    expect(clasificarModalidadTurnoParaCompensacion('11:00', 0)).toBe('INDETERMINADO');
  });

  // Ajuste "DIURNO ESTRICTO — 0 MINUTOS NOCTURNOS" (confirmado
  // explícitamente) — los siguientes casos ANTES eran DIURNO bajo la
  // regla de mayoría (menos de la mitad de sus minutos caían en la
  // ventana nocturna) y AHORA son NOCTURNO, porque tocan la ventana
  // aunque sea parcialmente. Prueban directamente el endurecimiento de
  // la regla, no solo el resultado final de compensación.
  it('12:00-20:00 (8h) es NOCTURNO — toca 19:00-20:00 (antes era DIURNO bajo la regla de mayoría)', () => {
    expect(clasificarModalidadTurnoParaCompensacion('12:00', 8 * 60)).toBe('NOCTURNO');
  });
  it('14:00-22:00 (8h) es NOCTURNO — toca 19:00-22:00, aunque sean solo 3 de sus 8 horas', () => {
    expect(clasificarModalidadTurnoParaCompensacion('14:00', 8 * 60)).toBe('NOCTURNO');
  });
  it('20:00-04:00 (8h) es NOCTURNO', () => {
    expect(clasificarModalidadTurnoParaCompensacion('20:00', 8 * 60)).toBe('NOCTURNO');
  });
});

describe('construirGruposNecesidadTurnantes — caso real TODERO-ALTURA (compensación por modalidad, nunca por hora exacta)', () => {
  it('CASO 1 (obligatorio) — L-D 11:00-19:00 (7h) + L-S 07:00-15:00 (7h), mismo cargo → 0 turnantes, sin TURNANTE-AUTO', () => {
    const posiciones = [
      posicion({ id: 'A', cantidad: 1, perfilCargo: 'TODERO ALTURA', minutosPorDia: minutosPorDiaHomogeneo(7), horaInicioReferencia: '11:00' }),
      posicion({ id: 'B', cantidad: 1, perfilCargo: 'TODERO ALTURA', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(7), horaInicioReferencia: '07:00' }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(0); // sin necesidad → nunca se genera ninguna línea TURNANTE-AUTO
  });

  it('CASO 2 (obligatorio) — mismo horario exacto (L-D 07:00-15:00 vs L-S 07:00-15:00) sigue compensando → 0 turnantes', () => {
    const posiciones = [
      posicion({ id: 'A', cantidad: 1, perfilCargo: 'TODERO ALTURA', minutosPorDia: minutosPorDiaHomogeneo(7), horaInicioReferencia: '07:00' }),
      posicion({ id: 'B', cantidad: 1, perfilCargo: 'TODERO ALTURA', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(7), horaInicioReferencia: '07:00' }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(0);
  });

  it('CASO 3 (obligatorio) — diurno 06:00-14:00 vs nocturno 18:00-06:00 (12h) — NUNCA compensa (regresión de la excepción de 12h)', () => {
    const posiciones = [
      posicion({ id: 'diurno-ld', cantidad: 2, perfilCargo: 'VIGILANTE', minutosPorDia: minutosPorDiaHomogeneo(12), horaInicioReferencia: '06:00' }),
      posicion({ id: 'nocturno-ls', cantidad: 1, perfilCargo: 'VIGILANTE', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(12), horaInicioReferencia: '18:00' }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].compensacion.totalPosicionesLunesSabado).toBe(0);
    expect(grupos[0].compensacion.cantidadPosicionesQueRequierenTurnante).toBe(2);
  });

  it('CASO 4 (obligatorio) — 11:00-19:00 vs 10:00-18:00: misma ventana operativa (ambos DIURNO) → SÍ compensa → 0 turnantes', () => {
    const posiciones = [
      posicion({ id: 'A', cantidad: 1, perfilCargo: 'TODERO ALTURA', minutosPorDia: minutosPorDiaHomogeneo(7), horaInicioReferencia: '11:00' }),
      posicion({ id: 'B', cantidad: 1, perfilCargo: 'TODERO ALTURA', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(7), horaInicioReferencia: '10:00' }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(0);
  });

  it('CASO 5 (obligatorio) — 11:00-19:00 vs 22:00-06:00: diurno vs nocturno real → NUNCA compensa', () => {
    const posiciones = [
      posicion({ id: 'A', cantidad: 1, perfilCargo: 'TODERO ALTURA', minutosPorDia: minutosPorDiaHomogeneo(7), horaInicioReferencia: '11:00' }),
      posicion({ id: 'B', cantidad: 1, perfilCargo: 'TODERO ALTURA', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(7), horaInicioReferencia: '22:00' }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].compensacion.totalPosicionesLunesSabado).toBe(0);
    expect(grupos[0].compensacion.cantidadPosicionesQueRequierenTurnante).toBe(1);
  });

  it('CASO 6 (obligatorio, regresión) — excepción de 12h con horarios complementarios diurno+nocturno se sigue integrando en un único bloque de 42h, sin cambios', () => {
    const posiciones = [
      posicion({ id: 'diurno-ld', cantidad: 3, perfilCargo: 'VIGILANTE', minutosPorDia: minutosPorDiaHomogeneo(12), horaInicioReferencia: '06:00' }),
      posicion({ id: 'diurno-ls', cantidad: 2, perfilCargo: 'VIGILANTE', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(12), horaInicioReferencia: '06:00' }),
      posicion({ id: 'nocturno-ld', cantidad: 3, perfilCargo: 'VIGILANTE', minutosPorDia: minutosPorDiaHomogeneo(12), horaInicioReferencia: '18:00' }),
      posicion({ id: 'nocturno-ls', cantidad: 2, perfilCargo: 'VIGILANTE', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(12), horaInicioReferencia: '18:00' }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].compensacion.cantidadPosicionesQueRequierenTurnante).toBe(2);
    expect(grupos[0].necesidad.cantidadTurnantesFisicos).toBe(2);
    expect(grupos[0].modalidadCobertura).toBe('INTEGRADO_42H');
  });

  it('CASO 7 (obligatorio, cantidades) — 1 posición L-D y 1 L-S compatibles → 0 turnantes', () => {
    const grupos = construirGruposNecesidadTurnantes([
      posicion({ id: 'A', cantidad: 1, perfilCargo: 'TODERO ALTURA', minutosPorDia: minutosPorDiaHomogeneo(7), horaInicioReferencia: '11:00' }),
      posicion({ id: 'B', cantidad: 1, perfilCargo: 'TODERO ALTURA', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(7), horaInicioReferencia: '07:00' }),
    ], SMLMV_PRUEBA);
    expect(grupos).toHaveLength(0);
  });

  it('CASO 7 (obligatorio, cantidades) — 1 posición L-D y ninguna L-S compatible → 1 turnante', () => {
    const grupos = construirGruposNecesidadTurnantes([
      posicion({ id: 'A', cantidad: 1, perfilCargo: 'TODERO ALTURA', minutosPorDia: minutosPorDiaHomogeneo(7), horaInicioReferencia: '11:00' }),
    ], SMLMV_PRUEBA);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].necesidad.cantidadTurnantesFisicos).toBe(1);
  });

  it('CASO 7 (obligatorio, cantidades) — 3 posiciones L-D y 2 L-S compatibles → 1 turnante neto', () => {
    const grupos = construirGruposNecesidadTurnantes([
      posicion({ id: 'A', cantidad: 3, perfilCargo: 'TODERO ALTURA', minutosPorDia: minutosPorDiaHomogeneo(7), horaInicioReferencia: '11:00' }),
      posicion({ id: 'B', cantidad: 2, perfilCargo: 'TODERO ALTURA', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(7), horaInicioReferencia: '07:00' }),
    ], SMLMV_PRUEBA);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].compensacion.cantidadPosicionesQueRequierenTurnante).toBe(1);
    expect(grupos[0].necesidad.cantidadTurnantesFisicos).toBe(1);
  });
});

// ─── Ajuste "DIURNO ESTRICTO — 0 MINUTOS NOCTURNOS" (confirmado
//      explícitamente) — endurece clasificarModalidadTurnoParaCompensacion:
//      ANTES un turno era DIURNO si la MAYORÍA de sus minutos caía fuera de
//      la ventana nocturna; AHORA exige CERO minutos dentro de ella (1 o
//      más minutos dentro de 19:00-06:00 → NOCTURNO, sin excepción). El
//      caso TODERO-ALTURA (CASO 1, arriba) NO cambia: A (11:00, 7h) termina
//      a las 18:00 y B (07:00, 7h) termina a las 15:00 — ambos con 0
//      minutos nocturnos, DIURNO en ambas reglas. ────────────────────────
describe('construirGruposNecesidadTurnantes — DIURNO estricto (0 minutos nocturnos) — letras A-H del ajuste', () => {
  it('B — L-D 06:00-14:00 vs L-S 07:00-15:00 (8h cada uno) → ambos DIURNO (0 min nocturnos) → 0 turnantes', () => {
    const grupos = construirGruposNecesidadTurnantes([
      posicion({ id: 'A', cantidad: 1, perfilCargo: 'TODERO ALTURA', minutosPorDia: minutosPorDiaHomogeneo(8), horaInicioReferencia: '06:00' }),
      posicion({ id: 'B', cantidad: 1, perfilCargo: 'TODERO ALTURA', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(8), horaInicioReferencia: '07:00' }),
    ], SMLMV_PRUEBA);
    expect(grupos).toHaveLength(0);
  });

  it('C — L-D 07:00-15:00 vs L-S 11:00-19:00 (8h cada uno) → ambos DIURNO → 0 turnantes', () => {
    const grupos = construirGruposNecesidadTurnantes([
      posicion({ id: 'A', cantidad: 1, perfilCargo: 'TODERO ALTURA', minutosPorDia: minutosPorDiaHomogeneo(8), horaInicioReferencia: '07:00' }),
      posicion({ id: 'B', cantidad: 1, perfilCargo: 'TODERO ALTURA', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(8), horaInicioReferencia: '11:00' }),
    ], SMLMV_PRUEBA);
    expect(grupos).toHaveLength(0);
  });

  it('D — L-D 14:00-22:00 vs L-S 07:00-15:00 (8h cada uno) → NOCTURNO (toca 19:00-22:00) vs DIURNO → NUNCA compensa', () => {
    const grupos = construirGruposNecesidadTurnantes([
      posicion({ id: 'A', cantidad: 1, perfilCargo: 'TODERO ALTURA', minutosPorDia: minutosPorDiaHomogeneo(8), horaInicioReferencia: '14:00' }),
      posicion({ id: 'B', cantidad: 1, perfilCargo: 'TODERO ALTURA', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(8), horaInicioReferencia: '07:00' }),
    ], SMLMV_PRUEBA);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].compensacion.totalPosicionesLunesSabado).toBe(0);
    expect(grupos[0].compensacion.cantidadPosicionesQueRequierenTurnante).toBe(1);
  });

  it('E — L-D 18:00-02:00 vs L-S 07:00-15:00 (8h cada uno, cruza medianoche) → NOCTURNO vs DIURNO → NUNCA compensa', () => {
    const grupos = construirGruposNecesidadTurnantes([
      posicion({ id: 'A', cantidad: 1, perfilCargo: 'TODERO ALTURA', minutosPorDia: minutosPorDiaHomogeneo(8), horaInicioReferencia: '18:00' }),
      posicion({ id: 'B', cantidad: 1, perfilCargo: 'TODERO ALTURA', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(8), horaInicioReferencia: '07:00' }),
    ], SMLMV_PRUEBA);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].compensacion.totalPosicionesLunesSabado).toBe(0);
    expect(grupos[0].compensacion.cantidadPosicionesQueRequierenTurnante).toBe(1);
  });

  it('F — L-D 18:00-02:00 vs L-S 20:00-04:00 (8h cada uno, ambos cruzan medianoche) → ambos NOCTURNO → SÍ compensa → 0 turnantes', () => {
    const grupos = construirGruposNecesidadTurnantes([
      posicion({ id: 'A', cantidad: 1, perfilCargo: 'TODERO ALTURA', minutosPorDia: minutosPorDiaHomogeneo(8), horaInicioReferencia: '18:00' }),
      posicion({ id: 'B', cantidad: 1, perfilCargo: 'TODERO ALTURA', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(8), horaInicioReferencia: '20:00' }),
    ], SMLMV_PRUEBA);
    expect(grupos).toHaveLength(0);
  });

  it('H — 2 posiciones L-D y 1 L-S compatible (11:00/07:00, 7h) → 1 turnante neto', () => {
    const grupos = construirGruposNecesidadTurnantes([
      posicion({ id: 'A', cantidad: 2, perfilCargo: 'TODERO ALTURA', minutosPorDia: minutosPorDiaHomogeneo(7), horaInicioReferencia: '11:00' }),
      posicion({ id: 'B', cantidad: 1, perfilCargo: 'TODERO ALTURA', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(7), horaInicioReferencia: '07:00' }),
    ], SMLMV_PRUEBA);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].compensacion.cantidadPosicionesQueRequierenTurnante).toBe(1);
    expect(grupos[0].necesidad.cantidadTurnantesFisicos).toBe(1);
  });

  it('H — 3 posiciones L-D y 0 L-S → 3 turnantes (sin ninguna compensación)', () => {
    const grupos = construirGruposNecesidadTurnantes([
      posicion({ id: 'A', cantidad: 3, perfilCargo: 'TODERO ALTURA', minutosPorDia: minutosPorDiaHomogeneo(7), horaInicioReferencia: '11:00' }),
    ], SMLMV_PRUEBA);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].compensacion.cantidadPosicionesQueRequierenTurnante).toBe(3);
    expect(grupos[0].necesidad.cantidadTurnantesFisicos).toBe(3);
  });

  it('H — 0 posiciones L-D y 1 L-S → 0 turnantes, porque no existe ninguna demanda L-D que compensar (nunca por la fórmula de resta, que ni se ejecuta)', () => {
    // La L-S sola nunca requiere cobertura de descanso (esProgramacionLunesASabado
    // la excluye de "elegibles") y, sin ninguna posición L-D, no hay clave de
    // grupo que la busque como compensadora — el resultado es 0 grupos por
    // ausencia total de demanda, no por una resta que dé cero.
    const grupos = construirGruposNecesidadTurnantes([
      posicion({ id: 'B', cantidad: 1, perfilCargo: 'TODERO ALTURA', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(7), horaInicioReferencia: '07:00' }),
    ], SMLMV_PRUEBA);
    expect(grupos).toHaveLength(0);
  });
});

// Ajuste "CORREGIR REGLA DE TURNANTES: CARGOS SIN ESQUEMA DE TURNOS" — un
// cargo de lunes a domingo con UN SOLO horario (sin franjas
// complementarias) siempre requiere un turnante de 7h fijas — NUNCA
// horasProgramadasSemanales-42. Con 2+ horarios del mismo cargo (esquema
// de turnos real), se conserva la lógica vigente sin cambios.
describe('Ajuste "CORREGIR REGLA DE TURNANTES: CARGOS SIN ESQUEMA DE TURNOS"', () => {
  it('1/6) un solo horario de lunes a domingo (ASEADOR 06:00-14:00, 8h/día=56h/semana) genera un turnante de 7 horas, con factor 1/6 y costo redondeado a $474.376 sobre una referencia de $2.846.255', () => {
    const grupos = construirGruposNecesidadTurnantes(
      [posicion({ id: 'aseador-1', cantidad: 1, perfilCargo: 'ASEADOR', minutosPorDia: minutosPorDiaHomogeneo(8) })],
      SMLMV_PRUEBA,
    );
    expect(grupos).toHaveLength(1);
    const g = grupos[0];
    expect(g.modalidadCobertura).toBe('HORAS_REALES');
    expect(g.necesidad.cantidadTurnantesFisicos).toBe(1);
    expect(g.necesidad.bloquesTurnantesContratados).toEqual([{ horasContratadas: 7 }]);
    expect(g.necesidad.horasContratadasTotal).toBe(7);
    expect(g.horasCoberturaPorPosicion).toBe(7); // cobertura operativa total / jornada individual
    const factor = g.horasCoberturaPorPosicion / CAPACIDAD_REFERENCIA_TIEMPO_COMPLETO; // 7/42 = 1/6
    expect(factor).toBeCloseTo(1 / 6, 10);
    expect(Math.round(2846255 * factor)).toBe(474376);
  });

  it('2) 06:00-14:00 (8h/día) NO genera automáticamente 14 horas (56-42)', () => {
    const grupos = construirGruposNecesidadTurnantes(
      [posicion({ id: 'a', cantidad: 1, perfilCargo: 'ASEADOR', minutosPorDia: minutosPorDiaHomogeneo(8) })],
      SMLMV_PRUEBA,
    );
    expect(grupos[0].necesidad.horasContratadasTotal).not.toBe(14);
    expect(grupos[0].necesidad.horasContratadasTotal).toBe(7);
  });

  it('3) 07:00-14:00 (7h/día=49h/semana) también genera 7 horas de turnante (fijo, no depende de la duración programada)', () => {
    const grupos = construirGruposNecesidadTurnantes(
      [posicion({ id: 'a', cantidad: 1, perfilCargo: 'ASEADOR', minutosPorDia: minutosPorDiaHomogeneo(7) })],
      SMLMV_PRUEBA,
    );
    expect(grupos[0].necesidad.horasContratadasTotal).toBe(7);
  });

  it('4) el exceso semanal (horasProgramadas-42) no se usa en cargos sin esquema de turnos, incluso con jornadas muy largas', () => {
    const grupos = construirGruposNecesidadTurnantes(
      [posicion({ id: 'a', cantidad: 1, perfilCargo: 'ASEADOR', minutosPorDia: minutosPorDiaHomogeneo(10) })], // 70h/semana → excedente sería 28h
      SMLMV_PRUEBA,
    );
    expect(grupos[0].necesidad.horasContratadasTotal).toBe(7); // nunca 28
  });

  it('5) el factor aplicado es 1/6 (diasEquivalentes=1 de 6) para el caso sin esquema de turnos', () => {
    const grupos = construirGruposNecesidadTurnantes(
      [posicion({ id: 'a', cantidad: 1, perfilCargo: 'ASEADOR', minutosPorDia: minutosPorDiaHomogeneo(8) })],
      SMLMV_PRUEBA,
    );
    const diasEquivalentes = grupos[0].horasCoberturaPorPosicion / HORAS_POR_DIA_REFERENCIA_TURNANTE;
    expect(diasEquivalentes).toBe(1);
  });

  it('7/8) [ACTUALIZADO — Fase 2 diagnóstico Aseocolba, retiro de esEsquemaTurnos] dos horarios complementarios del MISMO cargo (diurno+nocturno) YA NO usan horasProgramadas-42: cada grupo, con 1 trabajador cada uno, requiere 7h fijas de relevo, igual que cualquier otro cargo', () => {
    // Este test antes afirmaba que la fórmula de exceso (horasProgramadas-42)
    // SÍ debía aplicarse cuando el mismo cargo tiene 2+ horarios distintos
    // (`esEsquemaTurnos`). Esa bifurcación quedó retirada: la regla de
    // negocio confirmada es que el relevo SIEMPRE es
    // `config.horasEfectivasDescansoTurnante` (7h) × cantidad de
    // trabajadores que requieren relevo, sin importar cuántos horarios/
    // grupos de compatibilidad tenga el cargo. Ver
    // calculo-turnantes.relevo-fijo-7h.test.ts para la cobertura completa
    // de este caso (incluida la variante con cantidades distintas por
    // grupo).
    const posiciones: PosicionElegibleTurnante[] = [
      posicion({ id: 'diurno', cantidad: 1, perfilCargo: 'VIGILANTE', minutosPorDia: minutosPorDiaHomogeneo(10), horaInicioReferencia: '06:00' }),
      posicion({ id: 'nocturno', cantidad: 1, perfilCargo: 'VIGILANTE', minutosPorDia: minutosPorDiaHomogeneo(10), horaInicioReferencia: '18:00' }),
    ];
    const grupos = construirGruposNecesidadTurnantes(posiciones, SMLMV_PRUEBA);
    expect(grupos).toHaveLength(2); // horarios distintos → grupos distintos (esto NO cambia — solo cambió cómo se costea cada uno)
    for (const g of grupos) {
      expect(g.modalidadCobertura).toBe('HORAS_REALES');
      expect(g.necesidad.horasContratadasTotal).toBe(7); // nunca 28 (70h-42h) — regla de relevo fijo, no de exceso semanal
    }
  });

  it('9) la cantidad de turnantes físicos sigue respetando la compensación L-D/L-S también en el caso sin esquema de turnos', () => {
    const grupos = construirGruposNecesidadTurnantes(
      [
        posicion({ id: 'ld', cantidad: 3, perfilCargo: 'ASEADOR', minutosPorDia: minutosPorDiaHomogeneo(8) }),
        posicion({ id: 'ls', cantidad: 2, perfilCargo: 'ASEADOR', requiereCoberturaDescanso: false, minutosPorDia: minutosLunesASabado(8) }),
      ],
      SMLMV_PRUEBA,
    );
    expect(grupos).toHaveLength(1);
    expect(grupos[0].necesidad.cantidadTurnantesFisicos).toBe(1); // 3-2=1, nunca 3
    expect(grupos[0].necesidad.horasContratadasTotal).toBe(7); // sigue siendo 7h fijas, no 3×7
  });

  it('10) el cálculo de los cargos principales (línea titular) no se modifica — esta corrección solo afecta la línea de turnante, nunca la cobertura/recargos de la posición original', () => {
    // calcularCoberturaPorPosicion (usado para la línea principal) sigue
    // usando la MISMA fórmula de siempre (diasDescansoPorPosicion × horas
    // efectivas fijas) — no depende de esEsquemaTurnos en absoluto.
    const posiciones = [posicion({ id: 'a', cantidad: 1, perfilCargo: 'ASEADOR', minutosPorDia: minutosPorDiaHomogeneo(8) })];
    const cobertura = calcularCoberturaPorPosicion(posiciones);
    expect(cobertura[0].minutosRelevoPosicion).toBe(HORAS_EFECTIVAS_DESCANSO_TURNANTE * 60);
  });

  it('11) no se contabiliza dos veces el turnante — un solo grupo/ficha por cargo sin esquema de turnos', () => {
    const grupos = construirGruposNecesidadTurnantes(
      [posicion({ id: 'a', cantidad: 1, perfilCargo: 'ASEADOR', minutosPorDia: minutosPorDiaHomogeneo(8) })],
      SMLMV_PRUEBA,
    );
    expect(grupos).toHaveLength(1);
  });

  it('12) el total visible (necesidad.horasContratadasTotal × costo por hora de referencia) coincide con el total canónico esperado', () => {
    const grupos = construirGruposNecesidadTurnantes(
      [posicion({ id: 'a', cantidad: 1, perfilCargo: 'ASEADOR', minutosPorDia: minutosPorDiaHomogeneo(8) })],
      SMLMV_PRUEBA,
    );
    const costoReferencia42h = 2846255;
    const costoTurnante = calcularCostoProporcionalTurnante(costoReferencia42h, grupos[0].horasCoberturaPorPosicion);
    expect(costoTurnante).toBe(474376);
  });
});

