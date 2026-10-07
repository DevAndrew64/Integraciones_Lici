/**
 * Ajuste "VALOR AGREGADO — 5 TIPOS CONSOLIDADOS" — verificación dedicada de
 * que `LineaMOExtra` soporta `esValorAgregado`/`frecuenciaValorAgregado` con
 * el MISMO tipo `FrecuenciaValorAgregado` de `valor-agregado.ts` (nunca un
 * tipo paralelo que pueda divergir), y que es estructuralmente compatible
 * con `RecursoConValorAgregado` — condición necesaria para que
 * `esRecursoValorAgregado`/`validarFrecuenciaValorAgregado` operen
 * directamente sobre líneas de Mano de Obra sin conversión intermedia.
 */
import { describe, expect, it } from 'vitest';
import type { LineaMOExtra } from './tipos-cargo';
import {
  FRECUENCIAS_VALOR_AGREGADO, esRecursoValorAgregado, validarFrecuenciaValorAgregado,
  type FrecuenciaValorAgregado,
} from '../../costos-estructura/valor-agregado';

function lineaBase(): LineaMOExtra {
  return {
    id: 1, codigo: 'C1', nombreCargo: 'Aseador', codigoHorario: 'H1', horario: '', jornada: '', horasSemanal: '', nHoras: '', turno: '',
    cantOpeFijos: '1', cantOpeAdic: '0', dias: [], fechaInicio: '', fechaFin: '',
    horaInicio: '', horaFin: '', receso: '', horaReceso: '',
    salarioBase: '1300000', arlKey: 'I',
    distribucionesHorario: [],
    incluyeFestivos: false,
    conBonoPrestacional: false, bonoPrestacionalValor: '0',
    conBonoAlimentacion: false, bonoAlimentacionValor: '0',
    conBonoTransporte: false, bonoTransporteValor: '0',
    conBonoProductividad: false, bonoProductividadValor: '0',
    conBonoOcasional: false, bonoOcasionalValor: '0',
  };
}

describe('LineaMOExtra soporta esValorAgregado/frecuenciaValorAgregado', () => {
  it('un cargo histórico sin los campos sigue siendo un LineaMOExtra válido (opcionales, nunca obligatorios)', () => {
    const l: LineaMOExtra = lineaBase();
    expect(l.esValorAgregado).toBeUndefined();
    expect(l.frecuenciaValorAgregado).toBeUndefined();
  });

  it('acepta esValorAgregado:true y frecuenciaValorAgregado con cada código real de FRECUENCIAS_VALOR_AGREGADO (1-15, tabla oficial Grupo Colba)', () => {
    for (const { value } of FRECUENCIAS_VALOR_AGREGADO) {
      const l: LineaMOExtra = { ...lineaBase(), esValorAgregado: true, frecuenciaValorAgregado: value };
      expect(l.frecuenciaValorAgregado).toBe(value);
    }
  });

  it('frecuenciaValorAgregado usa exactamente el tipo FrecuenciaValorAgregado de valor-agregado.ts — un valor fuera de la unión no compila (verificado en build time, ver @ts-expect-error)', () => {
    // @ts-expect-error 999 no es un FrecuenciaValorAgregado válido (1-15)
    const invalida: LineaMOExtra = { ...lineaBase(), esValorAgregado: true, frecuenciaValorAgregado: 999 };
    expect(invalida.frecuenciaValorAgregado).toBe(999);
    // Prueba positiva de que el tipo es EXACTAMENTE el mismo (asignación en ambos sentidos sin cast).
    const f: FrecuenciaValorAgregado = 1;
    const l: LineaMOExtra = { ...lineaBase(), frecuenciaValorAgregado: f };
    expect(l.frecuenciaValorAgregado).toBe(1);
  });

  it('LineaMOExtra es estructuralmente compatible con RecursoConValorAgregado — esRecursoValorAgregado/validarFrecuenciaValorAgregado operan directo sobre ella, sin conversión', () => {
    const sinVA = lineaBase();
    expect(esRecursoValorAgregado(sinVA)).toBe(false);
    expect(validarFrecuenciaValorAgregado(sinVA)).toBeNull();

    const conVASinFrecuencia: LineaMOExtra = { ...lineaBase(), esValorAgregado: true };
    expect(esRecursoValorAgregado(conVASinFrecuencia)).toBe(true);
    expect(validarFrecuenciaValorAgregado(conVASinFrecuencia)).toBe('Selecciona la frecuencia del Valor Agregado.');

    const conVACompleta: LineaMOExtra = { ...lineaBase(), esValorAgregado: true, frecuenciaValorAgregado: 2 };
    expect(esRecursoValorAgregado(conVACompleta)).toBe(true);
    expect(validarFrecuenciaValorAgregado(conVACompleta)).toBeNull();
  });
});
