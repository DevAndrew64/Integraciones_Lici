/**
 * FASE 1 (diagnóstico Aseocolba) — tests permanentes que CONGELAN la regla
 * de negocio confirmada para turnantes de relevo, ANTES de tocar
 * producción:
 *
 *   horasRelevoPorTrabajador = 7
 *   horasTotalesRelevo = cantidadDeTrabajadoresQueRequierenRelevo × 7
 *
 * Esto NO cambia por: duración diaria real, cantidad de bloques, cantidad
 * de grupos de compatibilidad del mismo cargo, nombre del cargo, ni
 * horario diurno/nocturno.
 *
 * `esEsquemaTurnos` (calculo-turnantes.ts, rama introducida en el commit
 * 668a957) contradice esta regla: cuando el MISMO `perfilCargo` tiene 2+
 * grupos de compatibilidad (por cualquier motivo — no necesariamente una
 * operación rotativa 24/7 real), sustituye las 7h fijas por
 * `horasSemanales-42`. Esto reproduce EXACTAMENTE los hallazgos de 10.5h/
 * 14h reportados. Los tests marcados [ROJO] reproducen ese bug tal cual
 * existe hoy — no se corrige en esta fase.
 *
 * NO se modifica ningún archivo de producción en esta fase.
 */
import { describe, expect, it } from 'vitest';
import {
  construirGruposNecesidadTurnantes,
  CONFIGURACION_TURNANTES_DEFAULT,
  type PosicionElegibleTurnante,
} from './calculo-turnantes';
import type { DiaSemanaHorario } from '../horarios/tipos';

const SMLMV_PRUEBA = 1750905;

const minutosPorDiaHomogeneo = (horasTurnoDiario: number): Record<DiaSemanaHorario, number> => {
  const min = horasTurnoDiario * 60;
  return { L: min, M: min, X: min, J: min, V: min, S: min, D: min };
};

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

