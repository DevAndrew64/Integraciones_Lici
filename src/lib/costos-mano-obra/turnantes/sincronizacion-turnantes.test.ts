/**
 * Pruebas REALES (sin readFileSync de page.tsx) de la decisión de
 * sincronización crear/actualizar/eliminar/conservar de las líneas
 * automáticas de turnante — `sincronizarLineasTurnantesAutomaticas`
 * (calculo-turnantes.ts). Esta función es la MISMA que invoca el
 * `useEffect` de page.tsx; se prueba aquí con fixtures planos, sin
 * necesidad de montar React. Los grupos se construyen con
 * `construirGruposNecesidadTurnantes` real (no objetos inventados a mano),
 * para que estas pruebas también ejerciten la integración entre ambos
 * módulos puros.
 *
 * Ajuste "AJUSTAR TURNANTES POR BLOQUES DE 21 Y 42 HORAS" — cada grupo
 * puede generar HASTA DOS líneas automáticas: la de bloques integrados de
 * 42h (`cantOpeFijos=cantidadBloques42Turnantes`, remanenteTurnante21
 * ausente/false) y la línea-sonda del remanente individual de 21h
 * (`cantOpeFijos` SIEMPRE '1', remanenteTurnante21=true) — solo cuando
 * `cantidadTurnantesFisicos` es impar. Con cantidad PAR, sigue existiendo
 * una única línea (la de bloques), igual que antes del ajuste.
 */
import { describe, it, expect } from 'vitest';
import {
  sincronizarLineasTurnantesAutomaticas,
  construirGruposNecesidadTurnantes,
  type LineaAutomaticaExistente,
  type GrupoNecesidadTurnantes,
  type PosicionElegibleTurnante,
} from './calculo-turnantes';
import type { DiaSemanaHorario } from '../horarios/tipos';

const SMLMV_PRUEBA = 1750905;
const minutosPorDiaHomogeneo = (horas: number): Record<DiaSemanaHorario, number> => {
  const min = horas * 60;
  return { L: min, M: min, X: min, J: min, V: min, S: min, D: min };
};

function posicion(overrides: Partial<PosicionElegibleTurnante> & { id: string; cantidad: number; salarioBase: number; arlKey: string }): PosicionElegibleTurnante {
  return {
    requiereCoberturaDescanso: true,
    // 12h/día L-D — excepción de negocio (paradigma de bloques 21/42h),
    // para que estas pruebas de MECÁNICA de sincronización (crear/
    // actualizar/eliminar) sigan siendo independientes de la modalidad
    // HORAS_REALES (ver calculo-turnantes.test.ts para esa cobertura).
    minutosPorDia: minutosPorDiaHomogeneo(12),
    conBonoPrestacional: false, bonoPrestacionalValor: 0,
    conBonoAlimentacion: false, bonoAlimentacionValor: 0,
    conBonoTransporte: false, bonoTransporteValor: 0,
    conBonoProductividad: false, bonoProductividadValor: 0,
    conBonoOcasional: false, bonoOcasionalValor: 0,
    otrosCostosPorTrabajadorFirma: 0,
    perfilCargo: 'ASEO',
    horaInicioReferencia: '',
    ...overrides,
  };
}

/** Un único grupo real (compatible por construcción) con `cantidad`
 * posiciones y la clave que le asigne `construirGruposNecesidadTurnantes`. */
function grupoDeUnaPosicion(cantidad: number, salarioBase: number, arlKey: string): GrupoNecesidadTurnantes {
  const grupos = construirGruposNecesidadTurnantes(
    [posicion({ id: 'p', cantidad, salarioBase, arlKey })],
    SMLMV_PRUEBA,
  );
  return grupos[0];
}

interface LineaFixture extends LineaAutomaticaExistente {
  id: number;
}

let nextId = 1;
function construirNueva(grupo: GrupoNecesidadTurnantes, cantidadTexto: string, remanente21: boolean): LineaFixture {
  return {
    id: nextId++,
    claveGrupoTurnante: grupo.claveGrupo,
    esTurnanteAutomatico: true,
    cantOpeFijos: cantidadTexto,
    salarioBase: String(Math.round(grupo.salarioBaseHeredado)),
    arlKey: grupo.arlKey,
    salarioEditadoManualmente: false,
    arlEditadoManualmente: false,
    remanenteTurnante21: remanente21,
    // Misma lógica que construirLineaTurnanteAutomaticaReferencia42h/Bloques42/
    // Remanente21 en page.tsx: HORAS_REALES usa SIEMPRE la línea de
    // referencia de 42h (el costo real se escala proporcionalmente fuera
    // de esta línea) — nunca una jornada a horas reales.
    horasSemanal: remanente21 ? '21' : '42',
  };
}

describe('sincronizarLineasTurnantesAutomaticas', () => {
  it('crea una línea nueva por cada grupo (cantidad PAR: solo la línea de bloques) cuando no hay automáticas previas', () => {
    const grupoA = grupoDeUnaPosicion(6, 1750905, 'II'); // 6 → 3 bloques de 42h, 0 remanente
    const grupoB = { ...grupoDeUnaPosicion(6, 1750905, 'II'), claveGrupo: 'gB-forzada-distinta' };
    const { siguientes, huboCambio } = sincronizarLineasTurnantesAutomaticas<LineaFixture>([], [grupoA, grupoB], construirNueva);
    expect(huboCambio).toBe(true);
    expect(siguientes).toHaveLength(2);
    expect(siguientes.every(l => l.cantOpeFijos === '3' && !l.remanenteTurnante21)).toBe(true);
  });

  it('cantidad IMPAR genera DOS líneas por grupo: bloques (cantOpeFijos=cantidadBloques42) + remanente (cantOpeFijos siempre "1")', () => {
    const grupo = grupoDeUnaPosicion(13, 1750905, 'II'); // 13 → 6 bloques de 42h + 1 remanente de 21h
    expect(grupo.necesidad.cantidadBloques42Turnantes).toBe(6);
    expect(grupo.necesidad.cantidadRemanentes21Turnantes).toBe(1);
    const { siguientes, huboCambio } = sincronizarLineasTurnantesAutomaticas<LineaFixture>([], [grupo], construirNueva);
    expect(huboCambio).toBe(true);
    expect(siguientes).toHaveLength(2);
    const lineaBloques = siguientes.find(l => !l.remanenteTurnante21)!;
    const lineaRemanente = siguientes.find(l => l.remanenteTurnante21)!;
    expect(lineaBloques.cantOpeFijos).toBe('6');
    expect(lineaRemanente.cantOpeFijos).toBe('1');
  });

  it('10 — cantidad cero (sin grupos vigentes) elimina las líneas automáticas existentes', () => {
    const grupo = grupoDeUnaPosicion(6, 1750905, 'II');
    const previas: LineaFixture[] = [
      { id: 1, claveGrupoTurnante: grupo.claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '3', salarioBase: '1750905', arlKey: 'II', horasSemanal: '42' },
    ];
    const { siguientes, huboCambio } = sincronizarLineasTurnantesAutomaticas<LineaFixture>(previas, [], construirNueva);
    expect(siguientes).toEqual([]);
    expect(huboCambio).toBe(true);
  });

  it('11 — cambiar la necesidad de PAR a IMPAR conserva la línea de bloques existente y AGREGA la línea de remanente', () => {
    const grupoInicial = grupoDeUnaPosicion(6, 1750905, 'II'); // 6 → 3 bloques, 0 remanente
    const previas: LineaFixture[] = [
      { id: 1, claveGrupoTurnante: grupoInicial.claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '3', salarioBase: '1750905', arlKey: 'II', horasSemanal: '42' },
    ];
    const grupoConMasNecesidad = { ...grupoDeUnaPosicion(13, 1750905, 'II'), claveGrupo: grupoInicial.claveGrupo }; // 13 → 6 bloques + 1 remanente, misma clave
    expect(grupoConMasNecesidad.necesidad.cantidadTurnantesFisicos).toBe(13);
    const { siguientes, huboCambio } = sincronizarLineasTurnantesAutomaticas<LineaFixture>(previas, [grupoConMasNecesidad], construirNueva);
    expect(huboCambio).toBe(true);
    expect(siguientes).toHaveLength(2);
    const lineaBloques = siguientes.find(l => !l.remanenteTurnante21)!;
    const lineaRemanente = siguientes.find(l => l.remanenteTurnante21)!;
    expect(lineaBloques.cantOpeFijos).toBe('6');
    expect(lineaBloques.id).toBe(1); // la línea de bloques existente se conserva, no se duplica
    expect(lineaRemanente.cantOpeFijos).toBe('1'); // línea nueva, recién creada
  });

  it('sin cambios reales (cantidad PAR), retorna huboCambio=false y conserva la MISMA referencia de objeto (evita loop de render)', () => {
    const grupo = grupoDeUnaPosicion(10, 1750905, 'II'); // 10 → 5 bloques, 0 remanente
    const previas: LineaFixture[] = [
      { id: 1, claveGrupoTurnante: grupo.claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '5', salarioBase: '1750905', arlKey: 'II', horasSemanal: '42' },
    ];
    const { siguientes, huboCambio } = sincronizarLineasTurnantesAutomaticas<LineaFixture>(previas, [grupo], construirNueva);
    expect(huboCambio).toBe(false);
    expect(siguientes[0]).toBe(previas[0]);
  });

  it('sin cambios reales (cantidad IMPAR, dos líneas previas), retorna huboCambio=false y conserva AMBAS referencias', () => {
    const grupo = grupoDeUnaPosicion(11, 1750905, 'II'); // 11 → 5 bloques + 1 remanente
    const previas: LineaFixture[] = [
      { id: 1, claveGrupoTurnante: grupo.claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '5', salarioBase: '1750905', arlKey: 'II', horasSemanal: '42' },
      { id: 2, claveGrupoTurnante: grupo.claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '1', salarioBase: '1750905', arlKey: 'II', remanenteTurnante21: true, horasSemanal: '21' },
    ];
    const { siguientes, huboCambio } = sincronizarLineasTurnantesAutomaticas<LineaFixture>(previas, [grupo], construirNueva);
    expect(huboCambio).toBe(false);
    expect(siguientes).toHaveLength(2);
    expect(siguientes.find(l => l.id === 1)).toBe(previas[0]);
    expect(siguientes.find(l => l.id === 2)).toBe(previas[1]);
  });

  it('de IMPAR a PAR retira la línea de remanente y conserva solo la de bloques', () => {
    const grupoImpar = grupoDeUnaPosicion(11, 1750905, 'II'); // 11 → 5 bloques + 1 remanente
    const previas: LineaFixture[] = [
      { id: 1, claveGrupoTurnante: grupoImpar.claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '5', salarioBase: '1750905', arlKey: 'II', horasSemanal: '42' },
      { id: 2, claveGrupoTurnante: grupoImpar.claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '1', salarioBase: '1750905', arlKey: 'II', remanenteTurnante21: true, horasSemanal: '21' },
    ];
    const grupoPar = { ...grupoDeUnaPosicion(12, 1750905, 'II'), claveGrupo: grupoImpar.claveGrupo }; // 12 → 6 bloques, 0 remanente
    const { siguientes, huboCambio } = sincronizarLineasTurnantesAutomaticas<LineaFixture>(previas, [grupoPar], construirNueva);
    expect(huboCambio).toBe(true);
    expect(siguientes).toHaveLength(1);
    expect(siguientes[0].id).toBe(1); // la línea de bloques se conserva (misma referencia lógica, actualizada)
    expect(siguientes[0].cantOpeFijos).toBe('6');
    expect(siguientes[0].remanenteTurnante21).toBeFalsy();
  });

  describe('§5 — banderas independientes: editar salario y editar ARL se congelan por separado', () => {
    it('12 — salarioEditadoManualmente congela SOLO el salario; el ARL se sigue resincronizando', () => {
      const grupoInicial = grupoDeUnaPosicion(6, 1750905, 'II'); // 6 → 3 bloques
      const previas: LineaFixture[] = [
        { id: 1, claveGrupoTurnante: grupoInicial.claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '3', salarioBase: '2000000', arlKey: 'II', salarioEditadoManualmente: true, arlEditadoManualmente: false, horasSemanal: '42' },
      ];
      const grupoConOtroSalarioYArl = { ...grupoDeUnaPosicion(12, 1750905, 'V'), claveGrupo: grupoInicial.claveGrupo, arlKey: 'V' }; // 12 → 6 bloques
      const { siguientes, huboCambio } = sincronizarLineasTurnantesAutomaticas<LineaFixture>(previas, [grupoConOtroSalarioYArl], construirNueva);
      expect(huboCambio).toBe(true); // cantOpeFijos y arlKey cambiaron
      expect(siguientes[0].salarioBase).toBe('2000000'); // NUNCA sobrescrito (congelado)
      expect(siguientes[0].arlKey).toBe('V'); // SÍ se resincroniza (no estaba congelado)
      expect(siguientes[0].cantOpeFijos).toBe('6');
    });

    it('arlEditadoManualmente congela SOLO el ARL; el salario se sigue resincronizando', () => {
      const grupoInicial = grupoDeUnaPosicion(6, 1750905, 'II');
      const previas: LineaFixture[] = [
        { id: 1, claveGrupoTurnante: grupoInicial.claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '3', salarioBase: '1750905', arlKey: 'V', salarioEditadoManualmente: false, arlEditadoManualmente: true, horasSemanal: '42' },
      ];
      const grupoConOtroSalarioYArl = { ...grupoDeUnaPosicion(12, 2000000, 'II'), claveGrupo: grupoInicial.claveGrupo, salarioBaseHeredado: 2000000, arlKey: 'II' };
      const { siguientes, huboCambio } = sincronizarLineasTurnantesAutomaticas<LineaFixture>(previas, [grupoConOtroSalarioYArl], construirNueva);
      expect(huboCambio).toBe(true);
      expect(siguientes[0].salarioBase).toBe('2000000'); // SÍ se resincroniza (no estaba congelado)
      expect(siguientes[0].arlKey).toBe('V'); // NUNCA sobrescrito (congelado)
    });

    it('con ambas banderas activas, ni salario ni ARL se resincronizan — solo cantOpeFijos', () => {
      const grupoInicial = grupoDeUnaPosicion(6, 1750905, 'II');
      const previas: LineaFixture[] = [
        { id: 1, claveGrupoTurnante: grupoInicial.claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '3', salarioBase: '3000000', arlKey: 'IV', salarioEditadoManualmente: true, arlEditadoManualmente: true, horasSemanal: '42' },
      ];
      const grupoDistinto = { ...grupoDeUnaPosicion(12, 1750905, 'II'), claveGrupo: grupoInicial.claveGrupo };
      const { siguientes } = sincronizarLineasTurnantesAutomaticas<LineaFixture>(previas, [grupoDistinto], construirNueva);
      expect(siguientes[0].salarioBase).toBe('3000000');
      expect(siguientes[0].arlKey).toBe('IV');
      expect(siguientes[0].cantOpeFijos).toBe('6');
    });

    it('con ambas banderas activas y sin cambio de cantidad, no hay cambio real en absoluto', () => {
      const grupoInicial = grupoDeUnaPosicion(10, 1750905, 'II'); // 10 → 5 bloques, 0 remanente
      const previas: LineaFixture[] = [
        { id: 1, claveGrupoTurnante: grupoInicial.claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '5', salarioBase: '3000000', arlKey: 'IV', salarioEditadoManualmente: true, arlEditadoManualmente: true, horasSemanal: '42' },
      ];
      const { siguientes, huboCambio } = sincronizarLineasTurnantesAutomaticas<LineaFixture>(previas, [grupoInicial], construirNueva);
      expect(huboCambio).toBe(false);
      expect(siguientes[0]).toBe(previas[0]);
    });
  });

  it('13 — grupos incompatibles (claves distintas) generan/conservan líneas separadas, cada una con su propio salario', () => {
    const grupoA = grupoDeUnaPosicion(6, 1200000, 'I');
    const grupoB = { ...grupoDeUnaPosicion(6, 1500000, 'I'), claveGrupo: grupoA.claveGrupo + '-B' };
    const previas: LineaFixture[] = [
      { id: 1, claveGrupoTurnante: grupoA.claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '3', salarioBase: '1200000', arlKey: 'I', horasSemanal: '42' },
    ];
    const { siguientes, huboCambio } = sincronizarLineasTurnantesAutomaticas<LineaFixture>(previas, [grupoA, grupoB], construirNueva);
    expect(huboCambio).toBe(true); // grupoB es nuevo
    expect(siguientes).toHaveLength(2);
    const lineaA = siguientes.find(l => l.claveGrupoTurnante === grupoA.claveGrupo)!;
    const lineaB = siguientes.find(l => l.claveGrupoTurnante === grupoB.claveGrupo)!;
    expect(lineaA.id).toBe(1); // la existente se conserva, no se duplica
    expect(lineaA.salarioBase).toBe('1200000');
    expect(lineaB.salarioBase).toBe('1500000');
  });

  it('una línea automática cuyo grupo desapareció no queda huérfana', () => {
    const grupoA = grupoDeUnaPosicion(6, 1200000, 'I');
    const previas: LineaFixture[] = [
      { id: 1, claveGrupoTurnante: grupoA.claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '3', salarioBase: '1200000', arlKey: 'I', horasSemanal: '42' },
      { id: 2, claveGrupoTurnante: 'gB-ya-no-existe', esTurnanteAutomatico: true, cantOpeFijos: '3', salarioBase: '1500000', arlKey: 'I', horasSemanal: '42' },
    ];
    const { siguientes, huboCambio } = sincronizarLineasTurnantesAutomaticas<LineaFixture>(previas, [grupoA], construirNueva);
    expect(huboCambio).toBe(true);
    expect(siguientes).toHaveLength(1);
    expect(siguientes[0].claveGrupoTurnante).toBe(grupoA.claveGrupo);
  });

  describe('Ajuste "CORREGIR DEFINITIVAMENTE EL CÁLCULO PROPORCIONAL DE TURNANTES" — HORAS_REALES usa SIEMPRE la línea de referencia de 42h (cantOpeFijos=1 fijo), nunca una línea a horas reales', () => {
    it('SUPERVISOR PRUEBA (07:00–14:00, 49h/sem → HORAS_REALES de 7h): la línea automática sigue siendo la referencia de 42h — sin cambios reales si ya estaba correcta', () => {
      const supervisor = posicion({ id: 'supervisor', cantidad: 1, salarioBase: 1750905, arlKey: 'II', minutosPorDia: minutosPorDiaHomogeneo(7) }); // 7h/día×7=49h → 49-42=7h HORAS_REALES
      const grupos = construirGruposNecesidadTurnantes([supervisor], SMLMV_PRUEBA);
      expect(grupos).toHaveLength(1);
      expect(grupos[0].modalidadCobertura).toBe('HORAS_REALES');
      expect(grupos[0].horasCoberturaPorPosicion).toBe(7);
      const previas: LineaFixture[] = [
        { id: 99, claveGrupoTurnante: grupos[0].claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '1', salarioBase: '1750905', arlKey: 'II', horasSemanal: '42' },
      ];
      const { siguientes, huboCambio } = sincronizarLineasTurnantesAutomaticas<LineaFixture>(previas, grupos, construirNueva);
      expect(huboCambio).toBe(false); // la referencia de 42h NUNCA cambia por la modalidad — el costo real se escala en page.tsx, no aquí
      expect(siguientes).toHaveLength(1);
      expect(siguientes[0].horasSemanal).toBe('42');
      expect(siguientes[0].cantOpeFijos).toBe('1'); // SIEMPRE 1, nunca escalado por cantidad de turnantes
    });

    it('una línea previa a horas reales obsoleta (residuo de un diseño anterior, ej. "7") se reconstruye a la referencia de 42h', () => {
      const supervisor = posicion({ id: 'supervisor', cantidad: 1, salarioBase: 1750905, arlKey: 'II', minutosPorDia: minutosPorDiaHomogeneo(7) });
      const grupos = construirGruposNecesidadTurnantes([supervisor], SMLMV_PRUEBA);
      const previas: LineaFixture[] = [
        { id: 99, claveGrupoTurnante: grupos[0].claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '1', salarioBase: '1750905', arlKey: 'II', horasSemanal: '7' },
      ];
      const { siguientes, huboCambio } = sincronizarLineasTurnantesAutomaticas<LineaFixture>(previas, grupos, construirNueva);
      expect(huboCambio).toBe(true);
      expect(siguientes[0].horasSemanal).toBe('42');
    });

    it('sin desajuste de horasSemanal, no hay cambio real (evita loop de render)', () => {
      const grupo = grupoDeUnaPosicion(10, 1750905, 'II'); // 10 → 5 bloques de 42h
      const previas: LineaFixture[] = [
        { id: 1, claveGrupoTurnante: grupo.claveGrupo, esTurnanteAutomatico: true, cantOpeFijos: '5', salarioBase: '1750905', arlKey: 'II', horasSemanal: '42' },
      ];
      const { siguientes, huboCambio } = sincronizarLineasTurnantesAutomaticas<LineaFixture>(previas, [grupo], construirNueva);
      expect(huboCambio).toBe(false);
      expect(siguientes[0]).toBe(previas[0]);
    });
  });
});