describe('FASE 1 — turnantes: relevo fijo 7h × cantidad de trabajadores, independiente de esEsquemaTurnos', () => {
  describe('Caso base — 1 grupo de compatibilidad, 1/2/3 trabajadores → 7h/14h/21h', () => {
    it('[VERDE — regresión, ya correcto hoy] 1 trabajador → 7h', () => {
      const grupos = construirGruposNecesidadTurnantes(
        [posicion({ id: 'p1', cantidad: 1, perfilCargo: 'RECEPCIONISTA', minutosPorDia: minutosPorDiaHomogeneo(8) })],
        SMLMV_PRUEBA,
      );
      expect(grupos).toHaveLength(1);
      expect(grupos[0].necesidad.horasRelevoSemanales).toBe(7);
    });

    it('[VERDE — regresión, ya correcto hoy] 2 trabajadores en la misma posición (cantidad=2) → 14h', () => {
      const grupos = construirGruposNecesidadTurnantes(
        [posicion({ id: 'p1', cantidad: 2, perfilCargo: 'RECEPCIONISTA', minutosPorDia: minutosPorDiaHomogeneo(8) })],
        SMLMV_PRUEBA,
      );
      expect(grupos).toHaveLength(1);
      expect(grupos[0].necesidad.horasRelevoSemanales).toBe(14);
    });

    it('[VERDE — regresión, ya correcto hoy] 3 trabajadores en la misma posición (cantidad=3) → 21h', () => {
      const grupos = construirGruposNecesidadTurnantes(
        [posicion({ id: 'p1', cantidad: 3, perfilCargo: 'RECEPCIONISTA', minutosPorDia: minutosPorDiaHomogeneo(8) })],
        SMLMV_PRUEBA,
      );
      expect(grupos).toHaveLength(1);
      expect(grupos[0].necesidad.horasRelevoSemanales).toBe(21);
    });
  });

  describe('Caso Todero — 2 grupos de compatibilidad del MISMO cargo (esEsquemaTurnos), 1 trabajador cada uno → deben ser 7h y 7h', () => {
    // Mismo perfilCargo, distinto salarioBase → 2 grupos de compatibilidad
    // distintos (construirClaveCompatibilidadTurnante incluye salario),
    // reproduciendo el caso real "TODERO CON ALTURAS" documentado en el
    // código (comentario junto a clasificarModalidadTurnoParaCompensacion).
    const grupoA = posicion({ id: 'todero-a', cantidad: 1, perfilCargo: 'TODERO CON ALTURAS', salarioBase: 1200000, minutosPorDia: minutosPorDiaHomogeneo(8) });
    const grupoB = posicion({ id: 'todero-b', cantidad: 1, perfilCargo: 'TODERO CON ALTURAS', salarioBase: 1500000, minutosPorDia: minutosPorDiaHomogeneo(8) });

    it('[VERDE tras Fase 2 — bug corregido, esEsquemaTurnos retirado] cada grupo debe requerir 7h de relevo (1 trabajador = 1 relevo), NUNCA horasSemanales-42', () => {
      const grupos = construirGruposNecesidadTurnantes([grupoA, grupoB], SMLMV_PRUEBA);
      expect(grupos).toHaveLength(2);
      for (const g of grupos) {
        expect(g.necesidad.horasRelevoSemanales).toBe(7);
      }
    });
  });

  describe('Caso Todero — 2 grupos del mismo cargo, Grupo A con 2 trabajadores y Grupo B con 1 → deben ser 14h y 7h', () => {
    const grupoA = posicion({ id: 'todero-a', cantidad: 2, perfilCargo: 'TODERO CON ALTURAS', salarioBase: 1200000, minutosPorDia: minutosPorDiaHomogeneo(8) });
    const grupoB = posicion({ id: 'todero-b', cantidad: 1, perfilCargo: 'TODERO CON ALTURAS', salarioBase: 1500000, minutosPorDia: minutosPorDiaHomogeneo(8) });

    it('[VERDE tras Fase 2 — mismo bug corregido] Grupo A (2 trabajadores) → 14h; Grupo B (1 trabajador) → 7h', () => {
      const grupos = construirGruposNecesidadTurnantes([grupoA, grupoB], SMLMV_PRUEBA);
      expect(grupos).toHaveLength(2);
      const gA = grupos.find(g => g.necesidad.cantidadTurnantesFisicos !== undefined && g.perfilesCargoIncluidos.includes('TODERO CON ALTURAS'));
      // Se identifican por orden de construcción (mismo orden de entrada esperado).
      const [resultA, resultB] = grupos;
      expect(resultA.necesidad.horasRelevoSemanales).toBe(14);
      expect(resultB.necesidad.horasRelevoSemanales).toBe(7);
    });
  });

  describe('Regresión — duración diaria real NUNCA cambia las 7h de relevo (grupo único, sin esEsquemaTurnos)', () => {
    it('[VERDE — ya correcto hoy, verificado en fase de diagnóstico] horario de 7.5h/día → relevo sigue siendo 7h', () => {
      const grupos = construirGruposNecesidadTurnantes(
        [posicion({ id: 'p1', cantidad: 1, perfilCargo: 'PISCINERO', minutosPorDia: minutosPorDiaHomogeneo(7.5) })],
        SMLMV_PRUEBA,
      );
      expect(grupos[0].necesidad.horasRelevoSemanales).toBe(7);
    });

    it('[VERDE — ya correcto hoy, verificado en fase de diagnóstico] horario de 8h/día → relevo sigue siendo 7h', () => {
      const grupos = construirGruposNecesidadTurnantes(
        [posicion({ id: 'p1', cantidad: 1, perfilCargo: 'PISCINERO', minutosPorDia: minutosPorDiaHomogeneo(8) })],
        SMLMV_PRUEBA,
      );
      expect(grupos[0].necesidad.horasRelevoSemanales).toBe(7);
    });
  });

  describe('Regresión — múltiples bloques horarios en el mismo día NO multiplican el relevo', () => {
    it('[VERDE — ya correcto hoy] un horario partido (2 bloques/día) sigue generando 7h de relevo para 1 trabajador', () => {
      // minutosPorDia ya representa el TOTAL diario (no por bloque) — un
      // horario partido de 4h+3.5h=7.5h/día debe comportarse igual que el
      // caso homogéneo de 7.5h ya verificado arriba.
      const min = 7.5 * 60;
      const grupos = construirGruposNecesidadTurnantes(
        [posicion({
          id: 'p1', cantidad: 1, perfilCargo: 'ASEADOR_PARTIDO',
          minutosPorDia: { L: min, M: min, X: min, J: min, V: min, S: min, D: min },
        })],
        SMLMV_PRUEBA,
      );
      expect(grupos[0].necesidad.horasRelevoSemanales).toBe(7);
    });
  });

  describe('Guardrail — configuración explícita de horasEfectivasDescansoTurnante sigue respetándose (no rota por el bug)', () => {
    it('[VERDE — ya correcto hoy] con configuración custom de 5h, 1 grupo, 1 trabajador → 5h', () => {
      const CONFIG_CUSTOM = { ...CONFIGURACION_TURNANTES_DEFAULT, horasEfectivasDescansoTurnante: 5 };
      const grupos = construirGruposNecesidadTurnantes(
        [posicion({ id: 'p1', cantidad: 1, perfilCargo: 'VIGILANTE', minutosPorDia: minutosPorDiaHomogeneo(8) })],
        SMLMV_PRUEBA,
        CONFIG_CUSTOM,
      );
      expect(grupos[0].necesidad.horasRelevoSemanales).toBe(5);
    });
  });
});
